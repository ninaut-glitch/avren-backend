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
import { SessionContext, withRls } from '../../database/rls.helper';

@Injectable()
export class AuthService {
  private readonly sessionTtlHours: number;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    const exp = this.config.get<string>('JWT_EXPIRES_IN', '8h');
    this.sessionTtlHours = exp.endsWith('h')
      ? parseInt(exp)
      : exp.endsWith('d') ? parseInt(exp) * 24 : 8;
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const [user] = await this.sql`
      SELECT * FROM auth.find_user_for_login(${dto.email})
    `;

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const validPassword = await bcrypt.compare(dto.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

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

    const payload = {
      sub:            user.id,
      email:          user.email,
      role:           user.role,
      tenantId:       user.tenantId,
      businessUnitId: user.businessUnitId ?? null,
    };

    const accessToken = this.jwtService.sign(payload);

    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 3_600_000);

    await this.sql`
      SELECT auth.create_session(
        ${user.id}, ${tokenHash}, ${ipAddress ?? null}::inet,
        ${userAgent ?? null}, ${expiresAt.toISOString()}::timestamptz
      )
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

  async logout(rawToken: string) {
    if (rawToken) {
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await this.sql`SELECT auth.revoke_session(${tokenHash})`;
    }
    return { message: 'Sessão encerrada' };
  }

  async isSessionActive(rawToken: string): Promise<boolean> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const [row] = await this.sql<{ active: boolean }[]>`
      SELECT auth.is_session_active(${tokenHash}) AS active
    `;
    return Boolean(row?.active);
  }

  async listBankers(ctx: SessionContext) {
    return withRls(this.sql, ctx, (tx) => tx`
      SELECT id, full_name, role, email
      FROM auth.users
      WHERE tenant_id = ${ctx.tenantId}
        AND is_active = true
        AND role IN ('banker', 'supervisor', 'socio')
      ORDER BY full_name ASC
    `);
  }
}
