import { Module } from '@nestjs/common';
import {
  ClientOpportunitiesController,
  OpportunitiesController,
} from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { OpportunitiesRepository } from './opportunities.repository';

@Module({
  controllers: [ClientOpportunitiesController, OpportunitiesController],
  providers: [OpportunitiesService, OpportunitiesRepository],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
