import { Test, TestingModule } from '@nestjs/testing';
import { NewsService } from './news.service';

// Stable mock references used across all tests
const mockToArray = jest.fn();
const mockLimit = jest.fn().mockReturnThis();
const mockSort = jest.fn().mockReturnThis();
const mockFind = jest.fn().mockReturnValue({ sort: mockSort, limit: mockLimit, toArray: mockToArray });
const mockCollection = jest.fn().mockReturnValue({ find: mockFind });
const mockDb = jest.fn().mockReturnValue({ collection: mockCollection });
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    db: mockDb,
    close: mockClose,
  })),
}));

const mockDocs = [
  {
    headline: 'Apple beats earnings',
    source: 'reuters',
    url: 'https://reuters.com/1',
    published_at: '2024-01-01T09:00:00Z',
    sentiment_label: 'positive',
    sentiment_score: 0.85,
  },
  {
    headline: 'Supply chain concerns',
    source: 'bloomberg',
    url: 'https://bloomberg.com/2',
    published_at: new Date('2024-01-02T08:00:00Z'),
    sentiment_label: 'negative',
    sentiment_score: -0.6,
  },
];

describe('NewsService', () => {
  let service: NewsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restore return values cleared by clearAllMocks
    mockLimit.mockReturnThis();
    mockSort.mockReturnThis();
    mockFind.mockReturnValue({ sort: mockSort, limit: mockLimit, toArray: mockToArray });
    mockCollection.mockReturnValue({ find: mockFind });
    mockDb.mockReturnValue({ collection: mockCollection });
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [NewsService],
    }).compile();

    service = module.get<NewsService>(NewsService);
  });

  describe('when MongoDB connects successfully', () => {
    beforeEach(async () => {
      mockToArray.mockResolvedValue(mockDocs);
      await service.onModuleInit();
    });

    it('returns mapped articles for the requested symbol', async () => {
      const result = await service.getNews('AAPL');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        headline: 'Apple beats earnings',
        source: 'reuters',
        url: 'https://reuters.com/1',
        publishedAt: new Date('2024-01-01T09:00:00Z').toISOString(),
        sentimentLabel: 'positive',
        sentimentScore: 0.85,
      });
    });

    it('queries the articles collection filtered by symbol', async () => {
      await service.getNews('TSLA', 5);

      expect(mockCollection).toHaveBeenCalledWith('articles');
      expect(mockFind).toHaveBeenCalledWith(
        { symbol: 'TSLA' },
        expect.objectContaining({ projection: expect.any(Object) as unknown }),
      );
      expect(mockLimit).toHaveBeenCalledWith(5);
    });

    it('uses default limit of 10 when not specified', async () => {
      await service.getNews('MSFT');

      expect(mockLimit).toHaveBeenCalledWith(10);
    });

    it('disconnects on module destroy', async () => {
      await service.onModuleDestroy();

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('when MongoDB fails to connect', () => {
    beforeEach(async () => {
      mockConnect.mockRejectedValueOnce(new Error('connection refused'));
      await service.onModuleInit();
    });

    it('returns an empty array', async () => {
      const result = await service.getNews('AAPL');
      expect(result).toEqual([]);
    });
  });
});
