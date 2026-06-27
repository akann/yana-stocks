import { Test } from '@nestjs/testing';
import type { SignalsResponse } from './signals.service';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';

const RESPONSE: SignalsResponse = { symbol: 'NVDA', sentiment: null, prediction: null };

describe('SignalsController', () => {
  let controller: SignalsController;
  const mockService = { getSignals: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [SignalsController],
      providers: [{ provide: SignalsService, useValue: mockService }],
    }).compile();
    controller = module.get(SignalsController);
    jest.clearAllMocks();
  });

  it('delegates to signalsService with uppercased symbol', async () => {
    mockService.getSignals.mockResolvedValue(RESPONSE);
    const result = await controller.getSignals('nvda');
    expect(mockService.getSignals).toHaveBeenCalledWith('NVDA');
    expect(result).toEqual(RESPONSE);
  });

  it('passes an already-uppercased symbol through unchanged', async () => {
    mockService.getSignals.mockResolvedValue(RESPONSE);
    await controller.getSignals('AAPL');
    expect(mockService.getSignals).toHaveBeenCalledWith('AAPL');
  });
});
