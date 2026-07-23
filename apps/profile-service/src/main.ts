import './tracing';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from './logger';
import { metricsMiddleware } from './metrics';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new JsonLogger('profile-service'));
  app.use(metricsMiddleware);
  const config = app.get(ConfigService);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Profile Service')
    .setDescription('User profile management — non-PII display data')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('http://localhost:3007', 'Local development')
    .addServer('https://api-gateway.yanatech.co.uk', 'Production (via Kong)')
    .build();
  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, swaggerConfig));

  const corsOrigin = config.get<string>('CORS_ORIGIN');
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin, credentials: true });
  }

  await app.listen(config.getOrThrow<number>('port'));
}

void bootstrap();
