import { Module } from '@nestjs/common';
import { XpIntegrationController } from './xp-integration.controller';
import { XpIntegrationRepository } from './xp-integration.repository';
import { XpIntegrationService } from './xp-integration.service';

@Module({
  controllers: [XpIntegrationController],
  providers: [XpIntegrationRepository, XpIntegrationService],
})
export class XpIntegrationModule {}
