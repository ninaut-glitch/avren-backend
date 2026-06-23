import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';

@Injectable()
export class TasksRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAll(ctx: SessionContext, filters: {
    status?: string; priority?: string;
    due_before?: string; page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT
          t.*,
          u.full_name  AS assigned_to_name,
          c.full_name  AS client_name
        FROM crm.tasks t
        JOIN  auth.users    u ON u.id = t.assigned_to
        LEFT JOIN wealth.clients c ON c.id = t.client_id
        WHERE TRUE
          ${filters.status     ? tx`AND t.status   = ${filters.status}`              : tx``}
          ${filters.priority   ? tx`AND t.priority  = ${filters.priority}`           : tx``}
          ${filters.due_before ? tx`AND t.due_date <= ${filters.due_before}::timestamptz` : tx``}
        ORDER BY
          CASE t.priority
            WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
            WHEN 'medium' THEN 3 ELSE 4
          END,
          t.due_date ASC NULLS LAST
        LIMIT ${filters.limit} OFFSET ${offset}
      `;
      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM crm.tasks
        WHERE TRUE
          ${filters.status   ? tx`AND status   = ${filters.status}`   : tx``}
          ${filters.priority ? tx`AND priority = ${filters.priority}` : tx``}
      `;
      return { data: rows, total: count };
    });
  }

  async findById(ctx: SessionContext, id: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        SELECT t.*, u.full_name AS assigned_to_name, c.full_name AS client_name
        FROM crm.tasks t
        JOIN  auth.users u    ON u.id = t.assigned_to
        LEFT JOIN wealth.clients c ON c.id = t.client_id
        WHERE t.id = ${id}
      `;
      return row ?? null;
    });
  }

  async create(ctx: SessionContext, dto: CreateTaskDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO crm.tasks (
          tenant_id, assigned_to, created_by,
          client_id, lead_id, opportunity_id, ai_summary_id,
          title, description, due_date, priority
        ) VALUES (
          ${ctx.tenantId},
          ${dto.assigned_to},
          ${ctx.userId},
          ${dto.client_id      ?? null},
          ${dto.lead_id        ?? null},
          ${dto.opportunity_id ?? null},
          ${dto.ai_summary_id  ?? null},
          ${dto.title},
          ${dto.description    ?? null},
          ${dto.due_date       ?? null}::timestamptz,
          ${dto.priority       ?? 'medium'}
        )
        RETURNING *
      `;
      return row;
    });
  }

  async update(ctx: SessionContext, id: string, dto: UpdateTaskDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        UPDATE crm.tasks SET
          title       = COALESCE(${dto.title       ?? null}, title),
          description = COALESCE(${dto.description ?? null}, description),
          status      = COALESCE(${dto.status      ?? null}, status),
          priority    = COALESCE(${dto.priority    ?? null}, priority),
          assigned_to = COALESCE(${dto.assigned_to ?? null}::uuid, assigned_to),
          due_date    = COALESCE(${dto.due_date    ?? null}::timestamptz, due_date),
          completed_at = CASE
                           WHEN ${dto.status ?? ''} = 'done' THEN NOW()
                           ELSE completed_at
                         END
        WHERE id = ${id}
        RETURNING *
      `;
      return row ?? null;
    });
  }
}
