// Temporary — remove once Phase 5 Sentry verification (error + source map) has passed.
export async function GET() {
  throw new Error('Sentry test error — yana-stocks frontend Phase 5');
}
