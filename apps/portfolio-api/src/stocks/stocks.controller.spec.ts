import { Test } from '@nestjs/testing';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';

describe('StocksController', () => {
  let controller: StocksController;
  const mockService = {
    getStock: jest.fn(),
    getHistory: jest.fn(),
    getMovers: jest.fn(),
    getOverview: jest.fn(),
    getSectorRotation: jest.fn(),
    getFactorPerformance: jest.fn(),
    getScreener: jest.fn(),
    getAssets: jest.fn(),
    ensureTracking: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [StocksController],
      providers: [{ provide: StocksService, useValue: mockService }],
    }).compile();
    controller = module.get(StocksController);
    jest.clearAllMocks();
    Object.values(mockService).forEach((m) => m.mockResolvedValue(undefined));
  });

  // ── getStock ──────────────────────────────────────────────────────────────

  it('getStock uppercases the symbol', async () => {
    mockService.getStock.mockResolvedValue({ symbol: 'AAPL', prediction: null });
    await controller.getStock('aapl');
    expect(mockService.getStock).toHaveBeenCalledWith('AAPL');
  });

  it('getStock fires ensureTracking (not awaited) when no prediction is present', async () => {
    mockService.getStock.mockResolvedValue({ symbol: 'AAPL', prediction: null });
    await controller.getStock('aapl');
    expect(mockService.ensureTracking).toHaveBeenCalledWith('AAPL');
  });

  it('getStock does not fire ensureTracking when a prediction is already present', async () => {
    mockService.getStock.mockResolvedValue({ symbol: 'AAPL', prediction: { horizon: '1d' } });
    await controller.getStock('aapl');
    expect(mockService.ensureTracking).not.toHaveBeenCalled();
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  it('getHistory uppercases symbol and passes limit and interval', async () => {
    mockService.getHistory.mockResolvedValue([]);
    await controller.getHistory('msft', 50, 'day');
    expect(mockService.getHistory).toHaveBeenCalledWith('MSFT', 50, 'day');
  });

  // ── getMovers ─────────────────────────────────────────────────────────────

  it('getMovers passes top param to service', async () => {
    mockService.getMovers.mockResolvedValue({ gainers: [], losers: [] });
    await controller.getMovers(10);
    expect(mockService.getMovers).toHaveBeenCalledWith(10);
  });

  // ── getOverview ───────────────────────────────────────────────────────────

  it('getOverview delegates to service', async () => {
    mockService.getOverview.mockResolvedValue({ indices: [], sectors: [], news: [] });
    await controller.getOverview();
    expect(mockService.getOverview).toHaveBeenCalled();
  });

  // ── getSectorRotation ─────────────────────────────────────────────────────

  it('getSectorRotation passes "ftse100" through as-is', async () => {
    mockService.getSectorRotation.mockResolvedValue({ dates: [], rows: [] });
    await controller.getSectorRotation('ftse100');
    expect(mockService.getSectorRotation).toHaveBeenCalledWith('ftse100');
  });

  it('getSectorRotation coerces any other value to "sp500"', async () => {
    mockService.getSectorRotation.mockResolvedValue({ dates: [], rows: [] });
    await controller.getSectorRotation('unknown');
    expect(mockService.getSectorRotation).toHaveBeenCalledWith('sp500');
  });

  it('getSectorRotation passes "sp500" through as-is', async () => {
    mockService.getSectorRotation.mockResolvedValue({ dates: [], rows: [] });
    await controller.getSectorRotation('sp500');
    expect(mockService.getSectorRotation).toHaveBeenCalledWith('sp500');
  });

  // ── getFactorPerformance ──────────────────────────────────────────────────

  it('getFactorPerformance delegates to service', async () => {
    mockService.getFactorPerformance.mockResolvedValue([]);
    await controller.getFactorPerformance();
    expect(mockService.getFactorPerformance).toHaveBeenCalled();
  });

  // ── getScreener ───────────────────────────────────────────────────────────

  it('getScreener passes filter params — zero values become undefined', async () => {
    mockService.getScreener.mockResolvedValue([]);
    await controller.getScreener(1_000_000, 0, 500_000, 0, 0, 'Technology', 25);
    expect(mockService.getScreener).toHaveBeenCalledWith({
      marketCapMin: 1_000_000,
      marketCapMax: undefined,
      volumeMin: 500_000,
      dividendYieldMin: undefined,
      changeMin: undefined,
      sector: 'Technology',
      limit: 25,
    });
  });

  it('getScreener: undefined sector becomes undefined', async () => {
    mockService.getScreener.mockResolvedValue([]);
    await controller.getScreener(0, 0, 0, 0, 0, undefined, 10);
    expect(mockService.getScreener).toHaveBeenCalledWith(
      expect.objectContaining({ sector: undefined }),
    );
  });

  // ── getAssets ─────────────────────────────────────────────────────────────

  it('getAssets caps limit at 100', async () => {
    mockService.getAssets.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    await controller.getAssets('', 1, 200, 'us');
    expect(mockService.getAssets).toHaveBeenCalledWith('', 1, 100, 'us');
  });

  it('getAssets passes "etf" through', async () => {
    mockService.getAssets.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    await controller.getAssets('', 1, 20, 'etf');
    expect(mockService.getAssets).toHaveBeenCalledWith('', 1, 20, 'etf');
  });

  it('getAssets passes "uk" through', async () => {
    mockService.getAssets.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    await controller.getAssets('', 1, 20, 'uk');
    expect(mockService.getAssets).toHaveBeenCalledWith('', 1, 20, 'uk');
  });

  it('getAssets passes "all" through', async () => {
    mockService.getAssets.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    await controller.getAssets('', 1, 20, 'all');
    expect(mockService.getAssets).toHaveBeenCalledWith('', 1, 20, 'all');
  });

  it('getAssets coerces an unknown market to "us"', async () => {
    mockService.getAssets.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    await controller.getAssets('', 1, 20, 'invalid');
    expect(mockService.getAssets).toHaveBeenCalledWith('', 1, 20, 'us');
  });
});
