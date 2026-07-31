import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();
collectDefaultMetrics({ register });

/** Emitted by each provider's CircuitBreaker (see external-api-breakers.service.ts). */
export const externalApiRequestsTotal = new Counter({
  name: 'external_api_requests_total',
  help: 'Total calls to a third-party API, by outcome',
  labelNames: ['provider', 'outcome'],
  registers: [register],
});

/** 0 = closed, 0.5 = half-open, 1 = open. */
export const externalApiCircuitState = new Gauge({
  name: 'external_api_circuit_state',
  help: "Current circuit-breaker state for a third-party API's provider",
  labelNames: ['provider'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/** Records duration/count for every request, including unmatched routes (404s). */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestsTotal.inc(labels);
  });
  next();
}
