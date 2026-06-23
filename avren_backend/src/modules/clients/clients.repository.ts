import { Inject, Injectable } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { withRls, SessionContext } from '../../database/rls.helper';
import {
  CreateClientDto, UpdateClientDto,
  CreateContactDto, CreateFamilyMemberDto, CreateRelationshipDto,
} from './dto/create-client.dto';

@Injectable()
export class ClientsRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAll(ctx: SessionContext, filters: {
    banker_id?: string; status?: string; page: number; limit: number;
  }) {
    return withRls(this.sql, ctx, async (tx) => {
      const offset = (filters.page - 1) * filters.limit;
      const rows = await tx`
        SELECT
          c.*,
          u.full_name  AS banker_name,
          s.full_name  AS supervisor_name,
          -- AUM inline para evitar N+1
          COALESCE(aum.aum_avren, 0)        AS aum_avren,
          COALESCE(aum.total_patrimonio, 0) AS total_patrimonio
        FROM wealth.clients c
        JOIN  auth.users u   ON u.id = c.banker_id
        LEFT JOIN auth.users s ON s.id = c.supervisor_id
        LEFT JOIN wealth.aum_summary aum ON aum.client_id = c.id
        WHERE TRUE
          ${filters.status    ? tx`AND c.status    = ${filters.status}`    : tx``}
          ${filters.banker_id ? tx`AND c.banker_id = ${filters.banker_id}` : tx``}
        ORDER BY c.full_name ASC
        LIMIT ${filters.limit} OFFSET ${offset}
      `;
      const [{ count }] = await tx`
        SELECT COUNT(*)::int AS count FROM wealth.clients
        WHERE TRUE
          ${filters.status    ? tx`AND status    = ${filters.status}`    : tx``}
          ${filters.banker_id ? tx`AND banker_id = ${filters.banker_id}` : tx``}
      `;
      return { data: rows, total: count };
    });
  }

  async findById(ctx: SessionContext, id: string) {
    return withRls(this.sql, ctx, async (tx) => {
      const [client] = await tx`
        SELECT
          c.*,
          u.full_name AS banker_name,
          COALESCE(aum.aum_avren, 0)        AS aum_avren,
          COALESCE(aum.total_patrimonio, 0) AS total_patrimonio
        FROM wealth.clients c
        JOIN  auth.users u ON u.id = c.banker_id
        LEFT JOIN wealth.aum_summary aum ON aum.client_id = c.id
        WHERE c.id = ${id}
      `;
      return client ?? null;
    });
  }

  async create(ctx: SessionContext, dto: CreateClientDto) {
    return withRls(this.sql, ctx, async (tx) => {
      // 1. Cria o cliente
      const [client] = await tx`
        INSERT INTO wealth.clients (
          tenant_id, lead_id, full_name, cpf, birth_date,
          marital_status, marital_regime, profession, company_name,
          annual_income, banker_id, supervisor_id, status
        ) VALUES (
          ${ctx.tenantId},
          ${dto.lead_id},
          ${dto.full_name},
          ${dto.cpf           ?? null},
          ${dto.birth_date    ?? null},
          ${dto.marital_status  ?? null},
          ${dto.marital_regime  ?? null},
          ${dto.profession      ?? null},
          ${dto.company_name    ?? null},
          ${dto.annual_income   ?? null},
          ${dto.banker_id},
          ${dto.supervisor_id   ?? null},
          'ativo'
        )
        RETURNING *
      `;

      // 2. Marca lead como cliente_ativo
      await tx`
        UPDATE crm.leads
        SET stage = 'cliente_ativo', converted_at = NOW()
        WHERE id = ${dto.lead_id}
      `;

      return client;
    });
  }

  async update(ctx: SessionContext, id: string, dto: UpdateClientDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [client] = await tx`
        UPDATE wealth.clients SET
          full_name      = COALESCE(${dto.full_name      ?? null}, full_name),
          cpf            = COALESCE(${dto.cpf            ?? null}, cpf),
          birth_date     = COALESCE(${dto.birth_date     ?? null}::date, birth_date),
          marital_status = COALESCE(${dto.marital_status ?? null}, marital_status),
          marital_regime = COALESCE(${dto.marital_regime ?? null}, marital_regime),
          profession     = COALESCE(${dto.profession     ?? null}, profession),
          company_name   = COALESCE(${dto.company_name   ?? null}, company_name),
          annual_income  = COALESCE(${dto.annual_income  ?? null}, annual_income),
          risk_profile   = COALESCE(${dto.risk_profile   ?? null}, risk_profile),
          status         = COALESCE(${dto.status         ?? null}, status),
          banker_id      = COALESCE(${dto.banker_id      ?? null}::uuid, banker_id)
        WHERE id = ${id}
        RETURNING *
      `;
      return client ?? null;
    });
  }

  // ── Sub-recursos ─────────────────────────────────────────────

  async findContacts(ctx: SessionContext, clientId: string) {
    return withRls(this.sql, ctx, async (tx) => tx`
      SELECT * FROM wealth.client_contacts
      WHERE client_id = ${clientId}
      ORDER BY is_primary DESC, created_at ASC
    `);
  }

  async addContact(ctx: SessionContext, clientId: string, dto: CreateContactDto) {
    return withRls(this.sql, ctx, async (tx) => {
      if (dto.is_primary) {
        await tx`
          UPDATE wealth.client_contacts
          SET is_primary = FALSE WHERE client_id = ${clientId}
        `;
      }
      const [row] = await tx`
        INSERT INTO wealth.client_contacts (client_id, type, value, is_primary)
        VALUES (${clientId}, ${dto.type}, ${dto.value}, ${dto.is_primary ?? false})
        RETURNING *
      `;
      return row;
    });
  }

  async findFamilyMembers(ctx: SessionContext, clientId: string) {
    return withRls(this.sql, ctx, async (tx) => tx`
      SELECT * FROM wealth.family_members
      WHERE client_id = ${clientId}
      ORDER BY relationship, full_name
    `);
  }

  async addFamilyMember(ctx: SessionContext, clientId: string, dto: CreateFamilyMemberDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO wealth.family_members (
          client_id, related_client_id, full_name,
          relationship, birth_date, cpf, is_beneficiary, notes
        ) VALUES (
          ${clientId},
          ${dto.related_client_id ?? null},
          ${dto.full_name},
          ${dto.relationship},
          ${dto.birth_date    ?? null},
          ${dto.cpf           ?? null},
          ${dto.is_beneficiary ?? false},
          ${dto.notes         ?? null}
        )
        RETURNING *
      `;
      return row;
    });
  }

  async findRelationships(ctx: SessionContext, clientId: string) {
    return withRls(this.sql, ctx, async (tx) => tx`
      SELECT * FROM wealth.relationships
      WHERE client_id = ${clientId}
      ORDER BY role, name
    `);
  }

  async addRelationship(ctx: SessionContext, clientId: string, dto: CreateRelationshipDto) {
    return withRls(this.sql, ctx, async (tx) => {
      const [row] = await tx`
        INSERT INTO wealth.relationships (client_id, name, role, company, phone, email, notes)
        VALUES (
          ${clientId}, ${dto.name}, ${dto.role ?? null},
          ${dto.company ?? null}, ${dto.phone ?? null},
          ${dto.email   ?? null}, ${dto.notes ?? null}
        )
        RETURNING *
      `;
      return row;
    });
  }
}
