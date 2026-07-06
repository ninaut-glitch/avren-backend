import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import { CreateLeadDto, UpdateLeadStageDto } from './dto/create-lead.dto';

@Injectable()
export class LeadsRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAll(
    ctx: SessionContext,
    filters: {
      stage?: string;
      banker_id?: string;
      priority?: string;
      page: number;
      limit: number;
    },
  ) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;

      // Visibilidade por papel:
      // - banker: vê SOMENTE os próprios leads (ignora filtro banker_id)
      // - demais papéis (socio, admin, supervisor, operacoes): veem todos
      //   e podem filtrar por responsável, inclusive "sem responsável"
      //   (banker_id = 'none' na query string)
      const isBanker = ctx.userRole === 'banker';

      const bankerFilter = isBanker
        ? tx`AND l.banker_id = ${ctx.userId}`
        : filters.banker_id === 'none'
          ? tx`AND l.banker_id IS NULL`
          : filters.banker_id
            ? tx`AND l.banker_id = ${filters.banker_id}`
            : tx``;

      const rows = await tx`
        SELECT l.*, u.full_name AS banker_name
        FROM crm.leads l
        LEFT JOIN auth.users u ON u.id = l.banker_id
        WHERE TRUE
          ${bankerFilter}
          ${filters.stage    ? tx`AND l.stage    = ${filters.stage}`    : tx``}
          ${filters.priority ? tx`AND l.priority = ${filters.priority}` : tx``}
        ORDER BY l.updated_at DESC
        LIMIT ${filters.limit} OFFSET ${offset}
      `;

      const countBankerFilter = isBanker
        ? tx`AND banker_id = ${ctx.userId}`
        : filters.banker_id === 'none'
          ? tx`AND banker_id IS NULL`
          : filters.banker_id
            ? tx`AND banker_id = ${filters.banker_id}`
            : tx``;

      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM crm.leads
        WHERE TRUE
          ${countBankerFilter}
          ${filters.stage    ? tx`AND stage    = ${filters.stage}`    : tx``}
          ${filters.priority ? tx`AND priority = ${filters.priority}` : tx``}
      `;

      return { data: rows, total: count };
    });
  }

  async findById(ctx: SessionContext, id: string) {
    return withRls(this.sql, ctx, async (tx) => {
      // Banker só consegue abrir os próprios leads
      const scope =
        ctx.userRole === 'banker'
          ? tx`AND l.banker_id = ${ctx.userId}`
          : tx``;

      const [row] = await tx`
        SELECT l.*, u.full_name AS banker_name
        FROM crm.leads l
        LEFT JOIN auth.users u ON u.id = l.banker_id
        WHERE l.id = ${id}
          ${scope}
      `;
      return row ?? null;
    });
  }

  async create(ctx: SessionContext, dto: CreateLeadDto) {
    return withRls(this.sql, ctx, async (tx) => {
      // Banker sempre cria leads para si mesmo, independente do payload
      const bankerId =
        ctx.userRole === 'banker' ? ctx.userId : (dto.banker_id ?? null);

      const [row] = await tx`
        INSERT INTO crm.leads (
          tenant_id, full_name, email, phone, banker_id,
          origem_tipo, contexto_relacionamento, estimated_aum, priority
        ) VALUES (
          ${ctx.tenantId},
          ${dto.full_name},
          ${dto.email          ?? null},
          ${dto.phone          ?? null},
          ${bankerId},
          ${dto.origem_tipo    ?? null},
          ${dto.contexto_relacionamento ?? null},
          ${dto.estimated_aum  ?? null},
          ${dto.priority       ?? 'med'}
        )
        RETURNING *
      `;
      return row;
    });
  }

  // FIX #1: método update separado de create
  async update(ctx: SessionContext, id: string, dto: Partial<CreateLeadDto>) {
    return withRls(this.sql, ctx, async (tx) => {
      // Banker só edita os próprios leads
      const scope =
        ctx.userRole === 'banker'
          ? tx`AND banker_id = ${ctx.userId}`
          : tx``;

      const [row] = await tx`
        UPDATE crm.leads
        SET
          full_name               = COALESCE(${dto.full_name            ?? null}, full_name),
          email                   = COALESCE(${dto.email                ?? null}, email),
          phone                   = COALESCE(${dto.phone                ?? null}, phone),
          banker_id               = COALESCE(${dto.banker_id            ?? null}::uuid, banker_id),
          origem_tipo             = COALESCE(${dto.origem_tipo          ?? null}, origem_tipo),
          contexto_relacionamento = COALESCE(${dto.contexto_relacionamento ?? null}, contexto_relacionamento),
          estimated_aum           = COALESCE(${dto.estimated_aum        ?? null}, estimated_aum),
          priority                = COALESCE(${dto.priority             ?? null}, priority)
        WHERE id = ${id}
          ${scope}
        RETURNING *
      `;
      return row ?? null;
    });
  }

  async updateStage(ctx: SessionContext, id: string, dto: UpdateLeadStageDto) {
    return withRls(this.sql, ctx, async (tx) => {
      // Banker só movimenta os próprios leads
      const scope =
        ctx.userRole === 'banker'
          ? tx`AND banker_id = ${ctx.userId}`
          : tx``;

      const [row] = await tx`
        UPDATE crm.leads
        SET
          stage        = ${dto.stage},
          loss_reason  = ${dto.loss_reason ?? null},
          loss_notes   = ${dto.loss_notes  ?? null},
          converted_at = CASE
                           WHEN ${dto.stage} = 'cliente_ativo' THEN NOW()
                           ELSE converted_at
                         END
        WHERE id = ${id}
          ${scope}
        RETURNING *
      `;
      return row ?? null;
    });
  }

  async findHistory(ctx: SessionContext, leadId: string) {
    return withRls(this.sql, ctx, async (tx) => {
      return tx`
        SELECT
          h.from_stage, h.to_stage, h.days_in_stage,
          h.notes, h.changed_at,
          u.full_name AS changed_by_name
        FROM crm.lead_stage_history h
        LEFT JOIN auth.users u ON u.id = h.changed_by
        WHERE h.lead_id = ${leadId}
        ORDER BY h.changed_at DESC
      `;
    });
  }
}
