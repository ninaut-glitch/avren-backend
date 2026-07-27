ALTER TABLE wealth.opportunities
  ADD COLUMN IF NOT EXISTS conviction TEXT
    CHECK (conviction IN ('quente','dream')),
  ADD COLUMN IF NOT EXISTS conviction_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conviction_set_by UUID REFERENCES auth.users(id);

ALTER TABLE analytics.banker_goals
  ADD COLUMN IF NOT EXISTS hot_pipe_goal INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pipe_dream_goal INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_opportunities_conviction_month
  ON wealth.opportunities (tenant_id, conviction, conviction_set_at);

GRANT SELECT, INSERT, UPDATE ON wealth.opportunities TO avren_service;
