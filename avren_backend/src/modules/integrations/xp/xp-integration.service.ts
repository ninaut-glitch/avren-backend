import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionContext } from '../../../database/rls.helper';
import { XpIntegrationRepository } from './xp-integration.repository';
import { resolveXpAuthUrl, AuthUrlSource } from './client/xp-auth-url';

const CAPABILITIES = [
  { key: 'reprocessing_log', label: 'Log de reprocessamento', phase: 1 },
  { key: 'accounts', label: 'Contas', phase: 1 },
  { key: 'positions', label: 'Posições e patrimônio', phase: 1 },
  { key: 'movements', label: 'Movimentações', phase: 1 },
  { key: 'products', label: 'Catálogo de produtos', phase: 2 },
  { key: 'fundraising', label: 'Captação', phase: 2 },
  { key: 'commissions', label: 'Comissões', phase: 2 },
] as const;

const CERT_EXPIRY_WARNING_DAYS = 30;

/** Ambientes aceitos pela 026. Qualquer outro valor nao e reconhecido. */
const VALID_ENVIRONMENTS = ['homologation', 'production'] as const;

export type CertExpiryStatus = 'not_configured' | 'expired' | 'warning' | 'ok';

/**
 * Contrato de getStatus() consumido por integrations-xp-page.tsx.
 * Explicito aqui para que uma quebra futura falhe na compilacao e no
 * teste de contrato, nao na tela.
 */
export interface XpStatusResponse {
  provider: 'xp';
  enabled: boolean;
  ready: boolean;
  mode: string;
  environment: string;
  environmentRecognized: boolean;
  credentialsConfigured: boolean;
  requiredConfiguration: {
    apiBaseUrl: boolean;
    authUrl: boolean;
    azureTenantId: boolean;
    clientId: boolean;
    clientSecret: boolean;
    subscriptionKey: boolean;
    oauthScope: boolean;
    userAgent: boolean;
    documentPepper: boolean;
    mtls: boolean;
  };
  /** Como a URL de autenticacao foi obtida: explicita, derivada ou ausente. */
  authUrlSource: AuthUrlSource;
  certExpiryWarning: {
    status: CertExpiryStatus;
    daysRemaining: number | null;
  };
  capabilities: typeof CAPABILITIES;
  connection: Record<string, unknown> | null;
  counts: Record<string, number>;
}

/**
 * GARANTIA DE SIGILO: este servico devolve APENAS booleanos de
 * presenca, o nome do ambiente/canal e metadados nao secretos da
 * conexao. Nenhum valor de credencial (client id/secret, subscription
 * key, material mTLS, credential_ref) e lido para a resposta. O
 * repositorio tambem nao seleciona credential_ref. Ha teste de
 * contrato que serializa a resposta e falha se qualquer valor
 * sensivel aparecer.
 */
@Injectable()
export class XpIntegrationService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: XpIntegrationRepository,
  ) {}

  async getStatus(ctx: SessionContext): Promise<XpStatusResponse> {
    const summary = await this.repository.getTenantSummary(ctx);
    const enabled = this.config.get('XP_INTEGRATION_ENABLED') === 'true';

    const hasMtlsViaPath = Boolean(
      this.config.get('XP_MTLS_CERT_PATH') && this.config.get('XP_MTLS_KEY_PATH'),
    );
    const hasMtlsViaBase64 = Boolean(
      this.config.get('XP_MTLS_CERT_BASE64') && this.config.get('XP_MTLS_KEY_BASE64'),
    );

    // authUrl: mesma regra usada pelo XpTokenProvider. O checklist
    // considera a URL EFETIVA (explicita ou derivada do tenant Azure)
    // e exige HTTPS, senao o provider recusaria a autenticacao.
    const resolvedAuth = resolveXpAuthUrl(this.config);

    const requiredConfiguration = {
      apiBaseUrl: Boolean(this.config.get('XP_API_BASE_URL')),
      authUrl: resolvedAuth.usable,
      azureTenantId: Boolean(this.config.get('XP_AZURE_TENANT_ID')),
      clientId: Boolean(this.config.get('XP_CLIENT_ID')),
      clientSecret: Boolean(this.config.get('XP_CLIENT_SECRET')),
      subscriptionKey: Boolean(this.config.get('XP_SUBSCRIPTION_KEY')),
      // Obrigatorios desde a v3.1/v3.2: o XpTokenProvider recusa a
      // autenticacao sem scope, e o User-Agent de parceiro e exigido
      // pela XP em todas as chamadas.
      oauthScope: Boolean(String(this.config.get('XP_OAUTH_SCOPE') ?? '').trim()),
      userAgent: Boolean(String(this.config.get('XP_USER_AGENT') ?? '').trim()),
      documentPepper: Boolean(
        String(this.config.get('XP_DOCUMENT_PEPPER') ?? '').trim(),
      ),
      mtls: hasMtlsViaPath || hasMtlsViaBase64,
    };

    const credentialsConfigured = Object.values(requiredConfiguration).every(Boolean);
    const environment = this.config.get<string>('XP_ENVIRONMENT') ?? 'homologation';
    const environmentRecognized = (VALID_ENVIRONMENTS as readonly string[]).includes(
      environment,
    );
    const certExpiryWarning = this.getCertExpiryWarning();
    // Certificado precisa existir E estar valido: 'expired' e
    // 'not_configured' nunca produzem ready.
    const certUsable =
      certExpiryWarning.status === 'ok' || certExpiryWarning.status === 'warning';

    return {
      provider: 'xp',
      enabled,
      // 'ready' exige, cumulativamente: flag ligada, TODA a
      // configuracao obrigatoria presente (incluindo scope e
      // User-Agent), ambiente reconhecido e certificado utilizavel.
      ready:
        enabled && credentialsConfigured && environmentRecognized && certUsable,
      mode: this.config.get<string>('XP_CHANNEL') ?? 'data_access',
      environment,
      environmentRecognized,
      credentialsConfigured,
      requiredConfiguration,
      authUrlSource: resolvedAuth.source,
      certExpiryWarning,
      capabilities: CAPABILITIES,
      connection: summary.connection,
      counts: summary.counts as Record<string, number>,
    };
  }

  getCapabilities() {
    return {
      provider: 'xp',
      recommendedChannel: 'data_access',
      alternativeChannel: 'open_finance',
      capabilities: CAPABILITIES,
      notes: [
        'A Reprocessing Log API deve ser consultada antes de qualquer outro recurso em cada sincronização.',
        'Data Access é a rota recomendada para a base do escritório.',
        'Open Finance depende de consentimento individual e requisitos regulatórios.',
        'Nenhum segredo deve ser armazenado no banco de dados.',
      ],
    };
  }

  /**
   * Estados tratados:
   *   not_configured  data ausente OU string invalida (nunca lanca)
   *   expired         daysRemaining < 0
   *   warning         0..30 dias restantes
   *   ok              acima de 30 dias
   * A data bruta nunca e devolvida, apenas o status e os dias.
   */
  private getCertExpiryWarning(): {
    status: CertExpiryStatus;
    daysRemaining: number | null;
  } {
    const rawExpiry = this.config.get<string>('XP_MTLS_CERT_EXPIRES_AT');
    if (!rawExpiry || !String(rawExpiry).trim()) {
      return { status: 'not_configured', daysRemaining: null };
    }

    const expiresAt = new Date(rawExpiry);
    if (Number.isNaN(expiresAt.getTime())) {
      return { status: 'not_configured', daysRemaining: null };
    }

    const daysRemaining = Math.ceil(
      (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    if (daysRemaining < 0) return { status: 'expired', daysRemaining };
    if (daysRemaining <= CERT_EXPIRY_WARNING_DAYS) {
      return { status: 'warning', daysRemaining };
    }
    return { status: 'ok', daysRemaining };
  }
}
