import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsRepository } from './analytics.repository';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsRepository],
})
export class AnalyticsModule {}
