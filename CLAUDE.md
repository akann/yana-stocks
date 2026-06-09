# yana-stocks — Claude Code Instructions

## Project Overview
`yana-stocks` is a production-grade microservices application for real-time stock market data, portfolio management, sentiment analysis, and ML-based price prediction. It runs on a self-hosted Kubernetes cluster managed via ArgoCD GitOps.

## Monorepo Structure
Turborepo + pnpm workspaces.

```
yana-stocks/
├── apps/
│   ├── frontend/              # Next.js 14 (App Router)
│   ├── price-processor/       # NestJS
│   ├── user-service/          # NestJS
│   ├── portfolio-service/     # NestJS
│   ├── portfolio-api/         # NestJS
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

### NestJS Services
- Framework: NestJS (latest)
- PostgreSQL ORM: Prisma (`user-service` only)
- MongoDB ORM: Mongoose via `@nestjs/mongoose`
- Redis: ioredis
- Kafka: KafkaJS via `@nestjs/microservices`
- Validation: `class-validator` + `class-transformer`
- Auth: `@nestjs/jwt` + `@nestjs/passport`
- Docs: `@nestjs/swagger`
- Config: `@nestjs/config`

### Frontend
- Next.js 14 (App Router)
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

### 5. user-service (NestJS)
- **Purpose:** User registration, login, JWT auth, refresh tokens
- **PostgreSQL (CNPG):** Users, refresh token store
- **Redis:** Refresh token blacklist
- **JWT:** Access token 15min (stateless), refresh token 7 days (Redis, revocable)
- **Refresh token rotation:** New refresh token issued on every use
- **Endpoints:**
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `GET /auth/me`

### 6. portfolio-service (NestJS)
- **Purpose:** Portfolio and watchlist management, trade history
- **MongoDB:** Portfolios, watchlists, trades
- **Kafka consumer:** `stocks.prices.processed` (for portfolio valuation)
- **Kafka producer:** `stocks.portfolio.events`
- **Endpoints:**
  - `GET/POST /portfolios`
  - `GET/PUT/DELETE /portfolios/:id`
  - `POST /portfolios/:id/stocks`
  - `GET/POST /watchlists`
  - `GET /trades`

### 7. portfolio-api (NestJS)
- **Purpose:** REST aggregator — combines prices, signals, predictions
- **Redis:** Cache aggregated responses (TTL 10s)
- **Endpoints:**
  - `GET /stocks/:symbol` — price + sentiment + prediction
  - `GET /stocks/:symbol/history` — OHLCV history
  - `GET /signals/:symbol` — latest signals
  - `GET /market/movers` — top gainers/losers

### 8. frontend (Next.js 14)
- **Purpose:** Dashboard UI
- **Routes:**
  - `/` — market overview, top movers
  - `/dashboard` — user portfolio summary
  - `/stocks/:symbol` — price chart, signals, prediction
  - `/portfolio` — portfolio management
  - `/watchlist` — watchlist
  - `/login`, `/register`
- **URL:** `https://stocks.yanatech.co.uk`

### 9. e2e (Playwright)
- **Purpose:** End-to-end tests
- **Coverage:** Auth flows, portfolio CRUD, stock data display
- **Config:** Chromium + iPhone 14 (mobile)
- **Pattern:** Page Object Model

## Kafka Topics

| Topic | API version | Partitions | Retention | Producer | Consumer(s) |
|---|---|---|---|---|---|
| `stocks.prices.raw` | kafka.strimzi.io/v1 | 3 | 24h | price-ingestor | price-processor |
| `stocks.prices.processed` | kafka.strimzi.io/v1 | 3 | 7d | price-processor | ml-predictor, portfolio-api |
| `stocks.signals.sentiment` | kafka.strimzi.io/v1 | 3 | 7d | sentiment-analyzer | portfolio-api |
| `stocks.signals.prediction` | kafka.strimzi.io/v1 | 3 | 7d | ml-predictor | portfolio-api |
| `stocks.portfolio.events` | kafka.strimzi.io/v1 | 3 | 30d | portfolio-service | price-processor |

**Kafka broker:** `kafka-cluster-kafka-bootstrap.kafka.svc.cluster.local:9092`

## Auth Flow
```
POST /auth/login
  → user-service validates credentials
  → returns { accessToken (JWT 15min), refreshToken (opaque 7d) }
  → refreshToken stored in Redis with userId

POST /auth/refresh
  → validates refreshToken in Redis
  → issues new accessToken + new refreshToken (rotation)
  → old refreshToken deleted from Redis

POST /auth/logout
  → deletes refreshToken from Redis

Kong JWT plugin validates accessToken on all /api/* except /auth/*
```

## Kong Routes (k8s-apps repo)
```
/api/auth/*      → user-service:3000        (no JWT)
/api/stocks/*    → portfolio-api:3000       (JWT required)
/api/portfolio/* → portfolio-service:3000   (JWT required)
/api/predict/*   → ml-predictor:8000        (JWT required)
/*               → frontend:3000            (public)
```

## Shared Packages

### packages/shared-types
TypeScript interfaces used across all services and frontend:
```typescript
Stock, OHLCV, Portfolio, Trade, Watchlist, User,
SentimentSignal, PredictionSignal, KafkaMessage
```

### packages/shared-dto
Validation DTOs shared between services:
```typescript
CreatePortfolioDto, AddStockDto, RegisterDto, LoginDto
```

### packages/kafka-client
```typescript
KAFKA_TOPICS = {
  PRICES_RAW: 'stocks.prices.raw',
  PRICES_PROCESSED: 'stocks.prices.processed',
  SIGNALS_SENTIMENT: 'stocks.signals.sentiment',
  SIGNALS_PREDICTION: 'stocks.signals.prediction',
  PORTFOLIO_EVENTS: 'stocks.portfolio.events',
}
```

### packages/typescript-config
- `base.json` — common settings
- `nestjs.json` — extends base, NestJS-specific decorators
- `nextjs.json` — extends base, Next.js-specific

## Infrastructure (in k8s-apps repo)

**k8s-apps repo:** `github.com/akann/k8s-apps` (local at `~/repo/k8s-apps` on k8s-cp-1)

New resources needed in k8s-apps:
```
apps/yana-stocks/
├── namespace.yaml
├── argocd-app-yana-stocks.yaml    # app-of-apps
├── price-ingestor/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── keda-scaledobject.yaml
│   └── external-secret.yaml
├── price-processor/
├── sentiment-analyzer/
├── ml-predictor/
│   ├── rollout.yaml               # Argo Rollouts
│   └── analysis-template.yaml
├── user-service/
│   ├── cnpg-cluster.yaml          # separate CNPG cluster
│   └── external-secret.yaml
├── portfolio-service/
├── portfolio-api/
└── frontend/
    └── ingress.yaml               # stocks.yanatech.co.uk
```

## Local Dev Infrastructure (docker-compose.yml)
```yaml
services:
  kafka:         # Redpanda (lightweight Kafka)
  mongodb:       # MongoDB 8
  redis:         # Redis 8
  postgres:      # PostgreSQL 16
  minio:         # MinIO
```

## Production Infrastructure
- **Kafka:** `kafka-cluster-kafka-bootstrap.kafka.svc.cluster.local:9092`
- **MongoDB:** `mongodb-headless.mongodb.svc.cluster.local:27017` (replicaSet=rs0)
- **Redis:** `redis-master.redis.svc.cluster.local:6379`
- **PostgreSQL:** CNPG cluster per service in `yana-stocks` namespace
- **MinIO:** `minio.minio.svc.cluster.local:9000`
- **Alpaca API:** `https://data.alpaca.markets` (free tier, paper trading)

## Kubernetes Patterns
- **KEDA:** `price-ingestor`, `sentiment-analyzer` — scale on Kafka consumer lag
- **Argo Rollouts:** `ml-predictor` — canary 10%→50%→100%
- **Standard Deployment:** all other services
- **Images:** pushed to `harbor.yanatech.co.uk/yana-stocks/<service>:<tag>`
- **Secrets:** ESO from Infisical project `k8s-homelab` (ID `69b39965-b778-47a7-ba52-2cd66a7aad0a`)

## CI/CD
- GitHub Actions in `yana-stocks` repo
- Turborepo `--filter=[HEAD^1]` — only build changed services
- Per-service Docker image → Harbor
- On successful build: update image tag in `k8s-apps` → ArgoCD auto-syncs
- E2E: Playwright runs against staging before prod deploy

## Build Order (implement in this order)
1. Monorepo scaffold (turbo.json, pnpm-workspace.yaml, docker-compose)
2. Shared packages (shared-types, kafka-client, typescript-config)
3. `user-service` — auth foundation
4. `price-ingestor` — data feed
5. `price-processor` — storage
6. `portfolio-service` — portfolios
7. `portfolio-api` — aggregator
8. `sentiment-analyzer` — NLP
9. `ml-predictor` — predictions
10. `frontend` — dashboard
11. `e2e` — Playwright tests

## Code Style
- TypeScript strict mode everywhere
- ESLint + Prettier enforced
- No `any` types
- All NestJS controllers have Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`)
- All Kafka messages typed via `shared-types`
- Error handling: NestJS exception filters, structured error responses
- Logging: NestJS built-in logger, structured JSON in production

## Environment Variables per Service
Each service reads from `.env` locally and from Kubernetes secrets in production (via ESO from Infisical).

### user-service
```
DATABASE_URL=postgresql://...   # Prisma
REDIS_URL=redis://...
JWT_SECRET=...
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=...
JWT_REFRESH_EXPIRES_IN=7d
KAFKA_BROKERS=...
```

### price-processor
```
MONGODB_URI=mongodb://...
REDIS_URL=redis://...
KAFKA_BROKERS=...
```

### portfolio-service
```
MONGODB_URI=mongodb://...
KAFKA_BROKERS=...
```

### portfolio-api
```
REDIS_URL=redis://...
KAFKA_BROKERS=...
USER_SERVICE_URL=http://user-service:3000
PORTFOLIO_SERVICE_URL=http://portfolio-service:3000
PRICE_PROCESSOR_URL=http://price-processor:3000
ML_PREDICTOR_URL=http://ml-predictor:8000
```

### price-ingestor (Python)
```
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
ALPACA_BASE_URL=https://data.alpaca.markets
KAFKA_BROKERS=...
SYMBOLS=AAPL,GOOGL,MSFT,AMZN,TSLA,NVDA,META,JPM,V,JNJ
```

### sentiment-analyzer (Python)
```
KAFKA_BROKERS=...
MONGODB_URI=mongodb://...
NEWS_API_KEY=...             # NewsAPI.org free tier
HUGGINGFACE_MODEL=ProsusAI/finbert
```

### ml-predictor (Python)
```
KAFKA_BROKERS=...
MONGODB_URI=mongodb://...
MINIO_ENDPOINT=minio.minio.svc.cluster.local:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=yana-stocks-models
```

### frontend
```
NEXT_PUBLIC_API_URL=https://api-gateway.yanatech.co.uk/api
NEXT_PUBLIC_WS_URL=wss://api-gateway.yanatech.co.uk
```
