FROM node:24-alpine AS spec-builder
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
COPY apps/portfolio-api/package.json ./apps/portfolio-api/
COPY apps/portfolio-service/package.json ./apps/portfolio-service/
COPY apps/profile-service/package.json ./apps/profile-service/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/portfolio-api ./apps/portfolio-api
COPY apps/portfolio-service ./apps/portfolio-service
COPY apps/profile-service ./apps/profile-service

RUN pnpm --filter "@yana-stocks/shared-types" build && \
    pnpm --filter "@yana-stocks/shared-dto" build && \
    pnpm --filter "@yana-stocks/kafka-client" build

RUN pnpm --filter "@yana-stocks/portfolio-api" build && \
    node apps/portfolio-api/dist/generate-openapi.js /tmp/portfolio-api.json

RUN pnpm --filter "@yana-stocks/portfolio-service" build && \
    node apps/portfolio-service/dist/generate-openapi.js /tmp/portfolio-service.json

RUN pnpm --filter "@yana-stocks/profile-service" build && \
    node apps/profile-service/dist/generate-openapi.js /tmp/profile-service.json

FROM node:24-alpine AS docs-builder
WORKDIR /app

RUN npm install -g @redocly/cli

COPY --from=spec-builder /tmp/portfolio-api.json ./
COPY --from=spec-builder /tmp/portfolio-service.json ./
COPY --from=spec-builder /tmp/profile-service.json ./

RUN redocly build-docs portfolio-api.json --output portfolio-api.html && \
    redocly build-docs portfolio-service.json --output portfolio-service.html && \
    redocly build-docs profile-service.json --output profile-service.html

FROM nginx:alpine
COPY --from=docs-builder /app/portfolio-api.html /usr/share/nginx/html/
COPY --from=docs-builder /app/portfolio-service.html /usr/share/nginx/html/
COPY --from=docs-builder /app/profile-service.html /usr/share/nginx/html/
COPY apps/api-docs/index.html /usr/share/nginx/html/
COPY apps/api-docs/nginx.conf /etc/nginx/conf.d/default.conf
