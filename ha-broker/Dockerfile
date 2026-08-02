# ha-broker: minimal HA credential holder (see ~/specs/secure-access.md §6). Standalone
# package (own lockfile) so it never perturbs the monorepo's npm ci. Compiles to plain JS
# and runs `node` — no tsx/esbuild in the running image (smaller surface for the one process
# that holds the HA token). Build context = ha-broker/.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build            # tsc -> dist/

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]
