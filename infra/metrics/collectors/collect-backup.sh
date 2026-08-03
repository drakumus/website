#!/usr/bin/env bash
# Backup freshness marker (spec §3, ~/specs/backups.md). No backup job exists yet, so until one
# writes the marker file this reports result="not_configured" (a known state, not a failure) and a
# last-success time of 0. The backup job, when it lands, writes BACKUP_MARKER as JSON:
#   {"result":"ok","last_success":<epoch>}   (result "failed" on a failed run)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prom.sh"

MARKER="${BACKUP_MARKER:-/var/lib/zoci/backup-status.json}"

prom_emit "# HELP zoci_backup_last_success_time_seconds Unix time of the last successful backup (0 until configured)."
prom_emit "# TYPE zoci_backup_last_success_time_seconds gauge"
prom_emit "# HELP zoci_backup_status_info Backup result (value 1 on the current result label)."
prom_emit "# TYPE zoci_backup_status_info gauge"

result="not_configured"
last=0
if [ -r "$MARKER" ]; then
  read -r result last < <(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(d.get("result", "failed"), int(d.get("last_success", 0)))
except Exception:
    print("failed", 0)
' "$MARKER")
fi
prom_emit "zoci_backup_last_success_time_seconds $last"
prom_emit "zoci_backup_status_info{result=\"$result\"} 1"

prom_commit backup
