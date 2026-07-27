import { Module } from '@nestjs/common';
import { PatrimonialPlanningController } from './patrimonial-planning.controller';
import { PatrimonialPlanningService } from './patrimonial-planning.service';

@Module({
  controllers: [PatrimonialPlanningController],
  providers: [PatrimonialPlanningService],
})
export class PatrimonialPlanningModule {}
