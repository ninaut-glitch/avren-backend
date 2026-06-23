import {
  IsString, IsOptional, IsUUID,
  IsEnum, IsDateString, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TaskStatus {
  OPEN        = 'open',
  IN_PROGRESS = 'in_progress',
  DONE        = 'done',
  CANCELLED   = 'cancelled',
}

export enum TaskPriority {
  LOW    = 'low',
  MEDIUM = 'medium',
  HIGH   = 'high',
  URGENT = 'urgent',
}

export class CreateTaskDto {
  @ApiProperty()
  @IsUUID()
  assigned_to: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lead_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  opportunity_id?: string;

  @ApiPropertyOptional({ description: 'Vincula task a resumo gerado pela IA' })
  @IsOptional()
  @IsUUID()
  ai_summary_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority = TaskPriority.MEDIUM;
}

export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  due_date?: string;
}
