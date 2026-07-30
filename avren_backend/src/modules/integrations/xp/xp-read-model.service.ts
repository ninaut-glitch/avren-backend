import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../../database/database.provider';
import { SessionContext, withRls } from '../../../database/rls.helper';

/**
 * UNICO contrato de leitura da XP para Patrimonio, Metas e
 * Performance. Com XP_INTEGRATION_ENABLED=false devolve vazio com
 * available=false; nenhum modulo consumidor muda ate a ativacao.
 */
@Injectable()
export class XpReadModelService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly config: ConfigService,
  ) {}

  private get available(): boolean {
    return this.config.get('XP_INTEGRATION_ENABLED') === 'true';
  }

  async getPositionsForClient(ctx: SessionContext, clientId: string) {
    if (!this.available) return { available: false, positions: [] };
    const positions = await withRls(this.sql, ctx, (tx) => tx`
      SELECT p.as_of_date, p.asset_class, p.product_name, p.symbol,
             p.quantity, p.gross_value, p.net_value, p.currency,
             a.external_account_id, a.account_number_mask
      FROM integrations.xp_positions p
      JOIN integrations.xp_accounts a ON a.id = p.account_id
      WHERE a.client_id = ${clientId}
        AND a.link_status = 'linked'
        AND p.as_of_date = (
          SELECT MAX(p2.as_of_date)
          FROM integrations.xp_positions p2
          WHERE p2.account_id = p.account_id
        )
      ORDER BY p.gross_value DESC
    `);
    return { available: true, positions };
  }

  async getNetNewMoney(ctx: SessionContext, month: string) {
    if (!this.available) return { available: false, net: 0 };
    const [row] = await withRls(this.sql, ctx, (tx) => tx`
      SELECT COALESCE(SUM(m.amount), 0) AS net
      FROM integrations.xp_movements m
      WHERE to_char(m.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = ${month}
    `);
    return { available: true, net: Number(row?.net ?? 0) };
  }

  async getRevenueByMonth(ctx: SessionContext, month: string) {
    if (!this.available) return { available: false, gross: 0, net: 0 };
    const [row] = await withRls(this.sql, ctx, (tx) => tx`
      SELECT COALESCE(SUM(c.gross_amount), 0) AS gross,
             COALESCE(SUM(c.net_amount), 0) AS net
      FROM integrations.xp_commissions c
      WHERE to_char(c.competence_date, 'YYYY-MM') = ${month}
    `);
    return {
      available: true,
      gross: Number(row?.gross ?? 0),
      net: Number(row?.net ?? 0),
    };
  }
}
