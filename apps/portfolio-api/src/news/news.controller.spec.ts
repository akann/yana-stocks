import { Test } from '@nestjs/testing';
import type { NewsArticle } from './news.service';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

const ARTICLE: NewsArticle = {
  headline: 'Test headline',
  source: 'Reuters',
  url: 'https://example.com',
  publishedAt: '2026-01-01T00:00:00.000Z',
  sentimentLabel: 'positive',
  sentimentScore: 0.9,
};

describe('NewsController', () => {
  let controller: NewsController;
  const mockService = { getNews: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [NewsController],
      providers: [{ provide: NewsService, useValue: mockService }],
    }).compile();
    controller = module.get(NewsController);
    jest.clearAllMocks();
    mockService.getNews.mockResolvedValue([]);
  });

  it('uppercases the symbol', async () => {
    await controller.getNews('nvda', undefined);
    expect(mockService.getNews).toHaveBeenCalledWith('NVDA', expect.any(Number));
  });

  it('defaults limit to 10 when not provided', async () => {
    await controller.getNews('AAPL', undefined);
    expect(mockService.getNews).toHaveBeenCalledWith('AAPL', 10);
  });

  it('parses the limit query parameter', async () => {
    await controller.getNews('AAPL', '20');
    expect(mockService.getNews).toHaveBeenCalledWith('AAPL', 20);
  });

  it('caps limit at 50 even if a larger value is provided', async () => {
    await controller.getNews('AAPL', '200');
    expect(mockService.getNews).toHaveBeenCalledWith('AAPL', 50);
  });

  it('returns the articles from the service', async () => {
    mockService.getNews.mockResolvedValue([ARTICLE]);
    const result = await controller.getNews('AAPL', '5');
    expect(result).toEqual([ARTICLE]);
  });
});
