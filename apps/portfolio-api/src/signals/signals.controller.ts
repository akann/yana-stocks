import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import type { SignalsResponse } from './signals.service';
import { SignalsService } from './signals.service';

@ApiTags('signals')
@UseGuards(UserFromTokenGuard)
@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get(':symbol')
  @ApiOperation({ summary: 'Get latest sentiment and prediction signals for a symbol' })
  getSignals(@Param('symbol') symbol: string): Promise<SignalsResponse> {
    return this.signalsService.getSignals(symbol.toUpperCase());
  }
}
