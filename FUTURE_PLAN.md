# yana-stocks — Feature Implementation Plan

## What stays, what goes

### Stays (these are the foundation)

- **MongoDB schemas** — `price_bars`, `articles`, `profiles`, `watchlists` —
  data structures are correct, kept as-is
- **FinBERT model** — the NLP pipeline in `sentiment-analyzer` stays; only the
  news _source client_ is replaced
- **All REST API routes** — `/stocks/:symbol/history`, `/news/:symbol`,
  `/watchlists`, etc. — route contracts stay; implementations change underneath
- **Kong routing and auth** — unchanged
- **`SignalsPanel.tsx`** — extended in Step 5, not replaced
- **`NewsPanel.tsx`** — unchanged (data source behind it changes, component
  doesn't)

### Deleted outright (nothing is preserved for the sake of it)

| What                                                                          | Why                                                       |
| ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `price-ingestor/src/price_ingestor/alpaca_client.py`                          | Replaced by Massive WebSocket client                      |
| `price-ingestor/src/price_ingestor/main.py` poll loop                         | Replaced by WebSocket push handler                        |
| `price-processor` tick aggregation (`$max`/`$min`/`$inc` logic)               | Massive sends complete bars — aggregation has no purpose  |
| `price-processor` Yahoo Finance fallback (`yahoo-finance2`)                   | Replaced by Massive REST (US) and Twelve Data (UK)        |
| `price-processor` Alpaca REST history calls                                   | Same as above                                             |
| `sentiment-analyzer/src/sentiment_analyzer/news_client.py` (AlpacaNewsClient) | Replaced by FMP news client (Step 8)                      |
| `portfolio-api` Alpaca asset listing (`fetchFromAlpaca()`)                    | Replaced by Massive ticker reference (Step 7)             |
| KEDA `ScaledObject` on `price-ingestor`                                       | WebSocket connection must be exactly 1 replica            |
| `StockBrowser.tsx` (the flat 10,000-row Alpaca dump)                          | Replaced by `MarketBrowser.tsx` (Step 7)                  |
| `PriceChart.tsx` (Recharts area chart)                                        | Replaced by `StockChart.tsx` (lightweight-charts, Step 1) |

---

## Data Sources

### Current (to be replaced)

| Source                           | Data provided                                   | Why replacing                                                               |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Alpaca Markets (snapshot poll)   | Latest trade price every 30s                    | Polling loop — no true OHLCV from the ingestor; 15-min delayed on free tier |
| Alpaca News API                  | US-only news                                    | US coverage only; FMP covers all markets on the same account                |
| Yahoo Finance (`yahoo-finance2`) | Daily/minute history fallback, on-demand quotes | Unofficial scraper — no SLA, breaks without warning                         |

### Target

| Need                             | Source                                   | Cost               | Notes                                                                                                                           |
| -------------------------------- | ---------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| US real-time prices + history    | **Massive (formerly Polygon.io)**        | $29/mo (Starter)   | WebSocket minute aggregates (push, not poll); REST for full history up to 2 years; official ticker reference with ETFs natively |
| UK / international prices        | **Twelve Data**                          | Grow plan          | Official REST API covering UK, EU, global markets; on-demand only (no streaming needed)                                         |
| News (all markets)               | **Financial Modeling Prep (FMP)**        | Free (250 req/day) | Single provider for US + international; finance-specific; same key as analyst ratings                                           |
| Analyst ratings + price targets  | **FMP** `/analyst-stock-recommendations` | Free (250 req/day) | Ratings, consensus, price targets                                                                                               |
| Sector performance               | **FMP** `/sector-performance`            | Free (250 req/day) | Same account, no extra key                                                                                                      |
| Index values (^FTSE, ^GSPC etc.) | **Twelve Data**                          | Grow plan          | Covers major global indices                                                                                                     |

### What Massive replaces — component by component

| Current component                     | Current behaviour                                                        | Massive replacement                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `price-ingestor` Alpaca poll          | Snapshots latest trade every 30s; publishes single price point           | WebSocket `AM.*` subscription — Massive **pushes** a complete OHLCV bar the moment each minute closes    |
| `price-processor` bar-building        | Aggregates raw ticks into OHLCV via MongoDB `$max`/`$min`/`$inc` upserts | **Eliminated** — Massive bars arrive complete; processor stores them directly                            |
| `price-processor` Alpaca REST history | Last 3 days of minute bars                                               | Massive `/v2/aggs/ticker/{t}/range/1/minute/{from}/{to}` — up to 2 years                                 |
| `price-processor` Yahoo Finance       | Daily + minute fallback history; on-demand quotes                        | Massive REST aggregates + Massive snapshot API                                                           |
| `portfolio-api` Alpaca asset listing  | US equity list via `/v2/assets`                                          | Massive `/v3/reference/tickers` — richer (ETFs native, market cap, SIC code for future sector work)      |
| KEDA ScaledObject on `price-ingestor` | Scales 0→N on Kafka lag                                                  | **Removed** — WebSocket requires exactly 1 persistent replica; standard Deployment replaces ScaledObject |

### Kafka message format change (ingestor → processor)

Currently `RawPriceMessage` is a single tick (latest trade price). Massive
minute aggregates are complete OHLCV bars. The shared Kafka contract changes:

```typescript
// packages/shared-types/src/kafka.ts

// Before — single tick from Alpaca snapshot
export interface RawPriceMessage {
  symbol: string;
  price: number; // latest trade only
  bid: number;
  ask: number;
  volume: number;
  timestamp: string;
}

// After — complete OHLCV bar from Massive WebSocket
export interface RawPriceMessage {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string; // bar start (UTC ISO)
}
```

> **Deployment atomicity:** `price-ingestor` and `price-processor` both read
> `RawPriceMessage`. They must be deployed in the same ArgoCD sync — if
> `price-ingestor` lands first with the new OHLCV shape while `price-processor`
> still expects the old tick format, Kafka messages will fail to deserialize.
> Update both image tags in `k8s-apps` in a single commit.

`price-processor.process()` simplifies from complex MongoDB aggregation to a
straight upsert.

### price-ingestor: polling → WebSocket

```python
# Before — poll loop every 30s
while running:
    snapshots = client.get_snapshots(symbols)
    for msg in snapshots.values():
        producer.publish(msg)
    time.sleep(30)

# After — Massive WebSocket push (polygon-api-client Python library)
from polygon import WebSocketClient
from polygon.websocket.models.common import Feed, Market
from polygon.websocket.models.models import EquityAgg

def handle_msg(msgs):
    for msg in msgs:
        if isinstance(msg, EquityAgg) and msg.event_type == 'AM':  # minute aggregate
            producer.publish(OHLCVBar(
                symbol=msg.symbol,
                open=msg.open, high=msg.high,
                low=msg.low,  close=msg.close,
                volume=msg.volume,
                timestamp=datetime.fromtimestamp(
                    msg.start_timestamp / 1000, UTC
                ).isoformat(),
            ))

# Feed.StarterFeed = starterfeed.polygon.io — required for the $29/mo Starter plan.
# Using the wrong feed endpoint causes auth failure even with a valid key.
client = WebSocketClient(
    api_key=settings.massive_api_key,
    feed=Feed.StarterFeed,
    market=Market.Stocks,
)
client.subscribe("AM.*")    # subscribe takes topic strings only
client.run(handle_msg)      # handler passed to run(), not subscribe(); blocks + auto-reconnects
```

### News consolidation

FMP News replaces Alpaca News as the single provider for **all markets**.
`sentiment-analyzer/news_client.py` (AlpacaNewsClient) is deleted; a new
`fmp_news_client.py` is written in its place. The FinBERT analysis pipeline and
MongoDB storage are untouched. FMP articles are queried by ticker symbol
directly — no per-market routing needed.

### UK price strategy

UK markets are closed for most of the US trading day — a streaming ingestor is
the wrong fit. Twelve Data is called **on-demand** inside `price-processor` when
a UK symbol is requested and not in cache. No new service, no Kafka involvement
for UK stocks.

### Technical indicators

Use the `technicalindicators` npm package — battle-tested TypeScript with
correct implementations of SMA, EMA, RSI, MACD, and Bollinger Bands. RSI (Wilder
smoothing), EMA initialisation, and MACD signal calculation have known
correctness traps in hand-rolled implementations. Do not write indicator math
from scratch.

---

## API Keys

### New keys required

| Key                   | Service                                        | Used by                                                                                                                                      | Infisical path                     | Status         |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------- |
| `MASSIVE_API_KEY`     | Massive (formerly Polygon.io) Starter ($29/mo) | `price-ingestor` (WebSocket), `price-processor` (REST history + snapshots), `portfolio-api` (ticker reference)                               | `/yana-stocks/MASSIVE_API_KEY`     | ✓ in Infisical |
| `FMP_API_KEY`         | Financial Modeling Prep (free)                 | `portfolio-api` (analyst ratings, sector performance), `sentiment-analyzer` (news)                                                           | `/yana-stocks/FMP_API_KEY`         | ✓ in Infisical |
| `TWELVE_DATA_API_KEY` | Twelve Data (Grow plan)                        | `price-processor` (UK/international on-demand history + quotes); `portfolio-api` (FTSE 100 sector rotation — 31 LSE stocks, daily % changes) | `/yana-stocks/TWELVE_DATA_API_KEY` | ✓ in Infisical |

### Keys being retired

| Key                 | Currently used by                                      | Retire when                                    |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `ALPACA_API_KEY`    | `price-ingestor`, `price-processor` (Alpaca REST bars) | After Step 0 verified in production            |
| `ALPACA_API_SECRET` | Same + `sentiment-analyzer` (Alpaca News)              | After Step 8 (FMP news) verified in production |

> Keep both Alpaca keys active in Infisical until their respective steps are
> verified in production. `ALPACA_API_KEY` can be retired after Step 0;
> `ALPACA_API_SECRET` stays until Step 8 replaces `sentiment-analyzer`'s news
> source.

### k8s / Infisical changes per step

| Step                 | Action                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 (Massive)          | `MASSIVE_API_KEY` ✓ already in Infisical; update `price-ingestor` and `price-processor` ExternalSecrets to reference it; remove Alpaca refs from both               |
| 8 (FMP)              | `FMP_API_KEY` ✓ already in Infisical; update `portfolio-api` ExternalSecret to add it; update `sentiment-analyzer` ExternalSecret (remove Alpaca keys, add FMP key) |
| 9 (UK / Twelve Data) | `TWELVE_DATA_API_KEY` ✓ already in Infisical; update `price-processor` ExternalSecret to reference it                                                               |
| 14 (Sector rotation) | `TWELVE_DATA_API_KEY` added to `portfolio-api` ExternalSecret and deployment (FTSE 100 path); `portfolio-api` fetches 31 LSE stocks via Twelve Data time-series API |

---

## Implementation Order

Sequenced to deliver value early, deferring items that need new integrations:

| #   | Feature                                                                             | Effort  | New data source?                                     | Status     |
| --- | ----------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- | ---------- |
| 0   | **Massive migration** — replace Alpaca + Yahoo Finance for US prices                | Medium  | Massive/Polygon.io ($29/mo)                          | ✓ complete |
| 1   | Candlestick chart (switch to lightweight-charts)                                    | Medium  | No                                                   | ✓ complete |
| 2   | Volume histogram pane below price chart                                             | Low     | No                                                   | ✓ complete |
| 3   | Moving average overlays (SMA/EMA)                                                   | Low     | No                                                   | ✓ complete |
| 4   | RSI sub-chart                                                                       | Medium  | No                                                   | ✓ complete |
| 5   | MACD sub-chart + buy/sell signal badges                                             | Medium  | No                                                   | ✓ complete |
| 6   | Watchlist `+` button across all ticker appearances                                  | Low     | No — backend already exists                          | ✓ complete |
| 7   | ETF support in asset browser                                                        | Trivial | No — Massive ticker reference includes ETFs natively | ✓ complete |
| 8   | Analyst ratings (FMP) + news consolidation (FMP replaces Alpaca News)               | Medium  | Financial Modeling Prep                              | ✓ complete |
| 9   | Location-specific defaults + UK data (Twelve Data)                                  | Medium  | Twelve Data                                          | ✓ complete |
| 10  | Home screen with indices & sectors                                                  | High    | FMP + Twelve Data                                    | ✓ complete |
| 11  | Stock screener                                                                      | High    | FMP + Twelve Data                                    | ✓ complete |
| 12  | News pin markers with headline popup on price chart                                 | Low     | No — news already fetched                            | ✓ complete |
| 13  | Home market preference UI (profile settings + home screen wiring)                   | Low     | No — backend schema already in place                 | ✓ complete |
| 14  | Sector rotation time-series heatmap (S&P 500 + FTSE 100)                            | Medium  | FMP (S&P 500) + Twelve Data (FTSE 100)               | ✓ complete |
| 15  | Factor performance tiles (Momentum / Value / Growth / Dividend / Low Vol / Quality) | Medium  | No — uses existing ETF price infrastructure          | ✓ complete |

> Step 0 (Massive) is a prerequisite for Steps 1–7 to have accurate, real-time
> data underneath them. Steps 1–6 are pure frontend and can be done
> independently of Step 0, but Massive should land before or alongside them in
> production.

---

## Step 0 — Massive Migration

Replaces all Alpaca and Yahoo Finance dependencies for US price data. This is
the only step that touches Python services and shared Kafka types.

### Files to change

#### `yana-stocks` repo

| File                                                          | Action                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/kafka.ts`                          | Update `RawPriceMessage` to OHLCV shape (see schema above)                                                                                                                                                                          |
| `services/price-ingestor/src/price_ingestor/config.py`        | Remove `alpaca_api_key`, `alpaca_api_secret`, `alpaca_base_url`, `alpaca_feed`, `poll_interval_seconds`; add `massive_api_key: str`                                                                                                 |
| `services/price-ingestor/src/price_ingestor/alpaca_client.py` | **Delete**                                                                                                                                                                                                                          |
| `services/price-ingestor/src/price_ingestor/main.py`          | Rewrite: replace poll loop with Massive WebSocket handler (see code above)                                                                                                                                                          |
| `services/price-ingestor/src/price_ingestor/backfill.py`      | **Delete** — used yfinance for one-time seeding; Massive REST history via `price-processor` replaces this need                                                                                                                      |
| `services/price-ingestor/pyproject.toml`                      | Remove `alpaca-py` and `yfinance`; add `polygon-api-client`                                                                                                                                                                         |
| `apps/price-processor/src/prices/prices.service.ts`           | Remove Yahoo Finance import + history fallback + tick aggregation logic; add Massive REST client for history (`/v2/aggs`) and snapshot (`/v2/snapshot`); map `close` → `price` in outbound `ProcessedPriceMessage` (see note below) |
| `apps/price-processor/package.json`                           | Remove `yahoo-finance2`; add `@polygon.io/client-js`                                                                                                                                                                                |

> **`ProcessedPriceMessage.price` mapping:** `portfolio-api`'s Kafka consumer
> reads `msg.price` from `ProcessedPriceMessage` to compute price change. After
> Step 0, `price-processor.process()` no longer receives `msg.price` from
> `RawPriceMessage` — it receives `msg.close`. The outbound
> `ProcessedPriceMessage` must map `close` → `price`:
> `processed.price = msg.close`. The Redis cache key `price:latest:${symbol}`
> must similarly store `msg.close`. `ProcessedPriceMessage` itself is unchanged
> — only the processor's mapping logic changes.

> **Note:** `portfolio-api/src/stocks/stocks.service.ts` still calls
> `fetchFromAlpaca()` after Step 0 — this is intentional. Alpaca keys remain
> active and that endpoint continues working. It is replaced in Step 7 when the
> Massive ticker reference lands.

#### `k8s-apps` repo

| File                                                     | Action                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/yana-stocks/price-ingestor/keda-scaledobject.yaml` | **Delete** (WebSocket requires exactly 1 replica)                                                |
| `apps/yana-stocks/price-ingestor/kustomization.yaml`     | Remove `keda-scaledobject.yaml` from resources list                                              |
| `apps/yana-stocks/price-ingestor/deployment.yaml`        | Set `replicas: 1`; add `MASSIVE_API_KEY` env var from ExternalSecret; remove `ALPACA_*` env vars |
| `apps/yana-stocks/price-ingestor/external-secret.yaml`   | Replace Alpaca key refs with `MASSIVE_API_KEY` from `/yana-stocks/MASSIVE_API_KEY`               |
| `apps/yana-stocks/price-processor/external-secret.yaml`  | Add `MASSIVE_API_KEY`; remove `ALPACA_*` refs                                                    |
| `apps/yana-stocks/price-processor/deployment.yaml`       | Add `MASSIVE_API_KEY` env var; remove `ALPACA_*` env vars                                        |

### npm / pip packages

```bash
# price-processor (NestJS)
pnpm --filter @yana-stocks/price-processor add @polygon.io/client-js
pnpm --filter @yana-stocks/price-processor remove yahoo-finance2

# price-ingestor (Python — pyproject.toml)
# remove: alpaca-py, yfinance
# add:    polygon-api-client
```

The `@polygon.io/client-js` client uses `DefaultApi` + `Configuration` — not a
`polygonClient()` factory. Usage in `price-processor`:

```typescript
import { DefaultApi, Configuration } from '@polygon.io/client-js';

const api = new DefaultApi(new Configuration({ apiKey: massiveApiKey }));

// History (replaces Alpaca REST bars + Yahoo Finance daily)
const resp = await api.getStocksAggregates(
  symbol, // ticker
  1, // multiplier
  'minute', // timespan: 'minute' | 'day'
  fromDate, // YYYY-MM-DD
  toDate, // YYYY-MM-DD
  { limit: 50000, adjusted: true },
);
const bars = resp.data.results ?? [];

// Snapshot (replaces Yahoo Finance quote)
const snap = await api.getStocksSnapshotTicker(symbol);
const price = snap.data.ticker?.day?.c ?? null; // closing price
```

### Deployment

> Deploy `price-ingestor` and `price-processor` image tags in the same
> `k8s-apps` commit — the `RawPriceMessage` format change is a breaking
> wire-format change between these two services.

---

## Step 1 & 2 — Chart Rewrite: lightweight-charts + Volume Pane

Recharts (current) has no native candlestick support. Replace with TradingView's
open-source `lightweight-charts` for the stock detail chart only; keep Recharts
elsewhere (movers cards, portfolio).

### Install

```bash
pnpm --filter @yana-stocks/frontend add lightweight-charts@5
```

> Must install v5 specifically — `createSeriesMarkers()` and the pane layout API
> used below are v5-only. v4 has a different API and will fail at runtime.

### Replace `PriceChart.tsx` → `StockChart.tsx`

**New file:** `apps/frontend/src/components/charts/StockChart.tsx`

React component wrapping a `useRef`-mounted lightweight-charts chart instance.
ResizeObserver handles responsive sizing. Data flows in as props from the stock
page.

**Chart layout (stacked vertical panes):**

```
┌─────────────────────────────────────┐
│  Price pane (candlestick or area)   │  ~60% height
│  + MA overlays (line series)        │
├─────────────────────────────────────┤
│  Volume pane (histogram)            │  ~15% height — always shown
├─────────────────────────────────────┤
│  RSI pane (line + 70/30 lines)      │  ~12.5% (if enabled)
├─────────────────────────────────────┤
│  MACD pane (MACD + signal + hist)   │  ~12.5% (if enabled)
└─────────────────────────────────────┘
```

**Chart controls (rendered as React, outside the canvas):**

- Range buttons: 1H | 1D | 1W | 1M | 3M | 6M | 1Y (same as current)
- Chart type toggle: Line / Candlestick
- Indicator toggle panel: MA | RSI | MACD

**Deprecated:** `PriceChart.tsx` — remove after migration; update import in
`app/stocks/[symbol]/page.tsx`.

### Currency-aware price formatting

- UK stocks: price in pence (GBX) — format as `p` or convert to GBP
- US stocks: format as `$` (existing behaviour)
- Detect by `.L` suffix or `assetClass`

---

## Steps 3, 4, 5 — Momentum Indicators (computed on frontend, no new API)

All indicators computed from existing OHLCV close prices. No new endpoints
required.

### Technical indicator library

```bash
pnpm --filter @yana-stocks/frontend add technicalindicators
```

Use the `technicalindicators` npm package — a battle-tested TypeScript library.
Do not write indicator math from scratch.

```typescript
import { SMA, EMA, RSI, MACD } from 'technicalindicators';

// Example usage
const rsiValues = RSI.calculate({ period: 14, values: closes });
const macdResult = MACD.calculate({
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
  values: closes,
  SimpleMAOscillator: false,
  SimpleMASignal: false,
});
```

Null values for the warm-up period are handled natively by lightweight-charts
(gaps in series).

### Moving average overlays (Step 3)

When MAs enabled in `StockChart`:

- SMA 20 (blue), SMA 50 (orange), SMA 200 (purple) — user selects which
- EMA 12 / EMA 26 also available (used internally for MACD)
- Each rendered as a `LineSeries` on the main price pane

### RSI pane (Step 4)

When RSI enabled:

- Separate lightweight-charts pane
- RSI(14) as `LineSeries`
- Two `PriceLine`s at 70 (dashed red) and 30 (dashed green)
- Y-axis domain: 0–100

### MACD pane + buy/sell signal badges (Step 5)

When MACD enabled:

- MACD line (12/26/9 defaults) as `LineSeries`
- Signal line as `LineSeries`
- Histogram as `HistogramSeries` (green positive / red negative bars)

**Buy/sell signal badges** displayed in the chart header (derived from active
indicators, no new data):

| Signal            | Rule                           | Display                     |
| ----------------- | ------------------------------ | --------------------------- |
| Overbought (sell) | RSI > 70                       | Red badge on chart header   |
| Oversold (buy)    | RSI < 30                       | Green badge on chart header |
| Bullish momentum  | MACD crosses above signal line | Green arrow indicator       |
| Bearish momentum  | MACD crosses below signal line | Red arrow indicator         |
| MA crossover buy  | Fast MA crosses above slow MA  | Green arrow marker on chart |
| MA crossover sell | Fast MA crosses below slow MA  | Red arrow marker on chart   |

Badges are **grouped by `source+type`** with a `×N` count (e.g., `↓ MACD ×16`)
so the header never floods when a symbol has many historical crossovers. At most
6 badges can appear (buy+sell for each of: macd, rsi, ma-cross).

**Chart header layout (3-row):**

```
Row 1: [Price Chart] [↑ MACD ×10] [↓ MACD ×9] ...  |  [Line] [Candle]  (right-pinned)
Row 2: RANGE  [1H] [1D] [1W] [1M] [3M] [6M] [1Y]
Row 3: MA  [SMA20] [SMA50] ...  |  [RSI 14]  [MACD]
```

Line/Candle is pinned to the right of Row 1 via `ml-auto shrink-0` — position
does not shift as badge count changes.

**File:** `apps/frontend/src/lib/signals.ts`

```typescript
export interface ChartSignal {
  time: Time; // lightweight-charts Time (string date for daily, unix seconds for intraday)
  type: 'buy' | 'sell';
  source: 'ma-cross' | 'rsi' | 'macd';
  description: string;
}
```

Markers rendered via `createSeriesMarkers()` from lightweight-charts v5.

MA crossover pairs checked: EMA12/EMA26, SMA20/SMA50, SMA50/SMA200. Only pairs
where both MAs are currently enabled in the chart (or all four in
`SignalsPanel`) produce signals.

### Indicator selector UI

Floating control panel rendered above the chart:

```
[Line / Candle]   [MA ▾] [RSI] [MACD]
```

- MA dropdown: checkboxes for SMA20 / SMA50 / SMA200 / EMA12 / EMA26
- RSI, MACD: toggle buttons
- State in `useState` local to the chart component

### Signals sidebar update

**File:** `apps/frontend/src/components/signals/SignalsPanel.tsx`

- Current: ML prediction + FinBERT sentiment only
- Add a technical signals section: latest buy/sell signal per active indicator
- Colour coded: green buy / red sell; only most recent signal per source shown

### News markers on chart (no new data)

In `StockChart.tsx`, when news articles are loaded (query key `['news', symbol]`
shared with `NewsPanel` — no extra network request):

- Render small circle markers on the price series at each article's
  `publishedAt` date
- Colour by sentiment: green (positive), grey (neutral), red (negative)
- Daily ranges only — intraday minute-snapping is unreliable for article
  timestamps
- Markers are skipped for dates that have no price bar (weekends, holidays)
- **Not implemented:** floating headline overlay on hover — articles are
  readable in `NewsPanel` below the chart; hover overlay can be added later if
  needed

---

## Step 6 — Universal Watchlist `+` Button

The backend already has `POST /watchlists/:id/symbols` — this is purely a UI
change.

Add a `+` watchlist button to every place a ticker appears:

- `MarketBrowser` rows (see Step 7)
- `MoversCard` entries
- Stock page header
- Watchlist/portfolio tables (for adding to a different watchlist)

Unauthenticated users see a login prompt on click. Authenticated users always
get a dropdown to select which watchlist — even when only one exists. If no
watchlists exist yet, clicking `+` redirects to `/watchlist` to create one.

---

## Step 7 — ETFs + Market Browser

### ETF support in asset browser

**File:** `apps/portfolio-api/src/stocks/stocks.service.ts`

The Alpaca asset listing (`fetchFromAlpaca()`) is replaced. The Massive ticker
reference (`/v3/reference/tickers`) returns equities _and_ ETFs in one feed — no
parallel call needed. Filter by `type=CS` (common stock) or `type=ETF` when
building the curated lists.

```bash
# Add to portfolio-api
pnpm --filter @yana-stocks/portfolio-api add @polygon.io/client-js
```

```typescript
import { DefaultApi, Configuration } from '@polygon.io/client-js';

const api = new DefaultApi(new Configuration({ apiKey: massiveApiKey }));

// Replaces fetchFromAlpaca() entirely
// listTickers() paginates — call with cursor until next_url is absent
const resp = await api.listTickers({
  market: 'stocks',
  type: 'ETF', // or 'CS' for common stock
  active: true,
  limit: 1000,
});
const tickers = resp.data.results ?? [];
```

Add `MASSIVE_API_KEY` to `portfolio-api`'s ExternalSecret in `k8s-apps`.

Add `assetClass: 'us_equity' | 'us_etf' | 'uk_equity'` to `AssetEntry` and
`packages/shared-types/src/stock.ts`.

### Replace `StockBrowser.tsx` → `MarketBrowser.tsx`

The current "All Stocks" flat table of ~10,000 Alpaca assets is not aligned with
the new spec. Replace with a tabbed Market Browser:

```
[🇺🇸 US]  [🇬🇧 UK]  [ETFs]
```

- Each tab shows a curated, meaningful list (S&P 500 / FTSE 100 / major ETFs)
  not a raw dump
- Search still queries all assets when a term is typed
- Each row has a `+` watchlist button (Step 6)
- This is an interim screen until the full home screen with indices/sectors is
  built

**New files:**

- `apps/portfolio-api/src/stocks/us-curated-assets.ts` — S&P 500 constituents
- `apps/portfolio-api/src/stocks/uk-assets.ts` — FTSE 100 (populated from
  Step 9)

**Modified:** `GET /market/assets` — add optional `market` query param: `us` |
`uk` | `etf`

---

## Step 8 — Analyst Ratings (FMP) + News Consolidation

### Backend — `portfolio-api`: Analyst ratings

**New module:** `apps/portfolio-api/src/analyst/`

- `analyst.service.ts` — calls FMP
  `https://financialmodelingprep.com/api/v3/analyst-stock-recommendations/:symbol`
- `analyst.controller.ts` — `GET /stocks/:symbol/analyst`
- Returns: `{ strongBuy, buy, hold, sell, strongSell, priceTarget, consensus }`
- Redis cache: `papi:analyst:${symbol}`, 24h TTL
- New env var: `FMP_API_KEY`

### Backend — `sentiment-analyzer`: News consolidation

FMP News replaces Alpaca News. The FinBERT pipeline (`analyzer.py`,
`storage.py`, `kafka_producer.py`) is unchanged — only the news fetching layer
changes.

| File                                                                    | Action                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `services/sentiment-analyzer/src/sentiment_analyzer/news_client.py`     | **Delete** (AlpacaNewsClient)                                        |
| `services/sentiment-analyzer/src/sentiment_analyzer/fmp_news_client.py` | **Create** — FMP `/article/list?tickers={symbol}` client             |
| `services/sentiment-analyzer/src/sentiment_analyzer/config.py`          | Remove `alpaca_api_key`, `alpaca_api_secret`; add `fmp_api_key: str` |
| `services/sentiment-analyzer/src/sentiment_analyzer/worker.py`          | Replace `AlpacaNewsClient` import with `FmpNewsClient`               |
| `services/sentiment-analyzer/pyproject.toml`                            | Remove `alpaca-py` news dependency if present                        |

### k8s changes (`k8s-apps` repo)

- `FMP_API_KEY` ✓ already in Infisical at `/yana-stocks/FMP_API_KEY`
- Update `apps/yana-stocks/portfolio-api/external-secret.yaml` — add
  `FMP_API_KEY`
- Update `apps/yana-stocks/portfolio-api/deployment.yaml` — add `FMP_API_KEY`
  env var
- Update `apps/yana-stocks/sentiment-analyzer/external-secret.yaml` — add
  `FMP_API_KEY`, remove `ALPACA_API_KEY` and `ALPACA_API_SECRET`
- Update `apps/yana-stocks/sentiment-analyzer/deployment.yaml` — swap env vars
  accordingly
- No Kong change needed — `GET /stocks/:symbol/analyst` is covered by existing
  `/api/stocks/*` prefix route

### Frontend

**New file:** `apps/frontend/src/components/analyst/AnalystPanel.tsx`

- Proportional consensus bar (green = bullish, grey = hold, red = bearish)
- Counts: Strong Buy / Buy / Hold / Sell / Strong Sell
- Price target with % upside/downside from current price
- "as of X days ago" label when data is stale

Placed below `SignalsPanel` in the right column of the stock detail page.

---

## Step 9 — UK Data Pipeline + Location Defaults (Twelve Data)

### Data source: Twelve Data

Twelve Data provides an official REST API covering UK, EU, and international
markets (Grow plan).

New env var: `TWELVE_DATA_API_KEY`

### UK symbol detection

`price-processor` determines a symbol is UK/international by one of two signals:

1. Symbol has `.L` suffix (e.g., `BP.L`, `SHEL.L`) — standard London Stock
   Exchange format
2. The requesting client passes an explicit `exchange=LSE` query parameter

Twelve Data accepts `.L` suffixed symbols natively. Route any symbol matching
`/\.L$/` (or explicit `exchange=LSE`) to `TwelveDataService`; all others go to
the Massive path.

### Extend price-processor with Twelve Data adapter

**New file:** `apps/price-processor/src/prices/twelve-data.service.ts`

```typescript
// On-demand fetch of OHLCV history + current quote for non-Massive symbols.
// Calls Twelve Data REST API.
// Stores results in same MongoDB price_bars collection and Redis cache.
// Same OHLCV[] response shape as Massive data.
```

**Modified:** `apps/price-processor/src/prices/prices.service.ts`

- Detect UK/international symbol: `.L` suffix or `exchange=LSE` param
- Route to `TwelveDataService` instead of Massive on cache miss

```bash
pnpm --filter @yana-stocks/price-processor add twelvedata.js
```

### k8s changes (`k8s-apps` repo)

- `TWELVE_DATA_API_KEY` ✓ already in Infisical at
  `/yana-stocks/TWELVE_DATA_API_KEY`
- Update `apps/yana-stocks/price-processor/external-secret.yaml` — add
  `TWELVE_DATA_API_KEY`
- Update `apps/yana-stocks/price-processor/deployment.yaml` — add
  `TWELVE_DATA_API_KEY` env var

### Profile: market preference

**File:** `apps/profile-service/src/profile/schemas/profile.schema.ts`

```typescript
@Prop({ default: 'US' })
defaultMarket!: 'US' | 'UK' | 'global';
```

**Shared types:** Update `packages/shared-types/src/user.ts`.

**Frontend:** Add market preference dropdown to `ProfilePage.tsx` settings.

### Home screen market defaults

**File:** `apps/frontend/src/components/home/HomePageView.tsx`

- Read `profile.preferences.defaultMarket`
- Pass `market` param to `MarketBrowser` and movers API
- UK users see FTSE 100 by default; US users see S&P 500

---

## Steps 10 & 11 — Deferred (Future Phases)

### Step 10 — Home screen with indices & sectors

A proper home screen replacing `MarketBrowser`:

- Index performance cards (S&P 500, FTSE 100, Nasdaq, DAX)
- Sector breakdown within each index — risers/fallers by sector
- Index-level news feed
- Sector heat map using Recharts `Treemap` component (sectors as tiles, sized by
  market cap weight, coloured by performance)
- **Data:** FMP `/sector-performance` + Twelve Data for index values
- **New endpoint:** `GET /market/sectors` in portfolio-api

### Step 11 — Stock Screener

Filterable stock list by criteria: market cap, P/E ratio, volume, momentum
score, dividend yield.

- **New endpoint:** `GET /screener` in portfolio-api
- **Data:** FMP screening endpoint

---

---

## Step 12 — News Pin Markers with Headline Popup

News circle markers already exist on daily charts (coloured by sentiment,
implemented in Step 5 gap completions). This step upgrades them to show the
article headline when clicked.

### What changes

**No backend changes** — `GET /api/news/:symbol` is already called by the chart
component and the articles are already in memory.

### Frontend — `apps/frontend/src/components/charts/StockChart.tsx`

**Marker shape upgrade:**

```typescript
// Before
{
  shape: 'circle',
  size: 1,
}

// After — arrowDown acts as a downward-pointing pin above the bar
{
  shape: 'arrowDown',
  size: 1,
  text: articles.length > 1 ? `N:${articles.length}` : truncate(articles[0].title, 22),
}
```

**Article lookup map** — built once when `newsArticles` prop changes:

```typescript
const articlesByDate = useMemo(() => {
  const map = new Map<string, NewsArticle[]>();
  for (const a of newsArticles) {
    const d = a.publishedAt.slice(0, 10);
    map.set(d, [...(map.get(d) ?? []), a]);
  }
  return map;
}, [newsArticles]);
```

**Click subscriber** — added inside the chart `useEffect` after the chart is
created:

```typescript
chart.subscribeClick((param) => {
  if (!param.time) {
    setNewsPopup(null);
    return;
  }
  const date =
    typeof param.time === 'string'
      ? param.time
      : new Date(Number(param.time) * 1000).toISOString().slice(0, 10);
  const articles = articlesByDate.get(date);
  if (!articles?.length) {
    setNewsPopup(null);
    return;
  }
  // param.point gives pixel coordinates relative to the chart container
  setNewsPopup({ x: param.point!.x, y: param.point!.y, articles });
});
```

**Popup state + JSX** —
`newsPopup: { x: number; y: number; articles: NewsArticle[] } | null`

```tsx
{
  newsPopup && (
    <div
      className="absolute z-50 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
      style={{ left: newsPopup.x + 8, top: newsPopup.y - 8 }}
    >
      <button
        className="absolute right-2 top-2 text-gray-400"
        onClick={() => setNewsPopup(null)}
      >
        ✕
      </button>
      {newsPopup.articles.map((a, i) => (
        <div key={i} className={i > 0 ? 'mt-2 border-t pt-2' : ''}>
          <p className="text-sm font-medium text-gray-900 leading-snug">
            {a.title}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <span className={sentimentColour(a.sentimentLabel)}>
              {a.sentimentLabel}
            </span>
            <span>·</span>
            <span>{a.source}</span>
            <span>·</span>
            <span>{timeAgo(a.publishedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

Close the popup on outside click via a `useEffect` that adds/removes a
`document.addEventListener('click', ...)` when `newsPopup !== null`.

**Files changed:** `StockChart.tsx` only.

---

## Step 13 — Home Market Preference UI

The `profile-service` schema already has `defaultMarket: 'US' | 'UK' | 'global'`
(added in Step 9). The `PUT /api/profile/me` endpoint already accepts it. This
step adds the missing UI.

### Frontend — `apps/frontend/src/app/profile/page.tsx`

Add a "Home Market" select in the Profile settings tab, alongside the existing
displayName / bio fields:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700">Home Market</label>
  <select
    value={form.defaultMarket ?? 'US'}
    onChange={(e) =>
      setForm({
        ...form,
        defaultMarket: e.target.value as 'US' | 'UK' | 'global',
      })
    }
    className="mt-1 block w-48 rounded-md border border-gray-300 px-3 py-2 text-sm"
  >
    <option value="US">🇺🇸 United States (S&P 500)</option>
    <option value="UK">🇬🇧 United Kingdom (FTSE 100)</option>
    <option value="global">🌐 Global</option>
  </select>
  <p className="mt-1 text-xs text-gray-500">
    Sets the default index and market tab on the home screen.
  </p>
</div>
```

Include `defaultMarket` in the existing `PUT /api/profile/me` body — no new API
call needed.

### Frontend — `apps/frontend/src/components/home/HomePageView.tsx`

Read profile in `HomePageView` (already done for watchlist state — reuse the
same `useProfile()` query):

```typescript
const defaultTab = profile?.defaultMarket === 'UK' ? 'uk' : 'us';
```

Pass `defaultTab` to `<MarketBrowser defaultTab={defaultTab}>` and highlight the
matching index tile in `<IndicesBar activeMarket={defaultTab}>`.

**Files changed:** `profile/page.tsx`, `HomePageView.tsx`, `MarketBrowser.tsx`
(add `defaultTab` prop).

---

## Step 14 — Sector Rotation Time-Series Heatmap ✓ complete

Replaces the static S&P 500 treemap with a dual-view component: a **treemap
snapshot** (today's sector performance as market-cap-weighted squares) and a
**12-day history grid** (colour-coded daily % changes per sector). Users toggle
between views and switch between S&P 500 and FTSE 100.

> **Note:** The original plan described 5 time-window columns (1D/1W/1M/3M/1Y).
> The actual implementation uses 12 rolling daily % changes (1 change per bar
> for 12 trading days), which gives richer day-by-day rotation data. The treemap
> replaces the old `SectorHeatmap.tsx` treemap but also serves as the "Today"
> snapshot — it is not deleted.

### Data sources (as built)

| Index    | Source                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S&P 500  | FMP `/api/v3/historical-sectors-performance` — daily sector % changes for 13 days (12 deltas)                                                             |
| FTSE 100 | Twelve Data `/time_series` for 31 representative LSE stocks (2–3 per ICB sector), `outputsize=13` — compute daily % changes per stock, average per sector |

FMP returns empty for FTSE via LSE exchange; Polygon / Massive does not cover UK
markets — Twelve Data with `exchange=LSE` is the correct source.

### FTSE 100 stock basket (31 stocks, 11 ICB sectors)

| Sector           | Symbols (Twelve Data) |
| ---------------- | --------------------- |
| Technology       | SAGE, EXPN, HLMA      |
| Financials       | HSBA, LLOY, BARC      |
| Health Care      | AZN, GSK, HLN         |
| Consumer Disc.   | JD, MKS, CPG          |
| Industrials      | BA, RR, WEIR          |
| Comm. Services   | BT.A, VOD             |
| Consumer Staples | DGE, TSCO, BATS       |
| Energy           | BP, SHEL              |
| Real Estate      | SGRO, BLND, LAND      |
| Materials        | RIO, GLEN, AAL        |
| Utilities        | NG, SSE, SVT          |

> BT Group must be requested as `BT.A` — bare `BT` with `exchange=LSE` returns a
> 404 on Twelve Data.

### Response shape (as built)

```typescript
interface SectorRotationData {
  dates: string[]; // ISO date strings, 12 most recent trading days, chronological
  rows: SectorRotationRow[]; // one row per sector
}

interface SectorRotationRow {
  sector: string; // e.g. 'Technology', 'Consumer Disc.'
  changes: number[]; // daily % change per date, same length as dates[]
}
```

### Backend implementation

- **`getSectorRotation(index, cacheKey)`** in `stocks.service.ts`
- S&P 500: FMP `historical-sectors-performance` → 13 daily rows → 12 % changes
- FTSE 100: `Promise.allSettled` for 31 Twelve Data `/time_series?outputsize=13`
  calls → aggregate `sector → date → avg(changes)` → sort chronologically → keep
  last 12 dates
- Falls back to `{ dates: [], rows: [] }` on total failure (no API key, all
  requests fail)
- Redis cache: `papi:sector:rotation:sp500` / `papi:sector:rotation:ftse100`,
  TTL 1h

### Frontend — `SectorRotationHeatmap.tsx`

- **Today view** (default): Recharts `<Treemap>` with `CustomContent` SVG
  renderer; cell size = market-cap weight; colour = last column's % change
  - `SP500_WEIGHTS` and `FTSE_WEIGHTS` maps defined for both indices
  - S&P 500 today falls back to `/market/overview` sectors when rotation data
    absent
  - Custom SVG: `rx=8` rounded corners, gradient overlay (white 18% → black
    12%), sector name + % change at two font sizes
- **History view**: 12-column colour-coded table matching the old heatmap style
- **Toggle**: `[Today] [History]` segmented pill + `[S&P 500] [FTSE 100]`
  buttons
- staleTime: 1 hour (matches cache TTL)

### k8s changes (`k8s-apps` repo)

- `apps/yana-stocks/portfolio-api/external-secret.yaml` — added
  `TWELVE_DATA_API_KEY` entry
- `apps/yana-stocks/portfolio-api/deployment.yaml` — added `TWELVE_DATA_API_KEY`
  env var

**Files changed/created:**

| File                                                           | Action                                            |
| -------------------------------------------------------------- | ------------------------------------------------- |
| `apps/portfolio-api/src/stocks/stocks.service.ts`              | Added `getFtse100SectorRotation()` private method |
| `apps/portfolio-api/src/config/configuration.ts`               | Added `twelveDataApiKey`                          |
| `apps/portfolio-api/.env`                                      | Added `TWELVE_DATA_API_KEY` (gitignored)          |
| `apps/frontend/src/components/home/SectorRotationHeatmap.tsx`  | Rewritten: treemap + history toggle               |
| `k8s-apps/apps/yana-stocks/portfolio-api/external-secret.yaml` | Added `TWELVE_DATA_API_KEY`                       |
| `k8s-apps/apps/yana-stocks/portfolio-api/deployment.yaml`      | Added `TWELVE_DATA_API_KEY` env var               |

---

## Step 15 — Factor Performance Tiles

Shows which investment style (factor) is currently winning. Uses widely-held
factor ETFs as proxies — these are normal tickers, so no new data source is
needed.

### Factor → ETF proxy mapping

| Factor         | ETF  | What it tracks                   |
| -------------- | ---- | -------------------------------- |
| Momentum       | MTUM | iShares MSCI USA Momentum Factor |
| Value          | VTV  | Vanguard Value ETF               |
| Growth         | VUG  | Vanguard Growth ETF              |
| Dividend       | VIG  | Vanguard Dividend Appreciation   |
| Low Volatility | USMV | iShares MSCI USA Min Vol         |
| Quality        | QUAL | iShares MSCI USA Quality Factor  |

All six trade on US exchanges and flow through the existing Massive price
pipeline. No new data source or API key.

### Backend — `portfolio-api`

**New method** `getFactorPerformance()` in `market.service.ts`:

```typescript
const FACTOR_ETFS = [
  { factor: 'Momentum', etf: 'MTUM' },
  { factor: 'Value', etf: 'VTV' },
  { factor: 'Growth', etf: 'VUG' },
  { factor: 'Dividend', etf: 'VIG' },
  { factor: 'Low Volatility', etf: 'USMV' },
  { factor: 'Quality', etf: 'QUAL' },
];
```

- Batch-fetch quotes via Massive snapshot API (same code path used by
  `getMovers()` — `mget` Redis keys `papi:price:*`, fallback to Polygon snapshot
  for cache misses)
- For 1W and 1M returns: fetch 21-day OHLCV history per ETF from price-processor
  (`GET /stocks/:symbol/history?interval=1d&limit=22`);
  `change1w = (close[0] - close[4]) / close[4]`,
  `change1m = (close[0] - close[20]) / close[20]`
- Redis cache: `papi:factors`, TTL 15min

**Response shape:**

```typescript
interface FactorTile {
  factor: string; // 'Momentum'
  etf: string; // 'MTUM'
  price: number;
  change1d: number; // % as decimal
  change1w: number;
  change1m: number;
}
```

**New route** in `market.controller.ts`:

```typescript
@Get('factors')
getFactorPerformance() {
  return this.marketService.getFactorPerformance();
}
```

Kong: covered by `/api/market/*` — no manifest change.

### Frontend

**New file** `apps/frontend/src/components/home/FactorTiles.tsx`:

- Timeframe toggle: `[1D]` / `[1W]` / `[1M]` — controls which change column is
  shown as the primary value and which is used for sort order (best first)
- 6 cards in a horizontal scrollable row:

  ```
  ┌──────────────────┐
  │  Momentum        │
  │  MTUM            │
  │  +2.34%  ▲       │  ← primary value (selected timeframe, coloured)
  │  1W +1.1% 1M +4% │  ← secondary values
  └──────────────────┘
  ```

- Each card has a `title` attribute with a one-line description of the factor
  (shown as native browser tooltip on hover — no extra component needed)
- Cards sorted best-to-worst by the selected timeframe — winner is always first
- Green/red colouring consistent with the rest of the app (`text-green-600` /
  `text-red-600`)
- Query:
  `useQuery({ queryKey: ['factors'], queryFn: () => apiFetch('/market/factors'), staleTime: 15 * 60 * 1000 })`

**Update** `apps/frontend/src/components/home/HomePageView.tsx`:

Add `<FactorTiles />` between `<IndicesBar>` and `<SectorRotationHeatmap>`.

**Files changed/created:**

| File                                                 | Action                          |
| ---------------------------------------------------- | ------------------------------- |
| `apps/portfolio-api/src/market/market.service.ts`    | Add `getFactorPerformance()`    |
| `apps/portfolio-api/src/market/market.controller.ts` | Add `GET /market/factors` route |
| `apps/frontend/src/components/home/FactorTiles.tsx`  | New component                   |
| `apps/frontend/src/components/home/HomePageView.tsx` | Add `<FactorTiles />`           |
| `packages/shared-types/src/market.ts`                | Add `FactorTile` interface      |
