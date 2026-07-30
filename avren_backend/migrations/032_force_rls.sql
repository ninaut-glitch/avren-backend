-- Ativa a proteção também para o owner das tabelas.
-- Só aplicar depois de criar/testar uma role administrativa de emergência,
-- transferir ownership para uma role sem LOGIN e demover avren_service.

DO $$
DECLARE
  item TEXT;
  schema_name TEXT;
  table_name TEXT;
BEGIN
  FOREACH item IN ARRAY ARRAY[
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
  ] LOOP
    schema_name := split_part(item, '.', 1);
    table_name := split_part(item, '.', 2);
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      schema_name, table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      schema_name, table_name
    );
  END LOOP;
END $$;
