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
- Kafka: Sarama — publishes `users.registered` event on registration
- Email: POSTs to `shared-services`' `email-api` (Kong, key-auth) — no longer
  talks to SMTP2GO directly

### NestJS Services

- Framework: NestJS (latest)
- MongoDB ORM: Mongoose via `@nestjs/mongoose`
- Redis: ioredis
- Kafka: KafkaJS via `@nestjs/microservices`
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

- **Purpose:** Poll Alpaca API for real-time stock prices, publish to Kafka
- **Kafka producer:** `stocks.prices.raw`
- **Data source:** Alpaca Markets free tier (paper trading API)
- **Pattern:** KEDA ScaledObject (scale 0→N based on Kafka consumer lag)
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

### 3. sentiment-analyzer (Python)

- **Purpose:** Consume news feed, run FinBERT NLP, publish sentiment signals
- **Kafka producer:** `stocks.signals.sentiment`
- **MongoDB:** Store articles + sentiment scores
- **Pattern:** KEDA ScaledObject (scale based on queue depth)
- **Model:** `ProsusAI/finbert` from HuggingFace

### 4. ml-predictor (Python)

- **Purpose:** Price prediction using LSTM/Prophet, serve via REST + Kafka
- **Kafka producer:** `stocks.signals.prediction`
- **MongoDB:** Store predictions
- **MinIO:** Store trained model artifacts (`yana-stocks-models` bucket)
- **Pattern:** Argo Rollouts canary (10%→50%→100% on new model version)
- **REST:** `/api/predict/:symbol`

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
- **Kafka consumer:** `stocks.prices.processed` (for portfolio valuation),
  `users.registered`
- **Kafka producer:** `stocks.portfolio.events`
- **Pattern:** KEDA ScaledObject (scale 1→3, triggers on
  `stocks.prices.processed` + `users.registered` lag; min 1 — serves HTTP
  traffic)
- **Endpoints:**
  - `GET/POST /portfolios`
  - `GET/PUT/DELETE /portfolios/:id`
  - `POST /portfolios/:id/stocks`
  - `GET/POST /watchlists`
  - `GET /trades`

### 7. portfolio-api (NestJS)

- **Purpose:** REST aggregator — combines prices, signals, predictions
- **Redis:** Cache aggregated responses (TTL 10s)
- **Pattern:** KEDA ScaledObject (scale 1→3, triggers on
  `stocks.prices.processed` + `stocks.signals.sentiment` +
  `stocks.signals.prediction` lag; min 1 — serves HTTP traffic)
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
- **Dev proxy:** `next.config.mjs` rewrites `/api/*` to local services (see
  frontend env vars)
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

| Topic                       | API version         | Partitions | Retention | Producer           | Consumer(s)                 |
| --------------------------- | ------------------- | ---------- | --------- | ------------------ | --------------------------- |
| `users.registered`          | kafka.strimzi.io/v1 | 3          | 7d        | auth-service       | profile-service             |
| `stocks.prices.raw`         | kafka.strimzi.io/v1 | 3          | 24h       | price-ingestor     | price-processor             |
| `stocks.prices.processed`   | kafka.strimzi.io/v1 | 3          | 7d        | price-processor    | ml-predictor, portfolio-api |
| `stocks.signals.sentiment`  | kafka.strimzi.io/v1 | 3          | 7d        | sentiment-analyzer | portfolio-api               |
| `stocks.signals.prediction` | kafka.strimzi.io/v1 | 3          | 7d        | ml-predictor       | portfolio-api               |
| `stocks.portfolio.events`   | kafka.strimzi.io/v1 | 3          | 30d       | portfolio-service  | price-processor             |

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

```shell
# Public auth routes (cors plugin only)
/api/auth/register                  → auth-service:3000    (Exact)
/api/auth/verify                    → auth-service:3000    (Exact)
/api/auth/login                     → auth-service:3000    (Exact)
/api/auth/refresh                   → auth-service:3000    (Exact)
/api/auth/logout                    → auth-service:3000    (Exact)
/api/auth/password/reset-request    → auth-service:3000    (Exact)
/api/auth/password/reset            → auth-service:3000    (Exact)

# JWT-protected auth routes
/api/auth/me        → auth-service:3000    (Exact, jwt-auth+cors)
/api/auth/password  → auth-service:3000    (Exact, jwt-auth+cors — change password)
/api/auth/account   → auth-service:3000    (Exact, jwt-auth+cors — delete account)

# JWT-protected profile routes
/api/profile/*      → profile-service:3000 (Prefix, jwt-auth+cors)

# Public API routes
/api/market/*       → portfolio-api:3000   (Prefix, cors only — shown on unauthenticated homepage)

# JWT-protected API routes
/api/stocks/*       → portfolio-api:3000   (Prefix, jwt-auth+cors)
/api/signals/*      → portfolio-api:3000   (Prefix, jwt-auth+cors)
/api/portfolio/*    → portfolio-api:3000   (Prefix, jwt-auth+cors — portfolio-api proxies to portfolio-service)
/api/news/*         → portfolio-api:3000   (Prefix, jwt-auth+cors)
/api/predict/*      → ml-predictor:8000    (Prefix, jwt-auth+cors)

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
  PORTFOLIO_EVENTS: 'stocks.portfolio.events',
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
├── profile-service/
│   ├── external-secret.yaml       # MONGODB_URI, KAFKA_BROKERS
│   ├── deployment.yaml
│   └── service.yaml
├── price-ingestor/                # KEDA ScaledObject
├── price-processor/
├── sentiment-analyzer/            # KEDA ScaledObject
├── ml-predictor/                  # Argo Rollouts canary (no deployment.yaml)
├── portfolio-service/
├── portfolio-api/
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
- **Alpaca API:** `https://data.alpaca.markets` (free tier, paper trading)

## Kubernetes Patterns

- **KEDA:** `price-ingestor`, `sentiment-analyzer` — scale on Kafka consumer lag
- **Argo Rollouts:** `ml-predictor` — canary 10%→50%→100%
- **Standard Deployment:** all other services
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
- Logging: NestJS built-in logger, structured JSON in production

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
PRICE_PROCESSOR_URL=http://price-processor:3000
ML_PREDICTOR_URL=http://ml-predictor:8000
PORT=3006                                      # dev only; prod uses 3000
```

### price-ingestor (Python)

```shell
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
ALPACA_BASE_URL=https://data.alpaca.markets
KAFKA_BROKERS=...
SYMBOLS=AAPL,GOOGL,MSFT,AMZN,TSLA,NVDA,META,JPM,V,JNJ
```

### sentiment-analyzer (Python)

```shell
KAFKA_BROKERS=...
MONGODB_URI=mongodb://...
NEWS_API_KEY=...             # NewsAPI.org free tier
HUGGINGFACE_MODEL=ProsusAI/finbert
```

### ml-predictor (Python)

```shell
KAFKA_BROKERS=...
MONGODB_URI=mongodb://...
MINIO_ENDPOINT=minio.minio.svc.cluster.local:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=yana-stocks-models
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
- Kafka producer for stocks.portfolio.events
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

- **Free tier:** 250 requests/day
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

| Bug                                                 | Root cause                                                                                                                                                                                                                      | Fix                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart goes blank when toggling Candle ↔ Line        | `chartType` missing from data effect deps — new series created but not populated (same `data` ref, effect skipped)                                                                                                              | Added `chartType` to `useEffect` deps array in `StockChart.tsx`                                                                                                                                     |
| lightweight-charts crash (`ensureNotNull`) on 6M/1Y | MongoDB stores duplicate daily bars at different UTC offsets (T00, T04, T05); same YYYY-MM-DD maps to duplicate `time` keys                                                                                                     | Backend dedup in `getHistory` (keeps highest UTC per date); frontend defensive dedup before `setData()`                                                                                             |
| Volume bars invisible on 1D range                   | 390 bars in ~600px = ~1.5px/bar, below `HistogramSeries` render threshold                                                                                                                                                       | `minBarSpacing: 2` in `timeScale` options                                                                                                                                                           |
| Market dashboard shows only NVDA                    | `getMovers()` scans `papi:price:*` Redis keys — only symbols streamed via Kafka or previously visited have entries                                                                                                              | `getMovers()` now mget-checks 15 default symbols and fetches missing quotes via Polygon snapshot before scanning                                                                                    |
| MACD signal scan only emitted current-bar crossover | `detectSignals()` compared only the last 2 `signalLine` entries; all historical crossovers were missed                                                                                                                          | Loop in `signals.ts` changed to `for (let i = 1; i < n; i++)` — scans all bars; MACD arrows now appear throughout chart history                                                                     |
| `chart.subscribeClick is not a function` in Jest    | `src/__mocks__/lightweight-charts.js` `mockChart` was missing `subscribeClick` and `unsubscribeClick` methods; `StockChart.tsx:256` calls `chart.subscribeClick()` for news headline popup                                      | Added `subscribeClick: jest.fn()` and `unsubscribeClick: jest.fn()` to `mockChart` in the mock file                                                                                                 |
| S&P 500 treemap flashes "No data" before overview   | `isLoading` gated only on `rotLoading`; when rotation resolved empty, `TreemapView` rendered with an empty `pctMap` for one cycle before `overviewData` arrived                                                                 | Widened `isLoading` to include `overviewLoading` in the narrow case: S&P 500 + today view + rotation empty + overview in flight                                                                     |
| `GET /api/stocks/:symbol/history` returns 500       | `price-processor` KEDA ScaledObject had `minReplicaCount: 0`; scales to 0 outside trading hours; Cilium returns `EPERM` when `portfolio-api` connects to a Service with no endpoints                                            | Set `minReplicaCount: 1` in `k8s-apps/apps/yana-stocks/price-processor/keda-scaledobject.yaml`                                                                                                      |
| Dashboard "Total Portfolio Value" shows $0.00       | Holdings valued at `shares × latestPrice`, but `latestPrice` is only written by the `stocks.prices.processed` Kafka consumer — never populated when the price pipeline isn't streaming (local dev, market closed, fresh deploy) | `portfolio-service` `toResponse()` falls back to `avgCostBasis` when `latestPrice` is unset (same rule the portfolio page applies client-side); `addStock` seeds `latestPrice` with the trade price |

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
