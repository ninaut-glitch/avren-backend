import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import {
  CreatePipeDreamDto, UpdatePipeDreamDto, UpsertGoalDto,
} from './dto/performance.dto';

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

  private getMonthBounds(month?: string) {
    const base = month && /^\d{4}-\d{2}$/.test(month)
      ? new Date(`${month}-01T12:00:00`)
      : new Date()
    const start = new Date(base.getFullYear(), base.getMonth(), 1)
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1)
    return { start, end }
  }

  private businessDays(start: Date, end: Date, excluded: string[] = []) {
    const excludedSet = new Set(excluded)
    let total = 0
    for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10)
      if (d.getDay() !== 0 && d.getDay() !== 6 && !excludedSet.has(iso)) total++
    }
    return total
  }

  private toSnakeCaseRecord(row: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    )
  }

  async getTeamPerformance(ctx: SessionContext, month?: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const { start, end } = this.getMonthBounds(month)
      const participants = await tx`
        SELECT
          u.id, u.full_name, u.role,
          g.id AS goal_id, g.captacao_goal, g.revenue_goal, g.visits_goal,
          COALESCE(g.pipeline_multiplier, 3) AS pipeline_multiplier,
          COALESCE(g.visit_to_hot_rate, 50) AS visit_to_hot_rate,
          g.average_ticket, COALESCE(g.excluded_dates, '{}') AS excluded_dates,
          COALESCE(g.status, 'draft') AS goal_status,
          COALESCE(op.pipeline_total, 0) AS pipeline_total,
          COALESCE(op.pipeline_hot, 0) AS pipeline_hot,
          COALESCE(op.pipeline_weighted, 0) AS pipeline_weighted,
          COALESCE(op.hot_count, 0)::int AS hot_count,
          COALESCE(op.won_capture, 0) AS captured,
          COALESCE(op.projected_monthly_revenue, 0) AS projected_monthly_revenue,
          COALESCE(op.projected_one_time_revenue, 0) AS projected_one_time_revenue,
          COALESCE(rv.monthly_revenue, 0) AS monthly_revenue,
          COALESCE(v.visits_done, 0)::int AS visits_done,
          COALESCE(pd.pipe_dream_count, 0)::int AS pipe_dream_count,
          COALESCE(pd.pipe_dream_potential, 0) AS pipe_dream_potential
        FROM auth.users u
        LEFT JOIN analytics.banker_goals g
          ON g.banker_id = u.id AND g.goal_month = ${start.toISOString().slice(0, 10)}::date
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(o.estimated_value) FILTER (WHERE o.status IN ('open','in_progress')), 0) AS pipeline_total,
            COALESCE(SUM(o.estimated_value) FILTER (
              WHERE o.status IN ('open','in_progress') AND COALESCE(o.probability, 0) >= 60
            ), 0) AS pipeline_hot,
            COALESCE(SUM(o.estimated_value * COALESCE(o.probability, 0) / 100)
              FILTER (WHERE o.status IN ('open','in_progress')), 0) AS pipeline_weighted,
            COUNT(*) FILTER (
              WHERE o.status IN ('open','in_progress') AND COALESCE(o.probability, 0) >= 60
            ) AS hot_count,
            COALESCE(SUM(o.estimated_value) FILTER (
              WHERE o.status = 'won' AND o.updated_at >= ${start.toISOString()}::timestamptz
                AND o.updated_at < ${end.toISOString()}::timestamptz
            ), 0) AS won_capture
            ,COALESCE(SUM(o.estimated_monthly_revenue * COALESCE(o.probability, 0) / 100)
              FILTER (WHERE o.status IN ('open','in_progress')), 0) AS projected_monthly_revenue
            ,COALESCE(SUM(o.estimated_one_time_revenue * COALESCE(o.probability, 0) / 100)
              FILTER (WHERE o.status IN ('open','in_progress')), 0) AS projected_one_time_revenue
          FROM wealth.opportunities o
          WHERE o.tenant_id = ${ctx.tenantId} AND o.banker_id = u.id
        ) op ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(r.monthly_revenue), 0) AS monthly_revenue
          FROM analytics.revenue_entries r
          WHERE r.tenant_id = ${ctx.tenantId} AND r.banker_id = u.id
            AND r.billing_month = ${start.toISOString().slice(0, 10)}::date
        ) rv ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS visits_done
          FROM wealth.interactions i
          WHERE i.banker_id = u.id AND i.type = 'reuniao'
            AND i.occurred_at >= ${start.toISOString()}::timestamptz
            AND i.occurred_at < ${end.toISOString()}::timestamptz
        ) v ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS pipe_dream_count,
                 COALESCE(SUM(p.potential_capture), 0) AS pipe_dream_potential
          FROM crm.pipe_dreams p
          WHERE p.tenant_id = ${ctx.tenantId} AND p.owner_id = u.id
            AND p.converted_at IS NULL
        ) pd ON TRUE
        WHERE u.tenant_id = ${ctx.tenantId}
          AND u.is_active = TRUE
          AND u.role IN ('banker','socio','supervisor')
          AND (
            ${ctx.userRole} != 'banker'
            OR u.id = ${ctx.userId}
          )
        ORDER BY u.full_name
      `

      const pipeDreams = await tx`
        SELECT p.*, u.full_name AS owner_name
        FROM crm.pipe_dreams p
        JOIN auth.users u ON u.id = p.owner_id
        WHERE p.tenant_id = ${ctx.tenantId}
          AND p.converted_at IS NULL
          ${ctx.userRole === 'banker' ? tx`AND p.owner_id = ${ctx.userId}` : tx``}
        ORDER BY p.potential_capture DESC NULLS LAST, p.created_at DESC
      `

      const hotOpportunities = await tx`
        SELECT *
        FROM (
          SELECT
            o.id, o.banker_id, o.type, o.title, o.estimated_value,
            o.probability, o.expected_close_date, o.status,
            COALESCE(c.full_name, l.full_name) AS subject_name,
            ROW_NUMBER() OVER (
              PARTITION BY o.banker_id
              ORDER BY o.estimated_value DESC NULLS LAST, o.probability DESC
            ) AS priority_rank
          FROM wealth.opportunities o
          LEFT JOIN wealth.clients c ON c.id = o.client_id
          LEFT JOIN crm.leads l ON l.id = o.lead_id
          WHERE o.tenant_id = ${ctx.tenantId}
            AND o.status IN ('open','in_progress')
            AND COALESCE(o.probability, 0) >= 60
            ${ctx.userRole === 'banker' ? tx`AND o.banker_id = ${ctx.userId}` : tx``}
        ) ranked
        WHERE priority_rank <= 10
        ORDER BY banker_id, priority_rank
      `
      const pipelineCandidates = await tx`
        SELECT o.id, o.banker_id, o.title, o.type, o.estimated_value,
               COALESCE(c.full_name, l.full_name) AS subject_name
        FROM wealth.opportunities o
        LEFT JOIN wealth.clients c ON c.id = o.client_id
        LEFT JOIN crm.leads l ON l.id = o.lead_id
        LEFT JOIN crm.pipe_dreams p
          ON p.opportunity_id = o.id AND p.converted_at IS NULL
        WHERE o.tenant_id = ${ctx.tenantId}
          AND o.status IN ('open','in_progress','on_hold')
          AND p.id IS NULL
          ${ctx.userRole === 'banker' ? tx`AND o.banker_id = ${ctx.userId}` : tx``}
        ORDER BY o.estimated_value DESC NULLS LAST
        LIMIT 200
      `
      const revenueSources = await tx`
        SELECT o.banker_id, o.type AS source,
          COALESCE(SUM(o.estimated_monthly_revenue * COALESCE(o.probability, 0) / 100), 0)
            AS projected_monthly_revenue,
          COALESCE(SUM(o.estimated_one_time_revenue * COALESCE(o.probability, 0) / 100), 0)
            AS projected_one_time_revenue
        FROM wealth.opportunities o
        WHERE o.tenant_id = ${ctx.tenantId}
          AND o.status IN ('open','in_progress')
          ${ctx.userRole === 'banker' ? tx`AND o.banker_id = ${ctx.userId}` : tx``}
        GROUP BY o.banker_id, o.type
        ORDER BY projected_monthly_revenue DESC, projected_one_time_revenue DESC
      `

      const today = new Date()
      return {
        month: start.toISOString().slice(0, 7),
        participants: participants.map((p: any) => {
          const excluded = p.excludedDates ?? []
          const totalBusinessDays = this.businessDays(start, end, excluded)
          const elapsedEnd = today < start ? start : today > end ? end : today
          const elapsedBusinessDays = this.businessDays(start, elapsedEnd, excluded)
          const remainingBusinessDays = Math.max(totalBusinessDays - elapsedBusinessDays, 0)
          const captureGoal = Number(p.captacaoGoal ?? 0)
          const multiplier = Number(p.pipelineMultiplier ?? 3)
          const pipelineTarget = captureGoal * multiplier
          const averageTicket = Number(p.averageTicket ?? 0)
            || (Number(p.hotCount) > 0 ? Number(p.pipelineHot) / Number(p.hotCount) : 1_000_000)
          const visitsGoal = Number(p.visitsGoal ?? 0)
            || Math.ceil((pipelineTarget / Math.max(averageTicket, 1)) / (Number(p.visitToHotRate) / 100))
          return {
            ...this.toSnakeCaseRecord(p),
            total_business_days: totalBusinessDays,
            elapsed_business_days: elapsedBusinessDays,
            remaining_business_days: remainingBusinessDays,
            pipeline_target: pipelineTarget,
            calculated_visits_goal: visitsGoal,
            visits_per_remaining_day: remainingBusinessDays > 0
              ? Math.max(visitsGoal - Number(p.visitsDone), 0) / remainingBusinessDays
              : 0,
          }
        }),
        pipe_dreams: pipeDreams.map((row: any) => this.toSnakeCaseRecord(row)),
        hot_opportunities: hotOpportunities.map((row: any) => this.toSnakeCaseRecord(row)),
        pipeline_candidates: pipelineCandidates.map((row: any) => this.toSnakeCaseRecord(row)),
        revenue_sources: revenueSources.map((row: any) => this.toSnakeCaseRecord(row)),
      }
    })
  }

  async upsertGoal(ctx: SessionContext, participantId: string, dto: UpsertGoalDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const month = `${dto.goal_month.slice(0, 7)}-01`
      const [previous] = await tx`
        SELECT * FROM analytics.banker_goals
        WHERE tenant_id = ${ctx.tenantId}
          AND banker_id = ${participantId}
          AND goal_month = ${month}::date
      `
      const [goal] = await tx`
        INSERT INTO analytics.banker_goals (
          tenant_id, banker_id, goal_month, captacao_goal, revenue_goal,
          visits_goal, pipeline_multiplier, visit_to_hot_rate, average_ticket,
          excluded_dates, status, published_at, published_by
        ) VALUES (
          ${ctx.tenantId}, ${participantId}, ${month}::date,
          ${dto.captacao_goal ?? null}, ${dto.revenue_goal ?? null},
          ${dto.visits_goal ?? null}, ${dto.pipeline_multiplier ?? 3},
          ${dto.visit_to_hot_rate ?? 50}, ${dto.average_ticket ?? null},
          ${dto.excluded_dates ?? []}::date[], ${dto.status ?? 'draft'},
          ${dto.status === 'published' ? new Date().toISOString() : null}::timestamptz,
          ${dto.status === 'published' ? ctx.userId : null}::uuid
        )
        ON CONFLICT (tenant_id, banker_id, goal_month) DO UPDATE SET
          captacao_goal = EXCLUDED.captacao_goal,
          revenue_goal = EXCLUDED.revenue_goal,
          visits_goal = EXCLUDED.visits_goal,
          pipeline_multiplier = EXCLUDED.pipeline_multiplier,
          visit_to_hot_rate = EXCLUDED.visit_to_hot_rate,
          average_ticket = EXCLUDED.average_ticket,
          excluded_dates = EXCLUDED.excluded_dates,
          status = EXCLUDED.status,
          published_at = CASE WHEN EXCLUDED.status = 'published' THEN NOW() ELSE analytics.banker_goals.published_at END,
          published_by = CASE WHEN EXCLUDED.status = 'published' THEN ${ctx.userId} ELSE analytics.banker_goals.published_by END,
          updated_at = NOW()
        RETURNING *
      `
      await tx`
        INSERT INTO analytics.goal_history (
          tenant_id, goal_id, changed_by, previous_values, new_values, reason
        ) VALUES (
          ${ctx.tenantId}, ${goal.id}, ${ctx.userId},
          ${previous ? JSON.stringify(previous) : null}::jsonb,
          ${JSON.stringify(goal)}::jsonb, ${dto.reason ?? null}
        )
      `
      return goal
    })
  }

  async createPipeDream(ctx: SessionContext, dto: CreatePipeDreamDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const ownerId = ctx.userRole === 'banker' ? ctx.userId : dto.owner_id
      const [row] = await tx`
        INSERT INTO crm.pipe_dreams (
          tenant_id, owner_id, lead_id, opportunity_id, prospect_name,
          estimated_wealth, potential_capture, access_path, strategic_reason,
          next_action, next_action_date, maturity, notes
        ) VALUES (
          ${ctx.tenantId}, ${ownerId}, ${dto.lead_id ?? null}, ${dto.opportunity_id ?? null},
          ${dto.prospect_name}, ${dto.estimated_wealth ?? null}, ${dto.potential_capture ?? null},
          ${dto.access_path ?? null}, ${dto.strategic_reason ?? null},
          ${dto.next_action ?? null}, ${dto.next_action_date ?? null}::date,
          ${dto.maturity ?? 'idea'}, ${dto.notes ?? null}
        ) RETURNING *
      `
      if (dto.opportunity_id) {
        await tx`
          UPDATE wealth.opportunities
          SET status = 'on_hold', updated_at = NOW()
          WHERE id = ${dto.opportunity_id}
            AND tenant_id = ${ctx.tenantId}
        `
      }
      return row
    })
  }

  async updatePipeDream(ctx: SessionContext, id: string, dto: UpdatePipeDreamDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        UPDATE crm.pipe_dreams SET
          prospect_name = COALESCE(${dto.prospect_name ?? null}, prospect_name),
          estimated_wealth = COALESCE(${dto.estimated_wealth ?? null}, estimated_wealth),
          potential_capture = COALESCE(${dto.potential_capture ?? null}, potential_capture),
          access_path = COALESCE(${dto.access_path ?? null}, access_path),
          strategic_reason = COALESCE(${dto.strategic_reason ?? null}, strategic_reason),
          next_action = COALESCE(${dto.next_action ?? null}, next_action),
          next_action_date = COALESCE(${dto.next_action_date ?? null}::date, next_action_date),
          maturity = COALESCE(${dto.maturity ?? null}, maturity),
          notes = COALESCE(${dto.notes ?? null}, notes),
          converted_at = CASE WHEN ${dto.maturity ?? null} = 'qualified' THEN NOW() ELSE converted_at END,
          updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        RETURNING *
      `
      if (row?.opportunityId && dto.maturity === 'qualified') {
        await tx`
          UPDATE wealth.opportunities
          SET status = 'open', updated_at = NOW()
          WHERE id = ${row.opportunityId}
            AND tenant_id = ${ctx.tenantId}
        `
      }
      return row ?? null
    })
  }

  async refreshAumSummary() {
    await this.sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY wealth.aum_summary
    `
  }
}
