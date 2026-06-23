import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { CommunityRepository } from './community.repository';

@Module({
  controllers: [CommunityController],
  providers: [CommunityService, CommunityRepository],
  exports: [CommunityService],
})
export class CommunityModule {}
