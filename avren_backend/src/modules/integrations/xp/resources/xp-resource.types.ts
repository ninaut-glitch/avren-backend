/**
 * Contratos publicados no portal XP Data Access em 31/07/2026.
 *
 * Os exemplos oficiais usam `data`; `value` e `@odata.nextLink` continuam
 * aceitos para compatibilidade com implementacoes OData do gateway.
 * Campos adicionais sao preservados para tolerar evolucao aditiva da API.
 */
export interface XpDataPage<T> {
  data?: T[];
  value?: T[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  [key: string]: unknown;
}

export function pageItems<T>(page: XpDataPage<T>): T[] {
  if (Array.isArray(page.data)) return page.data;
  if (Array.isArray(page.value)) return page.value;
  return [];
}

export interface XpReprocessingLogEntry {
  tableName: string;
  referenceDate: string;
  typeProcessing: 'INCREMENTAL' | 'FULL' | string;
  minimumProcessingDate: string;
  maximumProcessingDate: string;
  [key: string]: unknown;
}

/** Dimensao Account: /api/v1/account, atualizacao D-1. */
export interface XpRawAccount {
  dimAccountCode: number | string;
  accountCode: number | string;
  cpfCnpjCodeGuid?: string;
  birthYear?: number;
  birthMonth?: number;
  registerDate?: string;
  personType?: string;
  maritalStatus?: string;
  activity?: string;
  dscSuitability?: string;
  realStateValue?: number;
  movableAssetsValue?: number;
  incomeValue?: number;
  financialApplicationsValue?: number;
  othersValue?: number;
  qualifiedInvestorTerm?: string;
  professionalTerm?: string;
  startValidityDate?: string;
  endValidityDate?: string;
  currentRegisterIndicator?: number;
  id?: number | string;
  lastUpdate?: string;
  availableData?: boolean;
  [key: string]: unknown;
}

/** Fato AUC/Custodia: /api/v1/auc, atualizacao D-1. */
export interface XpRawPosition {
  dimAccountCode: number | string;
  dimTimeCode: number | string;
  dimOfficeChannelCode?: number | string;
  dimAdvisorCode?: number | string;
  dimProductCode: number | string;
  positionAmount?: number;
  positionValue?: number;
  termDueDate?: string;
  year?: number;
  month?: number;
  day?: number;
  id: number | string;
  lastUpdate?: string;
  availableData?: boolean;
  [key: string]: unknown;
}

/** Fato Inflow/Captacao: /api/v1/inflow, atualizacao D-1. */
export interface XpRawMovement {
  movementCode?: number | string;
  dimProductCode?: number | string;
  dimTimeCode: number | string;
  dimFinancialInstitutionalCode?: number | string;
  dimOfficeChannelCode?: number | string;
  dimAccountCode: number | string;
  dimMovementTypeCode?: number | string;
  movementNatureCode?: string;
  dimAdvisorCode?: number | string;
  movementAmount?: number;
  movementValue?: number;
  year?: number;
  month?: number;
  day?: number;
  id: number | string;
  lastUpdate?: string;
  availableData?: boolean;
  [key: string]: unknown;
}

/** Fato Commission: /api/v1/commission, fechamento mensal D-1. */
export interface XpRawCommission {
  dimTimeCode: number | string;
  dimProductCode?: number | string;
  dimAccountCode?: number | string;
  assetAmount?: number;
  origin?: string;
  comissionValue?: number;
  dimAdvisorCode?: number | string;
  dimOfficeChannelCode?: number | string;
  grossRevenueValue?: number;
  netRevenueValue?: number;
  percentageComissionValue?: number;
  companyCategory?: string;
  productComission?: string;
  roaAccounting?: number;
  id: number | string;
  lastUpdate?: string;
  availableData?: boolean;
  [key: string]: unknown;
}

/**
 * Recursos da fase 1 que ja possuem persistencia na migration 018.
 * Os nomes internos permanecem estaveis; os paths sao os oficiais.
 */
export const XP_RESOURCE_PATHS = {
  reprocessing_log: '/api/v1/reprocessing-log',
  accounts: '/api/v1/account',
  positions: '/api/v1/auc',
  movements: '/api/v1/inflow',
  commissions: '/api/v1/commission',
} as const;

/** Endpoints oficiais mapeados para a proxima fase, ainda sem persistencia. */
export const XP_PHASE_TWO_PATHS = {
  account_advisor_relation: '/api/v1/account-advisor-relation',
  products: '/api/v1/product-partner',
  positivador: '/api/v1/positivador',
  consolidated_positions: '/api/v1/consolidated-positions/customer/{customerCode}',
  wealth_evolution: '/api/v1/wealth-evolution/customer/{customerCode}',
  investment_statement: '/api/v1/investment-account/statement/customer/{customerCode}',
  investment_balance: '/api/v1/investment-account/balance/customer/{customerCode}',
  digital_balance: '/api/v1/digital-account/balance/customer/{customerCode}',
  operations: '/api/v2/operations/customers/{customerCode}',
} as const;

export type XpResourceKey = Exclude<keyof typeof XP_RESOURCE_PATHS, 'reprocessing_log'>;
