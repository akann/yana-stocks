import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { RedisService } from '../redis/redis.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

function mockRedis(): jest.Mocked<Pick<RedisService, 'get' | 'set' | 'setNx' | 'del'>> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    setNx: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(undefined),
  };
}

function mockContext(headers: Record<string, string | undefined>, body: unknown = {}) {
  const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const req = { method: 'POST', path: '/portfolios/abc/stocks', headers, body };
  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  return { context, req, res };
}

interface ForwardResult {
  status: number;
  body: unknown;
}

function handlerReturning(result: ForwardResult): CallHandler<ForwardResult> {
  return { handle: () => of(result) };
}

function handlerThrowing(err: Error): CallHandler<ForwardResult> {
  return { handle: () => throwError(() => err) };
}

describe('IdempotencyInterceptor', () => {
  let redis: jest.Mocked<Pick<RedisService, 'get' | 'set' | 'setNx' | 'del'>>;
  let interceptor: IdempotencyInterceptor;
  const handler = jest.fn();

  beforeEach(() => {
    redis = mockRedis();
    interceptor = new IdempotencyInterceptor(redis as unknown as RedisService);
    handler.mockReset();
  });

  it('passes through unchanged when no Idempotency-Key header is present', async () => {
    const { context } = mockContext({});
    const next = handlerReturning({ status: 200, body: { ok: true } });

    const result$ = await interceptor.intercept(context, next);
    const result = await firstValueFrom(result$);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(redis.setNx).not.toHaveBeenCalled();
  });

  it('caches a successful result under the claimed key on first use', async () => {
    const { context } = mockContext({ 'idempotency-key': 'key-1' }, { symbol: 'AAPL' });
    const next = handlerReturning({ status: 201, body: { id: 'p1' } });

    const result$ = await interceptor.intercept(context, next);
    await firstValueFrom(result$);

    expect(redis.setNx).toHaveBeenCalledWith(
      expect.stringContaining('key-1'),
      expect.stringContaining('"in_flight"'),
      60,
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('key-1'),
      expect.stringContaining('"done"'),
      86_400,
    );
  });

  it('deletes the claim instead of caching when the handler returns an error status', async () => {
    const { context } = mockContext({ 'idempotency-key': 'key-1' }, { symbol: 'AAPL' });
    const next = handlerReturning({ status: 500, body: { error: 'boom' } });

    const result$ = await interceptor.intercept(context, next);
    await firstValueFrom(result$);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('key-1'));
  });

  it('deletes the claim and rethrows when the handler throws', async () => {
    const { context } = mockContext({ 'idempotency-key': 'key-1' }, { symbol: 'AAPL' });
    const next = handlerThrowing(new Error('downstream failure'));

    const result$ = await interceptor.intercept(context, next);
    await expect(firstValueFrom(result$)).rejects.toThrow('downstream failure');
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('key-1'));
  });

  it('replays the cached response on a second request with the same key and body', async () => {
    const { createHash } = await import('node:crypto');
    const body = { symbol: 'AAPL' };
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    redis.setNx.mockResolvedValue(false);
    redis.get.mockResolvedValue(
      JSON.stringify({ state: 'done', bodyHash, status: 201, body: { id: 'p1' } }),
    );

    const { context, res } = mockContext({ 'idempotency-key': 'key-1' }, body);
    const next = handlerReturning({ status: 999, body: { id: 'SHOULD_NOT_RUN' } });

    const result$ = await interceptor.intercept(context, next);
    const result = await firstValueFrom(result$);

    expect(result).toEqual({ status: 201, body: { id: 'p1' } });
    expect(res.setHeader).toHaveBeenCalledWith('Idempotent-Replay', 'true');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects with 422 when the same key is reused with a different body', async () => {
    redis.setNx.mockResolvedValue(false);
    redis.get.mockResolvedValue(
      JSON.stringify({ state: 'done', bodyHash: 'some-other-hash', status: 201, body: {} }),
    );
    const { context } = mockContext({ 'idempotency-key': 'key-1' }, { symbol: 'MSFT' });

    // The "not acquired" path resolves intercept() to an Observable that
    // only rejects on subscription (handleExistingClaim's own promise
    // rejects asynchronously) — assert on firstValueFrom(result$), not on
    // intercept()'s own promise.
    const result$ = await interceptor.intercept(
      context,
      handlerReturning({ status: 200, body: {} }),
    );
    await expect(firstValueFrom(result$)).rejects.toMatchObject({ status: 422 });
  });

  it('rejects with 409 while the same key is still in flight', async () => {
    redis.setNx.mockResolvedValue(false);
    const { context } = mockContext({ 'idempotency-key': 'key-1' }, { symbol: 'MSFT' });
    const { createHash } = await import('node:crypto');
    const bodyHash = createHash('sha256')
      .update(JSON.stringify({ symbol: 'MSFT' }))
      .digest('hex');
    redis.get.mockResolvedValue(JSON.stringify({ state: 'in_flight', bodyHash }));

    const result$ = await interceptor.intercept(
      context,
      handlerReturning({ status: 200, body: {} }),
    );
    await expect(firstValueFrom(result$)).rejects.toMatchObject({ status: 409 });
  });

  it('passes through when the Redis claim call fails', async () => {
    redis.setNx.mockRejectedValue(new Error('redis down'));
    const { context } = mockContext({ 'idempotency-key': 'key-1' }, { symbol: 'AAPL' });
    const next = handlerReturning({ status: 200, body: { ok: true } });

    const result$ = await interceptor.intercept(context, next);
    const result = await firstValueFrom(result$);

    expect(result).toEqual({ status: 200, body: { ok: true } });
  });

  it('rejects with 400 for an Idempotency-Key longer than 255 characters', async () => {
    const { context } = mockContext({ 'idempotency-key': 'x'.repeat(256) });

    await expect(
      interceptor.intercept(context, handlerReturning({ status: 200, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });
});
