import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiService } from './ai.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
