/**
 * Interfaces dos recursos da Data Access API.
 *
 * ATENCAO: estruturas PROVISORIAS ate os payloads de homologacao.
 * Todo recurso carrega [key: string]: unknown para os mappers nao
 * quebrarem com campos desconhecidos.
 *
 * Quando os payloads reais chegarem, apenas tres pontos mudam:
 *   1. Estes tipos.
 *   2. Os fixtures em ../mappers/xp-mappers.ts.
 *   3. Os mappers correspondentes.
 * Motor, client, conciliacao e telas nao mudam.
 */

export interface ODataPage<T> {
  value: T[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  [key: string]: unknown;
}

/**
 * Reprocessing Log: consulta OBRIGATORIA antes de qualquer outro
 * recurso em cada sincronizacao.
 */
export interface XpReprocessingLogEntry {
  resource: string;
  referenceDate: string;
  reprocessedAt: string;
  [key: string]: unknown;
}

export interface XpRawAccount {
  /** Identificador externo da conta na XP (vira external_account_id). */
  accountId: string;
  accountNumber?: string;
  holderName?: string;
  /** Documento do titular; NUNCA e persistido bruto (vira hash + mascara). */
  holderDocument?: string;
  advisorCode?: string;
  status?: string;
  [key: string]: unknown;
}

export interface XpRawPosition {
  positionId: string;
  accountId: string;
  asOfDate: string;
  assetClass?: string;
  productCode?: string;
  productName?: string;
  symbol?: string;
  issuerName?: string;
  quantity?: number;
  unitPrice?: number;
  grossValue?: number;
  netValue?: number;
  investedValue?: number;
  currency?: string;
  maturityDate?: string;
  [key: string]: unknown;
}

export interface XpRawMovement {
  movementId: string;
  accountId: string;
  occurredAt: string;
  positionId?: string;
  movementType?: string;
  transactionType?: string;
  productCode?: string;
  productName?: string;
  amount?: number;
  quantity?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface XpRawCommission {
  commissionId: string;
  accountId?: string;
  competenceDate: string;
  advisorCode?: string;
  productCode?: string;
  grossAmount?: number;
  netAmount?: number;
  [key: string]: unknown;
}

/** Paths PROVISORIOS; confirmar na documentacao credenciada. */
export const XP_RESOURCE_PATHS = {
  reprocessing_log: '/reprocessing-log',
  accounts: '/accounts',
  positions: '/positions',
  movements: '/movements',
  commissions: '/commissions',
} as const;

export type XpResourceKey = keyof typeof XP_RESOURCE_PATHS;
