import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuthProxyController } from './auth/auth-proxy.controller';
import { ProfileProxyController } from './profile/profile-proxy.controller';
import { StocksController } from './stocks/stocks.controller';
import { StocksService } from './stocks/stocks.service';
import { SignalsController } from './signals/signals.controller';
import { SignalsService } from './signals/signals.service';
import { NewsController } from './news/news.controller';
import { NewsService } from './news/news.service';
import { PredictProxyController } from './predict/predict-proxy.controller';
import { AnalystController } from './analyst/analyst.controller';
import { AnalystService } from './analyst/analyst.service';
import { RedisService } from './redis/redis.service';

const mockConfig = { get: () => '', getOrThrow: () => '' };

@Module({
  controllers: [
    AuthProxyController,
    ProfileProxyController,
    StocksController,
    SignalsController,
    NewsController,
    PredictProxyController,
    AnalystController,
  ],
  providers: [
    { provide: ConfigService, useValue: mockConfig },
    { provide: HttpService, useValue: {} },
    { provide: StocksService, useValue: {} },
    { provide: SignalsService, useValue: {} },
    { provide: NewsService, useValue: {} },
    { provide: AnalystService, useValue: {} },
    { provide: RedisService, useValue: {} },
  ],
})
class DocsModule {}

async function generate(): Promise<void> {
  const app = await NestFactory.create(DocsModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Portfolio API')
    .setDescription('Aggregated stock prices, signals, market data, and service proxies')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outFile = process.argv[2] ?? 'portfolio-api.openapi.json';
  writeFileSync(outFile, JSON.stringify(document, null, 2));
  await app.close();
}

void generate();
