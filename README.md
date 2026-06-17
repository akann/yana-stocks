# yana-stocks

Production-grade microservices platform for real-time stock market data,
portfolio management, sentiment analysis, and ML-based price prediction. Runs on
a self-hosted Kubernetes cluster managed via ArgoCD GitOps.

> **Live app:** [stocks.yanatech.co.uk](https://stocks.yanatech.co.uk) · **K8s
> manifests:** [github.com/akann/k8s-apps](https://github.com/akann/k8s-apps)

## Architecture

```
apps/
├── frontend/           # Next.js 14 (App Router) — dashboard UI
├── auth-service/       # Go (Chi) — registration, email verification, JWT, refresh tokens (PostgreSQL)
├── profile-service/    # NestJS — non-PII display data: displayName, avatar, bio, preferences (MongoDB)
├── price-processor/    # NestJS — consume raw prices, store OHLCV, cache
├── portfolio-service/  # NestJS — portfolios, watchlists, trades (MongoDB)
├── portfolio-api/      # NestJS — REST aggregator (prices + signals + predictions)
└── e2e/                # Playwright end-to-end tests

services/
├── price-ingestor/     # Python — poll Alpaca API, publish to Kafka
├── sentiment-analyzer/ # Python — FinBERT NLP on news feed
└── ml-predictor/       # Python — LSTM/Prophet price prediction, REST + Kafka

packages/
├── shared-types/       # TypeScript interfaces (Stock, OHLCV, Portfolio, etc.)
├── shared-dto/         # Shared validation DTOs
├── kafka-client/       # Kafka config + topic constants
├── typescript-config/  # Shared tsconfig bases
├── eslint-config/      # Shared ESLint config
└── prettier-config/    # Shared Prettier config
```

## Tech Stack

| Layer           | Technology                                                                          |
| --------------- | ----------------------------------------------------------------------------------- |
| Monorepo        | Turborepo + pnpm workspaces                                                         |
| auth-service    | Go (Chi router, pgx, golang-migrate, HS256 JWT)                                     |
| NestJS services | NestJS, Mongoose, ioredis, KafkaJS, Passport/JWT                                    |
| Frontend        | Next.js 14 App Router, TailwindCSS, TanStack Query, Recharts                        |
| Python services | Python 3.12, FastAPI, HuggingFace Transformers, Facebook Prophet, confluent-kafka   |
| Databases       | PostgreSQL 16 (auth), MongoDB 8 (OHLCV/portfolios/profiles), Redis 8 (cache/tokens) |
| Messaging       | Kafka (Redpanda locally, Strimzi in production)                                     |
| ML storage      | MinIO (`yana-stocks-models` bucket)                                                 |
| Data source     | Alpaca Markets free tier (paper trading)                                            |

## Prerequisites

- Node.js ≥ 24
- pnpm ≥ 11
- Go ≥ 1.22 (for auth-service)
- Docker + Docker Compose
- Python 3.12 (for services in `services/`)

## Local Development

### 1. Start infrastructure

```bash
pnpm docker:up
```

This starts Redpanda (Kafka, port 19092), MongoDB (27017), Redis (6379),
PostgreSQL (5432), and MinIO (9000/9001).

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

Copy and fill in `.env` files for each service you're running:

```bash
cp apps/auth-service/.env.example apps/auth-service/.env
cp apps/profile-service/.env.example apps/profile-service/.env
cp apps/portfolio-api/.env.example apps/portfolio-api/.env
```

auth-service runs database migrations automatically at startup via
golang-migrate.

### 4. Start services

```bash
# All services in parallel (Turborepo)
pnpm dev

# Single service
pnpm --filter @yana-stocks/auth-service dev    # :3004 (go run ./cmd/server)
pnpm --filter @yana-stocks/profile-service dev # :3007
pnpm --filter price-processor dev
```

## Scripts

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `pnpm dev`          | Start all services in watch mode   |
| `pnpm build`        | Build all packages and services    |
| `pnpm test`         | Run all unit/integration tests     |
| `pnpm lint`         | Lint all packages                  |
| `pnpm type-check`   | TypeScript type-check all packages |
| `pnpm format`       | Format all files with Prettier     |
| `pnpm docker:up`    | Start local infrastructure         |
| `pnpm docker:down`  | Stop local infrastructure          |
| `pnpm docker:reset` | Destroy volumes and restart fresh  |

## Kafka Topics

| Topic                       | Partitions | Retention | Producer           | Consumer(s)                 |
| --------------------------- | ---------- | --------- | ------------------ | --------------------------- |
| `stocks.prices.raw`         | 3          | 24h       | price-ingestor     | price-processor             |
| `stocks.prices.processed`   | 3          | 7d        | price-processor    | ml-predictor, portfolio-api |
| `stocks.signals.sentiment`  | 3          | 7d        | sentiment-analyzer | portfolio-api               |
| `stocks.signals.prediction` | 3          | 7d        | ml-predictor       | portfolio-api               |
| `stocks.portfolio.events`   | 3          | 30d       | portfolio-service  | price-processor             |

## Auth Flow

auth-service (Go) owns all authentication. profile-service (NestJS) owns display
data.

```
POST /api/auth/register  →  auth-service: create user, send verification email (SMTP2GO)
                             publishes users.registered Kafka event → profile-service creates profile
POST /api/auth/verify    →  auth-service: activate account
POST /api/auth/login     →  auth-service: returns accessToken (HS256 JWT 15min, iss:'yana-stocks')
                                        + refreshToken (opaque 7d, Redis)
POST /api/auth/refresh   →  auth-service: rotate refresh token, issue new access token
POST /api/auth/logout    →  auth-service: delete refresh token from Redis
GET  /api/auth/me        →  auth-service: current user identity (requires JWT)
GET  /api/profile/me     →  profile-service: display name, avatar, bio, preferences
PUT  /api/profile/me     →  profile-service: update profile
```

Kong JWT plugin reads the `iss` claim, matches it to the `yana-stocks` HS256
credential, and verifies the signature. All `/api/*` routes require JWT except
the auth endpoints above and `/api/market/*`.

## API Gateway Routes (Kong)

| Path                                                                                                 | Service              | Auth   |
| ---------------------------------------------------------------------------------------------------- | -------------------- | ------ |
| `/api/auth/register`, `/api/auth/verify`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` | auth-service:3000    | None   |
| `/api/auth/me`                                                                                       | auth-service:3000    | JWT    |
| `/api/profile/me`, `/api/profile/:userId`                                                            | profile-service:3000 | JWT    |
| `/api/market/*`                                                                                      | portfolio-api:3000   | None   |
| `/api/stocks/*`                                                                                      | portfolio-api:3000   | JWT    |
| `/api/signals/*`                                                                                     | portfolio-api:3000   | JWT    |
| `/api/portfolio/*`                                                                                   | portfolio-api:3000   | JWT    |
| `/api/news/*`                                                                                        | portfolio-api:3000   | JWT    |
| `/api/predict/*`                                                                                     | ml-predictor:8000    | JWT    |
| `/*`                                                                                                 | frontend:3000        | Public |

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

E2E tests use Playwright with Chromium and iPhone 14 (Page Object Model
pattern).

## CI/CD

GitHub Actions builds only changed services using `turbo --filter=[HEAD^1]`. On
success:

1. Docker image pushed to `harbor.yanatech.co.uk/yana-stocks/<service>:<tag>`
2. Image tag updated in `k8s-apps` repo
3. ArgoCD auto-syncs to the cluster
4. Playwright E2E runs against staging before production deploy

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

- **KEDA ScaledObjects** — `price-ingestor`, `sentiment-analyzer` scale on Kafka
  consumer lag
- **Argo Rollouts canary** — `ml-predictor` promotes 10% → 50% → 100% on new
  model versions
- **CNPG** — CloudNativePG cluster `auth-service-pg` for PostgreSQL
  (auth-service)
- **ESO** — ExternalSecrets pulls from Infisical project `k8s-homelab`
