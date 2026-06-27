import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const mockClient = {
  on: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  scan: jest.fn(),
  mget: jest.fn().mockResolvedValue([]),
  disconnect: jest.fn(),
};

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockClient));

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') },
        },
      ],
    }).compile();
    service = module.get(RedisService);
  });

  describe('set()', () => {
    it('calls redis.set when no TTL is provided', async () => {
      await service.set('k', 'v');
      expect(mockClient.set).toHaveBeenCalledWith('k', 'v');
      expect(mockClient.setex).not.toHaveBeenCalled();
    });

    it('calls redis.setex when a TTL is provided', async () => {
      await service.set('k', 'v', 60);
      expect(mockClient.setex).toHaveBeenCalledWith('k', 60, 'v');
      expect(mockClient.set).not.toHaveBeenCalled();
    });
  });

  describe('get()', () => {
    it('returns the stored value', async () => {
      mockClient.get.mockResolvedValue('hello');
      expect(await service.get('k')).toBe('hello');
      expect(mockClient.get).toHaveBeenCalledWith('k');
    });

    it('returns null for a missing key', async () => {
      mockClient.get.mockResolvedValue(null);
      expect(await service.get('missing')).toBeNull();
    });
  });

  describe('del()', () => {
    it('delegates to redis.del', async () => {
      await service.del('k');
      expect(mockClient.del).toHaveBeenCalledWith('k');
    });
  });

  describe('mget()', () => {
    it('returns an empty array without calling redis for an empty key list', async () => {
      const result = await service.mget([]);
      expect(result).toEqual([]);
      expect(mockClient.mget).not.toHaveBeenCalled();
    });

    it('delegates to redis.mget for a non-empty list', async () => {
      mockClient.mget.mockResolvedValue(['a', null, 'b']);
      const result = await service.mget(['k1', 'k2', 'k3']);
      expect(result).toEqual(['a', null, 'b']);
      expect(mockClient.mget).toHaveBeenCalledWith(['k1', 'k2', 'k3']);
    });
  });

  describe('scan()', () => {
    it('iterates cursor until it returns "0" and collects all keys', async () => {
      mockClient.scan
        .mockResolvedValueOnce(['cursor1', ['key1', 'key2']])
        .mockResolvedValueOnce(['0', ['key3']]);
      const result = await service.scan('prefix:*');
      expect(result).toEqual(['key1', 'key2', 'key3']);
      expect(mockClient.scan).toHaveBeenCalledTimes(2);
    });

    it('returns an empty array when no keys match', async () => {
      mockClient.scan.mockResolvedValueOnce(['0', []]);
      const result = await service.scan('nomatch:*');
      expect(result).toEqual([]);
    });
  });

  describe('onModuleDestroy()', () => {
    it('disconnects the Redis client', () => {
      service.onModuleDestroy();
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });
});
