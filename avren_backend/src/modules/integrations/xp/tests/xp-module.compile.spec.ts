/**
 * Teste de compilacao do modulo Nest.
 *
 * v3.1: usa os arquivos REAIS do repositorio, sem stub de service ou
 * repository: XpIntegrationService, XpIntegrationRepository, o
 * DatabaseModule/databaseProvider reais e o controller real. Somente o
 * cliente de banco e substituido (overrideProvider), porque abrir
 * conexao real nao e objetivo deste teste.
 *
 * Import quebrado, provider ausente ou dependencia nao resolvida
 * derrubam este teste em segundos.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { XpIntegrationModule } from '../xp-integration.module';
import { DATABASE_CLIENT } from '../../../../database/database.provider';
import { ROLES_KEY } from '../../../../common/decorators/roles.decorator';
import { XpIntegrationService } from '../xp-integration.service';
import { XpIntegrationRepository } from '../xp-integration.repository';
import { XpSyncService } from '../sync/xp-sync.service';
import { XpSyncLock } from '../sync/xp-lock';
import { XpSyncJobs } from '../sync/xp-sync.jobs';
import { XpReadModelService } from '../xp-read-model.service';
import { XpReconciliationService } from '../reconciliation/xp-reconciliation.service';
import { XpHttpClient } from '../client/xp-http.client';
import { XpTransport } from '../client/xp-transport';
import { XpTokenProvider } from '../client/xp-token.provider';
import { XpIntegrationController } from '../xp-integration.controller';

describe('XpIntegrationModule - compilacao com arquivos reais', () => {
  it('resolve todos os providers, incluindo service e repository reais', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        XpIntegrationModule,
      ],
    })
      .overrideProvider(DATABASE_CLIENT)
      .useValue({})
      .compile();

    expect(moduleRef.get(XpIntegrationService)).toBeInstanceOf(XpIntegrationService);
    expect(moduleRef.get(XpIntegrationRepository)).toBeInstanceOf(XpIntegrationRepository);
    expect(moduleRef.get(XpSyncService)).toBeInstanceOf(XpSyncService);
    expect(moduleRef.get(XpSyncLock)).toBeInstanceOf(XpSyncLock);
    expect(moduleRef.get(XpSyncJobs)).toBeInstanceOf(XpSyncJobs);
    expect(moduleRef.get(XpReconciliationService)).toBeInstanceOf(XpReconciliationService);
    expect(moduleRef.get(XpReadModelService)).toBeInstanceOf(XpReadModelService);
    expect(moduleRef.get(XpHttpClient)).toBeInstanceOf(XpHttpClient);
    expect(moduleRef.get(XpTransport)).toBeInstanceOf(XpTransport);
    expect(moduleRef.get(XpTokenProvider)).toBeInstanceOf(XpTokenProvider);
    expect(moduleRef.get(XpIntegrationController)).toBeInstanceOf(XpIntegrationController);

    await moduleRef.close();
  });

  it('preserva o @Roles de classe do controller original', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, XpIntegrationController);
    expect(roles).toEqual(['supervisor', 'socio', 'operacoes', 'admin']);
    expect(roles).not.toContain('banker');
  });

  it('com a integracao desligada, o client HTTP recusa rede', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        XpIntegrationModule,
      ],
    })
      .overrideProvider(DATABASE_CLIENT)
      .useValue({})
      .compile();

    expect(moduleRef.get(XpHttpClient).enabled).toBe(false);
    await moduleRef.close();
  });
});
