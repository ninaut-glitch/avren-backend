-- Template de migration após a separação das roles.
-- Substitua nomes e remova todo privilégio que a aplicação não utilizar.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_name.table_name (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE schema_name.table_name ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_name.table_name FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS table_name_tenant_policy ON schema_name.table_name;
CREATE POLICY table_name_tenant_policy ON schema_name.table_name
  USING (
    tenant_id =
      NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
  )
  WITH CHECK (
    tenant_id =
      NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
  );

REVOKE ALL ON TABLE schema_name.table_name FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE schema_name.table_name TO avren_service;

-- Se a tabela usar uma sequência:
-- GRANT USAGE, SELECT ON SEQUENCE schema_name.table_name_id_seq TO avren_service;

COMMIT;
