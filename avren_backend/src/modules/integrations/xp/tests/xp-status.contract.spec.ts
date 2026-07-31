/**
 * Teste de CONTRATO de getStatus() (requisito 4 da v3.1).
 *
 * Duas garantias:
 *   1. Todos os campos consumidos por integrations-xp-page.tsx existem
 *      e tem o tipo esperado, para os cinco estados de certificado.
 *   2. Nenhum valor de credencial aparece no JSON serializado. O teste
 *      configura credenciais FICTICIAS com marcadores unicos e procura
 *      cada marcador na resposta inteira; qualquer vazamento falha.
 *
 * Sem banco: o repositorio e substituido por um duplo que devolve o
 * mesmo formato de getTenantSummary (ja em camelCase, como o provider
 * real com transform.column = postgres.toCamel).
 */
import { ConfigService } from '@nestjs/config';
import { XpIntegrationService } from '../xp-integration.service';
import { XpIntegrationRepository } from '../xp-integration.repository';
import { SessionContext } from '../../../../database/rls.helper';

const CTX: SessionContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  userRole: 'socio',
};

/** Marcadores unicos: se algum aparecer na resposta, houve vazamento. */
const SECRETS = {
  XP_CLIENT_ID: 'LEAK-CLIENT-ID-a1b2c3',
  XP_CLIENT_SECRET: 'LEAK-CLIENT-SECRET-d4e5f6',
  XP_SUBSCRIPTION_KEY: 'LEAK-SUBSCRIPTION-KEY-g7h8i9',
  XP_AZURE_TENANT_ID: 'LEAK-AZURE-TENANT-j1k2l3',
  XP_MTLS_CERT_BASE64: 'LEAK-CERT-BASE64-m4n5o6',
  XP_MTLS_KEY_BASE64: 'LEAK-KEY-BASE64-p7q8r9',
  XP_AUTH_URL: 'https://login.microsoftonline.com/LEAK-AUTH-URL-s1t2u3/oauth2/v2.0/token',
  XP_API_BASE_URL: 'https://matls-api-hml.xpi.com.br',
};

/** Nao sao segredos, mas sao obrigatorios para ready. */
const NON_SECRET_REQUIRED = {
  XP_OAUTH_SCOPE: 'api://xp-data-access/.default',
  XP_USER_AGENT: 'AVREN-OS/1.0 (parceiro=AVREN)',
  XP_DOCUMENT_PEPPER: 'PEPPER-FICTICIO-NAO-USAR-FORA-DOS-TESTES',
  // certificado valido por padrao, para os testes de ready
  XP_MTLS_CERT_EXPIRES_AT: new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString(),
};

function makeService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    XP_INTEGRATION_ENABLED: 'true',
    XP_CHANNEL: 'data_access',
    XP_ENVIRONMENT: 'homologation',
    ...SECRETS,
    ...NON_SECRET_REQUIRED,
    ...overrides,
  };
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;

  const repository = {
    getTenantSummary: jest.fn().mockResolvedValue({
      connection: {
        channel: 'data_access',
        environment: 'homologation',
        status: 'pending_credentials',
        grantedScopes: [],
        lastSyncAt: null,
        lastSuccessAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date('2026-07-30T00:00:00Z'),
      },
      counts: {
        accounts: 0,
        linkedAccounts: 0,
        currentPositions: 0,
        movements: 0,
      },
    }),
  } as unknown as XpIntegrationRepository;

  return new XpIntegrationService(config, repository);
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe('getStatus - contrato consumido pelo frontend', () => {
  it('devolve todos os campos usados pela tela, com os tipos certos', async () => {
    const status = await makeService().getStatus(CTX);

    expect(typeof status.enabled).toBe('boolean');
    expect(typeof status.mode).toBe('string');
    expect(typeof status.environment).toBe('string');
    expect(typeof status.environmentRecognized).toBe('boolean');

    const rc = status.requiredConfiguration;
    for (const key of [
      'apiBaseUrl', 'authUrl', 'azureTenantId', 'clientId',
      'clientSecret', 'subscriptionKey', 'oauthScope', 'userAgent',
      'documentPepper', 'mtls',
    ] as const) {
      expect(rc).toHaveProperty(key);
      expect(typeof rc[key]).toBe('boolean');
    }

    expect(status.certExpiryWarning).toHaveProperty('status');
    expect(status.certExpiryWarning).toHaveProperty('daysRemaining');
    expect(status).toHaveProperty('connection');
  });

  it('marca requiredConfiguration corretamente quando falta configuracao', async () => {
    const status = await makeService({
      XP_CLIENT_SECRET: '',
      XP_SUBSCRIPTION_KEY: '',
      XP_MTLS_CERT_BASE64: '',
      XP_MTLS_KEY_BASE64: '',
    }).getStatus(CTX);

    expect(status.requiredConfiguration.clientId).toBe(true);
    expect(status.requiredConfiguration.oauthScope).toBe(true);
    expect(status.requiredConfiguration.userAgent).toBe(true);
    expect(status.requiredConfiguration.documentPepper).toBe(true);
    expect(status.requiredConfiguration.clientSecret).toBe(false);
    expect(status.requiredConfiguration.subscriptionKey).toBe(false);
    expect(status.requiredConfiguration.mtls).toBe(false);
    expect(status.credentialsConfigured).toBe(false);
    expect(status.ready).toBe(false);
  });

  it('scope e User-Agent ausentes derrubam credentialsConfigured e ready', async () => {
    const semScope = await makeService({ XP_OAUTH_SCOPE: '' }).getStatus(CTX);
    expect(semScope.requiredConfiguration.oauthScope).toBe(false);
    expect(semScope.credentialsConfigured).toBe(false);
    expect(semScope.ready).toBe(false);

    const semUa = await makeService({ XP_USER_AGENT: '' }).getStatus(CTX);
    expect(semUa.requiredConfiguration.userAgent).toBe(false);
    expect(semUa.credentialsConfigured).toBe(false);
    expect(semUa.ready).toBe(false);
  });

  it('pepper documental ausente derruba credentialsConfigured e ready', async () => {
    const status = await makeService({ XP_DOCUMENT_PEPPER: '' }).getStatus(CTX);
    expect(status.requiredConfiguration.documentPepper).toBe(false);
    expect(status.credentialsConfigured).toBe(false);
    expect(status.ready).toBe(false);
  });

  it('ready exige certificado ok ou warning, nunca expired nem not_configured', async () => {
    const ok = await makeService().getStatus(CTX);
    expect(ok.certExpiryWarning.status).toBe('ok');
    expect(ok.ready).toBe(true);

    const warning = await makeService({
      XP_MTLS_CERT_EXPIRES_AT: daysFromNow(10),
    }).getStatus(CTX);
    expect(warning.certExpiryWarning.status).toBe('warning');
    expect(warning.ready).toBe(true);

    const expired = await makeService({
      XP_MTLS_CERT_EXPIRES_AT: daysFromNow(-1),
    }).getStatus(CTX);
    expect(expired.certExpiryWarning.status).toBe('expired');
    expect(expired.ready).toBe(false);

    const notConfigured = await makeService({
      XP_MTLS_CERT_EXPIRES_AT: '',
    }).getStatus(CTX);
    expect(notConfigured.certExpiryWarning.status).toBe('not_configured');
    expect(notConfigured.ready).toBe(false);
  });

  it('authUrl: regra unica, aceita explicita ou derivada do tenant Azure', async () => {
    const explicita = await makeService().getStatus(CTX);
    expect(explicita.requiredConfiguration.authUrl).toBe(true);
    expect(explicita.authUrlSource).toBe('explicit');

    // Sem XP_AUTH_URL, mas com tenant: derivada e valida.
    const derivada = await makeService({ XP_AUTH_URL: '' }).getStatus(CTX);
    expect(derivada.requiredConfiguration.authUrl).toBe(true);
    expect(derivada.authUrlSource).toBe('derived');

    // Sem os dois: nao ha URL.
    const ausente = await makeService({
      XP_AUTH_URL: '', XP_AZURE_TENANT_ID: '',
    }).getStatus(CTX);
    expect(ausente.requiredConfiguration.authUrl).toBe(false);
    expect(ausente.authUrlSource).toBe('none');
    expect(ausente.ready).toBe(false);

    // Explicita sem HTTPS nao conta (o provider recusaria).
    const insegura = await makeService({
      XP_AUTH_URL: 'http://login.exemplo/token',
    }).getStatus(CTX);
    expect(insegura.requiredConfiguration.authUrl).toBe(false);
    expect(insegura.ready).toBe(false);
  });

  it('aceita mTLS por PATH como alternativa ao BASE64', async () => {
    const status = await makeService({
      XP_MTLS_CERT_BASE64: '',
      XP_MTLS_KEY_BASE64: '',
      XP_MTLS_CERT_PATH: '/run/secrets/xp-cert.pem',
      XP_MTLS_KEY_PATH: '/run/secrets/xp-key.pem',
    }).getStatus(CTX);
    expect(status.requiredConfiguration.mtls).toBe(true);
  });

  it('nao reconhece ambiente fora de homologation/production', async () => {
    const ok = await makeService({ XP_ENVIRONMENT: 'production' }).getStatus(CTX);
    expect(ok.environmentRecognized).toBe(true);

    const bad = await makeService({ XP_ENVIRONMENT: 'qualquer-coisa' }).getStatus(CTX);
    expect(bad.environmentRecognized).toBe(false);
    expect(bad.ready).toBe(false);
  });

  describe('certExpiryWarning - todos os estados', () => {
    it('not_configured quando a data esta ausente', async () => {
      const s = await makeService({ XP_MTLS_CERT_EXPIRES_AT: '' }).getStatus(CTX);
      expect(s.certExpiryWarning).toEqual({
        status: 'not_configured', daysRemaining: null,
      });
    });

    it('not_configured quando a data e invalida (nao lanca)', async () => {
      const s = await makeService({
        XP_MTLS_CERT_EXPIRES_AT: 'nao-e-data',
      }).getStatus(CTX);
      expect(s.certExpiryWarning).toEqual({
        status: 'not_configured', daysRemaining: null,
      });
    });

    it('expired quando a data ja passou', async () => {
      const s = await makeService({
        XP_MTLS_CERT_EXPIRES_AT: daysFromNow(-5),
      }).getStatus(CTX);
      expect(s.certExpiryWarning.status).toBe('expired');
      expect(s.certExpiryWarning.daysRemaining).toBeLessThan(0);
    });

    it('warning dentro da janela de 30 dias', async () => {
      const s = await makeService({
        XP_MTLS_CERT_EXPIRES_AT: daysFromNow(10),
      }).getStatus(CTX);
      expect(s.certExpiryWarning.status).toBe('warning');
      expect(s.certExpiryWarning.daysRemaining).toBeLessThanOrEqual(30);
    });

    it('ok acima de 30 dias', async () => {
      const s = await makeService({
        XP_MTLS_CERT_EXPIRES_AT: daysFromNow(200),
      }).getStatus(CTX);
      expect(s.certExpiryWarning.status).toBe('ok');
      expect(s.certExpiryWarning.daysRemaining).toBeGreaterThan(30);
    });
  });

  it('NENHUM valor de credencial aparece na resposta serializada', async () => {
    const status = await makeService({
      XP_MTLS_CERT_EXPIRES_AT: daysFromNow(100),
    }).getStatus(CTX);
    const serialized = JSON.stringify(status);

    for (const [key, value] of Object.entries(SECRETS)) {
      if (key === 'XP_API_BASE_URL') continue; // nao e segredo, e host publico
      expect(serialized).not.toContain(value);
    }
    // Marcadores genericos, por seguranca
    expect(serialized).not.toContain('LEAK-');
    // E o campo de referencia de credencial nunca vem do repositorio
    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('credential_ref');
  });
});
