import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OHLCV } from '@yana-stocks/shared-types';
import { PricesService, QuoteEntry } from './prices.service';

@ApiTags('prices')
@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Get(':symbol/history')
  @ApiOperation({ summary: 'Get OHLCV bar history for a symbol' })
  @ApiParam({ name: 'symbol', example: 'AAPL', description: 'Stock ticker symbol' })
  @ApiQuery({ name: 'limit', required: false, example: 100, description: 'Max bars to return' })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2024-01-01',
    description: 'Start date (ISO 8601)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    example: '2024-06-01',
    description: 'End date (ISO 8601)',
  })
  @ApiQuery({
    name: 'interval',
    required: false,
    enum: ['1m', '5m', '15m', '1h', '1d'],
    example: '1d',
    description: 'Bar interval',
  })
  @ApiOkResponse({ type: [OHLCV] })
  getHistory(
    @Param('symbol') symbol: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('interval') interval?: string,
  ): Promise<OHLCV[]> {
    return this.pricesService.getHistory(symbol, { limit, from, to, interval });
  }

  @Get(':symbol/quote')
  @ApiOperation({ summary: 'Get latest quote for a symbol (on-demand)' })
  @ApiParam({ name: 'symbol', example: 'AAPL', description: 'Stock ticker symbol' })
  @ApiOkResponse({ type: QuoteEntry })
  async getQuote(@Param('symbol') symbol: string): Promise<QuoteEntry> {
    const quote = await this.pricesService.getQuote(symbol);
    if (!quote) throw new NotFoundException(`No quote available for ${symbol}`);
    return quote;
  }
}
