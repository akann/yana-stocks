import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { PredictProxyController } from './predict-proxy.controller';
import { RedisService } from '../redis/redis.service';

const mockGet = jest.fn();
const mockRedisGet = jest.fn();

describe('PredictProxyController', () => {
  let controller: PredictProxyController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [PredictProxyController],
      providers: [
        { provide: HttpService, useValue: { get: mockGet } },
        { provide: RedisService, useValue: { get: mockRedisGet } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('http://ml:8000') },
        },
      ],
    }).compile();
    controller = module.get(PredictProxyController);
    jest.clearAllMocks();
  });

  it('uppercases the symbol and fetches from the ml-predictor', async () => {
    const mockData = { symbol: 'AAPL', predictions: [] };
    mockGet.mockReturnValue(of({ data: mockData }));
    const result = await controller.predict('aapl');
    expect(mockGet).toHaveBeenCalledWith(
      'http://ml:8000/api/predict/AAPL',
      expect.objectContaining({ timeout: 3000 }),
    );
    expect(result).toEqual(mockData);
  });

  it('falls back to Redis predictions when the ml-predictor call throws', async () => {
    mockGet.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));
    const stored = [{ symbol: 'NVDA', confidence: 0.8, predictedPrice: 700 }];
    mockRedisGet.mockResolvedValue(JSON.stringify(stored));

    const result = await controller.predict('nvda');
    expect(result).toEqual({ symbol: 'NVDA', predictions: stored });
  });

  it('returns empty predictions when ml-predictor throws and Redis is empty', async () => {
    mockGet.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));
    mockRedisGet.mockResolvedValue(null);

    const result = await controller.predict('TSLA');
    expect(result).toEqual({ symbol: 'TSLA', predictions: [] });
  });

  it('checks Redis with the correct uppercased key on fallback', async () => {
    mockGet.mockReturnValue(throwError(() => new Error('timeout')));
    mockRedisGet.mockResolvedValue(null);

    await controller.predict('goog');
    expect(mockRedisGet).toHaveBeenCalledWith('papi:predictions:GOOG');
  });
});
