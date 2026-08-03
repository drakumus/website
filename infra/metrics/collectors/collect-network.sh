#!/usr/bin/env bash
# Host network throughput per interface (spec §3, Hardware). node-exporter runs in an isolated
# network namespace (the metrics bridge), so its netdev view is only its own eth0/lo; the host's
# real interfaces live in the host netns. This host-side collector reads /proc/net/dev directly
# (the host's, since it runs on the host) and emits cumulative rx/tx byte counters per interface.
# Loopback and container veth pairs are dropped as noise; physical NICs, tailscale, and docker
# bridges are kept. Interface names only, no addresses.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prom.sh"

prom_emit "# HELP zoci_host_network_receive_bytes_total Host interface bytes received (cumulative)."
prom_emit "# TYPE zoci_host_network_receive_bytes_total counter"
prom_emit "# HELP zoci_host_network_transmit_bytes_total Host interface bytes transmitted (cumulative)."
prom_emit "# TYPE zoci_host_network_transmit_bytes_total counter"

block="$(python3 - <<'PY'
out = []
with open('/proc/net/dev') as f:
    for line in f:
        if ':' not in line:
            continue
        name, rest = line.split(':', 1)
        dev = name.strip()
        # Drop loopback, container veth pairs, and per-network docker bridges (br-<hash>, whose
        # names churn on every network recreate -> stale high-cardinality series). Keep physical
        # NICs, tailscale, and docker0. Per-container traffic is covered by the docker-stats series.
        if dev == 'lo' or dev.startswith('veth') or dev.startswith('br-'):
            continue
        cols = rest.split()
        if len(cols) < 9:
            continue
        out.append(f'zoci_host_network_receive_bytes_total{{device="{dev}"}} {cols[0]}')
        out.append(f'zoci_host_network_transmit_bytes_total{{device="{dev}"}} {cols[8]}')
print('\n'.join(out))
PY
)"
[ -n "$block" ] && prom_emit "$block"

prom_commit network
