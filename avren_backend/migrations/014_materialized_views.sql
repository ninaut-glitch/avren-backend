-- ============================================================
-- 014_materialized_views.sql
-- Views materializadas para dashboards — sem impactar OLTP
-- Depende de: 001 a 011
-- Refresh: CONCURRENTLY (sem lock) via pg_cron ou endpoint
--   /analytics/aum/refresh → REFRESH MATERIALIZED VIEW CONCURRENTLY
-- ============================================================

-- ── 1. Resumo de captação mensal por banker ───────────────────
-- Alimenta o dashboard de metas e o ranking de bankers
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_captacao_mensal AS
    SELECT
        u.id                                                AS banker_id,
        u.full_name                                         AS banker_name,
        u.tenant_id,
        date_trunc('month', l.converted_at)::DATE          AS mes,
        COUNT(l.id)                                         AS conversoes,
        COALESCE(SUM(l.estimated_aum), 0)                  AS captacao_estimada,
        COALESCE(SUM(r.monthly_revenue), 0)                AS mrr_mes
    FROM auth.users u
    LEFT JOIN crm.leads l
           ON l.banker_id    = u.id
          AND l.stage        = 'cliente_ativo'
          AND l.converted_at IS NOT NULL
    LEFT JOIN analytics.revenue_entries r
           ON r.banker_id     = u.id
          AND date_trunc('month', r.billing_month::TIMESTAMPTZ)
            = date_trunc('month', l.converted_at)
    WHERE u.role      = 'banker'
      AND u.is_active = TRUE
    GROUP BY u.id, u.full_name, u.tenant_id,
             date_trunc('month', l.converted_at)::DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_captacao_banker_mes
    ON analytics.mv_captacao_mensal (banker_id, mes);

CREATE INDEX IF NOT EXISTS idx_mv_captacao_tenant
    ON analytics.mv_captacao_mensal (tenant_id, mes DESC);

-- ── 2. Funil de conversão agregado por tenant ─────────────────
-- Alimenta o gráfico de funil no dashboard executivo
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_funil_conversao AS
    SELECT
        tenant_id,
        stage,
        COUNT(*)                        AS total_leads,
        COALESCE(AVG(
            EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400
        )::NUMERIC(8,1), 0)            AS avg_days_in_stage,
        COALESCE(SUM(estimated_aum), 0) AS aum_potencial
    FROM crm.leads
    WHERE stage <> 'perdido'
    GROUP BY tenant_id, stage;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_funil_tenant_stage
    ON analytics.mv_funil_conversao (tenant_id, stage);

-- ── 3. Distribuição patrimonial por categoria e tenant ────────
-- Alimenta o breakdown de AUM no perfil do cliente e no dashboard
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_patrimonio_por_categoria AS
    SELECT
        c.tenant_id,
        c.banker_id,
        ac.slug                         AS categoria,
        ac.label                        AS categoria_label,
        COUNT(DISTINCT c.id)            AS clientes,
        COALESCE(SUM(a.current_value), 0)           AS total_valor,
        COALESCE(SUM(a.current_value)
            FILTER (WHERE a.is_under_avren), 0)     AS valor_sob_gestao
    FROM wealth.clients c
    JOIN wealth.assets a         ON a.client_id  = c.id
    JOIN wealth.asset_categories ac ON ac.id     = a.category_id
    WHERE c.status = 'ativo'
    GROUP BY c.tenant_id, c.banker_id, ac.slug, ac.label;

CREATE INDEX IF NOT EXISTS idx_mv_patrimonio_tenant
    ON analytics.mv_patrimonio_por_categoria (tenant_id);

CREATE INDEX IF NOT EXISTS idx_mv_patrimonio_banker
    ON analytics.mv_patrimonio_por_categoria (banker_id);

-- ── 4. Alertas de compliance por severidade e banker ─────────
-- Alimenta o painel de compliance sem precisar de JOIN em runtime
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_compliance_resumo AS
    SELECT
        a.tenant_id,
        a.banker_id,
        a.severity,
        a.status,
        COUNT(*)                    AS total,
        MIN(a.due_date)             AS proximo_vencimento
    FROM compliance.alerts a
    GROUP BY a.tenant_id, a.banker_id, a.severity, a.status;

CREATE INDEX IF NOT EXISTS idx_mv_compliance_tenant
    ON analytics.mv_compliance_resumo (tenant_id, status, severity);

-- ── 5. Ranking de oportunidades por tipo e probabilidade ──────
-- Alimenta o pipeline de oportunidades no dashboard do sócio
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_pipeline_oportunidades AS
    SELECT
        o.tenant_id,
        o.banker_id,
        o.type,
        o.status,
        COUNT(*)                        AS total,
        COALESCE(SUM(o.estimated_value), 0)             AS valor_total,
        COALESCE(SUM(
            o.estimated_value * (o.probability / 100.0)
        ), 0)                           AS valor_ponderado,
        AVG(o.probability)::NUMERIC(5,1) AS probabilidade_media
    FROM wealth.opportunities o
    WHERE o.status NOT IN ('won','lost')
    GROUP BY o.tenant_id, o.banker_id, o.type, o.status;

CREATE INDEX IF NOT EXISTS idx_mv_oportunidades_tenant
    ON analytics.mv_pipeline_oportunidades (tenant_id, status);

-- ── Permissões nas novas views ────────────────────────────────
GRANT SELECT ON analytics.mv_captacao_mensal          TO avren_banker, avren_readonly;
GRANT SELECT ON analytics.mv_funil_conversao          TO avren_banker, avren_readonly;
GRANT SELECT ON analytics.mv_patrimonio_por_categoria TO avren_banker, avren_readonly;
GRANT SELECT ON analytics.mv_compliance_resumo        TO avren_banker, avren_readonly;
GRANT SELECT ON analytics.mv_pipeline_oportunidades   TO avren_banker, avren_readonly;
