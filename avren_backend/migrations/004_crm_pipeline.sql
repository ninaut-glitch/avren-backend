-- ============================================================
-- 004_crm_pipeline.sql
-- Pipeline de leads, stage history e tasks
-- Depende de: 001, 002, 003
-- crm.tasks criada APÓS wealth.clients e wealth.opportunities
-- FK para ai.interaction_summaries adicionada via ALTER em 007
-- ============================================================

-- ── Leads ────────────────────────────────────────────────────
CREATE TABLE crm.leads (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID        NOT NULL REFERENCES auth.tenants(id),
    full_name               TEXT        NOT NULL,
    email                   TEXT,
    phone                   TEXT,
    stage                   TEXT        NOT NULL DEFAULT 'lead'
                                        CHECK (stage IN (
                                            'lead','contato','diagnostico','proposta',
                                            'negociacao','documentacao','cliente_ativo','perdido'
                                        )),
    banker_id               UUID        NOT NULL REFERENCES auth.users(id),
    origem_id               UUID        REFERENCES auth.users(id),
    origem_tipo             TEXT        CHECK (origem_tipo IN (
                                            'socio','banker','evento','digital','indicacao'
                                        )),
    contexto_relacionamento TEXT,
    estimated_aum           NUMERIC(18,2),
    priority                TEXT        NOT NULL DEFAULT 'med'
                                        CHECK (priority IN ('high','med','low')),
    loss_reason             TEXT,
    loss_notes              TEXT,
    converted_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Histórico de stages ──────────────────────────────────────
CREATE TABLE crm.lead_stage_history (
    id            BIGSERIAL   PRIMARY KEY,
    lead_id       UUID        NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
    from_stage    TEXT,
    to_stage      TEXT        NOT NULL,
    changed_by    UUID        REFERENCES auth.users(id),
    days_in_stage INTEGER,
    notes         TEXT,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── FKs cruzadas (wealth ↔ crm) ──────────────────────────────
-- Adicionadas aqui: crm.leads já existe, wealth.clients e
-- wealth.interactions foram criadas em 003 sem FK

ALTER TABLE wealth.clients
    ADD CONSTRAINT fk_client_lead
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);

ALTER TABLE wealth.interactions
    ADD CONSTRAINT fk_interaction_lead
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);

-- ── Tasks ────────────────────────────────────────────────────
-- Criada após wealth.clients e wealth.opportunities (003)
-- ai_summary_id adicionada via ALTER em 007
CREATE TABLE crm.tasks (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id      UUID        NOT NULL REFERENCES auth.tenants(id),
    assigned_to    UUID        NOT NULL REFERENCES auth.users(id),
    created_by     UUID        REFERENCES auth.users(id),
    client_id      UUID        REFERENCES wealth.clients(id),
    lead_id        UUID        REFERENCES crm.leads(id),
    opportunity_id UUID        REFERENCES wealth.opportunities(id),
    title          TEXT        NOT NULL,
    description    TEXT,
    due_date       TIMESTAMPTZ,
    status         TEXT        NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open','in_progress','done','cancelled')),
    priority       TEXT        NOT NULL DEFAULT 'medium'
                               CHECK (priority IN ('low','medium','high','urgent')),
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
