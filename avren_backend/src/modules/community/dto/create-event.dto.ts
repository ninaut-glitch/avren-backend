import {
  IsString, IsOptional, IsUUID,
  IsEnum, IsDateString, IsInt, Min, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum EventModality {
  PRESENCIAL = 'presencial',
  ONLINE     = 'online',
  HIBRIDO    = 'hibrido',
}

export enum ParticipantStatus {
  INVITED   = 'invited',
  CONFIRMED = 'confirmed',
  ATTENDED  = 'attended',
  NO_SHOW   = 'no_show',
}

export class CreateEventDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  title: string;

  @ApiProperty()
  @IsDateString()
  event_date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ enum: EventModality, default: EventModality.PRESENCIAL })
  @IsOptional()
  @IsEnum(EventModality)
  modality?: EventModality = EventModality.PRESENCIAL;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  business_unit_id?: string;
}

export class AddParticipantDto {
  @ApiProperty()
  @IsUUID()
  client_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateParticipantStatusDto {
  @ApiProperty({ enum: ParticipantStatus })
  @IsEnum(ParticipantStatus)
  status: ParticipantStatus;
}
