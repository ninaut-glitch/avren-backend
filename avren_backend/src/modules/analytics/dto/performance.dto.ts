import {
  IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID,
  Max, Min,
} from 'class-validator'
import { PartialType } from '@nestjs/swagger'

export class UpsertGoalDto {
  @IsDateString()
  goal_month: string

  @IsOptional() @IsNumber() @Min(0)
  captacao_goal?: number

  @IsOptional() @IsNumber() @Min(0)
  revenue_goal?: number

  @IsOptional() @IsNumber() @Min(0)
  visits_goal?: number

  @IsOptional() @IsNumber() @Min(1)
  pipeline_multiplier?: number

  @IsOptional() @IsNumber() @Min(1) @Max(100)
  visit_to_hot_rate?: number

  @IsOptional() @IsNumber() @Min(0)
  average_ticket?: number

  @IsOptional() @IsArray() @IsDateString({}, { each: true })
  excluded_dates?: string[]

  @IsOptional() @IsIn(['draft', 'published'])
  status?: 'draft' | 'published'

  @IsOptional() @IsString()
  reason?: string
}

export class CreatePipeDreamDto {
  @IsUUID()
  owner_id: string

  @IsOptional() @IsUUID()
  lead_id?: string

  @IsOptional() @IsUUID()
  opportunity_id?: string

  @IsString()
  prospect_name: string

  @IsOptional() @IsNumber() @Min(0)
  estimated_wealth?: number

  @IsOptional() @IsNumber() @Min(0)
  potential_capture?: number

  @IsOptional() @IsString()
  access_path?: string

  @IsOptional() @IsString()
  strategic_reason?: string

  @IsOptional() @IsString()
  next_action?: string

  @IsOptional() @IsDateString()
  next_action_date?: string

  @IsOptional() @IsIn(['idea','mapped','access','approach','qualified'])
  maturity?: string

  @IsOptional() @IsString()
  notes?: string
}

export class UpdatePipeDreamDto extends PartialType(CreatePipeDreamDto) {}
