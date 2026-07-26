-- ============================================================
-- 017_lead_archiving.sql
-- Arquivamento reversível de leads
-- ============================================================

ALTER TABLE crm.leads
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_archived
    ON crm.leads (tenant_id, archived_at);

-- A role interna "admin" já é aceita pela aplicação, mas não constava na
-- política original de leads. Recriamos a policy mantendo as regras atuais.
DROP POLICY IF EXISTS lead_policy ON crm.leads;
CREATE POLICY lead_policy ON crm.leads
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes','admin')
        )
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND (
            banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR current_setting('app.current_user_role', true)
               IN ('supervisor','socio','operacoes','admin')
        )
    );
