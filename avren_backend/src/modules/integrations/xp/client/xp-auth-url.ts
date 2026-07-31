import { ConfigService } from '@nestjs/config';

/**
 * REGRA UNICA de resolucao da URL de autenticacao (v3.2).
 *
 * Decisao: manter a derivacao a partir de XP_AZURE_TENANT_ID, porem
 * centralizada aqui e usada por TODOS os consumidores. Antes, o
 * XpTokenProvider derivava a URL enquanto o checklist do
 * XpIntegrationService olhava apenas XP_AUTH_URL: um tenant podia
 * autenticar com sucesso e mesmo assim ver "URL de autenticação"
 * pendente na tela. Agora as duas pontas chamam esta funcao.
 *
 * Precedencia:
 *   1. XP_AUTH_URL explicita, quando presente.
 *   2. Derivada de XP_AZURE_TENANT_ID no endpoint padrao do Azure AD
 *      para client credentials (v2.0).
 *   3. Nenhuma: source 'none'.
 *
 * A URL derivada e sempre HTTPS. Uma XP_AUTH_URL explicita sem HTTPS
 * e resolvida como invalida aqui e recusada no provider antes de
 * montar o corpo com o client_secret.
 */
export type AuthUrlSource = 'explicit' | 'derived' | 'none';

export interface ResolvedAuthUrl {
  url: string | null;
  source: AuthUrlSource;
  /** true somente se existe URL e ela usa HTTPS. */
  usable: boolean;
}

export function resolveXpAuthUrl(config: ConfigService): ResolvedAuthUrl {
  const explicit = (config.get<string>('XP_AUTH_URL') ?? '').trim();
  if (explicit) {
    return {
      url: explicit,
      source: 'explicit',
      usable: /^https:\/\//i.test(explicit),
    };
  }

  const azureTenantId = (config.get<string>('XP_AZURE_TENANT_ID') ?? '').trim();
  if (azureTenantId) {
    return {
      url: `https://login.microsoftonline.com/${encodeURIComponent(
        azureTenantId,
      )}/oauth2/v2.0/token`,
      source: 'derived',
      usable: true,
    };
  }

  return { url: null, source: 'none', usable: false };
}
