import { Injectable, Inject } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { SessionContext, withRls } from '../../database/rls.helper';

@Injectable()
export class RemindersService {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAll(ctx: SessionContext, filters: { date?: string; done?: boolean }) {
    return withRls(this.sql, ctx, (sql) => sql`
      SELECT r.*, l.full_name AS lead_name, l.phone AS lead_phone, u.full_name AS user_name
      FROM crm.reminders r
      JOIN auth.users u ON u.id = r.user_id
      LEFT JOIN crm.leads l ON l.id = r.lead_id
      WHERE r.tenant_id = ${ctx.tenantId}
        AND r.user_id = ${ctx.userId}
        ${filters.done != null ? this.sql`AND r.done = ${filters.done}` : this.sql``}
        ${filters.date ? this.sql`AND r.remind_at = ${filters.date}::date` : this.sql``}
      ORDER BY r.remind_at ASC, r.created_at ASC
    `)
  }

  async findAllTenant(ctx: SessionContext, filters: { date?: string; done?: boolean }) {
    return withRls(this.sql, ctx, (sql) => sql`
      SELECT r.*, l.full_name AS lead_name, l.phone AS lead_phone, u.full_name AS user_name
      FROM crm.reminders r
      JOIN auth.users u ON u.id = r.user_id
      LEFT JOIN crm.leads l ON l.id = r.lead_id
      WHERE r.tenant_id = ${ctx.tenantId}
        ${filters.done != null ? this.sql`AND r.done = ${filters.done}` : this.sql``}
        ${filters.date ? this.sql`AND r.remind_at = ${filters.date}::date` : this.sql``}
      ORDER BY r.remind_at ASC, r.created_at ASC
    `)
  }

  async findToday(ctx: SessionContext) {
    return withRls(this.sql, ctx, (sql) => sql`
      SELECT r.*, l.full_name AS lead_name, l.phone AS lead_phone, u.full_name AS user_name, u.email AS user_email
      FROM crm.reminders r
      JOIN auth.users u ON u.id = r.user_id
      LEFT JOIN crm.leads l ON l.id = r.lead_id
      WHERE r.tenant_id = ${ctx.tenantId}
        AND r.remind_at = CURRENT_DATE
        AND r.done = false
      ORDER BY r.created_at ASC
    `)
  }

  async create(ctx: SessionContext, body: any) {
    const rows = await withRls(this.sql, ctx, (sql) => sql`
      INSERT INTO crm.reminders (tenant_id, user_id, lead_id, title, remind_at, notes)
      VALUES (
        ${ctx.tenantId}, ${ctx.userId}, ${body.lead_id ?? null},
        ${body.title}, ${body.remind_at}::date, ${body.notes ?? null}
      )
      RETURNING *
    `)
    return rows[0]
  }

  async update(ctx: SessionContext, id: string, body: any) {
    const rows = await withRls(this.sql, ctx, (sql) => sql`
      UPDATE crm.reminders SET
        title = COALESCE(${body.title ?? null}, title),
        notes = COALESCE(${body.notes ?? null}, notes),
        remind_at = COALESCE(${body.remind_at ?? null}::date, remind_at),
        done = COALESCE(${body.done ?? null}, done)
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId}
      RETURNING *
    `)
    return rows[0]
  }
}
