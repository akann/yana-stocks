import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('redis.url'));
    this.client.on('error', (err: Error) => this.logger.error('Redis error: %s', err.message));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** Best-effort dedup lock: acquires `key` for `ttlSeconds` only if absent. */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async scan(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');
    return keys;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (!keys.length) return [];
    return this.client.mget(keys);
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
