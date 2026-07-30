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
  constructor(private readonly documentPepper: string) {}

  map(raw: XpRawAccount): XpAccountRow | null {
    if (!raw?.accountId) return null;
    return {
      external_account_id: String(raw.accountId),
      account_number_mask: maskAccountNumber(raw.accountNumber),
      holder_document_hash: hashDocument(raw.holderDocument, this.documentPepper),
      holder_name: raw.holderName ?? null,
      advisor_code: raw.advisorCode ?? null,
      status: raw.status ?? null,
      raw_data: sanitizeRawData(raw),
    };
  }
}

export class DefaultPositionMapper implements XpMapper<XpRawPosition, XpPositionRow> {
  readonly resource = 'positions';
  map(raw: XpRawPosition): XpPositionRow | null {
    if (!raw?.positionId || !raw?.accountId || !raw?.asOfDate) return null;
    if (!raw.productName || !raw.assetClass) return null; // NOT NULL na 018
    return {
      external_position_id: String(raw.positionId),
      external_account_id: String(raw.accountId),
      asset_class: raw.assetClass,
      product_code: raw.productCode ?? null,
      product_name: raw.productName,
      symbol: raw.symbol ?? null,
      issuer_name: raw.issuerName ?? null,
      quantity: numOr(raw.quantity, null),
      unit_price: numOr(raw.unitPrice, null),
      gross_value: numOr(raw.grossValue, 0),
      net_value: numOr(raw.netValue, null),
      invested_value: numOr(raw.investedValue, null),
      currency: (raw.currency ?? 'BRL').slice(0, 3),
      maturity_date: raw.maturityDate ?? null,
      as_of_date: raw.asOfDate,
      raw_data: sanitizeRawData(raw),
    };
  }
}

export class DefaultMovementMapper implements XpMapper<XpRawMovement, XpMovementRow> {
  readonly resource = 'movements';
  map(raw: XpRawMovement): XpMovementRow | null {
    if (!raw?.movementId || !raw?.accountId || !raw?.occurredAt) return null;
    return {
      external_movement_id: String(raw.movementId),
      external_account_id: String(raw.accountId),
      position_external_id: raw.positionId ?? null,
      movement_type: raw.movementType ?? null,
      transaction_type: raw.transactionType ?? null,
      product_code: raw.productCode ?? null,
      product_name: raw.productName ?? null,
      amount: numOr(raw.amount, 0),
      quantity: numOr(raw.quantity, null),
      currency: (raw.currency ?? 'BRL').slice(0, 3),
      occurred_at: raw.occurredAt,
      raw_data: sanitizeRawData(raw),
    };
  }
}

export class DefaultCommissionMapper implements XpMapper<XpRawCommission, XpCommissionRow> {
  readonly resource = 'commissions';
  map(raw: XpRawCommission): XpCommissionRow | null {
    if (!raw?.commissionId || !raw?.competenceDate) return null;
    return {
      external_commission_id: String(raw.commissionId),
      external_account_id: raw.accountId ? String(raw.accountId) : null,
      advisor_code: raw.advisorCode ?? null,
      product_code: raw.productCode ?? null,
      gross_amount: numOr(raw.grossAmount, 0),
      net_amount: numOr(raw.netAmount, null),
      competence_date: raw.competenceDate,
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
      accountId: 'FIC-0001',
      accountNumber: '000123456',
      holderName: 'Cliente Ficticio Um',
      holderDocument: '000.000.001-91',
      advisorCode: 'A001',
      status: 'active',
    },
    {
      accountId: 'FIC-0002',
      accountNumber: '000765432',
      holderName: 'Cliente Ficticio Dois',
      holderDocument: '000.000.002-72',
      advisorCode: 'A001',
      status: 'active',
    },
  ] as XpRawAccount[],

  positions: [
    {
      positionId: 'POS-0001',
      accountId: 'FIC-0001',
      asOfDate: '2026-07-28',
      assetClass: 'Renda Fixa',
      productName: 'NTN-B Ficticia 2035',
      quantity: 100,
      unitPrice: 4500,
      grossValue: 450000,
      netValue: 448200,
      currency: 'BRL',
    },
  ] as XpRawPosition[],

  movements: [
    {
      movementId: 'MOV-0001',
      accountId: 'FIC-0001',
      occurredAt: '2026-07-27T14:00:00Z',
      movementType: 'aporte',
      amount: 50000,
      currency: 'BRL',
    },
  ] as XpRawMovement[],

  commissions: [
    {
      commissionId: 'COM-0001',
      accountId: 'FIC-0001',
      competenceDate: '2026-07-01',
      advisorCode: 'A001',
      productCode: 'RF',
      grossAmount: 1200.5,
      netAmount: 600.25,
    },
  ] as XpRawCommission[],
} as const;
