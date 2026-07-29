-- ============================================================
-- 026_xp_integration_hardening.sql
-- Corrige gaps da 018 encontrados na auditoria de seguranca:
--   1) 'homologation' ausente no CHECK de environment (e vira default)
--   2) 'data_access' ausente no CHECK de channel (e vira default)
--   3) resource nao cobre a Reprocessing Log API (deve ser consultada
--      antes de qualquer outro recurso da Data Access API)
--   4) schema integrations nunca recebeu GRANT para avren_service
--      (013_permissions.sql e anterior a criacao do schema na 018)
-- Depende de: 013 (roles), 018 (schema integrations)
-- ============================================================

-- 1) environment: adicionar 'homologation' e trocar o default
ALTER TABLE integrations.xp_connections
  DROP CONSTRAINT IF EXISTS xp_connections_environment_check;

ALTER TABLE integrations.xp_connections
  ADD CONSTRAINT xp_connections_environment_check
  CHECK (environment IN ('homologation', 'production'));

ALTER TABLE integrations.xp_connections
  ALTER COLUMN environment SET DEFAULT 'homologation';

UPDATE integrations.xp_connections
  SET environment = 'homologation'
  WHERE environment = 'sandbox';

-- 2) channel: adicionar 'data_access' e torna-lo o default
ALTER TABLE integrations.xp_connections
  DROP CONSTRAINT IF EXISTS xp_connections_channel_check;

ALTER TABLE integrations.xp_connections
  ADD CONSTRAINT xp_connections_channel_check
  CHECK (channel IN ('data_access', 'partner_api', 'open_finance'));

ALTER TABLE integrations.xp_connections
  ALTER COLUMN channel SET DEFAULT 'data_access';

UPDATE integrations.xp_connections
  SET channel = 'data_access'
  WHERE channel = 'partner_api';

-- 3) resource: nomes em ingles snake_case + reprocessing_log
ALTER TABLE integrations.xp_sync_runs
  DROP CONSTRAINT IF EXISTS xp_sync_runs_resource_check;

ALTER TABLE integrations.xp_sync_runs
  ADD CONSTRAINT xp_sync_runs_resource_check
  CHECK (resource IN (
      'reprocessing_log',
      'accounts',
      'positions',
      'movements',
      'products',
      'fundraising',
      'commissions',
      'full'
    ));

-- 4) GRANTs no schema integrations (o gap real da auditoria)
GRANT USAGE ON SCHEMA integrations TO avren_service;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA integrations TO avren_service;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA integrations TO avren_service;

ALTER DEFAULT PRIVILEGES IN SCHEMA integrations
  GRANT ALL PRIVILEGES ON TABLES TO avren_service;

ALTER DEFAULT PRIVILEGES IN SCHEMA integrations
  GRANT ALL PRIVILEGES ON SEQUENCES TO avren_service;

GRANT USAGE ON SCHEMA integrations TO avren_readonly;

GRANT SELECT ON
  integrations.xp_connections,
  integrations.xp_accounts,
  integrations.xp_positions,
  integrations.xp_movements,
  integrations.xp_commissions,
  integrations.xp_sync_runs
TO avren_readonly;

REVOKE ALL ON SCHEMA integrations FROM PUBLIC;
