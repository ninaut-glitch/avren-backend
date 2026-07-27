-- Permite iniciar o Planejamento Patrimonial antes da conversão em cliente.

ALTER TABLE wealth.patrimonial_plans
  ALTER COLUMN client_id DROP NOT NULL,
  ADD COLUMN lead_id UUID REFERENCES crm.leads(id) ON DELETE CASCADE;

ALTER TABLE wealth.patrimonial_plans
  ADD CONSTRAINT patrimonial_plans_subject_check
  CHECK (
    (client_id IS NOT NULL AND lead_id IS NULL)
    OR (client_id IS NULL AND lead_id IS NOT NULL)
  );

ALTER TABLE wealth.patrimonial_plans
  DROP CONSTRAINT patrimonial_plans_tenant_id_client_id_key;

CREATE UNIQUE INDEX uq_pp_plan_client
  ON wealth.patrimonial_plans (tenant_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX uq_pp_plan_lead
  ON wealth.patrimonial_plans (tenant_id, lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX idx_pp_plans_lead
  ON wealth.patrimonial_plans (tenant_id, lead_id);
