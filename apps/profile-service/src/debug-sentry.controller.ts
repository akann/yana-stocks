import { Controller, Get } from '@nestjs/common';

// Temporary — remove once Phase 6a Sentry verification (error + source map,
// plus the 24-48h Tempo observation window) has passed.
@Controller('debug-sentry')
export class DebugSentryController {
  @Get()
  throwError(): never {
    throw new Error('Sentry test error — profile-service Phase 6a');
  }
}
