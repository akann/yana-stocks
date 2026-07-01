import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';

@Module({
  controllers: [ProfileController],
  providers: [{ provide: ProfileService, useValue: {} }],
})
class DocsModule {}

async function generate(): Promise<void> {
  const app = await NestFactory.create(DocsModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Profile Service')
    .setDescription('User profile management — non-PII display data')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('https://api-gateway.yanatech.co.uk', 'Production (via Kong)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outFile = process.argv[2] ?? 'profile-service.openapi.json';
  writeFileSync(outFile, JSON.stringify(document, null, 2));
  await app.close();
}

void generate();
