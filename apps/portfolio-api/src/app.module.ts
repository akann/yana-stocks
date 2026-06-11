import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AuthProxyController } from './auth/auth-proxy.controller';
import { HealthController } from './health.controller';
import { PortfolioProxyController } from './portfolio/portfolio-proxy.controller';
import { KafkaModule } from './kafka/kafka.module';
import { RedisModule } from './redis/redis.module';
import { SignalsModule } from './signals/signals.module';
import { StocksModule } from './stocks/stocks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    HttpModule,
    RedisModule,
    KafkaModule,
    StocksModule,
    SignalsModule,
  ],
  controllers: [AuthProxyController, HealthController, PortfolioProxyController],
})
export class AppModule {}
