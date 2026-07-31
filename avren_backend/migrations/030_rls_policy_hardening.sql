-- Corrige lacunas de isolamento. Deve ser ensaiada em dump restaurado.
-- Não altera atributos de roles, ownership nem FORCE RLS.

-- Estas tabelas já existem em produção, mas não tinham migration no
-- repositório. As definições tornam uma instalação limpa reproduzível sem
-- alterar tabelas existentes.
CREATE TABLE IF NOT EXISTS crm.reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  remind_at DATE NOT NULL,
  notes TEXT,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm.visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  visit_date DATE NOT NULL,
  devolutiva_date DATE,
  tier TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_user_date
  ON crm.reminders (tenant_id, user_id, remind_at);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_user_date
  ON crm.visits (tenant_id, user_id, visit_date DESC);

-- A role existe na aplicação e deve ser aceita pelo banco.
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE auth.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('banker','supervisor','socio','operacoes','admin'));

-- Fila de IA passa a carregar tenant de forma auditável.
ALTER TABLE ai.pending_jobs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES auth.tenants(id),
  ADD COLUMN IF NOT EXISTS tenant_resolution_error TEXT;

WITH resolved AS (
  SELECT
    j.id,
    c.tenant_id AS client_tenant,
    l.tenant_id AS lead_tenant,
    u.tenant_id AS banker_tenant
  FROM ai.pending_jobs j
  JOIN wealth.interactions i ON i.id = j.interaction_id
  LEFT JOIN wealth.clients c ON c.id = i.client_id
  LEFT JOIN crm.leads l ON l.id = i.lead_id
  LEFT JOIN auth.users u ON u.id = i.banker_id
)
UPDATE ai.pending_jobs j
SET
  tenant_id = CASE
    WHEN (r.client_tenant IS NOT NULL AND r.lead_tenant IS NOT NULL
          AND r.client_tenant <> r.lead_tenant)
      OR (r.client_tenant IS NOT NULL AND r.banker_tenant IS NOT NULL
          AND r.client_tenant <> r.banker_tenant)
      OR (r.lead_tenant IS NOT NULL AND r.banker_tenant IS NOT NULL
          AND r.lead_tenant <> r.banker_tenant)
    THEN NULL
    ELSE COALESCE(r.client_tenant, r.lead_tenant, r.banker_tenant)
  END,
  tenant_resolution_error = CASE
    WHEN (r.client_tenant IS NOT NULL AND r.lead_tenant IS NOT NULL
          AND r.client_tenant <> r.lead_tenant)
      OR (r.client_tenant IS NOT NULL AND r.banker_tenant IS NOT NULL
          AND r.client_tenant <> r.banker_tenant)
      OR (r.lead_tenant IS NOT NULL AND r.banker_tenant IS NOT NULL
          AND r.lead_tenant <> r.banker_tenant)
    THEN 'tenant_conflict'
    WHEN COALESCE(r.client_tenant, r.lead_tenant, r.banker_tenant) IS NULL
    THEN 'tenant_unresolved'
    ELSE NULL
  END
FROM resolved r
WHERE r.id = j.id;

CREATE INDEX IF NOT EXISTS idx_ai_pending_jobs_tenant_status
  ON ai.pending_jobs (tenant_id, status, created_at);

CREATE OR REPLACE FUNCTION ai.fn_enqueue_interaction_summary()
RETURNS TRIGGER AS $$
DECLARE
  v_client_tenant UUID;
  v_lead_tenant UUID;
  v_banker_tenant UUID;
  v_tenant UUID;
  v_error TEXT;
BEGIN
  SELECT tenant_id INTO v_client_tenant FROM wealth.clients WHERE id = NEW.client_id;
  SELECT tenant_id INTO v_lead_tenant FROM crm.leads WHERE id = NEW.lead_id;
  SELECT tenant_id INTO v_banker_tenant FROM auth.users WHERE id = NEW.banker_id;

  IF (v_client_tenant IS NOT NULL AND v_lead_tenant IS NOT NULL
      AND v_client_tenant <> v_lead_tenant)
    OR (v_client_tenant IS NOT NULL AND v_banker_tenant IS NOT NULL
        AND v_client_tenant <> v_banker_tenant)
    OR (v_lead_tenant IS NOT NULL AND v_banker_tenant IS NOT NULL
        AND v_lead_tenant <> v_banker_tenant) THEN
    v_error := 'tenant_conflict';
  ELSE
    v_tenant := COALESCE(v_client_tenant, v_lead_tenant, v_banker_tenant);
    IF v_tenant IS NULL THEN v_error := 'tenant_unresolved'; END IF;
  END IF;

  INSERT INTO ai.pending_jobs (interaction_id, tenant_id, tenant_resolution_error)
  VALUES (NEW.id, v_tenant, v_error);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helpers de predicado são evitados para manter cada policy auditável.
ALTER TABLE analytics.revenue_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS revenue_entries_tenant_policy ON analytics.revenue_entries;
CREATE POLICY revenue_entries_tenant_policy ON analytics.revenue_entries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID);

ALTER TABLE auth.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_tenant_policy ON auth.audit_logs;
CREATE POLICY audit_logs_tenant_policy ON auth.audit_logs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID);

ALTER TABLE auth.business_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_units_tenant_policy ON auth.business_units;
CREATE POLICY business_units_tenant_policy ON auth.business_units
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true)
       IN ('socio','operacoes','admin')
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true)
       IN ('socio','operacoes','admin')
  );

ALTER TABLE crm.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.visits ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['push_subscriptions','reminders','visits'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON crm.%I', t || '_tenant_policy', t);
    EXECUTE format(
      'CREATE POLICY %I ON crm.%I USING (
         tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID
       ) WITH CHECK (
         tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID
       )',
      t || '_tenant_policy', t
    );
  END LOOP;
END $$;

ALTER TABLE ai.pending_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_jobs_tenant_policy ON ai.pending_jobs;
CREATE POLICY pending_jobs_tenant_policy ON ai.pending_jobs
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true) = 'system'
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true) = 'system'
  );

DROP POLICY IF EXISTS pending_jobs_enqueue_policy ON ai.pending_jobs;
CREATE POLICY pending_jobs_enqueue_policy ON ai.pending_jobs
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_resolution_error IS NULL
    AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true)
       IN ('banker','supervisor','socio','operacoes','admin')
    AND EXISTS (
      SELECT 1
      FROM wealth.interactions i
      LEFT JOIN wealth.clients c ON c.id = i.client_id
      LEFT JOIN crm.leads l ON l.id = i.lead_id
      WHERE i.id = interaction_id
        AND COALESCE(c.tenant_id, l.tenant_id) = ai.pending_jobs.tenant_id
    )
  );

-- Policies derivadas do cliente/lead.
ALTER TABLE wealth.client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.client_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.kyc ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.suitability ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'client_contacts','client_addresses','family_members',
    'relationships','kyc','suitability'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON wealth.%I', t || '_client_policy', t);
    EXECUTE format(
      'CREATE POLICY %I ON wealth.%I USING (
         EXISTS (SELECT 1 FROM wealth.clients c
           WHERE c.id = client_id
             AND c.tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID)
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM wealth.clients c
           WHERE c.id = client_id
             AND c.tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID)
       )',
      t || '_client_policy', t
    );
  END LOOP;
END $$;

ALTER TABLE wealth.interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interactions_tenant_policy ON wealth.interactions;
CREATE POLICY interactions_tenant_policy ON wealth.interactions
  USING (
    EXISTS (SELECT 1 FROM wealth.clients c WHERE c.id = client_id
      AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID)
    OR EXISTS (SELECT 1 FROM crm.leads l WHERE l.id = lead_id
      AND l.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM wealth.clients c WHERE c.id = client_id
      AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID)
    OR EXISTS (SELECT 1 FROM crm.leads l WHERE l.id = lead_id
      AND l.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID)
  );

ALTER TABLE wealth.asset_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_snapshots_tenant_policy ON wealth.asset_snapshots;
CREATE POLICY asset_snapshots_tenant_policy ON wealth.asset_snapshots
  USING (EXISTS (
    SELECT 1 FROM wealth.assets a JOIN wealth.clients c ON c.id = a.client_id
    WHERE a.id = asset_id
      AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM wealth.assets a JOIN wealth.clients c ON c.id = a.client_id
    WHERE a.id = asset_id
      AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
  ));

-- Corrige policies finais que dependem de role.
DROP POLICY IF EXISTS tenants_admin_policy ON auth.tenants;
CREATE POLICY tenants_admin_policy ON auth.tenants
  USING (current_setting('app.current_user_role', true) IN ('socio','operacoes','admin'));

DROP POLICY IF EXISTS task_policy ON crm.tasks;
DROP POLICY IF EXISTS task_select_policy ON crm.tasks;
DROP POLICY IF EXISTS task_insert_policy ON crm.tasks;
DROP POLICY IF EXISTS task_update_policy ON crm.tasks;
DROP POLICY IF EXISTS task_delete_policy ON crm.tasks;

CREATE POLICY task_select_policy ON crm.tasks
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      assigned_to = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR created_by = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  );

CREATE POLICY task_insert_policy ON crm.tasks
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true)
       IN ('banker','supervisor','socio','operacoes','admin')
    AND (
      current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
      OR created_by =
         NULLIF(current_setting('app.current_user_id', true),'')::UUID
    )
  );

CREATE POLICY task_update_policy ON crm.tasks
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      assigned_to = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR created_by = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true)
       IN ('banker','supervisor','socio','operacoes','admin')
    AND (
      assigned_to = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR created_by = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  );

CREATE POLICY task_delete_policy ON crm.tasks
  FOR DELETE
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      assigned_to = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR created_by = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  );

-- A correção das policies de clients/opportunities/alerts/planejamento,
-- históricos e tabelas derivadas continua abaixo em migration dedicada.
