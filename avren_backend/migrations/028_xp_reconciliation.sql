-- ============================================================
-- 028_xp_reconciliation.sql (v3)
-- Conciliacao manual conta XP <-> cliente e metadados de execucao.
-- Fonte de verdade: 018 e 026 (nao alteradas).
--
-- xp_accounts.client_id JA EXISTE na 018 (FK wealth.clients) e nao
-- e recriado. Ordem desta migration: colunas -> BACKFILL -> CHECKs,
-- para funcionar com tabela vazia OU com dados existentes (contas
-- ja vinculadas via client_id recebem link_status='linked').
-- ============================================================

-- ── xp_accounts: colunas de conciliacao (sem CHECK ainda) ────
ALTER TABLE integrations.xp_accounts
  ADD COLUMN IF NOT EXISTS suggested_client_id UUID
    REFERENCES wealth.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_status TEXT NOT NULL DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS linked_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

-- ── BACKFILL antes de qualquer constraint ────────────────────
-- Contas que ja possuem client_id (vinculadas por processos
-- anteriores) viram 'linked'; todas as demais ficam 'unlinked'.
UPDATE integrations.xp_accounts
SET link_status = 'linked'
WHERE client_id IS NOT NULL
  AND link_status <> 'linked';

UPDATE integrations.xp_accounts
SET link_status = 'unlinked'
WHERE client_id IS NULL
  AND link_status NOT IN ('unlinked', 'ignored');

-- ── CHECKs (apos o backfill, validos para 0 ou N linhas) ─────
ALTER TABLE integrations.xp_accounts
  DROP CONSTRAINT IF EXISTS xp_accounts_link_status_check;
ALTER TABLE integrations.xp_accounts
  ADD CONSTRAINT xp_accounts_link_status_check
  CHECK (link_status IN ('unlinked', 'suggested', 'linked', 'ignored'));

-- Coerencia: 'linked' exige client_id; qualquer outro status exige
-- client_id nulo (evita estado zumbi de vinculo).
ALTER TABLE integrations.xp_accounts
  DROP CONSTRAINT IF EXISTS xp_accounts_link_coherence_check;
ALTER TABLE integrations.xp_accounts
  ADD CONSTRAINT xp_accounts_link_coherence_check
  CHECK (
    (link_status = 'linked' AND client_id IS NOT NULL)
    OR (link_status <> 'linked' AND client_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_xp_accounts_link_status
  ON integrations.xp_accounts (tenant_id, link_status);

-- ── xp_sync_runs: origem do disparo e marcacao de dry-run ────
-- error_code/error_message e records_received/records_upserted da 018
-- sao reusados; nada e duplicado.
ALTER TABLE integrations.xp_sync_runs
  ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE integrations.xp_sync_runs
  DROP CONSTRAINT IF EXISTS xp_sync_runs_trigger_source_check;
ALTER TABLE integrations.xp_sync_runs
  ADD CONSTRAINT xp_sync_runs_trigger_source_check
  CHECK (trigger_source IN ('manual', 'cron', 'fixture'));

-- Grants: herdados da 026 (ALL para avren_service; SELECT por tabela
-- para avren_readonly cobre colunas novas automaticamente).
