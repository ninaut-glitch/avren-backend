-- ============================================================
-- 016_fixes.sql
-- Correções pontuais para garantir REFRESH CONCURRENTLY
-- e ON CONFLICT em ai.interaction_summaries
-- Idempotente — seguro rodar mais de uma vez
-- ============================================================

-- FIX #4: UNIQUE INDEX em wealth.aum_summary
-- Sem ele, REFRESH MATERIALIZED VIEW CONCURRENTLY falha com:
-- "ERROR: cannot refresh materialized view concurrently"
CREATE UNIQUE INDEX IF NOT EXISTS idx_aum_summary_client_pk
    ON wealth.aum_summary (client_id);

-- FIX #5: UNIQUE em ai.interaction_summaries(interaction_id)
-- Necessário para ON CONFLICT (interaction_id) no AiService
ALTER TABLE ai.interaction_summaries
    DROP CONSTRAINT IF EXISTS uq_interaction_summaries_interaction;

ALTER TABLE ai.interaction_summaries
    ADD CONSTRAINT uq_interaction_summaries_interaction
    UNIQUE (interaction_id);

-- FIX #4: índice por tenant_id na aum_summary para filtro multi-tenant
-- Garante que queries com WHERE tenant_id = X não façam seq scan
CREATE INDEX IF NOT EXISTS idx_aum_summary_tenant
    ON wealth.aum_summary (tenant_id);

-- Confirmação: banker_performance já filtra por tenant_id via JOIN em auth.users
-- A view em 005_analytics.sql propaga tenant_id corretamente da wealth.aum_summary
-- para o CTE aum_by_banker — sem risco de vazamento entre tenants.
