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
- **News source:** FMP `/stable/news/stock`, one request per symbol per poll
  (deliberately not batched — see 2026-07-23 fix below). Tracked symbols =
  `DEFAULT_SYMBOLS` baseline (~30 tickers across sectors, `config.py`) unioned
  with whatever any user actually holds/watches (read directly from the shared
  `yana_stocks` Mongo's `portfolios`/`watchlists` collections — same DB
  portfolio-service owns, confirmed same `MONGODB_URI` in both services' k8s
  secrets). `worker.select_symbols_for_poll` round-robins the baseline through a
  fixed `max_symbols_per_poll` (default 10) each cycle so total FMP requests/day
  stay under the free tier's 250 regardless of how large the tracked universe
  grows; user-held/watched symbols always get a fresh fetch every cycle.

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
  Two allowances this app needed that `akan`/`yanatech` didn't: `img-src`
  includes `https:` (not just `'self' data:'`) because `profile-service`'s
  `avatar` field is a free-form user-supplied external URL with no host
  allowlist; `connect-src`'s API origin is **computed from `NEXT_PUBLIC_API_URL`
  at request time**
  (`new URL(process.env.NEXT_PUBLIC_API_URL ?? '<prod default>').origin`), **not
  hardcoded** — production crosses to `https://api-gateway.yanatech.co.uk`, but
  the `e2e-tests` CI job builds the frontend with
  `NEXT_PUBLIC_API_URL=http://localhost:3004/api` (no Kong/api-gateway in CI,
  points straight at `auth-service`), and a hardcoded prod-only value silently
  CSP-blocked every auth fetch there on first attempt — every login e2e test
  failed (`toBeVisible`/`waitForURL` timeouts, same symptom as a real hydration
  break, but the actual cause was `connect-src` not `script-src`).
  `connect-src`'s Sentry entry is `*.ingest.de.sentry.io` (EU region, matching
  `NEXT_PUBLIC_SENTRY_DSN`). Unlike `akan`/`yanatech` (which had a CSP that
  silently broke hydration), this app had **no CSP at all** before this fix —
  added proactively, not because something broke. See
  `[[project_nextjs_csp_nonce_gotchas]]` memory for the full incident history
  across all four apps, including this `connect-src` regression.
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
  `server-api.ts` resolves an absolute API origin itself (`NEXT_PUBLIC_API_URL`
  in prod; falls back to hitting `PORTFOLIO_API_URL` directly in dev) because
  server-side `fetch` — unlike the browser — doesn't have an implicit origin to
  resolve `next.config.mjs`'s relative `/api/*` rewrites against.
  `MarketBrowser`/`StockScreener` (the tabbed section below the fold, only one
  visible at a time) are now `next/dynamic` imports to keep their JS out of the
  homepage's main bundle. **Deliberately not done**: server-side auth redirects
  for `/dashboard`/`/portfolio`/`/watchlist` — `AuthContext.tsx` keeps tokens
  only in `sessionStorage`, which no Server Component or `proxy.ts` can read, so
  this would need a real migration to httpOnly cookies first, not a rendering
  change; still client-side `useEffect` + `router.replace('/login')`.
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
MONGODB_URI=mongodb://...            # same shared yana_stocks DB as portfolio-service
FMP_API_KEY=...                      # financialmodelingprep.com, free tier (250 req/day)
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

| Bug                                                 | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart goes blank when toggling Candle ↔ Line        | `chartType` missing from data effect deps — new series created but not populated (same `data` ref, effect skipped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Added `chartType` to `useEffect` deps array in `StockChart.tsx`                                                                                                                                                                                                                                                                                                                                                                                                 |
| lightweight-charts crash (`ensureNotNull`) on 6M/1Y | MongoDB stores duplicate daily bars at different UTC offsets (T00, T04, T05); same YYYY-MM-DD maps to duplicate `time` keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Backend dedup in `getHistory` (keeps highest UTC per date); frontend defensive dedup before `setData()`                                                                                                                                                                                                                                                                                                                                                         |
| Volume bars invisible on 1D range                   | 390 bars in ~600px = ~1.5px/bar, below `HistogramSeries` render threshold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `minBarSpacing: 2` in `timeScale` options                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Market dashboard shows only NVDA                    | `getMovers()` scans `papi:price:*` Redis keys — only symbols streamed via Kafka or previously visited have entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `getMovers()` now mget-checks 15 default symbols and fetches missing quotes via Polygon snapshot before scanning                                                                                                                                                                                                                                                                                                                                                |
| MACD signal scan only emitted current-bar crossover | `detectSignals()` compared only the last 2 `signalLine` entries; all historical crossovers were missed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Loop in `signals.ts` changed to `for (let i = 1; i < n; i++)` — scans all bars; MACD arrows now appear throughout chart history                                                                                                                                                                                                                                                                                                                                 |
| `chart.subscribeClick is not a function` in Jest    | `src/__mocks__/lightweight-charts.js` `mockChart` was missing `subscribeClick` and `unsubscribeClick` methods; `StockChart.tsx:256` calls `chart.subscribeClick()` for news headline popup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Added `subscribeClick: jest.fn()` and `unsubscribeClick: jest.fn()` to `mockChart` in the mock file                                                                                                                                                                                                                                                                                                                                                             |
| S&P 500 treemap flashes "No data" before overview   | `isLoading` gated only on `rotLoading`; when rotation resolved empty, `TreemapView` rendered with an empty `pctMap` for one cycle before `overviewData` arrived                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Widened `isLoading` to include `overviewLoading` in the narrow case: S&P 500 + today view + rotation empty + overview in flight                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/stocks/:symbol/history` returns 500       | `price-processor` KEDA ScaledObject had `minReplicaCount: 0`; scales to 0 outside trading hours; Cilium returns `EPERM` when `portfolio-api` connects to a Service with no endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Set `minReplicaCount: 1` in `k8s-apps/apps/yana-stocks/price-processor/keda-scaledobject.yaml`                                                                                                                                                                                                                                                                                                                                                                  |
| Dashboard "Total Portfolio Value" shows $0.00       | Holdings valued at `shares × latestPrice`, but `latestPrice` is only written by the `stocks.prices.processed` Kafka consumer — never populated when the price pipeline isn't streaming (local dev, market closed, fresh deploy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `portfolio-service` `toResponse()` falls back to `avgCostBasis` when `latestPrice` is unset (same rule the portfolio page applies client-side); `addStock` seeds `latestPrice` with the trade price                                                                                                                                                                                                                                                             |
| No sentiment data on any stock page (2026-07-23)    | Two stacked bugs. (1) FMP deprecated `/api/v3/stock_news` (cutoff 2025-08-31) — 403 "Legacy Endpoint" for this subscription, silently caught as a `WARNING` every poll, so sentiment data went dark for all tracked symbols. (2) Separately, `sentiment-analyzer` only ever tracked a hardcoded 10-symbol list with no `SYMBOL_KEYWORDS`/`SYMBOLS` override in prod — any other symbol (e.g. XOM) was never fetched at all, independent of bug (1). Live-tested and rejected two fixes for (2): pure portfolio/watchlist-driven tracking (prod Mongo only holds typo'd tickers like `APPL`/`TESLA`, not real symbols like XOM) and batching multiple symbols into one FMP call (a 25-symbol batch returned FMP's 250-article cap skewed almost entirely to trending tickers — `PG`/`CRM`/`V` got zero, XOM got 1 — so batching was dropped as unreliable for coverage). | (1) `fmp_news_client.py` switched to `/stable/news/stock` + renamed `tickers`→`symbols` param. (2) Baseline widened to ~30 tickers across sectors (`DEFAULT_SYMBOLS`) unioned with real user portfolio/watchlist symbols (read directly from the shared Mongo), round-robined through `max_symbols_per_poll` (default 10) each cycle via `worker.select_symbols_for_poll` so daily FMP requests stay under the 250 free-tier limit regardless of universe size. |

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
