# zoci.me

Personal site + home-server relaunch. Fresh `mainline` (the legacy site lives on the
`00-webiste-original` branch).

## What this is

- **Landing** (`/`): a minimal, animated launcher linking to the portfolio and Jellyfin.
- **Portfolio** (`/portfolio`): rebuilt from the old site (card grid + modal).
- Served from this home server behind Caddy; public ingress via an OVH VPS + Tailscale.

## Stack

- Frontend: React + Vite + **Mantine** + `motion` (TypeScript)
- Backend: **Fastify** (Node/TS), the `api` service ([`api/src/server.ts`](api/src/server.ts))
- Shared: `zod` schemas / types in `shared/`, imported by both `app` and `api`
- Ingress: Caddy on-home, fronted by an OVH VPS over Tailscale (see [`ARCHITECTURE.md`](ARCHITECTURE.md))
- Verification: Playwright (`@playwright/mcp` + committed smoke suite)

## Layout

[`DEVELOPMENT.md`](DEVELOPMENT.md) holds the authoritative workspace layout;
[`ARCHITECTURE.md`](ARCHITECTURE.md) maps the running system. In brief: `app/` (SPA),
`api/` (Fastify), `ha-broker/` (Home Assistant credential broker), `shared/` (zod schemas +
theme), `infra/` (compose, Caddyfile, VPS), `tests/` (Playwright).

## Docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md): how the whole system fits together (a pointer map into the code).
- [`DEVELOPMENT.md`](DEVELOPMENT.md): local dev loop, verification, deploy.
- Design history (local, not in the repo): `~/specs/complete/`, where `secure-access.md` is the
  authoritative network and security design, alongside `zoci-networking.md`,
  `zoci-website-relaunch.md`, and the implementation plans.
