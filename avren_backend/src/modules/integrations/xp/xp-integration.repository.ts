import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../../database/database.provider';
import { SessionContext, withRls } from '../../../database/rls.helper';

@Injectable()
export class XpIntegrationRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async getTenantSummary(ctx: SessionContext) {
    return withRls(this.sql, ctx, async (tx) => {
      const [connection] = await tx`
        SELECT
          channel, environment, status, granted_scopes,
          last_sync_at, last_success_at,
          last_error_code, last_error_message, updated_at
        FROM integrations.xp_connections
        WHERE tenant_id = ${ctx.tenantId}
      `;

      const [counts] = await tx`
        SELECT
          (SELECT COUNT(*)::int FROM integrations.xp_accounts
             WHERE tenant_id = ${ctx.tenantId}) AS accounts,
          (SELECT COUNT(*)::int FROM integrations.xp_accounts
             WHERE tenant_id = ${ctx.tenantId} AND client_id IS NOT NULL) AS linked_accounts,
          (SELECT COUNT(*)::int FROM integrations.xp_positions
             WHERE tenant_id = ${ctx.tenantId}
               AND as_of_date = (
                 SELECT MAX(as_of_date)
                 FROM integrations.xp_positions
                 WHERE tenant_id = ${ctx.tenantId}
               )) AS current_positions,
          (SELECT COUNT(*)::int FROM integrations.xp_movements
             WHERE tenant_id = ${ctx.tenantId}) AS movements
      `;

      return {
        connection: connection ?? null,
        counts: counts ?? {
          accounts: 0,
          linked_accounts: 0,
          current_positions: 0,
          movements: 0,
        },
      };
    });
  }
}
