-- ============================================================
-- 027_push_subscriptions.sql
-- Armazena as inscricoes Web Push (PWA) por usuario/dispositivo.
-- Um usuario pode ter varias inscricoes (celular, desktop, etc).
-- Nenhuma credencial VAPID e guardada aqui: as chaves ficam
-- apenas nas variaveis de ambiente do servico avren-api.
-- Depende de: 013 (roles), auth.tenants, auth.users
-- ============================================================

CREATE TABLE IF NOT EXISTS crm.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES auth.tenants(id),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  endpoint     text NOT NULL,
  p256dh       text NOT NULL,
  auth         text NOT NULL,

  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,

  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON crm.push_subscriptions (tenant_id, user_id);

GRANT ALL PRIVILEGES ON crm.push_subscriptions TO avren_service;

GRANT SELECT (id, tenant_id, user_id, user_agent, created_at, last_used_at)
  ON crm.push_subscriptions TO avren_readonly;
