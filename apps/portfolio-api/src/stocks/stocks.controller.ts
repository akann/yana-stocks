import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OHLCV } from '@yana-stocks/shared-types';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import type { AggregateStockResponse, AssetsPage, MarketMovers } from './price-cache.types';
import { StocksService } from './stocks.service';

@ApiTags('stocks')
@Controller()
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @Get('stocks/:symbol')
  @UseGuards(UserFromTokenGuard)
  @ApiOperation({ summary: 'Get aggregated price, sentiment, and prediction for a symbol' })
  getStock(@Param('symbol') symbol: string): Promise<AggregateStockResponse> {
    return this.stocksService.getStock(symbol.toUpperCase());
  }

  @Get('stocks/:symbol/history')
  @UseGuards(UserFromTokenGuard)
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

  @Get('market/assets')
  @ApiOperation({ summary: 'Browse all tradable US equity assets from Alpaca with search and pagination' })
  getAssets(
    @Query('search') search = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<AssetsPage> {
    return this.stocksService.getAssets(search, page, Math.min(limit, 100));
  }
}
