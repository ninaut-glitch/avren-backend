import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveXpAuthUrl } from './xp-auth-url';

export interface TokenStore {
  get(key: string): Promise<CachedToken | null>;
  set(key: string, token: CachedToken): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface CachedToken {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

export class InMemoryTokenStore implements TokenStore {
  private store = new Map<string, CachedToken>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, token: CachedToken) {
    this.store.set(key, token);
  }
  async clear(key: string) {
    this.store.delete(key);
  }
}

/** Token de DI para o store (memoria hoje, Redis amanha). */
export const XP_TOKEN_STORE = 'XP_TOKEN_STORE';

const EXPIRY_SAFETY_MS = 60_000;
/** Scope: caracteres tipicos de scopes Azure (url + .default), sem espacos multiplos suspeitos. */
const SCOPE_RE = /^[A-Za-z0-9._:/-]+(\s[A-Za-z0-9._:/-]+)*$/;

/**
 * Client credentials contra o Azure AD da XP.
 *
 * Endurecimentos v3:
 *   - Rede bloqueada quando XP_INTEGRATION_ENABLED !== 'true'
 *     (cache valido continua servivel sem rede).
 *   - authUrl resolvida por resolveXpAuthUrl (regra unica do sistema)
 *     e obrigatoriamente https: o client_secret nunca viaja em claro.
 *   - Timeout proprio no pedido de token (XP_HTTP_TIMEOUT_MS).
 *   - XP_OAUTH_SCOPE OBRIGATORIO e validado por formato.
 *   - User-Agent configuravel tambem no endpoint de token.
 * Token e segredos nunca sao logados; erros de auth sobem sem corpo.
 */
@Injectable()
export class XpTokenProvider {
  private readonly logger = new Logger(XpTokenProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly store: TokenStore,
  ) {}

  private get enabled(): boolean {
    return this.config.get('XP_INTEGRATION_ENABLED') === 'true';
  }

  private cacheKey() {
    const env = this.config.get<string>('XP_ENVIRONMENT') ?? 'homologation';
    return `xp:${env}`;
  }

  async getToken(): Promise<string> {
    const cached = await this.store.get(this.cacheKey());
    if (cached && cached.expiresAt - EXPIRY_SAFETY_MS > Date.now()) {
      return cached.accessToken;
    }

    if (!this.enabled) {
      throw new Error(
        'Integracao XP desativada: obtencao de token bloqueada, nenhuma chamada foi feita.',
      );
    }

    const clientId = this.config.get<string>('XP_CLIENT_ID');
    const clientSecret = this.config.get<string>('XP_CLIENT_SECRET');
    // REGRA UNICA compartilhada com o checklist do XpIntegrationService.
    const resolvedAuth = resolveXpAuthUrl(this.config);
    const authUrl = resolvedAuth.url;
    const scope = (this.config.get<string>('XP_OAUTH_SCOPE') ?? '').trim();

    if (!authUrl || !clientId || !clientSecret) {
      throw new Error('Credenciais OAuth da XP ausentes no ambiente.');
    }
    if (!/^https:\/\//i.test(authUrl)) {
      throw new Error(
        'XP_AUTH_URL sem HTTPS: envio de client_secret recusado.',
      );
    }
    // XP_OAUTH_SCOPE e OBRIGATORIO (v3.1). Client credentials no Azure
    // AD exige scope explicito (tipicamente api://<app-id>/.default);
    // sem ele o token vem sem audience util e a API responde 401. Se a
    // documentacao credenciada da XP determinar o contrario, esta e a
    // unica linha a relaxar.
    if (!scope) {
      throw new Error(
        'XP_OAUTH_SCOPE ausente: obrigatorio para client credentials no Azure AD.',
      );
    }
    if (scope.length > 512 || !SCOPE_RE.test(scope)) {
      throw new Error('XP_OAUTH_SCOPE em formato invalido.');
    }

    const timeoutMs = Math.min(
      Math.max(Number(this.config.get('XP_HTTP_TIMEOUT_MS') ?? 15_000), 1_000),
      120_000,
    );

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.config.get('XP_USER_AGENT') ?? 'AVREN-OS/1.0',
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (err: any) {
      throw new Error(
        err?.name === 'AbortError'
          ? `Timeout (${timeoutMs}ms) no endpoint de autenticacao da XP.`
          : 'Falha de rede ao contatar o endpoint de autenticacao da XP.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`Autenticacao XP recusada (HTTP ${res.status}).`);
    }

    const json: any = await res.json();
    if (!json?.access_token || !json?.expires_in) {
      throw new Error('Resposta de token da XP em formato inesperado.');
    }

    const token: CachedToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + Number(json.expires_in) * 1000,
    };
    await this.store.set(this.cacheKey(), token);
    this.logger.log('Token XP renovado.');
    return token.accessToken;
  }

  async invalidate() {
    await this.store.clear(this.cacheKey());
  }
}
