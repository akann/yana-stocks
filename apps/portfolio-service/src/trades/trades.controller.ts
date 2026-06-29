import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { Trade } from './schemas/trade.schema';
import { TradesService } from './trades.service';

@ApiTags('trades')
@UseGuards(UserFromTokenGuard)
@ApiBearerAuth()
@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Get()
  @ApiOperation({ summary: 'List all trades for the authenticated user' })
  @ApiOkResponse({ type: [Trade] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  findAll(): Promise<Trade[]> {
    return this.tradesService.findAll();
  }
}
