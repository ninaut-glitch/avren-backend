-- ============================================================
-- 005_analytics.sql
-- Receita recorrente, metas por banker e views de performance
-- Depende de: 001, 002, 003, 004
-- ============================================================

-- ── Receita recorrente mensal ─────────────────────────────────
CREATE TABLE analytics.revenue_entries (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID          NOT NULL REFERENCES auth.tenants(id),
    client_id       UUID          NOT NULL REFERENCES wealth.clients(id),
    banker_id       UUID          NOT NULL REFERENCES auth.users(id),
    fee_pct         NUMERIC(5,4),
    aum_at_billing  NUMERIC(18,2),
    monthly_revenue NUMERIC(18,2),
    billing_month   DATE          NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Metas mensais por banker ──────────────────────────────────
CREATE TABLE analytics.banker_goals (
    id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID          NOT NULL REFERENCES auth.tenants(id),
    banker_id        UUID          NOT NULL REFERENCES auth.users(id),
    goal_month       DATE          NOT NULL,
    captacao_goal    NUMERIC(18,2),
    leads_goal       INTEGER,
    conversions_goal INTEGER,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, banker_id, goal_month)
);

-- ── AUM consolidado por cliente (base para dashboards) ───────
-- Criada aqui; índices em 010
CREATE MATERIALIZED VIEW wealth.aum_summary AS
    SELECT
        c.id                                                      AS client_id,
        c.full_name,
        c.tenant_id,
        c.banker_id,
        COALESCE(SUM(a.current_value) FILTER (WHERE a.is_under_avren), 0) AS aum_avren,
        COALESCE(SUM(a.current_value), 0)                                  AS total_patrimonio,
        COUNT(a.id)                                                        AS asset_count
    FROM wealth.clients c
    LEFT JOIN wealth.assets a ON a.client_id = c.id
    WHERE c.status = 'ativo'
    GROUP BY c.id, c.full_name, c.tenant_id, c.banker_id;

-- ── Performance dos bankers ───────────────────────────────────
-- Agrega aum_summary por banker para evitar multiplicação de linhas
CREATE VIEW analytics.banker_performance AS
    WITH aum_by_banker AS (
        SELECT
            banker_id,
            tenant_id,
            SUM(aum_avren)        AS aum_total,
            SUM(total_patrimonio) AS patrimonio_total,
            COUNT(*)              AS clientes_ativos
        FROM wealth.aum_summary
        GROUP BY banker_id, tenant_id
    )
    SELECT
        u.id                               AS banker_id,
        u.tenant_id,
        u.full_name                        AS banker_name,
        COUNT(DISTINCT l.id) FILTER (
            WHERE l.created_at >= date_trunc('month', NOW())
        )                                  AS leads_mes,
        COUNT(DISTINCT l.id) FILTER (
            WHERE l.stage        = 'cliente_ativo'
              AND l.converted_at >= date_trunc('month', NOW())
        )                                  AS conversoes_mes,
        COALESCE(SUM(r.monthly_revenue) FILTER (
            WHERE r.billing_month = date_trunc('month', NOW())::date
        ), 0)                              AS mrr,
        COALESCE(ab.aum_total, 0)          AS aum_total,
        COALESCE(ab.clientes_ativos, 0)    AS clientes_ativos,
        g.captacao_goal,
        ROUND(
            COALESCE(ab.aum_total, 0) / NULLIF(g.captacao_goal, 0) * 100,
        1)                                 AS meta_pct
    FROM auth.users u
    LEFT JOIN crm.leads l
           ON l.banker_id = u.id
    LEFT JOIN analytics.revenue_entries r
           ON r.banker_id = u.id
    LEFT JOIN aum_by_banker ab
           ON ab.banker_id = u.id
    LEFT JOIN analytics.banker_goals g
           ON g.banker_id  = u.id
          AND g.goal_month = date_trunc('month', NOW())::date
    WHERE u.role      = 'banker'
      AND u.is_active = TRUE
    GROUP BY
        u.id, u.tenant_id, u.full_name,
        ab.aum_total, ab.clientes_ativos,
        g.captacao_goal;
