import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../database/database.provider';

interface PendingJob {
  id:            string;
  interactionId: string;
}

// FIX #3: payload tipado para validação após parse
interface AiSummaryPayload {
  resumo:          string;
  sentimento:      'positivo' | 'neutro' | 'negativo';
  oportunidade:    'baixa' | 'media' | 'alta';
  necessidades:    string[];
  proximos_passos: string[];
}

const VALID_SENTIMENTS  = new Set(['positivo', 'neutro', 'negativo']);
const VALID_OPPORTUNITY = new Set(['baixa', 'media', 'alta']);

// FIX #3: parse seguro com fallback por campo
function parseSummaryPayload(raw: string): AiSummaryPayload {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON malformado — usa estrutura vazia, campos serão preenchidos com defaults
  }

  return {
    resumo:          typeof parsed['resumo'] === 'string' && parsed['resumo']
                       ? parsed['resumo']
                       : 'Resumo indisponível — reprocessar.',
    sentimento:      VALID_SENTIMENTS.has(String(parsed['sentimento']))
                       ? parsed['sentimento'] as 'positivo' | 'neutro' | 'negativo'
                       : 'neutro',
    oportunidade:    VALID_OPPORTUNITY.has(String(parsed['oportunidade']))
                       ? parsed['oportunidade'] as 'baixa' | 'media' | 'alta'
                       : 'baixa',
    necessidades:    Array.isArray(parsed['necessidades'])
                       ? (parsed['necessidades'] as unknown[]).map(String)
                       : [],
    proximos_passos: Array.isArray(parsed['proximos_passos'])
                       ? (parsed['proximos_passos'] as unknown[]).map(String)
                       : [],
  };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly model:      string;
  private readonly apiKey:     string;
  private readonly apiEnabled: boolean;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
    private readonly config: ConfigService,
  ) {
    this.model  = config.get('AI_MODEL', 'claude-sonnet-4-6');
    this.apiKey = config.get('ANTHROPIC_API_KEY', '');

    // FIX #3: desativa silenciosamente se não houver API key
    this.apiEnabled = this.apiKey.length > 0;
    if (!this.apiEnabled) {
      this.logger.warn(
        'ANTHROPIC_API_KEY não configurada — AI job processing desativado.',
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledProcessing() {
    if (!this.apiEnabled) return;
    const n = await this.processPendingJobs(10);
    if (n > 0) this.logger.log(`AI: ${n} job(s) processado(s)`);
  }

  async processPendingJobs(batchSize = 10): Promise<number> {
    if (!this.apiEnabled) return 0;

    const jobs = await this.sql<PendingJob[]>`
      UPDATE ai.pending_jobs
      SET status = 'processing'
      WHERE id IN (
        SELECT id FROM ai.pending_jobs
        WHERE status IN ('pending', 'error')
        ORDER BY created_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, interaction_id AS "interactionId"
    `;

    let processed = 0;
    for (const job of jobs) {
      try {
        await this.processJob(job);
        await this.sql`
          UPDATE ai.pending_jobs
          SET status = 'done', processed_at = NOW()
          WHERE id = ${job.id}
        `;
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`AI job ${job.id} falhou: ${msg}`);
        await this.sql`
          UPDATE ai.pending_jobs
          SET status       = 'error',
              error_msg    = ${msg},
              processed_at = NOW()
          WHERE id = ${job.id}
        `;
      }
    }
    return processed;
  }

  private async processJob(job: PendingJob): Promise<void> {
    const [interaction] = await this.sql`
      SELECT
        i.id, i.client_id, i.banker_id,
        i.type, i.subject, i.notes, i.occurred_at,
        c.full_name AS client_name,
        u.full_name AS banker_name
      FROM wealth.interactions i
      JOIN wealth.clients c ON c.id = i.client_id
      JOIN auth.users    u ON u.id = i.banker_id
      WHERE i.id = ${job.interactionId}
    `;

    if (!interaction) {
      throw new Error(`Interaction ${job.interactionId} not found`);
    }

    // FIX #3: guarda da API key já verificada no constructor
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      this.model,
        max_tokens: 1024,
        system: `Você é o copiloto do banker da AVREN Wealth Management.
Analise a interação com o cliente e responda SOMENTE em JSON válido (sem markdown):
{
  "resumo": "2-3 frases executivas",
  "sentimento": "positivo|neutro|negativo",
  "oportunidade": "baixa|media|alta",
  "necessidades": ["array de strings"],
  "proximos_passos": ["array de strings"]
}`,
        messages: [{
          role: 'user',
          content:
            `Cliente: ${interaction.clientName}\n` +
            `Banker: ${interaction.bankerName}\n` +
            `Tipo: ${interaction.type}\n` +
            `Assunto: ${interaction.subject}\n` +
            `Notas: ${interaction.notes ?? 'Sem notas'}\n` +
            `Data: ${interaction.occurredAt}`,
        }],
      }),
    });

    // FIX #3: trata respostas HTTP de erro sem explodir
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as { content?: { text?: string }[] };
    const raw  = data.content?.[0]?.text ?? '';

    // FIX #3: parse seguro — nunca joga JSON inválido para o banco
    const parsed = parseSummaryPayload(raw);

    await this.sql`
      INSERT INTO ai.interaction_summaries (
        interaction_id, client_id, banker_id,
        summary, sentiment, opportunity_level,
        detected_needs, next_steps, model_name
      ) VALUES (
        ${job.interactionId},
        ${interaction.clientId},
        ${interaction.bankerId},
        ${parsed.resumo},
        ${parsed.sentimento},
        ${parsed.oportunidade},
        ${parsed.necessidades},
        ${parsed.proximos_passos},
        ${this.model}
      )
      ON CONFLICT (interaction_id) DO UPDATE SET
        summary           = EXCLUDED.summary,
        sentiment         = EXCLUDED.sentiment,
        opportunity_level = EXCLUDED.opportunity_level,
        detected_needs    = EXCLUDED.detected_needs,
        next_steps        = EXCLUDED.next_steps
    `;

    await this.sql`
      UPDATE wealth.interactions SET
        ai_summary    = ${parsed.resumo},
        ai_next_steps = ${parsed.proximos_passos}
      WHERE id = ${job.interactionId}
    `;
  }
}
