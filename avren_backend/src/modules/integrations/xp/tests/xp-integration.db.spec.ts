/**
 * Testes de INTEGRACAO contra PostgreSQL real.
 *
 * CONTRATO DE AMBIENTE (requisito 4):
 *   TEST_ADMIN_DATABASE_URL  credencial ADMINISTRATIVA: aplica
 *                            bootstrap + migrations 018/026/028 e os
 *                            grants de teste. Nunca usada nos asserts.
 *   TEST_DATABASE_URL        credencial de APLICACAO, SEM BYPASSRLS:
 *                            unica usada pelos servicos sob teste.
 *   XP_MIGRATIONS_DIR        opcional; default: <repo>/avren_backend/
 *                            migrations (018/026) + esta pasta
 *                            (bootstrap e grants de teste).
 *
 * O migrador aplica os arquivos SEMPRE nesta ordem, sem presumir nada
 * pela existencia do schema: bootstrap -> 018 -> 026 -> 028 -> grants.
 * 018 nao e idempotente (CREATE TABLE); o migrador detecta aplicacao
 * previa por uma tabela ESPECIFICA da 018 (xp_sync_runs) e, para 026 e
 * 028 (idempotentes), reaplica sempre.
 *
 * CI (requisito 4): com CI=true ou XP_DB_TESTS_REQUIRED=true, a
 * ausencia das URLs FALHA a suite explicitamente. Fora do CI, pula com
 * aviso.
 *
 * v3.1: os clientes postgres deste teste usam transform.column =
 * postgres.toCamel, IDENTICO ao databaseProvider real. Sem isso o
 * teste validaria um contrato de colunas que a producao nao usa.
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres, { Sql } from 'postgres';
import { XpSyncService } from '../sync/xp-sync.service';
import { XpSyncLock } from '../sync/xp-lock';
import { XpReconciliationService } from '../reconciliation/xp-reconciliation.service';
import { XpHttpClient } from '../client/xp-http.client';
import { SessionContext, withRls } from '../../../../database/rls.helper';

const APP_URL = process.env.TEST_DATABASE_URL;
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const REQUIRED =
  process.env.CI === 'true' || process.env.XP_DB_TESTS_REQUIRED === 'true';

function assertSafeTestDatabaseUrl(raw: string, label: string) {
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(raw).pathname.replace(/^\//, ''));
  } catch {
    throw new Error(`${label} nao e uma URL PostgreSQL valida.`);
  }
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `${label} aponta para o banco "${databaseName}". O nome precisa conter "test".`,
    );
  }
}

if (REQUIRED && (!APP_URL || !ADMIN_URL)) {
  describe('Integracao XP - banco real', () => {
    it('FALHA: TEST_DATABASE_URL/TEST_ADMIN_DATABASE_URL ausentes em ambiente CI', () => {
      throw new Error(
        'CI exige TEST_DATABASE_URL e TEST_ADMIN_DATABASE_URL para os testes de banco da integracao XP.',
      );
    });
  });
}

const d = APP_URL && ADMIN_URL ? describe : describe.skip;
if (!APP_URL || !ADMIN_URL) {
  // eslint-disable-next-line no-console
  console.warn('[xp-db-spec] URLs de teste ausentes: suite de banco pulada (fora de CI).');
}

function migrationsDirs() {
  const here = __dirname; // .../src/modules/integrations/xp/tests
  const repoMigrations =
    process.env.XP_MIGRATIONS_DIR ?? path.resolve(here, '../../../../../migrations');
  return { repoMigrations, testsDir: here };
}

async function migrate(admin: Sql) {
  const { repoMigrations, testsDir } = migrationsDirs();
  const apply = (p: string) => admin.unsafe(fs.readFileSync(p, 'utf8'));

  await apply(path.join(testsDir, 'bootstrap-test-db.sql'));

  const [{ has018 }] = await admin`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'integrations' AND table_name = 'xp_sync_runs'
    ) AS has018
  `;
  if (!has018) {
    await apply(path.join(repoMigrations, '018_xp_integration_foundation.sql'));
  }
  await apply(path.join(repoMigrations, '026_xp_integration_hardening.sql'));
  await apply(path.join(repoMigrations, '028_xp_reconciliation.sql'));
  // Etapa B: aplicada DUAS vezes de proposito — idempotencia da 034
  // provada em todo run da suite, nao num teste isolado.
  await apply(path.join(repoMigrations, '034_xp_products_positivador.sql'));
  await apply(path.join(repoMigrations, '034_xp_products_positivador.sql'));
  await apply(path.join(testsDir, 'grants-test-app.sql'));
}

function httpNever(): XpHttpClient {
  return {
    request: jest.fn().mockRejectedValue(new Error('rede proibida no teste')),
    paginate: jest.fn().mockRejectedValue(new Error('rede proibida no teste')),
    enabled: false,
  } as unknown as XpHttpClient;
}

d('Integracao XP - banco real', () => {
  let admin: Sql;
  let sql: Sql;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let clientA: string;
  let clientB: string;
  let ctxA: SessionContext;
  let ctxB: SessionContext;
  let sync: XpSyncService;
  let reconciliation: XpReconciliationService;

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(ADMIN_URL as string, 'TEST_ADMIN_DATABASE_URL');
    assertSafeTestDatabaseUrl(APP_URL as string, 'TEST_DATABASE_URL');

    admin = postgres(ADMIN_URL as string, {
      max: 2,
      onnotice: () => undefined,
      transform: { column: postgres.toCamel },
    });
    await migrate(admin);

    // MESMO transform do databaseProvider real: sem isso o teste
    // passaria lendo snake_case e a producao quebraria em camelCase.
    sql = postgres(APP_URL as string, {
      max: 6,
      onnotice: () => undefined,
      transform: { column: postgres.toCamel },
    });
    const [{ bypass }] = await sql`
      SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user
    `;
    if (bypass) {
      throw new Error(
        'TEST_DATABASE_URL usa um papel com BYPASSRLS; os testes de isolamento seriam invalidos.',
      );
    }

    const stamp = Date.now();
    const [ta] = await admin`
      INSERT INTO auth.tenants (name, slug)
      VALUES ('XP Teste A', ${'xp-teste-a-' + stamp}) RETURNING id
    `;
    const [tb] = await admin`
      INSERT INTO auth.tenants (name, slug)
      VALUES ('XP Teste B', ${'xp-teste-b-' + stamp}) RETURNING id
    `;
    tenantA = ta.id;
    tenantB = tb.id;

    const [ua] = await admin`
      INSERT INTO auth.users (tenant_id, full_name, email, password_hash, role)
      VALUES (${tenantA}, 'Socio A', ${'socio-a-' + stamp + '@teste.avren'}, 'x', 'socio')
      RETURNING id
    `;
    userA = ua.id;
    const [ub] = await admin`
      INSERT INTO auth.users (tenant_id, full_name, email, password_hash, role)
      VALUES (${tenantB}, 'Socio B', ${'socio-b-' + stamp + '@teste.avren'}, 'x', 'socio')
      RETURNING id
    `;

    ctxA = { tenantId: tenantA, userId: userA, userRole: 'socio' };
    ctxB = { tenantId: tenantB, userId: ub.id, userRole: 'socio' };

    const [ca] = await withRls(sql, ctxA, (tx) => tx`
      INSERT INTO wealth.clients (tenant_id, full_name, banker_id)
      VALUES (${tenantA}, 'Cliente Real A', ${userA}) RETURNING id
    `);
    clientA = ca.id;
    const [cb] = await withRls(sql, ctxB, (tx) => tx`
      INSERT INTO wealth.clients (tenant_id, full_name, banker_id)
      VALUES (${tenantB}, 'Cliente Real B', ${ub.id}) RETURNING id
    `);
    clientB = cb.id;

    sync = new XpSyncService(
      sql,
      httpNever(),
      new XpSyncLock(sql),
    );
    reconciliation = new XpReconciliationService(sql);
  });

  afterAll(async () => {
    if (admin) {
      await admin`DELETE FROM integrations.xp_connections WHERE tenant_id IN (${tenantA}, ${tenantB})`.catch(() => undefined);
      await admin`DELETE FROM wealth.clients WHERE tenant_id IN (${tenantA}, ${tenantB})`.catch(() => undefined);
      await admin`DELETE FROM auth.users WHERE tenant_id IN (${tenantA}, ${tenantB})`.catch(() => undefined);
      await admin`DELETE FROM auth.tenants WHERE id IN (${tenantA}, ${tenantB})`.catch(() => undefined);
      await admin.end({ timeout: 5 });
    }
    if (sql) await sql.end({ timeout: 5 });
  });

  it('dry-run persiste EXATAMENTE conexao + auditoria; nenhuma tabela de dados', async () => {
    const result = await sync.runAsUser(ctxA, { mode: 'fixture', trigger: 'fixture' });

    expect(result.status).toBe('success');
    expect(result.dryRun).toBe(true);
    expect(result.resources.accounts.upserted).toBeGreaterThan(0);
    expect(result.runId).not.toBeNull();

    const counts = await withRls(sql, ctxA, async (tx) => ({
      connections: (await tx`SELECT id FROM integrations.xp_connections`).length,
      runs: (await tx`SELECT id FROM integrations.xp_sync_runs`).length,
      accounts: (await tx`SELECT id FROM integrations.xp_accounts`).length,
      positions: (await tx`SELECT id FROM integrations.xp_positions`).length,
      movements: (await tx`SELECT id FROM integrations.xp_movements`).length,
      commissions: (await tx`SELECT id FROM integrations.xp_commissions`).length,
      products: (await tx`SELECT id FROM integrations.xp_products`).length,
      relations: (await tx`SELECT id FROM integrations.xp_account_advisor_relations`).length,
      positivador: (await tx`SELECT id FROM integrations.xp_positivador`).length,
    }));
    // Contrato exato do requisito 11 (estendido a Etapa B):
    expect(counts).toEqual({
      connections: 1,
      runs: 1,
      accounts: 0,
      positions: 0,
      movements: 0,
      commissions: 0,
      products: 0,
      relations: 0,
      positivador: 0,
    });

    const [run] = await withRls(sql, ctxA, (tx) => tx`
      SELECT dry_run, status, records_upserted FROM integrations.xp_sync_runs
    `);
    expect(run.dryRun).toBe(true);
    expect(Number(run.recordsUpserted)).toBeGreaterThan(0);
  });

  it('RLS: tenant B nao enxerga nada do tenant A', async () => {
    expect(
      (await withRls(sql, ctxB, (tx) => tx`SELECT id FROM integrations.xp_sync_runs`)).length,
    ).toBe(0);

    await withRls(sql, ctxA, async (tx) => {
      const [conn] = await tx`
        INSERT INTO integrations.xp_connections (tenant_id) VALUES (${tenantA})
        ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW() RETURNING id
      `;
      await tx`
        INSERT INTO integrations.xp_accounts
          (tenant_id, connection_id, external_account_id, holder_name)
        VALUES (${tenantA}, ${conn.id}, 'ACC-A-1', 'Titular A')
        ON CONFLICT (tenant_id, external_account_id) DO NOTHING
      `;
    });

    expect(
      (await withRls(sql, ctxB, (tx) => tx`SELECT id FROM integrations.xp_accounts`)).length,
    ).toBe(0);
    expect((await reconciliation.listPending(ctxB)).length).toBe(0);
    expect((await reconciliation.listPending(ctxA)).length).toBe(1);
  });

  it('concorrencia: barreira confirma o lock antes da segunda sync; tenants nao se bloqueiam', async () => {
    // BARREIRA EXPLICITA (requisito 5): so seguimos para a segunda
    // sincronizacao depois que a sessao concorrente CONFIRMOU possuir
    // o lock (resultado true do pg_try_advisory_lock).
    const holder = await (sql as any).reserve();
    let acquired = false;
    try {
      const [row] = await holder`
        SELECT pg_try_advisory_lock(hashtext(${'xp_sync:' + tenantA})) AS locked
      `;
      acquired = Boolean(row?.locked);
      expect(acquired).toBe(true); // barreira: lock confirmado

      const result = await sync.runAsUser(ctxA, { mode: 'fixture', trigger: 'fixture' });
      expect(result.status).toBe('failed');
      expect(result.errorSummary).toMatch(/em andamento/);

      // Tenant B nao e afetado pelo lock do tenant A.
      const resultB = await sync.runAsUser(ctxB, { mode: 'fixture', trigger: 'fixture' });
      expect(resultB.status).toBe('success');
    } finally {
      if (acquired) {
        await holder`SELECT pg_advisory_unlock(hashtext(${'xp_sync:' + tenantA}))`;
      }
      holder.release();
    }

    // Com o lock liberado, o mesmo tenant volta a sincronizar.
    const after = await sync.runAsUser(ctxA, { mode: 'fixture', trigger: 'fixture' });
    expect(after.status).toBe('success');
  });

  it('vinculo: recusa cliente de outro tenant; aceita do mesmo; unlink limpa tudo', async () => {
    const [account] = await withRls(sql, ctxA, (tx) => tx`
      SELECT id FROM integrations.xp_accounts WHERE external_account_id = 'ACC-A-1'
    `);

    await expect(reconciliation.link(ctxA, account.id, clientB)).rejects.toThrow(
      /Cliente nao encontrado/,
    );

    await reconciliation.link(ctxA, account.id, clientA);
    const [linked] = await withRls(sql, ctxA, (tx) => tx`
      SELECT client_id, link_status, linked_by FROM integrations.xp_accounts
      WHERE id = ${account.id}
    `);
    expect(linked.clientId).toBe(clientA);
    expect(linked.linkStatus).toBe('linked');
    expect(linked.linkedBy).toBe(userA);

    await reconciliation.unlink(ctxA, account.id);
    const [unlinked] = await withRls(sql, ctxA, (tx) => tx`
      SELECT client_id, suggested_client_id, link_status, linked_by
      FROM integrations.xp_accounts WHERE id = ${account.id}
    `);
    expect(unlinked.clientId).toBeNull();
    expect(unlinked.suggestedClientId).toBeNull();
    expect(unlinked.linkStatus).toBe('unlinked');
    expect(unlinked.linkedBy).toBeNull();
  });

  it('migration 028: backfill marca linked quem ja tinha client_id', async () => {
    // Simula estado legado: remove os CHECKs, insere conta vinculada
    // com link_status errado, reaplica a 028 e verifica o backfill.
    await admin`ALTER TABLE integrations.xp_accounts DROP CONSTRAINT IF EXISTS xp_accounts_link_coherence_check`;
    await admin`ALTER TABLE integrations.xp_accounts DROP CONSTRAINT IF EXISTS xp_accounts_link_status_check`;

    const [conn] = await admin`
      SELECT id FROM integrations.xp_connections WHERE tenant_id = ${tenantA}
    `;
    await admin`
      INSERT INTO integrations.xp_accounts
        (tenant_id, connection_id, external_account_id, holder_name,
         client_id, link_status)
      VALUES (${tenantA}, ${conn.id}, 'ACC-A-LEGADO', 'Legado',
              ${clientA}, 'unlinked')
    `;

    const { repoMigrations } = migrationsDirs();
    await admin.unsafe(
      fs.readFileSync(path.join(repoMigrations, '028_xp_reconciliation.sql'), 'utf8'),
    );

    const [legacy] = await admin`
      SELECT link_status FROM integrations.xp_accounts
      WHERE external_account_id = 'ACC-A-LEGADO'
    `;
    expect(legacy.linkStatus).toBe('linked');

    await admin`DELETE FROM integrations.xp_accounts WHERE external_account_id = 'ACC-A-LEGADO'`;
  });

  // ── Etapa B: migration 034 ────────────────────────────────────

  it('034: RLS e FORCE RLS ativos nas tres tabelas novas', async () => {
    const flags = await admin`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'integrations'
        AND c.relname IN ('xp_products', 'xp_account_advisor_relations', 'xp_positivador')
      ORDER BY c.relname
    `;
    expect(flags).toHaveLength(3);
    for (const f of flags) {
      expect(f.relrowsecurity).toBe(true);
      expect(f.relforcerowsecurity).toBe(true);
    }
  });

  it('034: duas competencias do mesmo identificador COEXISTEM; upsert atualiza sem apagar historico', async () => {
    const insert = (positionDate: string, net: number) =>
      withRls(sql, ctxA, (tx) => tx`
        INSERT INTO integrations.xp_positivador
          (tenant_id, external_positivador_id, net_capture_in_month, position_date)
        VALUES (${tenantA}, 'POS-HIST-1', ${net}, ${positionDate})
        ON CONFLICT (tenant_id, external_positivador_id, position_date) DO UPDATE SET
          net_capture_in_month = EXCLUDED.net_capture_in_month,
          updated_at = NOW()
      `);

    await insert('2026-06-01', 50000);
    await insert('2026-07-01', 75000);
    // reprocessamento da MESMA competencia: atualiza, nao duplica
    await insert('2026-07-01', 80000);

    const rows = await withRls(sql, ctxA, (tx) => tx`
      SELECT position_date, net_capture_in_month
      FROM integrations.xp_positivador
      WHERE external_positivador_id = 'POS-HIST-1'
      ORDER BY position_date
    `);
    expect(rows).toHaveLength(2);
    const iso = (d: unknown) => new Date(d as any).toISOString().slice(0, 10);
    expect(iso(rows[0].positionDate)).toBe('2026-06-01');
    expect(Number(rows[0].netCaptureInMonth)).toBe(50000);
    expect(iso(rows[1].positionDate)).toBe('2026-07-01');
    expect(Number(rows[1].netCaptureInMonth)).toBe(80000);
  });

  it('034: Positivador primeiro, conta depois => reconciliacao preenche o vinculo; hash igual em OUTRO tenant nao cruza', async () => {
    const HASH = 'a'.repeat(64); // hash sintetico; nunca o numero bruto

    // 1. Positivador chega ANTES da conta (tenant A) e tambem no tenant B
    await withRls(sql, ctxA, (tx) => tx`
      INSERT INTO integrations.xp_positivador
        (tenant_id, external_positivador_id, account_code_hash, position_date)
      VALUES (${tenantA}, 'POS-REC-1', ${HASH}, '2026-07-01')
      ON CONFLICT (tenant_id, external_positivador_id, position_date) DO NOTHING
    `);
    await withRls(sql, ctxB, (tx) => tx`
      INSERT INTO integrations.xp_positivador
        (tenant_id, external_positivador_id, account_code_hash, position_date)
      VALUES (${tenantB}, 'POS-REC-B', ${HASH}, '2026-07-01')
      ON CONFLICT (tenant_id, external_positivador_id, position_date) DO NOTHING
    `);

    // 2. A conta com o mesmo hash existe SOMENTE no tenant A
    const [conn] = await withRls(sql, ctxA, (tx) => tx`
      SELECT id FROM integrations.xp_connections WHERE tenant_id = ${tenantA}
    `);
    await withRls(sql, ctxA, (tx) => tx`
      INSERT INTO integrations.xp_accounts
        (tenant_id, connection_id, external_account_id, account_code_hash)
      VALUES (${tenantA}, ${conn.id}, 'ACC-REC-1', ${HASH})
      ON CONFLICT (tenant_id, external_account_id) DO UPDATE SET
        account_code_hash = EXCLUDED.account_code_hash
    `);

    // 3. Reconciliacao idempotente nos DOIS tenants
    const first = await withRls(sql, ctxA, (tx) =>
      sync.reconcilePendingLinks(tx as any, tenantA),
    );
    expect(first).toBeGreaterThanOrEqual(1);
    const again = await withRls(sql, ctxA, (tx) =>
      sync.reconcilePendingLinks(tx as any, tenantA),
    );
    expect(again).toBe(0); // idempotente: nada pendente na segunda vez
    await withRls(sql, ctxB, (tx) =>
      sync.reconcilePendingLinks(tx as any, tenantB),
    );

    // 4. Tenant A vinculado; tenant B segue PENDENTE apesar do hash igual
    const [linked] = await withRls(sql, ctxA, (tx) => tx`
      SELECT p.account_id, a.external_account_id
      FROM integrations.xp_positivador p
      JOIN integrations.xp_accounts a ON a.id = p.account_id
      WHERE p.external_positivador_id = 'POS-REC-1'
    `);
    expect(linked.externalAccountId).toBe('ACC-REC-1');

    const [pendingB] = await withRls(sql, ctxB, (tx) => tx`
      SELECT account_id FROM integrations.xp_positivador
      WHERE external_positivador_id = 'POS-REC-B'
    `);
    expect(pendingB.accountId).toBeNull();

    // 5. RLS: tenant B nao enxerga o positivador do tenant A
    const crossRead = await withRls(sql, ctxB, (tx) => tx`
      SELECT id FROM integrations.xp_positivador
      WHERE external_positivador_id = 'POS-REC-1'
    `);
    expect(crossRead).toHaveLength(0);
  });

  it('034: relacao conta-assessor preserva historico por reference_date e reconcilia por dimAccountCode', async () => {
    await withRls(sql, ctxA, (tx) => tx`
      INSERT INTO integrations.xp_account_advisor_relations
        (tenant_id, external_relation_id, external_account_id, advisor_code, reference_date)
      VALUES
        (${tenantA}, 'REL-1', 'ACC-REC-1', '2001', '2026-01-02'),
        (${tenantA}, 'REL-1', 'ACC-REC-1', '2002', '2026-06-01')
      ON CONFLICT (tenant_id, external_relation_id, reference_date) DO NOTHING
    `);

    await withRls(sql, ctxA, (tx) =>
      sync.reconcilePendingLinks(tx as any, tenantA),
    );

    const rows = await withRls(sql, ctxA, (tx) => tx`
      SELECT advisor_code, reference_date, account_id
      FROM integrations.xp_account_advisor_relations
      WHERE external_relation_id = 'REL-1'
      ORDER BY reference_date
    `);
    expect(rows).toHaveLength(2); // duas datas do MESMO id coexistem
    expect(rows[0].advisorCode).toBe('2001');
    expect(rows[1].advisorCode).toBe('2002');
    for (const r of rows) expect(r.accountId).not.toBeNull();
  });
});
