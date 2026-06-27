# syntax=docker/dockerfile:1
#
# Built from the REPO ROOT so the build context includes the root package.json,
# the lockfile, and any workspace packages this service depends on:
#   docker build -f services/order/Dockerfile -t ofl-order .
#
# Multi-stage: a fat "builder" with all deps + the TypeScript compiler, and a
# slim "runtime" that carries only production deps + compiled JS, run as non-root.

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Copy only manifests first so `npm ci` is cached until a dependency changes,
# not on every source edit. As packages/* get added later, their package.json
# files get copied here too.
COPY package.json package-lock.json ./
COPY services/order/package.json ./services/order/
RUN npm ci

# Bring in the TS config + source, then compile to services/order/dist.
COPY tsconfig.base.json ./
COPY services/order ./services/order
RUN npm run build -w @ofl/order

# Drop dev dependencies (typescript, vitest, ...) so node_modules carries only
# what the service needs at runtime.
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy only the runtime artifacts, owned by the built-in non-root `node` user.
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/services/order/package.json ./services/order/package.json
COPY --from=builder --chown=node:node /app/services/order/dist ./services/order/dist

USER node
EXPOSE 3000
CMD ["node", "services/order/dist/index.js"]
