import {
  Injectable, Inject, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Sql } from 'postgres';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly sessionTtlHours: number;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    // Lê expiração do JWT e converte para horas para calcular expires_at da sessão
    const exp = this.config.get<string>('JWT_EXPIRES_IN', '8h');
    this.sessionTtlHours = exp.endsWith('h')
      ? parseInt(exp)
      : exp.endsWith('d') ? parseInt(exp) * 24 : 8;
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    // 1. Busca usuário — sem RLS (usa service role)
    const [user] = await this.sql`
      SELECT
        id, tenant_id, business_unit_id, email,
        password_hash, mfa_enabled, mfa_secret,
        role, full_name, is_active
      FROM auth.users
      WHERE email = ${dto.email}
      LIMIT 1
    `;

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // 2. Valida senha
    const validPassword = await bcrypt.compare(dto.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // 3. Valida MFA se habilitado
    if (user.mfaEnabled) {
      if (!dto.mfa_code) {
        throw new UnauthorizedException('Código MFA obrigatório');
      }
      const validMfa = authenticator.verify({
        token:  dto.mfa_code,
        secret: user.mfaSecret,
      });
      if (!validMfa) {
        throw new UnauthorizedException('Código MFA inválido ou expirado');
      }
    }

    // 4. Gera JWT
    const payload = {
      sub:            user.id,
      email:          user.email,
      role:           user.role,
      tenantId:       user.tenantId,
      businessUnitId: user.businessUnitId ?? null,
    };
    const accessToken = this.jwtService.sign(payload);

    // 5. FIX #2: Grava sessão em auth.sessions
    //    Armazena hash SHA-256 do token — nunca o token em plain text
    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 3_600_000);

    await this.sql`
      INSERT INTO auth.sessions (user_id, token_hash, ip_address, user_agent, expires_at)
      VALUES (
        ${user.id},
        ${tokenHash},
        ${ipAddress ?? null}::inet,
        ${userAgent ?? null},
        ${expiresAt.toISOString()}::timestamptz
      )
    `;

    // 6. Atualiza last_login_at
    await this.sql`
      UPDATE auth.users SET last_login_at = NOW() WHERE id = ${user.id}
    `;

    return {
      access_token: accessToken,
      expires_in:   this.sessionTtlHours * 3_600,
      user: {
        id:               user.id,
        full_name:        user.fullName,
        email:            user.email,
        role:             user.role,
        tenant_id:        user.tenantId,
        business_unit_id: user.businessUnitId,
      },
    };
  }

  // FIX #2: logout invalida a sessão no banco via hash do token
  async logout(rawToken: string) {
    if (rawToken) {
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await this.sql`
        DELETE FROM auth.sessions WHERE token_hash = ${tokenHash}
      `;
    }
    return { message: 'Sessão encerrada' };
  }

  // Valida se a sessão ainda está ativa (para middleware opcional)
  async isSessionActive(rawToken: string): Promise<boolean> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const [session] = await this.sql`
      SELECT id FROM auth.sessions
      WHERE token_hash = ${tokenHash}
        AND expires_at > NOW()
      LIMIT 1
    `;
    return !!session;
  }
}
