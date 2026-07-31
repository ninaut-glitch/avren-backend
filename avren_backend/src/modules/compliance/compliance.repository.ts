import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';

@Injectable()
export class ComplianceRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAlerts(ctx: SessionContext, filters: {
    severity?: string; status?: string; banker_id?: string;
    page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT a.*, c.full_name AS client_name, u.full_name AS banker_name
        FROM compliance.alerts a
        JOIN wealth.clients c  ON c.id = a.client_id
        JOIN auth.users u      ON u.id = a.banker_id
        WHERE TRUE
          ${filters.severity  ? tx`AND a.severity  = ${filters.severity}`  : tx``}
          ${filters.status    ? tx`AND a.status    = ${filters.status}`    : tx``}
          ${filters.banker_id ? tx`AND a.banker_id = ${filters.banker_id}` : tx``}
        ORDER BY
          CASE a.severity
            WHEN 'critical' THEN 1 WHEN 'high' THEN 2
            WHEN 'medium'   THEN 3 ELSE 4
          END,
          a.due_date ASC NULLS LAST
        LIMIT ${filters.limit} OFFSET ${offset}
      `;

      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM compliance.alerts
        WHERE TRUE
          ${filters.severity  ? tx`AND severity  = ${filters.severity}`  : tx``}
          ${filters.status    ? tx`AND status    = ${filters.status}`    : tx``}
          ${filters.banker_id ? tx`AND banker_id = ${filters.banker_id}` : tx``}
      `;

      return { data: rows, total: count };
    });
  }

  async updateAlertStatus(
    ctx: SessionContext,
    id: string,
    status: string,
    notes?: string,
  ) {
    return withRls(this.sql, ctx, async (tx) => {
      const [current] = await tx`
        SELECT id, status
        FROM compliance.alerts
        WHERE id = ${id}
        FOR UPDATE
      `;
      if (!current) return null;

      const [row] = await tx`
        UPDATE compliance.alerts
        SET
          status = ${status},
          resolved_by = CASE
            WHEN ${status} IN ('resolved', 'dismissed') THEN ${ctx.userId}::uuid
            ELSE resolved_by
          END
        WHERE id = ${id}
        RETURNING *
      `;

      if (current.status !== status) {
        await tx`
          UPDATE compliance.alert_history
          SET changed_by = ${ctx.userId}::uuid,
              notes = ${notes ?? null}
          WHERE id = (
            SELECT id
            FROM compliance.alert_history
            WHERE alert_id = ${id}
              AND from_status = ${current.status}
              AND to_status = ${status}
            ORDER BY changed_at DESC
            LIMIT 1
          )
        `;
      }
      return row ?? null;
    });
  }

  async syncKycAlerts(ctx: SessionContext): Promise<number> {
    return withRls(this.sql, ctx, async (tx) => {
      const [{ fn_sync_kyc_alerts }] = await tx`
        SELECT compliance.fn_sync_kyc_alerts(${ctx.tenantId})
      `;
      return Number(fn_sync_kyc_alerts);
    });
  }
}
