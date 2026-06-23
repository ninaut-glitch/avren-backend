import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';

@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async getExecutiveDashboard(ctx: SessionContext, month?: string) {
    return withRls(this.sql, ctx, async (tx) => {
      // FIX #1: targetMonth é passado às queries, não ignorado
      // Formato esperado: 'YYYY-MM' → normalizado para primeiro dia do mês
      const billingMonth = month ? `${month}-01` : null

      const [aum] = await tx`
        SELECT
          COALESCE(SUM(aum_avren), 0)        AS aum_total,
          COALESCE(SUM(total_patrimonio), 0) AS patrimonio_total,
          COUNT(*)::int                       AS clientes_ativos
        FROM wealth.aum_summary
        WHERE tenant_id = ${ctx.tenantId}
      `

      const [mrr] = await tx`
        SELECT COALESCE(SUM(monthly_revenue), 0) AS mrr
        FROM analytics.revenue_entries
        WHERE tenant_id   = ${ctx.tenantId}
          AND billing_month = COALESCE(
                ${billingMonth}::date,
                date_trunc('month', NOW())::date
              )
      `

      const [leads] = await tx`
        SELECT
          COUNT(*)::int AS leads_mes,
          COUNT(*) FILTER (
            WHERE stage = 'cliente_ativo'
              AND converted_at >= date_trunc(
                    'month',
                    COALESCE(${billingMonth}::date, NOW()::date)
                  )
          )::int AS conversoes_mes
        FROM crm.leads
        WHERE tenant_id   = ${ctx.tenantId}
          AND created_at >= date_trunc(
                'month',
                COALESCE(${billingMonth}::date, NOW()::date)
              )
      `

      const bankers = await tx`
        SELECT * FROM analytics.banker_performance
        WHERE tenant_id = ${ctx.tenantId}
        ORDER BY aum_total DESC NULLS LAST
      `

      const taxaConversao =
        leads.leadsMes > 0
          ? Number(((leads.conversoesMes / leads.leadsMes) * 100).toFixed(1))
          : 0

      return {
        aum_total:       Number(aum.aumTotal),
        mrr:             Number(mrr.mrr),
        captacao_mes:    Number(aum.aumTotal),
        clientes_ativos: aum.clientesAtivos,
        leads_mes:       leads.leadsMes,
        conversoes_mes:  leads.conversoesMes,
        taxa_conversao:  taxaConversao,
        bankers,
      }
    })
  }

  async getBankerPerformance(ctx: SessionContext) {
    return withRls(this.sql, ctx, async (tx) => {
      return tx`
        SELECT * FROM analytics.banker_performance
        WHERE tenant_id = ${ctx.tenantId}
        ORDER BY aum_total DESC NULLS LAST
      `
    })
  }

  async refreshAumSummary() {
    // CONCURRENTLY não bloqueia leituras durante refresh
    // Requer UNIQUE INDEX em wealth.aum_summary(client_id) — criado em 016_fixes.sql
    await this.sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY wealth.aum_summary
    `
  }
}
