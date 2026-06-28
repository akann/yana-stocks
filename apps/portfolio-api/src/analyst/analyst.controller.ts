import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { AnalystService } from './analyst.service';
import { AnalystRating } from './analyst.types';

@ApiTags('analyst')
@UseGuards(UserFromTokenGuard)
@Controller('stocks')
export class AnalystController {
  constructor(private readonly analystService: AnalystService) {}

  @Get(':symbol/analyst')
  @ApiOperation({ summary: 'Get analyst ratings and price target for a symbol' })
  @ApiOkResponse({ type: AnalystRating })
  getRatings(@Param('symbol') symbol: string): Promise<AnalystRating> {
    return this.analystService.getRatings(symbol.toUpperCase());
  }
}
