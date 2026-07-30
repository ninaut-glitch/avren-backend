/**
 * Testes unitarios SEM rede e SEM banco.
 * Cobertura (requisito 7): redirects bloqueados, nextLink HTTP/origem
 * estranha recusados, timeout do token, retry, configuracoes fora da
 * faixa segura, bloqueio com integracao desativada, User-Agent.
 */
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { XpTransport } from '../client/xp-transport';
import { InMemoryTokenStore, XpTokenProvider } from '../client/xp-token.provider';
import { XpApiError, XpHttpClient } from '../client/xp-http.client';
import { planReprocessing } from '../sync/xp-sync.service';
import {
  DefaultAccountMapper,
  hashDocument,
  sanitizeRawData,
} from '../mappers/xp-mappers';

function cfg(values: Record<string, string>) {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

const BASE = {
  XP_INTEGRATION_ENABLED: 'true',
  XP_API_BASE_URL: 'https://matls-api-hml.xpi.com.br',
  XP_SUBSCRIPTION_KEY: 'sub-key-fake',
  XP_USER_AGENT: 'AVREN-OS-Test/1.0',
  XP_HTTP_TIMEOUT_MS: '2000',
  XP_HTTP_MAX_RETRIES: '2',
  XP_RATE_LIMIT_RPS: '50',
};

function mockFetch(
  responses: Array<{ status: number; json?: any; headers?: Record<string, string> }>,
) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k: string) => r.headers?.[k] ?? null },
      json: async () => r.json ?? {},
    });
  }
  (global as any).fetch = fn;
  return fn;
}

function makeClient(values: Record<string, string> = {}, dispatcher: unknown = {}) {
  const config = cfg({ ...BASE, ...values });
  const transport = {
    getDispatcher: jest.fn().mockReturnValue(dispatcher),
  } as unknown as XpTransport;
  const tokens = {
    getToken: jest.fn().mockResolvedValue('tk'),
    invalidate: jest.fn().mockResolvedValue(undefined),
  } as unknown as XpTokenProvider;
  return { client: new XpHttpClient(config, transport, tokens), tokens };
}

// ── Transporte ────────────────────────────────────────────────

describe('XpTransport', () => {
  it('retorna null sem configuracao mTLS', () => {
    expect(new XpTransport(cfg({})).getDispatcher()).toBeNull();
  });

  it('falha explicitamente com PATH e BASE64 ao mesmo tempo', () => {
    const t = new XpTransport(
      cfg({
        XP_MTLS_CERT_PATH: '/x/c.pem', XP_MTLS_KEY_PATH: '/x/k.pem',
        XP_MTLS_CERT_BASE64: 'YQ==', XP_MTLS_KEY_BASE64: 'YQ==',
      }),
    );
    expect(() => t.getDispatcher()).toThrow(/ambigua/);
  });

  it('erro de carga nao ecoa o path do host', () => {
    // Sem mock: path realmente inexistente. O readFileSync lanca ENOENT
    // contendo o caminho; o transporte deve engolir isso e subir uma
    // mensagem generica.
    const secretPath = '/segredo/interno/nao-existe/cert.pem';
    const t = new XpTransport(
      cfg({ XP_MTLS_CERT_PATH: secretPath, XP_MTLS_KEY_PATH: '/segredo/interno/k.pem' }),
    );
    expect(fs.existsSync(secretPath)).toBe(false);
    try {
      t.getDispatcher();
      throw new Error('deveria ter lancado');
    } catch (e: any) {
      expect(e.message).toBe('Falha ao carregar o certificado mTLS da XP.');
      expect(e.message).not.toContain('/segredo');
      expect(e.message).not.toContain('ENOENT');
    }
  });
});

// ── Token provider ────────────────────────────────────────────

describe('XpTokenProvider', () => {
  it('bloqueia rede com integracao desativada', async () => {
    const p = new XpTokenProvider(
      cfg({ XP_INTEGRATION_ENABLED: 'false' }), new InMemoryTokenStore(),
    );
    (global as any).fetch = jest.fn();
    await expect(p.getToken()).rejects.toThrow(/desativada/);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('serve cache valido sem rede, mesmo desativada', async () => {
    const store = new InMemoryTokenStore();
    await store.set('xp:homologation', {
      accessToken: 'cached', expiresAt: Date.now() + 3_600_000,
    });
    const p = new XpTokenProvider(cfg({ XP_INTEGRATION_ENABLED: 'false' }), store);
    (global as any).fetch = jest.fn();
    await expect(p.getToken()).resolves.toBe('cached');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('recusa authUrl sem HTTPS (client_secret nunca em claro)', async () => {
    const p = new XpTokenProvider(
      cfg({
        XP_INTEGRATION_ENABLED: 'true',
        XP_AUTH_URL: 'http://login.exemplo/token',
        XP_CLIENT_ID: 'cid', XP_CLIENT_SECRET: 'secret',
        XP_OAUTH_SCOPE: 'api://xp-data-access/.default',
      }),
      new InMemoryTokenStore(),
    );
    (global as any).fetch = jest.fn();
    await expect(p.getToken()).rejects.toThrow(/HTTPS/);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('recusa quando XP_OAUTH_SCOPE esta ausente (obrigatorio na v3.1)', async () => {
    const p = new XpTokenProvider(
      cfg({
        XP_INTEGRATION_ENABLED: 'true',
        XP_AZURE_TENANT_ID: 'tid', XP_CLIENT_ID: 'cid', XP_CLIENT_SECRET: 's',
      }),
      new InMemoryTokenStore(),
    );
    (global as any).fetch = jest.fn();
    await expect(p.getToken()).rejects.toThrow(/XP_OAUTH_SCOPE ausente/);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('envia o scope no corpo do pedido de token', async () => {
    const p = new XpTokenProvider(
      cfg({
        XP_INTEGRATION_ENABLED: 'true',
        XP_AZURE_TENANT_ID: 'tid', XP_CLIENT_ID: 'cid', XP_CLIENT_SECRET: 's',
        XP_OAUTH_SCOPE: 'api://xp-data-access/.default',
      }),
      new InMemoryTokenStore(),
    );
    const fetchMock = mockFetch([
      { status: 200, json: { access_token: 'tk-1', expires_in: 3600 } },
    ]);
    await expect(p.getToken()).resolves.toBe('tk-1');
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('scope')).toBe('api://xp-data-access/.default');
    expect(body.get('grant_type')).toBe('client_credentials');
  });

  it('valida XP_OAUTH_SCOPE por formato', async () => {
    const p = new XpTokenProvider(
      cfg({
        XP_INTEGRATION_ENABLED: 'true',
        XP_AZURE_TENANT_ID: 'tid', XP_CLIENT_ID: 'cid', XP_CLIENT_SECRET: 's',
        XP_OAUTH_SCOPE: 'api://xp/.default; DROP TABLE',
      }),
      new InMemoryTokenStore(),
    );
    (global as any).fetch = jest.fn();
    await expect(p.getToken()).rejects.toThrow(/SCOPE/);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('aplica timeout ao pedido de token', async () => {
    jest.useFakeTimers();
    const p = new XpTokenProvider(
      cfg({
        XP_INTEGRATION_ENABLED: 'true',
        XP_AZURE_TENANT_ID: 'tid', XP_CLIENT_ID: 'cid', XP_CLIENT_SECRET: 's',
        XP_OAUTH_SCOPE: 'api://xp-data-access/.default',
        XP_HTTP_TIMEOUT_MS: '1000',
      }),
      new InMemoryTokenStore(),
    );
    (global as any).fetch = jest.fn(
      (_url: any, init: any) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const promise = p.getToken();
    const expectation = expect(promise).rejects.toThrow(/Timeout \(1000ms\)/);
    await jest.advanceTimersByTimeAsync(1100);
    await expectation;
    jest.useRealTimers();
  });

  it('erro de auth nao vaza o corpo da resposta', async () => {
    const p = new XpTokenProvider(
      cfg({
        XP_INTEGRATION_ENABLED: 'true',
        XP_AZURE_TENANT_ID: 'tid',
        XP_CLIENT_ID: 'client-id-sensivel', XP_CLIENT_SECRET: 's',
        XP_OAUTH_SCOPE: 'api://xp-data-access/.default',
      }),
      new InMemoryTokenStore(),
    );
    mockFetch([{ status: 400, json: { error: 'invalid_client client-id-sensivel' } }]);
    await expect(p.getToken()).rejects.toThrow(/400/);
    try {
      mockFetch([{ status: 400, json: { error: 'invalid_client client-id-sensivel' } }]);
      await p.getToken();
    } catch (e: any) {
      expect(e.message).not.toContain('client-id-sensivel');
    }
  });
});

// ── Client HTTP ───────────────────────────────────────────────

describe('XpHttpClient - guardas e configuracao', () => {
  it('recusa com XP_INTEGRATION_ENABLED=false, sem fetch', async () => {
    const { client } = makeClient({ XP_INTEGRATION_ENABLED: 'false' });
    (global as any).fetch = jest.fn();
    await expect(client.request('/accounts')).rejects.toThrow(XpApiError);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('recusa sem dispatcher mTLS e sem Subscription Key', async () => {
    const noMtls = makeClient({}, null);
    await expect(noMtls.client.request('/x')).rejects.toThrow(/mTLS/);
    const noKey = makeClient({ XP_SUBSCRIPTION_KEY: '' });
    await expect(noKey.client.request('/x')).rejects.toThrow(/Subscription Key/);
  });

  it('recusa configuracao fora da faixa segura (erro explicito)', async () => {
    for (const bad of [
      { XP_HTTP_TIMEOUT_MS: '50' },
      { XP_HTTP_TIMEOUT_MS: '999999' },
      { XP_HTTP_MAX_RETRIES: '99' },
      { XP_RATE_LIMIT_RPS: '0' },
      { XP_PAGE_SIZE: '10000' },
    ]) {
      const { client } = makeClient(bad as any);
      (global as any).fetch = jest.fn();
      await expect(client.request('/accounts')).rejects.toThrow(/entre/);
      expect((global as any).fetch).not.toHaveBeenCalled();
    }
  });

  it('exige HTTPS na base', async () => {
    const { client } = makeClient({ XP_API_BASE_URL: 'http://api.exemplo' });
    await expect(client.request('/x')).rejects.toThrow(/HTTPS/);
  });

  it('envia User-Agent e Subscription Key; renova token uma vez em 401', async () => {
    const { client, tokens } = makeClient();
    const fetchMock = mockFetch([{ status: 401 }, { status: 200, json: {} }]);
    await client.request('/accounts');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['User-Agent']).toBe('AVREN-OS-Test/1.0');
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('sub-key-fake');
    expect(init.redirect).toBe('error');
    expect((tokens as any).invalidate).toHaveBeenCalledTimes(1);
  });

  it('faz retry em 503 e desiste apos o limite', async () => {
    const { client } = makeClient({ XP_HTTP_MAX_RETRIES: '1' });
    const fetchMock = mockFetch([{ status: 503 }, { status: 503 }]);
    await expect(client.request('/positions')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bloqueia redirecionamento (3xx) como erro', async () => {
    const { client } = makeClient();
    mockFetch([{ status: 302, headers: { Location: 'https://outro/x' } }]);
    await expect(client.request('/accounts')).rejects.toThrow(/Redirecionamento/);
  });
});

describe('XpHttpClient - nextLink', () => {
  it('segue nextLink HTTPS da MESMA origem (cursor do servidor)', async () => {
    const { client } = makeClient();
    const fetchMock = mockFetch([
      {
        status: 200,
        json: {
          value: [{ i: 1 }],
          '@odata.nextLink':
            'https://matls-api-hml.xpi.com.br/accounts?$skiptoken=abc',
        },
      },
      { status: 200, json: { value: [{ i: 2 }] } },
    ]);
    const seen: number[] = [];
    const res = await client.paginate<{ i: number }>('/accounts', async (items) => {
      seen.push(...items.map((x) => x.i));
    });
    expect(seen).toEqual([1, 2]);
    expect(res.pages).toBe(2);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain('$skiptoken=abc');
  });

  it('recusa nextLink com HTTP (sem TLS)', async () => {
    const { client } = makeClient();
    mockFetch([
      {
        status: 200,
        json: {
          value: [{}],
          '@odata.nextLink': 'http://matls-api-hml.xpi.com.br/accounts?x=1',
        },
      },
    ]);
    await expect(client.paginate('/accounts', async () => undefined)).rejects.toThrow(
      /origem HTTPS/,
    );
  });

  it('recusa nextLink de origem diferente (host ou porta)', async () => {
    const { client } = makeClient();
    for (const link of [
      'https://atacante.example.com/accounts',
      'https://matls-api-hml.xpi.com.br:8443/accounts',
    ]) {
      mockFetch([{ status: 200, json: { value: [{}], '@odata.nextLink': link } }]);
      await expect(
        client.paginate('/accounts', async () => undefined),
      ).rejects.toThrow(/origem HTTPS/);
    }
  });
});

// ── Contrato de reprocessamento ───────────────────────────────

describe('planReprocessing (contrato, requisito 8)', () => {
  it('deriva o plano do log e descarta entradas incompletas', () => {
    const plan = planReprocessing([
      { resource: 'positions', referenceDate: '2026-07-25', reprocessedAt: 'x' },
      { resource: '', referenceDate: '2026-07-26', reprocessedAt: 'x' } as any,
    ]);
    expect(plan.entries).toEqual([
      { resource: 'positions', referenceDate: '2026-07-25' },
    ]);
  });
});

describe('mappers XP - privacidade', () => {
  it('usa HMAC com pepper e recusa segredo vazio', () => {
    const first = hashDocument('123.456.789-09', 'pepper-a');
    const second = hashDocument('123.456.789-09', 'pepper-b');

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(() => hashDocument('123.456.789-09', '')).toThrow(
      /XP_DOCUMENT_PEPPER/,
    );
  });

  it('remove PII inclusive de objetos aninhados', () => {
    expect(
      sanitizeRawData({
        accountId: 'A-1',
        holderDocument: '12345678909',
        nested: {
          cpf: '12345678909',
          full_name: 'Pessoa Teste',
          productCode: 'CDB',
        },
      }),
    ).toEqual({
      accountId: 'A-1',
      nested: { productCode: 'CDB' },
    });
  });

  it('mapper de conta nao persiste documento nem nome no raw_data', () => {
    const row = new DefaultAccountMapper('pepper-de-teste').map({
      accountId: 'A-1',
      holderDocument: '123.456.789-09',
      holderName: 'Pessoa Teste',
      accountNumber: '123456',
    });

    expect(row?.holder_document_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row?.raw_data).toEqual({
      accountId: 'A-1',
      accountNumber: '123456',
    });
  });
});
