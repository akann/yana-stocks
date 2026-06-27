import { Test } from '@nestjs/testing';
import type { AnalystRating } from './analyst.types';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';

const RATING: AnalystRating = {
  strongBuy: 10,
  buy: 5,
  hold: 3,
  sell: 1,
  strongSell: 0,
  analystCount: 19,
  priceTarget: 650,
  consensus: 'strongBuy',
  asOf: '2026-01-01T00:00:00.000Z',
};

describe('AnalystController', () => {
  let controller: AnalystController;
  const mockService = { getRatings: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AnalystController],
      providers: [{ provide: AnalystService, useValue: mockService }],
    }).compile();
    controller = module.get(AnalystController);
    jest.clearAllMocks();
  });

  it('delegates to analystService.getRatings with uppercased symbol', async () => {
    mockService.getRatings.mockResolvedValue(RATING);
    const result = await controller.getRatings('aapl');
    expect(mockService.getRatings).toHaveBeenCalledWith('AAPL');
    expect(result).toEqual(RATING);
  });

  it('passes an already-uppercased symbol through unchanged', async () => {
    mockService.getRatings.mockResolvedValue(RATING);
    await controller.getRatings('MSFT');
    expect(mockService.getRatings).toHaveBeenCalledWith('MSFT');
  });
});
