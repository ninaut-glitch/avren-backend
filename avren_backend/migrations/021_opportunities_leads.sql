-- Oportunidades podem nascer no Pipeline, antes da conversão em cliente.

ALTER TABLE wealth.opportunities
  ALTER COLUMN client_id DROP NOT NULL,
  ADD COLUMN lead_id UUID REFERENCES crm.leads(id) ON DELETE CASCADE;

ALTER TABLE wealth.opportunities
  ADD CONSTRAINT opportunities_subject_check
  CHECK (
    (client_id IS NOT NULL AND lead_id IS NULL)
    OR (client_id IS NULL AND lead_id IS NOT NULL)
  );

CREATE INDEX idx_opportunities_lead ON wealth.opportunities(lead_id);
