import { createHmac } from 'crypto';
import {
  XpRawAccount,
  XpRawCommission,
  XpRawMovement,
  XpRawPosition,
  XpReprocessingLogEntry,
} from '../resources/xp-resource.types';

/**
 * Mapper substituivel: payload bruto -> linha das tabelas da 018.
 *
 * Contrato:
 *   - map() e pura: sem IO, sem banco.
 *   - Campos desconhecidos sao ignorados.
 *   - Campos obrigatorios ausentes => null => "skipped" (nao derruba o run).
 *   - PRIVACIDADE (estrategia da 018): o documento do titular NUNCA e
 *     persistido bruto. O mapper grava apenas holder_document_hash
 *     (HMAC-SHA256 dos digitos normalizados) e account_number_mask.
 *     Todo raw_data e higienizado recursivamente de campos de PII.
 */
export interface XpMapper<TRaw, TRow> {
  readonly resource: string;
  map(raw: TRaw, tenantId: string): TRow | null;
}

// ── Linhas de destino (colunas reais da 018) ─────────────────
// account_id e connection_id sao resolvidos pelo motor, nao pelo mapper.

export interface XpAccountRow {
  external_account_id: string;
  account_number_mask: string | null;
  holder_document_hash: string | null;
  holder_name: string | null;
  advisor_code: string | null;
  status: string | null;
  raw_data: Record<string, unknown>;
}

export interface XpPositionRow {
  external_position_id: string;
  external_account_id: string; // resolvido para account_id pelo motor
  asset_class: string;
  product_code: string | null;
  product_name: string;
  symbol: string | null;
  issuer_name: string | null;
  quantity: number | null;
  unit_price: number | null;
  gross_value: number;
  net_value: number | null;
  invested_value: number | null;
  currency: string;
  maturity_date: string | null;
  as_of_date: string;
  raw_data: Record<string, unknown>;
}

export interface XpMovementRow {
  external_movement_id: string;
  external_account_id: string;
  position_external_id: string | null;
  movement_type: string | null;
  transaction_type: string | null;
  product_code: string | null;
  product_name: string | null;
  amount: number;
  quantity: number | null;
  currency: string;
  occurred_at: string;
  raw_data: Record<string, unknown>;
}

export interface XpCommissionRow {
  external_commission_id: string;
  external_account_id: string | null;
  advisor_code: string | null;
  product_code: string | null;
  gross_amount: number;
  net_amount: number | null;
  competence_date: string;
  raw_data: Record<string, unknown>;
}

// ── Utilitarios ──────────────────────────────────────────────

export function hashDocument(doc: unknown, pepper: string): string | null {
  if (typeof doc !== 'string') return null;
  const digits = doc.replace(/\D/g, '');
  if (digits.length < 11) return null;
  if (!pepper.trim()) {
    throw new Error('XP_DOCUMENT_PEPPER nao configurado.');
  }
  return createHmac('sha256', pepper).update(digits).digest('hex');
}

export function maskAccountNumber(num: unknown): string | null {
  if (typeof num !== 'string' || num.length < 3) return null;
  const tail = num.slice(-4);
  return '****' + tail;
}

function numOr<T>(v: unknown, fallback: T): number | T {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function dimDate(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

const SENSITIVE_RAW_KEYS = [
  'cpf',
  'cnpj',
  'document',
  'documento',
  'taxid',
  'holdername',
  'fullname',
  'nomecompleto',
];

function isSensitiveRawKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_RAW_KEYS.some((token) => normalized.includes(token));
}

/**
 * Remove PII conhecida em qualquer nivel do payload antes de persistir
 * raw_data. Os payloads ainda sao provisorios; por isso a protecao e
 * aplicada aos quatro recursos e tambem a campos aninhados.
 */
export function sanitizeRawData(raw: unknown): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !isSensitiveRawKey(key))
        .map(([key, nested]) => [key, visit(nested)]),
    );
  };

  return visit(raw) as Record<string, unknown>;
}

// ── Implementacoes padrao ────────────────────────────────────

export class DefaultAccountMapper implements XpMapper<XpRawAccount, XpAccountRow> {
  readonly resource = 'accounts';

  map(raw: XpRawAccount): XpAccountRow | null {
    if (raw?.dimAccountCode === undefined || raw?.dimAccountCode === null) return null;
    return {
      external_account_id: String(raw.dimAccountCode),
      account_number_mask: maskAccountNumber(String(raw.accountCode ?? '')),
      // A API oficial entrega um GUID, nao o CPF/CNPJ bruto. Nao e
      // possivel nem necessario gerar HMAC desse identificador.
      holder_document_hash: null,
      holder_name: null,
      advisor_code: null,
      status: raw.currentRegisterIndicator === 1 ? 'active' : 'inactive',
      raw_data: sanitizeRawData(raw),
    };
  }
}

export class DefaultPositionMapper implements XpMapper<XpRawPosition, XpPositionRow> {
  readonly resource = 'positions';
  map(raw: XpRawPosition): XpPositionRow | null {
    const asOfDate = dimDate(raw?.dimTimeCode);
    if (raw?.id === undefined || raw?.dimAccountCode === undefined || !asOfDate) return null;
    if (raw.dimProductCode === undefined || raw.dimProductCode === null) return null;
    const productCode = String(raw.dimProductCode);
    return {
      external_position_id: String(raw.id),
      external_account_id: String(raw.dimAccountCode),
      // Nome, classe e emissor serao enriquecidos pela dimensao Produto
      // na fase 2. Estes valores deixam a custodia identificavel sem
      // inventar classificacoes de investimento.
      asset_class: 'Nao classificado',
      product_code: productCode,
      product_name: `Produto XP ${productCode}`,
      symbol: null,
      issuer_name: null,
      quantity: numOr(raw.positionAmount, null),
      unit_price: null,
      gross_value: numOr(raw.positionValue, 0),
      net_value: null,
      invested_value: null,
      currency: 'BRL',
      maturity_date: raw.termDueDate ?? null,
      as_of_date: asOfDate,
      raw_data: sanitizeRawData(raw),
    };
  }
}

export class DefaultMovementMapper implements XpMapper<XpRawMovement, XpMovementRow> {
  readonly resource = 'movements';
  map(raw: XpRawMovement): XpMovementRow | null {
    const occurredDate = dimDate(raw?.dimTimeCode);
    if (raw?.id === undefined || raw?.dimAccountCode === undefined || !occurredDate) return null;
    return {
      external_movement_id: String(raw.id),
      external_account_id: String(raw.dimAccountCode),
      position_external_id: null,
      movement_type: raw.dimMovementTypeCode == null
        ? null
        : String(raw.dimMovementTypeCode),
      transaction_type: raw.movementNatureCode ?? null,
      product_code: raw.dimProductCode == null ? null : String(raw.dimProductCode),
      product_name: null,
      amount: numOr(raw.movementValue, 0),
      quantity: numOr(raw.movementAmount, null),
      currency: 'BRL',
      occurred_at: `${occurredDate}T00:00:00Z`,
      raw_data: sanitizeRawData(raw),
    };
  }
}

export class DefaultCommissionMapper implements XpMapper<XpRawCommission, XpCommissionRow> {
  readonly resource = 'commissions';
  map(raw: XpRawCommission): XpCommissionRow | null {
    const competenceDate = dimDate(raw?.dimTimeCode);
    if (raw?.id === undefined || !competenceDate) return null;
    return {
      external_commission_id: String(raw.id),
      external_account_id: raw.dimAccountCode == null ? null : String(raw.dimAccountCode),
      advisor_code: raw.dimAdvisorCode == null ? null : String(raw.dimAdvisorCode),
      product_code: raw.dimProductCode == null ? null : String(raw.dimProductCode),
      gross_amount: numOr(raw.grossRevenueValue ?? raw.comissionValue, 0),
      net_amount: numOr(raw.netRevenueValue, null),
      competence_date: competenceDate,
      raw_data: sanitizeRawData(raw),
    };
  }
}

// ── Fixtures FICTICIAS ────────────────────────────────────────
// 100% inventadas, CPFs invalidos de proposito. Usadas apenas pelo
// dry-run (que roda em transacao com ROLLBACK) e pelos testes.

export const FIXTURES = {
  reprocessing_log: [] as XpReprocessingLogEntry[],

  accounts: [
    {
      dimAccountCode: 10000001,
      accountCode: 123456,
      cpfCnpjCodeGuid: 'guid-ficticio-1',
      currentRegisterIndicator: 1,
    },
    {
      dimAccountCode: 10000002,
      accountCode: 765432,
      cpfCnpjCodeGuid: 'guid-ficticio-2',
      currentRegisterIndicator: 1,
    },
  ] as XpRawAccount[],

  positions: [
    {
      id: 900001,
      dimAccountCode: 10000001,
      dimTimeCode: 20260728,
      dimProductCode: 30001,
      positionAmount: 100,
      positionValue: 450000,
      termDueDate: '2035-05-15T00:00:00',
    },
  ] as XpRawPosition[],

  movements: [
    {
      id: 800001,
      movementCode: 70001,
      dimAccountCode: 10000001,
      dimTimeCode: 20260727,
      dimMovementTypeCode: 1,
      movementNatureCode: 'C',
      movementValue: 50000,
    },
  ] as XpRawMovement[],

  commissions: [
    {
      id: 600001,
      dimAccountCode: 10000001,
      dimTimeCode: 20260701,
      dimAdvisorCode: 2001,
      dimProductCode: 30001,
      grossRevenueValue: 1200.5,
      netRevenueValue: 600.25,
    },
  ] as XpRawCommission[],
} as const;
