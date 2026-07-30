import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../../database/database.module';
import { XpIntegrationController } from './xp-integration.controller';
import { XpIntegrationService } from './xp-integration.service';
import { XpIntegrationRepository } from './xp-integration.repository';
import { XpTransport } from './client/xp-transport';
import {
  InMemoryTokenStore, XP_TOKEN_STORE, XpTokenProvider,
} from './client/xp-token.provider';
import { XpHttpClient } from './client/xp-http.client';
import { XpSyncLock } from './sync/xp-lock';
import { XpSyncService } from './sync/xp-sync.service';
import { XpSyncJobs } from './sync/xp-sync.jobs';
import { XpReconciliationService } from './reconciliation/xp-reconciliation.service';
import { XpReadModelService } from './xp-read-model.service';

/**
 * Modulo da integracao XP Data Access. TokenStore injetado por token
 * de DI (memoria hoje, Redis amanha). XpReadModelService e o unico
 * contrato de leitura exportado para o restante do produto.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [XpIntegrationController],
  providers: [
    XpIntegrationService,
    XpIntegrationRepository,
    XpTransport,
    { provide: XP_TOKEN_STORE, useClass: InMemoryTokenStore },
    {
      provide: XpTokenProvider,
      useFactory: (config: ConfigService, store: InMemoryTokenStore) =>
        new XpTokenProvider(config, store),
      inject: [ConfigService, XP_TOKEN_STORE],
    },
    XpHttpClient,
    XpSyncLock,
    XpSyncService,
    XpSyncJobs,
    XpReconciliationService,
    XpReadModelService,
  ],
  exports: [XpReadModelService, XpSyncService],
})
export class XpIntegrationModule {}
