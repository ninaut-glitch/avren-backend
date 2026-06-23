import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Role } from '../decorators/roles.decorator';
import { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sem @Roles() → qualquer usuário autenticado tem acesso
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();

    if (!required.includes(user.role as Role)) {
      throw new ForbiddenException(
        `Acesso restrito a: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
