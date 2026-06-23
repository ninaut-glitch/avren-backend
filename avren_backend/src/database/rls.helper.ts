import { Sql } from 'postgres';

export interface SessionContext {
  tenantId: string;
  userId:   string;
  userRole: string;
}

/**
 * FIX #2 — Sem interpolação manual de strings dentro de unsafe().
 *
 * SET LOCAL não aceita bind params ($1) — é uma restrição do PostgreSQL.
 * A solução segura é validar cada campo antes de usá-lo e emitir
 * três SET LOCAL em queries separadas via sql`...` (parametrizado).
 *
 * O driver `postgres` escapa automaticamente valores em template tags.
 * Usando sql`SET LOCAL ... = ${value}` o driver garante que o valor
 * é tratado como literal de string, não como SQL injetável.
 */
export async function setRlsContext(
  sql: Sql,
  ctx: SessionContext,
): Promise<void> {
  // Validação de formato antes de qualquer coisa
  assertUuid(ctx.tenantId, 'tenantId');
  assertUuid(ctx.userId,   'userId');
  assertRole(ctx.userRole);

  // Três queries parametrizadas independentes — sem unsafe(), sem interpolação
  await sql`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`;
  await sql`SELECT set_config('app.current_user_id',   ${ctx.userId},   true)`;
  await sql`SELECT set_config('app.current_user_role', ${ctx.userRole}, true)`;
}

/**
 * Executa fn dentro de uma transação com RLS configurado.
 * Padrão obrigatório para todos os repositórios.
 *
 * set_config(..., true) = LOCAL à transação corrente,
 * equivalente a SET LOCAL mas aceita bind params.
 */
export async function withRls<T>(
  sql: Sql,
  ctx: SessionContext,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await setRlsContext(tx, ctx);
    return fn(tx);
  });
}

// ── Validadores ───────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES = new Set(['banker', 'supervisor', 'socio', 'operacoes']);

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`RLS context: ${field} is not a valid UUID — "${value}"`);
  }
}

function assertRole(value: string): void {
  if (!VALID_ROLES.has(value)) {
    throw new Error(`RLS context: userRole "${value}" is not a recognized role`);
  }
}
