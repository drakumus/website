#!/usr/bin/env bash
#
# Scan tracked files for infrastructure secrets / PII that must never land in the repo:
# real IP addresses, tailnet names, and email addresses. Exit 1 if any are found.
# Run before pushing:  bash scripts/check-secrets.sh   (or: make check-secrets)
#
# Allowlisted (safe): 127.0.0.1, 0.0.0.0, ::1, localhost, placeholder tokens, example.com.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
# Allowlisted (safe): loopback/placeholders/example.com, plus the universal Tailscale ranges
# (CGNAT 100.64.0.0/10 + IPv6 ULA fd7a:115c:a1e0::/48) — same for every tailnet, not secrets;
# used by the private-vhost source-IP backstop in infra/Caddyfile (secure-access.md §7.1).
ALLOW='127\.0\.0\.1|0\.0\.0\.0|::1|example\.com|<[A-Za-z0-9_-]+>|100\.64\.0\.0/10|fd7a:115c:a1e0::/48'

# Skip binary-ish assets and lockfiles: no secrets there, and their numeric blobs
# (SVG path data, hashes) false-positive on IP-like patterns. BrandIcon.tsx holds inline
# SVG icon paths (decimal bezier coords) — same false-positive case as *.svg.
EXCLUDES=(':!scripts/check-secrets.sh' ':!*.svg' ':!*.png' ':!*.jpg' ':!*.jpeg'
          ':!*.ico' ':!*.webp' ':!package-lock.json' ':!app/src/components/BrandIcon.tsx')

scan() {
  local label="$1" regex="$2"
  local hits
  hits=$(git grep -nIE "$regex" -- . "${EXCLUDES[@]}" 2>/dev/null | grep -vE "$ALLOW" || true)
  if [ -n "$hits" ]; then
    echo "!! possible $label in tracked files:"
    echo "$hits" | sed 's/^/   /'
    fail=1
  fi
}

scan "IPv4 address"    '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'
scan "IPv6 address"    '\b(2[0-9a-fA-F]{3}|3[0-9a-fA-F]{3}|f[cd][0-9a-fA-F]{2}):[0-9a-fA-F:]{2,}\b'
scan "email address"   '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
scan "tailnet name"    '\b[a-z0-9-]+\.ts\.net\b'

if [ "$fail" -eq 0 ]; then
  echo "OK: no infra IPs, emails, or tailnet names found in tracked files."
fi
exit "$fail"
