import { IsEmail, IsString, MinLength, IsOptional, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'ana.mota@avren.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ description: 'Código TOTP (MFA)' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  mfa_code?: string;
}
