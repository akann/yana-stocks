import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseFloatPipe,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OHLCV } from '@yana-stocks/shared-types';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import type {
  AggregateStockResponse,
  AssetsPage,
  MarketMovers,
  MarketOverview,
  ScreenerResult,
  SectorRotationData,
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

  @Get('market/overview')
  @ApiOperation({
    summary: 'Get market overview: index quotes, sector performance, and market news',
  })
  getOverview(): Promise<MarketOverview> {
    return this.stocksService.getOverview();
  }

  @Get('market/sectors/rotation')
  @ApiOperation({
    summary: 'Get weekly sector rotation time-series for heatmap (S&P 500)',
  })
  getSectorRotation(
    @Query('index', new DefaultValuePipe('sp500')) index: string,
  ): Promise<SectorRotationData> {
    const safeIndex = index === 'ftse100' ? 'ftse100' : 'sp500';
    return this.stocksService.getSectorRotation(safeIndex);
  }

  @Get('market/screener')
  @ApiOperation({
    summary: 'Screen US stocks by market cap, volume, dividend yield, sector, and price change',
  })
  getScreener(
    @Query('marketCapMin', new DefaultValuePipe(0), ParseIntPipe) marketCapMin: number,
    @Query('marketCapMax', new DefaultValuePipe(0), ParseIntPipe) marketCapMax: number,
    @Query('volumeMin', new DefaultValuePipe(0), ParseIntPipe) volumeMin: number,
    @Query('dividendYieldMin', new DefaultValuePipe(0), ParseFloatPipe) dividendYieldMin: number,
    @Query('changeMin', new DefaultValuePipe(0), ParseFloatPipe) changeMin: number,
    @Query('sector') sector: string | undefined,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ): Promise<ScreenerResult[]> {
    return this.stocksService.getScreener({
      marketCapMin: marketCapMin || undefined,
      marketCapMax: marketCapMax || undefined,
      volumeMin: volumeMin || undefined,
      dividendYieldMin: dividendYieldMin || undefined,
      changeMin: changeMin || undefined,
      sector: sector || undefined,
      limit,
    });
  }

  @Get('market/assets')
  @ApiOperation({
    summary: 'Browse tradable assets by market (us equities or etfs) with search and pagination',
  })
  getAssets(
    @Query('search') search = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('market') market: string = 'us',
  ): Promise<AssetsPage> {
    const safeMarket =
      market === 'etf'
        ? 'etf'
        : market === 'uk'
          ? 'uk'
          : market === 'all'
            ? 'all'
            : ('us' as const);
    return this.stocksService.getAssets(search, page, Math.min(limit, 100), safeMarket);
  }
}
