-- ============================================================
-- 034_xp_products_positivador.sql
-- Etapa B da integracao XP Data Access:
--   1. integrations.xp_products               (dimensao Produto)
--   2. integrations.xp_account_advisor_relations (relacao conta-assessor)
--   3. integrations.xp_positivador            (fato gerencial mensal)
--   4. account_code_hash em integrations.xp_accounts
--
-- Decisoes desta migration (ver docs/XP_DATA_CONTRACT.md):
--   - PRIVACIDADE: o numero de conta bruto NUNCA e persistido. O vinculo
--     entre a dimensao Account (dimAccountCode) e o Positivador
--     (accountCode) usa HMAC-SHA256 com pepper dedicado
--     (XP_ACCOUNT_PEPPER). O Positivador NAO possui raw_data: as
--     colunas abaixo SAO a allowlist. Aniversario, genero, profissao,
--     estado civil e documentos nao possuem coluna de destino.
--   - HISTORICO: xp_positivador preserva competencias distintas do
--     mesmo identificador via UNIQUE (tenant_id, external_positivador_id,
--     position_date). O ON CONFLICT do motor usa exatamente essa chave.
--   - SEGURANCA: RLS + FORCE RLS + policy de tenant em todas as tabelas
--     novas; grants condicionais apenas para a role de runtime restrita
--     (avren_app); nenhum grant a PUBLIC; idempotente em reexecucao.
-- NAO EXECUTAR EM PRODUCAO SEM AUTORIZACAO EXPRESSA.
-- ============================================================

-- ── 4. Vinculo pseudonimizado na dimensao Account ─────────────
ALTER TABLE integrations.xp_accounts
  ADD COLUMN IF NOT EXISTS account_code_hash TEXT;

COMMENT ON COLUMN integrations.xp_accounts.account_code_hash IS
  'HMAC-SHA256(digitos do accountCode, XP_ACCOUNT_PEPPER). Nunca o numero bruto. NULL quando o pepper nao estava configurado na ingestao (vinculo pendente).';

CREATE INDEX IF NOT EXISTS idx_xp_accounts_tenant_code_hash
  ON integrations.xp_accounts (tenant_id, account_code_hash)
  WHERE account_code_hash IS NOT NULL;

-- ── 1. Dimensao Produto ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations.xp_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  external_product_id TEXT NOT NULL,          -- dimProductCode
  asset_code TEXT,
  product_name TEXT,                          -- assetName
  issuer_name TEXT,
  -- Colunas internas normalizadas; o payload oficial usa a grafia
  -- "productClassfication" (sem o segundo i), preservada nos tipos TS.
  classification_l0 TEXT,
  classification_l1 TEXT,
  classification_l2 TEXT,
  classification_l3 TEXT,
  classification_l4 TEXT,
  classification_l5 TEXT,
  custody_type TEXT,
  issue_date DATE,
  due_date DATE,
  manager_name TEXT,
  strategy TEXT,
  yield_description TEXT,                     -- yield (palavra reservada)
  index_name TEXT,                            -- index (palavra reservada)
  deal_type TEXT,
  product_type TEXT,
  interest_payment_frequency TEXT,
  current_register BOOLEAN,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_update TIMESTAMPTZ,
  available_data BOOLEAN,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, external_product_id)
);

CREATE INDEX IF NOT EXISTS idx_xp_products_tenant_class
  ON integrations.xp_products (tenant_id, classification_l0);
CREATE INDEX IF NOT EXISTS idx_xp_products_tenant_due
  ON integrations.xp_products (tenant_id, due_date);

-- ── 2. Relacao conta-assessor (historico por data) ───────────
-- reference_date e NOT NULL por decisao deliberada: o mapper e
-- deterministico e DESCARTA (skipped) registros sem data confiavel,
-- em vez de inventar a data corrente. Pendencia HML documentada.
CREATE TABLE IF NOT EXISTS integrations.xp_account_advisor_relations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  external_relation_id TEXT NOT NULL,         -- id oficial do registro
  external_account_id TEXT NOT NULL,          -- dimAccountCode
  account_id UUID REFERENCES integrations.xp_accounts(id) ON DELETE SET NULL,
  advisor_code TEXT,                          -- dimAdvisorCode
  reference_date DATE NOT NULL,
  start_validity_date DATE,
  end_validity_date DATE,
  current_register BOOLEAN,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_update TIMESTAMPTZ,
  available_data BOOLEAN,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, external_relation_id, reference_date)
);

CREATE INDEX IF NOT EXISTS idx_xp_aar_tenant_account
  ON integrations.xp_account_advisor_relations (tenant_id, external_account_id, reference_date);
CREATE INDEX IF NOT EXISTS idx_xp_aar_tenant_advisor
  ON integrations.xp_account_advisor_relations (tenant_id, advisor_code, reference_date);
CREATE INDEX IF NOT EXISTS idx_xp_aar_tenant_account_id
  ON integrations.xp_account_advisor_relations (tenant_id, account_id)
  WHERE account_id IS NOT NULL;

-- ── 3. Positivador (fato gerencial, SEM raw_data) ────────────
-- As colunas abaixo SAO a allowlist de persistencia. Campos pessoais
-- (aniversario, genero, profissao, estado civil, documentos) nao tem
-- destino e nunca chegam ao banco. accountCode bruto tambem nao:
-- apenas account_code_hash.
CREATE TABLE IF NOT EXISTS integrations.xp_positivador (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  external_positivador_id TEXT NOT NULL,      -- id oficial da linha
  account_code_hash TEXT,                     -- HMAC do accountCode; NULL = pendente
  account_id UUID REFERENCES integrations.xp_accounts(id) ON DELETE SET NULL,
  advisor_code TEXT,
  head_office_code TEXT,
  segment TEXT,
  segment_client TEXT,
  suitability TEXT,                           -- dscSuitability
  made_second_contribution BOOLEAN,
  status TEXT,
  activated_in_month BOOLEAN,
  churned_in_month BOOLEAN,
  operated_stock_exchange BOOLEAN,
  operated_funds BOOLEAN,
  operated_fixed_income BOOLEAN,
  financial_applications NUMERIC(18,2),
  revenue_in_month NUMERIC(18,2),
  bovespa_revenue NUMERIC(18,2),
  futures_revenue NUMERIC(18,2),
  fixed_income_banking_revenue NUMERIC(18,2),
  fixed_income_private_revenue NUMERIC(18,2),
  fixed_income_public_revenue NUMERIC(18,2),
  gross_capture_in_month NUMERIC(18,2),
  redemption_in_month NUMERIC(18,2),
  net_capture_in_month NUMERIC(18,2),
  ted_capture NUMERIC(18,2),
  st_capture NUMERIC(18,2),
  ota_capture NUMERIC(18,2),
  fixed_income_capture NUMERIC(18,2),
  treasury_direct_capture NUMERIC(18,2),
  pension_capture NUMERIC(18,2),
  net_in_m1 NUMERIC(18,2),
  net_in_month NUMERIC(18,2),
  net_fixed_income NUMERIC(18,2),
  net_real_estate_funds NUMERIC(18,2),
  net_equities NUMERIC(18,2),
  net_funds NUMERIC(18,2),
  net_financial NUMERIC(18,2),
  net_pension NUMERIC(18,2),
  net_others NUMERIC(18,2),
  rental_revenue NUMERIC(18,2),
  package_complement_revenue NUMERIC(18,2),
  person_type TEXT,
  position_date DATE NOT NULL,
  last_update TIMESTAMPTZ,
  available_data BOOLEAN,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, external_positivador_id, position_date)
);

CREATE INDEX IF NOT EXISTS idx_xp_positivador_tenant_date
  ON integrations.xp_positivador (tenant_id, position_date);
CREATE INDEX IF NOT EXISTS idx_xp_positivador_tenant_advisor
  ON integrations.xp_positivador (tenant_id, advisor_code, position_date);
CREATE INDEX IF NOT EXISTS idx_xp_positivador_tenant_hash
  ON integrations.xp_positivador (tenant_id, account_code_hash)
  WHERE account_code_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_xp_positivador_tenant_account
  ON integrations.xp_positivador (tenant_id, account_id)
  WHERE account_id IS NOT NULL;

-- ── RLS + FORCE RLS + policies de tenant ─────────────────────
ALTER TABLE integrations.xp_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xp_products_tenant_policy ON integrations.xp_products;
CREATE POLICY xp_products_tenant_policy ON integrations.xp_products
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

ALTER TABLE integrations.xp_account_advisor_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_account_advisor_relations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xp_aar_tenant_policy ON integrations.xp_account_advisor_relations;
CREATE POLICY xp_aar_tenant_policy ON integrations.xp_account_advisor_relations
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

ALTER TABLE integrations.xp_positivador ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_positivador FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xp_positivador_tenant_policy ON integrations.xp_positivador;
CREATE POLICY xp_positivador_tenant_policy ON integrations.xp_positivador
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

-- ── Grants: somente a role de runtime restrita, nunca PUBLIC ──
REVOKE ALL ON integrations.xp_products,
              integrations.xp_account_advisor_relations,
              integrations.xp_positivador
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avren_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON integrations.xp_products,
         integrations.xp_account_advisor_relations,
         integrations.xp_positivador
      TO avren_app;
  END IF;
END $$;
