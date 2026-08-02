# zoci.me

Personal site + home-server relaunch. Fresh `mainline` (the legacy site lives on the
`00-webiste-original` branch).

## What this is

- **Landing** (`/`) — a minimal, animated launcher linking to the portfolio and Jellyfin.
- **Portfolio** (`/portfolio`) — rebuilt from the old site (card grid + modal).
- Served from this home server behind Caddy; public ingress via an OVH VPS + Tailscale.

## Stack

- Frontend: React + Vite + **Mantine** + `motion` (TypeScript)
- Backend: **Fastify** (Node/TS) — `api`, health endpoint in v1, grows later
- Shared: `zod` schemas / types in `shared/`, imported by both `app` and `api`
- Ingress: Caddy (TLS-ALPN-01, terminates on-home) — see specs
- Verification: Playwright (`@playwright/mcp` + committed smoke suite)

## Layout (target)

```
app/       # Vite + React + Mantine SPA        -> web image
api/       # Fastify (Node/TS)                  -> api image
shared/    # zod schemas + shared TS types
infra/     # docker-compose.yml, Caddyfile, vps/
tests/     # Playwright smoke suite
```

## Docs

- `ARCHITECTURE.md` — how the whole system fits together (a pointer map into the code).
- `DEVELOPMENT.md` — local dev loop (added during setup).
- Design history (local, not in the repo): `~/specs/complete/` — `secure-access.md`
  (authoritative network + security design), `zoci-networking.md`,
  `zoci-website-relaunch.md`, and the implementation plans.
