# Web image: build the Vite SPA, serve it as static files with nginx (SPA fallback).
# Build context is the REPO ROOT (monorepo: app imports @zoci/shared).
FROM node:24-alpine AS build
WORKDIR /repo
# workspace manifests first (layer caching)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY app/package.json ./app/
COPY api/package.json ./api/
RUN npm ci
# sources needed to build the app
COPY shared ./shared
COPY app ./app
RUN npm run build -w @zoci/app

FROM nginx:alpine
COPY infra/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/app/dist /usr/share/nginx/html
EXPOSE 80
