# Development

Local dev guide for zoci.me. Dev and "prod" run on the same home server; there's no
CI/CD. See `ARCHITECTURE.md` for the system map; design history lives in
`~/specs/complete/` (`secure-access.md`, `zoci-networking.md`, `zoci-website-relaunch.md`, …).

## Prerequisites (one-time)

**Node** — via `nvm`, pinned to Node 22 (`.nvmrc`). If `node` isn't found in a shell,
nvm didn't load — open a new terminal or run `nvm use`:

```sh
nvm install   # reads .nvmrc (Node 22)
nvm use
```

**Dependencies** — one install at the repo root covers all workspaces:

```sh
npm install
```

**Playwright browsers** (for verification) — download binaries + install system libs.
The system libs need root (`apt`); run once:

```sh
npx playwright install chromium webkit
# system libraries (needs sudo; node referenced by absolute path so nvm PATH isn't needed):
sudo /home/rohan/.nvm/versions/node/v22.23.1/bin/node \
  node_modules/@playwright/test/cli.js install-deps chromium webkit
```

## Run the dev loop

```sh
npm run dev        # app + api together (concurrently)
```

- **App** (Vite + React + Mantine): http://localhost:3000 — and, since Vite binds all
  interfaces (`host: true`), reachable from other LAN devices at
  **http://<your-box-lan-ip>:3000** (this box is headless; preview from your
  laptop/phone). Find the LAN IP with `hostname -I`.
- **API** (Fastify): http://localhost:8001 — dev runs on **:8001**, not :8000, so it can
  coexist with the production `api` container (which holds :8000 on this box). The Vite
  proxy (`app/vite.config.ts`) targets :8001 accordingly.
- `GET /api/*` on the app is proxied to the API with the `/api` prefix **stripped**,
  mirroring prod Caddy's `handle_path /api/*` (so `/api/health` → API `/health`).
- **ha-broker** (Fastify): http://localhost:8081 — the Home Assistant credential broker. Dev
  runs it with `GUEST_DEV=1`; with no `HA_ADDR`/`HA_TOKEN` it serves **mock** room/light data
  so the guest dashboard works without a real HA. One-time install (it's a standalone package,
  not a workspace): `npm install --prefix ha-broker`.

Run them separately if needed:

```sh
npm run dev:app       # Vite on :3000
npm run dev:api       # Fastify on :8001 (tsx watch)
npm run dev:broker    # ha-broker on :8081 (tsx watch, GUEST_DEV mock)
```

### Guest dashboard (Guest Controls)

Served by the **api** at **http://localhost:8001/guest/** (keep the trailing slash) — the same
page prod serves at `guest.zoci.me`, with two dev conveniences:

- **No OAuth locally.** In prod, Caddy + oauth2-proxy gate the surface behind Google and set
  `X-Auth-Request-Email`. There's no oauth2-proxy in dev, so `GUEST_DEV=1` (set by the dev
  scripts) makes the api stand in a stub identity (`dev@localhost`) instead of a 401. **Never
  set `GUEST_DEV` in the deployed compose** — prod stays hard-gated behind Google.
- **Mock HA data.** With `GUEST_DEV=1` and no HA configured, ha-broker returns the room/light
  whitelist with in-memory states and toggles flip in memory. To drive real lights instead,
  set `HA_ADDR`/`HA_TOKEN` for the broker.

**Shared look — edit once.** Design tokens, the hero title, the gold iron-frame, and entrance
motion live in `shared/theme.css` (`@zoci/shared/theme.css`): the app imports it, and the api
inlines it into the guest page at startup. Change visuals **there**, not in `app/src/index.css`
or `api/src/guest.html`. After editing the frame art (`app/public/frame/*.png`), regenerate its
inlined data-URIs: `node scripts/gen-frame-css.mjs`.

## Project layout (npm workspaces)

```
app/       # Vite + React + Mantine + motion (TS)   -> web image
api/       # Fastify (Node/TS) + guest dashboard     -> api image
ha-broker/ # Fastify HA credential broker (standalone pkg, own lockfile) -> ha-broker image
shared/    # zod schemas + shared TS types + theme.css (@zoci/shared)
tests/     # Playwright smoke suite
infra/     # docker-compose.yml, Caddyfile, vps/     (added in later phases)
```

**Shared contracts:** cross-boundary types/schemas live in `shared/src/index.ts` and
are imported by both `app` and `api` as `@zoci/shared`. Change them there once — a
breaking change is a compile error on both ends, no codegen.

## Build

```sh
npm run build                    # builds the app (tsc + vite build -> app/dist)
npm run build --workspace api    # compiles the api (-> api/dist)
```

## Preview static files (diagrams)

This box is headless with no terminal image support, so preview static artifacts (the SVG
diagrams in `docs/`, standalone HTML, etc.) in a **browser over the LAN** — the same way you
preview the dev app:

```sh
make preview                     # serves ./docs on :8888, bound to all interfaces
# then open from a laptop/phone:  http://<your-box-lan-ip>:8888/   (hostname -I for the IP)
# override the port:  make preview PREVIEW_PORT=9000
```

The landing page (`docs/index.html`) shows `docs/architecture.svg`, which is also embedded in
`ARCHITECTURE.md` and rendered by GitHub. Edit the SVG, refresh the browser.

> **Only ever serve `docs/`.** Don't point a static server at the repo root — the gitignored
> `infra/.env`, `infra/certs/`, and `infra/oauth2-proxy/emails.txt` live there and would be
> exposed to the LAN. `make preview` is scoped to `docs/` for exactly this reason.

## Verify changes (Playwright)

Two complementary tools (see spec §5):

**1. Committed smoke suite** — the scripted gate. Runs on 3 projects: desktop
(Chromium), Pixel 5 (Chromium), iPhone 13 (WebKit).

```sh
npm run test:e2e                             # all projects, against dev (:3000)
npx playwright test --project=desktop        # single project
BASE_URL=https://zoci.me npm run test:e2e    # target the live site (Phase 7)
```

The suite auto-starts the dev server for local runs (reuses one if already up).

**2. Playwright MCP + `playwright-verifier` subagent** — agent-driven visual/interaction
check for "does this new UI actually look right." Configured in `.mcp.json`
(Claude Code approves the MCP server on first use) and `.claude/agents/
playwright-verifier.md`. After a UI change, run the dev server and delegate to the
`playwright-verifier` subagent; it runs the smoke suite and captures desktop + mobile
screenshots into `.playwright-mcp/`.

## Secret hygiene (this repo is public)

Infrastructure details are **reconnaissance for attackers** — never commit real IPs,
the tailnet name, VPS hostname, or emails. Keep them out of tracked files:

- Real addresses live only in **`PROJECT_STATUS.md`** (gitignored, local) and
  **`infra/.env`** (gitignored). Tracked files use placeholders (`<VPS_PUBLIC_IP>`,
  `<HOME_TAILNET_IP>`, …) or read from env (Caddy ACME email = `{$ACME_EMAIL}`).
- **Scan before every push:**
  ```sh
  make check-secrets     # or: bash scripts/check-secrets.sh
  ```
  It greps tracked files for IPs, emails, and `*.ts.net` names and exits non-zero on a
  hit (allowlists `127.0.0.1`, `0.0.0.0`, `::1`, `example.com`, and `<placeholders>`).
- `infra/.env.example` is the tracked template; copy it to `infra/.env` and fill in.

## Keeping images current

The third-party images in `infra/docker-compose.yml` (`caddy`, `coredns`, `oauth2-proxy`) are
pinned by `tag@sha256:…` — reproducible and supply-chain-safe, but that also freezes the
version. Since the architecture is public, stale versions telegraph a known-CVE window, so
check periodically:

```sh
make check-updates     # flags any pinned image that's behind latest
```

For anything reported **STALE**, bump its `image:` line to the new `tag@sha256:…` (the command
prints the digest / newer version) and `make deploy`. `oauth2-proxy` — the sole auth gate — is
the one to keep current; re-verify the guest 302 flow after bumping it. Base images
(`node:22-alpine`, `nginx:alpine`) aren't pinned, so they pick up the latest on each rebuild.

## Git

- **`mainline`** — active branch (fresh start). **`00-webiste-original`** — the legacy
  site, preserved untouched.
- Pushing `mainline` / `00-webiste-original` and setting the default branch on GitHub
  need your GitHub credentials (not configured here yet):
  ```sh
  git push -u origin mainline
  git push origin 00-webiste-original
  ```

## Troubleshooting

- **`node: command not found`** — nvm not loaded in this shell: `nvm use` (or open a
  new terminal; the loader is in `~/.zshrc`).
- **Playwright: "executable doesn't exist" / missing libs** — rerun the browser +
  `install-deps` steps above. WebKit (iPhone 13) needs the system libs; Chromium-only
  won't cover it.
- **Port already in use (3000/8001)** — an old `npm run dev` is still running; stop it
  (`pkill -f vite`, `pkill -f "tsx watch"`) or find it with `lsof -i :3000`.
- **`/api/health` 404 in dev** — the Vite proxy rewrite (strip `/api`) must match the
  API's unprefixed routes; see `app/vite.config.ts`.
