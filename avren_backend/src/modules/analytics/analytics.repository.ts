import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';

function getPeriodDates(period?: string): { dateFrom: Date; dateTo: Date } {
  const now = new Date()
  const dateTo = new Date(now)

  if (period === 'semana') {
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const dateFrom = new Date(now)
    dateFrom.setDate(diff)
    dateFrom.setHours(0, 0, 0, 0)
    return { dateFrom, dateTo }
  }

  if (period === 'mes_anterior') {
    const dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const dateTo2  = new Date(now.getFullYear(), now.getMonth(), 1)
    return { dateFrom, dateTo: dateTo2 }
  }

  // mes_atual (default)
  const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1)
  return { dateFrom, dateTo }
}

@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async getExecutiveDashboard(ctx: SessionContext, month?: string, period?: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const billingMonth = month ? `${month}-01` : null
      const { dateFrom, dateTo } = getPeriodDates(period)

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
        WHERE tenant_id  = ${ctx.tenantId}
          AND created_at >= date_trunc(
                'month',
                COALESCE(${billingMonth}::date, NOW()::date)
              )
      `

      const [pipeline] = await tx`
        SELECT
          COUNT(*)::int                   AS leads_cadastrados,
          COALESCE(SUM(estimated_aum), 0) AS potencial_captacao
        FROM crm.leads
        WHERE tenant_id = ${ctx.tenantId}
          AND stage     != 'cliente_ativo'
      `

      const [contatos] = await tx`
        SELECT COUNT(*)::int AS contatos_registrados
        FROM wealth.interactions i
        JOIN crm.leads l ON l.id = i.lead_id
        WHERE l.tenant_id = ${ctx.tenantId}
      `

      const [periodo] = await tx`
        SELECT
          COUNT(DISTINCT l.id)::int AS leads_periodo,
          COUNT(DISTINCT i.id)::int AS contatos_periodo
        FROM crm.leads l
        LEFT JOIN wealth.interactions i
          ON i.lead_id = l.id
          AND i.occurred_at >= ${dateFrom.toISOString()}::timestamptz
          AND i.occurred_at <= ${dateTo.toISOString()}::timestamptz
        WHERE l.tenant_id  = ${ctx.tenantId}
          AND l.created_at >= ${dateFrom.toISOString()}::timestamptz
          AND l.created_at <= ${dateTo.toISOString()}::timestamptz
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
        aum_total:            Number(aum.aumTotal),
        mrr:                  Number(mrr.mrr),
        captacao_mes:         Number(aum.aumTotal),
        clientes_ativos:      aum.clientesAtivos,
        leads_mes:            leads.leadsMes,
        conversoes_mes:       leads.conversoesMes,
        taxa_conversao:       taxaConversao,
        leads_cadastrados:    pipeline.leadsCadastrados,
        potencial_captacao:   Number(pipeline.potencialCaptacao),
        contatos_registrados: contatos.contatosRegistrados,
        leads_periodo:        periodo.leadsPeriodo,
        contatos_periodo:     periodo.contatosPeriodo,
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
    await this.sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY wealth.aum_summary
    `
  }
}
