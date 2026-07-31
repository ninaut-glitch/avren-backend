import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XpTransport } from './xp-transport';
import { XpTokenProvider } from './xp-token.provider';
import { XpDataPage, pageItems } from '../resources/xp-resource.types';

export interface XpRequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Erro sanitizado: status + resumo. Nunca headers, corpo ou query. */
export class XpApiError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly summary: string,
  ) {
    super(summary);
    this.name = 'XpApiError';
  }
}

/** Token bucket simples. */
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  constructor(private readonly rps: number) {
    this.tokens = rps;
  }
  async take() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(
        this.rps,
        this.tokens + ((now - this.lastRefill) / 1000) * this.rps,
      );
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function boundedNumber(
  raw: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new XpApiError(
      null,
      `${name} invalido: use um numero entre ${min} e ${max}.`,
    );
  }
  return n;
}

/**
 * Cliente HTTP da Data Access API (Node 20+/undici).
 *
 * Endurecimentos v3:
 *   - nextLink aceito somente com HTTPS e ORIGEM exatamente igual a
 *     origem configurada (protocolo + host + porta).
 *   - redirect: 'error' em toda chamada: redirecionamentos nunca sao
 *     seguidos (nosso mTLS nao apresenta certificado a terceiros).
 *   - Limites validados com faixas seguras: timeout 1s..120s, retries
 *     0..5, RPS 1..50, pageSize 1..50.000. Valor fora da faixa e ERRO
 *     explicito, nao ajuste silencioso.
 * Guardas previos (nesta ordem): flag desligada, mTLS ausente,
 * Subscription Key ausente. Sanitizacao de erros por construcao.
 */
@Injectable()
export class XpHttpClient {
  private readonly logger = new Logger(XpHttpClient.name);
  private limiter: RateLimiter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly transport: XpTransport,
    private readonly tokens: XpTokenProvider,
  ) {}

  get enabled(): boolean {
    return this.config.get('XP_INTEGRATION_ENABLED') === 'true';
  }

  private limits() {
    return {
      timeoutMs: boundedNumber(
        this.config.get('XP_HTTP_TIMEOUT_MS'), 'XP_HTTP_TIMEOUT_MS', 1_000, 120_000, 15_000,
      ),
      maxRetries: boundedNumber(
        this.config.get('XP_HTTP_MAX_RETRIES'), 'XP_HTTP_MAX_RETRIES', 0, 5, 3,
      ),
      rps: boundedNumber(
        this.config.get('XP_RATE_LIMIT_RPS'), 'XP_RATE_LIMIT_RPS', 1, 50, 5,
      ),
      pageSize: boundedNumber(
        this.config.get('XP_PAGE_SIZE'), 'XP_PAGE_SIZE', 1, 50_000, 10_000,
      ),
    };
  }

  private baseOrigin(): URL {
    const url = this.config.get<string>('XP_API_BASE_URL');
    if (!url) throw new XpApiError(null, 'XP_API_BASE_URL nao configurada.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new XpApiError(null, 'XP_API_BASE_URL deve usar HTTPS.');
    }
    return parsed;
  }

  /** Path relativo ou URL absoluta (nextLink) com origem estritamente igual. */
  private resolveUrl(pathOrUrl: string): URL {
    const base = this.baseOrigin();
    if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl)) {
      let url: URL;
      try {
        url = new URL(pathOrUrl);
      } catch {
        throw new XpApiError(null, 'nextLink ilegivel foi recusado.');
      }
      if (url.protocol !== 'https:' || url.origin !== base.origin) {
        throw new XpApiError(
          null,
          'nextLink fora da origem HTTPS configurada foi recusado.',
        );
      }
      return url;
    }
    return new URL(base.origin + base.pathname.replace(/\/$/, '') + pathOrUrl);
  }

  async request<T>(pathOrUrl: string, opts: XpRequestOptions = {}): Promise<T> {
    if (!this.enabled) {
      throw new XpApiError(
        null,
        'Integracao XP desativada (XP_INTEGRATION_ENABLED=false). Nenhuma chamada foi feita.',
      );
    }
    const dispatcher = this.transport.getDispatcher();
    if (!dispatcher) {
      throw new XpApiError(null, 'mTLS nao configurado. Chamada bloqueada.');
    }
    const subscriptionKey = this.config.get<string>('XP_SUBSCRIPTION_KEY');
    if (!subscriptionKey) {
      throw new XpApiError(null, 'Subscription Key ausente. Chamada bloqueada.');
    }

    const { timeoutMs, maxRetries, rps } = this.limits();
    if (!this.limiter) this.limiter = new RateLimiter(rps);
    const userAgent =
      this.config.get<string>('XP_USER_AGENT') ?? 'XPparceiroDataAccess/AVREN';

    const url = this.resolveUrl(pathOrUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let attempt = 0;
    let tokenRefreshed = false;
    for (;;) {
      attempt++;
      await this.limiter.take();
      const token = await this.tokens.getToken();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': subscriptionKey,
            'User-Agent': userAgent,
            Accept: 'application/json',
            ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
          redirect: 'error',
          // Node 20+ (undici): mTLS via dispatcher.
          dispatcher,
        } as RequestInit & { dispatcher: unknown });

        if (res.status >= 300 && res.status < 400) {
          throw new XpApiError(
            res.status,
            `Redirecionamento bloqueado em ${this.sanitizePath(url.pathname)}.`,
          );
        }

        if (res.status === 401 && !tokenRefreshed) {
          tokenRefreshed = true;
          await this.tokens.invalidate();
          continue;
        }

        if (RETRIABLE_STATUS.has(res.status) && attempt <= maxRetries) {
          const retryAfter = Number(res.headers.get('Retry-After') ?? 0);
          await this.backoff(attempt, retryAfter);
          continue;
        }

        if (!res.ok) {
          throw new XpApiError(
            res.status,
            `XP respondeu HTTP ${res.status} em ${this.sanitizePath(url.pathname)}.`,
          );
        }

        return (await res.json()) as T;
      } catch (err: any) {
        if (err instanceof XpApiError) throw err;
        const aborted = err?.name === 'AbortError';
        const redirected =
          typeof err?.message === 'string' && /redirect/i.test(err.message);
        if (redirected) {
          throw new XpApiError(
            null,
            `Redirecionamento bloqueado em ${this.sanitizePath(url.pathname)}.`,
          );
        }
        if (attempt <= maxRetries) {
          await this.backoff(attempt, 0);
          continue;
        }
        throw new XpApiError(
          null,
          aborted
            ? `Timeout (${timeoutMs}ms) em ${this.sanitizePath(url.pathname)}.`
            : `Falha de rede em ${this.sanitizePath(url.pathname)}.`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Aceita os dois contratos documentados pela XP:
   *   - OData com value + @odata.nextLink;
   *   - data + paginacao por $skip/$top.
   */
  async paginate<T>(
    path: string,
    onPage: (items: T[], page: number) => Promise<void>,
    opts: { pageSize?: number; maxPages?: number; query?: XpRequestOptions['query'] } = {},
  ): Promise<{ pages: number; records: number }> {
    const { pageSize: defaultPageSize } = this.limits();
    const pageSize = opts.pageSize ?? defaultPageSize;
    const maxPages = opts.maxPages ?? 500;

    let page = 0;
    let records = 0;
    let next: string | null = path;
    let query: XpRequestOptions['query'] = { ...opts.query, $top: pageSize, $skip: 0 };

    while (next && page < maxPages) {
      const data: XpDataPage<T> = await this.request<XpDataPage<T>>(next, {
        query,
      });
      const items = pageItems(data);
      page++;
      records += items.length;
      await onPage(items, page);
      const nextLink = data['@odata.nextLink'] as string | undefined;
      if (nextLink) {
        next = nextLink;
        query = undefined;
      } else if (items.length === pageSize) {
        next = path;
        query = { ...opts.query, $top: pageSize, $skip: page * pageSize };
      } else {
        next = null;
      }
    }

    if (next && page >= maxPages) {
      this.logger.warn(
        `Paginacao interrompida em maxPages=${maxPages} para ${this.sanitizePath(path)}.`,
      );
    }

    return { pages: page, records };
  }

  private async backoff(attempt: number, retryAfterSec: number) {
    const base = retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** (attempt - 1);
    const jitter = Math.random() * 250;
    await new Promise((r) => setTimeout(r, Math.min(base + jitter, 30_000)));
  }

  private sanitizePath(path: string) {
    return path.split('?')[0].replace(/[0-9a-f-]{16,}/gi, ':id');
  }
}
