import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('User Service')
    .setDescription('User registration, authentication, and JWT management')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const corsOrigin = process.env['CORS_ORIGIN'];
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin, credentials: true });
  }

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
}

void bootstrap();
