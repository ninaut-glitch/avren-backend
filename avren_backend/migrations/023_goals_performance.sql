-- Metas comerciais, Pipe Dream e histórico de alterações

ALTER TABLE analytics.banker_goals
  ADD COLUMN IF NOT EXISTS revenue_goal NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS visits_goal INTEGER,
  ADD COLUMN IF NOT EXISTS pipeline_multiplier NUMERIC(5,2) NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS visit_to_hot_rate NUMERIC(5,2) NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS average_ticket NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS excluded_dates DATE[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE wealth.opportunities
  ADD COLUMN IF NOT EXISTS estimated_monthly_revenue NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS estimated_one_time_revenue NUMERIC(18,2);

ALTER TABLE analytics.revenue_entries
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS revenue_kind TEXT NOT NULL DEFAULT 'recurring'
    CHECK (revenue_kind IN ('recurring','one_time'));

CREATE TABLE IF NOT EXISTS analytics.goal_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  goal_id UUID NOT NULL REFERENCES analytics.banker_goals(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  previous_values JSONB,
  new_values JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm.pipe_dreams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES auth.tenants(id),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES wealth.opportunities(id) ON DELETE SET NULL,
  prospect_name TEXT NOT NULL,
  estimated_wealth NUMERIC(18,2),
  potential_capture NUMERIC(18,2),
  access_path TEXT,
  strategic_reason TEXT,
  next_action TEXT,
  next_action_date DATE,
  maturity TEXT NOT NULL DEFAULT 'idea'
    CHECK (maturity IN ('idea','mapped','access','approach','qualified')),
  notes TEXT,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goals_tenant_month
  ON analytics.banker_goals(tenant_id, goal_month);
CREATE INDEX IF NOT EXISTS idx_goal_history_goal
  ON analytics.goal_history(goal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipe_dream_owner
  ON crm.pipe_dreams(tenant_id, owner_id, created_at DESC);

ALTER TABLE analytics.banker_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.goal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.pipe_dreams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banker_goals_policy ON analytics.banker_goals;
CREATE POLICY banker_goals_policy ON analytics.banker_goals
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    AND (
      banker_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    AND current_setting('app.current_user_role', true) IN ('socio','admin')
  );

DROP POLICY IF EXISTS goal_history_policy ON analytics.goal_history;
CREATE POLICY goal_history_policy ON analytics.goal_history
  FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    AND current_setting('app.current_user_role', true)
       IN ('supervisor','socio','operacoes','admin')
  );

DROP POLICY IF EXISTS pipe_dream_policy ON crm.pipe_dreams;
CREATE POLICY pipe_dream_policy ON crm.pipe_dreams
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    AND (
      owner_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    AND (
      owner_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
      OR current_setting('app.current_user_role', true)
         IN ('supervisor','socio','operacoes','admin')
    )
  );

GRANT SELECT ON analytics.banker_goals, analytics.goal_history, crm.pipe_dreams
  TO avren_banker, avren_readonly;
GRANT INSERT, UPDATE ON crm.pipe_dreams TO avren_banker;
GRANT INSERT, UPDATE ON analytics.banker_goals, analytics.goal_history
  TO avren_service;
