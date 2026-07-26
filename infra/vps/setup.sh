#!/usr/bin/env bash
#
# zoci.me VPS ingress setup — OVH VPS (public IP) -> home server over Tailscale.
#
# Installs an nginx `stream` (L4) TCP passthrough that forwards :80 and :443 to the
# home server's tailnet IP WITHOUT terminating TLS. The home Caddy terminates and
# gets its own Let's Encrypt cert via TLS-ALPN-01 through this passthrough.
#
# Run as root on the VPS (Debian/Ubuntu):
#   sudo HOME_TS_IP=<home-tailnet-ip> bash setup.sh
#
# Prereq: Tailscale is already installed + joined on this VPS (see infra/vps/README.md),
# and the home box is reachable at HOME_TS_IP over the tailnet.
set -euo pipefail

# Home server tailnet IPv4 — pass via env (do not hardcode infra addresses in the repo).
HOME_TS_IP="${HOME_TS_IP:?set HOME_TS_IP to the home server's tailnet IPv4}"

echo ">> Forwarding :80 and :443 -> ${HOME_TS_IP}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx libnginx-mod-stream

# Free :80/:443 for the stream passthrough (drop nginx's default HTTP site).
rm -f /etc/nginx/sites-enabled/default

# L4 passthrough drop-in.
install -d /etc/nginx/stream.d
cat > /etc/nginx/stream.d/zoci.conf <<EOF
# Raw TCP passthrough to the home server over Tailscale. nginx never decrypts;
# TLS terminates at home. Home sees this VPS's tailnet IP as the source (constant).
upstream zoci_home_https { server ${HOME_TS_IP}:443; }
upstream zoci_home_http  { server ${HOME_TS_IP}:80;  }

server {
    listen 443;
    listen [::]:443;
    proxy_pass zoci_home_https;
    proxy_timeout 300s;
}
server {
    listen 80;
    listen [::]:80;
    proxy_pass zoci_home_http;
    proxy_timeout 30s;
}
EOF

# Add a top-level stream{} that includes the drop-in (idempotent).
if ! grep -q "stream.d/\*.conf" /etc/nginx/nginx.conf; then
  cat >> /etc/nginx/nginx.conf <<'EOF'

stream {
    include /etc/nginx/stream.d/*.conf;
}
EOF
fi

nginx -t
systemctl enable nginx
systemctl restart nginx
echo ">> Done. nginx is forwarding :80/:443 -> ${HOME_TS_IP}"
echo ">> Until the home Caddy is up (Phase 4), forwarded connections will refuse — that's expected."
