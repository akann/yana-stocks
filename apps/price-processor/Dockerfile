FROM node:24-alpine AS builder
WORKDIR /app
ENV HUSKY=0

RUN apk upgrade --no-cache && corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/price-processor/package.json ./apps/price-processor/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/price-processor ./apps/price-processor

RUN pnpm --filter "@yana-stocks/shared-types" build && \
    pnpm --filter "@yana-stocks/kafka-client" build && \
    pnpm --filter "@yana-stocks/price-processor" build

FROM node:24-alpine
WORKDIR /app
ENV HUSKY=0

RUN apk upgrade --no-cache && \
    corepack enable && \
    addgroup -S app && \
    adduser -S app -G app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/price-processor/package.json ./apps/price-processor/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/kafka-client/dist ./packages/kafka-client/dist
COPY --from=builder /app/apps/price-processor/dist ./apps/price-processor/dist

USER app
WORKDIR /app/apps/price-processor
EXPOSE 3000
CMD ["node", "dist/main.js"]
