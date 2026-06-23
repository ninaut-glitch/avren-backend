-- ============================================================
-- 006_compliance.sql
-- Alertas de KYC/Suitability, histórico, notificações
-- Depende de: 001, 002, 003
-- Ordem interna: tabelas → view → trigger → função
-- pending_notifications declarada ANTES de fn_sync_kyc_alerts
-- ============================================================

-- ── Alertas: tabela central com ciclo de vida ─────────────────
CREATE TABLE compliance.alerts (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID        NOT NULL REFERENCES auth.tenants(id),
    client_id   UUID        NOT NULL REFERENCES wealth.clients(id),
    banker_id   UUID        NOT NULL REFERENCES auth.users(id),
    alert_type  TEXT        NOT NULL,
    severity    TEXT        NOT NULL DEFAULT 'medium'
                            CHECK (severity IN ('low','medium','high','critical')),
    title       TEXT        NOT NULL,
    description TEXT,
    status      TEXT        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','resolved','dismissed')),
    due_date    DATE,
    resolved_by UUID        REFERENCES auth.users(id),
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Histórico de transições de status ────────────────────────
CREATE TABLE compliance.alert_history (
    id          BIGSERIAL   PRIMARY KEY,
    alert_id    UUID        NOT NULL REFERENCES compliance.alerts(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT        NOT NULL,
    changed_by  UUID        REFERENCES auth.users(id),
    notes       TEXT,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Fila de notificações ──────────────────────────────────────
-- Declarada antes de fn_sync_kyc_alerts, que insere aqui
CREATE TABLE compliance.pending_notifications (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id     UUID        NOT NULL REFERENCES compliance.alerts(id) ON DELETE CASCADE,
    channel      TEXT        NOT NULL DEFAULT 'email'
                             CHECK (channel IN ('email','sistema','whatsapp')),
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at      TIMESTAMPTZ,
    status       TEXT        NOT NULL DEFAULT 'pendente'
                             CHECK (status IN ('pendente','enviado','erro')),
    error_msg    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── View de detecção de alertas ───────────────────────────────
CREATE VIEW compliance.kyc_alerts AS
    SELECT
        c.id                        AS client_id,
        c.full_name,
        c.tenant_id,
        c.banker_id,
        k.status                    AS kyc_status,
        k.expires_at                AS kyc_expires_at,
        s.expires_at                AS suitability_expires_at,
        CASE
            WHEN k.id IS NULL
                                             THEN 'kyc_nao_iniciado'
            WHEN k.status = 'rejeitado'      THEN 'kyc_rejeitado'
            WHEN k.expires_at < NOW()        THEN 'kyc_expirado'
            WHEN k.expires_at <= NOW() + INTERVAL '30 days'
                                             THEN 'kyc_vencendo'
            WHEN s.expires_at < NOW()        THEN 'suitability_expirado'
            WHEN s.expires_at <= NOW() + INTERVAL '30 days'
                                             THEN 'suitability_vencendo'
            ELSE 'ok'
        END                         AS alert_type
    FROM wealth.clients c
    LEFT JOIN wealth.kyc         k ON k.client_id = c.id
    LEFT JOIN wealth.suitability s ON s.client_id = c.id
    WHERE c.status = 'ativo';

-- ── Trigger: grava toda transição de status ───────────────────
CREATE OR REPLACE FUNCTION compliance.fn_log_alert_status()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO compliance.alert_history (alert_id, from_status, to_status, changed_at)
        VALUES (OLD.id, OLD.status, NEW.status, NOW());

        IF NEW.status = 'resolved' THEN
            NEW.resolved_at = NOW();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Função: materializa alertas e enfileira notificações ──────
-- Idempotente: NOT EXISTS em ambos os INSERTs
-- Chamada diariamente por pg_cron / EventBridge às 07h
CREATE OR REPLACE FUNCTION compliance.fn_sync_kyc_alerts()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    INSERT INTO compliance.alerts (
        tenant_id, client_id, banker_id,
        alert_type, severity, title, description, due_date
    )
    SELECT
        ka.tenant_id,
        ka.client_id,
        ka.banker_id,
        ka.alert_type,
        CASE ka.alert_type
            WHEN 'kyc_rejeitado'        THEN 'critical'
            WHEN 'kyc_expirado'         THEN 'critical'
            WHEN 'suitability_expirado' THEN 'high'
            WHEN 'kyc_vencendo'         THEN 'high'
            WHEN 'suitability_vencendo' THEN 'medium'
            WHEN 'kyc_nao_iniciado'     THEN 'medium'
            ELSE                             'low'
        END,
        CASE ka.alert_type
            WHEN 'kyc_rejeitado'        THEN 'KYC rejeitado pelo compliance'
            WHEN 'kyc_expirado'         THEN 'KYC expirado — renovação obrigatória'
            WHEN 'kyc_vencendo'         THEN 'KYC vence nos próximos 30 dias'
            WHEN 'kyc_nao_iniciado'     THEN 'KYC não foi iniciado'
            WHEN 'suitability_expirado' THEN 'Suitability expirado — reaplicar questionário'
            WHEN 'suitability_vencendo' THEN 'Suitability vence nos próximos 30 dias'
        END,
        'Cliente: ' || ka.full_name,
        (CURRENT_DATE + INTERVAL '7 days')::DATE
    FROM compliance.kyc_alerts ka
    WHERE ka.alert_type <> 'ok'
      AND NOT EXISTS (
              SELECT 1 FROM compliance.alerts a
              WHERE  a.client_id  = ka.client_id
                AND  a.alert_type = ka.alert_type
                AND  a.status     NOT IN ('resolved','dismissed')
          );

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Enfileira notificações para todos os alertas abertos sem pendência
    INSERT INTO compliance.pending_notifications (alert_id, channel)
    SELECT a.id, 'sistema'
    FROM   compliance.alerts a
    WHERE  a.status = 'open'
      AND  NOT EXISTS (
               SELECT 1 FROM compliance.pending_notifications pn
               WHERE  pn.alert_id = a.id
                 AND  pn.status   = 'pendente'
           );

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
