import {
  BadRequestException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../../database/database.provider';
import { SessionContext, withRls } from '../../../database/rls.helper';

/**
 * UNICO contrato de leitura da XP para Patrimonio, Metas e
 * Performance. Com XP_INTEGRATION_ENABLED=false devolve vazio com
 * available=false; nenhum modulo consumidor muda ate a ativacao.
 */
@Injectable()
export class XpReadModelService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly config: ConfigService,
  ) {}

  private get available(): boolean {
    return this.config.get('XP_INTEGRATION_ENABLED') === 'true';
  }

  private normalizeMonth(month?: string): string {
    const value = month?.trim();
    if (value) {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
      throw new BadRequestException('month deve usar o formato YYYY-MM.');
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const currentMonth = parts.find((part) => part.type === 'month')?.value;
    return `${year}-${currentMonth}`;
  }

  private emptyOverview(month: string) {
    return {
      available: false,
      month,
      asOfDate: null,
      totals: { aum: 0, netCapture: 0, grossRevenue: 0, netRevenue: 0 },
      accounts: { total: 0, linked: 0, pending: 0, ignored: 0 },
      clients: { activated: 0, churned: 0 },
      allocation: [],
    };
  }

  /**
   * Visao gerencial consolidada. O controller restringe este contrato a
   * supervisor/socio/operacoes/admin. Nenhum dado e buscado com a flag off.
   */
  async getWealthOverview(ctx: SessionContext, requestedMonth?: string) {
    const month = this.normalizeMonth(requestedMonth);
    if (!this.available) return this.emptyOverview(month);

    return withRls(this.sql, ctx, async (tx) => {
      const [positionTotals] = await tx`
        WITH latest AS (
          SELECT account_id, MAX(as_of_date) AS as_of_date
          FROM integrations.xp_positions
          GROUP BY account_id
        )
        SELECT COALESCE(SUM(p.gross_value), 0) AS aum,
               MAX(p.as_of_date) AS as_of_date
        FROM integrations.xp_positions p
        JOIN latest l ON l.account_id = p.account_id
                     AND l.as_of_date = p.as_of_date
        WHERE p.currency = 'BRL'
      `;
      const allocation = await tx`
        WITH latest AS (
          SELECT account_id, MAX(as_of_date) AS as_of_date
          FROM integrations.xp_positions
          GROUP BY account_id
        )
        SELECT COALESCE(NULLIF(p.asset_class, ''), 'Outros') AS asset_class,
               COALESCE(SUM(p.gross_value), 0) AS value
        FROM integrations.xp_positions p
        JOIN latest l ON l.account_id = p.account_id
                     AND l.as_of_date = p.as_of_date
        WHERE p.currency = 'BRL'
        GROUP BY COALESCE(NULLIF(p.asset_class, ''), 'Outros')
        ORDER BY value DESC
      `;
      const [monthly] = await tx`
        SELECT COALESCE(SUM(net_capture_in_month), 0) AS net_capture,
               COUNT(*) FILTER (WHERE activated_in_month IS TRUE)::int AS activated,
               COUNT(*) FILTER (WHERE churned_in_month IS TRUE)::int AS churned
        FROM integrations.xp_positivador
        WHERE to_char(position_date, 'YYYY-MM') = ${month}
      `;
      const [revenue] = await tx`
        SELECT COALESCE(SUM(gross_amount), 0) AS gross,
               COALESCE(SUM(net_amount), 0) AS net
        FROM integrations.xp_commissions
        WHERE to_char(competence_date, 'YYYY-MM') = ${month}
      `;
      const [accounts] = await tx`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE link_status = 'linked')::int AS linked,
               COUNT(*) FILTER (WHERE link_status IN ('unlinked', 'suggested'))::int AS pending,
               COUNT(*) FILTER (WHERE link_status = 'ignored')::int AS ignored
        FROM integrations.xp_accounts
      `;
      const aum = Number(positionTotals?.aum ?? 0);
      return {
        available: true,
        month,
        asOfDate: positionTotals?.asOfDate ?? null,
        totals: {
          aum,
          netCapture: Number(monthly?.netCapture ?? 0),
          grossRevenue: Number(revenue?.gross ?? 0),
          netRevenue: Number(revenue?.net ?? 0),
        },
        accounts: {
          total: Number(accounts?.total ?? 0),
          linked: Number(accounts?.linked ?? 0),
          pending: Number(accounts?.pending ?? 0),
          ignored: Number(accounts?.ignored ?? 0),
        },
        clients: {
          activated: Number(monthly?.activated ?? 0),
          churned: Number(monthly?.churned ?? 0),
        },
        allocation: allocation.map((row: any) => {
          const value = Number(row.value ?? 0);
          return {
            assetClass: row.assetClass,
            value,
            percentage: aum > 0 ? Number(((value / aum) * 100).toFixed(2)) : 0,
          };
        }),
      };
    });
  }

  /**
   * Dossie XP por cliente. A consulta inicial em wealth.clients reaproveita
   * a policy do CRM: banker ve apenas os clientes sob sua responsabilidade.
   */
  async getClientWealth(
    ctx: SessionContext,
    clientId: string,
    requestedMonth?: string,
  ) {
    const month = this.normalizeMonth(requestedMonth);
    return withRls(this.sql, ctx, async (tx) => {
      const [client] = await tx`
        SELECT id, full_name FROM wealth.clients WHERE id = ${clientId}
      `;
      if (!client) throw new NotFoundException('Cliente nao encontrado.');

      const empty = {
        available: false,
        month,
        client: { id: client.id, fullName: client.fullName },
        asOfDate: null,
        summary: { grossValue: 0, netValue: 0, investedValue: 0 },
        monthly: { netCapture: 0, grossRevenue: 0, netRevenue: 0 },
        accounts: [], allocation: [], positions: [], recentMovements: [],
      };
      if (!this.available) return empty;

      const accounts = await tx`
        SELECT id, account_number_mask, status, advisor_code, link_status,
               synced_at
        FROM integrations.xp_accounts
        WHERE client_id = ${clientId} AND link_status = 'linked'
        ORDER BY account_number_mask NULLS LAST
      `;
      const positions = await tx`
        WITH latest AS (
          SELECT p.account_id, MAX(p.as_of_date) AS as_of_date
          FROM integrations.xp_positions p
          JOIN integrations.xp_accounts a ON a.id = p.account_id
          WHERE a.client_id = ${clientId} AND a.link_status = 'linked'
          GROUP BY p.account_id
        )
        SELECT p.account_id, p.as_of_date, p.asset_class, p.product_name,
               p.symbol, p.issuer_name, p.quantity, p.unit_price,
               p.gross_value, p.net_value, p.invested_value, p.currency,
               p.maturity_date
        FROM integrations.xp_positions p
        JOIN latest l ON l.account_id = p.account_id
                     AND l.as_of_date = p.as_of_date
        ORDER BY p.gross_value DESC
      `;
      const movements = await tx`
        SELECT m.occurred_at, m.movement_type, m.transaction_type,
               m.product_name, m.amount, m.currency
        FROM integrations.xp_movements m
        JOIN integrations.xp_accounts a ON a.id = m.account_id
        WHERE a.client_id = ${clientId} AND a.link_status = 'linked'
        ORDER BY m.occurred_at DESC
        LIMIT 20
      `;
      const [monthly] = await tx`
        SELECT COALESCE(SUM(p.net_capture_in_month), 0) AS net_capture
        FROM integrations.xp_positivador p
        JOIN integrations.xp_accounts a ON a.id = p.account_id
        WHERE a.client_id = ${clientId}
          AND to_char(p.position_date, 'YYYY-MM') = ${month}
      `;
      const [revenue] = await tx`
        SELECT COALESCE(SUM(c.gross_amount), 0) AS gross,
               COALESCE(SUM(c.net_amount), 0) AS net
        FROM integrations.xp_commissions c
        JOIN integrations.xp_accounts a ON a.id = c.account_id
        WHERE a.client_id = ${clientId}
          AND to_char(c.competence_date, 'YYYY-MM') = ${month}
      `;

      const brlPositions = positions.filter((row: any) => row.currency === 'BRL');
      const summary = brlPositions.reduce((acc: any, row: any) => ({
        grossValue: acc.grossValue + Number(row.grossValue ?? 0),
        netValue: acc.netValue + Number(row.netValue ?? 0),
        investedValue: acc.investedValue + Number(row.investedValue ?? 0),
      }), { grossValue: 0, netValue: 0, investedValue: 0 });
      const allocationMap = new Map<string, number>();
      for (const row of brlPositions as any[]) {
        const key = row.assetClass || 'Outros';
        allocationMap.set(key, (allocationMap.get(key) ?? 0) + Number(row.grossValue ?? 0));
      }
      return {
        available: true,
        month,
        client: { id: client.id, fullName: client.fullName },
        asOfDate: positions.reduce<string | null>((latest, row: any) =>
          !latest || row.asOfDate > latest ? row.asOfDate : latest, null),
        summary,
        monthly: {
          netCapture: Number(monthly?.netCapture ?? 0),
          grossRevenue: Number(revenue?.gross ?? 0),
          netRevenue: Number(revenue?.net ?? 0),
        },
        accounts,
        allocation: [...allocationMap.entries()].map(([assetClass, value]) => ({
          assetClass,
          value,
          percentage: summary.grossValue > 0
            ? Number(((value / summary.grossValue) * 100).toFixed(2)) : 0,
        })).sort((a, b) => b.value - a.value),
        positions,
        recentMovements: movements,
      };
    });
  }

  async getPositionsForClient(ctx: SessionContext, clientId: string) {
    if (!this.available) return { available: false, positions: [] };
    const positions = await withRls(this.sql, ctx, (tx) => tx`
      SELECT p.as_of_date, p.asset_class, p.product_name, p.symbol,
             p.quantity, p.gross_value, p.net_value, p.currency,
             a.external_account_id, a.account_number_mask
      FROM integrations.xp_positions p
      JOIN integrations.xp_accounts a ON a.id = p.account_id
      WHERE a.client_id = ${clientId}
        AND a.link_status = 'linked'
        AND p.as_of_date = (
          SELECT MAX(p2.as_of_date)
          FROM integrations.xp_positions p2
          WHERE p2.account_id = p.account_id
        )
      ORDER BY p.gross_value DESC
    `);
    return { available: true, positions };
  }

  async getNetNewMoney(ctx: SessionContext, month: string) {
    if (!this.available) return { available: false, net: 0 };
    const [row] = await withRls(this.sql, ctx, (tx) => tx`
      SELECT COALESCE(SUM(m.amount), 0) AS net
      FROM integrations.xp_movements m
      WHERE to_char(m.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = ${month}
    `);
    return { available: true, net: Number(row?.net ?? 0) };
  }

  async getRevenueByMonth(ctx: SessionContext, month: string) {
    if (!this.available) return { available: false, gross: 0, net: 0 };
    const [row] = await withRls(this.sql, ctx, (tx) => tx`
      SELECT COALESCE(SUM(c.gross_amount), 0) AS gross,
             COALESCE(SUM(c.net_amount), 0) AS net
      FROM integrations.xp_commissions c
      WHERE to_char(c.competence_date, 'YYYY-MM') = ${month}
    `);
    return {
      available: true,
      gross: Number(row?.gross ?? 0),
      net: Number(row?.net ?? 0),
    };
  }
}
