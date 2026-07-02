interface MarketDef {
  timeZone: string;
  openMinutes: number;
  closeMinutes: number;
}

const MARKETS: Record<'US' | 'UK' | 'DE', MarketDef> = {
  US: { timeZone: 'America/New_York', openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
  UK: { timeZone: 'Europe/London', openMinutes: 8 * 60, closeMinutes: 16 * 60 + 30 },
  DE: { timeZone: 'Europe/Berlin', openMinutes: 9 * 60, closeMinutes: 17 * 60 + 30 },
};

// Symbol conventions used across this app: UK equities carry a `.L` suffix
// (see price-processor's TwelveData routing); indices use FMP's `^`-prefixed
// tickers (^FTSE, ^GDAXI). Everything else defaults to the US market.
export function getMarketRegion(symbol: string): keyof typeof MARKETS {
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.L') || upper === '^FTSE') return 'UK';
  if (upper === '^GDAXI') return 'DE';
  return 'US';
}

// No holiday calendar — a market holiday within normal weekday/hours will
// incorrectly report as open.
export function isMarketOpen(symbol: string, now: Date = new Date()): boolean {
  const { timeZone, openMinutes, closeMinutes } = MARKETS[getMarketRegion(symbol)];
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);

  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const minutesSinceMidnight = hour * 60 + minute;
  return minutesSinceMidnight >= openMinutes && minutesSinceMidnight < closeMinutes;
}
