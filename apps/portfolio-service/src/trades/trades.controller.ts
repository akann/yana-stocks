import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { Trade } from './schemas/trade.schema';
import { TradesService } from './trades.service';

@ApiTags('trades')
@UseGuards(UserFromTokenGuard)
@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Get()
  @ApiOperation({ summary: 'List all trades for the authenticated user' })
  @ApiOkResponse({ type: [Trade] })
  findAll(): Promise<Trade[]> {
    return this.tradesService.findAll();
  }
}
