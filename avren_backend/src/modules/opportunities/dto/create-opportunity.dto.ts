import {
  IsString, IsOptional, IsEnum,
  IsNumber, IsDateString, Min, Max,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OpportunityType {
  INVESTIMENTOS = 'investimentos',
  OFFSHORE      = 'offshore',
  PREVIDENCIA   = 'previdencia',
  SUCESSAO      = 'sucessao',
  CREDITO       = 'credito',
  MA            = 'ma',
  CORPORATE     = 'corporate',
  CONSORCIO     = 'consorcio',
  FINANCIAMENTO = 'financiamento',
  PLANEJAMENTO_PATRIMONIAL = 'planejamento_patrimonial',
  SEGURO_VIDA   = 'seguro_vida',
}

export enum OpportunityStatus {
  OPEN        = 'open',
  IN_PROGRESS = 'in_progress',
  WON         = 'won',
  LOST        = 'lost',
  ON_HOLD     = 'on_hold',
}

export class CreateOpportunityDto {
  @ApiPropertyOptional({ description: 'Responsável pela oportunidade; restrito a perfis de gestão' })
  @IsOptional()
  @IsUUID()
  banker_id?: string;

  @ApiProperty({ enum: OpportunityType })
  @IsEnum(OpportunityType)
  type: OpportunityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimated_value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimated_monthly_revenue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimated_one_time_revenue?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expected_close_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateOpportunityDto extends CreateOpportunityDto {
  @ApiPropertyOptional({ enum: OpportunityStatus })
  @IsOptional()
  @IsEnum(OpportunityStatus)
  status?: OpportunityStatus;
}
