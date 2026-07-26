-- ============================================================
-- 018_xp_integration_foundation.sql
-- Base segura para integração XP (API de parceiros/Open Finance)
-- Não armazena segredos: credenciais ficam no ambiente da aplicação.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS integrations;

CREATE TABLE integrations.xp_connections (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id          UUID        NOT NULL UNIQUE REFERENCES auth.tenants(id),
    channel            TEXT        NOT NULL DEFAULT 'partner_api'
                                   CHECK (channel IN ('partner_api','open_finance')),
    environment        TEXT        NOT NULL DEFAULT 'sandbox'
                                   CHECK (environment IN ('sandbox','production')),
    status             TEXT        NOT NULL DEFAULT 'pending_credentials'
                                   CHECK (status IN (
                                       'pending_credentials','ready','syncing',
                                       'active','degraded','disabled'
                                   )),
    credential_ref     TEXT,
    granted_scopes     TEXT[]      NOT NULL DEFAULT '{}',
    last_sync_at       TIMESTAMPTZ,
    last_success_at    TIMESTAMPTZ,
    last_error_code    TEXT,
    last_error_message TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integrations.xp_accounts (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID        NOT NULL REFERENCES auth.tenants(id),
    connection_id       UUID        NOT NULL REFERENCES integrations.xp_connections(id) ON DELETE CASCADE,
    client_id           UUID        REFERENCES wealth.clients(id) ON DELETE SET NULL,
    external_account_id TEXT        NOT NULL,
    account_number_mask TEXT,
    holder_document_hash TEXT,
    holder_name         TEXT,
    advisor_code        TEXT,
    status              TEXT,
    raw_data            JSONB       NOT NULL DEFAULT '{}',
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, external_account_id)
);

CREATE TABLE integrations.xp_positions (
    id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID          NOT NULL REFERENCES auth.tenants(id),
    account_id           UUID          NOT NULL REFERENCES integrations.xp_accounts(id) ON DELETE CASCADE,
    external_position_id TEXT          NOT NULL,
    asset_class          TEXT          NOT NULL,
    product_code         TEXT,
    product_name         TEXT          NOT NULL,
    symbol               TEXT,
    issuer_name          TEXT,
    quantity             NUMERIC(24,8),
    unit_price           NUMERIC(24,8),
    gross_value          NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_value            NUMERIC(18,2),
    invested_value       NUMERIC(18,2),
    currency             CHAR(3)       NOT NULL DEFAULT 'BRL',
    maturity_date        DATE,
    as_of_date           DATE          NOT NULL,
    raw_data             JSONB         NOT NULL DEFAULT '{}',
    synced_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, external_position_id, as_of_date)
);

CREATE TABLE integrations.xp_movements (
    id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID          NOT NULL REFERENCES auth.tenants(id),
    account_id           UUID          NOT NULL REFERENCES integrations.xp_accounts(id) ON DELETE CASCADE,
    external_movement_id TEXT          NOT NULL,
    position_external_id TEXT,
    movement_type        TEXT,
    transaction_type     TEXT,
    product_code         TEXT,
    product_name         TEXT,
    amount               NUMERIC(18,2) NOT NULL DEFAULT 0,
    quantity             NUMERIC(24,8),
    currency             CHAR(3)       NOT NULL DEFAULT 'BRL',
    occurred_at          TIMESTAMPTZ   NOT NULL,
    raw_data             JSONB         NOT NULL DEFAULT '{}',
    synced_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, external_movement_id)
);

CREATE TABLE integrations.xp_commissions (
    id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id              UUID          NOT NULL REFERENCES auth.tenants(id),
    account_id             UUID          REFERENCES integrations.xp_accounts(id) ON DELETE SET NULL,
    external_commission_id TEXT          NOT NULL,
    advisor_code           TEXT,
    product_code           TEXT,
    gross_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_amount             NUMERIC(18,2),
    competence_date        DATE          NOT NULL,
    raw_data               JSONB         NOT NULL DEFAULT '{}',
    synced_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, external_commission_id)
);

CREATE TABLE integrations.xp_sync_runs (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id          UUID        NOT NULL REFERENCES auth.tenants(id),
    connection_id      UUID        NOT NULL REFERENCES integrations.xp_connections(id) ON DELETE CASCADE,
    resource           TEXT        NOT NULL CHECK (resource IN (
                                      'accounts','positions','movements',
                                      'products','fundraising','commissions','full'
                                   )),
    status             TEXT        NOT NULL CHECK (status IN (
                                      'queued','running','success','partial','failed'
                                   )),
    cursor_value       TEXT,
    records_received   INTEGER     NOT NULL DEFAULT 0,
    records_upserted   INTEGER     NOT NULL DEFAULT 0,
    error_code         TEXT,
    error_message      TEXT,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at        TIMESTAMPTZ
);

CREATE INDEX idx_xp_accounts_client
    ON integrations.xp_accounts (tenant_id, client_id);
CREATE INDEX idx_xp_positions_account_date
    ON integrations.xp_positions (account_id, as_of_date DESC);
CREATE INDEX idx_xp_movements_account_date
    ON integrations.xp_movements (account_id, occurred_at DESC);
CREATE INDEX idx_xp_sync_runs_tenant_started
    ON integrations.xp_sync_runs (tenant_id, started_at DESC);

ALTER TABLE integrations.xp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_positions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_commissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.xp_sync_runs    ENABLE ROW LEVEL SECURITY;

CREATE POLICY xp_connections_tenant_policy ON integrations.xp_connections
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

CREATE POLICY xp_accounts_tenant_policy ON integrations.xp_accounts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

CREATE POLICY xp_positions_tenant_policy ON integrations.xp_positions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

CREATE POLICY xp_movements_tenant_policy ON integrations.xp_movements
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

CREATE POLICY xp_commissions_tenant_policy ON integrations.xp_commissions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

CREATE POLICY xp_sync_runs_tenant_policy ON integrations.xp_sync_runs
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
