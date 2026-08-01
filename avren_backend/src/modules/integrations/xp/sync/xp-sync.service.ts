import { Inject, Injectable, Logger } from '@nestjs/common';
import { Sql, TransactionSql } from 'postgres';
import { DATABASE_CLIENT } from '../../../../database/database.provider';
import { SessionContext, withRls } from '../../../../database/rls.helper';
import { withTenantRls } from './xp-rls';
import { XpSyncLock } from './xp-lock';
import { XpApiError, XpHttpClient } from '../client/xp-http.client';
import {
  REPROCESS_TABLE_MAP,
  XP_RESOURCE_PATHS,
  XpDataPage,
  XpReprocessingLogEntry,
  XpResourceKey,
  pageItems,
} from '../resources/xp-resource.types';
import {
  DefaultAccountAdvisorRelationMapper,
  DefaultAccountMapper,
  DefaultCommissionMapper,
  DefaultMovementMapper,
  DefaultPositionMapper,
  DefaultPositivadorMapper,
  DefaultProductMapper,
  FIXTURES,
  XpAccountAdvisorRelationRow,
  XpAccountRow,
  XpCommissionRow,
  XpMapper,
  XpMovementRow,
  XpPositionRow,
  XpPositivadorRow,
  XpProductRow,
} from '../mappers/xp-mappers';

export interface SyncOptions {
  /** fixture: pipeline completo SEM rede; dados revertidos por ROLLBACK. */
  mode: 'fixture' | 'live';
  trigger: 'manual' | 'cron' | 'fixture';
  resources?: XpResourceKey[];
}

export interface SyncRunResult {
  runId: string | null;
  auditPersisted: boolean;
  status: 'success' | 'partial' | 'failed';
  dryRun: boolean;
  resources: Record<
    string,
    { pages: number; received: number; upserted: number; skipped: number }
  >;
  errorSummary: string | null;
}

/**
 * CONTRATO de reprocessamento (requisito 8).
 * O plano e derivado do Reprocessing Log, mas a REBUSCA dos intervalos
 * ainda NAO esta implementada: depende do formato real dos filtros de
 * data da HML. Enquanto houver entradas no plano em modo live, o run
 * termina 'partial' com aviso explicito, nunca fingindo sucesso.
 */
export interface ReprocessPlan {
  entries: Array<{
    /** tableName oficial do Log de Reprocessamento. */
    tableName: string;
    /** Recurso interno mapeado; null quando o tableName e desconhecido. */
    resource: XpResourceKey | null;
    referenceDate: string;
  }>;
}

export function planReprocessing(
  entries: XpReprocessingLogEntry[],
): ReprocessPlan {
  return {
    entries: entries
      .filter((e) => e?.tableName && e?.referenceDate)
      .map((e) => ({
        tableName: e.tableName,
        // Mapa oficial tableName -> recurso interno. Nomes desconhecidos
        // NAO sao adivinhados: ficam sem mapeamento e geram aviso.
        resource: REPROCESS_TABLE_MAP[e.tableName] ?? null,
        referenceDate: e.referenceDate,
      })),
  };
}

const REPROCESS_NOT_IMPLEMENTED =
  'reprocessing_log: rebusca de datas reprocessadas ainda nao implementada (aguardando payload HML); datas registradas no log da aplicacao.';

/** Sinal interno: aborta a transacao do dry-run preservando o resultado. */
class DryRunRollback extends Error {
  constructor(public readonly body: PipelineBody) {
    super('dry-run rollback');
  }
}

type PipelineBody = Omit<SyncRunResult, 'runId' | 'auditPersisted'>;
type RlsWrapper = <T>(fn: (tx: TransactionSql) => Promise<T>) => Promise<T>;

/**
 * Ordem estrutural (Etapa B): dimensoes antes dos fatos, Positivador
 * como ponto final analitico, reconciliacao de vinculos pendentes ao
 * fim (fora desta lista; ver reconcilePendingLinks).
 */
const SYNC_ORDER: XpResourceKey[] = [
  'accounts',
  'account_advisor_relations',
  'products',
  'positions',
  'movements',
  'commissions',
  'positivador',
];

/**
 * Motor de sincronizacao (v3).
 *
 * Estrategia transacional (requisito 6):
 *   - Exclusao mutua por tenant via XpSyncLock (lock de sessao em
 *     conexao reservada): NENHUMA transacao fica aberta durante
 *     chamadas HTTP ou paginacao.
 *   - Modo LIVE: rede fora de transacao; cada pagina e gravada numa
 *     transacao CURTA propria (RLS definido por transacao). Falha SQL
 *     num lote invalida somente aquele lote/recurso, nunca o run.
 *   - Modo FIXTURE (dry-run): sem rede por definicao; roda numa unica
 *     transacao com SAVEPOINT por recurso (falha num recurso nao
 *     envenena a transacao) e termina em ROLLBACK deliberado.
 *
 * Persistencia do dry-run (requisito 11, contrato explicito):
 *   ficam EXATAMENTE dois registros: a linha idempotente de
 *   integrations.xp_connections do tenant e a auditoria em
 *   integrations.xp_sync_runs (dry_run=true). Nenhuma tabela de dados
 *   (accounts/positions/movements/commissions) recebe fixtures.
 *   Ha teste de integracao provando exatamente isso.
 *
 * NOTA v3.1: o databaseProvider real usa transform.column =
 * postgres.toCamel. Toda LEITURA de coluna volta em camelCase
 * (dry_run -> dryRun, records_upserted -> recordsUpserted). Os
 * parametros de INSERT/UPDATE nao sao afetados. As leituras deste
 * arquivo seguem esse contrato.
 */
@Injectable()
export class XpSyncService {
  private readonly logger = new Logger(XpSyncService.name);
  private readonly mappers: Record<string, XpMapper<any, any>>;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly http: XpHttpClient,
    private readonly lock: XpSyncLock,
  ) {
    // Pepper DEDICADO ao vinculo de conta; nunca reutiliza o pepper
    // de documento e nunca e registrado em log.
    const accountPepper = process.env.XP_ACCOUNT_PEPPER ?? '';
    this.mappers = {
      accounts: new DefaultAccountMapper(accountPepper),
      account_advisor_relations: new DefaultAccountAdvisorRelationMapper(),
      products: new DefaultProductMapper(),
      positions: new DefaultPositionMapper(),
      movements: new DefaultMovementMapper(),
      commissions: new DefaultCommissionMapper(),
      positivador: new DefaultPositivadorMapper(accountPepper),
    };
  }

  registerMapper(mapper: XpMapper<any, any>) {
    this.mappers[mapper.resource] = mapper;
  }

  async runAsUser(ctx: SessionContext, opts: SyncOptions): Promise<SyncRunResult> {
    const wrap: RlsWrapper = (fn) => withRls(this.sql, ctx, fn);
    return this.execute(ctx.tenantId, opts, wrap);
  }

  async runAsSystem(tenantId: string, opts: SyncOptions): Promise<SyncRunResult> {
    const wrap: RlsWrapper = (fn) => withTenantRls(this.sql, tenantId, fn);
    return this.execute(tenantId, opts, wrap);
  }

  async listRuns(ctx: SessionContext, limit = 20) {
    return withRls(this.sql, ctx, (tx) => tx`
      SELECT id, resource, status, trigger_source, dry_run,
             records_received, records_upserted,
             error_code, error_message, started_at, finished_at
      FROM integrations.xp_sync_runs
      ORDER BY started_at DESC
      LIMIT ${limit}
    `);
  }

  // ── Nucleo ──────────────────────────────────────────────────

  private async execute(
    tenantId: string,
    opts: SyncOptions,
    inTx: RlsWrapper,
  ): Promise<SyncRunResult> {
    const dryRun = opts.mode === 'fixture';
    const startedAt = new Date();

    const handle = await this.lock.acquire(tenantId);
    if (!handle) {
      const body: PipelineBody = {
        status: 'failed',
        dryRun,
        resources: {},
        errorSummary: 'Ja existe uma sincronizacao em andamento para este tenant.',
      };
      const runId = await this.audit(inTx, tenantId, opts, body, startedAt);
      return { runId, auditPersisted: runId !== null, ...body };
    }

    let body: PipelineBody;
    try {
      if (dryRun) {
        body = await this.runFixturePipeline(inTx, tenantId, opts);
      } else {
        body = await this.runLivePipeline(inTx, tenantId, opts);
      }
    } catch (err: any) {
      const summary =
        err instanceof XpApiError ? err.summary : 'Erro interno na sincronizacao.';
      body = { status: 'failed', dryRun, resources: {}, errorSummary: summary };
    } finally {
      await handle.release();
    }

    const runId = await this.audit(inTx, tenantId, opts, body, startedAt);
    return { runId, auditPersisted: runId !== null, ...body };
  }

  /** Auditoria em transacao propria e curta (unica persistencia do dry-run). */
  private async audit(
    inTx: RlsWrapper,
    tenantId: string,
    opts: SyncOptions,
    body: PipelineBody,
    startedAt: Date,
  ): Promise<string | null> {
    try {
      return await inTx(async (tx) => {
        const connectionId = await this.ensureConnection(tx, tenantId);
        const totals = Object.values(body.resources);
        const [row] = await tx`
          INSERT INTO integrations.xp_sync_runs
            (tenant_id, connection_id, resource, status, trigger_source, dry_run,
             records_received, records_upserted, error_code, error_message,
             started_at, finished_at)
          VALUES (
            ${tenantId}, ${connectionId}, 'full', ${body.status}, ${opts.trigger},
            ${body.dryRun},
            ${totals.reduce((s, r) => s + r.received, 0)},
            ${totals.reduce((s, r) => s + r.upserted, 0)},
            ${body.status === 'success' ? null : 'sync_error'},
            ${body.errorSummary},
            ${startedAt}, NOW()
          )
          RETURNING id
        `;
        return row.id as string;
      });
    } catch (err) {
      this.logger.error('Falha ao registrar auditoria do run XP.');
      return null;
    }
  }

  private async ensureConnection(
    tx: TransactionSql,
    tenantId: string,
  ): Promise<string> {
    const [row] = await tx`
      INSERT INTO integrations.xp_connections (tenant_id)
      VALUES (${tenantId})
      ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    return row.id as string;
  }

  // ── Dry-run: uma transacao, savepoint por recurso, rollback ──

  private async runFixturePipeline(
    inTx: RlsWrapper,
    tenantId: string,
    opts: SyncOptions,
  ): Promise<PipelineBody> {
    try {
      await inTx(async (tx) => {
        const connectionId = await this.ensureConnection(tx, tenantId);
        const body = await this.processResources(
          tenantId,
          opts,
          async (resource, rows, accountMap) => {
            // Savepoint por recurso: falha SQL num recurso reverte so o
            // savepoint e a transacao continua utilizavel (requisito 6).
            await (tx as any).savepoint(async (sp: TransactionSql) => {
              for (const row of rows) {
                await this.upsert(sp, tenantId, connectionId, resource, row, accountMap);
              }
            });
          },
          async (fn) => {
            await (tx as any).savepoint((sp: TransactionSql) => fn(sp));
          },
        );
        throw new DryRunRollback(body);
      });
      // inalcancavel: o rollback sempre lanca
      throw new Error('estado impossivel no dry-run');
    } catch (err: any) {
      if (err instanceof DryRunRollback) return err.body;
      throw err;
    }
  }

  // ── Live: rede fora de transacao, escrita em txs curtas ─────

  private async runLivePipeline(
    inTx: RlsWrapper,
    tenantId: string,
    opts: SyncOptions,
  ): Promise<PipelineBody> {
    // connection resolvida numa tx curta antes de qualquer rede
    const connectionId = await inTx((tx) => this.ensureConnection(tx, tenantId));
    return this.processResources(
      tenantId,
      opts,
      async (resource, rows, accountMap) => {
        // Cada lote em transacao curta e independente.
        await inTx(async (tx) => {
          for (const row of rows) {
            await this.upsert(tx, tenantId, connectionId, resource, row, accountMap);
          }
        });
      },
      async (fn) => {
        await inTx((tx) => fn(tx));
      },
    );
  }

  /**
   * Pipeline comum: reprocessing log primeiro, depois recursos em
   * ordem fixa. writeBatch decide a granularidade transacional.
   */
  private async processResources(
    tenantId: string,
    opts: SyncOptions,
    writeBatch: (
      resource: XpResourceKey,
      rows: any[],
      accountMap: Map<string, string>,
    ) => Promise<void>,
    execInTx: (fn: (tx: TransactionSql) => Promise<void>) => Promise<void>,
  ): Promise<PipelineBody> {
    const dryRun = opts.mode === 'fixture';
    const requested = opts.resources ?? SYNC_ORDER;
    const resources = SYNC_ORDER.filter((r) => requested.includes(r));

    const body: PipelineBody = {
      status: 'success',
      dryRun,
      resources: {},
      errorSummary: null,
    };
    const errors: string[] = [];

    // 1. Reprocessing Log: obrigatorio, antes de qualquer recurso.
    const entries = await this.fetchReprocessingLog(opts.mode);
    const plan = planReprocessing(entries);
    if (plan.entries.length > 0) {
      this.logger.warn(
        `Reprocessing log com ${plan.entries.length} entrada(s): ` +
          plan.entries.map((e) => `${e.resource}@${e.referenceDate}`).join(', '),
      );
      if (opts.mode === 'live') {
        // Contrato exposto, implementacao pendente: nunca anunciar como
        // funcional (requisito 8).
        errors.push(REPROCESS_NOT_IMPLEMENTED);
      }
    }

    // 2. Recursos, isolados entre si.
    const accountMap = new Map<string, string>();
    for (const resource of resources) {
      const mapper = this.mappers[resource];
      let received = 0;
      let upserted = 0;
      let skipped = 0;
      let pages = 0;

      const consume = async (items: any[]) => {
        received += items.length;
        const rows: any[] = [];
        for (const raw of items) {
          const row = mapper.map(raw, tenantId);
          row ? rows.push(row) : skipped++;
        }
        await writeBatch(resource, rows, accountMap);
        // linhas que o banco efetivamente aceitou (marcadas no upsert)
        upserted += countWritten(rows);
      };

      try {
        if (opts.mode === 'fixture') {
          pages = 1;
          await consume([...(FIXTURES as any)[resource]]);
        } else {
          const res = await this.http.paginate<any>(
            XP_RESOURCE_PATHS[resource],
            async (items) => consume(items),
          );
          pages = res.pages;
        }
      } catch (err: any) {
        const summary =
          err instanceof XpApiError ? err.summary : 'Erro interno no recurso.';
        errors.push(`${resource}: ${summary}`);
      }

      body.resources[resource] = { pages, received, upserted, skipped };
    }

    // 3. Reconciliacao dos vinculos pendentes (Etapa B, requisito 10):
    //    idempotente, restrita ao tenant, por (tenant_id,
    //    account_code_hash) e por dimAccountCode. Cobre o caso
    //    "Positivador/relacao primeiro, conta depois".
    try {
      let reconciled = 0;
      await execInTx(async (tx) => {
        reconciled = await this.reconcilePendingLinks(tx, tenantId);
      });
      body.resources['reconciliation'] = {
        pages: 0,
        received: 0,
        upserted: reconciled,
        skipped: 0,
      };
    } catch {
      errors.push('reconciliation: falha ao reconciliar vinculos pendentes.');
    }

    body.status = errors.length === 0 ? 'success' : 'partial';
    body.errorSummary = errors.length ? errors.join(' | ').slice(0, 2000) : null;
    return body;
  }

  /**
   * Preenche vinculos pendentes SEM jamais cruzar tenants:
   *   - xp_positivador.account_id por (tenant_id, account_code_hash);
   *   - xp_account_advisor_relations.account_id por dimAccountCode.
   * Idempotente: so toca linhas com account_id IS NULL.
   * Publico de proposito: executado pelo pipeline e exercitado
   * diretamente pelos testes de banco (Positivador antes da conta).
   */
  async reconcilePendingLinks(
    tx: TransactionSql,
    tenantId: string,
  ): Promise<number> {
    const positivador = await tx`
      UPDATE integrations.xp_positivador p
      SET account_id = a.id, updated_at = NOW()
      FROM integrations.xp_accounts a
      WHERE p.tenant_id = ${tenantId}
        AND a.tenant_id = p.tenant_id
        AND p.account_id IS NULL
        AND p.account_code_hash IS NOT NULL
        AND a.account_code_hash = p.account_code_hash
      RETURNING p.id
    `;
    const relations = await tx`
      UPDATE integrations.xp_account_advisor_relations r
      SET account_id = a.id, updated_at = NOW()
      FROM integrations.xp_accounts a
      WHERE r.tenant_id = ${tenantId}
        AND a.tenant_id = r.tenant_id
        AND r.account_id IS NULL
        AND a.external_account_id = r.external_account_id
      RETURNING r.id
    `;
    return positivador.length + relations.length;
  }

  private async fetchReprocessingLog(
    mode: 'fixture' | 'live',
  ): Promise<XpReprocessingLogEntry[]> {
    if (mode === 'fixture') return [...FIXTURES.reprocessing_log];
    const page = await this.http.request<XpDataPage<XpReprocessingLogEntry>>(
      XP_RESOURCE_PATHS.reprocessing_log,
    );
    return pageItems(page);
  }

  /** Upserts casando as constraints reais da 018 (ver v2, inalterado). */
  private async upsert(
    tx: TransactionSql,
    tenantId: string,
    connectionId: string,
    resource: XpResourceKey,
    row: any,
    accountMap: Map<string, string>,
  ): Promise<void> {
    switch (resource) {
      case 'accounts': {
        const r = row as XpAccountRow;
        const [saved] = await tx`
          INSERT INTO integrations.xp_accounts
            (tenant_id, connection_id, external_account_id, account_number_mask,
             account_code_hash, holder_document_hash, holder_name, advisor_code,
             status, raw_data, synced_at)
          VALUES
            (${tenantId}, ${connectionId}, ${r.external_account_id}, ${r.account_number_mask},
             ${r.account_code_hash}, ${r.holder_document_hash}, ${r.holder_name},
             ${r.advisor_code}, ${r.status},
             ${(tx as any).json(r.raw_data)}, NOW())
          ON CONFLICT (tenant_id, external_account_id) DO UPDATE SET
            connection_id = EXCLUDED.connection_id,
            account_number_mask = EXCLUDED.account_number_mask,
            -- Nunca apaga um hash ja calculado por causa de pepper
            -- ausente num run posterior (rotacao exige ressincronizacao
            -- deliberada; ver XP_DATA_CONTRACT.md).
            account_code_hash = COALESCE(EXCLUDED.account_code_hash,
                                         integrations.xp_accounts.account_code_hash),
            holder_document_hash = EXCLUDED.holder_document_hash,
            holder_name = EXCLUDED.holder_name,
            advisor_code = EXCLUDED.advisor_code,
            status = EXCLUDED.status,
            raw_data = EXCLUDED.raw_data,
            synced_at = NOW(),
            updated_at = NOW()
          RETURNING id
        `;
        accountMap.set(r.external_account_id, saved.id as string);
        markWritten(row);
        return;
      }
      case 'positions': {
        const r = row as XpPositionRow;
        const accountId = await this.resolveAccountId(
          tx, tenantId, r.external_account_id, accountMap,
        );
        if (!accountId) return;
        await tx`
          INSERT INTO integrations.xp_positions
            (tenant_id, account_id, external_position_id, asset_class, product_code,
             product_name, symbol, issuer_name, quantity, unit_price, gross_value,
             net_value, invested_value, currency, maturity_date, as_of_date,
             raw_data, synced_at)
          VALUES
            (${tenantId}, ${accountId}, ${r.external_position_id}, ${r.asset_class},
             ${r.product_code}, ${r.product_name}, ${r.symbol}, ${r.issuer_name},
             ${r.quantity}, ${r.unit_price}, ${r.gross_value}, ${r.net_value},
             ${r.invested_value}, ${r.currency}, ${r.maturity_date}, ${r.as_of_date},
             ${(tx as any).json(r.raw_data)}, NOW())
          ON CONFLICT (account_id, external_position_id, as_of_date) DO UPDATE SET
            asset_class = EXCLUDED.asset_class,
            product_code = EXCLUDED.product_code,
            product_name = EXCLUDED.product_name,
            symbol = EXCLUDED.symbol,
            issuer_name = EXCLUDED.issuer_name,
            quantity = EXCLUDED.quantity,
            unit_price = EXCLUDED.unit_price,
            gross_value = EXCLUDED.gross_value,
            net_value = EXCLUDED.net_value,
            invested_value = EXCLUDED.invested_value,
            currency = EXCLUDED.currency,
            maturity_date = EXCLUDED.maturity_date,
            raw_data = EXCLUDED.raw_data,
            synced_at = NOW()
        `;
        markWritten(row);
        return;
      }
      case 'movements': {
        const r = row as XpMovementRow;
        const accountId = await this.resolveAccountId(
          tx, tenantId, r.external_account_id, accountMap,
        );
        if (!accountId) return;
        const rows = await tx`
          INSERT INTO integrations.xp_movements
            (tenant_id, account_id, external_movement_id, position_external_id,
             movement_type, transaction_type, product_code, product_name,
             amount, quantity, currency, occurred_at, raw_data, synced_at)
          VALUES
            (${tenantId}, ${accountId}, ${r.external_movement_id}, ${r.position_external_id},
             ${r.movement_type}, ${r.transaction_type}, ${r.product_code}, ${r.product_name},
             ${r.amount}, ${r.quantity}, ${r.currency}, ${r.occurred_at},
             ${(tx as any).json(r.raw_data)}, NOW())
          ON CONFLICT (tenant_id, external_movement_id) DO NOTHING
          RETURNING id
        `;
        if (rows.length > 0) markWritten(row);
        return;
      }
      case 'products': {
        const r = row as XpProductRow;
        await tx`
          INSERT INTO integrations.xp_products
            (tenant_id, external_product_id, asset_code, product_name, issuer_name,
             classification_l0, classification_l1, classification_l2,
             classification_l3, classification_l4, classification_l5,
             custody_type, issue_date, due_date, manager_name, strategy,
             yield_description, index_name, deal_type, product_type,
             interest_payment_frequency, current_register, raw_data,
             last_update, available_data, synced_at)
          VALUES
            (${tenantId}, ${r.external_product_id}, ${r.asset_code}, ${r.product_name},
             ${r.issuer_name}, ${r.classification_l0}, ${r.classification_l1},
             ${r.classification_l2}, ${r.classification_l3}, ${r.classification_l4},
             ${r.classification_l5}, ${r.custody_type}, ${r.issue_date}, ${r.due_date},
             ${r.manager_name}, ${r.strategy}, ${r.yield_description}, ${r.index_name},
             ${r.deal_type}, ${r.product_type}, ${r.interest_payment_frequency},
             ${r.current_register}, ${(tx as any).json(r.raw_data)},
             ${r.last_update}, ${r.available_data}, NOW())
          ON CONFLICT (tenant_id, external_product_id) DO UPDATE SET
            asset_code = EXCLUDED.asset_code,
            product_name = EXCLUDED.product_name,
            issuer_name = EXCLUDED.issuer_name,
            classification_l0 = EXCLUDED.classification_l0,
            classification_l1 = EXCLUDED.classification_l1,
            classification_l2 = EXCLUDED.classification_l2,
            classification_l3 = EXCLUDED.classification_l3,
            classification_l4 = EXCLUDED.classification_l4,
            classification_l5 = EXCLUDED.classification_l5,
            custody_type = EXCLUDED.custody_type,
            issue_date = EXCLUDED.issue_date,
            due_date = EXCLUDED.due_date,
            manager_name = EXCLUDED.manager_name,
            strategy = EXCLUDED.strategy,
            yield_description = EXCLUDED.yield_description,
            index_name = EXCLUDED.index_name,
            deal_type = EXCLUDED.deal_type,
            product_type = EXCLUDED.product_type,
            interest_payment_frequency = EXCLUDED.interest_payment_frequency,
            current_register = EXCLUDED.current_register,
            raw_data = EXCLUDED.raw_data,
            last_update = EXCLUDED.last_update,
            available_data = EXCLUDED.available_data,
            synced_at = NOW(),
            updated_at = NOW()
        `;
        markWritten(row);
        return;
      }
      case 'account_advisor_relations': {
        const r = row as XpAccountAdvisorRelationRow;
        const accountId = await this.resolveAccountId(
          tx, tenantId, r.external_account_id, accountMap,
        );
        await tx`
          INSERT INTO integrations.xp_account_advisor_relations
            (tenant_id, external_relation_id, external_account_id, account_id,
             advisor_code, reference_date, start_validity_date, end_validity_date,
             current_register, raw_data, last_update, available_data, synced_at)
          VALUES
            (${tenantId}, ${r.external_relation_id}, ${r.external_account_id},
             ${accountId}, ${r.advisor_code}, ${r.reference_date},
             ${r.start_validity_date}, ${r.end_validity_date}, ${r.current_register},
             ${(tx as any).json(r.raw_data)}, ${r.last_update}, ${r.available_data},
             NOW())
          ON CONFLICT (tenant_id, external_relation_id, reference_date) DO UPDATE SET
            external_account_id = EXCLUDED.external_account_id,
            account_id = COALESCE(EXCLUDED.account_id,
                                  integrations.xp_account_advisor_relations.account_id),
            advisor_code = EXCLUDED.advisor_code,
            start_validity_date = EXCLUDED.start_validity_date,
            end_validity_date = EXCLUDED.end_validity_date,
            current_register = EXCLUDED.current_register,
            raw_data = EXCLUDED.raw_data,
            last_update = EXCLUDED.last_update,
            available_data = EXCLUDED.available_data,
            synced_at = NOW(),
            updated_at = NOW()
        `;
        markWritten(row);
        return;
      }
      case 'positivador': {
        const r = row as XpPositivadorRow;
        // Vinculo por hash na propria ingestao quando a conta ja existe;
        // o caso "Positivador primeiro, conta depois" e coberto pela
        // reconciliacao ao final do pipeline.
        const accountId = r.account_code_hash
          ? await this.resolveAccountIdByHash(tx, tenantId, r.account_code_hash)
          : null;
        await tx`
          INSERT INTO integrations.xp_positivador
            (tenant_id, external_positivador_id, account_code_hash, account_id,
             advisor_code, head_office_code, segment, segment_client, suitability,
             made_second_contribution, status, activated_in_month, churned_in_month,
             operated_stock_exchange, operated_funds, operated_fixed_income,
             financial_applications, revenue_in_month, bovespa_revenue,
             futures_revenue, fixed_income_banking_revenue,
             fixed_income_private_revenue, fixed_income_public_revenue,
             gross_capture_in_month, redemption_in_month, net_capture_in_month,
             ted_capture, st_capture, ota_capture, fixed_income_capture,
             treasury_direct_capture, pension_capture, net_in_m1, net_in_month,
             net_fixed_income, net_real_estate_funds, net_equities, net_funds,
             net_financial, net_pension, net_others, rental_revenue,
             package_complement_revenue, person_type, position_date,
             last_update, available_data, synced_at)
          VALUES
            (${tenantId}, ${r.external_positivador_id}, ${r.account_code_hash},
             ${accountId}, ${r.advisor_code}, ${r.head_office_code}, ${r.segment},
             ${r.segment_client}, ${r.suitability}, ${r.made_second_contribution},
             ${r.status}, ${r.activated_in_month}, ${r.churned_in_month},
             ${r.operated_stock_exchange}, ${r.operated_funds},
             ${r.operated_fixed_income}, ${r.financial_applications},
             ${r.revenue_in_month}, ${r.bovespa_revenue}, ${r.futures_revenue},
             ${r.fixed_income_banking_revenue}, ${r.fixed_income_private_revenue},
             ${r.fixed_income_public_revenue}, ${r.gross_capture_in_month},
             ${r.redemption_in_month}, ${r.net_capture_in_month}, ${r.ted_capture},
             ${r.st_capture}, ${r.ota_capture}, ${r.fixed_income_capture},
             ${r.treasury_direct_capture}, ${r.pension_capture}, ${r.net_in_m1},
             ${r.net_in_month}, ${r.net_fixed_income}, ${r.net_real_estate_funds},
             ${r.net_equities}, ${r.net_funds}, ${r.net_financial}, ${r.net_pension},
             ${r.net_others}, ${r.rental_revenue}, ${r.package_complement_revenue},
             ${r.person_type}, ${r.position_date}, ${r.last_update},
             ${r.available_data}, NOW())
          ON CONFLICT (tenant_id, external_positivador_id, position_date) DO UPDATE SET
            account_code_hash = COALESCE(EXCLUDED.account_code_hash,
                                         integrations.xp_positivador.account_code_hash),
            account_id = COALESCE(EXCLUDED.account_id,
                                  integrations.xp_positivador.account_id),
            advisor_code = EXCLUDED.advisor_code,
            head_office_code = EXCLUDED.head_office_code,
            segment = EXCLUDED.segment,
            segment_client = EXCLUDED.segment_client,
            suitability = EXCLUDED.suitability,
            made_second_contribution = EXCLUDED.made_second_contribution,
            status = EXCLUDED.status,
            activated_in_month = EXCLUDED.activated_in_month,
            churned_in_month = EXCLUDED.churned_in_month,
            operated_stock_exchange = EXCLUDED.operated_stock_exchange,
            operated_funds = EXCLUDED.operated_funds,
            operated_fixed_income = EXCLUDED.operated_fixed_income,
            financial_applications = EXCLUDED.financial_applications,
            revenue_in_month = EXCLUDED.revenue_in_month,
            bovespa_revenue = EXCLUDED.bovespa_revenue,
            futures_revenue = EXCLUDED.futures_revenue,
            fixed_income_banking_revenue = EXCLUDED.fixed_income_banking_revenue,
            fixed_income_private_revenue = EXCLUDED.fixed_income_private_revenue,
            fixed_income_public_revenue = EXCLUDED.fixed_income_public_revenue,
            gross_capture_in_month = EXCLUDED.gross_capture_in_month,
            redemption_in_month = EXCLUDED.redemption_in_month,
            net_capture_in_month = EXCLUDED.net_capture_in_month,
            ted_capture = EXCLUDED.ted_capture,
            st_capture = EXCLUDED.st_capture,
            ota_capture = EXCLUDED.ota_capture,
            fixed_income_capture = EXCLUDED.fixed_income_capture,
            treasury_direct_capture = EXCLUDED.treasury_direct_capture,
            pension_capture = EXCLUDED.pension_capture,
            net_in_m1 = EXCLUDED.net_in_m1,
            net_in_month = EXCLUDED.net_in_month,
            net_fixed_income = EXCLUDED.net_fixed_income,
            net_real_estate_funds = EXCLUDED.net_real_estate_funds,
            net_equities = EXCLUDED.net_equities,
            net_funds = EXCLUDED.net_funds,
            net_financial = EXCLUDED.net_financial,
            net_pension = EXCLUDED.net_pension,
            net_others = EXCLUDED.net_others,
            rental_revenue = EXCLUDED.rental_revenue,
            package_complement_revenue = EXCLUDED.package_complement_revenue,
            person_type = EXCLUDED.person_type,
            last_update = EXCLUDED.last_update,
            available_data = EXCLUDED.available_data,
            synced_at = NOW(),
            updated_at = NOW()
        `;
        markWritten(row);
        return;
      }
      case 'commissions': {
        const r = row as XpCommissionRow;
        const accountId = r.external_account_id
          ? await this.resolveAccountId(tx, tenantId, r.external_account_id, accountMap)
          : null;
        await tx`
          INSERT INTO integrations.xp_commissions
            (tenant_id, account_id, external_commission_id, advisor_code,
             product_code, gross_amount, net_amount, competence_date,
             raw_data, synced_at)
          VALUES
            (${tenantId}, ${accountId}, ${r.external_commission_id}, ${r.advisor_code},
             ${r.product_code}, ${r.gross_amount}, ${r.net_amount}, ${r.competence_date},
             ${(tx as any).json(r.raw_data)}, NOW())
          ON CONFLICT (tenant_id, external_commission_id) DO UPDATE SET
            account_id = EXCLUDED.account_id,
            advisor_code = EXCLUDED.advisor_code,
            product_code = EXCLUDED.product_code,
            gross_amount = EXCLUDED.gross_amount,
            net_amount = EXCLUDED.net_amount,
            competence_date = EXCLUDED.competence_date,
            raw_data = EXCLUDED.raw_data,
            synced_at = NOW()
        `;
        markWritten(row);
        return;
      }
    }
  }

  private async resolveAccountId(
    tx: TransactionSql,
    tenantId: string,
    externalAccountId: string,
    cache: Map<string, string>,
  ): Promise<string | null> {
    const cached = cache.get(externalAccountId);
    if (cached) return cached;
    const [row] = await tx`
      SELECT id FROM integrations.xp_accounts
      WHERE tenant_id = ${tenantId}
        AND external_account_id = ${externalAccountId}
      LIMIT 1
    `;
    if (!row) return null;
    cache.set(externalAccountId, row.id as string);
    return row.id as string;
  }

  /** Vinculo pseudonimizado: nunca usa o numero bruto, nunca cruza tenant. */
  private async resolveAccountIdByHash(
    tx: TransactionSql,
    tenantId: string,
    accountCodeHash: string,
  ): Promise<string | null> {
    const [row] = await tx`
      SELECT id FROM integrations.xp_accounts
      WHERE tenant_id = ${tenantId}
        AND account_code_hash = ${accountCodeHash}
      LIMIT 1
    `;
    return row ? (row.id as string) : null;
  }
}

// ── Contabilidade de escrita por linha (sem estado global) ────
const WRITTEN = Symbol('xp_written');
function markWritten(row: any) {
  row[WRITTEN] = true;
}
function countWritten(rows: any[]) {
  return rows.filter((r) => r[WRITTEN]).length;
}
