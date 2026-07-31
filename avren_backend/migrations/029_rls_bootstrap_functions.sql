-- Funcoes mínimas usadas antes de existir contexto RLS.
-- Não altera roles, ownership, FORCE RLS ou dados de negócio.

CREATE OR REPLACE FUNCTION auth.find_user_for_login(p_email TEXT)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  business_unit_id UUID,
  email TEXT,
  password_hash TEXT,
  mfa_enabled BOOLEAN,
  role TEXT,
  full_name TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, pg_temp
AS $$
  SELECT
    u.id, u.tenant_id, u.business_unit_id, u.email, u.password_hash,
    u.mfa_enabled, u.role, u.full_name, u.is_active
  FROM auth.users u
  WHERE u.email = p_email
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION auth.get_mfa_secret_for_login(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, pg_temp
AS $$
  SELECT u.mfa_secret
  FROM auth.users u
  WHERE u.id = p_user_id AND u.is_active = TRUE AND u.mfa_enabled = TRUE
$$;

CREATE OR REPLACE FUNCTION auth.list_active_tenant_ids()
RETURNS TABLE (tenant_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, pg_temp
AS $$
  SELECT t.id FROM auth.tenants t WHERE t.is_active = TRUE ORDER BY t.id
$$;

CREATE OR REPLACE FUNCTION auth.create_session(
  p_user_id UUID,
  p_token_hash TEXT,
  p_ip_address INET,
  p_user_agent TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth, pg_temp
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  INSERT INTO auth.sessions
    (user_id, token_hash, ip_address, user_agent, expires_at)
  SELECT
    u.id, p_token_hash, p_ip_address, p_user_agent, p_expires_at
  FROM auth.users u
  WHERE u.id = p_user_id AND u.is_active = TRUE;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'usuário inexistente ou inativo';
  END IF;

  UPDATE auth.users
  SET last_login_at = NOW()
  WHERE id = p_user_id AND is_active = TRUE;
END
$$;

DROP FUNCTION IF EXISTS auth.revoke_session(TEXT);
CREATE OR REPLACE FUNCTION auth.revoke_session(
  p_user_id UUID,
  p_token_hash TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, auth, pg_temp
AS $$
  DELETE FROM auth.sessions
  WHERE user_id = p_user_id AND token_hash = p_token_hash
$$;

DROP FUNCTION IF EXISTS auth.is_session_active(TEXT);
CREATE OR REPLACE FUNCTION auth.is_session_active(
  p_user_id UUID,
  p_token_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE user_id = p_user_id
      AND token_hash = p_token_hash
      AND expires_at > NOW()
  )
$$;

REVOKE ALL ON FUNCTION auth.find_user_for_login(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.get_mfa_secret_for_login(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.list_active_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.revoke_session(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.is_session_active(UUID,TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.find_user_for_login(TEXT) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.get_mfa_secret_for_login(UUID) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.list_active_tenant_ids() TO avren_service;
GRANT EXECUTE ON FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.revoke_session(UUID,TEXT) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.is_session_active(UUID,TEXT) TO avren_service;
