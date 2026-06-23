-- ============================================================
-- 009_rls_policies.sql
-- Row Level Security — todas as tabelas e políticas
-- Depende de: 002 a 008 (todas as tabelas devem existir)
--
-- Variáveis de sessão definidas pelo middleware NestJS:
--   SET LOCAL app.current_tenant_id = '<uuid>';
--   SET LOCAL app.current_user_id   = '<uuid>';
--   SET LOCAL app.current_user_role = '<role>';
--
-- NULLIF guarda o cast UUID contra string vazia:
--   NULLIF(current_setting('app.X', true), '')::UUID
-- ============================================================

-- ── Helpers ──────────────────────────────────────────────────
-- Funções inline evitam repetição e centralizam a lógica de sessão

-- ── auth ─────────────────────────────────────────────────────
ALTER TABLE auth.users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.tenants ENABLE ROW LEVEL SECURITY;

-- Usuários enxergam apenas seu próprio tenant
CREATE POLICY users_tenant_policy ON auth.users
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    );

-- Tabela de tenants: somente sócio e operações
CREATE POLICY tenants_admin_policy ON auth.tenants
    USING (
        current_setting('app.current_user_role', true) IN ('socio','operacoes')
    );

-- ── crm.leads ────────────────────────────────────────────────
ALTER TABLE crm.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_policy ON crm.leads
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    );

-- ── crm.tasks ────────────────────────────────────────────────
ALTER TABLE crm.tasks ENABLE ROW LEVEL SECURITY;

-- Banker vê tasks atribuídas a si ou que criou
CREATE POLICY task_policy ON crm.tasks
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            assigned_to = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR created_by = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            assigned_to = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR created_by = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    );

-- ── wealth.clients ───────────────────────────────────────────
ALTER TABLE wealth.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_policy ON wealth.clients
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    );

-- ── wealth.assets ────────────────────────────────────────────
ALTER TABLE wealth.assets ENABLE ROW LEVEL SECURITY;

-- Leitura: banker da carteira ou papéis globais
-- Sem WITH CHECK: ativos são criados/editados pelo backend com service role
CREATE POLICY asset_policy ON wealth.assets
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) IN ('supervisor','socio','operacoes')
        OR EXISTS (
            SELECT 1 FROM wealth.clients c
            WHERE  c.id        = client_id
              AND  c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
              AND  c.banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    );

-- ── wealth.opportunities ─────────────────────────────────────
ALTER TABLE wealth.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY opportunity_policy ON wealth.opportunities
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    );

-- ── compliance.alerts ────────────────────────────────────────
ALTER TABLE compliance.alerts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.alert_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pending_notifications  ENABLE ROW LEVEL SECURITY;

CREATE POLICY alerts_policy ON compliance.alerts
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes')
        )
    );

-- Histórico: FOR SELECT — escrita exclusiva do trigger trg_alert_status
CREATE POLICY alert_history_policy ON compliance.alert_history
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM compliance.alerts a
            WHERE  a.id        = alert_id
              AND  a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
              AND (
                  a.banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
                  OR current_setting('app.current_user_role', true)
                     IN ('supervisor','socio','operacoes')
              )
        )
    );

-- Notificações: operações gerencia o worker; banker vê as suas
CREATE POLICY pending_notif_policy ON compliance.pending_notifications
    USING (
        current_setting('app.current_user_role', true) IN ('supervisor','socio','operacoes')
        OR EXISTS (
            SELECT 1 FROM compliance.alerts a
            WHERE  a.id        = alert_id
              AND  a.banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    )
    WITH CHECK (
        current_setting('app.current_user_role', true) IN ('supervisor','socio','operacoes')
        OR EXISTS (
            SELECT 1 FROM compliance.alerts a
            WHERE  a.id        = alert_id
              AND  a.banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    );

-- ── ai.interaction_summaries ─────────────────────────────────
ALTER TABLE ai.interaction_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_summary_policy ON ai.interaction_summaries
    USING (
        banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        OR current_setting('app.current_user_role', true)
           IN ('supervisor','socio','operacoes')
    )
    WITH CHECK (
        banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        OR current_setting('app.current_user_role', true)
           IN ('supervisor','socio','operacoes')
    );

-- ── community ────────────────────────────────────────────────
ALTER TABLE community.events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.event_participants ENABLE ROW LEVEL SECURITY;

-- Eventos visíveis para todo o tenant
CREATE POLICY events_policy ON community.events
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    );

-- Participantes: acesso via evento pai (tenant verificado no evento)
CREATE POLICY participants_policy ON community.event_participants
    USING (
        EXISTS (
            SELECT 1 FROM community.events e
            WHERE  e.id        = event_id
              AND  e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM community.events e
            WHERE  e.id        = event_id
              AND  e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        )
    );
