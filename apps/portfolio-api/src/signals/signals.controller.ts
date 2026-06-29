import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UnauthorizedDto } from '@yana-stocks/shared-dto';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { SignalsResponse, SignalsService } from './signals.service';

@ApiTags('signals')
@UseGuards(UserFromTokenGuard)
@ApiBearerAuth()
@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get(':symbol')
  @ApiOperation({ summary: 'Get latest sentiment and prediction signals for a symbol' })
  @ApiOkResponse({ type: SignalsResponse })
  @ApiResponse({
    status: 401,
    type: UnauthorizedDto,
    description: 'Missing or invalid bearer token',
  })
  getSignals(@Param('symbol') symbol: string): Promise<SignalsResponse> {
    return this.signalsService.getSignals(symbol.toUpperCase());
  }
}
