#!/usr/bin/env bash
#
# Issue/renew the zoci.me + *.zoci.me wildcard cert via Let's Encrypt DNS-01 (DigitalOcean),
# for stock Caddy to load from a file (see ~/specs/complete/secure-access.md §5). acme.sh runs on the
# HOST — the DNS API token never enters the repo or a container.
#
#   infra/acme/issue.sh staging   # LE staging dry-run (untrusted cert, no rate limits) — verify only
#   infra/acme/issue.sh           # real LE cert + install into infra/certs/
#
# acme.sh's own cron handles renewals; the token is read from $DO_TOKEN_FILE (default
# ~/.secrets/dns_token) and passed to the DigitalOcean plugin as DO_API_KEY.
set -euo pipefail

MODE="${1:-prod}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERT_DIR="$REPO/infra/certs"
TOKEN_FILE="${DO_TOKEN_FILE:-$HOME/.secrets/dns_token}"
ACME="$HOME/.acme.sh/acme.sh"

[ -r "$TOKEN_FILE" ] || { echo "!! DO token file not readable: $TOKEN_FILE" >&2; exit 1; }
[ -x "$ACME" ]       || { echo "!! acme.sh not found at $ACME (install it first)" >&2; exit 1; }

export DO_API_KEY; DO_API_KEY="$(tr -d '\n\r' < "$TOKEN_FILE")"

case "$MODE" in
  staging) SERVER=letsencrypt_test ;;
  prod)    SERVER=letsencrypt ;;
  *) echo "usage: $0 [staging|prod]" >&2; exit 2 ;;
esac

echo ">> issuing zoci.me + *.zoci.me via DNS-01 (DigitalOcean), CA: $SERVER"
# DigitalOcean's anycast nameservers can lag; a fixed propagation wait avoids LE
# multi-perspective "secondary validation: incorrect TXT record" failures. Override with
# DNSSLEEP=<seconds>; default 120.
"$ACME" --issue --server "$SERVER" --dns dns_dgon \
        -d zoci.me -d '*.zoci.me' --keylength ec-256 \
        --dnssleep "${DNSSLEEP:-120}" ${FORCE:+--force}

if [ "$MODE" = prod ]; then
  mkdir -p "$CERT_DIR"
  echo ">> installing cert into $CERT_DIR (Caddy loads these; §5)"
  "$ACME" --install-cert -d zoci.me --ecc \
          --key-file       "$CERT_DIR/zoci.me.key" \
          --fullchain-file "$CERT_DIR/zoci.me.crt" \
          --reloadcmd "docker exec caddy caddy reload --config /etc/caddy/Caddyfile || true"
  echo ">> done — cert at $CERT_DIR/zoci.me.crt (renewals run via acme.sh's own cron)"
else
  echo ">> staging OK: DNS-01 works end to end. Re-run without 'staging' for the real cert."
fi
