import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Sql } from 'postgres';
import * as webpush from 'web-push';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { SessionContext, withRls } from '../../database/rls.helper';
import {
  listActiveTenantIds,
  withSystemTenantRls,
} from '../../database/tenant-rls.helper';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');

    if (!publicKey || !privateKey || !subject) {
      this.logger.warn(
        'Web Push desativado: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ou VAPID_SUBJECT ausente.',
      );
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.enabled = true;
    this.logger.log('Web Push configurado.');
  }

  // A chave publica nao e segredo: o navegador precisa dela para se inscrever.
  getPublicKey() {
    return {
      enabled: this.enabled,
      publicKey: this.enabled ? this.config.get<string>('VAPID_PUBLIC_KEY') : null,
    };
  }

  async subscribe(ctx: SessionContext, body: any) {
    const rows = await withRls(this.sql, ctx, (sql) => sql`
      INSERT INTO crm.push_subscriptions
        (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
      VALUES (
        ${ctx.tenantId}, ${ctx.userId},
        ${body.endpoint}, ${body.keys?.p256dh}, ${body.keys?.auth},
        ${body.user_agent ?? null}
      )
      ON CONFLICT (endpoint) DO UPDATE SET
        tenant_id  = EXCLUDED.tenant_id,
        user_id    = EXCLUDED.user_id,
        p256dh     = EXCLUDED.p256dh,
        auth       = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent
      RETURNING id, created_at
    `);
    return rows[0];
  }

  async unsubscribe(ctx: SessionContext, endpoint: string) {
    await withRls(this.sql, ctx, (sql) => sql`
      DELETE FROM crm.push_subscriptions
      WHERE tenant_id = ${ctx.tenantId}
        AND user_id = ${ctx.userId}
        AND endpoint = ${endpoint}
    `);
  }

  async getStatus(ctx: SessionContext) {
    const rows = await withRls(this.sql, ctx, (sql) => sql`
      SELECT id, user_agent, created_at, last_used_at
      FROM crm.push_subscriptions
      WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId}
      ORDER BY created_at DESC
    `);
    return { enabled: this.enabled, devices: rows };
  }

  // Envia para todos os dispositivos do usuario. Inscricoes mortas
  // (404/410) sao removidas para a tabela nao acumular lixo.
  async sendToUser(ctx: SessionContext, userId: string, payload: object) {
    return this.sendToUserInTenant(ctx.tenantId, userId, payload, ctx);
  }

  private async sendToUserInTenant(
    tenantId: string,
    userId: string,
    payload: object,
    ctx?: SessionContext,
  ) {
    if (!this.enabled) return { sent: 0, removed: 0 };

    const read = (sql: any) => sql`
      SELECT id, endpoint, p256dh, auth
      FROM crm.push_subscriptions
      WHERE tenant_id = ${tenantId} AND user_id = ${userId}
    `;
    const subs = (ctx
      ? await withRls(this.sql, ctx, read)
      : await withSystemTenantRls(this.sql, tenantId, read)) as any[];

    let sent = 0;
    let removed = 0;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
        sent++;
        await withSystemTenantRls(this.sql, tenantId, (sql) => sql`
          UPDATE crm.push_subscriptions
          SET last_used_at = now()
          WHERE id = ${sub.id} AND tenant_id = ${tenantId}
        `);
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await withSystemTenantRls(this.sql, tenantId, (sql) => sql`
            DELETE FROM crm.push_subscriptions
            WHERE id = ${sub.id} AND tenant_id = ${tenantId}
          `);
          removed++;
        } else {
          this.logger.error(
            `Falha ao enviar push (sub ${sub.id}): ${err?.message ?? err}`,
          );
        }
      }
    }

    return { sent, removed };
  }

  // Resumo diario dos lembretes: 08:00 no horario de Brasilia.
  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async sendDailyReminders() {
    if (!this.enabled) return;

    const tenantIds = await listActiveTenantIds(this.sql);
    let userCount = 0;
    let totalSent = 0;

    for (const tenantId of tenantIds) {
      const rows = await withSystemTenantRls(this.sql, tenantId, (sql) => sql`
        SELECT r.user_id, COUNT(*)::int AS total, MIN(r.title) AS first_title
        FROM crm.reminders r
        WHERE r.tenant_id = ${tenantId}
          AND r.remind_at = CURRENT_DATE
          AND r.done = false
          AND EXISTS (
            SELECT 1 FROM crm.push_subscriptions p
            WHERE p.tenant_id = ${tenantId} AND p.user_id = r.user_id
          )
        GROUP BY r.user_id
      `);

      userCount += rows.length;
      for (const row of rows) {
        const total = Number(row.total);
        const body =
          total === 1
            ? row.first_title
            : `${row.first_title} e mais ${total - 1} lembrete(s)`;

        const result = await this.sendToUserInTenant(tenantId, row.user_id, {
          title: total === 1 ? 'Lembrete de hoje' : `${total} lembretes hoje`,
          body,
          url: '/dashboard',
          tag: 'daily-reminders',
        });
        totalSent += result.sent;
      }
    }

    if (userCount === 0) {
      this.logger.log('Resumo diario: nenhum lembrete para notificar.');
      return;
    }

    this.logger.log(
      `Resumo diario enviado: ${totalSent} notificacao(oes) para ${userCount} usuario(s).`,
    );
  }
}
