import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';
import { ExternalApiBreakersService } from '../common/external-api-breakers.service';
import { RedisService } from '../redis/redis.service';
import { AnalystService } from './analyst.service';
import type { AnalystRating } from './analyst.types';

const FMP_REC = [
  {
    symbol: 'AAPL',
    date: '2024-02-01',
    analystRatingsStrongBuy: 14,
    analystRatingsBuy: 7,
    analystRatingsHold: 4,
    analystRatingsSell: 1,
    analystRatingsStrongSell: 0,
  },
];

const FMP_TARGET = { symbol: 'AAPL', targetConsensus: 210.5 };

describe('AnalystService', () => {
  let service: AnalystService;
  let redis: jest.Mocked<RedisService>;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalystService,
        ExternalApiBreakersService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<RedisService>,
        },
        {
          provide: HttpService,
          useValue: { get: jest.fn() } satisfies Partial<HttpService>,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
      ],
    }).compile();

    service = module.get<AnalystService>(AnalystService);
    redis = module.get(RedisService);
    httpService = module.get(HttpService);
    configService = module.get(ConfigService);
  });

  it('returns cached rating from Redis on cache hit', async () => {
    const cached: AnalystRating = {
      strongBuy: 10,
      buy: 5,
      hold: 3,
      sell: 1,
      strongSell: 0,
      analystCount: 19,
      priceTarget: 200,
      consensus: 'strongBuy',
      asOf: '2024-01-01',
    };
    redis.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.getRatings('AAPL');

    expect(result).toEqual(cached);
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it('returns empty rating when FMP_API_KEY is not set', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('');

    const result = await service.getRatings('AAPL');

    expect(result.analystCount).toBe(0);
    expect(result.consensus).toBeNull();
    expect(result.priceTarget).toBeNull();
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it('fetches from FMP, combines recommendations + price target, caches result', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('MY_FMP_KEY');

    httpService.get
      .mockReturnValueOnce(of({ data: FMP_REC } as AxiosResponse))
      .mockReturnValueOnce(of({ data: FMP_TARGET } as AxiosResponse));

    const result = await service.getRatings('AAPL');

    expect(result.strongBuy).toBe(14);
    expect(result.buy).toBe(7);
    expect(result.hold).toBe(4);
    expect(result.sell).toBe(1);
    expect(result.strongSell).toBe(0);
    expect(result.analystCount).toBe(26);
    expect(result.priceTarget).toBe(210.5);
    expect(result.consensus).toBe('strongBuy');
    expect(result.asOf).toBe('2024-02-01');
    expect(redis.set).toHaveBeenCalledWith('papi:analyst:AAPL', expect.any(String), 86400);
  });

  it('handles FMP lowercase "buy" field quirk (analystRatingsbuy)', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('MY_FMP_KEY');

    const recWithLowercaseBuy = [
      { ...FMP_REC[0], analystRatingsBuy: undefined, analystRatingsbuy: 7 },
    ];
    httpService.get
      .mockReturnValueOnce(of({ data: recWithLowercaseBuy } as AxiosResponse))
      .mockReturnValueOnce(of({ data: FMP_TARGET } as AxiosResponse));

    const result = await service.getRatings('AAPL');

    expect(result.buy).toBe(7);
  });

  it('handles price target returned as array', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('MY_FMP_KEY');

    httpService.get
      .mockReturnValueOnce(of({ data: FMP_REC } as AxiosResponse))
      .mockReturnValueOnce(of({ data: [FMP_TARGET] } as AxiosResponse));

    const result = await service.getRatings('AAPL');

    expect(result.priceTarget).toBe(210.5);
  });

  it('returns empty rating when both FMP calls fail', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('MY_FMP_KEY');

    httpService.get.mockReturnValue(throwError(() => new Error('fmp down')));

    const result = await service.getRatings('AAPL');

    expect(result.analystCount).toBe(0);
    expect(result.consensus).toBeNull();
  });

  it('uses partial data when only recommendations succeed', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('MY_FMP_KEY');

    httpService.get
      .mockReturnValueOnce(of({ data: FMP_REC } as AxiosResponse))
      .mockReturnValueOnce(throwError(() => new Error('price target unavailable')));

    const result = await service.getRatings('AAPL');

    expect(result.analystCount).toBe(26);
    expect(result.priceTarget).toBeNull();
    expect(result.consensus).toBe('strongBuy');
  });

  it('calculates consensus as hold when hold count is highest', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('MY_FMP_KEY');

    const holdRec = [
      { ...FMP_REC[0], analystRatingsStrongBuy: 2, analystRatingsBuy: 3, analystRatingsHold: 10 },
    ];
    httpService.get
      .mockReturnValueOnce(of({ data: holdRec } as AxiosResponse))
      .mockReturnValueOnce(of({ data: FMP_TARGET } as AxiosResponse));

    const result = await service.getRatings('AAPL');

    expect(result.consensus).toBe('hold');
  });

  it('returns null consensus when all counts are zero', async () => {
    redis.get.mockResolvedValue(null);
    (configService.get as jest.Mock).mockReturnValue('MY_FMP_KEY');

    httpService.get
      .mockReturnValueOnce(of({ data: [] } as AxiosResponse))
      .mockReturnValueOnce(of({ data: {} } as AxiosResponse));

    const result = await service.getRatings('AAPL');

    expect(result.consensus).toBeNull();
    expect(result.analystCount).toBe(0);
  });
});
