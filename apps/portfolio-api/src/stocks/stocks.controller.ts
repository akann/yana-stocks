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
import type {
  AggregateStockResponse,
  AssetMarket,
  AssetsPage,
  MarketMovers,
} from './price-cache.types';
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
    @Query('interval') interval?: string,
  ): Promise<OHLCV[]> {
    return this.stocksService.getHistory(symbol.toUpperCase(), limit, interval);
  }

  @Get('market/movers')
  @ApiOperation({ summary: 'Get top market movers' })
  getMovers(
    @Query('top', new DefaultValuePipe(5), ParseIntPipe) top: number,
  ): Promise<MarketMovers> {
    return this.stocksService.getMovers(top);
  }

  @Get('market/assets')
  @ApiOperation({
    summary: 'Browse tradable assets by market (us equities or etfs) with search and pagination',
  })
  getAssets(
    @Query('search') search = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('market') market: AssetMarket = 'us',
  ): Promise<AssetsPage> {
    const safeMarket: AssetMarket = market === 'etf' ? 'etf' : 'us';
    return this.stocksService.getAssets(search, page, Math.min(limit, 100), safeMarket);
  }
}
