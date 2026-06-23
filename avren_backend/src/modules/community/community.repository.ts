import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import {
  CreateEventDto, AddParticipantDto, UpdateParticipantStatusDto,
} from './dto/create-event.dto';

@Injectable()
export class CommunityRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findEvents(ctx: SessionContext, filters: {
    from?: string; to?: string; page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT
          e.*,
          u.full_name AS created_by_name,
          COUNT(ep.id)::int AS participant_count
        FROM community.events e
        LEFT JOIN auth.users u ON u.id = e.created_by
        LEFT JOIN community.event_participants ep ON ep.event_id = e.id
        WHERE TRUE
          ${filters.from ? tx`AND e.event_date >= ${filters.from}::timestamptz` : tx``}
          ${filters.to   ? tx`AND e.event_date <= ${filters.to}::timestamptz`   : tx``}
        GROUP BY e.id, u.full_name
        ORDER BY e.event_date DESC
        LIMIT ${filters.limit} OFFSET ${offset}
      `;
      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM community.events
        WHERE TRUE
          ${filters.from ? tx`AND event_date >= ${filters.from}::timestamptz` : tx``}
          ${filters.to   ? tx`AND event_date <= ${filters.to}::timestamptz`   : tx``}
      `;
      return { data: rows, total: count };
    });
  }

  async findById(ctx: SessionContext, id: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        SELECT e.*, u.full_name AS created_by_name
        FROM community.events e
        LEFT JOIN auth.users u ON u.id = e.created_by
        WHERE e.id = ${id}
      `;
      return row ?? null;
    });
  }

  async create(ctx: SessionContext, dto: CreateEventDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO community.events (
          tenant_id, business_unit_id, title, event_date,
          location, modality, capacity, description, created_by
        ) VALUES (
          ${ctx.tenantId},
          ${dto.business_unit_id ?? null},
          ${dto.title},
          ${dto.event_date}::timestamptz,
          ${dto.location    ?? null},
          ${dto.modality    ?? 'presencial'},
          ${dto.capacity    ?? null},
          ${dto.description ?? null},
          ${ctx.userId}
        )
        RETURNING *
      `;
      return row;
    });
  }

  async findParticipants(ctx: SessionContext, eventId: string) {
    return withRls(this.sql, ctx, async (tx) => tx`
      SELECT
        ep.*,
        c.full_name  AS client_name,
        u.full_name  AS invited_by_name
      FROM community.event_participants ep
      JOIN  wealth.clients c ON c.id = ep.client_id
      LEFT JOIN auth.users u ON u.id = ep.invited_by
      WHERE ep.event_id = ${eventId}
      ORDER BY ep.status, c.full_name
    `);
  }

  async addParticipant(ctx: SessionContext, eventId: string, dto: AddParticipantDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO community.event_participants
          (event_id, client_id, invited_by, notes)
        VALUES
          (${eventId}, ${dto.client_id}, ${ctx.userId}, ${dto.notes ?? null})
        ON CONFLICT (event_id, client_id) DO NOTHING
        RETURNING *
      `;
      return row ?? null;
    });
  }

  async updateParticipantStatus(
    ctx: SessionContext,
    eventId: string,
    clientId: string,
    dto: UpdateParticipantStatusDto,
  ) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        UPDATE community.event_participants
        SET status = ${dto.status}
        WHERE event_id = ${eventId} AND client_id = ${clientId}
        RETURNING *
      `;
      return row ?? null;
    });
  }
}
