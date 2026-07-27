import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import { CreateOpportunityDto, UpdateOpportunityDto } from './dto/create-opportunity.dto';

@Injectable()
export class OpportunitiesRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAll(ctx: SessionContext, filters: {
    type?: string; status?: string; page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT o.*, u.full_name AS banker_name,
               COALESCE(c.full_name, l.full_name) AS client_name,
               CASE WHEN o.client_id IS NOT NULL THEN 'client' ELSE 'lead' END AS subject_type
        FROM wealth.opportunities o
        JOIN auth.users u ON u.id = o.banker_id
        LEFT JOIN wealth.clients c ON c.id = o.client_id
        LEFT JOIN crm.leads l ON l.id = o.lead_id
        WHERE 1 = 1
          ${filters.type ? tx`AND o.type = ${filters.type}` : tx``}
          ${filters.status ? tx`AND o.status = ${filters.status}` : tx``}
        ORDER BY o.updated_at DESC
        LIMIT ${filters.limit} OFFSET ${offset}
      `;
      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM wealth.opportunities o
        WHERE 1 = 1
          ${filters.type ? tx`AND o.type = ${filters.type}` : tx``}
          ${filters.status ? tx`AND o.status = ${filters.status}` : tx``}
      `;
      return { data: rows, total: count };
    });
  }

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
        SELECT o.*, u.full_name AS banker_name,
               COALESCE(c.full_name, l.full_name) AS client_name,
               CASE WHEN o.client_id IS NOT NULL THEN 'client' ELSE 'lead' END AS subject_type
        FROM wealth.opportunities o
        JOIN auth.users    u ON u.id = o.banker_id
        LEFT JOIN wealth.clients c ON c.id = o.client_id
        LEFT JOIN crm.leads l ON l.id = o.lead_id
        WHERE o.id = ${id}
      `;
      return row ?? null;
    });
  }

  async createForSubject(
    ctx: SessionContext,
    subject: { client_id?: string; lead_id?: string },
    dto: CreateOpportunityDto,
  ) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO wealth.opportunities (
          tenant_id, client_id, lead_id, banker_id, type, title,
          estimated_value, estimated_monthly_revenue, estimated_one_time_revenue,
          probability, expected_close_date, notes
        ) VALUES (
          ${ctx.tenantId}, ${subject.client_id ?? null}, ${subject.lead_id ?? null},
          ${ctx.userId}, ${dto.type}, ${dto.title ?? null},
          ${dto.estimated_value ?? null}, ${dto.estimated_monthly_revenue ?? null},
          ${dto.estimated_one_time_revenue ?? null}, ${dto.probability ?? null},
          ${dto.expected_close_date ?? null}::date, ${dto.notes ?? null}
        )
        RETURNING *
      `;
      return row;
    });
  }

  async create(ctx: SessionContext, clientId: string, dto: CreateOpportunityDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO wealth.opportunities (
          tenant_id, client_id, banker_id, type, title,
          estimated_value, estimated_monthly_revenue, estimated_one_time_revenue,
          probability, expected_close_date, notes
        ) VALUES (
          ${ctx.tenantId}, ${clientId}, ${ctx.userId},
          ${dto.type},
          ${dto.title                ?? null},
          ${dto.estimated_value      ?? null},
          ${dto.estimated_monthly_revenue ?? null},
          ${dto.estimated_one_time_revenue ?? null},
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
          estimated_monthly_revenue = COALESCE(${dto.estimated_monthly_revenue ?? null}, estimated_monthly_revenue),
          estimated_one_time_revenue = COALESCE(${dto.estimated_one_time_revenue ?? null}, estimated_one_time_revenue),
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
