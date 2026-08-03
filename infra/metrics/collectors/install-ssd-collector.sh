#!/usr/bin/env bash
# One-shot privileged setup for the SSD SMART collector (spec Part B). The other collectors run
# unprivileged, but smartctl needs device access. Spec §5 allows either a root cron or a scoped
# sudoers rule; this uses a ROOT cron. A scoped `NOPASSWD: smartctl` sudoers rule is silently
# defeated when the box also grants the collector user a general `user ALL=(ALL:ALL) ALL` line that
# sorts after it (last match wins, and it requires a password), so the root cron is the robust
# choice and does not depend on sudoers ordering. Idempotent: safe to re-run.
#
# Run as root (it re-execs under sudo, prompting once for your password on sudo's own TTY):
#   sudo bash infra/metrics/collectors/install-ssd-collector.sh [device]
# device defaults to /dev/nvme0 (the NVMe controller). If that has no health log, pass the
# namespace device, e.g. /dev/nvme0n1.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Re-running under sudo..." >&2
  exec sudo bash "$0" "$@"
fi

DEVICE="${1:-/dev/nvme0}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> device=$DEVICE  (collector runs from root's crontab)"

# 1. smartmontools
if ! command -v smartctl >/dev/null 2>&1; then
  echo "==> installing smartmontools"
  apt-get update -qq && apt-get install -y smartmontools
else
  echo "==> smartmontools already installed"
fi
SMARTCTL="$(command -v smartctl)"
echo "==> smartctl at $SMARTCTL"

# NVMe SMART is read through the controller device (/dev/nvme0), a character device; SATA disks are
# block devices. Accept either.
if [ ! -b "$DEVICE" ] && [ ! -c "$DEVICE" ]; then
  echo "!! $DEVICE is not a block or character device; pass the right device as arg 1" >&2
  exit 1
fi

# 2. Verify SMART health data is actually readable on this device (as root). smartctl uses a
# bitmask exit status (non-zero even on a healthy read), so check the output, not the exit code.
if "$SMARTCTL" -A -j "$DEVICE" 2>/dev/null | grep -q 'nvme_smart_health_information_log\|percentage_used'; then
  echo "==> OK: SMART health data readable on $DEVICE"
else
  echo "!! no SMART health data on $DEVICE. Try the namespace device:" >&2
  echo "     sudo bash $0 /dev/nvme0n1" >&2
  exit 1
fi

# 3. Remove the stale scoped-sudoers rule if an earlier version of this installer left one; the
# root cron replaces it.
if [ -f /etc/sudoers.d/zoci-smartctl ]; then
  rm -f /etc/sudoers.d/zoci-smartctl
  echo "==> removed stale /etc/sudoers.d/zoci-smartctl (root cron is used instead)"
fi

# 4. Install the ssd collector into ROOT's crontab (idempotent). Pass SSD_DEVICE so the collector
# reads the exact device confirmed above. Running as root, the collector calls smartctl directly.
CRON_LINE="17 * * * * SSD_DEVICE=$DEVICE $DIR/collect-ssd.sh >/dev/null 2>&1"
CUR="$(crontab -l 2>/dev/null || true)"
if printf '%s\n' "$CUR" | grep -Fq "collect-ssd.sh"; then
  echo "==> ssd cron line already present in root's crontab"
else
  printf '%s\n%s\n' "$CUR" "$CRON_LINE" | crontab -
  echo "==> added ssd cron line to root's crontab"
fi

# 5. Run it once now so zoci_ssd_* appears immediately instead of waiting for the top of the hour.
echo "==> priming: running the collector once"
SSD_DEVICE="$DEVICE" "$DIR/collect-ssd.sh" && echo "==> done. zoci_ssd_* is populated; node_exporter will serve it."
