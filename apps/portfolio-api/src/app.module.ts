import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import configuration from './config/configuration';
import { AuthProxyController } from './auth/auth-proxy.controller';
import { DebugSentryController } from './debug-sentry.controller';
import { HealthController } from './health.controller';
import { PortfolioProxyController } from './portfolio/portfolio-proxy.controller';
import { PredictProxyController } from './predict/predict-proxy.controller';
import { ProfileProxyController } from './profile/profile-proxy.controller';
import { KafkaModule } from './kafka/kafka.module';
import { RedisModule } from './redis/redis.module';
import { AnalystModule } from './analyst/analyst.module';
import { NewsModule } from './news/news.module';
import { SignalsModule } from './signals/signals.module';
import { StocksModule } from './stocks/stocks.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    HttpModule.register({ timeout: 10_000 }),
    RedisModule,
    KafkaModule,
    StocksModule,
    SignalsModule,
    NewsModule,
    AnalystModule,
  ],
  controllers: [
    AuthProxyController,
    ProfileProxyController,
    HealthController,
    PortfolioProxyController,
    PredictProxyController,
    DebugSentryController,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
