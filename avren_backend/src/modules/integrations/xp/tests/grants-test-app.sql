-- Test-only: espelha para a credencial de aplicacao (avren_app, sem
-- BYPASSRLS) os grants que a 026 da ao avren_service em producao.
GRANT USAGE ON SCHEMA integrations TO avren_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA integrations TO avren_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA integrations TO avren_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA integrations GRANT ALL ON TABLES TO avren_app;
