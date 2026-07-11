import { Controller, Get } from '@nestjs/common';

// Temporary — remove once Phase 6b Sentry verification has passed.
@Controller('debug-sentry')
export class DebugSentryController {
  @Get()
  throwError(): never {
    throw new Error('Sentry test error — portfolio-service Phase 6b');
  }
}
