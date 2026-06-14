import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OHLCV } from '@yana-stocks/shared-types';
import { PricesService } from './prices.service';
import type { QuoteEntry } from './prices.service';

@ApiTags('prices')
@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Get(':symbol/history')
  @ApiOperation({ summary: 'Get OHLCV bar history for a symbol' })
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
  @ApiOperation({ summary: 'Get latest quote for a symbol via Yahoo Finance (on-demand)' })
  async getQuote(@Param('symbol') symbol: string): Promise<QuoteEntry> {
    const quote = await this.pricesService.getQuote(symbol);
    if (!quote) throw new NotFoundException(`No quote available for ${symbol}`);
    return quote;
  }
}
