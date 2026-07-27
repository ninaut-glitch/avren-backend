import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { SessionContext, withRls } from '../../database/rls.helper';

@Injectable()
export class PatrimonialPlanningService {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  list(ctx: SessionContext) {
    return withRls(this.sql, ctx, (tx) => tx`
      SELECT p.*, c.full_name AS client_name, u.full_name AS advisor_name
      FROM wealth.patrimonial_plans p
      JOIN wealth.clients c ON c.id = p.client_id
      JOIN auth.users u ON u.id = p.advisor_id
      ORDER BY p.updated_at DESC
    `);
  }

  findByClient(ctx: SessionContext, clientId: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        SELECT p.*, c.full_name AS client_name, u.full_name AS advisor_name
        FROM wealth.patrimonial_plans p
        JOIN wealth.clients c ON c.id = p.client_id
        JOIN auth.users u ON u.id = p.advisor_id
        WHERE p.client_id = ${clientId}
      `;
      return row ?? null;
    });
  }

  create(ctx: SessionContext, clientId: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const [client] = await tx`
        SELECT id FROM wealth.clients WHERE id = ${clientId}
      `;
      if (!client) throw new NotFoundException('Cliente não encontrado');

      const [row] = await tx`
        INSERT INTO wealth.patrimonial_plans (
          tenant_id, client_id, advisor_id
        ) VALUES (${ctx.tenantId}, ${clientId}, ${ctx.userId})
        ON CONFLICT (tenant_id, client_id)
        DO UPDATE SET updated_at = wealth.patrimonial_plans.updated_at
        RETURNING *
      `;
      return row;
    });
  }

  autosave(ctx: SessionContext, id: string, body: any) {
    return withRls(this.sql, ctx, async (tx) => {
      const [current] = await tx`
        SELECT * FROM wealth.patrimonial_plans WHERE id = ${id}
      `;
      if (!current) throw new NotFoundException('Planejamento não encontrado');

      const nextVersion = body.create_version
        ? Number(current.versionNumber) + 1
        : Number(current.versionNumber);
      const mergedData = {
        ...(current.data ?? {}),
        ...(body.data ?? {}),
      };

      const [updated] = await tx`
        UPDATE wealth.patrimonial_plans SET
          data = ${JSON.stringify(mergedData)}::jsonb,
          current_block = COALESCE(${body.current_block ?? null}, current_block),
          completion_pct = COALESCE(${body.completion_pct ?? null}, completion_pct),
          status = COALESCE(${body.status ?? null}, status),
          version_number = ${nextVersion},
          last_saved_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (body.create_version) {
        await tx`
          INSERT INTO wealth.pp_versions (
            tenant_id, plan_id, version_number, snapshot, created_by
          ) VALUES (
            ${ctx.tenantId}, ${id}, ${nextVersion},
            ${JSON.stringify(mergedData)}::jsonb, ${ctx.userId}
          )
        `;
      }
      return updated;
    });
  }

  versions(ctx: SessionContext, id: string) {
    return withRls(this.sql, ctx, (tx) => tx`
      SELECT id, version_number, created_by, created_at
      FROM wealth.pp_versions
      WHERE plan_id = ${id}
      ORDER BY version_number DESC
    `);
  }
}
