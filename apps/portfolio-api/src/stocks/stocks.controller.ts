import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OHLCV } from '@yana-stocks/shared-types';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import type { AggregateStockResponse, MarketMovers } from './price-cache.types';
import { StocksService } from './stocks.service';

@ApiTags('stocks')
@UseGuards(UserFromTokenGuard)
@Controller()
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @Get('stocks/:symbol')
  @ApiOperation({ summary: 'Get aggregated price, sentiment, and prediction for a symbol' })
  getStock(@Param('symbol') symbol: string): Promise<AggregateStockResponse> {
    return this.stocksService.getStock(symbol.toUpperCase());
  }

  @Get('stocks/:symbol/history')
  @ApiOperation({ summary: 'Get OHLCV history for a symbol' })
  getHistory(
    @Param('symbol') symbol: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<OHLCV[]> {
    return this.stocksService.getHistory(symbol.toUpperCase(), limit);
  }

  @Get('market/movers')
  @ApiOperation({ summary: 'Get top market movers' })
  getMovers(
    @Query('top', new DefaultValuePipe(5), ParseIntPipe) top: number,
  ): Promise<MarketMovers> {
    return this.stocksService.getMovers(top);
  }
}
