\pset pager off

-- Consulta somente leitura. O bloco final deve retornar zero linhas.
SELECT
  rolname,
  rolsuper,
  rolbypassrls,
  rolcreatedb,
  rolcreaterole,
  rolcanlogin
FROM pg_roles
WHERE rolname IN ('avren_service', 'avren_owner')
ORDER BY rolname;

SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
  AND c.relkind = 'r'
ORDER BY n.nspname, c.relname;

SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
ORDER BY schemaname, tablename, policyname;

-- Falhas críticas: esperado zero linhas.
SELECT 'dangerous_app_role' AS finding, rolname AS object
FROM pg_roles
WHERE rolname = 'avren_service'
  AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
UNION ALL
SELECT 'login_owner_role', rolname
FROM pg_roles
WHERE rolname = 'avren_owner' AND rolcanlogin
UNION ALL
SELECT 'application_schema_wrong_owner', nspname
FROM pg_namespace
WHERE nspname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
  AND pg_get_userbyid(nspowner) <> 'avren_owner'
UNION ALL
SELECT 'application_object_wrong_owner', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
  AND c.relkind IN ('r','v','m','S')
  AND pg_get_userbyid(c.relowner) <> 'avren_owner'
UNION ALL
SELECT 'definer_function_wrong_owner', n.nspname || '.' || p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname IN ('auth','analytics')
  AND pg_get_userbyid(p.proowner) <> 'avren_owner'
UNION ALL
SELECT 'required_function_not_executable', required.signature
FROM (VALUES
  ('auth.find_user_for_login(text)'),
  ('auth.list_active_tenant_ids()'),
  ('auth.create_session(uuid,text,inet,text,timestamp with time zone)'),
  ('auth.revoke_session(text)'),
  ('auth.is_session_active(text)'),
  ('analytics.refresh_aum_summary()'),
  ('compliance.fn_sync_kyc_alerts(uuid)')
) AS required(signature)
WHERE NOT has_function_privilege(
  'avren_service',
  to_regprocedure(required.signature),
  'EXECUTE'
)
UNION ALL
SELECT 'global_view_visible_to_app', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname || '.' || c.relname) = ANY (ARRAY[
  'wealth.aum_summary','analytics.banker_performance',
  'compliance.kyc_alerts','analytics.mv_captacao_mensal',
  'analytics.mv_funil_conversao','analytics.mv_patrimonio_por_categoria',
  'analytics.mv_compliance_resumo','analytics.mv_pipeline_oportunidades'
])
  AND has_table_privilege('avren_service', c.oid, 'SELECT')
UNION ALL
SELECT 'tenant_table_without_rls', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a
  ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE n.nspname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity
UNION ALL
SELECT 'forced_table_not_forced', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname || '.' || c.relname) = ANY (ARRAY[
  'ai.interaction_summaries','ai.pending_jobs',
  'analytics.banker_goals','analytics.goal_history','analytics.revenue_entries',
  'auth.audit_logs','auth.business_units',
  'community.events','community.event_participants',
  'compliance.alerts','compliance.alert_history','compliance.pending_notifications',
  'crm.leads','crm.lead_stage_history','crm.tasks','crm.pipe_dreams',
  'crm.push_subscriptions','crm.reminders','crm.visits',
  'integrations.xp_connections','integrations.xp_accounts',
  'integrations.xp_positions','integrations.xp_movements',
  'integrations.xp_commissions','integrations.xp_sync_runs',
  'wealth.clients','wealth.assets','wealth.asset_snapshots',
  'wealth.opportunities','wealth.client_contacts','wealth.client_addresses',
  'wealth.family_members','wealth.relationships','wealth.interactions',
  'wealth.kyc','wealth.suitability','wealth.patrimonial_plans',
  'wealth.pp_versions','wealth.pp_family_members','wealth.pp_companies',
  'wealth.pp_properties','wealth.pp_financial_assets',
  'wealth.pp_liabilities','wealth.pp_insurance','wealth.pp_structures'
])
  AND NOT c.relforcerowsecurity;
