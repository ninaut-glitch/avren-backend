import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';

// Ponto médio de cada faixa de patrimônio para estimated_aum
const AUM_MAP: Record<string, number> = {
  'Até R$ 1M':      500_000,
  'R$ 1M a 5M':     3_000_000,
  'R$ 5M a 20M':    12_500_000,
  'R$ 20M a 50M':   35_000_000,
  'Acima de R$ 50M': 50_000_000,
};

// Origem do formulário -> origem_tipo (check constraint de crm.leads)
const ORIGEM_TIPO_MAP: Record<string, string> = {
  'Indicação de cliente': 'indicacao',
  'Jantar AVREN':         'evento',
  'Comunidade':           'evento',
  'LinkedIn':             'digital',
  'Rede pessoal':         'banker',
};

function priorityFromAum(aum: number | null): string {
  if (aum == null)        return 'med';
  if (aum >= 5_000_000)   return 'high';
  if (aum >= 1_000_000)   return 'med';
  return 'low';
}

// Resumo executivo completo gravado como nota da interação
function buildSummary(p: any): string {
  const lines = [
    'FORMULÁRIO DE VISITA AVREN',
    `Data: ${p.data || '-'} | Assessor: ${p.assessor || '-'}`,
    '',
    `CLIENTE: ${p.nome || '-'} (${p.perfil || '-'})`,
    `Origem: ${p.origem || '-'}${p.indicadoPor ? ' | Indicado por: ' + p.indicadoPor : ''}`,
    '',
    'HISTÓRIA PATRIMONIAL',
    p.historia || '-',
    p.eventosLiquidez ? `Eventos de liquidez: ${p.eventosLiquidez}` : '',
    '',
    'ESTRUTURA ATUAL',
    `Instituições: ${p.instituicoes || '-'}`,
    `Faixa de patrimônio: ${p.faixaPatrimonio || '-'}`,
    `Estruturas: ${p.estruturas?.length ? p.estruturas.join(', ') : '-'}`,
    `Quem cuida hoje: ${p.quemCuida || '-'}`,
    '',
    'INCÔMODOS',
    p.incomodos || '-',
    p.oQueFalta ? `O que falta: ${p.oQueFalta}` : '',
    '',
    'DECISÕES PENDENTES (12 MESES)',
    p.decisoes?.length ? p.decisoes.map((d: string) => `- ${d}`).join('\n') : '-',
    p.decisoesNotas ? `Notas: ${p.decisoesNotas}` : '',
    '',
    'FAMÍLIA E LEGADO',
    p.familia || '-',
    p.legado ? `Legado: ${p.legado}` : '',
    '',
    'SÍNTESE DO ASSESSOR',
    `Tier provável: ${p.tier || '-'}`,
    `Decisões-chave: ${p.decisoesChave || '-'}`,
    `Próximo passo: ${p.proximoPasso || '-'}`,
    `Devolutiva agendada: ${p.dataDevolutiva || '-'}`,
  ];
  return lines.filter((l) => l !== '').join('\n');
}

@Injectable()
export class VisitsService {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  async findAll(tenantId: string, userId: string) {
    return this.sql`
      SELECT v.*, u.full_name AS user_name
      FROM crm.visits v
      JOIN auth.users u ON u.id = v.user_id
      WHERE v.tenant_id = ${tenantId}
        AND v.user_id   = ${userId}
      ORDER BY v.visit_date DESC, v.created_at DESC
    `;
  }

  async findAllTenant(tenantId: string) {
    return this.sql`
      SELECT v.*, u.full_name AS user_name
      FROM crm.visits v
      JOIN auth.users u ON u.id = v.user_id
      WHERE v.tenant_id = ${tenantId}
      ORDER BY v.visit_date DESC, v.created_at DESC
    `;
  }

  async findOne(tenantId: string, id: string) {
    const [row] = await this.sql`
      SELECT v.*, u.full_name AS user_name
      FROM crm.visits v
      JOIN auth.users u ON u.id = v.user_id
      WHERE v.tenant_id = ${tenantId} AND v.id = ${id}
    `;
    if (!row) throw new NotFoundException('Visita não encontrada');
    return row;
  }

  /**
   * Salva a visita e, na mesma transação:
   * 1. cria o lead no pipeline (estágio 'diagnostico')
   * 2. registra a interação (reunião) com o resumo executivo
   * 3. cria o reminder da devolutiva, se houver data
   */
  async create(tenantId: string, userId: string, body: any) {
    const p = body.payload ?? body;
    const estimatedAum = AUM_MAP[p.faixaPatrimonio] ?? null;
    const origemTipo   = ORIGEM_TIPO_MAP[p.origem] ?? null;
    const priority     = priorityFromAum(estimatedAum);
    const contexto     = [
      p.origem ? `Origem: ${p.origem}` : '',
      p.indicadoPor ? `Indicado por: ${p.indicadoPor}` : '',
      p.perfil ? `Perfil: ${p.perfil}` : '',
    ].filter(Boolean).join(' | ') || null;
    const visitDate = p.data || new Date().toISOString().slice(0, 10);

    return this.sql.begin(async (sql) => {
      // 1. Lead no pipeline
      const [lead] = await sql`
        INSERT INTO crm.leads (
          tenant_id, full_name, stage, banker_id,
          origem_tipo, contexto_relacionamento, estimated_aum, priority
        )
        VALUES (
          ${tenantId}, ${p.nome}, 'diagnostico', ${userId},
          ${origemTipo}, ${contexto}, ${estimatedAum}, ${priority}
        )
        RETURNING *
      `;

      // 2. Interação com o resumo executivo (occurred_at em horário de Brasília)
      await sql`
        INSERT INTO wealth.interactions (lead_id, banker_id, type, subject, notes, occurred_at)
        VALUES (
          ${lead.id}, ${userId}, 'reuniao',
          ${'Visita de diagnóstico: ' + (p.nome || 'cliente')},
          ${buildSummary(p)},
          (${visitDate}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
        )
      `;

      // 3. Reminder da devolutiva
      if (p.dataDevolutiva) {
        await sql`
          INSERT INTO crm.reminders (tenant_id, user_id, lead_id, title, remind_at, notes)
          VALUES (
            ${tenantId}, ${userId}, ${lead.id},
            ${'Devolutiva: ' + (p.nome || 'cliente')},
            ${p.dataDevolutiva}::date,
            ${p.proximoPasso ?? null}
          )
        `;
      }

      // 4. Visita completa (diagnóstico em JSONB)
      const [visit] = await sql`
        INSERT INTO crm.visits (
          tenant_id, user_id, lead_id, client_name,
          visit_date, devolutiva_date, tier, payload
        )
        VALUES (
          ${tenantId}, ${userId}, ${lead.id}, ${p.nome},
          ${visitDate}::date,
          ${p.dataDevolutiva ?? null}::date,
          ${p.tier ?? null},
          ${JSON.stringify(p)}::jsonb
        )
        RETURNING *
      `;

      return { ...visit, lead_id: lead.id, lead };
    });
  }

  /**
   * Atualiza uma visita já salva (reaberta na aba Salvas).
   * Não cria novo lead nem novo reminder; edições do lead são feitas na ficha dele.
   */
  async update(tenantId: string, userId: string, userRole: string, id: string, body: any) {
    const p = body.payload ?? body;
    const isSocio = userRole === 'socio';
    const [row] = await this.sql`
      UPDATE crm.visits SET
        client_name     = COALESCE(${p.nome ?? null}, client_name),
        visit_date      = COALESCE(${p.data ?? null}::date, visit_date),
        devolutiva_date = ${p.dataDevolutiva ?? null}::date,
        tier            = ${p.tier ?? null},
        payload         = ${JSON.stringify(p)}::jsonb,
        updated_at      = now()
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        ${isSocio ? this.sql`` : this.sql`AND user_id = ${userId}`}
      RETURNING *
    `;
    if (!row) throw new NotFoundException('Visita não encontrada');
    return row;
  }

  async remove(tenantId: string, userId: string, userRole: string, id: string) {
    const isSocio = userRole === 'socio';
    const [row] = await this.sql`
      DELETE FROM crm.visits
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        ${isSocio ? this.sql`` : this.sql`AND user_id = ${userId}`}
      RETURNING id
    `;
    if (!row) throw new NotFoundException('Visita não encontrada');
    return { deleted: true, id: row.id };
  }
}
