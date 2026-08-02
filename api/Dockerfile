# API image: Fastify (Node/TS). Runs via tsx so the shared TS package (@zoci/shared)
# works without a separate compile step — fine for the v1 skeleton.
# Build context is the REPO ROOT (monorepo).
FROM node:24-alpine
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY app/package.json ./app/
COPY api/package.json ./api/
RUN npm ci
COPY shared ./shared
COPY api ./api
WORKDIR /repo/api
# Run non-root; tsx's transpile cache + any tmp go to a writable tmpfs so the rootfs can be
# read-only (see infra/docker-compose.yml). HOME/TMPDIR point at /tmp for the same reason.
USER node
ENV HOST=0.0.0.0 PORT=8000 HOME=/tmp TMPDIR=/tmp
EXPOSE 8000
CMD ["npx", "tsx", "src/server.ts"]
