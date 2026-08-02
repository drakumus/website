# infra — gotchas (read before touching this dir)

- **Caddyfile edits need `docker restart caddy`, NOT `caddy reload`.** The single-file bind
  mount pins the old inode when an editor rewrites the file, so a bare reload serves stale
  config (this cost a long debugging loop). Confirm the container actually has the edit:
  `diff Caddyfile <(docker exec caddy cat /etc/caddy/Caddyfile)`.

- **The port-split is the real security boundary** (see `ARCHITECTURE.md` and the Caddyfile for
  the current mapping). Never add an internet-facing route that reaches the tailnet-only `:443`
  surface; keep the header-strip snippet on every internet-facing vhost and the tailnet backstop
  on the private ones.

- **oauth2-proxy is the sole guest auth gate.** After changing it (especially a version bump),
  re-verify: unauthenticated `guest.zoci.me` → `302 /oauth2/sign_in`, sign-in page `200`. Gotcha
  that cost time: `forward_auth`'s 401 is a *proxied* response, so the sign-in redirect must live
  in `forward_auth`'s own response handling (see the guest vhost), not in `handle_errors`.

- **Third-party images are pinned by `tag@sha256:…`** (`caddy`, `coredns`, `oauth2-proxy`) for
  reproducibility. `make check-updates` flags stale ones; re-pin + `make deploy`. Base images
  (`node:22-alpine`, `nginx:alpine`) float to latest on rebuild.

- **All container logs are bounded** via the `x-logging` anchor — apply it to any new service.

- **No secrets here.** `infra/.env`, `infra/certs/`, `infra/oauth2-proxy/emails.txt` are
  gitignored; the tracked Caddyfile/compose reference `{$ENV}` only. Deep design lives locally
  in `~/specs/complete/` (not in the repo).
