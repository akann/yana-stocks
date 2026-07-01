import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PortfoliosController } from './portfolios/portfolios.controller';
import { PortfoliosService } from './portfolios/portfolios.service';
import { WatchlistsController } from './watchlists/watchlists.controller';
import { WatchlistsService } from './watchlists/watchlists.service';
import { TradesController } from './trades/trades.controller';
import { TradesService } from './trades/trades.service';

@Module({
  controllers: [PortfoliosController, WatchlistsController, TradesController],
  providers: [
    { provide: PortfoliosService, useValue: {} },
    { provide: WatchlistsService, useValue: {} },
    { provide: TradesService, useValue: {} },
  ],
})
class DocsModule {}

async function generate(): Promise<void> {
  const app = await NestFactory.create(DocsModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Portfolio Service')
    .setDescription('Portfolio, watchlist, and trade management')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('https://api-gateway.yanatech.co.uk', 'Production (via Kong)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outFile = process.argv[2] ?? 'portfolio-service.openapi.json';
  writeFileSync(outFile, JSON.stringify(document, null, 2));
  await app.close();
}

void generate();
