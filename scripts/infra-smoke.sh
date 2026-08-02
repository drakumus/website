#!/usr/bin/env bash
#
# Post-deploy liveness smoke: assert the freshly (re)started stack is actually serving, not just
# that the images built. Complements the unit suites (which cover logic) with a real end-to-end
# check. Run by `make deploy` after `up -d`, and standalone as `make test-infra`.
#
# Right after `up -d` the app containers warm up (healthcheck start_period), reporting "starting"
# and refusing connections for a few seconds. That is not a failure, so wait for readiness (bounded
# by SMOKE_TIMEOUT, default 90s) before asserting.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
COMPOSE="docker compose -f infra/docker-compose.yml"
DEADLINE=$(( $(date +%s) + ${SMOKE_TIMEOUT:-90} ))
fail=0
ok()  { printf 'OK  %s\n' "$1"; }
bad() { printf '!!  %s\n' "$1"; fail=1; }

api_health() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8000/health || true; }
still_starting() { $COMPOSE ps --format '{{.Health}}' 2>/dev/null | grep -c 'starting' || true; }

# Wait until the api answers 200 and no container is still in healthcheck warmup, or the deadline.
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  [ "$(api_health)" = "200" ] && [ "$(still_starting)" -eq 0 ] && break
  sleep 3
done

# 1) api health, published on loopback by compose (127.0.0.1:8000).
code=$(api_health)
[ "$code" = "200" ] && ok "api /health 200" || bad "api /health = ${code:-none}"

# 2) every container running, and any with a healthcheck reporting healthy (not starting/unhealthy).
unhealthy=$($COMPOSE ps --format '{{.Name}} {{.State}} {{.Health}}' 2>/dev/null \
  | awk '$2 != "running" || ($3 != "" && $3 != "healthy") { print "     " $0 }')
[ -z "$unhealthy" ] && ok "containers running/healthy" || { bad "containers not healthy:"; echo "$unhealthy"; }

# 3) public guest path redirects to Google sign-in; the auth gate is up (see infra/CLAUDE.md).
loc=$(curl -sI -k --max-time 5 --resolve guest.zoci.me:8443:127.0.0.1 https://guest.zoci.me:8443/ \
  | tr -d '\r' | awk 'tolower($1) == "location:" { print $2 }')
case "$loc" in
  */oauth2/sign_in*) ok "guest redirects to $loc" ;;
  *)                 bad "guest redirect = '${loc:-none}' (expected /oauth2/sign_in)" ;;
esac

[ "$fail" -eq 0 ] && ok "infra smoke passed"
exit "$fail"
