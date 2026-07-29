import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionContext } from '../../../database/rls.helper';
import { XpIntegrationRepository } from './xp-integration.repository';

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

@Injectable()
  export class XpIntegrationService {
    constructor(
          private readonly config: ConfigService,
          private readonly repository: XpIntegrationRepository,
        ) {}

  async getStatus(ctx: SessionContext) {
        const summary = await this.repository.getTenantSummary(ctx);
        const enabled = this.config.get('XP_INTEGRATION_ENABLED') === 'true';

      const hasMtlsViaPath = Boolean(
              this.config.get('XP_MTLS_CERT_PATH') && this.config.get('XP_MTLS_KEY_PATH'),
            );
        const hasMtlsViaBase64 = Boolean(
                this.config.get('XP_MTLS_CERT_BASE64') && this.config.get('XP_MTLS_KEY_BASE64'),
              );

      const requiredConfiguration = {
              apiBaseUrl: Boolean(this.config.get('XP_API_BASE_URL')),
              authUrl: Boolean(this.config.get('XP_AUTH_URL')),
              azureTenantId: Boolean(this.config.get('XP_AZURE_TENANT_ID')),
              clientId: Boolean(this.config.get('XP_CLIENT_ID')),
              clientSecret: Boolean(this.config.get('XP_CLIENT_SECRET')),
              subscriptionKey: Boolean(this.config.get('XP_SUBSCRIPTION_KEY')),
              mtls: hasMtlsViaPath || hasMtlsViaBase64,
      };

      const credentialsConfigured = Object.values(requiredConfiguration).every(Boolean);

      return {
              provider: 'xp',
              enabled,
              ready: enabled && credentialsConfigured,
              mode: this.config.get('XP_CHANNEL') ?? 'data_access',
              environment: this.config.get('XP_ENVIRONMENT') ?? 'homologation',
              credentialsConfigured,
              requiredConfiguration,
              certExpiryWarning: this.getCertExpiryWarning(),
              capabilities: CAPABILITIES,
              ...summary,
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

  private getCertExpiryWarning() {
        const rawExpiry = this.config.get<string>('XP_MTLS_CERT_EXPIRES_AT');
        if (!rawExpiry) {
                return { status: 'not_configured' as const, daysRemaining: null };
        }

      const expiresAt = new Date(rawExpiry);
        if (Number.isNaN(expiresAt.getTime())) {
                return { status: 'not_configured' as const, daysRemaining: null };
        }

      const daysRemaining = Math.ceil(
              (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            );

      if (daysRemaining < 0) {
              return { status: 'expired' as const, daysRemaining };
      }
        if (daysRemaining <= CERT_EXPIRY_WARNING_DAYS) {
                return { status: 'warning' as const, daysRemaining };
        }
        return { status: 'ok' as const, daysRemaining };
  }
}
