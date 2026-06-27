import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('check() returns { status: "ok" }', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
