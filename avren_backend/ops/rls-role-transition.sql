\set ON_ERROR_STOP on

-- PRE-REQUISITOS:
-- 1. Executar conectado por uma role administrativa de emergência já testada.
-- 2. Aplicar migrations 029, 030 e 031 antes deste script.
-- 3. NÃO aplicar em produção sem dump restaurado, janela e rollback ensaiados.
-- A rotação da senha é um procedimento separado e coordenado com o Easypanel.
-- Informe o banco explicitamente:
--   psql ... --set=target_database=avren_crm -f ops/rls-role-transition.sql

\if :{?target_database}
\else
  \echo 'ERRO: informe --set=target_database=...'
  \quit
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_owner') THEN
    CREATE ROLE avren_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Funções SECURITY DEFINER pertencem à role sem login.
ALTER FUNCTION auth.find_user_for_login(TEXT) OWNER TO avren_owner;
ALTER FUNCTION auth.list_active_tenant_ids() OWNER TO avren_owner;
ALTER FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ) OWNER TO avren_owner;
ALTER FUNCTION auth.revoke_session(TEXT) OWNER TO avren_owner;
ALTER FUNCTION auth.is_session_active(TEXT) OWNER TO avren_owner;

-- Transfere os objetos atualmente pertencentes ao usuário da aplicação.
REASSIGN OWNED BY avren_service TO avren_owner;

-- Garante que o owner consiga resolver relações e FKs entre schemas mesmo
-- quando a instalação histórica deixou os schemas com outro proprietário.
ALTER SCHEMA ai OWNER TO avren_owner;
ALTER SCHEMA analytics OWNER TO avren_owner;
ALTER SCHEMA auth OWNER TO avren_owner;
ALTER SCHEMA community OWNER TO avren_owner;
ALTER SCHEMA compliance OWNER TO avren_owner;
ALTER SCHEMA crm OWNER TO avren_owner;
ALTER SCHEMA integrations OWNER TO avren_owner;
ALTER SCHEMA wealth OWNER TO avren_owner;

-- A aplicação deixa de contornar RLS e perde poderes administrativos.
ALTER ROLE avren_service
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  LOGIN;

GRANT CONNECT ON DATABASE :"target_database" TO avren_service;
GRANT USAGE ON SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
TO avren_service;

-- Se as funções eram originalmente propriedade de avren_service, o GRANT
-- feito na migration era implícito e desaparece ao trocar o owner.
GRANT EXECUTE ON FUNCTION auth.find_user_for_login(TEXT) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.list_active_tenant_ids() TO avren_service;
GRANT EXECUTE ON FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ)
  TO avren_service;
GRANT EXECUTE ON FUNCTION auth.revoke_session(TEXT) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.is_session_active(TEXT) TO avren_service;
GRANT EXECUTE ON FUNCTION analytics.refresh_aum_summary() TO avren_service;
GRANT EXECUTE ON FUNCTION compliance.fn_sync_kyc_alerts(UUID) TO avren_service;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
TO avren_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
TO avren_service;

-- Matviews são globais e não suportam RLS. O acesso da aplicação é apenas
-- pelos wrappers com filtro explícito de tenant.
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

ALTER DEFAULT PRIVILEGES FOR ROLE avren_owner IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avren_service;
ALTER DEFAULT PRIVILEGES FOR ROLE avren_owner IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
GRANT USAGE, SELECT ON SEQUENCES TO avren_service;

REVOKE CREATE ON SCHEMA public FROM avren_service;
REVOKE CREATE ON DATABASE :"target_database" FROM avren_service;

-- Falha o procedimento se a role continuar perigosa.
DO $$
DECLARE
  dangerous BOOLEAN;
BEGIN
  SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
  INTO dangerous
  FROM pg_roles
  WHERE rolname = 'avren_service';

  IF COALESCE(dangerous, TRUE) THEN
    RAISE EXCEPTION 'avren_service ainda possui atributo administrativo';
  END IF;
END
$$;

\echo 'Transição concluída. Aplique 032_force_rls.sql e execute o smoke test.'
