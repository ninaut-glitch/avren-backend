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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_migrator') THEN
    CREATE ROLE avren_migrator LOGIN NOINHERIT
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_app') THEN
    CREATE ROLE avren_app LOGIN NOINHERIT
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT avren_owner TO avren_migrator;

-- Funções SECURITY DEFINER pertencem à role sem login.
ALTER FUNCTION auth.find_user_for_login(TEXT) OWNER TO avren_owner;
ALTER FUNCTION auth.get_mfa_secret_for_login(UUID) OWNER TO avren_owner;
ALTER FUNCTION auth.list_active_tenant_ids() OWNER TO avren_owner;
ALTER FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ) OWNER TO avren_owner;
ALTER FUNCTION auth.revoke_session(UUID,TEXT) OWNER TO avren_owner;
ALTER FUNCTION auth.is_session_active(UUID,TEXT) OWNER TO avren_owner;
ALTER FUNCTION analytics.refresh_aum_summary() OWNER TO avren_owner;
ALTER FUNCTION compliance.fn_sync_kyc_alerts(UUID) OWNER TO avren_owner;

-- Não usar REASSIGN OWNED aqui. Em instalações onde avren_service foi a role
-- de bootstrap do container, ela também é dona de objetos internos exigidos
-- pelo PostgreSQL e o comando falha antes da demotion. Transfira somente os
-- objetos dos schemas da aplicação.
DO $$
DECLARE
  item RECORD;
  object_kind TEXT;
BEGIN
  FOR item IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN (
      'ai','analytics','auth','community',
      'compliance','crm','integrations','wealth'
    )
      AND c.relkind IN ('r','p','v','m','f')
      AND pg_get_userbyid(c.relowner) = 'avren_service'
  LOOP
    object_kind := CASE item.relkind
      WHEN 'v' THEN 'VIEW'
      WHEN 'm' THEN 'MATERIALIZED VIEW'
      WHEN 'f' THEN 'FOREIGN TABLE'
      ELSE 'TABLE'
    END;
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO avren_owner',
      object_kind,
      item.nspname,
      item.relname
    );
  END LOOP;
END
$$;

-- Sequências OWNED BY acompanham a troca de owner da tabela e não aceitam
-- ALTER OWNER isolado. Somente sequências independentes são tratadas aqui.
DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN (
      'ai','analytics','auth','community',
      'compliance','crm','integrations','wealth'
    )
      AND c.relkind = 'S'
      AND pg_get_userbyid(c.relowner) = 'avren_service'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype IN ('a','i')
      )
  LOOP
    EXECUTE format(
      'ALTER SEQUENCE %I.%I OWNER TO avren_owner',
      item.nspname,
      item.relname
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  item RECORD;
  routine_kind TEXT;
BEGIN
  FOR item IN
    SELECT
      n.nspname,
      p.proname,
      p.prokind,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN (
      'ai','analytics','auth','community',
      'compliance','crm','integrations','wealth'
    )
      AND pg_get_userbyid(p.proowner) = 'avren_service'
  LOOP
    routine_kind := CASE item.prokind
      WHEN 'p' THEN 'PROCEDURE'
      ELSE 'FUNCTION'
    END;
    EXECUTE format(
      'ALTER %s %I.%I(%s) OWNER TO avren_owner',
      routine_kind,
      item.nspname,
      item.proname,
      item.identity_arguments
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  item RECORD;
  object_kind TEXT;
BEGIN
  FOR item IN
    SELECT n.nspname, t.typname, t.typtype
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname IN (
      'ai','analytics','auth','community',
      'compliance','crm','integrations','wealth'
    )
      AND t.typtype IN ('d','e')
      AND pg_get_userbyid(t.typowner) = 'avren_service'
  LOOP
    object_kind := CASE item.typtype
      WHEN 'd' THEN 'DOMAIN'
      ELSE 'TYPE'
    END;
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO avren_owner',
      object_kind,
      item.nspname,
      item.typname
    );
  END LOOP;
END
$$;

ALTER DATABASE :"target_database" OWNER TO avren_owner;

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

-- avren_service é a role de bootstrap do container e não pode perder
-- SUPERUSER. Ela deixa de ser usada pela API. avren_app é a nova role de
-- runtime, sem poderes administrativos nem bypass de RLS.
ALTER ROLE avren_app
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  LOGIN;

GRANT CONNECT ON DATABASE :"target_database" TO avren_app;
GRANT USAGE ON SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
TO avren_app;

-- Se as funções eram originalmente propriedade de avren_service, o GRANT
-- feito na migration era implícito e desaparece ao trocar o owner.
GRANT EXECUTE ON FUNCTION auth.find_user_for_login(TEXT) TO avren_app;
GRANT EXECUTE ON FUNCTION auth.get_mfa_secret_for_login(UUID) TO avren_app;
GRANT EXECUTE ON FUNCTION auth.list_active_tenant_ids() TO avren_app;
GRANT EXECUTE ON FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ)
  TO avren_app;
GRANT EXECUTE ON FUNCTION auth.revoke_session(UUID,TEXT) TO avren_app;
GRANT EXECUTE ON FUNCTION auth.is_session_active(UUID,TEXT) TO avren_app;
GRANT EXECUTE ON FUNCTION analytics.refresh_aum_summary() TO avren_app;
GRANT EXECUTE ON FUNCTION compliance.fn_sync_kyc_alerts(UUID) TO avren_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
TO avren_app;

-- Credenciais e tokens só podem ser acessados pelas funções SECURITY DEFINER.
-- Privilégios de coluna são aditivos no PostgreSQL, portanto removemos primeiro
-- o privilégio de tabela e devolvemos somente as colunas não sensíveis usadas
-- pelas consultas autenticadas da aplicação.
REVOKE ALL ON auth.users FROM avren_app;
GRANT SELECT (
  id, tenant_id, business_unit_id, email, mfa_enabled, role, full_name,
  avatar_url, is_active, last_login_at, created_at, updated_at
) ON auth.users TO avren_app;
REVOKE ALL ON auth.sessions FROM avren_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
TO avren_app;

-- Matviews são globais e não suportam RLS. O acesso da aplicação é apenas
-- pelos wrappers com filtro explícito de tenant.
REVOKE ALL ON wealth.aum_summary FROM avren_app;
REVOKE ALL ON analytics.banker_performance FROM avren_app;
REVOKE ALL ON compliance.kyc_alerts FROM avren_app;
REVOKE ALL ON
  analytics.mv_captacao_mensal,
  analytics.mv_funil_conversao,
  analytics.mv_patrimonio_por_categoria,
  analytics.mv_compliance_resumo,
  analytics.mv_pipeline_oportunidades
FROM avren_app;
GRANT SELECT ON wealth.aum_summary_tenant TO avren_app;
GRANT SELECT ON analytics.banker_performance_tenant TO avren_app;

-- Tabelas e views futuras não recebem acesso implícito. Cada migration deve
-- declarar seus grants, evitando que uma nova matview global vaze dados.
ALTER DEFAULT PRIVILEGES FOR ROLE avren_owner IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
REVOKE ALL ON TABLES FROM avren_app;
ALTER DEFAULT PRIVILEGES FOR ROLE avren_service IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
REVOKE ALL ON TABLES FROM avren_app;

-- Remove também defaults históricos criados por outras roles de migration.
DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT DISTINCT
      owner.rolname AS owner_name,
      n.nspname AS schema_name
    FROM pg_default_acl d
    JOIN pg_roles owner ON owner.oid = d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclobjtype = 'r'
      AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'avren_app')
  LOOP
    IF item.schema_name IS NULL THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM avren_app',
        item.owner_name
      );
    ELSE
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM avren_app',
        item.owner_name,
        item.schema_name
      );
    END IF;
  END LOOP;
END
$$;
ALTER DEFAULT PRIVILEGES FOR ROLE avren_owner IN SCHEMA
  ai, analytics, auth, community, compliance, crm, integrations, wealth
GRANT USAGE, SELECT ON SEQUENCES TO avren_app;

REVOKE CREATE ON SCHEMA public FROM avren_app;
REVOKE CREATE ON DATABASE :"target_database" FROM avren_app;

-- Falha o procedimento se a role continuar perigosa.
DO $$
DECLARE
  dangerous BOOLEAN;
BEGIN
  SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
  INTO dangerous
  FROM pg_roles
  WHERE rolname = 'avren_app';

  IF COALESCE(dangerous, TRUE) THEN
    RAISE EXCEPTION 'avren_app ainda possui atributo administrativo';
  END IF;
END
$$;

\echo 'Transição concluída. Aplique 032_force_rls.sql e execute o smoke test.'
