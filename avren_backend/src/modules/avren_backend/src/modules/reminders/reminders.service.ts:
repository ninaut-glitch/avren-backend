import { Injectable, Inject } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';

@Injectable()
export class RemindersService {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAll(tenantId: string, userId: string, filters: { date?: string; done?: boolean }) {
    const rows = await this.sql`
      SELECT
        r.*,
        l.full_name AS lead_name,
        u.full_name AS user_name
      FROM crm.reminders r
      JOIN auth.users u ON u.id = r.user_id
      LEFT JOIN crm.leads l ON l.id = r.lead_id
      WHERE r.tenant_id = ${tenantId}
        AND r.user_id   = ${userId}
        ${filters.done != null ? this.sql`AND r.done = ${filters.done}` : this.sql``}
        ${filters.date ? this.sql`AND r.remind_at = ${filters.date}::date` : this.sql``}
      ORDER BY r.remind_at ASC, r.created_at ASC
    `;
    return rows;
  }

  async findToday(tenantId: string) {
    const rows = await this.sql`
      SELECT
        r.*,
        l.full_name AS lead_name,
        u.full_name AS user_name,
        u.email     AS user_email
      FROM crm.reminders r
      JOIN auth.users u ON u.id = r.user_id
      LEFT JOIN crm.leads l ON l.id = r.lead_id
      WHERE r.tenant_id = ${tenantId}
        AND r.remind_at = CURRENT_DATE
        AND r.done = false
      ORDER BY r.created_at ASC
    `;
    return rows;
  }

  async create(tenantId: string, userId: string, body: any) {
    const [row] = await this.sql`
      INSERT INTO crm.reminders (tenant_id, user_id, lead_id, title, remind_at, notes)
      VALUES (
        ${tenantId},
        ${userId},
        ${body.lead_id ?? null},
        ${body.title},
        ${body.remind_at}::date,
        ${body.notes ?? null}
      )
      RETURNING *
    `;
    return row;
  }

  async update(userId: string, id: string, body: any) {
    const [row] = await this.sql`
      UPDATE crm.reminders SET
        title      = COALESCE(${body.title ?? null}, title),
        notes      = COALESCE(${body.notes ?? null}, notes),
        remind_at  = COALESCE(${body.remind_at ? body.remind_at + '::date' : null}::date, remind_at),
        done       = COALESCE(${body.done ?? null}, done)
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    return row;
  }
}
