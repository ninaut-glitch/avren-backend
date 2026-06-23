// ============================================================
// database/rls.helper.ts — CORRIGIDO
// Usa TransactionSql no tipo do callback para compatibilidade
// ============================================================
import { Sql, TransactionSql } from 'postgres'

export interface SessionContext {
  tenantId: string
  userId:   string
  userRole: string
}

const VALID_ROLES = ['banker','supervisor','socio','operacoes','admin'] as const
type ValidRole = typeof VALID_ROLES[number]

export function assertUuid(value: string, name: string): void {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(value)) {
    throw new Error(`${name} inválido: "${value}"`)
  }
}

export function assertRole(role: string): ValidRole {
  if (!VALID_ROLES.includes(role as ValidRole)) {
    throw new Error(`Role inválida: "${role}"`)
  }
  return role as ValidRole
}

async function setRlsContext(
  tx:  TransactionSql | Sql,
  ctx: SessionContext,
): Promise<void> {
  assertUuid(ctx.tenantId, 'tenantId')
  assertUuid(ctx.userId,   'userId')
  assertRole(ctx.userRole)

  await (tx as any)`
    SELECT
      set_config('app.current_tenant_id', ${ctx.tenantId}, TRUE),
      set_config('app.current_user_id',   ${ctx.userId},   TRUE),
      set_config('app.current_user_role', ${ctx.userRole}, TRUE)
  `
}

export async function withRls<T>(
  sql: Sql,
  ctx: SessionContext,
  fn:  (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await setRlsContext(tx, ctx)
    return fn(tx)
  }) as Promise<T>
}
