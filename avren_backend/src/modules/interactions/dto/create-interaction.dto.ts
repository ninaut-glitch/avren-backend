import {
  IsString, IsOptional, IsUUID, IsEnum,
  IsDateString, IsInt, Min, IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InteractionType {
  LIGACAO   = 'ligacao',
  WHATSAPP  = 'whatsapp',
  REUNIAO   = 'reuniao',
  EMAIL     = 'email',
  DOCUMENTO = 'documento',
  OUTRO     = 'outro',
}

export class CreateInteractionDto {
  @ApiProperty({ enum: InteractionType })
  @IsEnum(InteractionType)
  type: InteractionType;

  @ApiProperty()
  @IsString()
  subject: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty()
  @IsDateString()
  occurred_at: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  duration_min?: number;

  @ApiPropertyOptional({ description: 'UUID do contato externo envolvido (wealth.relationships)' })
  @IsOptional()
  @IsUUID()
  relationship_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lead_id?: string;
}
