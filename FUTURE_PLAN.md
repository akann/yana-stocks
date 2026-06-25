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
| UK / international prices        | **Twelve Data**                          | Free (800 req/day) | Official REST API covering UK, EU, global markets; on-demand only (no streaming needed)                                         |
| News (all markets)               | **Financial Modeling Prep (FMP)**        | Free (250 req/day) | Single provider for US + international; finance-specific; same key as analyst ratings                                           |
| Analyst ratings + price targets  | **FMP** `/analyst-stock-recommendations` | Free (250 req/day) | Ratings, consensus, price targets                                                                                               |
| Sector performance               | **FMP** `/sector-performance`            | Free (250 req/day) | Same account, no extra key                                                                                                      |
| Index values (^FTSE, ^GSPC etc.) | **Twelve Data**                          | Free (800 req/day) | Covers major global indices                                                                                                     |

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

| Key                   | Service                                        | Used by                                                                                                        | Infisical path                     | Status         |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------- |
| `MASSIVE_API_KEY`     | Massive (formerly Polygon.io) Starter ($29/mo) | `price-ingestor` (WebSocket), `price-processor` (REST history + snapshots), `portfolio-api` (ticker reference) | `/yana-stocks/MASSIVE_API_KEY`     | ✓ in Infisical |
| `FMP_API_KEY`         | Financial Modeling Prep (free)                 | `portfolio-api` (analyst ratings, sector performance), `sentiment-analyzer` (news)                             | `/yana-stocks/FMP_API_KEY`         | ✓ in Infisical |
| `TWELVE_DATA_API_KEY` | Twelve Data (free, 800 req/day)                | `price-processor` (UK/international on-demand history + quotes)                                                | `/yana-stocks/TWELVE_DATA_API_KEY` | ✓ in Infisical |

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

---

## Implementation Order

Sequenced to deliver value early, deferring items that need new integrations:

| #   | Feature                                                               | Effort  | New data source?                                     | Status     |
| --- | --------------------------------------------------------------------- | ------- | ---------------------------------------------------- | ---------- |
| 0   | **Massive migration** — replace Alpaca + Yahoo Finance for US prices  | Medium  | Massive/Polygon.io ($29/mo)                          | ✓ complete |
| 1   | Candlestick chart (switch to lightweight-charts)                      | Medium  | No                                                   | ✓ complete |
| 2   | Volume histogram pane below price chart                               | Low     | No                                                   | ✓ complete |
| 3   | Moving average overlays (SMA/EMA)                                     | Low     | No                                                   | ✓ complete |
| 4   | RSI sub-chart                                                         | Medium  | No                                                   | **next**   |
| 5   | MACD sub-chart + buy/sell signal badges                               | Medium  | No                                                   | pending    |
| 6   | Watchlist `+` button across all ticker appearances                    | Low     | No — backend already exists                          | pending    |
| 7   | ETF support in asset browser                                          | Trivial | No — Massive ticker reference includes ETFs natively | pending    |
| 8   | Analyst ratings (FMP) + news consolidation (FMP replaces Alpaca News) | Medium  | Financial Modeling Prep                              | pending    |
| 9   | Location-specific defaults + UK data (Twelve Data)                    | Medium  | Twelve Data                                          | pending    |
| 10  | Home screen with indices & sectors                                    | High    | FMP + Twelve Data                                    | pending    |
| 11  | Stock screener                                                        | High    | FMP + Twelve Data                                    | pending    |

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

**New file:** `apps/frontend/src/lib/signals.ts`

```typescript
export interface ChartSignal {
  time: number;
  type: 'buy' | 'sell';
  source: 'ma-cross' | 'rsi' | 'macd';
  description: string;
}
```

Markers rendered via `createSeriesMarkers()` from lightweight-charts v5.

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

In `StockChart.tsx`, when news articles are loaded (already fetched on the stock
detail page):

- Render small flag markers on the x-axis at each article's `publishedAt`
  timestamp
- Colour by sentiment: green (positive), grey (neutral), red (negative)
- Hover/click shows headline in a floating React DOM overlay

---

## Step 6 — Universal Watchlist `+` Button

The backend already has `POST /watchlists/:id/symbols` — this is purely a UI
change.

Add a `+` watchlist button to every place a ticker appears:

- `MarketBrowser` rows (see Step 7)
- `MoversCard` entries
- Stock page header
- Watchlist/portfolio tables (for adding to a different watchlist)

Unauthenticated users see a login prompt on click. Authenticated users with
multiple watchlists get a small dropdown to select which one.

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
markets. Free tier: 800 requests/day.

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

## Out of Scope Until Above is Complete

- **Index rotation / factor analysis** — money flow between sectors and factors
  (growth vs value, high-dividend vs speculative); requires sector
  classification data
- **Full universal watchlist button** on every ticker mention — partially
  addressed in Step 6; deeper integration (stock page, movers, screener results)
  follows naturally as each feature is built
