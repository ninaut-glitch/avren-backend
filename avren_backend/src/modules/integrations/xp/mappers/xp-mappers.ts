import { createHmac } from 'crypto';
import {
  XpRawAccount,
  XpRawAccountAdvisorRelation,
  XpRawCommission,
  XpRawMovement,
  XpRawPosition,
  XpRawPositivador,
  XpRawProduct,
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
  account_code_hash: string | null;
  holder_document_hash: string | null;
  holder_name: string | null;
  advisor_code: string | null;
  status: string | null;
  raw_data: Record<string, unknown>;
}

export interface XpProductRow {
  external_product_id: string;
  asset_code: string | null;
  product_name: string | null;
  issuer_name: string | null;
  classification_l0: string | null;
  classification_l1: string | null;
  classification_l2: string | null;
  classification_l3: string | null;
  classification_l4: string | null;
  classification_l5: string | null;
  custody_type: string | null;
  issue_date: string | null;
  due_date: string | null;
  manager_name: string | null;
  strategy: string | null;
  yield_description: string | null;
  index_name: string | null;
  deal_type: string | null;
  product_type: string | null;
  interest_payment_frequency: string | null;
  current_register: boolean | null;
  last_update: string | null;
  available_data: boolean | null;
  raw_data: Record<string, unknown>;
}

export interface XpAccountAdvisorRelationRow {
  external_relation_id: string;
  external_account_id: string;
  advisor_code: string | null;
  reference_date: string; // NOT NULL por contrato: sem data confiavel => skip
  start_validity_date: string | null;
  end_validity_date: string | null;
  current_register: boolean | null;
  last_update: string | null;
  available_data: boolean | null;
  raw_data: Record<string, unknown>;
}

export interface XpPositivadorRow {
  external_positivador_id: string;
  account_code_hash: string | null;
  advisor_code: string | null;
  head_office_code: string | null;
  segment: string | null;
  segment_client: string | null;
  suitability: string | null;
  made_second_contribution: boolean | null;
  status: string | null;
  activated_in_month: boolean | null;
  churned_in_month: boolean | null;
  operated_stock_exchange: boolean | null;
  operated_funds: boolean | null;
  operated_fixed_income: boolean | null;
  financial_applications: number | null;
  revenue_in_month: number | null;
  bovespa_revenue: number | null;
  futures_revenue: number | null;
  fixed_income_banking_revenue: number | null;
  fixed_income_private_revenue: number | null;
  fixed_income_public_revenue: number | null;
  gross_capture_in_month: number | null;
  redemption_in_month: number | null;
  net_capture_in_month: number | null;
  ted_capture: number | null;
  st_capture: number | null;
  ota_capture: number | null;
  fixed_income_capture: number | null;
  treasury_direct_capture: number | null;
  pension_capture: number | null;
  net_in_m1: number | null;
  net_in_month: number | null;
  net_fixed_income: number | null;
  net_real_estate_funds: number | null;
  net_equities: number | null;
  net_funds: number | null;
  net_financial: number | null;
  net_pension: number | null;
  net_others: number | null;
  rental_revenue: number | null;
  package_complement_revenue: number | null;
  person_type: string | null;
  position_date: string;
  last_update: string | null;
  available_data: boolean | null;
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

/**
 * Vinculo pseudonimizado Account <-> Positivador (Etapa B).
 * HMAC-SHA256 dos digitos do accountCode com pepper DEDICADO
 * (XP_ACCOUNT_PEPPER; nunca reutilizar XP_DOCUMENT_PEPPER).
 * Pepper ausente => null => vinculo PENDENTE, jamais vazamento ou
 * queda do run. O pepper nunca aparece em logs nem em erros.
 */
export function hashAccountCode(
  accountCode: unknown,
  pepper: string | undefined,
): string | null {
  const digits = String(accountCode ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  if (!pepper || !pepper.trim()) return null;
  return createHmac('sha256', pepper).update(digits).digest('hex');
}

/** 'AAAA-MM-DD...' ou AAAAMMDD -> 'AAAA-MM-DD'; invalido -> null. */
function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const candidate = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : dimDate(s);
  if (!candidate) return null;
  return Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) ? null : candidate;
}

/** Booleanos oficiais podem vir como boolean ou 'S'/'N' (confirmar em HML). */
function boolOr(value: unknown, fallback: boolean | null): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'S' || value === 's' || value === 1) return true;
  if (value === 'N' || value === 'n' || value === 0) return false;
  return fallback;
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

/**
 * A dimensao Account mistura chaves tecnicas com numero de conta, perfil
 * cadastral e patrimonio declarado. Para esse recurso usamos allowlist:
 * campos novos da XP nao passam a ser persistidos automaticamente.
 */
const ACCOUNT_RAW_TECHNICAL_KEYS = new Set([
  'dimAccountCode',
  'startValidityDate',
  'endValidityDate',
  'currentRegisterIndicator',
  'id',
  'lastUpdate',
  'availableData',
]);

export function sanitizeAccountRawData(
  raw: XpRawAccount,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => ACCOUNT_RAW_TECHNICAL_KEYS.has(key)),
  );
}

// ── Implementacoes padrao ────────────────────────────────────

export class DefaultAccountMapper implements XpMapper<XpRawAccount, XpAccountRow> {
  readonly resource = 'accounts';

  constructor(private readonly accountPepper: string = '') {}

  map(raw: XpRawAccount): XpAccountRow | null {
    if (raw?.dimAccountCode === undefined || raw?.dimAccountCode === null) return null;
    return {
      external_account_id: String(raw.dimAccountCode),
      account_number_mask: maskAccountNumber(String(raw.accountCode ?? '')),
      // Vinculo pseudonimizado com o Positivador; null = pendente.
      account_code_hash: hashAccountCode(raw.accountCode, this.accountPepper),
      // A API oficial entrega um GUID, nao o CPF/CNPJ bruto. Nao e
      // possivel nem necessario gerar HMAC desse identificador.
      holder_document_hash: null,
      holder_name: null,
      advisor_code: null,
      status: raw.currentRegisterIndicator === 1 ? 'active' : 'inactive',
      raw_data: sanitizeAccountRawData(raw),
    };
  }
}

export class DefaultProductMapper implements XpMapper<XpRawProduct, XpProductRow> {
  readonly resource = 'products';
  map(raw: XpRawProduct): XpProductRow | null {
    if (raw?.dimProductCode === undefined || raw?.dimProductCode === null) return null;
    return {
      external_product_id: String(raw.dimProductCode),
      asset_code: raw.assetCode ?? null,
      product_name: raw.assetName ?? null,
      issuer_name: raw.issuerName ?? null,
      // Grafia oficial de ENTRADA preservada (productClassfication);
      // colunas internas normalizadas e documentadas na 034.
      classification_l0: raw.productClassficationL0 ?? null,
      classification_l1: raw.productClassficationL1 ?? null,
      classification_l2: raw.productClassficationL2 ?? null,
      classification_l3: raw.productClassficationL3 ?? null,
      classification_l4: raw.productClassficationL4 ?? null,
      classification_l5: raw.productClassficationL5 ?? null,
      custody_type: raw.custodyType ?? null,
      issue_date: dateOnly(raw.issueDate),
      due_date: dateOnly(raw.dueDate),
      manager_name: raw.managerName ?? null,
      strategy: raw.strategy ?? null,
      yield_description: raw.yield ?? null,
      index_name: raw.index ?? null,
      deal_type: raw.dealType ?? null,
      product_type: raw.productType ?? null,
      interest_payment_frequency: raw.interestPaymentFrequency ?? null,
      current_register: boolOr(raw.currentRegister, null),
      last_update: raw.lastUpdate ?? null,
      available_data: typeof raw.availableData === 'boolean' ? raw.availableData : null,
      raw_data: sanitizeRawData(raw),
    };
  }
}

export class DefaultAccountAdvisorRelationMapper
  implements XpMapper<XpRawAccountAdvisorRelation, XpAccountAdvisorRelationRow>
{
  readonly resource = 'account_advisor_relations';
  map(raw: XpRawAccountAdvisorRelation): XpAccountAdvisorRelationRow | null {
    if (raw?.id === undefined || raw?.dimAccountCode === undefined) return null;
    // DETERMINISTICO por contrato: campo oficial de referencia, depois
    // vigencia, depois lastUpdate. SEM data confiavel => descarte
    // controlado (skipped). NUNCA a data corrente de ingestao.
    const referenceDate =
      dateOnly(raw.referenceDate) ??
      dateOnly(raw.startValidityDate) ??
      dateOnly(raw.lastUpdate);
    if (!referenceDate) return null;
    return {
      external_relation_id: String(raw.id),
      external_account_id: String(raw.dimAccountCode),
      advisor_code: raw.dimAdvisorCode == null ? null : String(raw.dimAdvisorCode),
      reference_date: referenceDate,
      start_validity_date: dateOnly(raw.startValidityDate),
      end_validity_date: dateOnly(raw.endValidityDate),
      current_register:
        raw.currentRegisterIndicator == null
          ? null
          : raw.currentRegisterIndicator === 1,
      last_update: raw.lastUpdate ?? null,
      available_data: typeof raw.availableData === 'boolean' ? raw.availableData : null,
      raw_data: sanitizeRawData(raw),
    };
  }
}

/**
 * Positivador: allowlist ESTRITA. O objeto retornado possui apenas as
 * colunas gerenciais aprovadas; birthday, gender, activity,
 * maritalStatus, registerDate, termos e QUALQUER campo desconhecido do
 * payload sao descartados aqui. Nao ha raw_data por decisao deliberada.
 */
export class DefaultPositivadorMapper
  implements XpMapper<XpRawPositivador, XpPositivadorRow>
{
  readonly resource = 'positivador';

  constructor(private readonly accountPepper: string = '') {}

  map(raw: XpRawPositivador): XpPositivadorRow | null {
    if (raw?.id === undefined) return null;
    const positionDate = dateOnly(raw.positionDate);
    if (!positionDate) return null;
    return {
      external_positivador_id: String(raw.id),
      account_code_hash: hashAccountCode(raw.accountCode, this.accountPepper),
      advisor_code: raw.advisorCode == null ? null : String(raw.advisorCode),
      head_office_code: raw.headOfficeCode == null ? null : String(raw.headOfficeCode),
      segment: raw.segment ?? null,
      segment_client: raw.segmentClient ?? null,
      suitability: raw.dscSuitability ?? null,
      made_second_contribution: boolOr(raw.madeSecondContribution, null),
      status: raw.status ?? null,
      activated_in_month: boolOr(raw.activatedInM, null),
      churned_in_month: boolOr(raw.churnedInM, null),
      operated_stock_exchange: boolOr(raw.operatedStockExchange, null),
      operated_funds: boolOr(raw.operatedFunds, null),
      operated_fixed_income: boolOr(raw.operatedFixedIncome, null),
      financial_applications: numOr(raw.financialApplications, null),
      revenue_in_month: numOr(raw.revenueInMonth, null),
      bovespa_revenue: numOr(raw.bovespaRevenue, null),
      futures_revenue: numOr(raw.futuresRevenue, null),
      fixed_income_banking_revenue: numOr(raw.fixedIncomeBankingRevenue, null),
      fixed_income_private_revenue: numOr(raw.fixedIncomePrivateRevenue, null),
      fixed_income_public_revenue: numOr(raw.fixedIncomePublicRevenue, null),
      gross_capture_in_month: numOr(raw.grossCaptureInMonth, null),
      redemption_in_month: numOr(raw.redemptionInMonth, null),
      net_capture_in_month: numOr(raw.netCaptureInMonth, null),
      ted_capture: numOr(raw.tedCapture, null),
      st_capture: numOr(raw.stCapture, null),
      ota_capture: numOr(raw.otaCapture, null),
      fixed_income_capture: numOr(raw.fixedIncomeCapture, null),
      treasury_direct_capture: numOr(raw.treasuryDirectCapture, null),
      pension_capture: numOr(raw.pensionCapture, null),
      net_in_m1: numOr(raw.netInM1, null),
      net_in_month: numOr(raw.netInMonth, null),
      net_fixed_income: numOr(raw.netFixedIncome, null),
      net_real_estate_funds: numOr(raw.netRealEstateFunds, null),
      net_equities: numOr(raw.netEquities, null),
      net_funds: numOr(raw.netFunds, null),
      net_financial: numOr(raw.netFinancial, null),
      net_pension: numOr(raw.netPension, null),
      net_others: numOr(raw.netOthers, null),
      rental_revenue: numOr(raw.rentalRevenue, null),
      package_complement_revenue: numOr(raw.packageComplementRevenue, null),
      person_type: raw.personType ?? null,
      position_date: positionDate,
      last_update: raw.lastUpdate ?? null,
      available_data: typeof raw.availableData === 'boolean' ? raw.availableData : null,
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
      // Nao mistura comissionValue com receita bruta: sao metricas
      // distintas no contrato oficial. Confirmar obrigatoriedade em HML.
      gross_amount: numOr(raw.grossRevenueValue, 0),
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

  account_advisor_relations: [
    {
      id: 500001,
      dimAccountCode: 10000001,
      dimAdvisorCode: 2001,
      startValidityDate: '2026-01-02T00:00:00',
      currentRegisterIndicator: 1,
      lastUpdate: '2026-07-28T03:00:00',
    },
  ] as XpRawAccountAdvisorRelation[],

  products: [
    {
      dimProductCode: 30001,
      assetCode: 'FICTICIO11',
      assetName: 'Produto Ficticio de Teste',
      issuerName: 'Emissor Ficticio S.A.',
      productClassficationL0: 'Renda Fixa',
      productClassficationL1: 'Bancario',
      custodyType: 'B3',
      dueDate: '2035-05-15T00:00:00',
      currentRegister: 1,
    },
  ] as XpRawProduct[],

  positivador: [
    {
      id: 400001,
      accountCode: 123456,
      advisorCode: 2001,
      segment: 'Private Ficticio',
      grossCaptureInMonth: 100000,
      redemptionInMonth: 25000,
      netCaptureInMonth: 75000,
      revenueInMonth: 1800.75,
      positionDate: '2026-07-01T00:00:00',
      // campos pessoais presentes DE PROPOSITO nas fixtures para os
      // testes provarem que a allowlist os descarta:
      birthday: '1990-01-01',
      gender: 'X',
      activity: 'Profissao Ficticia',
    },
  ] as XpRawPositivador[],
} as const;
