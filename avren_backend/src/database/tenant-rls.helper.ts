import { Sql, TransactionSql } from 'postgres';
import { assertUuid } from './rls.helper';

/**
 * Contexto transacional para rotinas internas. A sentinela `system`
 * nunca passa pelo caminho de autenticação humana.
 */
export async function withSystemTenantRls<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId, 'tenantId');
  return sql.begin(async (tx) => {
    await (tx as any)`
      SELECT
        set_config('app.current_tenant_id', ${tenantId}, TRUE),
        set_config('app.current_user_id', '', TRUE),
        set_config('app.current_user_role', 'system', TRUE)
    `;
    return fn(tx);
  }) as Promise<T>;
}

/** Enumeração mínima, fornecida por função SECURITY DEFINER da migration 029. */
export async function listActiveTenantIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ tenantId: string }[]>`
    SELECT tenant_id AS "tenantId" FROM auth.list_active_tenant_ids()
  `;
  return rows.map((row) => row.tenantId);
}

export async function runForEachTenant(
  sql: Sql,
  fn: (tenantId: string) => Promise<void>,
): Promise<void> {
  for (const tenantId of await listActiveTenantIds(sql)) {
    await fn(tenantId);
  }
}
