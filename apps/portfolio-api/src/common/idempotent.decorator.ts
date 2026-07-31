import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** Opt-in Idempotency-Key support — see idempotency.interceptor.ts. */
export function Idempotent(): MethodDecorator & ClassDecorator {
  return applyDecorators(UseInterceptors(IdempotencyInterceptor));
}
