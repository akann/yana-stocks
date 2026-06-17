FROM node:24-alpine AS builder
WORKDIR /app

RUN apk upgrade --no-cache && corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-dto/package.json ./packages/shared-dto/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/profile-service/package.json ./apps/profile-service/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/profile-service ./apps/profile-service

RUN pnpm --filter "@yana-stocks/shared-dto" build && \
    pnpm --filter "@yana-stocks/kafka-client" build && \
    pnpm --filter "@yana-stocks/profile-service" build

FROM node:24-alpine
WORKDIR /app

RUN apk upgrade --no-cache && \
    corepack enable && \
    addgroup -S app && \
    adduser -S app -G app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-dto/package.json ./packages/shared-dto/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/profile-service/package.json ./apps/profile-service/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared-dto/dist ./packages/shared-dto/dist
COPY --from=builder /app/packages/kafka-client/dist ./packages/kafka-client/dist
COPY --from=builder /app/apps/profile-service/dist ./apps/profile-service/dist

USER app
WORKDIR /app/apps/profile-service
EXPOSE 3000
CMD ["node", "dist/main.js"]
