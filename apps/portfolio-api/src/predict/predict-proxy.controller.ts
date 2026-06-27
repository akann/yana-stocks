import { Controller, Get, Param } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { firstValueFrom } from 'rxjs';
import { PredictionSignal } from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';

class PredictResponse {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;

  @ApiProperty({ type: () => [PredictionSignal] })
  predictions!: PredictionSignal[];
}

@ApiTags('predict')
@Controller('predict')
export class PredictProxyController {
  private readonly mlPredictorUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.mlPredictorUrl = config.getOrThrow<string>('mlPredictorUrl');
  }

  @Get(':symbol')
  @ApiOperation({ summary: 'Get ML predictions for a symbol' })
  @ApiParam({ name: 'symbol', example: 'AAPL' })
  @ApiOkResponse({ type: PredictResponse })
  async predict(@Param('symbol') symbol: string): Promise<PredictResponse> {
    const upper = symbol.toUpperCase();

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<PredictResponse>(`${this.mlPredictorUrl}/api/predict/${upper}`, {
          timeout: 3000,
        }),
      );
      return data;
    } catch {
      // ml-predictor not running locally — fall back to seeded Redis predictions
      const raw = await this.redis.get(`papi:predictions:${upper}`);
      const predictions: PredictionSignal[] = raw ? (JSON.parse(raw) as PredictionSignal[]) : [];
      return { symbol: upper, predictions };
    }
  }
}
