-- ============================================================
-- 015_demo_data.sql
-- Dados de demonstração realistas para QA e demo comercial
-- Depende de: 011 (seed) — usa os UUIDs do tenant e usuários
-- Idempotente: ON CONFLICT DO NOTHING em todos os INSERTs
-- NÃO executar em produção
-- ============================================================

BEGIN;

-- ── Clientes demo ─────────────────────────────────────────────
INSERT INTO wealth.clients (
    id, tenant_id, full_name, cpf,
    birth_date, marital_status, profession, company_name,
    annual_income, banker_id, status, risk_profile, onboarded_at
)
VALUES
    (
        'cc000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'João Ferreira', '111.222.333-44',
        '1971-03-12', 'casado', 'Sócio-Diretor', 'Ferreira Agro S.A.',
        8400000, '10000000-0000-0000-0000-000000000003',
        'ativo', 'moderado_agressivo', '2023-03-15 10:00:00+00'
    ),
    (
        'cc000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'Família Nogueira', '222.333.444-55',
        '1965-07-22', 'casado', 'Empresário', 'Grupo Nogueira',
        22000000, '10000000-0000-0000-0000-000000000003',
        'ativo', 'agressivo', '2022-11-01 09:00:00+00'
    ),
    (
        'cc000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        'Roberto Alves', '333.444.555-66',
        '1978-09-05', 'casado', 'Executivo C-Level', 'TechCorp Brasil',
        4800000, '10000000-0000-0000-0000-000000000004',
        'ativo', 'moderado', '2023-08-20 14:00:00+00'
    ),
    (
        'cc000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000001',
        'Elaine Pinto', '444.555.666-77',
        '1982-12-18', 'divorciado', 'Médica', 'Clínica Pinto',
        3200000, '10000000-0000-0000-0000-000000000005',
        'ativo', 'conservador', '2024-01-10 11:00:00+00'
    ),
    (
        'cc000000-0000-0000-0000-000000000005',
        'a0000000-0000-0000-0000-000000000001',
        'Holding Esteves', '555.666.777-88',
        '1958-04-30', 'casado', 'Empresário', 'Grupo Esteves',
        41000000, '10000000-0000-0000-0000-000000000003',
        'ativo', 'agressivo', '2021-06-15 08:00:00+00'
    )
ON CONFLICT (cpf) DO NOTHING;

-- ── Ativos patrimoniais demo ──────────────────────────────────
INSERT INTO wealth.assets (
    id, client_id, category_id, name,
    current_value, is_under_avren, currency
)
VALUES
    -- João Ferreira: financeiro
    ('aa000000-0000-0000-0000-000000000001',
     'cc000000-0000-0000-0000-000000000001', 1,
     'Carteira AVREN — RF + FI', 8400000, TRUE, 'BRL'),
    -- João Ferreira: imobiliário
    ('aa000000-0000-0000-0000-000000000002',
     'cc000000-0000-0000-0000-000000000001', 2,
     'Imóvel Residencial SP', 2800000, FALSE, 'BRL'),
    -- João Ferreira: imobiliário
    ('aa000000-0000-0000-0000-000000000003',
     'cc000000-0000-0000-0000-000000000001', 2,
     'Fazenda MT', 400000, FALSE, 'BRL'),
    -- João Ferreira: empresas
    ('aa000000-0000-0000-0000-000000000004',
     'cc000000-0000-0000-0000-000000000001', 3,
     'Ferreira Agro S.A.', 1900000, FALSE, 'BRL'),
    -- Holding Esteves: financeiro
    ('aa000000-0000-0000-0000-000000000005',
     'cc000000-0000-0000-0000-000000000005', 1,
     'Carteira AVREN — Multimercado', 28000000, TRUE, 'BRL'),
    -- Holding Esteves: offshore
    ('aa000000-0000-0000-0000-000000000006',
     'cc000000-0000-0000-0000-000000000005', 4,
     'BVI Holding — EUA', 13000000, FALSE, 'USD')
ON CONFLICT DO NOTHING;

-- ── Leads no pipeline demo ────────────────────────────────────
INSERT INTO crm.leads (
    id, tenant_id, full_name, email, phone,
    stage, banker_id, origem_tipo,
    contexto_relacionamento, estimated_aum, priority
)
VALUES
    (
        'dd000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'Dr. Paulo Mendes', 'paulo.mendes@email.com', '(11) 99001-0001',
        'diagnostico', '10000000-0000-0000-0000-000000000004',
        'evento', 'Médico cirurgião, alta liquidez, busca diversificação offshore.',
        12000000, 'high'
    ),
    (
        'dd000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'Grupo Cavalcanti', 'financeiro@cavalcanti.com.br', '(11) 3300-0002',
        'proposta', '10000000-0000-0000-0000-000000000003',
        'socio', 'Holding com 3 empresas. Interesse em estrutura offshore + FIIs.',
        41000000, 'high'
    ),
    (
        'dd000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        'Sra. Beatriz Cunha', 'beatriz.cunha@email.com', '(11) 99003-0003',
        'contato', '10000000-0000-0000-0000-000000000005',
        'indicacao', 'Herança recente, sem experiência em investimentos.',
        5000000, 'med'
    ),
    (
        'dd000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000001',
        'Construtora Paragon', 'contato@paragon.com.br', '(11) 3000-0004',
        'negociacao', '10000000-0000-0000-0000-000000000005',
        'evento', 'Construtora de médio porte. Negociação de fee em andamento.',
        22000000, 'high'
    ),
    (
        'dd000000-0000-0000-0000-000000000005',
        'a0000000-0000-0000-0000-000000000001',
        'Família Teixeira', 'teixeira@email.com', '(11) 99005-0005',
        'cliente_ativo', '10000000-0000-0000-0000-000000000004',
        'socio', 'Onboarding concluído. Patrimônio diversificado.',
        24000000, 'low'
    )
ON CONFLICT DO NOTHING;

-- ── Interações demo ───────────────────────────────────────────
INSERT INTO wealth.interactions (
    id, client_id, banker_id, type, subject, notes,
    ai_summary, ai_next_steps, occurred_at, duration_min
)
VALUES
    (
        'ee000000-0000-0000-0000-000000000001',
        'cc000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000003',
        'reuniao',
        'Check-in mensal Q2 2026',
        'Satisfação com rentabilidade. Pediu análise de imóvel em Lisboa.',
        'Cliente satisfeito com a carteira. Solicitou análise de alocação imobiliária internacional.',
        ARRAY['Enviar análise de imóvel em Lisboa até sexta', 'Agendar reunião com área jurídica sobre offshore'],
        '2026-06-10 14:00:00+00', 90
    ),
    (
        'ee000000-0000-0000-0000-000000000002',
        'cc000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000003',
        'ligacao',
        'Revisão de portfólio — realocação RF',
        'Cliente solicitou análise de realocação em renda fixa de longo prazo.',
        'Interesse em aumentar exposição em LCI/LCA. Aversão a volatilidade no curto prazo.',
        ARRAY['Preparar proposta de realocação RF para aprovação', 'Comparar CDBs IPCA+ vs Tesouro IPCA+'],
        '2026-06-22 09:42:00+00', 35
    ),
    (
        'ee000000-0000-0000-0000-000000000003',
        'cc000000-0000-0000-0000-000000000005',
        '10000000-0000-0000-0000-000000000003',
        'reuniao',
        'Negociação de fee — Holding Esteves',
        'CFO solicitou redução de fee para o bloco offshore. Decisão pendente com sócio.',
        'Negociação sensível: cliente de alta relevância. CFO pressionando por fee < 0,8% a.a.',
        ARRAY['Escalar para Ricardo Santos antes de responder', 'Preparar contraoferta com benefícios adicionais'],
        '2026-06-18 15:00:00+00', 60
    )
ON CONFLICT DO NOTHING;

-- ── Oportunidades demo ────────────────────────────────────────
INSERT INTO wealth.opportunities (
    id, tenant_id, client_id, banker_id,
    type, title, estimated_value, probability,
    expected_close_date, status
)
VALUES
    (
        'ff000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'cc000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000003',
        'offshore', 'Estrutura BVI para sucessão familiar',
        800000, 70, '2026-09-30', 'in_progress'
    ),
    (
        'ff000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'cc000000-0000-0000-0000-000000000005',
        '10000000-0000-0000-0000-000000000003',
        'ma', 'M&A — Desinvestimento divisão industrial',
        15000000, 40, '2026-12-31', 'open'
    ),
    (
        'ff000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        'cc000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000004',
        'previdencia', 'PGBL executivo — aporte R$300k/ano',
        300000, 85, '2026-07-31', 'in_progress'
    )
ON CONFLICT DO NOTHING;

-- ── Tasks demo ────────────────────────────────────────────────
INSERT INTO crm.tasks (
    id, tenant_id, assigned_to, created_by,
    client_id, title, priority, status, due_date
)
VALUES
    (
        'tt000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000003',
        'cc000000-0000-0000-0000-000000000001',
        'Enviar análise de imóvel Lisboa para João Ferreira',
        'high', 'open', '2026-06-27 18:00:00+00'
    ),
    (
        'tt000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000003',
        'cc000000-0000-0000-0000-000000000005',
        'Escalar negociação de fee Holding Esteves com Ricardo Santos',
        'urgent', 'open', '2026-06-24 12:00:00+00'
    ),
    (
        'tt000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000004',
        '10000000-0000-0000-0000-000000000004',
        'cc000000-0000-0000-0000-000000000003',
        'Apresentar proposta PGBL para Roberto Alves',
        'high', 'open', '2026-06-30 17:00:00+00'
    )
ON CONFLICT DO NOTHING;

-- ── KYC demo ──────────────────────────────────────────────────
INSERT INTO wealth.kyc (
    id, client_id, is_pep, funds_origin,
    has_international, fatca_status,
    documents_verified, status,
    approved_by, approved_at, expires_at
)
VALUES
    (
        'kk000000-0000-0000-0000-000000000001',
        'cc000000-0000-0000-0000-000000000001',
        FALSE, 'Atividade empresarial',
        TRUE, FALSE, TRUE, 'aprovado',
        '10000000-0000-0000-0000-000000000007',
        '2026-06-01 10:00:00+00',
        '2027-06-01 10:00:00+00'
    ),
    -- KYC expirado para demonstrar alerta
    (
        'kk000000-0000-0000-0000-000000000002',
        'cc000000-0000-0000-0000-000000000004',
        FALSE, 'Rendimentos profissionais',
        FALSE, FALSE, TRUE, 'expirado',
        '10000000-0000-0000-0000-000000000007',
        '2025-06-01 10:00:00+00',
        '2026-06-01 10:00:00+00'
    )
ON CONFLICT (client_id) DO NOTHING;

-- ── Evento demo ───────────────────────────────────────────────
INSERT INTO community.events (
    id, tenant_id, business_unit_id, title,
    event_date, location, modality, capacity, description,
    created_by
)
VALUES (
    'ev000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000003',
    'AVREN Wealth Summit 2026',
    '2026-08-20 18:00:00+00',
    'Casa AVREN — Jardins, São Paulo',
    'presencial', 60,
    'Encontro exclusivo para membros: tendências macro, offshore e sucessão patrimonial.',
    '10000000-0000-0000-0000-000000000001'
)
ON CONFLICT DO NOTHING;

INSERT INTO community.event_participants (event_id, client_id, status, invited_by)
VALUES
    ('ev000000-0000-0000-0000-000000000001',
     'cc000000-0000-0000-0000-000000000001',
     'confirmed', '10000000-0000-0000-0000-000000000003'),
    ('ev000000-0000-0000-0000-000000000001',
     'cc000000-0000-0000-0000-000000000005',
     'invited', '10000000-0000-0000-0000-000000000003')
ON CONFLICT (event_id, client_id) DO NOTHING;

COMMIT;
