# API image: Fastify (Node/TS). Runs via tsx so the shared TS package (@zoci/shared)
# works without a separate compile step — fine for the v1 skeleton.
# Build context is the REPO ROOT (monorepo).
FROM node:22-alpine
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY app/package.json ./app/
COPY api/package.json ./api/
RUN npm ci
COPY shared ./shared
COPY api ./api
WORKDIR /repo/api
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["npx", "tsx", "src/server.ts"]
