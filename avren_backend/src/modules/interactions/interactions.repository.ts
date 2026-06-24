import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import { CreateInteractionDto } from './dto/create-interaction.dto';

@Injectable()
export class InteractionsRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findByClient(ctx: SessionContext, clientId: string, filters: {
    type?: string; page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT
          i.*,
          'client'             AS entity_type,
          u.full_name          AS banker_name,
          r.name               AS relationship_name,
          r.role               AS relationship_role,
          ais.summary          AS ai_summary_text,
          ais.sentiment,
          ais.opportunity_level,
          ais.next_steps       AS ai_next_steps_structured
        FROM wealth.interactions i
        JOIN  auth.users u ON u.id = i.banker_id
        LEFT JOIN wealth.relationships r ON r.id = i.relationship_id
        LEFT JOIN ai.interaction_summaries ais ON ais.interaction_id = i.id
        WHERE i.client_id = ${clientId}
          ${filters.type ? tx`AND i.type = ${filters.type}` : tx``}
        ORDER BY i.occurred_at DESC
        LIMIT ${filters.limit} OFFSET ${offset}
      `;
      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM wealth.interactions
        WHERE client_id = ${clientId}
          ${filters.type ? tx`AND type = ${filters.type}` : tx``}
      `;
      return { data: rows, total: count };
    });
  }

  async findByLead(ctx: SessionContext, leadId: string, filters: {
    type?: string; page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT
          i.*,
          'lead'               AS entity_type,
          u.full_name          AS banker_name,
          ais.summary          AS ai_summary_text,
          ais.sentiment,
          ais.opportunity_level,
          ais.next_steps       AS ai_next_steps_structured
        FROM wealth.interactions i
        JOIN  auth.users u ON u.id = i.banker_id
        LEFT JOIN ai.interaction_summaries ais ON ais.interaction_id = i.id
        WHERE i.lead_id = ${leadId}
          ${filters.type ? tx`AND i.type = ${filters.type}` : tx``}
        ORDER BY i.occurred_at DESC
        LIMIT ${filters.limit} OFFSET ${offset}
      `;
      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM wealth.interactions
        WHERE lead_id = ${leadId}
          ${filters.type ? tx`AND type = ${filters.type}` : tx``}
      `;
      return { data: rows, total: count };
    });
  }

  async findById(ctx: SessionContext, id: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        SELECT i.*, u.full_name AS banker_name,
               CASE WHEN i.client_id IS NOT NULL THEN 'client' ELSE 'lead' END AS entity_type,
               ais.summary, ais.sentiment, ais.opportunity_level,
               ais.detected_needs, ais.next_steps AS ai_next_steps_structured
        FROM wealth.interactions i
        JOIN  auth.users u ON u.id = i.banker_id
        LEFT JOIN ai.interaction_summaries ais ON ais.interaction_id = i.id
        WHERE i.id = ${id}
      `;
      return row ?? null;
    });
  }

  async create(ctx: SessionContext, clientId: string, dto: CreateInteractionDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO wealth.interactions (
          client_id, lead_id, banker_id, relationship_id,
          type, subject, notes, occurred_at, duration_min
        ) VALUES (
          ${clientId},
          ${dto.lead_id         ?? null},
          ${ctx.userId},
          ${dto.relationship_id ?? null},
          ${dto.type},
          ${dto.subject},
          ${dto.notes           ?? null},
          ${dto.occurred_at}::timestamptz,
          ${dto.duration_min    ?? null}
        )
        RETURNING *
      `;
      return row;
    });
  }

  async createForLead(ctx: SessionContext, leadId: string, dto: CreateInteractionDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO wealth.interactions (
          client_id, lead_id, banker_id,
          type, subject, notes, occurred_at, duration_min
        ) VALUES (
          ${null},
          ${leadId},
          ${ctx.userId},
          ${dto.type},
          ${dto.subject},
          ${dto.notes       ?? null},
          ${dto.occurred_at}::timestamptz,
          ${dto.duration_min ?? null}
        )
        RETURNING *
      `;
      return row;
    });
  }
}
