import { Injectable, Inject } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';

@Injectable()
export class VisitsService {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  // Banker: vê apenas as próprias visitas
  async findAll(tenantId: string, userId: string) {
    return this.sql`
      SELECT v.*, u.full_name AS user_name, l.stage AS lead_stage
      FROM crm.visits v
      JOIN auth.users u ON u.id = v.user_id
      LEFT JOIN crm.leads l ON l.id = v.lead_id
      WHERE v.tenant_id = ${tenantId}
        AND v.user_id   = ${userId}
      ORDER BY v.visit_date DESC, v.created_at DESC
    `
  }

  // Sócio: vê todas as visitas do tenant
  async findAllTenant(tenantId: string) {
    return this.sql`
      SELECT v.*, u.full_name AS user_name, l.stage AS lead_stage
      FROM crm.visits v
      JOIN auth.users u ON u.id = v.user_id
      LEFT JOIN crm.leads l ON l.id = v.lead_id
      WHERE v.tenant_id = ${tenantId}
      ORDER BY v.visit_date DESC, v.created_at DESC
    `
  }

  async findOne(tenantId: string, id: string) {
    const [row] = await this.sql`
      SELECT v.*, u.full_name AS user_name, l.stage AS lead_stage
      FROM crm.visits v
      JOIN auth.users u ON u.id = v.user_id
      LEFT JOIN crm.leads l ON l.id = v.lead_id
      WHERE v.id = ${id} AND v.tenant_id = ${tenantId}
    `
    return row
  }

  /**
   * Fluxo completo em transação:
   * 1. Cria o lead em crm.leads no estágio 'diagnostico'
   * 2. Grava a visita em crm.visits (diagnóstico completo em JSONB)
   * 3. Registra a interação em wealth.interactions (dispara o resumo por IA via trigger)
   * 4. Cria o reminder da devolutiva em crm.reminders (se houver data)
   */
  async create(tenantId: string, userId: string, body: any) {
    return this.sql.begin(async (sql) => {
      const [lead] = await sql`
        INSERT INTO crm.leads (
          tenant_id, full_name, stage, banker_id,
          origem_tipo, contexto_relacionamento, estimated_aum, priority
        ) VALUES (
          ${tenantId}, ${body.client_name}, 'diagnostico', ${userId},
          ${body.origem_tipo ?? null}, ${body.contexto ?? null},
          ${body.estimated_aum ?? null}, ${body.priority ?? 'med'}
        )
        RETURNING *
      `

      const [visit] = await sql`
        INSERT INTO crm.visits (
          tenant_id, user_id, lead_id, client_name,
          visit_date, devolutiva_date, tier, payload
        ) VALUES (
          ${tenantId}, ${userId}, ${lead.id}, ${body.client_name},
          ${body.visit_date}::date, ${body.devolutiva_date ?? null}::date,
          ${body.tier ?? null}, ${JSON.stringify(body.payload ?? {})}::jsonb
        )
        RETURNING *
      `

      await sql`
        INSERT INTO wealth.interactions (
          lead_id, banker_id, type, subject, notes, occurred_at
        ) VALUES (
          ${lead.id}, ${userId}, 'reuniao',
          ${'Visita de diagnóstico patrimonial'},
          ${body.resumo ?? null}, ${body.visit_date}::date
        )
      `

      if (body.devolutiva_date) {
        await sql`
          INSERT INTO crm.reminders (
            tenant_id, user_id, lead_id, title, remind_at, notes
          ) VALUES (
            ${tenantId}, ${userId}, ${lead.id},
            ${'Devolutiva — ' + body.client_name},
            ${body.devolutiva_date}::date,
            ${body.proximo_passo ?? null}
          )
        `
      }

      return { ...visit, lead_id: lead.id }
    })
  }

  // Atualiza apenas o registro da visita (lead, interação e reminder não são recriados)
  async update(tenantId: string, userId: string, id: string, body: any) {
    const [row] = await this.sql`
      UPDATE crm.visits SET
        client_name     = COALESCE(${body.client_name ?? null}, client_name),
        visit_date      = COALESCE(${body.visit_date ?? null}::date, visit_date),
        devolutiva_date = COALESCE(${body.devolutiva_date ?? null}::date, devolutiva_date),
        tier            = COALESCE(${body.tier ?? null}, tier),
        payload         = COALESCE(${body.payload ? JSON.stringify(body.payload) : null}::jsonb, payload),
        updated_at      = now()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND user_id = ${userId}
      RETURNING *
    `
    return row
  }

  // Banker exclui as próprias visitas; sócio exclui qualquer uma do tenant
  async remove(tenantId: string, userId: string, id: string, isSocio: boolean) {
    if (isSocio) {
      const [row] = await this.sql`
        DELETE FROM crm.visits
        WHERE id = ${id} AND tenant_id = ${tenantId}
        RETURNING id
      `
      return row
    }
    const [row] = await this.sql`
      DELETE FROM crm.visits
      WHERE id = ${id} AND tenant_id = ${tenantId} AND user_id = ${userId}
      RETURNING id
    `
    return row
  }
}
