-- ============================================================
-- 003_wealth_core.sql
-- Clientes, KYC, suitability, patrimônio, interações, oportunidades
-- Depende de: 001, 002
-- Nota: lead_id e interaction.lead_id recebem FK em 004 via ALTER
-- ============================================================

-- ── Clientes ─────────────────────────────────────────────────
CREATE TABLE wealth.clients (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID        NOT NULL REFERENCES auth.tenants(id),
    -- lead_id: FK adicionada em 004 após crm.leads existir
    lead_id          UUID        UNIQUE,
    full_name        TEXT        NOT NULL,
    cpf              TEXT        UNIQUE,
    birth_date       DATE,
    nationality      TEXT        NOT NULL DEFAULT 'Brasileiro',
    marital_status   TEXT        CHECK (marital_status IN
                                     ('solteiro','casado','divorciado','viuvo','uniao_estavel')),
    marital_regime   TEXT,
    profession       TEXT,
    company_name     TEXT,
    annual_income    NUMERIC(18,2),
    banker_id        UUID        NOT NULL REFERENCES auth.users(id),
    supervisor_id    UUID        REFERENCES auth.users(id),
    origem_socio_id  UUID        REFERENCES auth.users(id),
    status           TEXT        NOT NULL DEFAULT 'ativo'
                                 CHECK (status IN ('ativo','inativo','prospecto')),
    risk_profile     TEXT        CHECK (risk_profile IN
                                     ('conservador','moderado','moderado_agressivo','agressivo')),
    onboarded_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Contatos do cliente ──────────────────────────────────────
CREATE TABLE wealth.client_contacts (
    id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id  UUID    NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL CHECK (type IN ('celular','email','whatsapp','linkedin','outro')),
    value      TEXT    NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Endereços ────────────────────────────────────────────────
CREATE TABLE wealth.client_addresses (
    id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id    UUID    NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    type         TEXT    NOT NULL DEFAULT 'residencial',
    street       TEXT,
    number       TEXT,
    complement   TEXT,
    neighborhood TEXT,
    city         TEXT,
    state        CHAR(2),
    zip_code     TEXT,
    country      TEXT    NOT NULL DEFAULT 'Brasil',
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── Hierarquia familiar ──────────────────────────────────────
CREATE TABLE wealth.family_members (
    id                UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id         UUID    NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    related_client_id UUID    REFERENCES wealth.clients(id),
    full_name         TEXT    NOT NULL,
    relationship      TEXT    NOT NULL CHECK (relationship IN
                                  ('conjuge','filho','filha','pai','mae','socio','outro')),
    birth_date        DATE,
    cpf               TEXT,
    is_beneficiary    BOOLEAN NOT NULL DEFAULT FALSE,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Rede de relacionamentos (contador, advogado, CFO...) ──────
CREATE TABLE wealth.relationships (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id  UUID NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    role       TEXT,
    company    TEXT,
    phone      TEXT,
    email      TEXT,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KYC ──────────────────────────────────────────────────────
CREATE TABLE wealth.kyc (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id          UUID        NOT NULL UNIQUE REFERENCES wealth.clients(id) ON DELETE CASCADE,
    is_pep             BOOLEAN     NOT NULL DEFAULT FALSE,
    pep_description    TEXT,
    funds_origin       TEXT,
    has_international  BOOLEAN     NOT NULL DEFAULT FALSE,
    international_desc TEXT,
    fatca_status       BOOLEAN     NOT NULL DEFAULT FALSE,
    documents_verified BOOLEAN     NOT NULL DEFAULT FALSE,
    compliance_notes   TEXT,
    approved_by        UUID        REFERENCES auth.users(id),
    approved_at        TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ,
    status             TEXT        NOT NULL DEFAULT 'pendente'
                                   CHECK (status IN ('pendente','aprovado','rejeitado','expirado')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Suitability ──────────────────────────────────────────────
CREATE TABLE wealth.suitability (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id            UUID        NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    risk_profile         TEXT        NOT NULL CHECK (risk_profile IN
                                         ('conservador','moderado','moderado_agressivo','agressivo')),
    investment_horizon   TEXT        CHECK (investment_horizon IN ('curto','medio','longo')),
    volatility_tolerance TEXT,
    main_objective       TEXT,
    liquidity_pct        NUMERIC(5,2),
    offshore_interest    BOOLEAN     NOT NULL DEFAULT FALSE,
    offshore_countries   TEXT[],
    succession_planning  BOOLEAN     NOT NULL DEFAULT FALSE,
    answered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at           TIMESTAMPTZ,
    answered_by_client   BOOLEAN     NOT NULL DEFAULT TRUE,
    validated_by         UUID        REFERENCES auth.users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Categorias de ativos ─────────────────────────────────────
CREATE TABLE wealth.asset_categories (
    id    SMALLSERIAL PRIMARY KEY,
    slug  TEXT        NOT NULL UNIQUE,
    label TEXT        NOT NULL
);

-- ── Ativos patrimoniais ──────────────────────────────────────
CREATE TABLE wealth.assets (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id        UUID         NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    category_id      SMALLINT     NOT NULL REFERENCES wealth.asset_categories(id),
    name             TEXT         NOT NULL,
    description      TEXT,
    institution      TEXT,
    current_value    NUMERIC(18,2) NOT NULL,
    currency         CHAR(3)      NOT NULL DEFAULT 'BRL',
    is_under_avren   BOOLEAN      NOT NULL DEFAULT FALSE,
    acquisition_date DATE,
    notes            TEXT,
    last_updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Snapshots históricos de valor ────────────────────────────
CREATE TABLE wealth.asset_snapshots (
    id         BIGSERIAL    PRIMARY KEY,
    asset_id   UUID         NOT NULL REFERENCES wealth.assets(id) ON DELETE CASCADE,
    value      NUMERIC(18,2) NOT NULL,
    currency   CHAR(3)      NOT NULL DEFAULT 'BRL',
    snapped_at DATE         NOT NULL DEFAULT CURRENT_DATE
);

-- ── Interações / Timeline ────────────────────────────────────
CREATE TABLE wealth.interactions (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID        NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    -- lead_id: FK adicionada em 004
    lead_id         UUID,
    banker_id       UUID        NOT NULL REFERENCES auth.users(id),
    relationship_id UUID        REFERENCES wealth.relationships(id),
    type            TEXT        NOT NULL CHECK (type IN
                                    ('ligacao','whatsapp','reuniao','email','documento','outro')),
    subject         TEXT        NOT NULL,
    notes           TEXT,
    ai_summary      TEXT,
    ai_next_steps   TEXT[],
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_min    INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Oportunidades de negócio ──────────────────────────────────
CREATE TABLE wealth.opportunities (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID          NOT NULL REFERENCES auth.tenants(id),
    client_id           UUID          NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    banker_id           UUID          NOT NULL REFERENCES auth.users(id),
    type                TEXT          NOT NULL CHECK (type IN (
                                          'investimentos','offshore','previdencia','sucessao',
                                          'credito','ma','corporate'
                                      )),
    title               TEXT,
    estimated_value     NUMERIC(18,2),
    probability         NUMERIC(5,2)  CHECK (probability BETWEEN 0 AND 100),
    expected_close_date DATE,
    status              TEXT          NOT NULL DEFAULT 'open' CHECK (status IN (
                                          'open','in_progress','won','lost','on_hold'
                                      )),
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
