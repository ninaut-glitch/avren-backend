import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionContext } from '../../../database/rls.helper';
import { XpIntegrationRepository } from './xp-integration.repository';

const CAPABILITIES = [
  { key: 'accounts', label: 'Contas', phase: 1 },
  { key: 'positions', label: 'Posições e patrimônio', phase: 1 },
  { key: 'movements', label: 'Movimentações', phase: 1 },
  { key: 'products', label: 'Catálogo de produtos', phase: 2 },
  { key: 'fundraising', label: 'Captação', phase: 2 },
  { key: 'commissions', label: 'Comissões', phase: 2 },
] as const;

@Injectable()
export class XpIntegrationService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: XpIntegrationRepository,
  ) {}

  async getStatus(ctx: SessionContext) {
    const summary = await this.repository.getTenantSummary(ctx);
    const enabled = this.config.get('XP_INTEGRATION_ENABLED') === 'true';
    const requiredConfiguration = {
      apiBaseUrl: Boolean(this.config.get('XP_API_BASE_URL')),
      authUrl: Boolean(this.config.get('XP_AUTH_URL')),
      clientId: Boolean(this.config.get('XP_CLIENT_ID')),
      clientSecret: Boolean(this.config.get('XP_CLIENT_SECRET')),
    };
    const credentialsConfigured = Object.values(requiredConfiguration).every(Boolean);

    return {
      provider: 'xp',
      enabled,
      ready: enabled && credentialsConfigured,
      mode: this.config.get('XP_CHANNEL') ?? 'partner_api',
      environment: this.config.get('XP_ENVIRONMENT') ?? 'sandbox',
      credentialsConfigured,
      requiredConfiguration,
      capabilities: CAPABILITIES,
      ...summary,
    };
  }

  getCapabilities() {
    return {
      provider: 'xp',
      recommendedChannel: 'partner_api',
      alternativeChannel: 'open_finance',
      capabilities: CAPABILITIES,
      notes: [
        'A API de parceiros é a rota recomendada para a base do escritório.',
        'Open Finance depende de consentimento individual e requisitos regulatórios.',
        'Nenhum segredo deve ser armazenado no banco de dados.',
      ],
    };
  }
}
