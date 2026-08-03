#!/usr/bin/env bash
# NVMe SSD wear + health from SMART (spec §3). Installed by install-ssd-collector.sh into root's
# crontab, because smartctl needs privileged device access. If smartmontools is not installed, the
# collector still stamps its liveness and emits no wear series, so the dashboard shows "collector
# down" rather than a fabricated healthy reading.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prom.sh"

DEV="${SSD_DEVICE:-/dev/nvme0}"

# Root cron calls smartctl directly. Keep a `sudo -n` fallback for a non-root invocation (only
# works where a scoped sudoers rule is effective, which is not guaranteed on every host).
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo -n"; fi

prom_emit "# HELP zoci_ssd_percentage_used NVMe Percentage Used (0-100+, wear indicator)."
prom_emit "# TYPE zoci_ssd_percentage_used gauge"
prom_emit "# HELP zoci_ssd_available_spare_ratio NVMe Available Spare as a ratio (1.0 = full)."
prom_emit "# TYPE zoci_ssd_available_spare_ratio gauge"
prom_emit "# HELP zoci_ssd_data_units_written_total NVMe Data Units Written (wear trend)."
prom_emit "# TYPE zoci_ssd_data_units_written_total counter"
prom_emit "# HELP zoci_ssd_critical_warning NVMe critical-warning bitmap (0 = healthy)."
prom_emit "# TYPE zoci_ssd_critical_warning gauge"

if command -v smartctl >/dev/null 2>&1; then
  block="$($SUDO smartctl -A -j "$DEV" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
h = d.get("nvme_smart_health_information_log") or {}
out = []
if "percentage_used" in h:
    out.append(f'\''zoci_ssd_percentage_used {h["percentage_used"]}'\'')
if "available_spare" in h:
    out.append(f'\''zoci_ssd_available_spare_ratio {h["available_spare"]/100.0}'\'')
if "data_units_written" in h:
    out.append(f'\''zoci_ssd_data_units_written_total {h["data_units_written"]}'\'')
if "critical_warning" in h:
    out.append(f'\''zoci_ssd_critical_warning {h["critical_warning"]}'\'')
print("\n".join(out))
' || true)"
  [ -n "$block" ] && prom_emit "$block"
else
  echo "collect-ssd: smartctl not found; install smartmontools to enable SSD-wear series" >&2
fi

prom_commit ssd
