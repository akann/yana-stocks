import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Trade } from '@yana-stocks/shared-types';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { TradesService } from './trades.service';

@ApiTags('trades')
@UseGuards(UserFromTokenGuard)
@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Get()
  @ApiOperation({ summary: 'List all trades for the authenticated user' })
  findAll(): Promise<Trade[]> {
    return this.tradesService.findAll();
  }
}
