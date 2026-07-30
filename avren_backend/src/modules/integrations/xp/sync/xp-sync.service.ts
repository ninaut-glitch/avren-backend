import { Inject, Injectable, Logger } from '@nestjs/common';
import { Sql, TransactionSql } from 'postgres';
import { DATABASE_CLIENT } from '../../../../database/database.provider';
import { SessionContext, withRls } from '../../../../database/rls.helper';
import { withTenantRls } from './xp-rls';
import { XpSyncLock } from './xp-lock';
import { XpApiError, XpHttpClient } from '../client/xp-http.client';
import {
  XP_RESOURCE_PATHS,
  XpReprocessingLogEntry,
  XpResourceKey,
} from '../resources/xp-resource.types';
import {
  DefaultAccountMapper,
  DefaultCommissionMapper,
  DefaultMovementMapper,
  DefaultPositionMapper,
  FIXTURES,
  XpAccountRow,
  XpCommissionRow,
  XpMapper,
  XpMovementRow,
  XpPositionRow,
} from '../mappers/xp-mappers';

export interface SyncOptions {
  /** fixture: pipeline completo SEM rede; dados revertidos por ROLLBACK. */
  mode: 'fixture' | 'live';
  trigger: 'manual' | 'cron' | 'fixture';
  resources?: XpResourceKey[];
}

export interface SyncRunResult {
  runId: string | null;
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
  entries: Array<{ resource: string; referenceDate: string }>;
}

export function planReprocessing(
  entries: XpReprocessingLogEntry[],
): ReprocessPlan {
  return {
    entries: entries
      .filter((e) => e?.resource && e?.referenceDate)
      .map((e) => ({ resource: e.resource, referenceDate: e.referenceDate })),
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

type PipelineBody = Omit<SyncRunResult, 'runId'>;
type RlsWrapper = <T>(fn: (tx: TransactionSql) => Promise<T>) => Promise<T>;

const SYNC_ORDER: XpResourceKey[] = [
  'accounts',
  'positions',
  'movements',
  'commissions',
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
  private readonly mappers: Record<string, XpMapper<any, any>> = {
    accounts: new DefaultAccountMapper(),
    positions: new DefaultPositionMapper(),
    movements: new DefaultMovementMapper(),
    commissions: new DefaultCommissionMapper(),
  };

  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly http: XpHttpClient,
    private readonly lock: XpSyncLock,
  ) {}

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
      return { runId, ...body };
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
    return { runId, ...body };
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

    body.status = errors.length === 0 ? 'success' : 'partial';
    body.errorSummary = errors.length ? errors.join(' | ').slice(0, 2000) : null;
    return body;
  }

  private async fetchReprocessingLog(
    mode: 'fixture' | 'live',
  ): Promise<XpReprocessingLogEntry[]> {
    if (mode === 'fixture') return [...FIXTURES.reprocessing_log];
    const page = await this.http.request<{ value: XpReprocessingLogEntry[] }>(
      XP_RESOURCE_PATHS.reprocessing_log,
    );
    return page.value ?? [];
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
             holder_document_hash, holder_name, advisor_code, status, raw_data, synced_at)
          VALUES
            (${tenantId}, ${connectionId}, ${r.external_account_id}, ${r.account_number_mask},
             ${r.holder_document_hash}, ${r.holder_name}, ${r.advisor_code}, ${r.status},
             ${(tx as any).json(r.raw_data)}, NOW())
          ON CONFLICT (tenant_id, external_account_id) DO UPDATE SET
            connection_id = EXCLUDED.connection_id,
            account_number_mask = EXCLUDED.account_number_mask,
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
          tx, r.external_account_id, accountMap,
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
          tx, r.external_account_id, accountMap,
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
      case 'commissions': {
        const r = row as XpCommissionRow;
        const accountId = r.external_account_id
          ? await this.resolveAccountId(tx, r.external_account_id, accountMap)
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
    externalAccountId: string,
    cache: Map<string, string>,
  ): Promise<string | null> {
    const cached = cache.get(externalAccountId);
    if (cached) return cached;
    const [row] = await tx`
      SELECT id FROM integrations.xp_accounts
      WHERE external_account_id = ${externalAccountId}
      LIMIT 1
    `;
    if (!row) return null;
    cache.set(externalAccountId, row.id as string);
    return row.id as string;
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
