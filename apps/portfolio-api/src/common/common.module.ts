import { Global, Module } from '@nestjs/common';
import { ExternalApiBreakersService } from './external-api-breakers.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Global()
@Module({
  providers: [ExternalApiBreakersService, IdempotencyInterceptor],
  exports: [ExternalApiBreakersService, IdempotencyInterceptor],
})
export class CommonModule {}
