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
WHERE rolname IN ('avren_service', 'avren_app', 'avren_owner', 'avren_migrator')
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
WHERE rolname = 'avren_app'
  AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
UNION ALL
SELECT 'runtime_role_missing', 'avren_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_app')
UNION ALL
SELECT 'login_owner_role', rolname
FROM pg_roles
WHERE rolname = 'avren_owner' AND rolcanlogin
UNION ALL
SELECT 'migrator_cannot_set_owner', 'avren_migrator'
WHERE NOT pg_has_role('avren_migrator', 'avren_owner', 'MEMBER')
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
  AND c.relkind IN ('r','p','v','m','S','f')
  AND pg_get_userbyid(c.relowner) <> 'avren_owner'
UNION ALL
SELECT 'application_type_wrong_owner', n.nspname || '.' || t.typname
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
  AND t.typtype IN ('d','e')
  AND pg_get_userbyid(t.typowner) <> 'avren_owner'
UNION ALL
SELECT 'application_routine_wrong_owner', n.nspname || '.' || p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
  AND pg_get_userbyid(p.proowner) <> 'avren_owner'
UNION ALL
SELECT 'definer_function_wrong_owner', n.nspname || '.' || p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname IN (
    'ai','analytics','auth','community','compliance','crm','integrations','wealth'
  )
  AND pg_get_userbyid(p.proowner) <> 'avren_owner'
UNION ALL
SELECT 'required_function_not_executable', required.signature
FROM (VALUES
  ('auth.find_user_for_login(text)'),
  ('auth.get_mfa_secret_for_login(uuid)'),
  ('auth.list_active_tenant_ids()'),
  ('auth.create_session(uuid,text,inet,text,timestamp with time zone)'),
  ('auth.revoke_session(uuid,text)'),
  ('auth.is_session_active(uuid,text)'),
  ('analytics.refresh_aum_summary()'),
  ('compliance.fn_sync_kyc_alerts(uuid)')
) AS required(signature)
WHERE NOT has_function_privilege(
  'avren_app',
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
  AND has_table_privilege('avren_app', c.oid, 'SELECT')
UNION ALL
SELECT 'materialized_view_visible_to_app', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN (
  'ai','analytics','auth','community','compliance','crm','integrations','wealth'
)
  AND c.relkind = 'm'
  AND has_table_privilege('avren_app', c.oid, 'SELECT')
UNION ALL
SELECT 'future_table_default_grant', n.nspname
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
WHERE d.defaclobjtype = 'r'
  AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'avren_app')
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
SELECT 'runtime_can_read_sensitive_auth_column', column_name
FROM information_schema.column_privileges
WHERE grantee = 'avren_app'
  AND table_schema = 'auth'
  AND table_name = 'users'
  AND column_name IN ('password_hash','mfa_secret')
  AND privilege_type = 'SELECT'
UNION ALL
SELECT 'runtime_can_access_session_table', privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'avren_app'
  AND table_schema = 'auth'
  AND table_name = 'sessions'
UNION ALL
SELECT 'runtime_can_rewrite_task_author', 'crm.tasks.created_by'
WHERE has_column_privilege(
  'avren_app', 'crm.tasks', 'created_by', 'UPDATE'
)
UNION ALL
SELECT 'forced_table_without_select_policy', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relforcerowsecurity
  AND n.nspname IN (
    'ai','analytics','auth','community','compliance','crm','integrations','wealth'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = c.oid AND p.polcmd IN ('r','*')
  )
UNION ALL
SELECT 'forced_table_without_write_policy', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relforcerowsecurity
  AND n.nspname IN (
    'ai','analytics','auth','community','compliance','crm','integrations','wealth'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = c.oid AND p.polcmd IN ('a','w','d','*')
  )
UNION ALL
SELECT 'tenant_table_without_scoped_select_policy', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a
  ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE n.nspname IN (
    'ai','analytics','auth','community','compliance','crm','integrations','wealth'
  )
  AND c.relkind = 'r'
  AND c.relforcerowsecurity
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = n.nspname
      AND p.tablename = c.relname
      AND p.cmd IN ('SELECT','ALL')
      AND COALESCE(p.qual, '') LIKE '%app.current_tenant_id%'
  )
UNION ALL
SELECT 'tenant_table_without_scoped_write_policy', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a
  ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE n.nspname IN (
    'ai','analytics','auth','community','compliance','crm','integrations','wealth'
  )
  AND c.relkind = 'r'
  AND c.relforcerowsecurity
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = n.nspname
      AND p.tablename = c.relname
      AND p.cmd IN ('INSERT','UPDATE','ALL')
      AND COALESCE(p.with_check, '') LIKE '%app.current_tenant_id%'
  )
UNION ALL
SELECT 'forced_table_not_forced', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
-- auth.users, auth.tenants e auth.sessions são excluídas deliberadamente:
-- o login ocorre antes do contexto de tenant e avren_app não é owner.
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
  'integrations.xp_products','integrations.xp_account_advisor_relations',
  'integrations.xp_positivador',
  'wealth.clients','wealth.assets','wealth.asset_snapshots',
  'wealth.opportunities','wealth.client_contacts','wealth.client_addresses',
  'wealth.family_members','wealth.relationships','wealth.interactions',
  'wealth.kyc','wealth.suitability','wealth.patrimonial_plans',
  'wealth.pp_versions','wealth.pp_family_members','wealth.pp_companies',
  'wealth.pp_properties','wealth.pp_financial_assets',
  'wealth.pp_liabilities','wealth.pp_insurance','wealth.pp_structures'
])
  AND NOT c.relforcerowsecurity;

-- ── Etapa B (migration 034): postura das tabelas XP novas ─────
-- A lista de FORCE acima ja cobre "existe mas nao esta forcada";
-- os blocos abaixo cobrem o que aquela lista NAO detecta:
-- ausencia da tabela, RLS desabilitado, grants a PUBLIC e grants
-- de runtime ausentes. Esperado: zero linhas.
SELECT 'xp_phase_b_table_missing' AS finding, expected.tbl AS object
FROM (VALUES
  ('xp_products'),
  ('xp_account_advisor_relations'),
  ('xp_positivador')
) AS expected(tbl)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'integrations'
    AND c.relname = expected.tbl
    AND c.relkind = 'r'
)
UNION ALL
SELECT 'xp_phase_b_rls_disabled', 'integrations.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'integrations'
  AND c.relname IN ('xp_products','xp_account_advisor_relations','xp_positivador')
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity
UNION ALL
-- DELIBERADO: esta checagem duplica a cobertura da lista explicita de
-- FORCE (forced_table_not_forced) para as tres tabelas da Etapa B.
-- Uma regressao de FORCE aqui emitira DOIS achados — defesa em
-- profundidade: se alguem remover a tabela da lista generica, este
-- bloco dedicado ainda dispara.
SELECT 'xp_phase_b_rls_not_forced', 'integrations.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'integrations'
  AND c.relname IN ('xp_products','xp_account_advisor_relations','xp_positivador')
  AND c.relkind = 'r'
  AND NOT c.relforcerowsecurity
UNION ALL
SELECT 'xp_phase_b_tenant_policy_missing', 'integrations.' || expected.tbl
FROM (VALUES
  ('xp_products', 'xp_products_tenant_policy'),
  ('xp_account_advisor_relations', 'xp_aar_tenant_policy'),
  ('xp_positivador', 'xp_positivador_tenant_policy')
) AS expected(tbl, policy)
WHERE EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'integrations' AND c.relname = expected.tbl
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'integrations'
      AND p.tablename = expected.tbl
      -- nome esperado: uma policy permissiva com outro nome nao conta
      AND p.policyname = expected.policy
      AND p.cmd = 'ALL'
      -- mencionar app.current_tenant_id nao basta: a expressao precisa
      -- COMPARAR a coluna tenant_id. Regex com fronteira de palavra
      -- (\m...\M): a coluna casa ("(tenant_id = ..."), mas o literal
      -- 'app.current_tenant_id' NAO casa (precedido de '_', caractere
      -- de palavra) — provado por sabotagem com policy permissiva.
      AND COALESCE(p.qual, '') ~ '\mtenant_id\M\s*='
      AND COALESCE(p.qual, '') LIKE '%app.current_tenant_id%'
      AND COALESCE(p.with_check, '') ~ '\mtenant_id\M\s*='
      AND COALESCE(p.with_check, '') LIKE '%app.current_tenant_id%'
  )
UNION ALL
SELECT 'xp_phase_b_public_grant',
       'integrations.' || table_name || ' <- ' || privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'integrations'
  AND table_name IN ('xp_products','xp_account_advisor_relations','xp_positivador')
  AND grantee = 'PUBLIC'
UNION ALL
-- grants de COLUNA a PUBLIC nao aparecem em table_privileges quando
-- concedidos coluna a coluna; cobertos aqui separadamente.
SELECT 'xp_phase_b_public_column_grant',
       'integrations.' || table_name || '.' || column_name || ' <- ' || privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'integrations'
  AND table_name IN ('xp_products','xp_account_advisor_relations','xp_positivador')
  AND grantee = 'PUBLIC'
UNION ALL
SELECT 'xp_phase_b_runtime_grant_missing',
       'integrations.' || c.relname || ' sem ' || expected.priv
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
) AS expected(priv)
WHERE n.nspname = 'integrations'
  AND c.relname IN ('xp_products','xp_account_advisor_relations','xp_positivador')
  AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_app')
  -- has_table_privilege por OID: so avalia linhas de tabelas que
  -- existem, entao tabela ausente nunca gera erro aqui (ela ja e
  -- reportada por xp_phase_b_table_missing).
  AND NOT has_table_privilege('avren_app', c.oid, expected.priv);
