#!/usr/bin/env bash
# Is the VPS tailnet peer online (spec §3)? `tailscale status --json` holds the tailnet name, node
# keys, and real IPs, so this writes ONLY the resulting boolean, never the raw JSON (§5). The VPS
# is identified by VPS_TS_IP (already in infra/.env), so no real IP is baked into this tracked
# script; peer="vps" is a stable alias. Cron must source infra/.env so VPS_TS_IP is present.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prom.sh"

# VPS_TS_IP normally comes from infra/.env; load it directly (grep, not source, to avoid
# executing arbitrary env content) when cron did not already export it.
if [ -z "${VPS_TS_IP:-}" ]; then
  ENV_FILE="$_PROM_LIB_DIR/../../.env"
  [ -r "$ENV_FILE" ] && VPS_TS_IP="$(grep -E '^VPS_TS_IP=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"'"'"'")"
fi

prom_emit "# HELP zoci_tailnet_peer_up 1 if the named tailnet peer is online, 0 if not."
prom_emit "# TYPE zoci_tailnet_peer_up gauge"

# Emit the series only when the VPS peer can be identified; absence is handled by the verdict's
# staleness gate rather than a fabricated 0.
up="$(tailscale status --json 2>/dev/null | VPS_TS_IP="${VPS_TS_IP:-}" python3 -c '
import json, os, sys
ip = os.environ.get("VPS_TS_IP", "").split("/")[0].strip()
if not ip:
    sys.exit(0)
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for p in (d.get("Peer") or {}).values():
    if ip in (p.get("TailscaleIPs") or []):
        print("1" if p.get("Online") else "0")
        break
')"
[ -n "$up" ] && prom_emit "zoci_tailnet_peer_up{peer=\"vps\"} $up"

prom_commit tailnet
