import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { JwtPayload } from '../decorators/current-user.decorator';

/**
 * RlsInterceptor
 *
 * Executa ANTES de cada controller autenticado.
 * Armazena o contexto RLS no request para que os repositórios
 * usem withRls() corretamente.
 *
 * Não abre transação aqui — cada repositório abre a própria
 * via withRls(), que garante SET LOCAL dentro da transação.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;

    if (user) {
      request.rlsContext = {
        tenantId: user.tenantId,
        userId: user.sub,
        userRole: user.role,
      };
    }

    return next.handle();
  }
}
