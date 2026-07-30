import { Sql, TransactionSql } from 'postgres';
import { assertUuid } from '../../../../database/rls.helper';

/**
 * Contexto RLS para JOBS (cron), onde nao existe usuario humano.
 * Define APENAS app.current_tenant_id (o unico setting que as
 * politicas do schema integrations verificam), de forma transacional.
 * Operacoes humanas continuam usando o withRls completo.
 */
export async function withTenantRls<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId, 'tenantId');
  return sql.begin(async (tx) => {
    await (tx as any)`
      SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)
    `;
    return fn(tx);
  }) as Promise<T>;
}
