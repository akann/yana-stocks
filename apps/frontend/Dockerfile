FROM node:24-alpine AS base
RUN apk upgrade --no-cache && corepack enable && corepack prepare pnpm@11.6.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/auth-service/package.json ./apps/auth-service/
COPY apps/e2e/package.json ./apps/e2e/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/portfolio-api/package.json ./apps/portfolio-api/
COPY apps/portfolio-service/package.json ./apps/portfolio-service/
COPY apps/price-processor/package.json ./apps/price-processor/
COPY apps/profile-service/package.json ./apps/profile-service/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-dto/package.json ./packages/shared-dto/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN pnpm install --frozen-lockfile || (pnpm approve-builds --all && pnpm install --frozen-lockfile)

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN mkdir -p apps/frontend/public && pnpm --filter "@yana-stocks/frontend" build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/frontend/server.js"]
