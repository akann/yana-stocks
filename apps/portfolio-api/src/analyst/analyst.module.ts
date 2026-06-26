import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';

@Module({
  imports: [HttpModule, RedisModule],
  controllers: [AnalystController],
  providers: [AnalystService],
})
export class AnalystModule {}
