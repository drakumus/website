#!/usr/bin/env bash
#
# Post-deploy liveness smoke: assert the freshly (re)started stack is actually serving, not just
# that the images built. Complements the unit suites (which cover logic) with a real end-to-end
# check. Run by `make deploy` after `up -d`, and standalone as `make test-infra`.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
COMPOSE="docker compose -f infra/docker-compose.yml"
fail=0
ok()  { printf 'OK  %s\n' "$1"; }
bad() { printf '!!  %s\n' "$1"; fail=1; }

# 1) api health, published on loopback by compose (127.0.0.1:8000).
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8000/health || true)
[ "$code" = "200" ] && ok "api /health 200" || bad "api /health = ${code:-none}"

# 2) every container running, and any with a healthcheck reporting healthy.
unhealthy=$($COMPOSE ps --format '{{.Name}} {{.State}} {{.Health}}' 2>/dev/null \
  | awk '$2 != "running" || ($3 != "" && $3 != "healthy") { print "     " $0 }')
[ -z "$unhealthy" ] && ok "containers running/healthy" || { bad "containers not healthy:"; echo "$unhealthy"; }

# 3) public guest path redirects to Google sign-in — the auth gate is up (see infra/CLAUDE.md).
loc=$(curl -sI -k --max-time 5 --resolve guest.zoci.me:8443:127.0.0.1 https://guest.zoci.me:8443/ \
  | tr -d '\r' | awk 'tolower($1) == "location:" { print $2 }')
case "$loc" in
  */oauth2/sign_in*) ok "guest redirects to $loc" ;;
  *)                 bad "guest redirect = '${loc:-none}' (expected /oauth2/sign_in)" ;;
esac

[ "$fail" -eq 0 ] && ok "infra smoke passed"
exit "$fail"
