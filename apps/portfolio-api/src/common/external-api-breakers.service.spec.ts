import { ExternalApiBreakersService } from './external-api-breakers.service';

describe('ExternalApiBreakersService', () => {
  let service: ExternalApiBreakersService;

  beforeEach(() => {
    service = new ExternalApiBreakersService();
  });

  it('passes through a successful call unchanged', async () => {
    const result = await service.fire('fmp', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('propagates the underlying rejection while the circuit is closed', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(service.fire('fmp', fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('opens after repeated failures and short-circuits without calling the wrapped function again', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    // errorThresholdPercentage: 50 with opossum's default volumeThreshold — a
    // handful of consecutive failures on a fresh breaker is enough to trip it.
    for (let i = 0; i < 10; i++) {
      await expect(service.fire('massive', fn)).rejects.toThrow();
    }
    const callsWhileClosed = fn.mock.calls.length;
    expect(callsWhileClosed).toBeGreaterThan(0);

    // Once open, further fire() calls must fail fast (opossum's own "Breaker
    // is open" rejection) without invoking fn again — this is the actual
    // resilience behavior the reviewer asked about, not just a metric.
    await expect(service.fire('massive', fn)).rejects.toThrow();
    expect(fn.mock.calls.length).toBe(callsWhileClosed);
  });

  it('keeps independent state per provider', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    for (let i = 0; i < 10; i++) {
      await expect(service.fire('fmp', failing)).rejects.toThrow();
    }

    // A different provider's breaker must still be closed.
    const result = await service.fire('twelvedata', () => Promise.resolve('fine'));
    expect(result).toBe('fine');
  });
});
