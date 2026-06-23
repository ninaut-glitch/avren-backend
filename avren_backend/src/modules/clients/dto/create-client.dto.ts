import {
  IsString, IsEmail, IsOptional, IsUUID,
  IsNumber, IsEnum, IsDateString, Min, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MaritalStatus {
  SOLTEIRO     = 'solteiro',
  CASADO       = 'casado',
  DIVORCIADO   = 'divorciado',
  VIUVO        = 'viuvo',
  UNIAO_ESTAVEL = 'uniao_estavel',
}

export enum RiskProfile {
  CONSERVADOR       = 'conservador',
  MODERADO          = 'moderado',
  MODERADO_AGRESSIVO = 'moderado_agressivo',
  AGRESSIVO         = 'agressivo',
}

export enum ClientStatus {
  ATIVO    = 'ativo',
  INATIVO  = 'inativo',
  PROSPECTO = 'prospecto',
}

export class CreateClientDto {
  @ApiProperty()
  @IsUUID()
  lead_id: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  full_name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cpf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birth_date?: string;

  @ApiPropertyOptional({ enum: MaritalStatus })
  @IsOptional()
  @IsEnum(MaritalStatus)
  marital_status?: MaritalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  marital_regime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  profession?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  annual_income?: number;

  @ApiProperty()
  @IsUUID()
  banker_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supervisor_id?: string;
}

export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  full_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cpf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birth_date?: string;

  @ApiPropertyOptional({ enum: MaritalStatus })
  @IsOptional()
  @IsEnum(MaritalStatus)
  marital_status?: MaritalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  marital_regime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  profession?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  annual_income?: number;

  @ApiPropertyOptional({ enum: RiskProfile })
  @IsOptional()
  @IsEnum(RiskProfile)
  risk_profile?: RiskProfile;

  @ApiPropertyOptional({ enum: ClientStatus })
  @IsOptional()
  @IsEnum(ClientStatus)
  status?: ClientStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  banker_id?: string;
}

export class CreateContactDto {
  @ApiProperty({ enum: ['celular','email','whatsapp','linkedin','outro'] })
  @IsEnum(['celular','email','whatsapp','linkedin','outro'])
  type: string;

  @ApiProperty()
  @IsString()
  value: string;

  @ApiPropertyOptional()
  @IsOptional()
  is_primary?: boolean;
}

export class CreateFamilyMemberDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  full_name: string;

  @ApiProperty({ enum: ['conjuge','filho','filha','pai','mae','socio','outro'] })
  @IsEnum(['conjuge','filho','filha','pai','mae','socio','outro'])
  relationship: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birth_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cpf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  is_beneficiary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  related_client_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateRelationshipDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
