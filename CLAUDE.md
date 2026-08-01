# yana-stocks — Claude Code Instructions

## Project Overview

`yana-stocks` is a production-grade microservices application for real-time
stock market data, portfolio management, sentiment analysis, and ML-based price
prediction. It runs on a self-hosted Kubernetes cluster managed via ArgoCD
GitOps.

## Monorepo Structure

Turborepo + pnpm workspaces.

```shell
yana-stocks/
├── apps/
│   ├── frontend/              # Next.js 16 (App Router)
│   ├── auth-service/          # Go (Chi) — JWT auth, email verification, refresh tokens
│   ├── profile-service/       # NestJS — non-PII display data (MongoDB)
│   ├── price-processor/       # NestJS
│   ├── portfolio-service/     # NestJS
│   ├── portfolio-api/         # NestJS
│   ├── api-docs/              # Static nginx — Swagger UI index (index.html + nginx.conf + Dockerfile)
│   └── e2e/                   # Playwright
├── services/
│   ├── price-ingestor/        # Python (standalone)
│   ├── sentiment-analyzer/    # Python (standalone)
│   └── ml-predictor/          # Python (standalone)
├── packages/
│   ├── shared-types/          # TypeScript interfaces
│   ├── shared-dto/            # Shared validation DTOs
│   ├── kafka-client/          # Kafka config + topic definitions
│   ├── typescript-config/     # Shared tsconfig bases
│   ├── eslint-config/         # Shared ESLint config
│   └── prettier-config/       # Shared Prettier config
├── k8s/                       # Per-service Kubernetes manifests
├── docker-compose.yml         # Local dev infrastructure
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Tech Stack

### auth-service (Go)

- Router: Chi
- DB driver: pgx (PostgreSQL)
- Migrations: golang-migrate (runs at startup)
- JWT: HS256, `iss: 'yana-stocks'`, 15min access token
- Refresh tokens: opaque, Redis, 7d TTL, rotated on use
- Kafka: `segmentio/kafka-go` — publishes `users.registered` event on
  registration
- Email: POSTs to `shared-services`' `email-api` (Kong, key-auth) — no longer
  talks to SMTP2GO directly

### NestJS Services

- Framework: NestJS (latest)
- MongoDB ORM: Mongoose via `@nestjs/mongoose`
- Redis: ioredis
- Kafka: plain `kafkajs` (each app's own
  `kafka-consumer.service.ts`/`kafka-producer.service.ts` — not
  `@nestjs/microservices`' `ClientKafka`)
- Validation: `class-validator` + `class-transformer`
- Auth: `@nestjs/jwt` + `@nestjs/passport`
- Docs: `@nestjs/swagger`
- Config: `@nestjs/config`

### Frontend

- Next.js 16 (App Router)
- TailwindCSS
- Recharts (charts)
- TanStack Query (data fetching)
- No Vite — Next.js uses Turbopack

### Python Services

- Python 3.12
- FastAPI (HTTP endpoints where needed)
- HuggingFace `transformers` + FinBERT (sentiment-analyzer)
- Facebook Prophet + scikit-learn (ml-predictor)
- confluent-kafka or aiokafka (Kafka client)
- PyMongo (MongoDB)

### Testing

- Jest (unit + integration) for NestJS
- pytest for Python
- Playwright (E2E) in `apps/e2e/`
- Page Object Model pattern for Playwright

## Services

### 1. price-ingestor (Python)

- **Purpose:** Consume Massive (Polygon.io) WebSocket feed for real-time stock
  prices, publish to Kafka
- **Kafka producer:** `stocks.prices.raw`
- **Data source:** Massive (Polygon.io) Starter plan — `starterfeed.polygon.io`
  WebSocket, `AM.*` minute aggregates (push). Replaced Alpaca + Yahoo Finance —
  see Build Order Step 0 and the Data Sources section below
- **Pattern:** standard Deployment, fixed at 1 replica — no autoscaler (verified
  2026-07-26 against the live `k8s-apps` manifests; no `keda-scaledobject.yaml`
  exists for this service, unlike sentiment-analyzer/price-processor/
  profile-service/portfolio-service/portfolio-api)
- **No DB** — pure producer

### 2. price-processor (NestJS)

- **Purpose:** Consume raw prices, store OHLCV history, cache latest price
- **Kafka consumer:** `stocks.prices.raw`
- **Kafka producer:** `stocks.prices.processed`
- **MongoDB:** OHLCV price history
- **Redis:** Latest price cache (TTL 5s)
- **Pattern:** KEDA ScaledObject (scale 1→3 on `stocks.prices.raw` lag,
  threshold 100; min 1 — serves HTTP history/quote requests outside trading
  hours)
- **External-API reliability (2026-07-31):** every Massive/Polygon and Twelve
  Data call (`prices.service.ts`, `twelve-data.service.ts`) is wrapped in a
  per-provider `opossum` circuit breaker
  (`src/common/external-api-breakers.service.ts`) instead of called directly — a
  `massive` breaker and a `twelvedata` breaker, each fed by every call site for
  that provider. Breaker events emit
  `external_api_requests_total{provider,outcome}` /
  `external_api_circuit_state{provider}` (same names as portfolio-api's, so one
  PrometheusRule covers both — see `k8s-apps`' `UPDATES.md` 2026-07-31 for the
  new alert). Polygon's aggregates response envelope is also shape-validated
  (`class-validator`/`class-transformer`, already this repo's DTO convention)
  before use — a renamed/retyped `results` field throws into the _same_
  catch/fallback path a network error already takes, rather than silently
  resolving to an empty history via `?? []`.

### 3. sentiment-analyzer (Python)

- **Purpose:** Consume news feed, run FinBERT NLP, publish sentiment signals
- **Kafka producer:** `stocks.signals.sentiment`
- **MongoDB:** Store articles + sentiment scores
- **Pattern:** KEDA ScaledObject, triggers on `stocks.prices.processed` lag,
  threshold 100, `minReplicaCount: 0` — the only service in this stack that
  actually scales to zero
- **Model:** `ProsusAI/finbert` from HuggingFace
- **News source:** FMP `/stable/news/stock`, one request per symbol per poll
  (deliberately not batched — see 2026-07-23 fix below). Tracked symbols =
  `DEFAULT_SYMBOLS` baseline (~30 tickers across sectors, `config.py`) unioned
  with whatever any user actually holds/watches (read directly from the shared
  `yana_stocks` Mongo's `portfolios`/`watchlists` collections — same DB
  portfolio-service owns, confirmed same `MONGODB_URI` in both services' k8s
  secrets). `worker.select_symbols_for_poll` round-robins the baseline through a
  fixed `max_symbols_per_poll` (default 50, raised 2026-07-24 from the original
  10 — this project is on FMP's **Starter** plan, ~300 req/min with no daily
  cap, not the free tier's 250/day the original number was sized for; 50
  comfortably covers the whole ~30-ticker baseline every cycle) each cycle so a
  much larger tracked universe still can't burst past the per-minute limit; its
  one call site (`fmp_news_client.py`) is wrapped in a `pybreaker`
  `CircuitBreaker` (2026-07-31) whose success/failure/state-change events emit
  the same-named `external_api_requests_total`/`external_api_circuit_state`
  metrics as the Node services (see price-processor's entry above), and each raw
  article is validated against a small `FmpArticle` Pydantic model before use —
  a field FMP silently renames or retypes is now caught and counted as
  `invalid_shape` instead of resolving to `""` unnoticed, closing the gap that
  let the 2026-07-23 FMP-deprecation incident below go undetected for a while;
  user-held/watched symbols always get a fresh fetch every cycle.

### 4. ml-predictor (Python)

- **Purpose:** Price prediction using LSTM/Prophet, serve via REST + Kafka
- **Kafka producer:** `stocks.signals.prediction`
- **MongoDB:** Store predictions
- **MinIO:** Store trained model artifacts (`yana-stocks-models` bucket)
- **Pattern:** Argo Rollouts canary (10%→50%→100% on new model version)
- **REST:** `/api/predict/:symbol`
- **Symbol coverage (2026-07-23):** same fix as sentiment-analyzer's — tracked
  symbols = `DEFAULT_SYMBOLS` baseline (~30 tickers across sectors, `config.py`)
  unioned with whatever any user actually holds/watches (read directly from the
  shared `yana_stocks` Mongo's `portfolios`/`watchlists` collections, confirmed
  same `MONGODB_URI` as portfolio-service). No rotation/budget cap needed here
  unlike sentiment-analyzer — training reads our own already-collected price
  history, not a rate-limited external API, so the only cost is our own compute,
  which comfortably trains this many small Prophet models within the hourly
  refresh interval.
- **On-demand tracking (2026-07-29):** `POST /api/track/:symbol` — internal-only
  (no Kong route, not on any public Ingress), called fire-and-forget by
  `portfolio-api`'s `StocksService.ensureTracking()` when a symbol is added to a
  portfolio/watchlist or first visited with no cached prediction yet.
  Cache-first (`force_train=False`, unlike the hourly `refresh_all()`'s
  `force_train=True`) — trains only if no MinIO model exists yet for that
  symbol. Relies entirely on `price-processor` already having backfilled
  `price_bars` for the symbol (`ensureTracking` triggers that first); if fewer
  than 10 daily bars exist yet, `track_symbol()` logs and returns `False` rather
  than failing — the next hourly `refresh_all()` will pick it up once enough
  history exists. Added to close a real gap: a genuinely new symbol previously
  had zero predictions for up to an hour after being added (the poll interval),
  and would never get one at all until someone happened to visit its chart (the
  only thing that triggered `price-processor`'s on-demand history backfill).

### 5. auth-service (Go)

- **Purpose:** User registration, email verification, login, JWT issuance,
  refresh token rotation, password reset, account deletion
- **PostgreSQL (CNPG):** `auth-service-pg` cluster — `users` table (id, email,
  passwordHash, isVerified, verificationToken). Cluster uses CNPG defaults for
  owner/credentials; `postInitSQL` creates the `auth` schema and sets
  `search_path = auth` on the app role. Migrations run at pod startup via
  golang-migrate (no initContainer).
- **Redis:** Refresh token store (key `refresh:<token>` → userId, 7d TTL);
  password reset store (key `password_reset:<token>` → userId, 1h TTL,
  single-use)
- **JWT:** HS256 access token 15min (stateless), opaque refresh token 7 days
  (Redis, revocable)
- **Refresh token rotation:** New refresh token on every use; old one deleted
- **`iss` claim:** All JWTs include `iss: 'yana-stocks'` — Kong matches this to
  the HS256 credential
- **Dev port:** 3004; prod port: 3000
- **Endpoints:**
  - `POST /api/auth/register` — creates user, sends verification email,
    publishes `users.registered` Kafka event
  - `POST /api/auth/verify` — activates account via token from email
  - `POST /api/auth/login` — returns `{ accessToken, refreshToken }`
  - `POST /api/auth/refresh` — rotates refresh token
  - `POST /api/auth/logout` — deletes refresh token from Redis
  - `GET /api/auth/me` — decodes Bearer token (no signature check — Kong
    validates upstream)
  - `POST /api/auth/password/reset-request` — sends reset email (always 200, no
    email enumeration); public route (cors only, no JWT)
  - `POST /api/auth/password/reset` — validates Redis token, updates password
    hash, deletes token; public route (cors only, no JWT)
  - `PUT /api/auth/password` — change password (JWT required)
  - `DELETE /api/auth/account` — delete account and all data (JWT required)
  - `GET /api/auth/mfa` — get MFA enabled status (JWT required)
  - `POST /api/auth/mfa/setup` — generate TOTP secret (JWT required)
  - `POST /api/auth/mfa/enable` — verify TOTP code and activate MFA (JWT
    required)
  - `DELETE /api/auth/mfa` — disable MFA (JWT required)
  - `POST /api/auth/mfa/verify` — complete MFA login with TOTP code (public)

### 5b. profile-service (NestJS)

- **Purpose:** Non-PII user display data — displayName, avatar, bio, preferences
- **MongoDB:** `profiles` collection (userId, displayName, avatarUrl, bio,
  preferences)
- **Kafka consumer:** `users.registered` — creates initial profile on new
  registration
- **Pattern:** KEDA ScaledObject (scale 1→3 on `users.registered` lag, threshold
  100; min 1 — profile must exist immediately post-registration)
- **Dev port:** 3007; prod port: 3000
- **Endpoints:**
  - `GET /api/profile/me` — current user's profile (requires JWT)
  - `PUT /api/profile/me` — update profile (requires JWT)
  - `GET /api/profile/:userId` — public profile by userId

### 6. portfolio-service (NestJS)

- **Purpose:** Portfolio and watchlist management, trade history
- **MongoDB:** Portfolios, watchlists, trades
- **Kafka consumer:** `stocks.prices.processed` (for portfolio valuation) only.
  The KEDA `ScaledObject` previously also had a `users.registered` trigger, but
  the app never actually subscribed to that topic (no `consumer.subscribe()`
  call anywhere in `kafka-consumer.service.ts`), so it could never reflect real
  lag — removed 2026-07-23 rather than left as misleading infra.
- **Kafka producer:** none — consume-only since 2026-07-24. The
  `stocks.portfolio.events` producer (same "wired at the infra layer, never
  finished in code" shape as the KEDA trigger above) was removed entirely after
  confirming nothing anywhere consumed it: `KafkaProducerService` +
  `emitPortfolioEvent` call sites, the `CurrentUser` param decorator that
  existed only to stamp `userId` on those events, the
  `PortfolioEventType`/`PortfolioEventMessage` shared types, the
  `PORTFOLIO_EVENTS` topic constant, and the Strimzi `KafkaTopic` CR in
  `k8s-apps`.
- **Pattern:** KEDA ScaledObject (scale 1→3, triggers on
  `stocks.prices.processed` lag only; min 1 — serves HTTP traffic)
- **Endpoints:**
  - `GET/POST /portfolios`
  - `GET/PUT/DELETE /portfolios/:id`
  - `POST /portfolios/:id/stocks`
  - `POST /portfolios/:id/stocks/batch` — add up to 50 holdings in one call
    (2026-07-31, `AddStocksBatchDto` in `@yana-stocks/shared-dto`). Shares
    `addStock`'s underlying logic — `PortfoliosService.addStock` now just calls
    `addStocks(id, [dto])`, and `addStocks` does one `findByIdForMutation`, N
    in-memory mutations, one `doc.save()`, and one
    `TradeRepository.recordMany()` (bulk insert). **Deliberately not
    transactional** — `docker-compose.yml`'s `mongo:8` runs standalone (no
    `--replSet`), and the pre-existing single-item `addStock` was already
    non-transactional (save then a separate trade insert, no rollback if the
    second write fails) — batch staying consistent with that is more honest than
    making batch atomic while single-item isn't.
  - `GET/POST /watchlists`
  - `GET /trades`

### 7. portfolio-api (NestJS)

- **Purpose:** REST aggregator — combines prices, signals, predictions
- **Redis:** Cache aggregated responses (TTL 10s)
- **Pattern:** KEDA ScaledObject (scale 1→3, triggers on
  `stocks.prices.processed` + `stocks.signals.sentiment` +
  `stocks.signals.prediction` lag; min 1 — serves HTTP traffic)
- **External-API reliability (2026-07-31):** every FMP/Massive/Twelve Data call
  in `stocks.service.ts`/`analyst.service.ts` is routed through
  `src/common/external-api-breakers.service.ts` (one `opossum` breaker per
  provider — `fmp`/`massive`/`twelvedata` — not per call site), instead of
  hitting `HttpService` directly. Prompted by a code-review question on how
  external outages are handled — investigation found solid timeouts/fallback
  caching already, but zero failure metric anywhere and no response-shape
  validation, confirmed against the real FMP-deprecation incident below that
  went undetected for a while. Breaker events emit
  `external_api_requests_total{provider,outcome}`/
  `external_api_circuit_state{provider}` in `metrics.ts`
  (0=closed/0.5=half-open/1=open); `k8s-apps`' `ExternalApiCircuitOpen`
  PrometheusRule alerts on the gauge (see its `UPDATES.md`, 2026-07-31). FMP
  news and the Polygon asset-pagination response (the two spots with real
  incident history) are also shape-validated via
  `class-validator`/`class-transformer` — a renamed/retyped field is caught and
  counted as `invalid_shape`, falling through to the exact same fallback path a
  network error already takes rather than silently resolving to
  `undefined`/`NaN`.
- **Endpoints:**
  - `GET /stocks/:symbol` — price + sentiment + prediction (JWT required)
  - `GET /stocks/:symbol/history` — OHLCV history (JWT required)
  - `GET /signals/:symbol` — latest signals (JWT required)
  - `GET /market/movers?top=N` — top gainers/losers (public)
  - `GET /market/overview` — index quotes, sector performance, market news
    (public)
  - `GET /market/screener` — filter US stocks by market cap, volume, dividend
    yield, sector (public)
  - `GET /market/assets?search=&page=&limit=&market=us|etf|uk|all` — browse
    tradable assets with search and pagination; `market=all` merges US
    equities + ETF + UK and deduplicates by symbol (public)
- **Instant tracking (2026-07-29):** `StocksService.ensureTracking(symbol)` —
  best-effort, fire-and-forget (`void`-called, never awaited by its callers,
  never throws). Backfills price history via `price-processor`'s existing
  on-demand history endpoint, then calls `ml-predictor`'s new
  `POST /api/track/:symbol`. Guarded by a short-TTL (90s) Redis NX lock
  (`papi:tracking-inflight:<symbol>`, `RedisService.setNx()`) so a burst of
  concurrent requests for the same symbol doesn't fire duplicate work — a Redis
  outage degrades to "always attempt" rather than "never fire." Three call
  sites, all in `PortfolioProxyController`/`StocksController`, not inside
  `StocksService.getStock()` itself (that's also called internally by
  `getMovers()` for every `DEFAULT_SYMBOLS` baseline ticker, which don't need
  this — they're already covered by ml-predictor's hourly refresh):
  1. `addStock`/`addWatchlistSymbol` — after `assertKnownSymbol` passes.
  2. `createWatchlist` (`POST /watchlists` with an initial `symbols[]`) — this
     path previously fell through to the catch-all proxy with **zero**
     validation or tracking; now validated the same as the other two.
  3. `StocksController.getStock` — only when the aggregated response has no
     cached `prediction`, i.e. a real page visit for a symbol nobody's tracked
     yet.

  **Deliberate scope limit:** sentiment/news are _not_ touched by
  `ensureTracking` — `sentiment-analyzer` stays on its existing 5-min poll (see
  its CLAUDE.md section), which already gives held/watched symbols a fresh fetch
  on the very next cycle. That means sentiment/news only go instant via the
  _add_ path (once a symbol is actually in `portfolios`/`watchlists`, which
  `sentiment-analyzer` reads directly); a bare `/stocks/:symbol` visit with no
  add gets instant predictions but not instant sentiment/news, since
  `sentiment-analyzer` has no way to discover a merely-viewed symbol at all.

  **Async request-reply pattern — assessed, deliberately not built
  (2026-07-31):** an API-design-pattern review asked whether long-running work
  like `ensureTracking`/ml-predictor's `track_symbol` should return `202` +
  `Location: /jobs/:id` for polling. Checked and found unnecessary: every call
  site already fires this `void`-style with no caller waiting, and the
  frontend's `GET /stocks/:symbol` query already polls every 10s
  (`refetchInterval: 10_000`), so a missing prediction self-heals with no
  client-visible "processing" state today. Building a job store now would solve
  a problem nothing currently has — revisit only if a genuinely slow,
  directly-user-awaited operation is added later.

- **Idempotency-Key support (2026-07-31):** `PortfolioProxyController`'s
  mutating routes (`addStock`, `addStocksBatch`, `addWatchlistSymbol`,
  `createWatchlist`) accept an optional `Idempotency-Key` header via
  `@Idempotent()` (`src/common/idempotent.decorator.ts` +
  `idempotency.interceptor.ts`) — opt-in, so a request with no header behaves
  exactly as before. Implemented here rather than in `portfolio-service` because
  `portfolio-service` has no Redis at all (confirmed, Mongo-only) while this app
  already has `RedisService` for other caching. Key format:
  `papi:idem:<jwt sub>:<method>:<path>:<key>`; stores a sha256 hash of the
  request body so the same key reused with a **different** body gets a `422`
  rather than silently replaying a stale response for a different payload; an
  in-flight duplicate gets `409`; a genuine replay returns the original cached
  `{status, body}` verbatim with an `Idempotent-Replay: true` header, without
  re-running the handler (so `ensureTracking` isn't re-fired on a retry).
  Required `forward()` to change from writing the response and returning `void`
  to also returning `{ status, body }` — Nest ignores a `@Res()` handler's
  return value for the actual HTTP response, but the interceptor chain still
  sees it.

  **Why HTTP, not Kafka:** `portfolio-service` previously had a Kafka producer
  (`stocks.portfolio.events`) for portfolio/watchlist changes, deleted entirely
  on 2026-07-24 because no consumer ever subscribed to it — "wired at the infra
  layer, never finished in code" (see Known Bugs Fixed-adjacent history in
  `portfolio-service`'s section above). Reusing that shape here was rejected in
  favor of plain fire-and-forget HTTP calls, which carry no orphaned-infra risk
  and need no new `KafkaTopic` CR.

### 8. frontend (Next.js 16)

- **Purpose:** Dashboard UI
- **Routes:**
  - `/` — market overview, top movers (public)
  - `/login`, `/register`, `/verify` — auth pages (public)
  - `/forgot-password` — request password reset email (public)
  - `/reset-password?token=...` — set new password via emailed token (public)
  - `/dashboard` — user portfolio summary (auth required)
  - `/stocks/:symbol` — price chart, signals, prediction (auth required)
  - `/portfolio` — portfolio management (auth required)
  - `/watchlist` — watchlist (auth required)
  - `/profile` — account settings: Profile / Change password / Delete account
    tabs (auth required)
- **URL:** `https://stocks.yanatech.co.uk`
- **API access:** the browser only ever calls this app's own origin —
  `src/app/api/[...path]/route.ts` (a BFF) resolves and forwards to the real
  backend, attaching `Authorization` from the httpOnly `access_token` cookie
  server-side (see the 2026-07-31 auth-cookie-migration entry below).
- **Navbar:** `src/components/Navbar.tsx` — `sticky top-0 z-50` (stays fixed on
  scroll). Contains `SymbolSearch` component: debounced (250ms) autocomplete
  input that queries `GET /market/assets?market=all`, shows 8 results in a
  dropdown with keyboard navigation (↑↓ Enter Escape), navigates to
  `/stocks/:symbol` on selection. Hidden on mobile (`hidden md:block`).
- **Homepage layout** (`HomePageView.tsx`): `IndicesBar` → `SectorHeatmap` +
  `MarketNews` (side-by-side, both fixed at 350px height with internal scroll) →
  `MoversCard` → tabbed `MarketBrowser` / `StockScreener`.
- **SEO:** Uses Next.js 16 native `Metadata` API (not next-seo — redundant in
  App Router). Root `layout.tsx` sets site-wide metadata: title template
  (`%s | YanaStocks`), description, keywords, `authors`/`creator` (Akan
  Nkweini), OpenGraph site config, robots. `app/page.tsx` is a server component
  that exports page-specific `alternates.canonical` and OG url; client logic
  lives in `src/components/home/HomePageView.tsx`.
- **metadataBase:** `https://stocks.yanatech.co.uk` — all relative canonical
  URLs resolve against this.
- **CSP is set in `src/proxy.ts`** (nonce + `'strict-dynamic'`, per-request) —
  **not** `apps/frontend/proxy.ts`. This app uses the `src/` directory
  convention (`src/app/`), and Next.js silently ignores a `proxy.ts` placed at
  the project root in that layout: no error, `next build`'s route table just
  never shows a `ƒ Proxy (Middleware)` line and no CSP header is ever sent.
  `next.config.mjs`'s `headers()` still sets the other, non-nonce security
  headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
  Permissions-Policy). Every page is forced dynamic via a single
  `export const dynamic = 'force-dynamic'` in `src/app/layout.tsx` (cascades to
  all routes) since `Providers`/`Navbar`/`CookieBanner` are all client
  components rendered in the root layout, so every route needs JS to hydrate.
  One allowance this app needed that `akan`/`yanatech` didn't: `img-src`
  includes `https:` (not just `'self' data:'`) because `profile-service`'s
  `avatar` field is a free-form user-supplied external URL with no host
  allowlist. Unlike `akan`/`yanatech` (which had a CSP that silently broke
  hydration), this app had **no CSP at all** before this fix — added
  proactively, not because something broke. See
  `[[project_nextjs_csp_nonce_gotchas]]` memory for the full incident history
  across all four apps. **`connect-src` simplified 2026-07-31:** now just
  `'self' https://*.ingest.de.sentry.io` (Sentry's EU-region ingest host,
  matching `NEXT_PUBLIC_SENTRY_DSN`) — no more per-environment
  `NEXT_PUBLIC_API_URL` computation. Before the auth-cookie migration below, the
  browser called `api-gateway.yanatech.co.uk` directly in prod but a local port
  in CI with no gateway in front, so `connect-src` had to derive the right
  origin at request time from `NEXT_PUBLIC_API_URL` — getting that wrong once (a
  hardcoded prod-only value) silently CSP-blocked every auth fetch in CI and
  failed every login e2e test (`toBeVisible`/`waitForURL` timeouts, same symptom
  as a real hydration break, but the actual cause was `connect-src` not
  `script-src`). Now that the browser only ever calls this app's own origin,
  that whole class of environment-dependent CSP bug is structurally gone, not
  just fixed.
- **Real SSR + ISR-style data caching for the homepage** (2026-07-22):
  `force-dynamic` on every route (above) only disables _static generation_ — it
  doesn't stop server-side data fetching. `app/page.tsx` is now an async Server
  Component that prefetches the homepage's above-the-fold **public** endpoints
  (`market/overview`, `market/movers`, `market/factors`,
  `market/sectors/rotation?index=sp500` — none behind `UserFromTokenGuard`)
  server-side via `src/lib/server-api.ts`'s `fetchPublicMarketData()`, using
  `fetch(..., { next: { revalidate } })` for Next's Data Cache (real ISR
  semantics — shared, periodically-refreshed cache — even though the page itself
  can't be statically generated), then hydrates a **per-request** `QueryClient`
  (`dehydrate`/`HydrationBoundary`) so `IndicesBar`, `FactorTiles`,
  `MoversCard`, and `SectorRotationHeatmap`'s default S&P 500 view render real
  data in the initial HTML instead of a skeleton — verified by `curl`ing the
  prod build with JS disabled and finding the market data already present in the
  raw response. Never reuse the client-side `src/lib/ query-client.ts` singleton
  for this — it's one instance for the whole Node.js server process, so
  prefetching into it would leak one user's data into another's response.
  `server-api.ts` resolves an absolute API origin itself via
  `src/lib/bff/upstream.ts`'s `resolveUpstream()` (same helper the BFF proxy
  uses — `API_GATEWAY_URL` in prod, per-service dev URLs otherwise) because
  server-side `fetch` — unlike the browser — has no implicit origin to resolve a
  relative `/api/*` path against. `MarketBrowser`/`StockScreener` (the tabbed
  section below the fold, only one visible at a time) are now `next/dynamic`
  imports to keep their JS out of the homepage's main bundle. Server-side auth
  redirects for `/dashboard`/`/portfolio`/`/watchlist`/`/stocks/*`/`/profile`
  **are now done** (2026-07-31, see below) — `proxy.ts` gates these on the
  `access_token` cookie's presence before the page even renders; the client-side
  `useEffect` + `router.replace('/login')` guards remain as defense-in-depth but
  rarely fire now.
- **Auth tokens moved from sessionStorage to httpOnly cookies (2026-07-31):**
  fixes an XSS-exposed storage layer (`sessionStorage` is JS-readable) without
  needing any change to `auth-service`, Kong, or any other backend service — all
  of them independently trust `Authorization: Bearer <token>` read straight off
  the request, and Kong's `jwt` plugin doesn't re-attach a cookie-extracted
  token as a header for upstream services even if it could read one from a
  cookie (unconfirmed either way against the live schema). Instead, this app
  became a thin **BFF**: the browser now only ever calls its own origin, and
  `src/app/api/[...path]/route.ts` is the _only_ thing that ever sees the
  httpOnly cookie — it reads it server-side and attaches `Authorization: Bearer`
  on a server-to-server call to Kong (`API_GATEWAY_URL` in prod) or the local
  service URLs in dev (`src/lib/bff/upstream.ts`, replacing `next.config.mjs`'s
  old dev-only `rewrites()`, which is now deleted entirely).
  - **Cookies:** `access_token` (`Path=/`, 15min) and `refresh_token`
    (`Path=/api` — not `/api/auth`, since the proxy's own refresh-retry at e.g.
    `/api/stocks/...` needs it too), both httpOnly, `Secure` in production,
    `SameSite=Lax`, host-only (no `Domain` attribute — scoped to
    `stocks.yanatech.co.uk` only, deliberately not shared with other
    `*.yanatech.co.uk` subdomains in this cluster). `src/lib/bff/cookies.ts`.
  - **Server-side 401-refresh-retry:** on a 401, the catch-all proxy reads
    `refresh_token`, calls auth-service's `/refresh`, retries the original
    request once with the new access token — all invisible to the client.
    `src/lib/bff/refresh.ts` dedupes concurrent refreshes for the _same_ refresh
    token (it's single-use/rotated server-side — without this, several
    concurrent 401s would each try to rotate it, and all but the first would
    hard-fail a valid session) via an in-process `Map` keyed by token hash, plus
    a ~10s "recently rotated" cache so a request holding an already-consumed
    token still resolves correctly. Per-replica — fine today (frontend is a
    fixed-replica Deployment); would need `sessionAffinity: ClientIP` if that
    ever changes, or the fallback is just a spurious re-login, not a correctness
    bug.
  - **CSRF:** zero protection existed anywhere in the stack before this — and
    httpOnly cookies auto-attach (a bearer token in JS never did). The proxy
    rejects (403) any non-GET/HEAD request whose `Origin` header is present and
    doesn't match its own origin, alongside `SameSite=Lax`.
  - **`AuthContext.tsx`/`lib/api.ts`:** both lost their token-handling entirely
    — no more `sessionStorage`, no more client-side retry-on-401 (the BFF
    already tried). This also deleted a real bug: `lib/api.ts` had its own
    **second, independent** token-refresh implementation
    (`isRefreshing`/`failedQueue`), completely unaware of `AuthContext.tsx`'s
    equivalent — both are gone now, replaced by the one server-side
    implementation above. `isAuthenticated` is now derived by calling
    `GET /api/auth/me` on mount (200 vs 401) rather than checking for a
    JS-readable token, since there isn't one anymore.
  - **`proxy.ts` auth gate:** presence-check only (no JWT verification, no
    `JWT_SECRET` in the frontend) — redirects to `/login` if `access_token` is
    absent on a protected route. Pure UX optimization (no flash of protected
    content); real enforcement is unchanged (Kong's signature check + each
    service's guard). This closed a real gap found while investigating:
    `/stocks/[symbol]` had **no** client-side auth guard at all before this — it
    relied entirely on an API 401 plus `lib/api.ts`'s hard redirect.
  - **CI gotcha (2026-07-31, same-day as the migration)**: the first real CI run
    after this landed didn't fail fast — `e2e-tests` crawled for 40+ minutes on
    the chromium project alone (vs. ~5 min historically) before being manually
    cancelled. Root cause, confirmed live by `kubectl exec`ing into the
    self-hosted runner pod mid-run and reading `/proc/<pid>/environ` for the
    running `next-server` process:
    `AUTH_SERVICE_URL`/`PROFILE_SERVICE_URL`/`PORTFOLIO_API_URL` were unset at
    runtime, even though `.github/workflows/ci.yml`'s "Write frontend
    .env.local" step writes them. The standalone `server.js`
    (`output: "standalone"`, needed for the same reason as the Dockerfile) loads
    env files relative to **its own** directory
    (`.next/standalone/apps/frontend/`), not the source `apps/frontend/` the
    file was written to — and "Assemble frontend standalone server" only copies
    `static/`/`public/` in, never `.env.local`. So `resolveUpstream()` silently
    fell back to its dev defaults (`auth`→3004, else→3006), neither of which
    matches this job's real ports (auth-service=3001, portfolio-api=3004,
    portfolio-service=3003) — every BFF-proxied request outside `auth`/`profile`
    hit `localhost:3006`, where nothing listens, and `frontend.log` was
    wall-to-wall `ECONNREFUSED`. Each affected e2e test then burned its full 60s
    timeout × 3 attempts (1 + 2 CI retries) instead of failing fast, which is
    what actually produced the multi-hour crawl rather than a fast, obvious
    failure. Fixed by passing those three vars explicitly on the "Start backend
    services" step's frontend launch line, the same way
    `PORT`/`HOSTNAME`/`E2E_TEST_MODE` already are — more robust than trying to
    get `.env.local` copied into the standalone output. `.env.local` is still
    written and still needed for the **build** step (it's read there to inline
    `NEXT_PUBLIC_WS_URL`), so that step stays; only the runtime services need
    the explicit env on the launch line.
  - **e2e fixture gotcha, same day, found once the CI wiring above was fixed**:
    with real backend connectivity restored, `e2e-tests` still failed — 112 of
    189 tests, everything touching a now-protected route
    (`/dashboard`/`/portfolio`/`/watchlist`/`/stocks/*`/`/profile`). Root cause:
    the migration rewrote route-gating to check the real httpOnly `access_token`
    cookie (`proxy.ts`, `AuthContext.tsx`), but the e2e mock fixtures were never
    updated — `apps/e2e/src/fixtures/api-mocks.ts`'s `setupAuthSession()` and
    `apps/e2e/src/fixtures/base.fixture.ts`'s `seedAuth()` (used by
    `setupStockMocks()`) both still seeded `sessionStorage`, which nothing in
    the app reads anymore. Same root cause also broke the login-redirect test
    directly: it mocked `POST /api/auth/login` via `page.route()`, which
    intercepts the request before it ever reaches the real route handler that
    calls `setAuthCookies()` — so the redirect to `/dashboard` bounced straight
    back to `/login`. Fixed by switching both helpers to
    `page.context().addCookies(...)` (matching `cookies.ts`'s real names/paths:
    `access_token` at `/`, `refresh_token` at `/api`) and making the login-route
    mock set those cookies itself plus return the real `{ mfaRequired }` shape
    instead of the pre-migration `{ accessToken, refreshToken }` body. One test
    in `market.spec.ts`
    (`clicking a UK stock link navigates to /stocks/HSBA.L...`) had never called
    any of these helpers at all and needed `setupAuthSession()` added outright.
    **Cookie gotcha within the fix itself**: Playwright's `addCookies()` rejects
    `url` + `path` together ("Cookie should have either url or path") — caught
    by actually running the suite locally
    (`pnpm --filter @yana-stocks/frontend dev` +
    `playwright test <spec> --project=chromium` against it) before pushing a
    second time, not by reasoning alone; fixed by using `domain` (the `BASE_URL`
    hostname) + `path` instead. That same local run also surfaced that the
    homepage's real server-side data prefetch (see the SSR/ISR note above) needs
    `E2E_TEST_MODE=true` set on the dev server to skip — without it,
    `page.route()` client-side mocks don't cover the SSR-rendered initial HTML
    at all, producing flaky-looking mismatches unrelated to any real bug. 51/52
    previously-broken chromium tests passed after the fix; the one remaining
    failure (`MarketBrowser › search with no match shows empty state message`)
    reproduces identically on the pre-fix commit too — pre-existing flakiness,
    not a regression, root-caused and fixed 2026-08-01 below.
- **`.fill()` silently no-ops on controlled inputs, mobile-safari project only
  (root-caused and fixed 2026-08-01):** the
  `search with no match shows empty state message` test above (and a second,
  same-shape one,
  `Navbar symbol search uppercases and navigates to /stocks/:SYMBOL on Enter`)
  intermittently failed in CI on `mobile-safari` — previously assumed to be
  "pre-existing debounce-timing flakiness" (see above), which turned out to be
  wrong. Actually root-caused via a real local reproduction (a standalone
  `next build`/`next start` run, matching CI, not `next dev` — dev mode adds its
  own unrelated React Strict Mode double-mount noise that has to be ruled out
  first) plus direct instrumentation: a plain
  `element.addEventListener('input', ...)` attached straight to the DOM node
  confirmed that Playwright's `.fill('ZZZZ')`, on the `mobile-safari` (WebKit)
  project only, sets the input's DOM `.value` directly but never dispatches a
  real `input` event for these two specific inputs — so React's `onChange` (and
  therefore `setSearch`/`setQuery`) never fires, the query for the typed value
  never goes out, and the controlled input's value silently reverts to empty on
  the next unrelated re-render. Confirmed as a test/automation-layer gap, not an
  app bug: `MarketBrowser.tsx`/`SymbolSearch.tsx` are both ordinary controlled
  inputs, and switching the test from `.fill()` to `.click()` +
  `.pressSequentially()` (real per-keystroke key events, which WebKit reliably
  turns into genuine `input` events) fixed both tests deterministically —
  verified 12+ repeats clean on both `chromium` and `mobile-safari`, in both
  `next dev` and a real standalone prod build. No
  `MarketBrowser.tsx`/`SymbolSearch.tsx` changes were needed or made.
- **Lighthouse CI** (2026-07-22, upgraded to a real server 2026-07-22):
  `pnpm --filter @yana-stocks/frontend lighthouse`
  (`apps/frontend/lighthouserc.json`, `@lhci/cli`) runs Lighthouse 3x against
  `http://localhost:3000/` with the `desktop` preset (chosen over
  mobile-throttled to reduce noise on the self-hosted runner's shared CPU, and
  because this dashboard is realistically desktop-first). Wired into
  `.github/workflows/ci.yml`'s `e2e-tests` job, right after "Wait for all
  services to be ready" and before seeding/Playwright — measures the clean,
  unseeded public homepage. Needs a real Chrome installed first since the
  self-hosted ARC runner has none (Playwright's cached Chromium from the e2e
  steps isn't used — lhci needs a real Chrome/Chromium via `CHROME_PATH`, not
  Playwright's managed binary) — see the CI gotcha below for how that's
  installed and why. Assertions (`categories:performance` ≥ 0.8, LCP ≤ 2500ms,
  CLS ≤ 0.1, TBT ≤ 300ms) are `warn`-level, not `error` — intentionally
  non-blocking until there's a real baseline of runs on this runner to know
  what's actual regression vs. CI noise; tighten to `error` once that exists.
  Locally against a production build this scored 97-100/100 performance,
  ~0.85-1.2s LCP, 0.000 CLS — confirms the SSR/ISR change above is working, not
  just theoretically correct.
  - **Real server, not filesystem/temporary-public-storage**: `upload.target` is
    `"lhci"` pointing at a self-hosted server, `apps/lighthouse-ci` in
    `k8s-apps` (`patrickhulce/lhci-server`, PVC+SQLite, no CNPG — see that
    repo's CLAUDE.md), at `https://lighthouse.yanatech.co.uk/`. `filesystem`
    (the original setup) can't post a GitHub commit status at all —
    `runGithubStatusCheck` in `@lhci/cli`'s `upload.js` is only ever called from
    the `lhci`/`temporary-public-storage` target branches, confirmed by reading
    the source, not assumed — a token would've been a silent no-op under
    `filesystem`. `temporary-public-storage` was rejected because it uploads
    full HTML reports to a public, unauthenticated Google-hosted URL.
  - **HTTP Basic Auth, not Authentik**: the server needs to be usable by both
    CI's automated upload (no browser, can't do an SSO login flow) and a human
    clicking the link Lighthouse CI posts on the commit status. `@lhci/server`
    has basic auth built in for exactly this; Authentik's SSO flow doesn't
    cleanly support a non-browser caller without extra per-path bypass config.
    One shared credential (`LHCI_BASIC_AUTH_USERNAME`/ `PASSWORD` — both a
    GitHub Actions secret _and_ the k8s-apps Infisical
    `/lighthouse-ci/BASIC_AUTH_USERNAME`+`PASSWORD`, kept in sync manually —
    there's no bridge between the two secret stores) works for both. **TODO,
    revisit**: switch to a split-Ingress setup — one Ingress for `/v1/*` (LHCI's
    API, all CI actually calls) with no auth annotations, a second for
    everything else (`/app/*`, the UI) with the normal Authentik outpost
    annotations (same 5-step pattern as uptime-kuma). Gets per-user SSO + audit
    trail for the human-facing dashboard, matching this cluster's usual
    convention, while leaving CI's API calls ungated (the build token still
    gates what CI can write). Needs an Authentik Provider/Application created
    first — that's a manual step in Authentik's own admin console, not
    scriptable from here.
  - **Secrets are passed via `LHCI_UPLOAD__*` env vars** in the CI step, not
    committed to `lighthouserc.json`: `LHCI_UPLOAD__TOKEN` (the LHCI project
    build token, minted once via `POST /v1/projects` against the live server —
    not re-creatable from git, if lost create a new project),
    `LHCI_UPLOAD__BASIC_AUTH__USERNAME`/`PASSWORD`, `LHCI_UPLOAD__GITHUB_TOKEN`
    (the built-in `secrets.GITHUB_TOKEN`, not `GH_PAT` — this only needs to
    write a status to this same repo). The double-underscore nesting
    (`LHCI_UPLOAD__BASIC_AUTH__USERNAME` → `upload.basicAuth.username`) is
    `@lhci/cli`'s own env-var convention for `autorun`'s per-command option
    merging — verified working locally against the real server before
    committing, not assumed. The job also needs
    `permissions: {contents: read, statuses: write}` (job-level permissions
    replace, not merge with, the workflow-level `contents: read`) for the
    status-check POST to not 403.
  - `upload.ignoreDuplicateBuildFailure: true` — LHCI server keys a build by git
    commit SHA; a second upload attempt for the same commit (e.g. a workflow
    re-run) 422s otherwise. Confirmed this doesn't fail the overall
    `pnpm test:lh` exit code even without the flag (`autorun`'s
    `failOnUploadFailure` isn't set), but it's a clean, zero-cost fix for
    exactly this case.
  - **Known non-issue, extensively investigated 2026-07-22**: an intermittent
    `Minified React error #418` (hydration mismatch) shows up in
    `errors-in-console` specifically on Lighthouse's 2nd/3rd run within one
    `numberOfRuns: 3` invocation (1st is always clean) — never once reproduced
    across many manual repeated navigations in a real browser. Ruled out with
    direct evidence, not guesses: live market data ticking (curled
    `portfolio-api` 5x over 5s, byte-identical), `next/dynamic` on
    `MarketBrowser`/`StockScreener` (reverted to static imports, rebuilt,
    identical failure pattern), and Next's Data Cache serving stale SSR data
    (diffed raw SSR HTML across cold/warm requests, byte-identical). Most likely
    a client-side timing/scheduling sensitivity specific to Lighthouse's own
    Chrome instance across repeated runs — not pursued further given it's
    `warn`-level, doesn't affect real users, and doesn't move the actual scores.
  - **`pnpm audit`/Trivy CI gates, 2026-07-22**: pushing this work surfaced two
    pre-existing, repo-wide gates that would have blocked _any_ push to `main`
    right now, confirmed by re-running both against the commit this work
    branched from (before any of it existed) — not caused by this work.
    `pnpm-workspace.yaml`'s `auditConfig` now overrides `tmp`/`shell-quote`
    (introduced by `@lhci/cli`/`concurrently`, genuinely new, fixed),
    `brace-expansion`/`fast-uri` (pre-existing, safe leaf-utility overrides),
    and ignore-lists `js-yaml`(v4, via eslint)/
    `@opentelemetry/propagator-jaeger`(shared across 5 services)/`sharp`(Next's
    image binary) as too risky to blind-override — each with its own documented
    reason. **Real bug found doing this**: the field is
    `auditConfig.ignoreGhsas`, not `ignoreCves` — silently renamed upstream in a
    pnpm major; the repo's pre-existing `ignoreCves` entry never actually
    suppressed anything (its one CVE happened to be below the
    `--audit-level=high` gate, so nobody noticed). **Still open**: CI's separate
    `trivy-image-scan` job doesn't read `pnpm-workspace.yaml` at all (needs its
    own `.trivyignore` for the same 3 ignore-listed CVEs) and separately flags
    unrelated pre-existing CVEs in `auth-service`'s `go.sum` (grpc) and
    `ml-predictor`'s `uv.lock` (pillow) — decision on how to handle those
    pending, see `project_yana_stocks_ci_security_gates_2026-07-22` memory for
    full detail. `trivy-image-scan` runs before `docker`/`gitops` in the
    workflow graph, so this failure mode never risks an actual bad deploy —
    worst case CI just doesn't finish.
  - **Lighthouse's Chrome install, real-CI debugging saga, 2026-07-22**: first
    real run hit `CHROME_INTERSTITIAL_ERROR` on every attempt despite curl
    confirming the frontend was already serving — traced to
    `browser-actions/setup-chrome@v1`'s default `chrome-version: latest`
    silently pulling a raw, unvetted Chromium continuous-build snapshot from
    `chromium-browser-snapshots`, not a tested release. Switching to
    `chrome-version: stable` then failed hard (`ar: command not found` — that
    path downloads Chrome's real `.deb` and manually unpacks it), which took the
    whole `e2e-tests` job down since that step had no `continue-on-error` —
    fixed both by adding it and installing `binutils`. The very next run failed
    again one layer deeper (`tar` exit code 2 on the `.deb`'s inner archive —
    this minimal runner image was also missing proper `xz`/`zstd` support for
    `tar` to lean on). Rather than keep chasing that action's opaque unpacking
    dependencies one CI cycle at a time, replaced it entirely with a direct apt
    install of real `google-chrome-stable` (same conditional-install + apt
    keyring pattern already proven for `docker-ce-cli` a few steps earlier in
    this same job) — apt/dpkg handles a `.deb`'s internal compression correctly
    by definition, sidestepping the whole class of failure. `CHROME_PATH` is now
    the fixed `/usr/bin/google-chrome-stable` instead of a `steps.<id>.outputs`
    value.
  - **LHCI upload secrets were never actually set, 2026-07-23**: despite the
    upload code path being built and documented as working, `LHCI_TOKEN`/
    `LHCI_BASIC_AUTH_USERNAME`/`LHCI_BASIC_AUTH_PASSWORD` didn't exist as GitHub
    Actions secrets on this repo at all — every real CI run failed the upload
    step with "Must provide token for LHCI target" (non-blocking,
    `continue-on-error`, so silently doing nothing rather than failing loudly).
    Fixed by locating the values in Infisical (`k8s-homelab` project,
    `/lighthouse-ci/` folder — note the Infisical key names have **no** `LHCI_`
    prefix, only the GitHub secret names do) and adding them via
    `gh secret set`. First real end-to-end upload confirmed working same day:
    reports land at `lighthouse.yanatech.co.uk`, GitHub commit status posts.
  - **First real Lighthouse report surfaced 2 genuine findings** (both fixed
    2026-07-23): a WCAG AA contrast failure (`text-gray-400` on white ≈ 2.85:1,
    needs 4.5:1 — 3 occurrences in `SectorRotationHeatmap.tsx` fixed to
    `text-gray-500` ≈ 4.83:1, matching the pattern `MarketNews`'s "No news
    available" already used) and ~176 KiB of unused JS on the homepage. Root
    cause of the second: `recharts` (imported nowhere else in the app, confirmed
    via `next experimental-analyze` — installed as `@next/bundle-analyzer`,
    wired in behind `ANALYZE=true`, zero cost otherwise; Turbopack builds aren't
    compatible with it, use `next build --webpack` or
    `next experimental-analyze` instead) plus its transitive deps
    (`d3-scale`/`d3-shape`/`d3-color`, `redux-toolkit`, `immer`, `es-toolkit`)
    were being loaded on every homepage request even when
    `SectorRotationHeatmap` has nothing to plot (the CI scan's unseeded DB
    state). **First fix attempt didn't actually work** — wrapping `TreemapView`
    in `next/dynamic()` looked right and passed all local checks, but the very
    next real Lighthouse run (checked via the LHCI server's own API,
    `GET /v1/projects/{id}/builds/{id}/runs`, since the dashboard/compare UI
    wasn't showing enough detail reliably) still showed ~174 KiB unused JS, just
    under different chunk hashes. Root cause: `next/dynamic`'s default
    `ssr:true` still emits a required `<script src=... async>` tag for the chunk
    in every SSR response regardless of whether that branch renders at runtime —
    Next's SSR pass conservatively includes any dynamically-imported module
    reachable in the tree, since it can't statically know a client-side
    data-dependent conditional (`view === 'today'`, the default) won't take that
    branch. Real fix needed two changes together: the treemap-emptiness check
    (`computeSectorTreeData`, recharts-free, moved to
    `src/lib/sectorTreemapData.ts`) had to move to the _parent_
    (`SectorRotationHeatmap`) so it runs _before_ deciding whether to mount
    `<TreemapView>` at all — otherwise the "no data" render still lives inside
    the dynamically-imported component and still triggers loading it — **and**
    `ssr: false` on the `dynamic()` call itself, since `ssr:true`'s
    conservative-inclusion behavior ignores runtime conditionals regardless of
    where the emptiness check lives. Verified for real this time: built a
    production server, ran it standalone with no backend (genuinely empty data),
    curled the homepage HTML and grepped for the chunk containing
    `redux-toolkit`/`immer`/`d3-scale` — zero matches; loaded it in a real
    browser afterward and confirmed zero network requests for that chunk even
    after hydration fully settles. **Trade-off accepted knowingly**: when there
    IS real sector data, the treemap now needs a client-side round-trip to
    hydrate instead of painting synchronously in the SSR HTML the way the rest
    of the homepage's SSR/ISR-prefetched sections do (see the SSR/ISR note
    above) — regresses that specific, previously-verified goal for this one
    section, in exchange for the no-data case (what Lighthouse CI actually
    measures, deliberately, per its own "clean, unseeded homepage" design note)
    no longer loading ~273 KiB it never uses.

### 9. api-docs (static nginx)

- **Purpose:** Internal Swagger UI hub at `https://api-docs.yanatech.co.uk`
  (Authentik-protected)
- **Source:** `apps/api-docs/` — `index.html` + `nginx.conf` + `Dockerfile`
- **Serves:** Per-service OpenAPI pages for portfolio-api, portfolio-service,
  profile-service, price-processor, auth-service
- **Build:** Multi-stage Dockerfile:
  - Go stage (`auth-spec-builder`): installs `swaggo/swag`, runs `swag init` on
    auth-service to emit `swagger.json`
  - Node stage (`spec-builder`): runs `nest build` + `generate-openapi.js` for
    each NestJS service to emit per-service OpenAPI JSON
  - Node stage (`docs-builder`): `@redocly/cli@2.35.1` builds static HTML per
    service
  - `nginx:alpine` serves the HTML files
- **NestJS Swagger plugin:** All NestJS services use `nest build` (not plain
  `tsc`) so the `@nestjs/swagger` AST plugin auto-infers request body schemas.
  Response schemas use `@ApiOkResponse({ type: SomeClass })` on all controllers.
- **auth-service Swagger:** Uses `swaggo/swag` comment annotations in
  `internal/handler/auth.go` and `swagger_types.go` for typed request/response
  structs; `BearerAuth` security definition for JWT-protected endpoints
- **Local dev:** Available at `http://localhost:3009` via docker-compose
  (`pull_policy: build` — auto-rebuilds on every `docker:up`)
- **No backend** — pure static files, health check at `GET /health → 200 ok`

### 11. e2e (Playwright)

- **Purpose:** End-to-end tests
- **Coverage:** Auth flows (register/verify/login/logout), portfolio CRUD, stock
  data display
- **Config:** Chromium + iPhone 14 (mobile); `webServer` config auto-starts
  Next.js dev server
- **Pattern:** Page Object Model; API layer mocked per-test via `page.route()`
- **Run:** `pnpm --filter e2e test:e2e` (installs browsers with
  `playwright install` on first run)

## Kafka Topics

| Topic                       | API version         | Partitions | Retention | Producer           | Consumer(s)                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------- | ---------- | --------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users.registered`          | kafka.strimzi.io/v1 | 3          | 7d        | auth-service       | profile-service                                                                                                                                                                                                                                                                           |
| `stocks.prices.raw`         | kafka.strimzi.io/v1 | 3          | 24h       | price-ingestor     | price-processor                                                                                                                                                                                                                                                                           |
| `stocks.prices.processed`   | kafka.strimzi.io/v1 | 3          | 7d        | price-processor    | portfolio-api (verified 2026-07-23 — `ml-predictor` has no Kafka consumer anywhere in its code; it reads price history directly from the shared MongoDB, same as its own symbol-selection logic. The table previously said `ml-predictor, portfolio-api`, which was never actually true.) |
| `stocks.signals.sentiment`  | kafka.strimzi.io/v1 | 3          | 7d        | sentiment-analyzer | portfolio-api                                                                                                                                                                                                                                                                             |
| `stocks.signals.prediction` | kafka.strimzi.io/v1 | 3          | 7d        | ml-predictor       | portfolio-api                                                                                                                                                                                                                                                                             |

(`stocks.portfolio.events` — previously produced by `portfolio-service` with no
consumer anywhere — was removed entirely 2026-07-24: producer code, shared
types, topic constant, and the `KafkaTopic` CR in `k8s-apps`.)

**Kafka broker:** `kafka-cluster-kafka-bootstrap.kafka.svc.cluster.local:9092`

## Auth Flow

```shell
POST /api/auth/register
  → auth-service creates user (passwordHash via bcrypt), sends verification email (via shared-services' email-api)
  → publishes users.registered event to Kafka → profile-service creates initial profile
  → returns { message }

POST /api/auth/verify
  → auth-service activates account, clears verificationToken
  → returns { message }

POST /api/auth/login
  → auth-service validates email+password, checks isVerified
  → returns { accessToken (HS256 JWT 15min, iss:'yana-stocks'), refreshToken (opaque 7d) }
  → refreshToken stored in Redis as refresh:<token> → userId

POST /api/auth/refresh
  → validates refreshToken in Redis
  → issues new accessToken + new refreshToken (rotation)
  → old refreshToken deleted from Redis

POST /api/auth/logout
  → deletes refreshToken from Redis

POST /api/auth/password/reset-request
  → always returns 200 (no email enumeration)
  → if email exists: stores password_reset:<token> → userId in Redis (1h TTL), sends email

POST /api/auth/password/reset
  → validates token in Redis, updates bcrypt hash, deletes token (single-use)
  → returns 400 with ErrInvalidToken for expired/unknown tokens

Kong JWT plugin (key_claim_name: iss):
  → reads iss claim from JWT
  → looks up KongConsumer (auth-service) credential with key: "yana-stocks"
  → verifies HS256 signature using JWT_SECRET from Infisical
```

## Kong Routes (k8s-apps repo)

**Rate limiting (2026-07-31):** every route below now also carries a
`rate-limiting` plugin — `rate-limiting-public` (60/min) on public routes,
`rate-limiting` (300/min) on JWT-protected ones, both IP-scoped (no per-end-user
`KongConsumer` registry exists — the one `KongConsumer` here is `auth-service`
itself, for JWT issuance). `policy: redis` against the shared cluster Redis
(Kong is DB-less, ruling out the `cluster` policy; `local` would count
per-Kong-replica independently, silently scaling the effective limit with
replica count). See `k8s-apps`'
`apps/yana-stocks/kong/kongplugin-rate-limiting*.yaml`.

```shell
# Public auth routes (rate-limiting-public + cors)
/api/auth/register                  → auth-service:3000    (Exact)
/api/auth/verify                    → auth-service:3000    (Exact)
/api/auth/login                     → auth-service:3000    (Exact)
/api/auth/refresh                   → auth-service:3000    (Exact)
/api/auth/logout                    → auth-service:3000    (Exact)
/api/auth/password/reset-request    → auth-service:3000    (Exact)
/api/auth/password/reset            → auth-service:3000    (Exact)

# JWT-protected auth routes (jwt-auth+rate-limiting+cors)
/api/auth/me        → auth-service:3000    (Exact — jwt-auth+rate-limiting+cors)
/api/auth/password  → auth-service:3000    (Exact — change password)
/api/auth/account   → auth-service:3000    (Exact — delete account)

# JWT-protected profile routes
/api/profile/*      → profile-service:3000 (Prefix, jwt-auth+rate-limiting+cors)

# Public API routes
/api/market/*       → portfolio-api:3000   (Prefix, rate-limiting-public+cors — shown on unauthenticated homepage)

# JWT-protected API routes
/api/stocks/*       → portfolio-api:3000   (Prefix, jwt-auth+rate-limiting+cors)
/api/signals/*      → portfolio-api:3000   (Prefix, jwt-auth+rate-limiting+cors)
/api/portfolio/*    → portfolio-api:3000   (Prefix, jwt-auth+rate-limiting+cors — portfolio-api proxies to portfolio-service)
/api/news/*         → portfolio-api:3000   (Prefix, jwt-auth+rate-limiting+cors)
/api/predict/*      → ml-predictor:8000    (Prefix, jwt-auth+rate-limiting+cors)

# Frontend (nginx, not Kong)
/*                  → frontend:3000

# In dev (no Kong): portfolio-api proxies /api/auth/* → auth-service:3004
#                                          /api/profile/* → profile-service:3007
```

## Shared Packages

### packages/shared-types

TypeScript interfaces used across all services and frontend:

```typescript
(Stock,
  OHLCV,
  Portfolio,
  Trade,
  Watchlist,
  User,
  SentimentSignal,
  PredictionSignal,
  KafkaMessage);
```

### packages/shared-dto

Validation DTOs shared between services:

```typescript
// auth
(RegisterDto, LoginDto, VerifyEmailDto, RefreshDto);
// portfolio
(CreatePortfolioDto, AddStockDto);
```

### packages/kafka-client

```typescript
KAFKA_TOPICS = {
  PRICES_RAW: 'stocks.prices.raw',
  PRICES_PROCESSED: 'stocks.prices.processed',
  SIGNALS_SENTIMENT: 'stocks.signals.sentiment',
  SIGNALS_PREDICTION: 'stocks.signals.prediction',
  USERS_REGISTERED: 'users.registered',
};
```

### packages/typescript-config

- `base.json` — common settings
- `nestjs.json` — extends base, NestJS-specific decorators
- `nextjs.json` — extends base, Next.js-specific

## Infrastructure (in k8s-apps repo)

**k8s-apps repo:** `github.com/akann/k8s-apps` (local at `~/repo/k8s-apps` on
k8s-cp-1)

All manifests are deployed. Structure:

```
apps/yana-stocks/
├── namespace.yaml
├── harbor-pull-secret.yaml
├── argocd-app-yana-stocks.yaml    # app-of-apps
├── kong/                          # JWT plugin, CORS plugin, KongConsumer, ingress routes
│   ├── external-secret.yaml       # pulls JWT_SECRET → HS256 credential (key: "yana-stocks")
│   ├── kongconsumer.yaml          # consumer: auth-service (username: auth-service)
│   ├── kongplugin-jwt.yaml        # key_claim_name: iss
│   ├── kongplugin-cors.yaml
│   ├── ingress-auth.yaml          # all /api/auth/* routes → auth-service
│   ├── ingress-profile.yaml       # /api/profile/* routes → profile-service
│   └── ingress-api.yaml           # /api/stocks|market|signals|portfolio|news|predict
├── auth-service/
│   ├── cnpg-cluster.yaml          # auth-service-pg CNPG cluster in yana-stocks namespace
│   ├── external-secret.yaml       # JWT_SECRET, REDIS_URL, DATABASE_URL, EMAIL_API_URL, EMAIL_API_KEY, FRONTEND_URL
│   ├── deployment.yaml            # migrations run at startup (golang-migrate)
│   ├── service.yaml
│   └── kafka-topic.yaml           # users.registered KafkaTopic
├── profile-service/                # KEDA ScaledObject (min 1)
│   ├── external-secret.yaml       # MONGODB_URI, KAFKA_BROKERS
│   ├── deployment.yaml
│   └── service.yaml
├── price-ingestor/                # standard Deployment, fixed 1 replica (no autoscaler)
├── price-processor/                # KEDA ScaledObject (min 1)
├── sentiment-analyzer/            # KEDA ScaledObject (min 0 — scales to zero)
├── ml-predictor/                  # Argo Rollouts canary (no deployment.yaml)
├── portfolio-service/              # KEDA ScaledObject (min 1)
├── portfolio-api/                  # KEDA ScaledObject (min 1)
├── api-docs/                      # Static nginx Swagger hub (Authentik-protected, api-docs.yanatech.co.uk)
└── frontend/
    └── ingress.yaml               # stocks.yanatech.co.uk via ingress-nginx
```

## Local Dev Infrastructure (docker-compose.yml)

```yaml
services:
  kafka: # Redpanda (lightweight Kafka)  :19092
  mongodb: # MongoDB 8                     :27017
  redis: # Redis 8                       :6379
  postgres: # PostgreSQL 16                 :5432
  minio: # MinIO                         :9000/:9001
  api-docs: # Static nginx Swagger hub      :3009  (pull_policy: build — always rebuilt on docker:up)
```

## Production Infrastructure

- **Kafka:** `kafka-cluster-kafka-bootstrap.kafka.svc.cluster.local:9092`
- **MongoDB:** `mongodb-headless.mongodb.svc.cluster.local:27017`
  (replicaSet=rs0)
- **Redis:** `redis-master.redis.svc.cluster.local:6379`
- **PostgreSQL:** CNPG cluster per service in `yana-stocks` namespace
- **MinIO:** `minio.minio.svc.cluster.local:9000`
- **Massive (Polygon.io):** `starterfeed.polygon.io` WebSocket + REST
  `/v2/aggs`/`/v2/snapshot`, Starter plan — see Data Sources section for the
  full external API list (Massive, FMP, Twelve Data)

## Kubernetes Patterns

- **KEDA:** `price-processor`, `profile-service`, `portfolio-service`,
  `portfolio-api` — scale on Kafka consumer lag, `minReplicaCount: 1` (never
  scale to zero). `sentiment-analyzer` also uses KEDA on Kafka consumer lag but
  with `minReplicaCount: 0` — it's the one service that actually scales to zero,
  not `price-ingestor`. (Verified 2026-07-26 by reading the live `k8s-apps`
  `keda-scaledobject.yaml` files directly — `price-ingestor` is NOT KEDA-scaled
  despite earlier versions of this doc saying so; it has no `ScaledObject` at
  all, just a fixed-replica Deployment.)
- **Argo Rollouts:** `ml-predictor` — canary 10%→50%→100%
- **Standard Deployment:** `auth-service`, `frontend`, `api-docs`, and
  `price-ingestor` (fixed at 1 replica, no autoscaler)
- **Images:** pushed to `harbor.yanatech.co.uk/yana-stocks/<service>:<tag>`
- **Secrets:** ESO from Infisical project `k8s-homelab` (ID
  `69b39965-b778-47a7-ba52-2cd66a7aad0a`)

### K8s Manifest Pitfalls

- **Never set `ServerSideApply=false` on a Rollout.** The Argo Rollouts CRD uses
  `x-kubernetes-preserve-unknown-fields` for `.spec.template`, which breaks
  ArgoCD's client-side structured merge diff with "field not declared in
  schema". The app-level `ServerSideApply=true` handles Rollouts correctly.
- **Stray `spec.template` blocks in Service definitions.** When a YAML file
  contains both a Deployment and a Service (separated by `---`), be careful not
  to accidentally include a `template:` block under the Service's `spec:`.
  Services don't have `.spec.template`; the stray field causes the same ArgoCD
  ComparisonError.
- **ml-predictor Rollout shows cosmetic OutOfSync** in ArgoCD after SSA
  field-manager migration. `argocd app diff` returns empty — no real diff. This
  is a known false-positive; the Rollout is Healthy.
- **Argo Rollouts controller stuck canary (expired pause not advancing):** The
  `argo-rollouts` controller pods have a high restart count (~2/day) due to a
  memory issue. After a restart the controller sometimes fails to re-evaluate an
  in-progress canary whose timed pause has already expired, leaving the rollout
  permanently `Paused` even though the analysis passed. Diagnosis:
  `kubectl get rollout ml-predictor -n yana-stocks -o jsonpath='{.status.phase} {.status.currentStepIndex} {.status.message}'`
  — if phase is `Paused` and the pause startTime is >5m ago, restart the
  controller:
  `kubectl delete pod -n argo-rollouts -l app.kubernetes.io/name=argo-rollouts`
  The rollout auto-advances within ~15s.

## CI/CD

- GitHub Actions in `yana-stocks` repo
- Turborepo `--filter=[HEAD^1]` — only build changed services
- Per-service Docker image → Harbor
- On successful build: update image tag in `k8s-apps` → ArgoCD auto-syncs
- E2E: Playwright runs against staging before prod deploy
- **Service containers:** `postgres:16-alpine`, `mongo:8`, `redis:8-alpine` are
  mirrored to `harbor.yanatech.co.uk/library/*` (amd64) to avoid Docker Hub
  anonymous pull rate limits on the self-hosted runner
- **ESLint:** Frontend uses ESLint 9 with flat config (`eslint.config.mjs`);
  `eslint-config-next@16` requires ESLint ≥9
- **Corepack's cached pnpm dist vendors its own `tar`, separate from npm's**
  (2026-07-22): `trivy-image-scan`/`docker`'s Trivy scan flagged CVE-2026-59873
  (node-tar CRITICAL) on all 5 Node-based images. First fix attempt
  (`npm install -g npm@latest` in each final stage) only patched npm's own
  bundled tar — Trivy confirmed that copy clean but kept failing, because a
  second, unrelated tar copy ships inside corepack's cached pnpm distribution
  (`root/.cache/node/corepack/v1/pnpm/<ver>/dist/node_modules/tar`, populated
  the first time pnpm actually runs, or for `frontend` by its explicit
  `corepack prepare --activate`). None of the shipped stages invoke pnpm at
  runtime, so each Dockerfile now deletes that cache dir right after it's
  populated, in the shipped stage only — never in build-only stages that still
  need it (`frontend`'s `deps`/`builder` both run pnpm on top of the same `base`
  image, so the deletion lives in `runner` alone).

CI job pipeline (`.github/workflows/ci.yml`):

| Job                | Runs when                 | Purpose                                   |
| ------------------ | ------------------------- | ----------------------------------------- |
| `changes`          | always                    | Detect changed files (turbo filter)       |
| `secret-scan`      | always                    | Gitleaks full-history secret scan         |
| `ts-quality`       | TS changed                | lint + type-check + test                  |
| `integration-test` | TS changed                | Jest integration suite                    |
| `e2e`              | TS changed                | Playwright end-to-end (full local stack)  |
| `dead-code-scan`   | TS changed                | Dead code / unused dep scan (Knip)        |
| `audit`            | always                    | `pnpm audit --audit-level=high` CVE check |
| `python-quality`   | Python changed            | Ruff lint + pytest                        |
| `docker`           | all above pass, on `main` | Build + push images → gitops              |
| `gitops`           | docker success            | Update image tags in k8s-apps             |

`docker` only runs when all non-skipped quality gates succeed — `secret-scan`
must be `success`; all others may be `success` or `skipped`.

### Turborepo remote cache

CI jobs pass `TURBO_API`, `TURBO_TOKEN`, and `TURBO_TEAM` so Turborepo stores
task outputs in a self-hosted remote cache backed by MinIO:

| Setting      | Value                                                                |
| ------------ | -------------------------------------------------------------------- |
| Cache server | `http://turbo-cache.yana-stocks.svc.cluster.local:3000`              |
| Image        | `ducktors/turborepo-remote-cache:latest`                             |
| MinIO bucket | `turborepocache`                                                     |
| Secret       | `turbo-cache-secret` in `yana-stocks` namespace (ESO from Infisical) |

**Bucket name gotcha:** The `ducktors/turborepo-remote-cache` image ignores the
`S3_BUCKET` env var and falls back to its hardcoded default `turborepocache`.
The MinIO bucket must be named `turborepocache` — do not rename it to match the
env var.

## Local Dev Quick-Start

Requires Go ≥ 1.22 installed (Mac: `brew install go`).

```bash
# 1. Start infrastructure
docker compose up -d   # postgres:5432, redis:6379, mongodb:27017, kafka:19092, minio:9000

# 2. Seed dev user (PostgreSQL — idempotent, safe to re-run)
pnpm seed              # creates dev@example.com in auth tables via portfolio-api seed script

# 3. Start services (each in its own terminal)
pnpm --filter @yana-stocks/auth-service dev       # :3004 (go run ./cmd/server — runs migrations)
pnpm --filter @yana-stocks/profile-service dev    # :3007
pnpm --filter @yana-stocks/portfolio-service dev  # :3005
pnpm --filter @yana-stocks/portfolio-api dev      # :3006
pnpm --filter @yana-stocks/frontend dev           # :3000

# ...or, one terminal, everything `pnpm dev` starts except frontend runs
# `next start` instead of `next dev` (added 2026-07-22 for realistic
# Lighthouse runs — see the Lighthouse CI note below). Requires `pnpm build`
# (or at least `pnpm --filter @yana-stocks/frontend build`) to have already
# been run — `pnpm start` does not build for you, and is expected to be run
# rarely, so this is intentionally not handled automatically. `pnpm dev`'s
# backend half is `turbo run dev --filter=!frontend`, so it auto-includes
# every service with a `dev` script (currently also price-processor, which
# the manual list above omits) without needing to be kept in sync by hand.
# Uses `concurrently` so Ctrl+C stops everything cleanly, same as `pnpm dev`.
# Caveat: `next start`'s rewrites() intentionally returns `[]` in production
# (real prod expects Kong as the API gateway — see the frontend's "Dev proxy"
# note above) — with no Kong running locally, only the homepage's
# server-prefetched public data works; every other page's client-side
# `/api/*` calls 404 until Kong (or an equivalent local shim) is in front.
pnpm build && pnpm start   # or just `pnpm start` if already built

# 4. Run tests
pnpm --filter @yana-stocks/auth-service test      # go test ./...
pnpm --filter @yana-stocks/profile-service test   # jest
pnpm --filter e2e test:e2e                        # e2e (starts frontend automatically)
```

### MongoDB auth after volume reset

`docker compose down -v` (or `pnpm docker:reset`) recreates MongoDB volumes and
enforces authentication on startup via `MONGO_INITDB_ROOT_USERNAME/PASSWORD`.
All `.env` files already include credentials
(`admin:password@localhost:27017/...?authSource=admin`), so copying from
`.env.example` is sufficient. If you see `MongoServerError: Unauthorized`, the
URI is missing credentials.

## Build Order (implement in this order)

1. Monorepo scaffold (turbo.json, pnpm-workspace.yaml, docker-compose)
2. Shared packages (shared-types, kafka-client, typescript-config)
3. `auth-service` (Go) — auth foundation (JWT, registration, email verification)
4. `profile-service` (NestJS) — user display data (consumes users.registered)
5. `price-ingestor` — data feed
6. `price-processor` — storage
7. `portfolio-service` — portfolios
8. `portfolio-api` — aggregator + dev proxy for auth/profile
9. `sentiment-analyzer` — NLP
10. `ml-predictor` — predictions
11. `frontend` — dashboard
12. `e2e` — Playwright tests

## Code Quality / Tooling

### Pre-commit hook (husky + lint-staged)

A pre-commit hook runs automatically on every `git commit`:

```bash
# .husky/pre-commit
pnpm exec lint-staged                                          # 1. Prettier
pnpm turbo type-check --filter='[HEAD^1]'                     # 2. Type-check (changed packages)
if command -v gitleaks >/dev/null 2>&1; then                  # 3. Secret scan
  gitleaks protect --staged --redact
else
  echo "warning: gitleaks not found (brew install gitleaks)"
fi
```

`lint-staged` config (root `package.json`):

```json
"lint-staged": {
  "*.{ts,tsx,js,mjs,json,md,css}": "prettier --write"
}
```

Gitleaks must be installed locally (`brew install gitleaks`). The hook skips
with a warning if missing — CI always runs the full scan regardless.

False positives are suppressed via `.gitleaksignore` (fingerprint-based) and
inline `// gitleaks:allow` comments on known dev-seed credentials.

### Pre-push hook

A pre-push hook runs on every `git push`. Unlike the pre-commit hook (which runs
on every commit), this runs only when pushing — catching slower checks before CI
sees them.

```bash
# .husky/pre-push
pnpm turbo lint --filter='[origin/main]'   # 1. ESLint — only changed packages since last push
pnpm audit --audit-level=high              # 2. CVE scan — fail on high/critical
pnpm scan:code                             # 3. Knip dead-code + unused dep scan
```

**Why pre-push and not pre-commit:**

- `turbo lint` is fast on unchanged code (turbo cache), but ESLint can still add
  1-2s per commit on active files — too slow to run on every commit
- `pnpm audit` is a network call; unsuitable for every commit
- Knip scans the full monorepo; unsuitable for every commit

**Why pre-commit doesn't catch ESLint failures:** The pre-commit hook runs
`turbo type-check` (tsc), not `turbo lint` (ESLint). TypeScript accepts
class+interface declaration merging; ESLint's
`@typescript-eslint/no-unsafe-declaration-merging` rejects it. Both checks are
needed: type-check is fast enough for every commit; lint is reserved for
pre-push.

### Format + lint tasks (turbo.json)

- `lint` — runs with `"cache": false` (never skipped due to stale cache).
- `format` — per-package format task, `"cache": false`. Run with
  `pnpm turbo format`.
- `format:check` — CI verification task, same.

Every TypeScript package has its own `format` / `format:check` scripts pointing
to `prettier --write "src/**/*.{ts,tsx}"` (or `src/**/*.ts` for NestJS). The
auth-service Go passthrough uses `gofmt -w ./cmd ./internal`.

Root convenience scripts:

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `pnpm format`       | `prettier --write` across the whole monorepo                   |
| `pnpm format:check` | `prettier --check` (exits non-zero on diff)                    |
| `pnpm lint`         | `turbo lint` — lints all packages                              |
| `pnpm audit`        | `pnpm audit --audit-level=high` — fail on high/critical CVEs   |
| `pnpm scan`         | `gitleaks detect --redact` — scan full git history for secrets |
| `pnpm scan:code`    | Knip dead-code-scan + unused dependency scan (`--no-hints`)    |

### Security scanning

**CVE auditing (`pnpm audit`):** Runs on every CI push. Fails on high or
critical severity. Overrides for transitive deps that can't be fixed upstream
live in `pnpm-workspace.yaml` under `overrides:`. Accepted CVEs that have no
upstream fix path are listed in `auditConfig.ignoreCves` with a documented
rationale comment.

**Secret scanning (Gitleaks):** Runs on staged files in pre-commit and on full
history in CI (`secret-scan` job, always runs). Suppression in `.gitleaksignore`
(fingerprint-based, one entry per false positive).

### Dead code detection (Knip)

Knip scans for unused files, exports, and dependencies across all workspaces.
Config in `knip.json` at repo root. Run with `pnpm scan:code`.

Key config decisions:

- `ignoreExportsUsedInFile: true` — suppresses exports only consumed within
  their own file (common in NestJS schema files).
- `apps/frontend` — `jest.config.js` excluded (triggers a known Knip+Next.js
  jest plugin issue); `jest.setup.ts` added to `entry` explicitly.
- Workspace-level `ignoreDependencies` used for deps that Knip can't trace (e.g.
  `@nestjs/schematics` for NestJS CLI, `typescript-eslint` peer dep).
- **`generate-openapi.ts` must be in `ignore`** for every NestJS service
  workspace. These files are invoked from the api-docs Dockerfile
  (`node dist/generate-openapi.js`) but are not imported anywhere in the
  TypeScript source tree, so Knip flags them as unused files. Currently ignored
  in: `portfolio-api`, `portfolio-service`, `profile-service`,
  `price-processor`.

## Code Style

- TypeScript strict mode everywhere
- ESLint + Prettier enforced
- No `any` types
- All NestJS controllers have Swagger decorators (`@ApiTags`, `@ApiOperation`,
  `@ApiResponse`)
- All Kafka messages typed via `shared-types`
- Error handling: NestJS exception filters, structured error responses
- Logging: structured JSON in production across all 8 backend services — a small
  `logger.ts` implementing Nest's `LoggerService` per NestJS service (wired via
  `app.useLogger()`), `log/slog`'s stdlib JSON handler in `auth-service` (Go),
  `python-json-logger` in the 3 Python services. This was fixed 2026-07-23 —
  NestJS's own default `ConsoleLogger` was never actually JSON (no
  `nestjs-pino`, no custom logger existed anywhere), so the previous version of
  this line was aspirational, not real.

## Environment Variables per Service

Each service reads from `.env` locally and from Kubernetes secrets in production
(via ESO from Infisical).

### auth-service

```shell
DATABASE_URL=postgresql://postgres:password@localhost:5432/yana_stocks?sslmode=disable
REDIS_URL=redis://localhost:6379
JWT_SECRET=...
KAFKA_BROKERS=localhost:19092
FRONTEND_URL=http://localhost:3000        # base for /verify?token= links in emails
EMAIL_API_URL=https://api-gateway.yanatech.co.uk/api/email/send
EMAIL_API_KEY=...
PORT=3004                                 # dev only; prod uses 3000
```

### profile-service

```shell
MONGODB_URI=mongodb://localhost:27017/yana_stocks
KAFKA_BROKERS=localhost:19092
PORT=3007                                 # dev only; prod uses 3000
```

### price-processor

```shell
MONGODB_URI=mongodb://...
REDIS_URL=redis://...
KAFKA_BROKERS=...
```

### portfolio-service

```shell
MONGODB_URI=mongodb://...
KAFKA_BROKERS=...
PORT=3005                                      # dev only; prod uses 3000
```

### portfolio-api

```shell
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:19092
AUTH_SERVICE_URL=http://localhost:3004         # prod: http://auth-service:3000
PROFILE_SERVICE_URL=http://localhost:3007      # prod: http://profile-service:3000
PORTFOLIO_SERVICE_URL=http://localhost:3005    # prod: http://portfolio-service:3000
PRICE_PROCESSOR_URL=http://price-processor:3000  # also used by StocksService.ensureTracking()
ML_PREDICTOR_URL=http://ml-predictor:8000        # also used by StocksService.ensureTracking()
PORT=3006                                      # dev only; prod uses 3000
```

### price-ingestor (Python)

```shell
MASSIVE_API_KEY=...                       # polygon.io Starter plan
KAFKA_BROKERS=...
SYMBOLS=AAPL,GOOGL,MSFT,AMZN,TSLA,NVDA,META,JPM,V,JNJ
```

### sentiment-analyzer (Python)

```shell
KAFKA_BROKERS=...
MONGODB_URI=mongodb://...            # same shared yana_stocks DB as portfolio-service
FMP_API_KEY=...                      # financialmodelingprep.com, Starter plan (~300 req/min, no daily cap)
HUGGINGFACE_MODEL=ProsusAI/finbert
SYMBOLS=AAPL,GOOGL,...               # optional, overrides DEFAULT_SYMBOLS baseline
MAX_SYMBOLS_PER_POLL=10              # optional, default 10 — see service notes above
```

### ml-predictor (Python)

```shell
KAFKA_BROKERS=...
MONGODB_URI=mongodb://...            # same shared yana_stocks DB as portfolio-service
MINIO_ENDPOINT=minio.minio.svc.cluster.local:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=yana-stocks-models
SYMBOLS=AAPL,GOOGL,...               # optional, overrides DEFAULT_SYMBOLS baseline
```

### frontend

```shell
NEXT_PUBLIC_API_URL=https://api-gateway.yanatech.co.uk/api
# In dev: unset — Next.js rewrites in next.config.mjs proxy /api/* to local services
# auth-service:    /api/auth/*     → AUTH_SERVICE_URL (default http://localhost:3004)
# profile-service: /api/profile/*  → PROFILE_SERVICE_URL (default http://localhost:3007)
# portfolio-api:   /api/portfolio|stocks|signals|market|news|predict/* → http://localhost:3006
AUTH_SERVICE_URL=http://localhost:3004    # consumed by Next.js rewrites in dev
PROFILE_SERVICE_URL=http://localhost:3007
```

---

## VS Code Claude Code — Getting Started Prompts

Use these prompts in order when building with Claude Code in VS Code.

### Prompt 1 — Monorepo scaffold

```text
Following CLAUDE.md, scaffold the Turborepo monorepo. Create:

1. turbo.json — pipeline for build, dev, lint, type-check, test, test:e2e
2. pnpm-workspace.yaml — include apps/*, services/*, packages/*
3. package.json (root) — with turbo, typescript, eslint, prettier as dev deps
4. .gitignore — node_modules, dist, .env, .turbo, __pycache__
5. packages/typescript-config/ — base.json, nestjs.json, nextjs.json
6. packages/eslint-config/ — index.js for NestJS + Next.js
7. packages/prettier-config/ — index.js
8. packages/shared-types/ — all interfaces: Stock, OHLCV, Portfolio, Trade, Watchlist, User, SentimentSignal, PredictionSignal, KafkaMessage
9. packages/kafka-client/ — KAFKA_TOPICS constant + Kafka config factory
10. packages/shared-dto/ — CreatePortfolioDto, AddStockDto, RegisterDto, LoginDto
11. docker-compose.yml — Redpanda (Kafka), MongoDB 8, Redis 8, PostgreSQL 16, MinIO
```

### Prompt 2 — auth-service + profile-service

```text
Following CLAUDE.md, scaffold apps/auth-service as a Go service with:
- Chi router, pgx driver, golang-migrate (runs at startup)
- JWT HS256 access token (15min, iss:'yana-stocks') + opaque refresh token (7d, Redis)
- Refresh token rotation on every use
- Kafka producer: publishes users.registered event on successful registration
- Endpoints: POST /api/auth/register, POST /api/auth/verify, POST /api/auth/login,
             POST /api/auth/refresh, POST /api/auth/logout, GET /api/auth/me
- Email verification via shared-services' email-api (POST https://api-gateway.yanatech.co.uk/api/email/send)
- Dockerfile (multi-stage Go build)
- .env.example
- package.json with "dev": "go run ./cmd/server" so turbo dev works

Then scaffold apps/profile-service as a NestJS app with:
- Mongoose for MongoDB (Profile schema: userId, displayName, avatarUrl, bio, preferences)
- Kafka consumer: users.registered → creates initial profile
- Endpoints: GET /api/profile/me, PUT /api/profile/me, GET /api/profile/:userId
- Dockerfile (multi-stage)
- .env.example
```

### Prompt 3 — price-ingestor

```text
Following CLAUDE.md, scaffold services/price-ingestor as a Python service with:
- Alpaca Markets SDK (alpaca-trade-api or alpaca-py)
- Kafka producer via confluent-kafka
- Poll SYMBOLS env var (default: AAPL,GOOGL,MSFT,AMZN,TSLA,NVDA,META,JPM,V,JNJ)
- Publish OHLCV bars to stocks.prices.raw topic
- Structured JSON logging
- Dockerfile
- uv for dependency management (pyproject.toml + uv.lock)
- .env.example
```

### Prompt 4 — price-processor

```text
Following CLAUDE.md, scaffold apps/price-processor as a NestJS app with:
- Kafka consumer for stocks.prices.raw via @nestjs/microservices
- Kafka producer for stocks.prices.processed
- Mongoose for MongoDB (OHLCV schema)
- ioredis for price cache (TTL 5s)
- Dockerfile (multi-stage)
- .env.example
```

### Prompt 5 — portfolio-service

```text
Following CLAUDE.md, scaffold apps/portfolio-service as a NestJS app with:
- Mongoose for MongoDB (Portfolio, Watchlist, Trade schemas)
- Kafka consumer for stocks.prices.processed (portfolio valuation)
- CRUD endpoints for portfolios, watchlists, trades
- JWT guard on all endpoints
- Swagger decorators
- Dockerfile (multi-stage)
- .env.example
```

### Prompt 6 — portfolio-api

```text
Following CLAUDE.md, scaffold apps/portfolio-api as a NestJS aggregator with:
- ioredis for response caching (TTL 10s)
- HTTP clients to auth-service, profile-service, portfolio-service, price-processor, ml-predictor
- In dev (no Kong): proxy /api/auth/* → auth-service, /api/profile/* → profile-service
- Endpoints: GET /stocks/:symbol, GET /stocks/:symbol/history, GET /signals/:symbol, GET /market/movers
- JWT guard on all endpoints
- Swagger decorators
- Dockerfile (multi-stage)
- .env.example
```

### Prompt 7 — sentiment-analyzer

```text
Following CLAUDE.md, scaffold services/sentiment-analyzer as a Python service with:
- NewsAPI.org client for news fetching
- HuggingFace transformers with ProsusAI/finbert model
- Kafka producer for stocks.signals.sentiment via confluent-kafka
- PyMongo for storing articles + sentiment scores
- Structured JSON logging
- Dockerfile
- uv for dependency management
- .env.example
```

### Prompt 8 — ml-predictor

```text
Following CLAUDE.md, scaffold services/ml-predictor as a Python service with:
- FastAPI HTTP server on port 8000
- Facebook Prophet for price prediction
- Kafka producer for stocks.signals.prediction
- PyMongo for storing predictions
- MinIO client for model artifact storage (yana-stocks-models bucket)
- Endpoint: GET /predict/:symbol
- Dockerfile
- uv for dependency management
- .env.example
```

### Prompt 9 — frontend

```text
Following CLAUDE.md, scaffold apps/frontend as a Next.js 16 App Router app with:
- TailwindCSS
- Recharts for price charts
- TanStack Query for data fetching
- Routes: /, /dashboard, /stocks/[symbol], /portfolio, /watchlist, /login, /register
- Auth context with JWT access token + refresh token rotation
- API client pointing to NEXT_PUBLIC_API_URL
- Dockerfile (multi-stage, standalone output)
- .env.example
```

### Prompt 10 — e2e tests

```text
Following CLAUDE.md, scaffold apps/e2e as a Playwright test suite with:
- Page Object Model pattern
- Test suites: auth (register, login, refresh, logout), portfolio (create, add stock, watchlist), stocks (price display, signals)
- Fixtures: auth.fixture.ts (login helper), data.fixture.ts (test data factories)
- playwright.config.ts — Chromium + iPhone 14, BASE_URL from env
- package.json with playwright deps
```

### Prompt 11 — Kubernetes manifests

```text
Following CLAUDE.md, create k8s/ manifests for all services:
- namespace.yaml (yana-stocks)
- Per service: deployment.yaml, service.yaml, external-secret.yaml, hpa.yaml
- price-ingestor: keda-scaledobject.yaml (Kafka consumer lag trigger)
- sentiment-analyzer: keda-scaledobject.yaml
- ml-predictor: rollout.yaml (Argo Rollouts canary), analysis-template.yaml
- auth-service: cnpg-cluster.yaml (auth-service-pg)
- frontend: ingress.yaml (stocks.yanatech.co.uk)
- Kong routes: ingress manifests with ingressClassName: kong for all /api/* routes
- ArgoCD app-of-apps: argocd-app-yana-stocks.yaml
```

---

## Harbor Registry

- **URL:** `harbor.yanatech.co.uk`
- **Project:** `yana-stocks`
- **Image format:** `harbor.yanatech.co.uk/yana-stocks/<service>:<tag>`
- **CI pushes:** SHA tag + `latest` tag on every main branch build

## GitHub Actions

- **Workflow:** `.github/workflows/ci.yml`
- **Runner:** `runners-yana-stocks` (self-hosted ARC runner on k8s cluster)
- **Secrets:** `HARBOR_USERNAME`, `HARBOR_PASSWORD`, `GH_PAT`
- **On push to main:** lint → type-check → test → docker build → push to Harbor
  → update image tag in k8s-apps

### Playwright CI caching

Browser binaries are cached via `actions/cache` (key:
`playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`). The install
is split into two steps intentionally:

- `playwright install chromium webkit` — runs only on cache miss (restores
  binaries from cache otherwise)
- `playwright install-deps chromium webkit` — runs on **every** job (installs OS
  system libraries via apt-get, which are NOT cached)

Do not merge these into a single `playwright install --with-deps` step gated by
the cache — system libraries are not cached and the browsers will crash at
runtime with missing `.so` errors.

## Data Sources

### Massive (Polygon.io) — US prices

- **Plan:** Starter ($29/mo)
- **WebSocket feed:** `starterfeed.polygon.io` — `AM.*` minute aggregates (push)
- **REST:** `/v2/aggs` (history up to 2 years), `/v2/snapshot` (live quote)
- **Used by:** `price-ingestor` (WebSocket), `price-processor` (REST history +
  quotes)
- **Env var:** `MASSIVE_API_KEY`

### Financial Modeling Prep (FMP) — news + analyst ratings

- **Plan:** Starter (~300 req/min, no daily cap — not the free tier's 250/day)
- **Used by:** `portfolio-api` (analyst ratings, sector performance),
  `sentiment-analyzer` (news)
- **Env var:** `FMP_API_KEY`

### Twelve Data — UK / international prices

- **Plan:** Grow
- **Used by:** `price-processor` (on-demand UK/international history + quotes);
  `portfolio-api` (FTSE 100 sector rotation — 31 LSE stocks via
  `/time_series?exchange=LSE&outputsize=13`, daily % changes averaged per
  sector)
- **Env var:** `TWELVE_DATA_API_KEY`
- **LSE quirk:** BT Group must be requested as `BT.A` — bare `BT` with
  `exchange=LSE` returns 404

## Known Bugs Fixed

| Bug                                                                                                                                                                     | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart goes blank when toggling Candle ↔ Line                                                                                                                            | `chartType` missing from data effect deps — new series created but not populated (same `data` ref, effect skipped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Added `chartType` to `useEffect` deps array in `StockChart.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| lightweight-charts crash (`ensureNotNull`) on 6M/1Y                                                                                                                     | MongoDB stores duplicate daily bars at different UTC offsets (T00, T04, T05); same YYYY-MM-DD maps to duplicate `time` keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Backend dedup in `getHistory` (keeps highest UTC per date); frontend defensive dedup before `setData()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Volume bars invisible on 1D range                                                                                                                                       | 390 bars in ~600px = ~1.5px/bar, below `HistogramSeries` render threshold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `minBarSpacing: 2` in `timeScale` options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Market dashboard shows only NVDA                                                                                                                                        | `getMovers()` scans `papi:price:*` Redis keys — only symbols streamed via Kafka or previously visited have entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `getMovers()` now mget-checks 15 default symbols and fetches missing quotes via Polygon snapshot before scanning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| MACD signal scan only emitted current-bar crossover                                                                                                                     | `detectSignals()` compared only the last 2 `signalLine` entries; all historical crossovers were missed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Loop in `signals.ts` changed to `for (let i = 1; i < n; i++)` — scans all bars; MACD arrows now appear throughout chart history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `chart.subscribeClick is not a function` in Jest                                                                                                                        | `src/__mocks__/lightweight-charts.js` `mockChart` was missing `subscribeClick` and `unsubscribeClick` methods; `StockChart.tsx:256` calls `chart.subscribeClick()` for news headline popup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Added `subscribeClick: jest.fn()` and `unsubscribeClick: jest.fn()` to `mockChart` in the mock file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S&P 500 treemap flashes "No data" before overview                                                                                                                       | `isLoading` gated only on `rotLoading`; when rotation resolved empty, `TreemapView` rendered with an empty `pctMap` for one cycle before `overviewData` arrived                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Widened `isLoading` to include `overviewLoading` in the narrow case: S&P 500 + today view + rotation empty + overview in flight                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/stocks/:symbol/history` returns 500                                                                                                                           | `price-processor` KEDA ScaledObject had `minReplicaCount: 0`; scales to 0 outside trading hours; Cilium returns `EPERM` when `portfolio-api` connects to a Service with no endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Set `minReplicaCount: 1` in `k8s-apps/apps/yana-stocks/price-processor/keda-scaledobject.yaml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dashboard "Total Portfolio Value" shows $0.00                                                                                                                           | Holdings valued at `shares × latestPrice`, but `latestPrice` is only written by the `stocks.prices.processed` Kafka consumer — never populated when the price pipeline isn't streaming (local dev, market closed, fresh deploy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `portfolio-service` `toResponse()` falls back to `avgCostBasis` when `latestPrice` is unset (same rule the portfolio page applies client-side); `addStock` seeds `latestPrice` with the trade price                                                                                                                                                                                                                                                                                                                                                                                                                  |
| No sentiment data on any stock page (2026-07-23)                                                                                                                        | Two stacked bugs. (1) FMP deprecated `/api/v3/stock_news` (cutoff 2025-08-31) — 403 "Legacy Endpoint" for this subscription, silently caught as a `WARNING` every poll, so sentiment data went dark for all tracked symbols. (2) Separately, `sentiment-analyzer` only ever tracked a hardcoded 10-symbol list with no `SYMBOL_KEYWORDS`/`SYMBOLS` override in prod — any other symbol (e.g. XOM) was never fetched at all, independent of bug (1). Live-tested and rejected two fixes for (2): pure portfolio/watchlist-driven tracking (prod Mongo only holds typo'd tickers like `APPL`/`TESLA`, not real symbols like XOM) and batching multiple symbols into one FMP call (a 25-symbol batch returned FMP's 250-article cap skewed almost entirely to trending tickers — `PG`/`CRM`/`V` got zero, XOM got 1 — so batching was dropped as unreliable for coverage). | (1) `fmp_news_client.py` switched to `/stable/news/stock` + renamed `tickers`→`symbols` param. (2) Baseline widened to ~30 tickers across sectors (`DEFAULT_SYMBOLS`) unioned with real user portfolio/watchlist symbols (read directly from the shared Mongo), round-robined through `max_symbols_per_poll` (default 10 at the time, raised to 50 on 2026-07-24 once this project's actual FMP plan — Starter, ~300 req/min, no daily cap — was confirmed; see Environment Variables/Data Sources below) each cycle via `worker.select_symbols_for_poll` so a large universe still can't burst past the rate limit. |
| `/market/assets` (search/browse) silently served only ~275 curated US tickers instead of Polygon's full universe — real tickers like `FIS` were unfindable (2026-07-29) | `fetchAssetsFromMassive`'s pagination loop assumed Polygon's `next_url` carries the `apiKey` in its query string (per its own comment) — confirmed live it only ever carries `cursor=...`. So page 1 of `/v3/reference/tickers` succeeded, every page ≥2 hit Polygon with no `apiKey` and 401'd, the whole fetch threw, and `loadMarketAssets` fell back to the tiny hardcoded `MOCK_ASSETS`/`MOCK_ETF_ASSETS` dev list — every single time the cache refreshed, not just transiently. Compounding it: `loadMarketAssets` cached that fallback for the same 86400s TTL as real data, so once poisoned it stayed wrong for a full day.                                                                                                                                                                                                                                   | `apps/portfolio-api/src/stocks/stocks.service.ts`: re-attach `apiKey` as a request param on every paginated request (not just page 1). Separately, `fetchAssetsFromMassive` now returns `{ assets, isFallback }` so `loadMarketAssets` can cache a fallback with a 60s TTL instead of 86400s — a future transient Massive failure self-heals on the next request instead of locking in for a day.                                                                                                                                                                                                                    |

## Known Gaps — Deferred, Not Bugs

**Kafka trace continuity** (closed 2026-07-23 — previously documented here as
"researched, not implemented"; that turned out to be wrong on two of three
legs). Re-investigating before building anything surfaced that the Node side was
**already closed and nobody had noticed**:
`@opentelemetry/auto-instrumentations-node@^0.77.0` (used by every NestJS app's
`tracing.ts` via `getNodeAutoInstrumentations()`) bundles
`@opentelemetry/instrumentation-kafkajs@^0.28.0` as a direct dependency, and
none of the 4 apps ever disabled it (only `fs`/`dns`/`net` are disabled).
Verified live with a standalone kafkajs producer/consumer against the local
Redpanda broker: a `traceparent` header is injected on send, and the consumer
span's `trace_id` matches the producer's exactly — this was true before any
change in this pass.

What was genuinely missing: the 3 Python services (`price-ingestor`,
`sentiment-analyzer`, `ml-predictor` — all Kafka **producers only**, no consumer
code exists in Python anywhere in this repo) had no Kafka instrumentation at
all, and `auth-service` (which the tech-stack section previously and incorrectly
said used Sarama — it actually uses `segmentio/kafka-go`) had none either. Both
are now fixed:

- **Python:** `opentelemetry-instrumentation-confluent-kafka` (official
  `open-telemetry/opentelemetry-python-contrib`, same Beta maturity tier as
  `opentelemetry-instrumentation-pymongo` already in use) added to all 3
  services, with a single `ConfluentKafkaInstrumentor().instrument()` call in
  each `_configure_tracing()`, right next to the existing
  `PymongoInstrumentor()` call — no changes needed to any `kafka_producer.py`,
  since `instrument()` patches the `confluent_kafka` module globally.
- **Go:** no official OTel contrib package exists for `segmentio/kafka-go`
  (unlike kafkajs/confluent-kafka), so `internal/kafka/publisher.go`'s
  `PublishUserRegistered` hand-rolls a `Producer`-kind span and injects a W3C
  `traceparent` via the already-correctly-configured global propagator
  (`otel.GetTextMapPropagator().Inject(...)`, `tracing.go` already sets
  `propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{})`)
  into a small carrier adapting kafka-go's `[]kafka.Header` slice.

Verified end-to-end for all 3 language pairs using the same method as the HTTP
propagator fix (capture actual headers, feed them through the real consumer's
`extract()`, confirm `trace_id` matches) against the local Redpanda broker:
Python `price-ingestor` → Node `price-processor` (`stocks.prices.raw`), Go
`auth-service` → Node `profile-service` (`users.registered`), and Node → Node
generally (`price-processor`-style producer → `portfolio-api`-style consumer).
All three showed a single matching `trace_id` across the producer and consumer
span.

**Correction (2026-07-24) — the Python leg was NOT actually closed in
production.** Live verification (Tempo trace inspection + reading the newest
messages off the prod broker with `print.headers`) showed
`stocks.signals.prediction` and `stocks.signals.sentiment` messages carrying
**no headers at all**, and `portfolio-api`'s consumer spans as link-less root
spans in single-service traces — despite the instrumented image being deployed.
Root cause: `ConfluentKafkaInstrumentor().instrument()` patches the `Producer`
class **on the `confluent_kafka` module**, but every `kafka_producer.py` binds
`Producer` into its own namespace at import time — before `_configure_tracing()`
runs — so the app's producers were built from the original, unpatched class.
(The 2026-07-23 local verification passed because it exercised a fresh
post-instrument producer, not the app's real import path.) Fixed by wrapping
explicitly at construction —
`ConfluentKafkaInstrumentor.instrument_producer(Producer(...))` in each of the 3
services' `kafka_producer.py` — which is import-order-proof (the proxy tracer
picks up the real provider once it's set), and removing the misleading global
`instrument()` calls. Re-verified by reproducing the exact prod import order
(producer constructed before tracing config) against local Redpanda and reading
the message back: `traceparent` present. A regression test
(`test_producer_is_wrapped_for_trace_propagation`) guards the wrap.

One related fact checked in the kafkajs source while diagnosing: for
`eachMessage` consumers (all of ours), `@opentelemetry/instrumentation-kafkajs`
creates the consumer span with the **propagated context as its parent** — the
consumer _continues the producer's trace_ (same `trace_id`), it does not create
a separate trace with a span link; links are only used on the `eachBatch` path,
which nothing here uses.

**Second finding, same day — bare `SentryPropagator` extraction dropped the
consumer spans the producer fix enabled.** Once Python producers started
injecting headers, `portfolio-api`'s consumer `process` spans disappeared
entirely instead of joining the producer's trace. Root cause:
`SentryPropagator.extract` reads **only** `sentry-trace` (its `traceparent`
support is inject-only, behind `propagateTraceparent`), and an error-only
upstream (`traces_sample_rate: 0` — every Go/Python service here) always stamps
`sentry-trace` "not sampled" — so the parent-based sampler dropped the consumer
span. Proven by extracting the real prod headers through both propagators: same
`trace_id`, but bare Sentry → `traceFlags 0` (dropped), composite →
`traceFlags 3` (kept). Fixed in all 4 NestJS `tracing.ts` files:
`textMapPropagator` is now
`new core.CompositePropagator({ propagators: [new SentryPropagator(), new core.W3CTraceContextPropagator()] })`
— W3C **after** Sentry so the standard `traceparent` decides the remote parent
and its sampling flag on extract (and a `traceparent` is always injected
regardless of Sentry client options). This mirrors the composite pattern the
Go/Python sides already used.

## Feature Implementation Progress

See `FUTURE_PLAN.md` for the full feature implementation plan (Steps 0–15),
including data source details, exact files to change, and npm/pip packages per
step. All 15 steps are complete.

| Step | Feature                                                          | Status     |
| ---- | ---------------------------------------------------------------- | ---------- |
| 0    | Massive migration — replace Alpaca + Yahoo Finance for US prices | ✓ complete |
| 1    | Candlestick chart (`StockChart.tsx`, lightweight-charts v5)      | ✓ complete |
| 2    | Volume histogram pane                                            | ✓ complete |
| 3    | Moving average overlays (SMA/EMA)                                | ✓ complete |
| 4    | RSI sub-chart pane                                               | ✓ complete |
| 5    | MACD sub-chart + buy/sell signal badges                          | ✓ complete |
| 6    | Universal watchlist `+` button                                   | ✓ complete |
| 7    | ETF support + MarketBrowser                                      | ✓ complete |
| 8    | Analyst ratings (FMP) + FMP news replacing Alpaca News           | ✓ complete |
| 9    | UK data pipeline (Twelve Data) + location defaults               | ✓ complete |
| 10   | Home screen with indices & sectors                               | ✓ complete |
| 11   | Stock screener                                                   | ✓ complete |
| 12   | News pin markers with headline popup                             | ✓ complete |
| 13   | Home market preference UI (profile settings + home wiring)       | ✓ complete |
| 14   | Sector rotation time-series heatmap (S&P 500 + FTSE 100)         | ✓ complete |
| 15   | Factor performance tiles                                         | ✓ complete |

**UI polish (outside numbered steps):**

- Navbar symbol autocomplete (`SymbolSearch`) — debounced, keyboard nav,
  `market=all`
- Add-symbol autocomplete (`SymbolAutocompleteInput`) — same debounced
  `/market/assets` search as the navbar, but fills the input instead of
  navigating; used by the watchlist add-symbol form and the portfolio Add Stock
  modal. `WatchlistCard` must not use `overflow-hidden` or the dropdown gets
  clipped.
- Sticky navbar (`sticky top-0 z-50`)
- Mobile navbar — hamburger below `md` opens a collapsible panel with a
  full-width `SymbolSearch` and stacked nav links; panel closes via `onNavigate`
  callbacks (not a pathname effect — the React compiler lint rule rejects
  setState-in-effect)
- MarketNews fixed 350px height with internal scroll
- Market closed indicator (`lib/market-hours.ts`) — client-side weekday/hours
  check (no holiday calendar) per region (US: NYSE 9:30-16:00 ET; UK: LSE
  8:00-16:30 London, symbols ending `.L` or `^FTSE`; DE: Xetra 9:00-17:30
  Berlin, `^GDAXI`). Stock page swaps the animated "Live" badge for a gray
  "Market Closed" badge; `IndicesBar` shows a per-card "Closed" pill

**Step 5 gap completions (shipped post-step):**

- `ChartSignal.time: Time` — signals carry the bar timestamp so they can be
  positioned as canvas markers, not just current-state badges
- MA crossover detection — `detectSignals()` now accepts `maConfigs[]` and
  checks EMA12/26, SMA20/50, SMA50/200 pairs; crossover markers rendered as
  `arrowUp`/`arrowDown` on the price series via `createSeriesMarkers()`
- News article markers on daily chart — circle markers coloured by sentiment;
  uses shared `['news', symbol]` query key (no extra network request); intraday
  ranges excluded (minute-snapping unreliable)
- `SignalsPanel` updated to pass `SIGNALS_MA_CONFIGS` to `detectSignals()` so
  the sidebar also surfaces MA crossover signals
- Chart header badge renderer extended to handle `'ma-cross'` source
- Signal badges collapsed by `source+type` with `×N` count (e.g., `↓ MACD ×16`)
  — prevents badge flooding when many historical crossovers exist; at most 6
  badges total (buy+sell per source)
- 3-row chart header: Row 1 = "Price Chart" + signal badges + Line/Candle toggle
  (right-pinned via `ml-auto shrink-0`); Row 2 = `RANGE` label +
  1H/1D/1W/1M/3M/6M/1Y buttons (left-aligned); Row 3 = MA/RSI/MACD indicator
  toggles
- Watchlist `+` button always shows the dropdown regardless of watchlist count;
  zero watchlists redirects to `/watchlist` instead of auto-adding

**Step 14 polish (shipped post-step):**

- `CustomContent` wrapped with `React.memo` — prevents re-render when treemap
  cell props are unchanged
- Gradient `<defs>` moved out of per-cell render: single
  `CELL_GRAD_ID = 'cg-overlay'` constant; `<defs>` injected once as a
  `<Treemap>` child and shared across all 11 cells (was 11 separate identical
  definitions per render)
- `treeData` array memoised with `useMemo` in `TreemapView` — Recharts no longer
  receives a new array reference on every parent re-render
- S&P 500 today-view fallback: `isLoading` widens to cover `overviewLoading`
  when rotation resolves empty, preventing a "No data" flash (see Known Bugs)
- `apps/frontend/next-env.d.ts` removed from git tracking and added to
  `.gitignore` — auto-generated by Next.js on every build; was appearing as a
  permanent dirty file in `git status`
