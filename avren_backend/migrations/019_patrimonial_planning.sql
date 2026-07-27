-- Planejamento Patrimonial AVREN — fase 1
-- Dossiê vivo, autosave, histórico e coleções normalizadas.

CREATE TABLE wealth.patrimonial_plans (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID        NOT NULL REFERENCES auth.tenants(id),
    client_id       UUID        NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    advisor_id      UUID        NOT NULL REFERENCES auth.users(id),
    status          TEXT        NOT NULL DEFAULT 'em_andamento'
                                CHECK (status IN ('em_andamento','concluido','arquivado')),
    current_block   TEXT        NOT NULL DEFAULT 'titular',
    completion_pct  SMALLINT    NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
    data            JSONB       NOT NULL DEFAULT '{}',
    version_number  INTEGER     NOT NULL DEFAULT 1,
    last_saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, client_id)
);

CREATE TABLE wealth.pp_versions (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID        NOT NULL REFERENCES auth.tenants(id),
    plan_id         UUID        NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    version_number  INTEGER     NOT NULL,
    snapshot        JSONB       NOT NULL,
    created_by      UUID        NOT NULL REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, version_number)
);

CREATE TABLE wealth.pp_family_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
    plan_id UUID NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    full_name TEXT, relationship TEXT, birth_date DATE, financially_dependent BOOLEAN DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wealth.pp_companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
    plan_id UUID NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    legal_name TEXT, document TEXT, ownership_pct NUMERIC(7,4), annual_revenue NUMERIC(18,2),
    data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wealth.pp_properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
    plan_id UUID NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    description TEXT, location TEXT, market_value NUMERIC(18,2), declared_value NUMERIC(18,2),
    data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wealth.pp_financial_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
    plan_id UUID NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    asset_type TEXT, institution TEXT, current_value NUMERIC(18,2), country TEXT DEFAULT 'Brasil',
    data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wealth.pp_liabilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
    plan_id UUID NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    description TEXT, liability_type TEXT, outstanding_amount NUMERIC(18,2),
    data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wealth.pp_insurance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
    plan_id UUID NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    insurer TEXT, policy_type TEXT, insured_capital NUMERIC(18,2),
    data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wealth.pp_structures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
    plan_id UUID NOT NULL REFERENCES wealth.patrimonial_plans(id) ON DELETE CASCADE,
    structure_type TEXT, jurisdiction TEXT, status TEXT,
    data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pp_plans_client ON wealth.patrimonial_plans (tenant_id, client_id);
CREATE INDEX idx_pp_versions_plan ON wealth.pp_versions (plan_id, version_number DESC);
CREATE INDEX idx_pp_family_plan ON wealth.pp_family_members (plan_id);
CREATE INDEX idx_pp_companies_plan ON wealth.pp_companies (plan_id);
CREATE INDEX idx_pp_properties_plan ON wealth.pp_properties (plan_id);
CREATE INDEX idx_pp_financial_assets_plan ON wealth.pp_financial_assets (plan_id);
CREATE INDEX idx_pp_liabilities_plan ON wealth.pp_liabilities (plan_id);
CREATE INDEX idx_pp_insurance_plan ON wealth.pp_insurance (plan_id);
CREATE INDEX idx_pp_structures_plan ON wealth.pp_structures (plan_id);

ALTER TABLE wealth.patrimonial_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_financial_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_insurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth.pp_structures ENABLE ROW LEVEL SECURITY;

CREATE POLICY pp_plan_policy ON wealth.patrimonial_plans
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
  AND (
    advisor_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
    OR current_setting('app.current_user_role', true) IN ('supervisor','socio','operacoes')
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
  AND (
    advisor_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
    OR current_setting('app.current_user_role', true) IN ('supervisor','socio','operacoes')
  )
);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pp_versions','pp_family_members','pp_companies','pp_properties',
    'pp_financial_assets','pp_liabilities','pp_insurance','pp_structures'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON wealth.%I USING (
        tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::UUID
        AND EXISTS (
          SELECT 1 FROM wealth.patrimonial_plans p
          WHERE p.id = plan_id AND (
            p.advisor_id = NULLIF(current_setting(''app.current_user_id'', true), '''')::UUID
            OR current_setting(''app.current_user_role'', true) IN (''supervisor'',''socio'',''operacoes'')
          )
        )
      ) WITH CHECK (
        tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::UUID
      )',
      table_name || '_policy', table_name
    );
  END LOOP;
END $$;
