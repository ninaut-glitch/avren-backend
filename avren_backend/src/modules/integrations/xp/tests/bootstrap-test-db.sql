-- ============================================================
-- tests/bootstrap-test-db.sql
-- PRE-REQUISITOS MINIMOS para aplicar 018/026/028 num banco de
-- teste descartavel. Este arquivo NAO representa o schema de
-- producao: e o contrato minimo que a 018 referencia
-- (auth.tenants com slug unico, auth.users, wealth.clients).
-- Executado SOMENTE pela credencial administrativa de teste.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS wealth;

CREATE TABLE IF NOT EXISTS auth.tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wealth.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  full_name TEXT NOT NULL,
  banker_id UUID REFERENCES auth.users(id),
  cpf TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wealth.clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clients_tenant_policy ON wealth.clients;
CREATE POLICY clients_tenant_policy ON wealth.clients
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

-- Papeis exigidos pela 026 (NOLOGIN; ja existem em prod)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_service') THEN
    CREATE ROLE avren_service NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_readonly') THEN
    CREATE ROLE avren_readonly NOLOGIN;
  END IF;
END $$;

-- Concede a credencial de APLICACAO (sem BYPASSRLS) acesso equivalente
-- ao avren_service de producao, para os testes exercitarem o RLS real.
GRANT USAGE ON SCHEMA auth, wealth TO avren_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth, wealth TO avren_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO avren_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA wealth GRANT ALL ON TABLES TO avren_app;
