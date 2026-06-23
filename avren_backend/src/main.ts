import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';    // FIX #8: @fastify/helmet, não 'helmet'
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: process.env.NODE_ENV !== 'production' }),
  );

  // FIX #8: @fastify/helmet registrado como plugin Fastify
  await app.register(helmet, {
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
  });

  app.enableCors({
    origin:      process.env.CORS_ORIGIN ?? 'http://localhost:3001',
    credentials: true,
  });

  app.setGlobalPrefix('v1');

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AVREN CRM API')
      .setDescription('Wealth + Business + Community')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    console.log(`📚 Swagger: http://localhost:${process.env.PORT ?? 3000}/docs`);
  }

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  console.log(`🚀 AVREN CRM API na porta ${process.env.PORT ?? 3000}`);
}

bootstrap();
