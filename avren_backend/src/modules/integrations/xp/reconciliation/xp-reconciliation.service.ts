import {
  BadRequestException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../../../database/database.provider';
import {
  SessionContext, assertUuid, withRls,
} from '../../../../database/rls.helper';

/**
 * Conciliacao conta XP <-> cliente (wealth.clients).
 * Vinculo SEMPRE manual (sem sugestao por CPF ate o payload HML:
 * a 018 guarda apenas holder_document_hash). suggested_client_id fica
 * reservada para a estrategia futura. Unlink e ignore tambem limpam a
 * sugestao para nao sobrar estado incompativel (requisito 3).
 *
 * NOTA v3.1: leituras de coluna voltam em camelCase por causa de
 * transform.column = postgres.toCamel no databaseProvider real
 * (tenant_id -> tenantId, full_name -> fullName).
 */
@Injectable()
export class XpReconciliationService {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async listPending(ctx: SessionContext) {
    return withRls(this.sql, ctx, (tx) => tx`
      SELECT a.id, a.external_account_id, a.account_number_mask,
             a.holder_name, a.advisor_code, a.link_status,
             a.suggested_client_id,
             c.full_name AS suggested_client_name
      FROM integrations.xp_accounts a
      LEFT JOIN wealth.clients c ON c.id = a.suggested_client_id
      WHERE a.link_status IN ('unlinked', 'suggested')
      ORDER BY a.holder_name NULLS LAST, a.external_account_id
    `);
  }

  async searchClients(ctx: SessionContext, query: string) {
    const term = (query ?? '').trim();
    if (term.length < 2) return [];
    const like = '%' + term.replace(/[%_]/g, '') + '%';
    return withRls(this.sql, ctx, (tx) => tx`
      SELECT id, full_name
      FROM wealth.clients
      WHERE full_name ILIKE ${like}
      ORDER BY full_name
      LIMIT 15
    `);
  }

  async link(ctx: SessionContext, accountId: string, clientId: string) {
    assertUuid(accountId, 'accountId');
    assertUuid(clientId, 'clientId');

    return withRls(this.sql, ctx, async (tx) => {
      const [client] = await tx`
        SELECT id, tenant_id FROM wealth.clients WHERE id = ${clientId}
      `;
      if (!client) throw new NotFoundException('Cliente nao encontrado neste tenant.');
      const [account] = await tx`
        SELECT id, tenant_id FROM integrations.xp_accounts WHERE id = ${accountId}
      `;
      if (!account) throw new NotFoundException('Conta XP nao encontrada neste tenant.');
      if (account.tenantId !== client.tenantId || account.tenantId !== ctx.tenantId) {
        throw new BadRequestException('Conta e cliente devem pertencer ao mesmo tenant.');
      }

      await tx`
        UPDATE integrations.xp_accounts
        SET client_id = ${clientId},
            suggested_client_id = NULL,
            link_status = 'linked',
            linked_by = ${ctx.userId},
            linked_at = NOW(),
            updated_at = NOW()
        WHERE id = ${accountId}
      `;
      return { linked: true };
    });
  }

  async unlink(ctx: SessionContext, accountId: string) {
    assertUuid(accountId, 'accountId');
    return withRls(this.sql, ctx, async (tx) => {
      const rows = await tx`
        UPDATE integrations.xp_accounts
        SET client_id = NULL,
            suggested_client_id = NULL,
            link_status = 'unlinked',
            linked_by = NULL,
            linked_at = NULL,
            updated_at = NOW()
        WHERE id = ${accountId}
        RETURNING id
      `;
      if (rows.length === 0) throw new NotFoundException('Conta XP nao encontrada.');
      return { linked: false };
    });
  }

  async ignore(ctx: SessionContext, accountId: string) {
    assertUuid(accountId, 'accountId');
    return withRls(this.sql, ctx, async (tx) => {
      const rows = await tx`
        UPDATE integrations.xp_accounts
        SET link_status = 'ignored',
            suggested_client_id = NULL,
            updated_at = NOW()
        WHERE id = ${accountId} AND link_status <> 'linked'
        RETURNING id
      `;
      if (rows.length === 0) {
        throw new NotFoundException('Conta XP nao encontrada ou ja vinculada.');
      }
      return { ignored: true };
    });
  }
}
