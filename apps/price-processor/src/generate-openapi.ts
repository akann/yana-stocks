import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PricesController } from './prices/prices.controller';
import { PricesService } from './prices/prices.service';

@Module({
  controllers: [PricesController],
  providers: [{ provide: PricesService, useValue: {} }],
})
class DocsModule {}

async function generate(): Promise<void> {
  const app = await NestFactory.create(DocsModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Price Processor')
    .setDescription('OHLCV bar storage and price cache service')
    .setVersion('1.0')
    .addServer('https://api-gateway.yanatech.co.uk', 'Production (via Kong)')
    .addServer('http://localhost:3002', 'Local development')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outFile = process.argv[2] ?? 'price-processor.openapi.json';
  writeFileSync(outFile, JSON.stringify(document, null, 2));
  await app.close();
}

void generate();
