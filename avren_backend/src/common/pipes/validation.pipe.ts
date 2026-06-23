import { ValidationPipe } from '@nestjs/common';

export const globalValidationPipe = new ValidationPipe({
  whitelist: true,         // Remove campos não declarados no DTO
  forbidNonWhitelisted: true,
  transform: true,         // Converte tipos automaticamente
  transformOptions: {
    enableImplicitConversion: true,
  },
});
