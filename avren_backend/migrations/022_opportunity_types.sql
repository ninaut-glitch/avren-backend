-- Novos produtos e serviços comercializados pela AVREN.

ALTER TABLE wealth.opportunities
  DROP CONSTRAINT opportunities_type_check;

ALTER TABLE wealth.opportunities
  ADD CONSTRAINT opportunities_type_check
  CHECK (type IN (
    'investimentos', 'offshore', 'previdencia', 'sucessao',
    'credito', 'ma', 'corporate', 'consorcio', 'financiamento',
    'planejamento_patrimonial', 'seguro_vida'
  ));
