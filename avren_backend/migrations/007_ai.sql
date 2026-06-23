-- ============================================================
-- 007_ai.sql
-- Resumos de IA e fila de processamento
-- Depende de: 001, 002, 003, 004
-- FK crm.tasks → ai.interaction_summaries adicionada aqui
-- ============================================================

-- ── Resumos gerados por IA ────────────────────────────────────
CREATE TABLE ai.interaction_summaries (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    interaction_id    UUID        NOT NULL REFERENCES wealth.interactions(id) ON DELETE CASCADE,
    client_id         UUID        NOT NULL REFERENCES wealth.clients(id) ON DELETE CASCADE,
    banker_id         UUID        NOT NULL REFERENCES auth.users(id),
    summary           TEXT        NOT NULL,
    sentiment         TEXT        CHECK (sentiment IN ('positivo','neutro','negativo')),
    opportunity_level TEXT        CHECK (opportunity_level IN ('baixa','media','alta')),
    detected_needs    TEXT[],
    next_steps        TEXT[],
    model_name        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Fila de processamento ─────────────────────────────────────
-- Worker consome com: SELECT ... FOR UPDATE SKIP LOCKED
CREATE TABLE ai.pending_jobs (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    interaction_id UUID        NOT NULL REFERENCES wealth.interactions(id) ON DELETE CASCADE,
    status         TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','processing','done','error')),
    error_msg      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at   TIMESTAMPTZ
);

-- ── Trigger: enfileira toda nova interação automaticamente ────
CREATE OR REPLACE FUNCTION ai.fn_enqueue_interaction_summary()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO ai.pending_jobs (interaction_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── FK cruzada: crm.tasks → ai.interaction_summaries ─────────
-- Adicionada aqui porque ai.interaction_summaries só existe a partir deste arquivo
ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS ai_summary_id UUID
    REFERENCES ai.interaction_summaries(id);
