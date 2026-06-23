import {
  IsString, IsEmail, IsOptional, IsUUID,
  IsNumber, IsEnum, MinLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LeadStage {
  LEAD          = 'lead',
  CONTATO       = 'contato',
  DIAGNOSTICO   = 'diagnostico',
  PROPOSTA      = 'proposta',
  NEGOCIACAO    = 'negociacao',
  DOCUMENTACAO  = 'documentacao',
  CLIENTE_ATIVO = 'cliente_ativo',
  PERDIDO       = 'perdido',
}

export enum LeadPriority { HIGH = 'high', MED = 'med', LOW = 'low' }
export enum OrigemTipo {
  SOCIO = 'socio', BANKER = 'banker', EVENTO = 'evento',
  DIGITAL = 'digital', INDICACAO = 'indicacao',
}

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  full_name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty()
  @IsUUID()
  banker_id: string;

  @ApiPropertyOptional({ enum: OrigemTipo })
  @IsOptional()
  @IsEnum(OrigemTipo)
  origem_tipo?: OrigemTipo;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contexto_relacionamento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimated_aum?: number;

  @ApiPropertyOptional({ enum: LeadPriority, default: LeadPriority.MED })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority = LeadPriority.MED;
}

export class UpdateLeadStageDto {
  @ApiProperty({ enum: LeadStage })
  @IsEnum(LeadStage)
  stage: LeadStage;

  @ApiPropertyOptional({ description: 'Obrigatório quando stage = perdido' })
  @IsOptional()
  @IsString()
  loss_reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  loss_notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
