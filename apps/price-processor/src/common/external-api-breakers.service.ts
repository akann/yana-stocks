import { Injectable, Logger } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { externalApiCircuitState, externalApiRequestsTotal } from '../metrics';

/** Third-party APIs this service calls directly (not internal service-to-service calls). */
export type ExternalApiProvider = 'massive' | 'twelvedata';

const BREAKER_OPTIONS = {
  // No `timeout` here deliberately — each call site already has its own axios
  // timeout (the shared Twelve Data instance sets 8s; Polygon calls rely on
  // whatever the POLYGON_HTTP instance is configured with), and opossum racing
  // a second timeout against that would just duplicate/shadow it. The breaker
  // treats whatever rejection axios's own timeout produces as a `failure`.
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  rollingCountTimeout: 10_000,
};

/**
 * One CircuitBreaker per third-party provider (not per call site) — a breaker
 * needs many calls to accumulate a trip decision, so each provider gets a
 * single shared breaker every call site funnels through via `fire()`.
 *
 * Breaker events double as this app's only external-API failure metric
 * (`external_api_requests_total`/`external_api_circuit_state` in metrics.ts) —
 * no separate instrumentation layer needed. Mirrors portfolio-api's
 * ExternalApiBreakersService (same metric names/labels, so one PrometheusRule
 * can query both services by `job`).
 */
@Injectable()
export class ExternalApiBreakersService {
  private readonly logger = new Logger(ExternalApiBreakersService.name);
  private readonly breakers = new Map<
    ExternalApiProvider,
    CircuitBreaker<[() => Promise<unknown>], unknown>
  >();

  fire<T>(provider: ExternalApiProvider, fn: () => Promise<T>): Promise<T> {
    return this.getBreaker(provider).fire(fn) as Promise<T>;
  }

  private getBreaker(
    provider: ExternalApiProvider,
  ): CircuitBreaker<[() => Promise<unknown>], unknown> {
    const existing = this.breakers.get(provider);
    if (existing) return existing;

    const breaker = new CircuitBreaker<[() => Promise<unknown>], unknown>((fn) => fn(), {
      ...BREAKER_OPTIONS,
      name: provider,
    });

    breaker.on('success', () => externalApiRequestsTotal.inc({ provider, outcome: 'success' }));
    breaker.on('failure', () => externalApiRequestsTotal.inc({ provider, outcome: 'failure' }));
    breaker.on('timeout', () => externalApiRequestsTotal.inc({ provider, outcome: 'timeout' }));
    breaker.on('reject', () => externalApiRequestsTotal.inc({ provider, outcome: 'rejected' }));

    breaker.on('open', () => {
      externalApiCircuitState.set({ provider }, 1);
      this.logger.warn(`Circuit opened for ${provider} — failing fast until half-open retry`);
    });
    breaker.on('halfOpen', () => externalApiCircuitState.set({ provider }, 0.5));
    breaker.on('close', () => externalApiCircuitState.set({ provider }, 0));

    externalApiCircuitState.set({ provider }, 0); // registers the series at 0 before any state change fires
    this.breakers.set(provider, breaker);
    return breaker;
  }
}
