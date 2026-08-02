#!/usr/bin/env bash
# Writes the names of all running Docker containers to a JSON file for the landing
# dashboard. Run by cron on the home server (the box with Docker access) so the api
# container never needs the Docker socket. The api (api/src/server.ts) maps this list
# against the canonical service list (@zoci/shared SERVICES); this script keeps no list
# of its own. See also infra/docker-compose.yml (api mounts ./status read-only).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$DIR/status.json"
TMP="$(mktemp "$DIR/.status.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

# docker may not be on cron's minimal PATH
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# JSON array of currently-running container names (empty array if docker is unreachable).
names="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -vE '^[[:space:]]*$' | sed 's/.*/"&"/' | paste -sd, || true)"

printf '{"running":[%s],"updatedAt":"%s"}\n' "$names" "$(date -u +%FT%TZ)" >"$TMP"
mv -f "$TMP" "$OUT"
