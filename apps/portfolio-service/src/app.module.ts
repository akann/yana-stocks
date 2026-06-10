import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './config/configuration';
import { KafkaModule } from './kafka/kafka.module';
import { PortfoliosModule } from './portfolios/portfolios.module';
import { TradesModule } from './trades/trades.module';
import { WatchlistsModule } from './watchlists/watchlists.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongodb.uri'),
      }),
    }),
    KafkaModule,
    PortfoliosModule,
    TradesModule,
    WatchlistsModule,
  ],
})
export class AppModule {}
