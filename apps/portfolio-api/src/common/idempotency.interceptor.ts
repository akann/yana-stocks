import { createHash } from 'node:crypto';
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';
import { decodeJwtPayload } from './current-user.decorator';

interface IdempotencyRecord {
  state: 'in_flight' | 'done';
  bodyHash: string;
  status?: number;
  body?: unknown;
}

interface ForwardResult {
  status: number;
  body: unknown;
}

const CLAIM_TTL_SECONDS = 60; // comfortably exceeds HttpModule's 10s per-call timeout
const RESULT_TTL_SECONDS = 86_400; // 24h — long enough to cover a realistic client retry window

/** Deterministic JSON stringify (sorted object keys) so the same body always hashes the same. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${entries.join(',')}}`;
}

/**
 * Applied via @Idempotent() to mutating proxy routes (addStock,
 * addWatchlistSymbol, createWatchlist, addStocksBatch) — never on the
 * catch-all proxy(). Opt-in: a request with no Idempotency-Key header passes
 * straight through unchanged.
 *
 * Relies on `forward()` returning `{ status, body }` instead of `void` (it
 * still calls `res.status().json()` itself — Nest ignores a library-mode
 * handler's return value for the actual response, but this interceptor still
 * sees it) so the real downstream response can be cached and replayed.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly redis: RedisService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler<ForwardResult>,
  ): Promise<Observable<ForwardResult>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const idempotencyKeyHeader = req.headers['idempotency-key'];
    if (!idempotencyKeyHeader) {
      return next.handle();
    }
    const idempotencyKey = Array.isArray(idempotencyKeyHeader)
      ? idempotencyKeyHeader[0]
      : idempotencyKeyHeader;
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'Idempotency-Key header must be a non-empty string of 255 characters or fewer',
      );
    }

    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const payload = token ? decodeJwtPayload(token) : null;
    const sub = typeof payload?.['sub'] === 'string' ? payload['sub'] : 'anonymous';

    const key = `papi:idem:${sub}:${req.method}:${req.path}:${idempotencyKey}`;
    const bodyHash = createHash('sha256').update(stableStringify(req.body)).digest('hex');

    let acquired: boolean;
    try {
      acquired = await this.redis.setNx(
        key,
        JSON.stringify({ state: 'in_flight', bodyHash } satisfies IdempotencyRecord),
        CLAIM_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`Idempotency-Key claim failed, passing through: ${String(err)}`);
      return next.handle();
    }

    if (!acquired) {
      return from(this.handleExistingClaim(key, bodyHash, res));
    }

    return next.handle().pipe(
      mergeMap((result) => from(this.persistResult(key, bodyHash, result))),
      catchError((err: unknown) => from(this.cleanupAndRethrow(key, err))),
    );
  }

  /** A claim already exists for this key — replay if it matches, else reject. */
  private async handleExistingClaim(
    key: string,
    bodyHash: string,
    res: Response,
  ): Promise<ForwardResult> {
    const raw = await this.redis.get(key);
    const existing = raw ? (JSON.parse(raw) as IdempotencyRecord) : null;

    if (!existing || existing.bodyHash !== bodyHash) {
      throw new UnprocessableEntityException(
        'Idempotency-Key was already used with a different request body',
      );
    }
    if (existing.state === 'in_flight') {
      throw new ConflictException('A request with this Idempotency-Key is already in progress');
    }

    const result: ForwardResult = { status: existing.status ?? 200, body: existing.body };
    res.setHeader('Idempotent-Replay', 'true');
    res.status(result.status).json(result.body);
    return result;
  }

  private async persistResult(
    key: string,
    bodyHash: string,
    result: ForwardResult,
  ): Promise<ForwardResult> {
    try {
      if (result.status < 400) {
        await this.redis.set(
          key,
          JSON.stringify({
            state: 'done',
            bodyHash,
            status: result.status,
            body: result.body,
          } satisfies IdempotencyRecord),
          RESULT_TTL_SECONDS,
        );
      } else {
        // Failure — release the claim so a legitimate retry isn't rejected as a replay.
        await this.redis.del(key);
      }
    } catch (err) {
      this.logger.warn(`Failed to persist idempotency result: ${String(err)}`);
    }
    return result;
  }

  private async cleanupAndRethrow(key: string, err: unknown): Promise<never> {
    try {
      await this.redis.del(key);
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}
