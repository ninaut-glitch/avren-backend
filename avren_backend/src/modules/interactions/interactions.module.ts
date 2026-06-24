import { Module } from '@nestjs/common';
import { InteractionsController } from './interactions.controller';
import { LeadInteractionsController } from './lead-interactions.controller';
import { InteractionsService } from './interactions.service';
import { InteractionsRepository } from './interactions.repository';

@Module({
  controllers: [InteractionsController, LeadInteractionsController],
  providers: [InteractionsService, InteractionsRepository],
  exports: [InteractionsService],
})
export class InteractionsModule {}
