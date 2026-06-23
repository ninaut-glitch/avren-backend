import {
  CallHandler, ExecutionContext,
  Inject, Injectable, NestInterceptor, Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { JwtPayload } from '../decorators/current-user.decorator';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Extrai o nome da entidade do path: /v1/leads/123 → 'leads'
function entityFromUrl(url: string): string {
  const segments = url.replace(/^\/v\d+\//, '').split('/');
  return segments[0] ?? 'unknown';
}

// Mapeia método HTTP para action do audit log
function actionFromMethod(method: string): string {
  const map: Record<string, string> = {
    POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete',
  };
  return map[method] ?? method.toLowerCase();
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request  = context.switchToHttp().getRequest();
    const user     = request.user as JwtPayload | undefined;

    if (!user || !WRITE_METHODS.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async () => {
        try {
          // FIX #3: colunas alinhadas com 002_auth.sql
          // auth.audit_logs(tenant_id, user_id, action, entity_type, ip_address)
          await this.sql`
            INSERT INTO auth.audit_logs
              (tenant_id, user_id, action, entity_type, ip_address)
            VALUES (
              ${user.tenantId}::uuid,
              ${user.sub}::uuid,
              ${actionFromMethod(request.method)},
              ${entityFromUrl(request.url)},
              ${request.ip ?? null}::inet
            )
          `;
        } catch (err) {
          // Audit log nunca deve derrubar a request principal
          this.logger.warn(`Audit log failed: ${String(err)}`);
        }
      }),
    );
  }
}
