-- ============================================================
-- 002_auth.sql
-- Autenticação, tenants e unidades de negócio
-- Depende de: 001
-- ============================================================

-- ── Tenants ──────────────────────────────────────────────────
CREATE TABLE auth.tenants (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT        NOT NULL,
    slug       TEXT        UNIQUE NOT NULL,
    plan       TEXT        NOT NULL DEFAULT 'enterprise'
                           CHECK (plan IN ('starter','growth','enterprise')),
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Unidades de negócio ──────────────────────────────────────
-- Representa os três pilares: Wealth · Business · Community
CREATE TABLE auth.business_units (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES auth.tenants(id) ON DELETE CASCADE,
    code      TEXT NOT NULL UNIQUE,   -- 'WEALTH' | 'BUSINESS' | 'COMMUNITY'
    name      TEXT NOT NULL
);

-- ── Usuários ─────────────────────────────────────────────────
CREATE TABLE auth.users (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID        NOT NULL REFERENCES auth.tenants(id),
    business_unit_id UUID        REFERENCES auth.business_units(id),
    email            TEXT        NOT NULL UNIQUE,
    password_hash    TEXT        NOT NULL,
    mfa_secret       TEXT,
    mfa_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
    role             TEXT        NOT NULL
                                 CHECK (role IN ('banker','supervisor','socio','operacoes')),
    full_name        TEXT        NOT NULL,
    avatar_url       TEXT,
    is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sessões JWT ──────────────────────────────────────────────
CREATE TABLE auth.sessions (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT        NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit log (compliance obrigatório) ───────────────────────
CREATE TABLE auth.audit_logs (
    id          BIGSERIAL   PRIMARY KEY,
    tenant_id   UUID        REFERENCES auth.tenants(id),
    user_id     UUID        REFERENCES auth.users(id),
    action      TEXT        NOT NULL,  -- 'create'|'update'|'delete'|'view'|'export'
    entity_type TEXT        NOT NULL,  -- 'client'|'lead'|'asset'|...
    entity_id   UUID,
    old_data    JSONB,
    new_data    JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
