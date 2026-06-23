-- ============================================================
-- 011_seed_data.sql
-- Dados iniciais: tenant AVREN, unidades, usuários, metas
-- Depende de: 001 a 010
-- Idempotente: todo INSERT usa ON CONFLICT DO NOTHING
-- UUIDs literais fixos — necessário para idempotência e testes
--
-- ATENÇÃO: substituir password_hash antes do primeiro deploy
-- Gerar com: node -e "console.log(require('bcrypt').hashSync('Avren@2026!', 12))"
-- ============================================================

BEGIN;

-- ── Tenant ───────────────────────────────────────────────────
INSERT INTO auth.tenants (id, name, slug, plan, is_active)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'AVREN',
    'avren',
    'enterprise',
    TRUE
)
ON CONFLICT (slug) DO NOTHING;

-- ── Unidades de negócio ──────────────────────────────────────
INSERT INTO auth.business_units (id, tenant_id, code, name)
VALUES
    (
        'b0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'WEALTH',
        'Wealth Management'
    ),
    (
        'b0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'BUSINESS',
        'Business Advisory'
    ),
    (
        'b0000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        'COMMUNITY',
        'Community & Members Club'
    )
ON CONFLICT (code) DO NOTHING;

-- ── Usuários iniciais ────────────────────────────────────────
-- UUIDs: formato válido começando com dígito (10000000-...)
INSERT INTO auth.users (
    id, tenant_id, business_unit_id,
    email, password_hash,
    full_name, role, mfa_enabled, is_active
)
VALUES
    -- Sócio: visibilidade global
    (
        '10000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'ricardo.santos@avren.com.br',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_001',
        'Ricardo Santos', 'socio', TRUE, TRUE
    ),
    -- Supervisora
    (
        '10000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'fernanda.costa@avren.com.br',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_002',
        'Fernanda Costa', 'supervisor', TRUE, TRUE
    ),
    -- Bankers
    (
        '10000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'ana.mota@avren.com.br',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_003',
        'Ana Mota', 'banker', FALSE, TRUE
    ),
    (
        '10000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'pedro.telles@avren.com.br',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_004',
        'Pedro Telles', 'banker', FALSE, TRUE
    ),
    (
        '10000000-0000-0000-0000-000000000005',
        'a0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'carla.lima@avren.com.br',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_005',
        'Carla Lima', 'banker', FALSE, TRUE
    ),
    (
        '10000000-0000-0000-0000-000000000006',
        'a0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'marcos.reis@avren.com.br',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_006',
        'Marcos Reis', 'banker', FALSE, TRUE
    ),
    -- Operações / Compliance
    (
        '10000000-0000-0000-0000-000000000007',
        'a0000000-0000-0000-0000-000000000001',
        NULL,
        'operacoes@avren.com.br',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_007',
        'Equipe de Operações', 'operacoes', TRUE, TRUE
    )
ON CONFLICT (email) DO NOTHING;

-- ── Metas de junho/2026 ──────────────────────────────────────
INSERT INTO analytics.banker_goals (
    id, tenant_id, banker_id, goal_month,
    captacao_goal, leads_goal, conversions_goal
)
VALUES
    (
        'c0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000003',
        '2026-06-01', 40000000, 25, 4
    ),
    (
        'c0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000004',
        '2026-06-01', 40000000, 20, 3
    ),
    (
        'c0000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000005',
        '2026-06-01', 33000000, 18, 2
    ),
    (
        'c0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000006',
        '2026-06-01', 28000000, 14, 2
    )
ON CONFLICT (tenant_id, banker_id, goal_month) DO NOTHING;

-- ── Categorias de ativos ──────────────────────────────────────
INSERT INTO wealth.asset_categories (slug, label)
VALUES
    ('financeiro',  'Financeiro'),
    ('imobiliario', 'Imobiliário'),
    ('empresas',    'Empresas e Holdings'),
    ('offshore',    'Offshore'),
    ('outros',      'Outros')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
