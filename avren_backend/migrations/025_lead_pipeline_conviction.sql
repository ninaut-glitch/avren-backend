ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS conviction TEXT
    CHECK (conviction IN ('quente','dream')),
  ADD COLUMN IF NOT EXISTS conviction_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conviction_set_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_leads_conviction_month
  ON crm.leads (tenant_id, banker_id, conviction, conviction_set_at);

GRANT SELECT, INSERT, UPDATE ON crm.leads TO avren_service;
