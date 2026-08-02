# Working in this repo

zoci.me — personal site + home-server. Read **`ARCHITECTURE.md`** (system map) and
**`DEVELOPMENT.md`** (dev loop, verify, deploy) first. This file is durable *how-to-work-here*
guidance; it deliberately does not restate code behavior (see the first rule).

## Docs reference code — they never restate it
- `.md` files (this one included) point at the code/tests that hold the detail. They do **not**
  describe current behavior, values, endpoints, or component/class names — those drift out of
  sync. To learn what something does or which primitives exist, **read the source** it points to.
- Enforce invariants with **tests**, not prose. If a rule matters ("`api` must never see an
  `entity_id`"), it belongs in a test that fails when it breaks — not in a doc that rots.

## This host IS production
- `make deploy` builds from the **local working tree** (not git) and recreates the stack. No
  CI/CD. Pushing to GitHub does not deploy — deploy and push are independent.

## Verify by driving the real thing — locally
- Prefer local checks to SSHing the VPS: `curl --resolve <name>:8443:127.0.0.1 …` exercises the
  public/guest path (the VPS is a dumb L4 passthrough that adds nothing to the app logic).
- A change isn't done until the affected flow is **exercised** (health, the guest `302`, a
  toggle) — not just typechecked. For UI, **screenshot at desktop + mobile** (Playwright MCP)
  and compare against the existing surfaces before calling it done. Preview SVGs with
  `make preview`.

## Reuse, don't reinvent
- Match the existing surfaces instead of rebuilding. The shared visual layer is
  `shared/theme.css` and `app/src`; reuse those classes/patterns — a new card/panel is the
  existing framed component, **not** a bare border. Don't fork styling into a new file.
- Cross-boundary types live in `shared/src`. When a value has one home (a token, a theme
  primitive, a whitelist), use it from there — never duplicate it.

## Git: append-only, never rewrite
- `mainline` is active. Land **logically-grouped commits on top**; end each message with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Amending your own **unpushed**
  commits to tidy them is fine; **never rewrite pushed history and never force-push** (pushes
  must be fast-forward).
- Run `make check-secrets` before every push. Commit/push only when asked.

## Public repo — no secrets in tracked files
- Real IPs, the tailnet name, VPS host, tokens, secrets, emails, and the TLS key are gitignored
  (see `DEVELOPMENT.md`). Never hardcode an infra address — use `{$ENV}` / `<PLACEHOLDER>`;
  `make check-secrets` gates this. Keep pinned images current (`make check-updates`) — a stale
  version is a recon signal on a public repo.

## Guest / Home Assistant surface
- **Preserve the token-isolation boundary**: `ha-broker` is the only holder of the HA token;
  `api` relays only an opaque `{key, value}`. This is an invariant — it belongs in `ha-broker`'s
  tests; keep them green when changing that path.
- `GUEST_DEV` is a **local-dev-only** auth bypass + mock HA. **Never set it in the deployed
  compose.**

## Taste
- Motion/UI is subtle and spring-based, with content reacting over its container on hover. The
  reference feel is the portfolio interactions in `app/src` — match that, don't invent a new one.
