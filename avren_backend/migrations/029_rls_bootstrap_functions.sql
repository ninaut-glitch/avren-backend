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
  mfa_secret TEXT,
  role TEXT,
  full_name TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
  SELECT
    u.id, u.tenant_id, u.business_unit_id, u.email, u.password_hash,
    u.mfa_enabled, u.mfa_secret, u.role, u.full_name, u.is_active
  FROM auth.users u
  WHERE u.email = p_email
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION auth.list_active_tenant_ids()
RETURNS TABLE (tenant_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth
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
SET search_path = pg_catalog, auth
AS $$
BEGIN
  INSERT INTO auth.sessions
    (user_id, token_hash, ip_address, user_agent, expires_at)
  VALUES
    (p_user_id, p_token_hash, p_ip_address, p_user_agent, p_expires_at);

  UPDATE auth.users SET last_login_at = NOW() WHERE id = p_user_id;
END
$$;

CREATE OR REPLACE FUNCTION auth.revoke_session(p_token_hash TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
  DELETE FROM auth.sessions WHERE token_hash = p_token_hash
$$;

CREATE OR REPLACE FUNCTION auth.is_session_active(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE token_hash = p_token_hash AND expires_at > NOW()
  )
$$;

REVOKE ALL ON FUNCTION auth.find_user_for_login(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.list_active_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.revoke_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.is_session_active(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.find_user_for_login(TEXT) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.list_active_tenant_ids() TO avren_service;
GRANT EXECUTE ON FUNCTION auth.create_session(UUID,TEXT,INET,TEXT,TIMESTAMPTZ) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.revoke_session(TEXT) TO avren_service;
GRANT EXECUTE ON FUNCTION auth.is_session_active(TEXT) TO avren_service;
