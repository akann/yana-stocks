# yana-stocks

Production-grade microservices platform for real-time stock market data,
portfolio management, sentiment analysis, and ML-based price prediction. Runs on
a self-hosted Kubernetes cluster managed via ArgoCD GitOps.

> **Live app:** [stocks.yanatech.co.uk](https://stocks.yanatech.co.uk) · **K8s
> manifests:** [github.com/akann/k8s-apps](https://github.com/akann/k8s-apps)

**About this project:** 11 services across 3 languages (Go, NestJS, Python) by
deliberate design — the goal is to practice patterns a larger engineering team
would use, not to recommend this decomposition for a project of this size.
FinBERT's sentiment scores and Prophet's price predictions are real running
code, not investment advice.

## Architecture

```
apps/
├── frontend/           # Next.js 16 (App Router) — dashboard UI
├── auth-service/       # Go (Chi) — registration, email verification, JWT, refresh tokens, MFA (PostgreSQL)
├── profile-service/    # NestJS — non-PII display data: displayName, avatar, bio, preferences (MongoDB)
├── price-processor/    # NestJS — consume raw prices, store OHLCV, cache
├── portfolio-service/  # NestJS — portfolios, watchlists, trades (MongoDB)
├── portfolio-api/      # NestJS — REST aggregator (prices + signals + predictions + market data)
├── api-docs/           # Static nginx — Swagger UI hub at api-docs.yanatech.co.uk (Authentik-protected)
└── e2e/                # Playwright end-to-end tests

services/
├── price-ingestor/     # Python — Massive (Polygon.io) WebSocket client, publishes to Kafka
├── sentiment-analyzer/ # Python — FinBERT NLP on news feed
└── ml-predictor/       # Python — Prophet price prediction, REST + Kafka

packages/
├── shared-types/       # TypeScript interfaces (Stock, OHLCV, Portfolio, etc.)
├── shared-dto/         # Shared validation DTOs
├── kafka-client/       # Kafka config + topic constants
├── typescript-config/  # Shared tsconfig bases
├── eslint-config/      # Shared ESLint config
└── prettier-config/    # Shared Prettier config
```

There is no `k8s/` directory in this repo. Kubernetes manifests for every
service live in the sibling GitOps repo,
[`k8s-apps`](https://github.com/akann/k8s-apps), under `apps/yana-stocks/`.

## Services

### auth-service (Go)

Registration, email verification, login, JWT issuance, refresh-token rotation,
password reset, MFA (TOTP), account deletion. Dev port `3004`, prod port `3000`.
PostgreSQL via a CNPG cluster (`auth-service-pg`, 2 instances, Barman backups to
Backblaze B2). Redis stores refresh tokens (7d TTL) and password reset tokens
(1h TTL, single-use). Kafka producer: `users.registered`. Runs as a standard
Kubernetes Deployment.

Registered routes (`cmd/server/main.go`):

| Method | Path                               | Auth                         |
| ------ | ---------------------------------- | ---------------------------- |
| POST   | `/api/auth/register`               | Public                       |
| POST   | `/api/auth/verify`                 | Public                       |
| POST   | `/api/auth/login`                  | Public                       |
| POST   | `/api/auth/refresh`                | Public                       |
| POST   | `/api/auth/logout`                 | Public                       |
| POST   | `/api/auth/password/reset-request` | Public                       |
| POST   | `/api/auth/password/reset`         | Public                       |
| POST   | `/api/auth/mfa/verify`             | Public (completes MFA login) |
| GET    | `/api/auth/me`                     | JWT                          |
| PUT    | `/api/auth/password`               | JWT                          |
| DELETE | `/api/auth/account`                | JWT                          |
| GET    | `/api/auth/mfa`                    | JWT                          |
| POST   | `/api/auth/mfa/setup`              | JWT                          |
| POST   | `/api/auth/mfa/enable`             | JWT                          |
| DELETE | `/api/auth/mfa`                    | JWT                          |

### profile-service (NestJS)

Non-PII display data: `displayName`, `avatarUrl`, `bio`, `preferences` in
MongoDB. Dev port `3007`, prod port `3000`. Kafka consumer: `users.registered` —
creates the initial profile on new registration. KEDA `ScaledObject` (1→3
replicas, `minReplicaCount: 1`).

- `GET /api/profile/me` (JWT)
- `PUT /api/profile/me` (JWT)
- `GET /api/profile/:userId` (public)

### price-ingestor (Python)

Consumes the Massive (Polygon.io) WebSocket feed (`AM.*` minute aggregates) and
publishes raw OHLCV bars to Kafka. No database, no HTTP server, pure producer.
Kafka producer: `stocks.prices.raw`. WebSocket reconnect is handled by the
`polygon` Python SDK's `WebSocketClient` (default `max_reconnects=5`), not
custom retry code in this repo. Runs as a fixed single-replica Deployment — this
is the one service with no autoscaler of any kind.

### price-processor (NestJS)

Consumes raw prices, stores OHLCV history in MongoDB, caches the latest price in
Redis. Kafka consumer: `stocks.prices.raw`; Kafka producer:
`stocks.prices.processed`. KEDA `ScaledObject` (1→3, `minReplicaCount: 1` — also
serves HTTP history/quote requests outside trading hours).

Redis keys: `price:latest:<symbol>` at 5s TTL (written on every consumed
message); an on-demand quote/history cache at 900s (15 min) for non-streamed/UK
markets. Idempotent redelivery: `findOneAndUpdate` with `$setOnInsert` on the
compound key `(symbol, timestamp, interval)`, `upsert: true` — a redelivered
Kafka message is a no-op, not a duplicate row.

### sentiment-analyzer (Python)

Consumes FMP's `/stable/news/stock`, runs FinBERT (`ProsusAI/finbert`) on each
article, publishes sentiment signals. Kafka producer:
`stocks.signals.sentiment`. Stores articles + scores in MongoDB. KEDA
`ScaledObject` on `stocks.prices.processed` lag, `minReplicaCount: 0` — this is
the one service in the system that actually scales to zero.

Tracked symbols are a `DEFAULT_SYMBOLS` baseline (~30 tickers across sectors)
unioned with whatever any user actually holds or watches, read directly from the
shared MongoDB's `portfolios`/`watchlists` collections — the one deliberate
crossing of the one-service-one-owner rule below. A `max_symbols_per_poll`
budget (default 50) round-robins the baseline each cycle so the tracked universe
can grow without bursting past FMP's Starter rate limit; user-held/watched
symbols are always fetched fresh every cycle.

### ml-predictor (Python)

Price prediction via Prophet, served over REST and published to Kafka. FastAPI
on port `8000` (dev and prod). Kafka producer: `stocks.signals.prediction`.
Model artifacts (`prophet_model.json` per symbol) stored in MinIO bucket
`yana-stocks-models`. Deployed as an Argo Rollouts canary (10%→50%→100%) — there
is no plain `deployment.yaml` for this service.

Reads the same symbol union as sentiment-analyzer (baseline + real
portfolio/watchlist symbols from the shared MongoDB) but has no Kafka consumer
anywhere in its code — training reads its own already-collected price history
directly from MongoDB, not a rate-limited external API, so no round-robin budget
is needed.

- `GET /api/predict/:symbol`

### portfolio-service (NestJS)

Portfolio, watchlist, and trade CRUD. Kafka consumer: `stocks.prices.processed`
(portfolio valuation) — consume-only, no Kafka producer. KEDA `ScaledObject`
(1→3, `minReplicaCount: 1`).

Missing-price degradation: portfolio valuation computes
`shares * (latestPrice ?? avgCostBasis)` — falls back to cost basis instead of
erroring when no live price has arrived yet.

- `GET/POST /portfolios`
- `GET/PUT/DELETE /portfolios/:id`
- `POST /portfolios/:id/stocks`
- `GET/POST /watchlists`
- `GET /trades`

### portfolio-api (NestJS)

REST aggregator combining prices, sentiment, predictions, and market-wide data.
Kafka consumer: `stocks.prices.processed`, `stocks.signals.sentiment`,
`stocks.signals.prediction`. KEDA `ScaledObject` (1→3, triggers on all three
topics' lag, `minReplicaCount: 1`).

Caching is per-endpoint, not one blanket layer: a price fallback-fetch cache at
900s, a Kafka-populated sentiment cache at 86400s (24h), a prediction cache at
172800s (48h), and a separate `/market/movers` cache at 10s.

- `GET /stocks/:symbol` (JWT)
- `GET /stocks/:symbol/history` (JWT)
- `GET /signals/:symbol` (JWT)
- `GET /market/movers?top=N` (public)
- `GET /market/overview` (public)
- `GET /market/sectors/rotation` (public)
- `GET /market/factors` (public)
- `GET /market/screener` (public)
- `GET /market/assets?search=&page=&limit=&market=us|etf|uk|all` (public)

### frontend (Next.js 16)

Dashboard UI at `https://stocks.yanatech.co.uk`, served via its own
`ingressClassName: nginx` Ingress — Kong is not in front of the frontend, only
`/api/*` traffic goes through Kong. Standard Deployment (with a
PodDisruptionBudget).

- Every route is forced dynamic (`export const dynamic = 'force-dynamic'` in the
  root layout) because the CSP nonce (see below) requires per-request rendering.
- The homepage (`app/page.tsx`) is a Server Component that prefetches public
  above-the-fold data server-side via `fetch(..., { next: { revalidate } })` in
  `src/lib/server-api.ts` (real Next.js Data Cache/ISR semantics), then hydrates
  a fresh, per-request `QueryClient` via `dehydrate`/ `HydrationBoundary` —
  never the client-side singleton, which would leak one request's data into
  another's response.
- CSP is set in `src/proxy.ts`: a per-request nonce with `strict-dynamic`, and
  `connect-src` resolved from `NEXT_PUBLIC_API_URL` at request time rather than
  hardcoded (production and CI point at different API origins).

### api-docs (static nginx)

Internal Swagger UI hub at `https://api-docs.yanatech.co.uk`
(Authentik-protected). Multi-stage Dockerfile: a Go stage runs `swaggo/swag`
against auth-service, a Node stage runs `nest build` + `generate-openapi.js` for
the four NestJS services, `@redocly/cli` renders static HTML, and `nginx:alpine`
serves it. Local dev port `3009` (`pull_policy: build` — rebuilt on every
`docker:up`). Standard Deployment.

### e2e (Playwright)

Auth, portfolio CRUD, and stock-data/chart regression coverage. Chromium +
iPhone 14, Page Object Model, API mocked per-test via `page.route()`.

## Data Ownership & Kafka Topics

Each Kafka topic has exactly one producer and each MongoDB collection has
exactly one owning service — with one deliberate exception: sentiment-analyzer
and ml-predictor both read portfolio-service's `portfolios`/`watchlists`
collections directly (read-only) to build their symbol-tracking universe, rather
than going through an API. sentiment-analyzer rate-limits that read via its
round-robin budget since it feeds an external API call per symbol; ml-predictor
doesn't, since it only reads its own already-collected price history.

| Topic                       | API version           | Partitions | Retention | Producer           | Consumer(s)     |
| --------------------------- | --------------------- | ---------- | --------- | ------------------ | --------------- |
| `users.registered`          | `kafka.strimzi.io/v1` | 3          | 7d        | auth-service       | profile-service |
| `stocks.prices.raw`         | `kafka.strimzi.io/v1` | 3          | 24h       | price-ingestor     | price-processor |
| `stocks.prices.processed`   | `kafka.strimzi.io/v1` | 3          | 7d        | price-processor    | portfolio-api   |
| `stocks.signals.sentiment`  | `kafka.strimzi.io/v1` | 3          | 7d        | sentiment-analyzer | portfolio-api   |
| `stocks.signals.prediction` | `kafka.strimzi.io/v1` | 3          | 7d        | ml-predictor       | portfolio-api   |

`ml-predictor` has no Kafka consumer anywhere in its code — it reads price
history directly from MongoDB. `portfolio-service` has no Kafka producer — it's
consume-only.

**Kafka broker:** `kafka-cluster-kafka-bootstrap.kafka.svc.cluster.local:9092`

## Design Principles

- **Single responsibility** — one service, one bounded concern; within each
  service, a consistent controller→service→repository (or handler→service→db)
  layering.
- **Dependency inversion** — NestJS services depend on constructor-injected
  interfaces, not concrete implementations.
- **Liskov substitution** — repositories are swapped for Jest mocks in tests
  without changing the calling code.
- **Interface segregation** — `packages/shared-types`/`shared-dto` expose only
  what their actual cross-service consumers need, not a superset.
- **Open/closed** — a new Kafka consumer attaches to an existing topic without
  touching the producer's code.

## Frontend Rendering & Caching

See the frontend section above for the SSR/ISR and CSP details. Caching is
deliberately per-endpoint rather than one shared layer:

| Layer                        | TTL                       | Location                              |
| ---------------------------- | ------------------------- | ------------------------------------- |
| Next.js Data Cache           | per-endpoint `revalidate` | `server-api.ts` fetches               |
| TanStack Query               | per-query staleness       | Browser                               |
| Latest price                 | 5s                        | Redis, `price-processor`              |
| On-demand quote/history      | 900s (15 min)             | Redis, `price-processor`              |
| Sentiment (Kafka-populated)  | 86400s (24h)              | Redis, `portfolio-api`                |
| Prediction (Kafka-populated) | 172800s (48h)             | Redis, `portfolio-api`                |
| Price fallback-fetch         | 900s                      | Redis, `portfolio-api`                |
| Market movers                | 10s                       | Redis, `portfolio-api`                |
| Turborepo remote cache       | build-time only           | MinIO-backed, self-hosted (see CI/CD) |

## Observability

- **Distributed tracing:** OpenTelemetry across all three languages, with a
  single `trace_id` spanning a Kafka producer and its consumer. All four NestJS
  services configure
  `CompositePropagator([SentryPropagator, W3CTraceContextPropagator])` with
  `tracesSampleRate: 0` (OpenTelemetry is the sole tracer; Sentry stays
  error-only). auth-service (Go) sets the equivalent composite propagator and
  hand-rolls span injection into Kafka message headers in
  `internal/kafka/publisher.go`, since no official OpenTelemetry package exists
  for `segmentio/kafka-go`. The three Python services wrap their Kafka
  `Producer` with `ConfluentKafkaInstrumentor.instrument_producer(...)` at
  construction time. All traces export to a self-hosted Tempo.
- **Logging:** structured JSON everywhere, shipped via Promtail to Loki.
- **Metrics:** Prometheus via kube-prometheus-stack `ServiceMonitor`s per
  service.
- **Errors:** Sentry across all services.

## Fault Tolerance

- Idempotent Kafka redelivery in price-processor (Mongo upsert on
  `(symbol, timestamp, interval)`).
- Missing-price degradation in portfolio-service (falls back to cost basis).
- price-ingestor's WebSocket reconnect is delegated to the `polygon` SDK, not
  custom code.
- MongoDB replica set; CNPG primary/replica for `auth-service-pg`.
- KEDA `minReplicaCount: 1` on four of the five `ScaledObject` services
  (price-processor, profile-service, portfolio-service, portfolio-api), so none
  of those four scale to zero. `sentiment-analyzer`'s `ScaledObject` is the
  exception, at `minReplicaCount: 0` — it's the one service that actually scales
  to zero. `price-ingestor` has no `ScaledObject` at all: a fixed single replica
  with no autoscaler.
- Argo Rollouts canary analysis (10%→50%→100%) for ml-predictor.

## Tech Stack

| Layer           | Technology                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------- |
| Monorepo        | Turborepo + pnpm workspaces                                                                   |
| auth-service    | Go 1.25 (Chi router, pgx, golang-migrate, HS256 JWT)                                          |
| NestJS services | NestJS, Mongoose, ioredis, KafkaJS, Passport/JWT                                              |
| Frontend        | Next.js 16 App Router, TailwindCSS, TanStack Query, lightweight-charts v5, Recharts           |
| Python services | Python 3.12, FastAPI, HuggingFace Transformers, Facebook Prophet, confluent-kafka             |
| Databases       | PostgreSQL 16 (auth), MongoDB 8 (OHLCV/portfolios/profiles), Redis 8 (cache/tokens)           |
| Messaging       | Kafka (Redpanda locally, Strimzi in production)                                               |
| ML storage      | MinIO (`yana-stocks-models` bucket)                                                           |
| Observability   | OpenTelemetry (traces) + Tempo, Loki + Promtail (logs), Prometheus (metrics), Sentry (errors) |
| Data source     | Massive (Polygon.io) Starter — US prices; FMP — news/analyst; Twelve Data Grow — UK           |

## External APIs

| API                                                                | Plan              | Env var                                     | Free tier available?                                                                           | Used by                                                                                                           | Base URL                                                               |
| ------------------------------------------------------------------ | ----------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Massive (Polygon.io)](https://polygon.io)                         | Starter, $29/mo   | `MASSIVE_API_KEY`                           | No — Polygon's free tier has no real-time WebSocket and 5 req/min REST, unusable here          | `price-ingestor` (WS), `price-processor` (REST history/quotes), `portfolio-api` (`/market/assets` US/ETF listing) | `https://api.polygon.io` (REST) / `starterfeed.polygon.io` (WebSocket) |
| [Financial Modeling Prep (FMP)](https://financialmodelingprep.com) | Starter           | `FMP_API_KEY`                               | Yes — free tier is 250 req/day, upgraded to Starter (~300 req/min, no daily cap) on 2026-07-24 | `sentiment-analyzer` (news), `portfolio-api` (analyst ratings, sector performance, screener, movers fallback)     | `https://financialmodelingprep.com/stable`                             |
| [Twelve Data](https://twelvedata.com)                              | Grow              | `TWELVE_DATA_API_KEY`                       | Yes — free tier is ~8 req/min, 800/day, but on paid Grow plan                                  | `price-processor` (UK/international history+quotes), `portfolio-api` (FTSE 100 sector rotation)                   | `https://api.twelvedata.com`                                           |
| [HuggingFace](https://huggingface.co) (`ProsusAI/finbert`)         | N/A — self-hosted | `HUGGINGFACE_MODEL` (model name, not a key) | Effectively free always — downloaded model run locally, not a metered API call                 | `sentiment-analyzer`                                                                                              | `https://huggingface.co/ProsusAI/finbert`                              |

Nothing here currently runs on a free plan — all three paid providers were
upgraded off their free tiers as usage grew. Sentry is excluded from this table.

## Prerequisites

- Node.js ≥ 24
- pnpm ≥ 11
- Go ≥ 1.22 (`auth-service`'s `go.mod` pins `go 1.25.0`)
- Docker + Docker Compose
- Python 3.12 (for services in `services/`)

## Local Development

### 1. Start infrastructure

```bash
pnpm docker:up
```

This starts Redpanda (Kafka, port 19092), MongoDB (27017), Redis (6379),
PostgreSQL (5432), MinIO (9000/9001), and the api-docs Swagger hub (3009). The
api-docs image is rebuilt automatically on every `docker:up`.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Seed dev data

```bash
pnpm seed   # creates dev@example.com in PostgreSQL auth tables (idempotent)
```

> After `pnpm docker:reset` (volume wipe), re-run `pnpm seed`. MongoDB enforces
> auth on fresh volumes — `.env.example` files already include credentials.

### 4. Configure environment

Copy and fill in `.env` files for each service you're running:

```bash
cp apps/auth-service/.env.example apps/auth-service/.env
cp apps/profile-service/.env.example apps/profile-service/.env
cp apps/portfolio-api/.env.example apps/portfolio-api/.env
```

auth-service runs database migrations automatically at startup via
golang-migrate.

### 5. Start services

```bash
# All services in parallel (Turborepo)
pnpm dev

# Single service
pnpm --filter @yana-stocks/auth-service dev    # :3004 (go run ./cmd/server)
pnpm --filter @yana-stocks/profile-service dev # :3007
pnpm --filter price-processor dev
```

`pnpm dev`'s backend half is `turbo run dev --filter=!frontend`, which
auto-includes every service with a `dev` script. As an alternative to
`next dev`, `pnpm build && pnpm start` runs the frontend via `next start` for a
realistic production build — useful for local Lighthouse runs, since
`next start`'s API rewrites are intentionally empty in production (real prod
expects Kong in front) so only the homepage's server-prefetched public data
works without a local Kong/API-gateway shim in front.

## Scripts

| Command             | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`          | Start all services in watch mode                                           |
| `pnpm build`        | Build all packages and services                                            |
| `pnpm test`         | Run all unit/integration tests                                             |
| `pnpm lint`         | Lint all packages (always runs, no turbo cache)                            |
| `pnpm type-check`   | TypeScript type-check all packages                                         |
| `pnpm format`       | Format all files with Prettier (write)                                     |
| `pnpm format:check` | Check formatting without writing                                           |
| `pnpm audit`        | `pnpm audit --audit-level=high` — fail on high/critical CVEs               |
| `pnpm scan`         | `gitleaks detect --redact` — scan full git history for secrets             |
| `pnpm scan:code`    | Dead code and unused dependency scan (Knip)                                |
| `pnpm seed`         | Seed dev user (`dev@example.com`) into PostgreSQL auth tables (idempotent) |
| `pnpm docker:up`    | Start local infrastructure                                                 |
| `pnpm docker:down`  | Stop local infrastructure                                                  |
| `pnpm docker:reset` | Destroy volumes and restart fresh (run `pnpm seed` afterwards)             |

A **pre-commit hook** (husky + lint-staged) runs on every `git commit`:

1. **Prettier** — auto-formats all staged `*.{ts,tsx,js,mjs,json,md,css}` files
2. **Type-check** — `turbo type-check --filter=[HEAD^1]` on changed packages
   only
3. **Gitleaks** — `gitleaks protect --staged --redact` (skips with a warning if
   not installed; install with `brew install gitleaks`)

A **pre-push hook** runs `turbo lint --filter=[origin/main]`,
`pnpm audit --audit-level=high`, and `pnpm scan:code` — slower checks reserved
for push rather than every commit.

## Auth Flow

auth-service (Go) owns all authentication. profile-service (NestJS) owns display
data.

```
POST /api/auth/register  →  auth-service: create user, send verification email (via shared-services' email-api)
                             publishes users.registered Kafka event → profile-service creates profile
POST /api/auth/verify    →  auth-service: activate account
POST /api/auth/login     →  auth-service: returns accessToken (HS256 JWT 15min, iss:'yana-stocks')
                                        + refreshToken (opaque 7d, Redis)
POST /api/auth/refresh   →  auth-service: rotate refresh token, issue new access token
POST /api/auth/logout    →  auth-service: delete refresh token from Redis
GET  /api/auth/me        →  auth-service: current user identity (requires JWT)

POST /api/auth/password/reset-request  →  always returns 200 (no email enumeration);
                                           if the email exists, stores a 1h single-use
                                           Redis token and sends a reset email
POST /api/auth/password/reset          →  validates the Redis token, updates the password
                                           hash, deletes the token

GET    /api/auth/mfa         →  MFA enabled status (JWT)
POST   /api/auth/mfa/setup   →  generate a TOTP secret (JWT)
POST   /api/auth/mfa/enable  →  verify a TOTP code and activate MFA (JWT)
POST   /api/auth/mfa/verify  →  complete login with a TOTP code (public — second auth step)
DELETE /api/auth/mfa         →  disable MFA (JWT)

GET  /api/profile/me     →  profile-service: display name, avatar, bio, preferences
PUT  /api/profile/me     →  profile-service: update profile
```

Kong's JWT plugin reads the `iss` claim, matches it to the `yana-stocks` HS256
credential, and verifies the signature.

## API Gateway Routes (Kong)

The frontend is **not** routed through Kong — it has its own
`ingressClassName: nginx` Ingress for `stocks.yanatech.co.uk`. Kong only
gateways `/api/*` traffic.

| Path                                                                                                                                                                                         | Service              | Auth |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---- |
| `/api/auth/register`, `/api/auth/verify`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/password/reset-request`, `/api/auth/password/reset`, `/api/auth/mfa/verify` | auth-service:3000    | None |
| `/api/auth/me`, `/api/auth/password`, `/api/auth/account`, `/api/auth/mfa` (GET/POST/DELETE), `/api/auth/mfa/setup`, `/api/auth/mfa/enable`                                                  | auth-service:3000    | JWT  |
| `/api/profile/me`                                                                                                                                                                            | profile-service:3000 | JWT  |
| `/api/profile/*`                                                                                                                                                                             | profile-service:3000 | None |
| `/api/market/*`                                                                                                                                                                              | portfolio-api:3000   | None |
| `/api/stocks/*`                                                                                                                                                                              | portfolio-api:3000   | JWT  |
| `/api/signals/*`                                                                                                                                                                             | portfolio-api:3000   | JWT  |
| `/api/portfolio/*`                                                                                                                                                                           | portfolio-api:3000   | JWT  |
| `/api/news/*`                                                                                                                                                                                | portfolio-api:3000   | JWT  |
| `/api/predict/*`                                                                                                                                                                             | ml-predictor:8000    | JWT  |

`/api/portfolio/*` is handled by `portfolio-api`, which internally proxies to
`portfolio-service`. In dev (no Kong), portfolio-api also proxies `/api/auth/*`
and `/api/profile/*` to auth-service and profile-service respectively.

## Testing

```bash
# Unit + integration
pnpm test

# E2E (requires running services)
pnpm --filter e2e test:e2e

# Single service
pnpm --filter @yana-stocks/auth-service test
pnpm --filter @yana-stocks/profile-service test
```

Three layers: unit (Jest across the NestJS services and the frontend, pytest
across the three Python services, one Go test file for auth-service),
integration (`*.int.spec.ts` per NestJS service — most run against real
`ioredis`/Mongoose connections; profile-service's is the exception, mocking the
whole service via `overrideProvider`), and E2E (Playwright, Chromium + iPhone
14, Page Object Model — API assertions are mostly `page.route`-mocked, not
live).

Coverage gates are configured per service, not globally:

| Service           | Coverage gate                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| portfolio-api     | 87% (Jest `coverageThreshold`)                                                                  |
| price-processor   | 42% (Jest `coverageThreshold`)                                                                  |
| portfolio-service | 40% (Jest `coverageThreshold`)                                                                  |
| profile-service   | 26% (Jest `coverageThreshold`)                                                                  |
| auth-service      | 15% (an `awk` check in `package.json`'s `test:cov` script, dispatched via `turbo run test:cov`) |

## CI/CD

`.github/workflows/ci.yml` job graph, in dependency order:

```
changes
  ├─→ gitleaks-secret-scan ─┐
  └─→ trivy-image-scan ─────┤
                            ├─→ ts-quality ─→ integration-tests ─→ e2e-tests (Playwright + Lighthouse CI)
                            ├─→ knip-code-scan
                            ├─→ pnpm-audit
                            └─→ python-quality
                                    │
                                    ▼
                                 docker  (needs every job above, including
                                          gitleaks-secret-scan and
                                          trivy-image-scan, to succeed —
                                          neither may be skipped)
                                    │
                                    ▼
                                 gitops  (patches image tags in k8s-apps)
```

Turborepo's `--filter=[HEAD^1]` scopes builds to changed services. Lighthouse CI
runs as a step inside `e2e-tests`, against the freshly-built, freshly-seeded
local stack.

A **separate**, manually-triggered `.github/workflows/e2e.yml` (`base_url`
input) runs Playwright against a real deployed target such as staging — this is
independent of `ci.yml`'s self-contained `e2e-tests` job, which spins up its own
local stack.

Turborepo also uses a self-hosted, MinIO-backed remote cache
(`ducktors/turborepo-remote-cache`, bucket `turborepocache`), deployed via
`k8s-apps`' `apps/yana-stocks/turbo-cache/` manifests.

## Production Infrastructure

| Resource | Address                                                      |
| -------- | ------------------------------------------------------------ |
| Kafka    | `kafka-cluster-kafka-bootstrap.kafka.svc.cluster.local:9092` |
| MongoDB  | `mongodb-headless.mongodb.svc.cluster.local:27017`           |
| Redis    | `redis-master.redis.svc.cluster.local:6379`                  |
| MinIO    | `minio.minio.svc.cluster.local:9000`                         |
| Frontend | `https://stocks.yanatech.co.uk`                              |

Kubernetes manifests live in the `k8s-apps` repo (`github.com/akann/k8s-apps`).
Notable patterns:

- **KEDA ScaledObjects** — sentiment-analyzer, price-processor, profile-service,
  portfolio-service, and portfolio-api scale on Kafka consumer lag. Only
  sentiment-analyzer scales to zero (`minReplicaCount: 0`); the other four hold
  at `minReplicaCount: 1`. price-ingestor runs a fixed single replica with no
  autoscaler at all.
- **Argo Rollouts canary** — ml-predictor promotes 10% → 50% → 100% on new model
  versions.
- **CNPG** — CloudNativePG cluster `auth-service-pg` (2 instances) for
  PostgreSQL; migrations run at pod startup via golang-migrate (no
  initContainer).
- **ESO** — ExternalSecrets pulls from Infisical project `k8s-homelab`.
- **api-docs** — static nginx serving per-service Swagger UIs at
  `api-docs.yanatech.co.uk` (Authentik-protected); covers portfolio-api,
  portfolio-service, profile-service, price-processor, and auth-service.
- **turbo-cache** — a `ducktors/turborepo-remote-cache` Deployment fronting the
  MinIO-backed Turborepo cache; a build-time dependency for CI, not a runtime
  dependency of the app itself.

## Known Limitations

- Lighthouse CI's Core Web Vitals budgets are `warn`-level, not `error`; CLS
  sits at the 0.1 good/needs-improvement boundary.
- auth-service's coverage gate is 15%, the lowest of any service — its crypto
  and token-handling internals are largely untested.
- profile-service's integration suite mocks the whole service via
  `overrideProvider` rather than exercising real dependencies, unlike the other
  three NestJS services' integration suites.
- No coverage gate exists for the frontend.

## Roadmap

`FUTURE_PLAN.md` documents the full 16-step build plan (Steps 0–15); all steps
are complete.
