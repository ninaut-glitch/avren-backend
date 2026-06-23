-- ============================================================
-- 010_indexes_views_triggers.sql
-- Índices, triggers de utilidade
-- Depende de: 002 a 008 (todas as tabelas e views devem existir)
--             005 (wealth.aum_summary criada lá — indexada aqui)
-- Idempotente:
--   • CREATE INDEX IF NOT EXISTS em todos os índices
--   • DROP TRIGGER IF EXISTS antes de cada CREATE TRIGGER
-- ============================================================

-- ── Função: updated_at automático ────────────────────────────
-- CREATE OR REPLACE é idempotente por definição
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplica o trigger em todas as tabelas com updated_at
-- DROP TRIGGER IF EXISTS + CREATE dentro do EXECUTE garante idempotência
DO $$
DECLARE tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'auth.users',
        'wealth.clients',
        'wealth.kyc',
        'wealth.suitability',
        'wealth.opportunities',
        'crm.leads',
        'crm.tasks'
    ]
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_updated_at ON %s;
             CREATE TRIGGER trg_updated_at
             BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()',
            tbl, tbl
        );
    END LOOP;
END $$;

-- ── Trigger: velocity do pipeline (stage change → history) ───
CREATE OR REPLACE FUNCTION crm.fn_log_stage_change()
RETURNS TRIGGER AS $$
DECLARE
    v_days INTEGER;
BEGIN
    IF OLD.stage IS DISTINCT FROM NEW.stage THEN
        SELECT EXTRACT(DAY FROM (NOW() - MAX(changed_at)))::INTEGER
          INTO v_days
          FROM crm.lead_stage_history
         WHERE lead_id  = OLD.id
           AND to_stage = OLD.stage;

        INSERT INTO crm.lead_stage_history
            (lead_id, from_stage, to_stage, days_in_stage, changed_at)
        VALUES
            (OLD.id, OLD.stage, NEW.stage, COALESCE(v_days, 0), NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_stage_change ON crm.leads;
CREATE TRIGGER trg_lead_stage_change
    BEFORE UPDATE ON crm.leads
    FOR EACH ROW EXECUTE FUNCTION crm.fn_log_stage_change();

-- ── Trigger: histórico de status de alertas ───────────────────
DROP TRIGGER IF EXISTS trg_alert_status ON compliance.alerts;
CREATE TRIGGER trg_alert_status
    BEFORE UPDATE ON compliance.alerts
    FOR EACH ROW EXECUTE FUNCTION compliance.fn_log_alert_status();

-- ── Trigger: fila de IA ao criar interação ────────────────────
DROP TRIGGER IF EXISTS trg_enqueue_ai_summary ON wealth.interactions;
CREATE TRIGGER trg_enqueue_ai_summary
    AFTER INSERT ON wealth.interactions
    FOR EACH ROW EXECUTE FUNCTION ai.fn_enqueue_interaction_summary();

-- ── Índices: auth ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON auth.audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON auth.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON auth.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time   ON auth.audit_logs(created_at DESC);

-- ── Índices: crm.leads ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_tenant  ON crm.leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage   ON crm.leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_banker  ON crm.leads(banker_id);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON crm.leads(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage_hist_lead ON crm.lead_stage_history(lead_id);

-- ── Índices: crm.tasks ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_tenant   ON crm.tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON crm.tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_client   ON crm.tasks(client_id)
    WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON crm.tasks(due_date)
    WHERE status NOT IN ('done','cancelled');

-- ── Índices: wealth.clients ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON wealth.clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_banker ON wealth.clients(banker_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON wealth.clients(status);

-- ── Índices: wealth (tabelas filhas) ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_kyc_client           ON wealth.kyc(client_id);
CREATE INDEX IF NOT EXISTS idx_suitability_client   ON wealth.suitability(client_id);
CREATE INDEX IF NOT EXISTS idx_family_client        ON wealth.family_members(client_id);
CREATE INDEX IF NOT EXISTS idx_relationships_client ON wealth.relationships(client_id);
CREATE INDEX IF NOT EXISTS idx_assets_client        ON wealth.assets(client_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_asset      ON wealth.asset_snapshots(asset_id, snapped_at DESC);

-- ── Índices: wealth.interactions ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_interactions_client ON wealth.interactions(client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_banker ON wealth.interactions(banker_id);

-- ── Índices: wealth.opportunities ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_opportunities_client ON wealth.opportunities(client_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_tenant ON wealth.opportunities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON wealth.opportunities(status)
    WHERE status IN ('open','in_progress');

-- ── Índices: analytics ───────────────────────────────────────
-- wealth.aum_summary criada em 005_analytics.sql
CREATE INDEX IF NOT EXISTS idx_aum_banker ON wealth.aum_summary(banker_id);
CREATE INDEX IF NOT EXISTS idx_aum_tenant ON wealth.aum_summary(tenant_id);

CREATE INDEX IF NOT EXISTS idx_revenue_tenant  ON analytics.revenue_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_revenue_month   ON analytics.revenue_entries(billing_month DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_banker  ON analytics.revenue_entries(banker_id, billing_month DESC);

-- ── Índices: compliance ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_alerts_tenant   ON compliance.alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alerts_client   ON compliance.alerts(client_id);
CREATE INDEX IF NOT EXISTS idx_alerts_banker   ON compliance.alerts(banker_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status   ON compliance.alerts(status)
    WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS idx_alerts_due      ON compliance.alerts(due_date)
    WHERE status NOT IN ('resolved','dismissed');
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON compliance.alerts(severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_hist      ON compliance.alert_history(alert_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_notif   ON compliance.pending_notifications(status, scheduled_at)
    WHERE status = 'pendente';

-- ── Índices: ai ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_summary_interaction ON ai.interaction_summaries(interaction_id);
CREATE INDEX IF NOT EXISTS idx_ai_summary_client      ON ai.interaction_summaries(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_summary_opportunity ON ai.interaction_summaries(opportunity_level)
    WHERE opportunity_level = 'alta';

CREATE INDEX IF NOT EXISTS idx_ai_pending_jobs ON ai.pending_jobs(status, created_at)
    WHERE status IN ('pending','error');

-- ── Índices: community ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_tenant       ON community.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_date         ON community.events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_participants_event  ON community.event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_participants_client ON community.event_participants(client_id);
