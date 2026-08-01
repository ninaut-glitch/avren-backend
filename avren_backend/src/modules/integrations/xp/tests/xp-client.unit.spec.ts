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
  DefaultAccountAdvisorRelationMapper,
  DefaultAccountMapper,
  DefaultCommissionMapper,
  DefaultMovementMapper,
  DefaultPositionMapper,
  DefaultPositivadorMapper,
  DefaultProductMapper,
  hashAccountCode,
  hashDocument,
  sanitizeAccountRawData,
  sanitizeRawData,
} from '../mappers/xp-mappers';
import { REPROCESS_TABLE_MAP } from '../resources/xp-resource.types';

function cfg(values: Record<string, string>) {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

const BASE = {
  XP_INTEGRATION_ENABLED: 'true',
  XP_API_BASE_URL: 'https://matls-api-hml.xpi.com.br',
  XP_SUBSCRIPTION_KEY: 'sub-key-fake',
  XP_USER_AGENT: 'XPparceiroDataAccess/AVREN-Test',
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
      { XP_PAGE_SIZE: '50001' },
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
    expect(init.headers['User-Agent']).toBe('XPparceiroDataAccess/AVREN-Test');
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

  it('pagina o envelope data oficial com $skip/$top', async () => {
    const { client } = makeClient({ XP_PAGE_SIZE: '2' });
    const fetchMock = mockFetch([
      { status: 200, json: { data: [{ i: 1 }, { i: 2 }] } },
      { status: 200, json: { data: [{ i: 3 }] } },
    ]);
    const seen: number[] = [];
    const res = await client.paginate<{ i: number }>('/api/v1/auc', async (items) => {
      seen.push(...items.map((x) => x.i));
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(res).toEqual({ pages: 2, records: 3 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('%24skip=0');
    expect(String(fetchMock.mock.calls[1][0])).toContain('%24skip=2');
  });

  it('encerra apos pagina cheia seguida de pagina vazia', async () => {
    const { client } = makeClient({ XP_PAGE_SIZE: '2' });
    const fetchMock = mockFetch([
      { status: 200, json: { data: [{ i: 1 }, { i: 2 }] } },
      { status: 200, json: { data: [] } },
    ]);
    const res = await client.paginate<{ i: number }>(
      '/api/v1/inflow',
      async () => undefined,
    );

    expect(res).toEqual({ pages: 2, records: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
  it('mapeia tableName oficial para o recurso interno e descarta entradas incompletas', () => {
    const plan = planReprocessing([
      {
        tableName: 'auc', referenceDate: '2026-07-25', typeProcessing: 'FULL',
        minimumProcessingDate: '2026-07-25', maximumProcessingDate: '2026-07-25',
      },
      { tableName: '', referenceDate: '2026-07-26' } as any,
    ]);
    expect(plan.entries).toEqual([
      { tableName: 'auc', resource: 'positions', referenceDate: '2026-07-25' },
    ]);
  });

  it('nao adivinha tableName desconhecido: mantem o nome e resource null', () => {
    const plan = planReprocessing([
      {
        tableName: 'tabela-misteriosa', referenceDate: '2026-07-25',
        typeProcessing: 'INCREMENTAL',
        minimumProcessingDate: '2026-07-25', maximumProcessingDate: '2026-07-25',
      },
    ]);
    expect(plan.entries).toEqual([
      { tableName: 'tabela-misteriosa', resource: null, referenceDate: '2026-07-25' },
    ]);
  });

  it('cobre o mapa oficial completo da Etapa B', () => {
    expect(REPROCESS_TABLE_MAP).toEqual({
      account: 'accounts',
      'account-advisor-relation': 'account_advisor_relations',
      'product-partner': 'products',
      auc: 'positions',
      inflow: 'movements',
      commission: 'commissions',
      positivador: 'positivador',
    });
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

  it('mapper de conta persiste apenas chaves tecnicas no raw_data', () => {
    const row = new DefaultAccountMapper().map({
      dimAccountCode: 1001,
      accountCode: 123456,
      cpfCnpjCodeGuid: 'guid-sensivel',
      incomeValue: 100000,
      realStateValue: 500000,
      maritalStatus: 'casado',
      activity: 'empresario',
      currentRegisterIndicator: 1,
    });

    expect(row?.external_account_id).toBe('1001');
    expect(row?.account_number_mask).toBe('****3456');
    expect(row?.holder_document_hash).toBeNull();
    expect(row?.raw_data).toEqual({
      dimAccountCode: 1001,
      currentRegisterIndicator: 1,
    });
    expect(row?.raw_data).not.toHaveProperty('accountCode');
    expect(row?.raw_data).not.toHaveProperty('incomeValue');
    expect(row?.raw_data).not.toHaveProperty('realStateValue');
  });

  it('allowlist de conta preserva dimAccountCode e ignora campos novos', () => {
    expect(
      sanitizeAccountRawData({
        dimAccountCode: 44,
        accountCode: 998877,
        currentRegisterIndicator: 0,
        campoNovoSensivel: 'nao deve persistir',
      }),
    ).toEqual({ dimAccountCode: 44, currentRegisterIndicator: 0 });
  });

  it('documenta registro nao vigente como inativo', () => {
    expect(
      new DefaultAccountMapper().map({
        dimAccountCode: 1002,
        accountCode: 654321,
        currentRegisterIndicator: 0,
      })?.status,
    ).toBe('inactive');
  });

  it('mapeia custodia, captacao e comissao do contrato oficial', () => {
    const position = new DefaultPositionMapper().map({
      id: 10, dimAccountCode: 1001, dimTimeCode: 20260731,
      dimProductCode: 2002, positionAmount: 3, positionValue: 15000,
    });
    const movement = new DefaultMovementMapper().map({
      id: 11, dimAccountCode: 1001, dimTimeCode: 20260731,
      dimProductCode: 2002, dimMovementTypeCode: 4,
      movementNatureCode: 'C', movementAmount: 2, movementValue: 5000,
    });
    const commission = new DefaultCommissionMapper().map({
      id: 12, dimAccountCode: 1001, dimTimeCode: 20260701,
      dimAdvisorCode: 3003, dimProductCode: 2002,
      grossRevenueValue: 900, netRevenueValue: 450,
    });

    expect(position).toMatchObject({
      external_position_id: '10', external_account_id: '1001',
      product_code: '2002', gross_value: 15000, as_of_date: '2026-07-31',
    });
    expect(movement).toMatchObject({
      external_movement_id: '11', external_account_id: '1001',
      movement_type: '4', transaction_type: 'C', amount: 5000,
      occurred_at: '2026-07-31T00:00:00Z',
    });
    expect(commission).toMatchObject({
      external_commission_id: '12', external_account_id: '1001',
      advisor_code: '3003', gross_amount: 900, net_amount: 450,
      competence_date: '2026-07-01',
    });
  });
});

describe('Etapa B - hash de conta e vinculo pseudonimizado', () => {
  const PEPPER = 'pepper-de-teste-exclusivo';

  it('produz o MESMO hash em Account e Positivador para a mesma conta', () => {
    const account = new DefaultAccountMapper(PEPPER).map({
      dimAccountCode: 1001, accountCode: 123456, currentRegisterIndicator: 1,
    });
    const positivador = new DefaultPositivadorMapper(PEPPER).map({
      id: 1, accountCode: 123456, positionDate: '2026-07-01',
    });
    expect(account!.account_code_hash).toEqual(expect.any(String));
    expect(account!.account_code_hash).toBe(positivador!.account_code_hash);
    // normalizacao por digitos: '123456' e 123456 geram o mesmo hash
    expect(hashAccountCode('123456', PEPPER)).toBe(account!.account_code_hash);
  });

  it('pepper ausente => hash null (vinculo pendente), sem lancar e sem vazar', () => {
    const account = new DefaultAccountMapper('').map({
      dimAccountCode: 1001, accountCode: 123456, currentRegisterIndicator: 1,
    });
    const positivador = new DefaultPositivadorMapper('').map({
      id: 1, accountCode: 123456, positionDate: '2026-07-01',
    });
    expect(account!.account_code_hash).toBeNull();
    expect(positivador!.account_code_hash).toBeNull();
    // nenhum campo do objeto persistido carrega o numero bruto
    expect(JSON.stringify(account)).not.toContain('123456');
    expect(JSON.stringify(positivador)).not.toContain('123456');
  });

  it('hash nunca e o numero bruto nem o contem', () => {
    const hash = hashAccountCode(987654, PEPPER);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('987654');
  });
});

describe('Etapa B - allowlist do Positivador', () => {
  it('descarta campos pessoais e desconhecidos; persiste apenas colunas aprovadas', () => {
    const row = new DefaultPositivadorMapper('p').map({
      id: 400001,
      accountCode: 123456,
      advisorCode: 2001,
      segment: 'Private',
      grossCaptureInMonth: 100000,
      redemptionInMonth: 25000,
      netCaptureInMonth: 75000,
      positionDate: '2026-07-01T00:00:00',
      // proibidos e desconhecidos, presentes de proposito:
      birthday: '1990-01-01',
      gender: 'X',
      activity: 'Engenheira',
      maritalStatus: 'Casada',
      registerDate: '2019-01-01',
      qualifiedInvestorTern: 'S',
      campoNovoDesconhecido: 'nao deve persistir',
    } as any);

    expect(row).not.toBeNull();
    const serialized = JSON.stringify(row);
    for (const banned of [
      'birthday', '1990-01-01', 'gender', 'activity', 'Engenheira',
      'maritalStatus', 'Casada', 'registerDate', 'campoNovoDesconhecido',
      '123456',
    ]) {
      expect(serialized).not.toContain(banned);
    }
    expect(row).toMatchObject({
      external_positivador_id: '400001',
      advisor_code: '2001',
      segment: 'Private',
      gross_capture_in_month: 100000,
      redemption_in_month: 25000,
      net_capture_in_month: 75000,
      position_date: '2026-07-01',
    });
    // objeto NAO possui raw_data: as colunas sao a allowlist
    expect('raw_data' in (row as any)).toBe(false);
  });

  it('sem positionDate valida => descarte controlado', () => {
    const mapper = new DefaultPositivadorMapper('p');
    expect(mapper.map({ id: 1, accountCode: 1 } as any)).toBeNull();
    expect(mapper.map({ id: 1, accountCode: 1, positionDate: 'data-invalida' } as any)).toBeNull();
  });
});

describe('Etapa B - data deterministica da relacao conta-assessor', () => {
  const mapper = new DefaultAccountAdvisorRelationMapper();

  it('usa referenceDate oficial, depois startValidityDate, depois lastUpdate', () => {
    expect(
      mapper.map({
        id: 1, dimAccountCode: 1001, referenceDate: '2026-05-10',
        startValidityDate: '2026-01-02', lastUpdate: '2026-07-28T03:00:00',
      })!.reference_date,
    ).toBe('2026-05-10');
    expect(
      mapper.map({
        id: 2, dimAccountCode: 1001,
        startValidityDate: '2026-01-02T00:00:00', lastUpdate: '2026-07-28T03:00:00',
      })!.reference_date,
    ).toBe('2026-01-02');
    expect(
      mapper.map({
        id: 3, dimAccountCode: 1001, lastUpdate: '2026-07-28T03:00:00',
      })!.reference_date,
    ).toBe('2026-07-28');
  });

  it('sem data confiavel => descarte controlado, NUNCA a data corrente', () => {
    const row = mapper.map({ id: 4, dimAccountCode: 1001 });
    expect(row).toBeNull();
  });

  it('e deterministico: duas execucoes identicas produzem o mesmo resultado', () => {
    const raw = { id: 5, dimAccountCode: 1001, startValidityDate: '2026-03-01' };
    expect(mapper.map({ ...raw })).toEqual(mapper.map({ ...raw }));
  });
});

describe('Etapa B - mapper de produtos', () => {
  it('preserva a grafia oficial de entrada e normaliza as colunas internas', () => {
    const row = new DefaultProductMapper().map({
      dimProductCode: 30001,
      assetCode: 'ABC11',
      assetName: 'Produto Teste',
      issuerName: 'Emissor S.A.',
      productClassficationL0: 'Renda Fixa',
      productClassficationL1: 'Bancario',
      yield: 'CDI + 2%',
      index: 'CDI',
      dueDate: '2035-05-15T00:00:00',
      currentRegister: 1,
    });
    expect(row).toMatchObject({
      external_product_id: '30001',
      product_name: 'Produto Teste',
      classification_l0: 'Renda Fixa',
      classification_l1: 'Bancario',
      yield_description: 'CDI + 2%',
      index_name: 'CDI',
      due_date: '2035-05-15',
      current_register: true,
    });
  });

  it('sem dimProductCode => descarte controlado', () => {
    expect(new DefaultProductMapper().map({} as any)).toBeNull();
  });
});
