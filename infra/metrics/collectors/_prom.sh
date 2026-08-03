#!/usr/bin/env bash
# Shared helpers for the host metrics collectors (spec Part B). A collector sources this, emits
# zoci_* lines with prom_emit, then prom_commit writes them atomically into the textfile-collector
# directory that node-exporter reads read-only.
#
# Committing also stamps the collector's own liveness series (zoci_collector_last_run_time_seconds).
# A textfile series re-serves its last written value forever, so a dead collector would otherwise
# read healthy; the stamp (and the file mtime) let the verdict gate on freshness instead (§3).
set -euo pipefail

_PROM_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Default output dir is <repo>/infra/metrics/textfile; override TEXTFILE_DIR for tests.
TEXTFILE_DIR="${TEXTFILE_DIR:-$(cd "$_PROM_LIB_DIR/../textfile" && pwd)}"
# cron runs with a minimal PATH; docker, tailscale, openssl, smartctl all live in these dirs.
export PATH="/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin:$PATH"

_PROM_BUF=""
prom_emit() { _PROM_BUF+="$1"$'\n'; }

# prom_commit <collector-name>: append the liveness stamp, then publish <name>.prom atomically.
# mktemp + mv on the same filesystem is atomic, so node-exporter never scrapes a half-written file.
prom_commit() {
  local name="$1" out tmp
  out="$TEXTFILE_DIR/$name.prom"
  prom_emit "# HELP zoci_collector_last_run_time_seconds Unix time each collector last completed a run."
  prom_emit "# TYPE zoci_collector_last_run_time_seconds gauge"
  prom_emit "zoci_collector_last_run_time_seconds{collector=\"$name\"} $(date +%s)"
  tmp="$(mktemp "$TEXTFILE_DIR/.$name.prom.XXXXXX")"
  printf '%s' "$_PROM_BUF" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$out"
}
