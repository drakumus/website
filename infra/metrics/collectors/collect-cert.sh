#!/usr/bin/env bash
# Days until the public wildcard TLS cert expires (spec §3). Reads the certificate only, never
# the private key. host="wildcard" is a stable alias, not a real hostname (§3 label hygiene).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prom.sh"

CERT="${CERT_FILE:-$_PROM_LIB_DIR/../../certs/zoci.me.crt}"

prom_emit "# HELP zoci_cert_expiry_days Days until the public TLS certificate expires."
prom_emit "# TYPE zoci_cert_expiry_days gauge"
if enddate="$(openssl x509 -enddate -noout -in "$CERT" 2>/dev/null | cut -d= -f2)" \
   && end_epoch="$(date -d "$enddate" +%s 2>/dev/null)"; then
  days=$(( (end_epoch - $(date +%s)) / 86400 ))
  prom_emit "zoci_cert_expiry_days{host=\"wildcard\"} $days"
fi

prom_commit cert
