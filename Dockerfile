# ── Verve Strata — production image ─────────────────────────────────────
# Multi-stage: deps (full, for build) → build → proddeps (runtime only) → runtime.
# The web bundle is built here and served by the API process as static files:
# one service, one port, no runtime coupling to Node dev tooling.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY server/ server/
COPY web/ web/
RUN npm run build

FROM node:20-alpine AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S strata && adduser -S strata -G strata
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
COPY --from=build /app/web/dist ./web/dist
COPY server/package.json ./server/
COPY package.json ./
USER strata
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/dist/index.js"]
