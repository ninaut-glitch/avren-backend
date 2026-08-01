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
 * Dimensao Produto: /api/v1/product-partner.
 * ATENCAO: a grafia oficial observada no portal e "productClassfication"
 * (sem o segundo "i"). Preservada aqui deliberadamente; normalizacao so
 * apos confirmacao em HML (pendencia registrada no XP_DATA_CONTRACT.md).
 */
export interface XpRawProduct {
  dimProductCode: number | string;
  assetCode?: string;
  productClassficationL0?: string;
  productClassficationL1?: string;
  productClassficationL2?: string;
  productClassficationL3?: string;
  productClassficationL4?: string;
  productClassficationL5?: string;
  cetselCode?: string;
  isinCode?: string;
  cnpjCode?: string;
  assetName?: string;
  issuerName?: string;
  custodyType?: string;
  issueDate?: string;
  dueDate?: string;
  managerName?: string;
  strategy?: string;
  yield?: string;
  index?: string;
  dealType?: string;
  productType?: string;
  issueFaceValue?: number;
  interestPaymentFrequency?: string;
  currentPartition?: number | string;
  currentRegister?: number | boolean;
  id?: number | string;
  lastUpdate?: string;
  availableData?: boolean;
  [key: string]: unknown;
}

/**
 * Relacao conta-assessor: /api/v1/account-advisor-relation.
 * A lista de campos NAO consta da secao publicada do contrato; os campos
 * abaixo seguem o padrao dimensional das demais tabelas e DEVEM ser
 * confirmados em HML antes de qualquer ampliacao (pendencia documentada).
 */
export interface XpRawAccountAdvisorRelation {
  dimAccountCode: number | string;
  dimAdvisorCode?: number | string;
  startValidityDate?: string;
  endValidityDate?: string;
  currentRegisterIndicator?: number;
  referenceDate?: string;
  id: number | string;
  lastUpdate?: string;
  availableData?: boolean;
  [key: string]: unknown;
}

/**
 * Positivador: /api/v1/positivador (ponto final analitico).
 * O tipo aceita o payload oficial completo, mas a PERSISTENCIA e por
 * allowlist estrita no mapper: campos pessoais (birthday, gender,
 * activity, maritalStatus, documentos) e o accountCode bruto NUNCA
 * chegam ao banco. Grafia oficial "qualifiedInvestorTern" preservada.
 */
export interface XpRawPositivador {
  advisorCode?: number | string;
  headOfficeCode?: number | string;
  accountCode: number | string;
  activity?: string;
  gender?: string;
  segment?: string;
  segmentClient?: string;
  dscSuitability?: string;
  qualifiedInvestorTern?: string;
  professionalInvestorTerm?: string;
  registerDate?: string;
  madeSecondContribution?: boolean | string;
  birthday?: string;
  status?: string;
  activatedInM?: boolean | string;
  churnedInM?: boolean | string;
  operatedStockExchange?: boolean | string;
  operatedFunds?: boolean | string;
  operatedFixedIncome?: boolean | string;
  financialApplications?: number;
  revenueInMonth?: number;
  bovespaRevenue?: number;
  futuresRevenue?: number;
  fixedIncomeBankingRevenue?: number;
  fixedIncomePrivateRevenue?: number;
  fixedIncomePublicRevenue?: number;
  grossCaptureInMonth?: number;
  redemptionInMonth?: number;
  netCaptureInMonth?: number;
  tedCapture?: number;
  stCapture?: number;
  otaCapture?: number;
  fixedIncomeCapture?: number;
  treasuryDirectCapture?: number;
  pensionCapture?: number;
  netInM1?: number;
  netInMonth?: number;
  netFixedIncome?: number;
  netRealEstateFunds?: number;
  netEquities?: number;
  netFunds?: number;
  netFinancial?: number;
  netPension?: number;
  netOthers?: number;
  rentalRevenue?: number;
  packageComplementRevenue?: number;
  personType?: string;
  positionDate?: string;
  id: number | string;
  lastUpdate?: string;
  availableData?: boolean;
  [key: string]: unknown;
}

/**
 * Recursos com persistencia propria (018 + 034).
 * Os nomes internos permanecem estaveis; os paths sao os oficiais.
 */
export const XP_RESOURCE_PATHS = {
  reprocessing_log: '/api/v1/reprocessing-log',
  accounts: '/api/v1/account',
  account_advisor_relations: '/api/v1/account-advisor-relation',
  products: '/api/v1/product-partner',
  positions: '/api/v1/auc',
  movements: '/api/v1/inflow',
  commissions: '/api/v1/commission',
  positivador: '/api/v1/positivador',
} as const;

/**
 * Mapa oficial tableName (Log de Reprocessamento) -> recurso interno.
 * Sujeito a confirmacao em HML; entradas desconhecidas NAO sao
 * adivinhadas (ficam sem mapeamento e geram aviso).
 */
export const REPROCESS_TABLE_MAP: Record<string, XpResourceKey> = {
  account: 'accounts',
  'account-advisor-relation': 'account_advisor_relations',
  'product-partner': 'products',
  auc: 'positions',
  inflow: 'movements',
  commission: 'commissions',
  positivador: 'positivador',
};

/** Endpoints oficiais por cliente, ainda sem persistencia (fase futura). */
export const XP_PHASE_TWO_PATHS = {
  consolidated_positions: '/api/v1/consolidated-positions/customer/{customerCode}',
  wealth_evolution: '/api/v1/wealth-evolution/customer/{customerCode}',
  investment_statement: '/api/v1/investment-account/statement/customer/{customerCode}',
  investment_balance: '/api/v1/investment-account/balance/customer/{customerCode}',
  digital_balance: '/api/v1/digital-account/balance/customer/{customerCode}',
  operations: '/api/v2/operations/customers/{customerCode}',
} as const;

export type XpResourceKey = Exclude<keyof typeof XP_RESOURCE_PATHS, 'reprocessing_log'>;
