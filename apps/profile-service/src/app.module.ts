import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import configuration from './config/configuration';
import { DebugSentryController } from './debug-sentry.controller';
import { HealthController } from './health.controller';
import { KafkaModule } from './kafka/kafka.module';
import { ProfileModule } from './profile/profile.module';

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
    ProfileModule,
    KafkaModule,
  ],
  controllers: [HealthController, DebugSentryController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
