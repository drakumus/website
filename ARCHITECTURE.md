# Architecture

High-level map of how zoci.me fits together. This is a **pointer document**: it explains the
shape and the *why*, and points at the code that holds the detail — it does not restate logic
that lives in the files. Start here, then read the referenced source.

Companion docs:
- [`README.md`](README.md) — what the site is, the stack, the layout.
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — local dev loop, the guest-dashboard dev bypass, build,
  verification (Playwright), secret hygiene, deploy.
- Design history (local, not in the repo): `~/specs/complete/` — `secure-access.md` is the
  authoritative network + security design; `zoci-networking.md`, `zoci-website-relaunch.md`,
  and the implementation plans record how we got here.

> **Deploy model:** this home server *is* production. `make deploy` builds from the local
> working tree (not git) and recreates the stack. See [`Makefile`](Makefile) and
> [`DEVELOPMENT.md`](DEVELOPMENT.md).

> **Secret hygiene:** the repo is public. Real IPs, the tailnet name, the VPS host, and emails
> never land in tracked files — they live in gitignored `infra/.env`, `infra/certs/`,
> `infra/oauth2-proxy/emails.txt`, and local `PROJECT_STATUS.md`. Enforced by
> [`scripts/check-secrets.sh`](scripts/check-secrets.sh) (`make check-secrets`).

---

## 1. The three surfaces

| Surface | Reached at | Who | Gate |
|---|---|---|---|
| **Public** | `zoci.me`, `js1.zoci.me` | anyone | none |
| **Guest** | `guest.zoci.me` | allowlisted Google accounts | oauth2-proxy (Google OIDC) |
| **Private** | `admin`/`ha`/`finance.zoci.me` | you, on the tailnet | Tailscale network + L7 backstop |

The whole design turns on a **port split**: public vhosts listen on `:8443`, private vhosts on
`:443`. The public VPS can only reach `:8443`; it is structurally blocked from `:443`, so the
private surface is unreachable from the internet even if a vhost were misconfigured. This is
enforced by the Tailscale grant, not a fragile denylist. Rationale in `~/specs/complete/secure-access.md` §7.

---

## 2. Ingress: how a request reaches home

```
browser
  │  DNS: zoci.me / *.zoci.me  →  VPS public IP
  ▼
OVH VPS  ──  nginx `stream` L4 passthrough (NEVER decrypts TLS)
  │          :443 → home:8443   ·   :80 → home:80        (over Tailscale)
  ▼
home server (this box)
  Caddy (host-net)  ──  terminates TLS (acme.sh wildcard cert), routes by vhost
  ├─ :8443  public + guest vhosts
  └─ :443   private vhosts (VPS is ACL-blocked from this port)
```

- **VPS forwarder** — [`infra/vps/setup.sh`](infra/vps/setup.sh) + [`infra/vps/README.md`](infra/vps/README.md).
  It is a dumb TCP passthrough (nginx `stream`), so the VPS holds no keys and sees no plaintext;
  home sees the VPS's constant tailnet IP as the source. Verified live: `:443 → home:8443`,
  `:80 → home:80`.
- **Caddy** — [`infra/Caddyfile`](infra/Caddyfile). `auto_https off`; every vhost loads the
  wildcard cert via the `(wildcard_tls)` snippet. The `(strip_auth_headers)` snippet drops any
  client-supplied `X-Auth-Request-*` on every internet-facing vhost so the shared `api` can't be
  spoofed; the `(tailnet_guard)` snippet is the fail-closed L7 backstop on private vhosts.

TLS certificates are wildcard (`zoci.me` + `*.zoci.me`), issued out-of-band via **DNS-01** (no
inbound ACME through the passthrough) — [`infra/acme/issue.sh`](infra/acme/issue.sh); Caddy just
loads the files from `infra/certs/` (gitignored).

Split-DNS for the private names resolves only on the tailnet via CoreDNS —
[`infra/coredns/Corefile`](infra/coredns/Corefile).

---

## 3. Services (containers)

Topology, ports, networks, and hardening live in
[`infra/docker-compose.yml`](infra/docker-compose.yml). All images are stock (no custom builds);
all logs are bounded there via the `x-logging` anchor.

| Service | Role | Code / config |
|---|---|---|
| `caddy` | TLS termination + routing (host-net) | [`infra/Caddyfile`](infra/Caddyfile) |
| `web` | the public SPA, static via nginx | [`app/`](app), [`app/Dockerfile`](app/Dockerfile), [`infra/nginx-spa.conf`](infra/nginx-spa.conf) |
| `api` | Fastify: public status + guest surface | [`api/src/server.ts`](api/src/server.ts) |
| `ha-broker` | sole holder of the Home Assistant token; whitelist-only | [`ha-broker/src/server.ts`](ha-broker/src/server.ts) |
| `oauth2-proxy` | Google OIDC gate for the guest surface | config in [`infra/docker-compose.yml`](infra/docker-compose.yml), allowlist `infra/oauth2-proxy/emails.txt` |
| `coredns` | split-DNS resolver for tailnet-only names | [`infra/coredns/Corefile`](infra/coredns/Corefile) |

Two internet-facing containers (`api`, `web`) hold **no** secrets and have **no** Docker socket.
`ha-broker` is on a private bridge with `api` only (no host port), runs `read_only` with
`no-new-privileges`, and is the one place the HA token exists.

---

## 4. The public site

React + Vite + Mantine SPA — [`app/`](app). Pages in [`app/src/pages/`](app/src/pages)
(`Landing`, `Portfolio`). Container-health for the landing dashboard comes from a host cron that
writes running-container names to a file ([`infra/status/write-status.sh`](infra/status/write-status.sh));
the `api` reads that file and maps it against the canonical service list in
[`shared/src/index.ts`](shared/src/index.ts) — so the internet-facing `api` never talks to Docker.
The public API routes (`/health`, `/status`) are in [`api/src/server.ts`](api/src/server.ts).

## 5. Shared visual layer

One source of truth for the site's look — tokens, the hero-title treatment, the gold iron-frame,
and entrance motion — in [`shared/theme.css`](shared/theme.css). The app imports it
([`app/src/main.tsx`](app/src/main.tsx)); the guest dashboard **inlines** it at startup so the
two surfaces match without duplication. Frame art is embedded as data-URIs, regenerated from the
source PNGs by [`scripts/gen-frame-css.mjs`](scripts/gen-frame-css.mjs).

---

## 6. Guest dashboard ("Guest Controls")

Curated Home Assistant control for allowlisted Google guests at `guest.zoci.me`. The security
boundary is the point of the design, so it's worth stating here; the mechanics are in the code.

**Auth (edge).** `guest.zoci.me` (`:8443`, [`infra/Caddyfile`](infra/Caddyfile)) puts every
request through oauth2-proxy `forward_auth`; an authenticated request gets a trusted
`X-Auth-Request-Email` header set by Caddy (and any client-sent copy stripped first).
Unauthenticated requests are redirected into the Google flow (`@error status 401` →
`/oauth2/sign_in`).

**Layered token isolation.** The page and its data pass through `api`
([`api/src/server.ts`](api/src/server.ts), the `/guest/*` routes) which holds no secrets and
requires the trusted header. `api` relays only an **opaque `{key, value}`** to `ha-broker`
([`ha-broker/src/server.ts`](ha-broker/src/server.ts)), which is the only process with the HA
token. The broker maps `key → entity` against a **whitelist**, so a compromised `api` (or a nosy
guest) can never name an arbitrary entity or service.

**Optimistic command + verify** — the interaction model (details in
[`api/src/guest.html`](api/src/guest.html) and the broker's `/command` + `confirm()`):

```
tap → optimistic flip → POST /command {key, value}   (explicit desired state)
     → broker issues the explicit service (turn_on/off), then re-reads until HA converges
     → { state, verified } → UI: pending → verified (✓) | unconfirmed (revert + !)
     background: /dashboard poll reconciles every 10s (read-through to HA /api/states)
```

Explicit desired-state commands (not a relative toggle) make the write **idempotent** and the
result **verifiable**. This generalizes to future control types (e.g. AC setpoint/mode): add a
control type, branch on its domain for the service + verify predicate — the broker whitelist,
the section-per-control-type layout, and the command→verify flow are already the rails.
Design notes in `~/specs/complete/secure-access.md` §6–7.

**Local dev** runs this whole surface without oauth2-proxy via `GUEST_DEV` (stub identity +
mock HA in the broker) — see [`DEVELOPMENT.md`](DEVELOPMENT.md).

---

## 7. Security posture (summary)

Depth, not a single wall — full treatment in `~/specs/complete/secure-access.md`:

- **Network boundary** — public VPS reaches only `:8443`; `:443` (private vhosts) is
  Tailscale-ACL-blocked. The port split is the real boundary; `(tailnet_guard)` in the Caddyfile
  is a fail-closed backstop.
- **Header trust** — `(strip_auth_headers)` removes client `X-Auth-Request-*` before Caddy sets
  the trusted copy on the guest vhost only.
- **Token isolation** — HA token lives solely in `ha-broker` (private bridge, no host port,
  `read_only`, `no-new-privileges`); guests reach it only through the `api` relay + whitelist.
- **Blast radius** — internet-facing `api`/`web` hold no secrets and no Docker socket.
- **Secret hygiene** — gitignored `infra/.env`, `infra/certs/`, `infra/oauth2-proxy/emails.txt`;
  `make check-secrets` gates against leaks.

---

## 8. Dev & deploy

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full loop. In brief: `npm run dev` runs
app + api + ha-broker (with the guest dev bypass); `make deploy` builds from the working tree and
recreates the stack. Editing [`infra/Caddyfile`](infra/Caddyfile) requires `docker restart caddy`
(a single-file bind mount pins the old inode — a bare `caddy reload` reloads stale config).
