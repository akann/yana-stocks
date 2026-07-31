import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { PricesModule } from './prices/prices.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongodb.uri'),
      }),
    }),
    CommonModule,
    PricesModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
