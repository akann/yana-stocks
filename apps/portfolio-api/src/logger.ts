import { LoggerService } from '@nestjs/common';

/** Structured JSON logger, wired in via app.useLogger() in main.ts. */
export class JsonLogger implements LoggerService {
  constructor(private readonly service: string) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    const context =
      optionalParams.length > 0 ? optionalParams[optionalParams.length - 1] : undefined;
    const trace = optionalParams.length > 1 ? optionalParams.slice(0, -1) : [];

    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: this.service,
        ...(typeof context === 'string' && { context }),
        message: typeof message === 'string' ? message : JSON.stringify(message),
        ...(trace.length > 0 && { trace: trace.length === 1 ? trace[0] : trace }),
      }) + '\n',
    );
  }
}
