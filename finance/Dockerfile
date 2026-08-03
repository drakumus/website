# finance: the Plaid + Postgres credential holder for the tailnet-only finance dashboard (see
# ~/specs/finance-dashboard.md). Standalone package (own lockfile) so it never perturbs the
# monorepo's npm ci. Compiles to plain JS and runs `node`, no tsx in the running image (smaller
# surface for the one process that holds the Plaid secret). Build context = finance/.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build            # tsc -> dist/

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY schema.sql ./schema.sql
USER node
ENV PORT=9103
EXPOSE 9103
CMD ["node", "dist/server.js"]
