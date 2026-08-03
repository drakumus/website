#!/usr/bin/env bash
# Pinned-image staleness (spec §3): 1 when a digest-pinned third-party image has fallen behind
# latest, which is a known-CVE exposure window on a public repo. Reuses the repo's own checker
# (scripts/check-image-updates.sh) rather than reimplementing digest comparison. This pulls image
# manifests and hits registries, so run it on a slow cadence (daily), not every minute.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prom.sh"

REPO="$(cd "$_PROM_LIB_DIR/../../.." && pwd)"

prom_emit "# HELP zoci_image_stale 1 if a pinned third-party image is behind latest, else 0."
prom_emit "# TYPE zoci_image_stale gauge"

block="$(bash "$REPO/scripts/check-image-updates.sh" 2>/dev/null | python3 -c '
import re, sys
for line in sys.stdin:
    m = re.match(r"\s+(STALE|ok)\s+(\S+)", line)
    if not m:
        continue
    stale, name = m.group(1), m.group(2)
    service = name.split("/")[-1].split(":")[0]   # coredns/coredns -> coredns; short alias only
    print(f'\''zoci_image_stale{{service="{service}"}} {1 if stale=="STALE" else 0}'\'')
' || true)"
[ -n "$block" ] && prom_emit "$block"

prom_commit images
