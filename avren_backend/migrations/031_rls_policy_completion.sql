-- Completa as policies que já existiam, mas não cobriam admin, workers
-- internos ou tabelas cujo tenant é derivado do registro pai.

DROP POLICY IF EXISTS lead_policy ON crm.leads;
CREATE POLICY lead_policy ON crm.leads
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin','system')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin','system')
    )
  );

DROP POLICY IF EXISTS client_policy ON wealth.clients;
CREATE POLICY client_policy ON wealth.clients
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin','system')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin','system')
    )
  );

DROP POLICY IF EXISTS asset_policy ON wealth.assets;
CREATE POLICY asset_policy ON wealth.assets
  USING (
    EXISTS (
      SELECT 1 FROM wealth.clients c
      WHERE c.id = client_id
        AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
        AND (
          c.banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
          OR current_setting('app.current_user_role', true)
             IN ('supervisor','socio','operacoes','admin','system')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM wealth.clients c
      WHERE c.id = client_id
        AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
        AND (
          c.banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
          OR current_setting('app.current_user_role', true)
             IN ('supervisor','socio','operacoes','admin','system')
        )
    )
  );

DROP POLICY IF EXISTS opportunity_policy ON wealth.opportunities;
CREATE POLICY opportunity_policy ON wealth.opportunities
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  );

DROP POLICY IF EXISTS alerts_policy ON compliance.alerts;
CREATE POLICY alerts_policy ON compliance.alerts
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin','system')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin','system')
    )
  );

DROP POLICY IF EXISTS alert_history_policy ON compliance.alert_history;
CREATE POLICY alert_history_policy ON compliance.alert_history
  USING (
    EXISTS (
      SELECT 1 FROM compliance.alerts a
      WHERE a.id = alert_id
        AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM compliance.alerts a
      WHERE a.id = alert_id
        AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  );

DROP POLICY IF EXISTS pending_notif_policy ON compliance.pending_notifications;
CREATE POLICY pending_notif_policy ON compliance.pending_notifications
  USING (
    EXISTS (
      SELECT 1 FROM compliance.alerts a
      WHERE a.id = alert_id
        AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM compliance.alerts a
      WHERE a.id = alert_id
        AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  );

DROP POLICY IF EXISTS ai_summary_policy ON ai.interaction_summaries;
CREATE POLICY ai_summary_policy ON ai.interaction_summaries
  USING (
    EXISTS (
      SELECT 1 FROM wealth.clients c
      WHERE c.id = client_id
        AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
        AND (
          banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
          OR current_setting('app.current_user_role', true)
             IN ('supervisor','socio','operacoes','admin','system')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM wealth.clients c
      WHERE c.id = client_id
        AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
        AND (
          banker_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
          OR current_setting('app.current_user_role', true)
             IN ('supervisor','socio','operacoes','admin','system')
        )
    )
  );

ALTER TABLE crm.lead_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_stage_history_policy ON crm.lead_stage_history;
CREATE POLICY lead_stage_history_policy ON crm.lead_stage_history
  USING (
    EXISTS (
      SELECT 1 FROM crm.leads l
      WHERE l.id = lead_id
        AND l.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM crm.leads l
      WHERE l.id = lead_id
        AND l.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  );

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_user_policy ON auth.sessions;
CREATE POLICY sessions_user_policy ON auth.sessions
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = user_id
        AND u.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = user_id
        AND u.tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    )
  );

DROP POLICY IF EXISTS goal_history_policy ON analytics.goal_history;
CREATE POLICY goal_history_policy ON analytics.goal_history
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true)
       IN ('supervisor','socio','operacoes','admin')
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND current_setting('app.current_user_role', true) IN ('socio','admin')
  );

DROP POLICY IF EXISTS pp_plan_policy ON wealth.patrimonial_plans;
CREATE POLICY pp_plan_policy ON wealth.patrimonial_plans
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      advisor_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID
    AND (
      advisor_id = NULLIF(current_setting('app.current_user_id', true),'')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  );

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pp_versions','pp_family_members','pp_companies','pp_properties',
    'pp_financial_assets','pp_liabilities','pp_insurance','pp_structures'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON wealth.%I', t || '_policy', t);
    EXECUTE format(
      'CREATE POLICY %I ON wealth.%I USING (
         tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID
         AND EXISTS (
           SELECT 1 FROM wealth.patrimonial_plans p
           WHERE p.id = plan_id
             AND p.tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID
             AND (
               p.advisor_id = NULLIF(current_setting(''app.current_user_id'', true),'''')::UUID
               OR current_setting(''app.current_user_role'', true)
                  IN (''supervisor'',''socio'',''operacoes'',''admin'')
             )
         )
       ) WITH CHECK (
         tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID
         AND EXISTS (
           SELECT 1 FROM wealth.patrimonial_plans p
           WHERE p.id = plan_id
             AND p.tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true),'''')::UUID
             AND (
               p.advisor_id = NULLIF(current_setting(''app.current_user_id'', true),'''')::UUID
               OR current_setting(''app.current_user_role'', true)
                  IN (''supervisor'',''socio'',''operacoes'',''admin'')
             )
         )
       )',
      t || '_policy', t
    );
  END LOOP;
END $$;

-- A sincronização de compliance deixa de varrer todos os tenants.
DROP FUNCTION IF EXISTS compliance.fn_sync_kyc_alerts();
CREATE OR REPLACE FUNCTION compliance.fn_sync_kyc_alerts(p_tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF p_tenant_id IS DISTINCT FROM
     NULLIF(current_setting('app.current_tenant_id', true),'')::UUID THEN
    RAISE EXCEPTION 'tenant inválido para sincronização de compliance';
  END IF;

  INSERT INTO compliance.alerts (
    tenant_id, client_id, banker_id,
    alert_type, severity, title, description, due_date
  )
  SELECT
    ka.tenant_id, ka.client_id, ka.banker_id, ka.alert_type,
    CASE ka.alert_type
      WHEN 'kyc_rejeitado' THEN 'critical'
      WHEN 'kyc_expirado' THEN 'critical'
      WHEN 'suitability_expirado' THEN 'high'
      WHEN 'kyc_vencendo' THEN 'high'
      WHEN 'suitability_vencendo' THEN 'medium'
      WHEN 'kyc_nao_iniciado' THEN 'medium'
      ELSE 'low'
    END,
    CASE ka.alert_type
      WHEN 'kyc_rejeitado' THEN 'KYC rejeitado pelo compliance'
      WHEN 'kyc_expirado' THEN 'KYC expirado — renovação obrigatória'
      WHEN 'kyc_vencendo' THEN 'KYC vence nos próximos 30 dias'
      WHEN 'kyc_nao_iniciado' THEN 'KYC não foi iniciado'
      WHEN 'suitability_expirado' THEN 'Suitability expirado — reaplicar questionário'
      WHEN 'suitability_vencendo' THEN 'Suitability vence nos próximos 30 dias'
    END,
    'Cliente: ' || ka.full_name,
    (CURRENT_DATE + INTERVAL '7 days')::DATE
  FROM compliance.kyc_alerts ka
  WHERE ka.tenant_id = p_tenant_id
    AND ka.alert_type <> 'ok'
    AND NOT EXISTS (
      SELECT 1 FROM compliance.alerts a
      WHERE a.tenant_id = p_tenant_id
        AND a.client_id = ka.client_id
        AND a.alert_type = ka.alert_type
        AND a.status NOT IN ('resolved','dismissed')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO compliance.pending_notifications (alert_id, channel)
  SELECT a.id, 'sistema'
  FROM compliance.alerts a
  WHERE a.tenant_id = p_tenant_id
    AND a.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM compliance.pending_notifications pn
      WHERE pn.alert_id = a.id AND pn.status = 'pendente'
    );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, compliance;

REVOKE ALL ON FUNCTION compliance.fn_sync_kyc_alerts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.fn_sync_kyc_alerts(UUID) TO avren_service;

-- Materialized views não suportam RLS. A aplicação acessa somente wrappers
-- com filtro obrigatório de tenant e não recebe SELECT nas fontes globais.
CREATE OR REPLACE VIEW wealth.aum_summary_tenant
WITH (security_barrier = true)
AS
SELECT *
FROM wealth.aum_summary
WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID;

CREATE OR REPLACE VIEW analytics.banker_performance_tenant
WITH (security_barrier = true)
AS
SELECT *
FROM analytics.banker_performance
WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true),'')::UUID;

CREATE OR REPLACE FUNCTION analytics.refresh_aum_summary()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, wealth
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY wealth.aum_summary;
END
$$;

REVOKE ALL ON wealth.aum_summary FROM avren_service;
REVOKE ALL ON analytics.banker_performance FROM avren_service;
REVOKE ALL ON compliance.kyc_alerts FROM avren_service;
REVOKE ALL ON
  analytics.mv_captacao_mensal,
  analytics.mv_funil_conversao,
  analytics.mv_patrimonio_por_categoria,
  analytics.mv_compliance_resumo,
  analytics.mv_pipeline_oportunidades
FROM avren_service;

GRANT SELECT ON wealth.aum_summary_tenant TO avren_service;
GRANT SELECT ON analytics.banker_performance_tenant TO avren_service;
REVOKE ALL ON FUNCTION analytics.refresh_aum_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.refresh_aum_summary() TO avren_service;
