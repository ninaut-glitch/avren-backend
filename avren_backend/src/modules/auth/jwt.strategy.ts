import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
      passReqToCallback: true,
    });
  }

  async validate(req: FastifyRequest, payload: JwtPayload) {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Token inválido');
    }
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!token) {
      throw new UnauthorizedException('Sessão inválida ou encerrada');
    }
    try {
      if (!(await this.authService.isSessionActive(payload.sub, token))) {
        throw new UnauthorizedException('Sessão inválida ou encerrada');
      }
    } catch {
      // Falha fechada: indisponibilidade do banco nunca autentica a requisição.
      throw new UnauthorizedException('Sessão inválida ou encerrada');
    }
    return payload;
  }
}
