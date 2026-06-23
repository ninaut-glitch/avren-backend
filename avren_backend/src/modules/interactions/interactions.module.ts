import { Module } from '@nestjs/common';
import { InteractionsController } from './interactions.controller';
import { InteractionsService } from './interactions.service';
import { InteractionsRepository } from './interactions.repository';

@Module({
  controllers: [InteractionsController],
  providers: [InteractionsService, InteractionsRepository],
  exports: [InteractionsService],
})
export class InteractionsModule {}
