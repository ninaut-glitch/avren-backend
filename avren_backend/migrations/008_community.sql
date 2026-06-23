-- ============================================================
-- 008_community.sql
-- Members Club · Capital Social · Eventos
-- Depende de: 001, 002, 003
-- ============================================================

-- ── Eventos ──────────────────────────────────────────────────
CREATE TABLE community.events (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID        NOT NULL REFERENCES auth.tenants(id),
    business_unit_id UUID        REFERENCES auth.business_units(id),
    title            TEXT        NOT NULL,
    event_date       TIMESTAMPTZ NOT NULL,
    location         TEXT,
    modality         TEXT        NOT NULL DEFAULT 'presencial'
                                 CHECK (modality IN ('presencial','online','hibrido')),
    capacity         INTEGER,
    description      TEXT,
    created_by       UUID        REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Participantes ─────────────────────────────────────────────
CREATE TABLE community.event_participants (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id   UUID        NOT NULL REFERENCES community.events(id) ON DELETE CASCADE,
    client_id  UUID        NOT NULL REFERENCES wealth.clients(id),
    status     TEXT        NOT NULL DEFAULT 'invited'
                           CHECK (status IN ('invited','confirmed','attended','no_show')),
    invited_by UUID        REFERENCES auth.users(id),
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, client_id)
);
