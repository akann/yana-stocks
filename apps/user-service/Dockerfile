FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable

# Workspace manifests — copied first for Docker layer cache
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-dto/package.json ./packages/shared-dto/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/user-service/package.json ./apps/user-service/

RUN pnpm install --frozen-lockfile

# Source
COPY packages ./packages
COPY apps/user-service ./apps/user-service

RUN pnpm --filter "@yana-stocks/shared-types" build && \
    pnpm --filter "@yana-stocks/shared-dto" build && \
    pnpm --filter "@yana-stocks/kafka-client" build && \
    pnpm --filter "@yana-stocks/user-service" exec prisma generate && \
    pnpm --filter "@yana-stocks/user-service" build

# Production stage
FROM node:24-alpine
WORKDIR /app

RUN corepack enable && \
    addgroup -S app && \
    adduser -S app -G app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-dto/package.json ./packages/shared-dto/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/user-service/package.json ./apps/user-service/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-dto/dist ./packages/shared-dto/dist
COPY --from=builder /app/packages/kafka-client/dist ./packages/kafka-client/dist
COPY --from=builder /app/apps/user-service/dist ./apps/user-service/dist
COPY --from=builder /app/apps/user-service/prisma ./apps/user-service/prisma

USER app
WORKDIR /app/apps/user-service
EXPOSE 3000
CMD ["node", "dist/main.js"]
