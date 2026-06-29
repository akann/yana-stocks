import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UnauthorizedDto } from '@yana-stocks/shared-dto';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { AnalystService } from './analyst.service';
import { AnalystRating } from './analyst.types';

@ApiTags('analyst')
@UseGuards(UserFromTokenGuard)
@ApiBearerAuth()
@Controller('stocks')
export class AnalystController {
  constructor(private readonly analystService: AnalystService) {}

  @Get(':symbol/analyst')
  @ApiOperation({ summary: 'Get analyst ratings and price target for a symbol' })
  @ApiOkResponse({ type: AnalystRating })
  @ApiResponse({
    status: 401,
    type: UnauthorizedDto,
    description: 'Missing or invalid bearer token',
  })
  getRatings(@Param('symbol') symbol: string): Promise<AnalystRating> {
    return this.analystService.getRatings(symbol.toUpperCase());
  }
}
