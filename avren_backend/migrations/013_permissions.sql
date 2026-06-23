-- ============================================================
-- 013_permissions.sql
-- GRANT por role de banco — separado do RLS (009)
-- RLS controla QUAIS linhas; GRANT controla QUAIS operações
-- Depende de: 001 a 011
--
-- Roles de banco criados aqui:
--   avren_service   → backend NestJS (bypass RLS via SET ROLE)
--   avren_banker    → session role do banker autenticado
--   avren_readonly  → relatórios, BI, auditoria externa
-- ============================================================

-- ── Criação dos roles (idempotente) ──────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'avren_service') THEN
        CREATE ROLE avren_service NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'avren_banker') THEN
        CREATE ROLE avren_banker NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'avren_readonly') THEN
        CREATE ROLE avren_readonly NOLOGIN;
    END IF;
END $$;

-- ── avren_service: acesso total (backend, migrations, workers) ─
-- Bypassar RLS: SET LOCAL ROLE avren_service antes da query
GRANT USAGE ON SCHEMA auth, crm, wealth, analytics, compliance, ai, community
    TO avren_service;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA
    auth, crm, wealth, analytics, compliance, ai, community
    TO avren_service;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA
    auth, crm, wealth, analytics, compliance, ai, community
    TO avren_service;

-- Garante acesso a tabelas futuras
ALTER DEFAULT PRIVILEGES IN SCHEMA auth, crm, wealth, analytics, compliance, ai, community
    GRANT ALL PRIVILEGES ON TABLES TO avren_service;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth, crm, wealth, analytics, compliance, ai, community
    GRANT ALL PRIVILEGES ON SEQUENCES TO avren_service;

-- ── avren_banker: role de sessão para usuários autenticados ───
-- RLS filtra as linhas; GRANT define as operações permitidas
GRANT USAGE ON SCHEMA crm, wealth, analytics, compliance, ai, community
    TO avren_banker;

-- Leitura geral (RLS restringe por carteira)
GRANT SELECT ON
    crm.leads,
    crm.lead_stage_history,
    crm.tasks,
    wealth.clients,
    wealth.client_contacts,
    wealth.client_addresses,
    wealth.family_members,
    wealth.relationships,
    wealth.kyc,
    wealth.suitability,
    wealth.asset_categories,
    wealth.assets,
    wealth.asset_snapshots,
    wealth.interactions,
    wealth.opportunities,
    wealth.aum_summary,
    analytics.revenue_entries,
    analytics.banker_goals,
    compliance.alerts,
    compliance.alert_history,
    ai.interaction_summaries,
    community.events,
    community.event_participants
    TO avren_banker;

-- Escrita: apenas tabelas de operação do dia a dia
GRANT INSERT, UPDATE ON
    crm.leads,
    crm.tasks,
    wealth.interactions,
    wealth.opportunities
    TO avren_banker;

GRANT INSERT ON
    crm.lead_stage_history,
    ai.pending_jobs
    TO avren_banker;

-- Sequences necessárias para INSERT em tabelas com BIGSERIAL
GRANT USAGE ON SEQUENCE
    crm.lead_stage_history_id_seq,
    auth.audit_logs_id_seq
    TO avren_banker;

-- ── avren_readonly: BI, relatórios, auditoria ─────────────────
GRANT USAGE ON SCHEMA
    crm, wealth, analytics, compliance, ai, community
    TO avren_readonly;

GRANT SELECT ON
    crm.leads,
    crm.lead_stage_history,
    crm.tasks,
    wealth.clients,
    wealth.assets,
    wealth.interactions,
    wealth.opportunities,
    wealth.aum_summary,
    analytics.revenue_entries,
    analytics.banker_goals,
    compliance.alerts,
    compliance.alert_history,
    ai.interaction_summaries
    TO avren_readonly;

-- View de performance (não é tabela — precisa de GRANT separado)
GRANT SELECT ON analytics.banker_performance TO avren_banker, avren_readonly;
GRANT SELECT ON compliance.kyc_alerts        TO avren_banker, avren_readonly, avren_service;

-- ── Revogar acesso público (hardening) ───────────────────────
REVOKE ALL ON SCHEMA auth, crm, wealth, analytics, compliance, ai, community
    FROM PUBLIC;
