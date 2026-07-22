FROM node:24-alpine AS builder
WORKDIR /app
ENV HUSKY=0

RUN apk upgrade --no-cache && corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-dto/package.json ./packages/shared-dto/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/portfolio-service/package.json ./apps/portfolio-service/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/portfolio-service ./apps/portfolio-service

RUN pnpm --filter "@yana-stocks/shared-types" build && \
    pnpm --filter "@yana-stocks/shared-dto" build && \
    pnpm --filter "@yana-stocks/kafka-client" build && \
    pnpm --filter "@yana-stocks/portfolio-service" build

FROM node:24-alpine
WORKDIR /app
ENV HUSKY=0

# npm@latest picks up a patched node-tar (CVE-2026-59873, CRITICAL) — npm
# itself isn't used to install anything here (pnpm is), but its bundled
# tar still ships in the image and fails the Trivy image scan otherwise.
RUN apk upgrade --no-cache && \
    npm install -g npm@latest && \
    corepack enable && \
    addgroup -S app && \
    adduser -S app -G app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-dto/package.json ./packages/shared-dto/
COPY packages/kafka-client/package.json ./packages/kafka-client/
COPY apps/portfolio-service/package.json ./apps/portfolio-service/

# corepack's cached pnpm dist (downloaded on first pnpm invocation above)
# vendors its own separate tar copy — untouched by the npm upgrade above and
# not needed at runtime (nothing after this invokes pnpm again).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    rm -rf /root/.cache/node/corepack

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-dto/dist ./packages/shared-dto/dist
COPY --from=builder /app/packages/kafka-client/dist ./packages/kafka-client/dist
COPY --from=builder /app/apps/portfolio-service/dist ./apps/portfolio-service/dist

USER app
WORKDIR /app/apps/portfolio-service
EXPOSE 3000
CMD ["node", "dist/main.js"]
