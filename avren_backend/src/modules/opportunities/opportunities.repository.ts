import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import { CreateOpportunityDto, UpdateOpportunityDto } from './dto/create-opportunity.dto';

@Injectable()
export class OpportunitiesRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findByClient(ctx: SessionContext, clientId: string, filters: {
    status?: string; page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT o.*, u.full_name AS banker_name
        FROM wealth.opportunities o
        JOIN auth.users u ON u.id = o.banker_id
        WHERE o.client_id = ${clientId}
          ${filters.status ? tx`AND o.status = ${filters.status}` : tx``}
        ORDER BY
          CASE o.status
            WHEN 'in_progress' THEN 1 WHEN 'open' THEN 2 ELSE 3
          END,
          o.expected_close_date ASC NULLS LAST
        LIMIT ${filters.limit} OFFSET ${offset}
      `;
      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM wealth.opportunities
        WHERE client_id = ${clientId}
          ${filters.status ? tx`AND status = ${filters.status}` : tx``}
      `;
      return { data: rows, total: count };
    });
  }

  async findById(ctx: SessionContext, id: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        SELECT o.*, u.full_name AS banker_name, c.full_name AS client_name
        FROM wealth.opportunities o
        JOIN auth.users    u ON u.id = o.banker_id
        JOIN wealth.clients c ON c.id = o.client_id
        WHERE o.id = ${id}
      `;
      return row ?? null;
    });
  }

  async create(ctx: SessionContext, clientId: string, dto: CreateOpportunityDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO wealth.opportunities (
          tenant_id, client_id, banker_id, type, title,
          estimated_value, probability, expected_close_date, notes
        ) VALUES (
          ${ctx.tenantId}, ${clientId}, ${ctx.userId},
          ${dto.type},
          ${dto.title                ?? null},
          ${dto.estimated_value      ?? null},
          ${dto.probability          ?? null},
          ${dto.expected_close_date  ?? null}::date,
          ${dto.notes                ?? null}
        )
        RETURNING *
      `;
      return row;
    });
  }

  async update(ctx: SessionContext, id: string, dto: UpdateOpportunityDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        UPDATE wealth.opportunities SET
          type                = COALESCE(${dto.type               ?? null}, type),
          title               = COALESCE(${dto.title              ?? null}, title),
          estimated_value     = COALESCE(${dto.estimated_value    ?? null}, estimated_value),
          probability         = COALESCE(${dto.probability        ?? null}, probability),
          expected_close_date = COALESCE(${dto.expected_close_date ?? null}::date, expected_close_date),
          status              = COALESCE(${dto.status             ?? null}, status),
          notes               = COALESCE(${dto.notes              ?? null}, notes)
        WHERE id = ${id}
        RETURNING *
      `;
      return row ?? null;
    });
  }
}
