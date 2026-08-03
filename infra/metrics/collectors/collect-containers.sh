#!/usr/bin/env bash
# Per-container health and resource use (spec §3), collected host-side so no container needs the
# Docker socket. Selects only .State.* / .RestartCount from `docker inspect`: the raw inspect
# output carries every container's .Config.Env secrets and is never written to a .prom (§2, §5).
# The `container` label is the full docker name (infra-api-1, caddy); the display-name map lives
# in shared SERVICES and is applied by the landing, not here.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prom.sh"

# Health / lifecycle from docker inspect (all containers, including stopped, so a crashed service
# reports up=0 rather than vanishing). One line per field per container.
inspect="$(docker ps -a --format '{{.Names}}' 2>/dev/null \
  | xargs -r docker inspect \
      --format '{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.State.StartedAt}}' \
      2>/dev/null || true)"

# Resource use from docker stats (running only). MemUsage is "used / limit" (limit is host RAM
# until a service sets mem_limit, §3); NetIO/BlockIO are "rx / tx" and "read / write" cumulative.
stats="$(docker stats --no-stream --no-trunc \
  --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}' 2>/dev/null || true)"

block="$(INSPECT="$inspect" STATS="$stats" python3 <<'PY'
import os, re, datetime

def to_bytes(s):
    # Handles docker's mixed units: MemUsage uses MiB/GiB (binary), NetIO/BlockIO use kB/MB/GB
    # (SI, lowercase k). Case-insensitive; the 'i' picks binary vs SI.
    s = s.strip()
    m = re.match(r'([\d.]+)\s*([a-zA-Z]*)B$', s)
    if not m:
        return None
    n = float(m.group(1))
    p = m.group(2).lower()
    mult = {'': 1, 'k': 1000, 'm': 1000**2, 'g': 1000**3, 't': 1000**4,
            'ki': 1024, 'mi': 1024**2, 'gi': 1024**3, 'ti': 1024**4}
    return int(n * mult.get(p, 1))

def epoch(ts):
    # StartedAt is RFC3339 with nanoseconds; 0001-01-01 means never started.
    if ts.startswith('0001'):
        return 0
    ts = re.sub(r'\.(\d{6})\d*', r'.\1', ts).replace('Z', '+00:00')
    try:
        return int(datetime.datetime.fromisoformat(ts).timestamp())
    except Exception:
        return 0

out = []
out.append('# HELP zoci_container_up 1 if the container is running, else 0.')
out.append('# TYPE zoci_container_up gauge')
out.append('# HELP zoci_container_health_info Docker healthcheck state (value 1 on the current state).')
out.append('# TYPE zoci_container_health_info gauge')
out.append('# HELP zoci_container_restart_count Docker restart count for the container.')
out.append('# TYPE zoci_container_restart_count gauge')
out.append('# HELP zoci_container_last_exit_code Exit code of the container main process.')
out.append('# TYPE zoci_container_last_exit_code gauge')
out.append('# HELP zoci_container_start_time_seconds Unix time the container last started (uptime = time() - this).')
out.append('# TYPE zoci_container_start_time_seconds gauge')

for line in os.environ.get('INSPECT', '').splitlines():
    if not line.strip():
        continue
    parts = line.split('|')
    if len(parts) != 6:
        continue
    name, status, health, restarts, exit_code, started = parts
    name = name.lstrip('/')
    up = 1 if status == 'running' else 0
    # Exactly one health line per container per run, so a stale prior state cannot linger (§3).
    out.append(f'zoci_container_up{{container="{name}"}} {up}')
    out.append(f'zoci_container_health_info{{container="{name}",state="{health}"}} 1')
    out.append(f'zoci_container_restart_count{{container="{name}"}} {int(restarts)}')
    out.append(f'zoci_container_last_exit_code{{container="{name}"}} {int(exit_code)}')
    out.append(f'zoci_container_start_time_seconds{{container="{name}"}} {epoch(started)}')

out.append('# HELP zoci_container_cpu_percent Per-container CPU percent (point sample).')
out.append('# TYPE zoci_container_cpu_percent gauge')
out.append('# HELP zoci_container_memory_bytes Per-container memory in use.')
out.append('# TYPE zoci_container_memory_bytes gauge')
out.append('# HELP zoci_container_memory_limit_bytes Per-container memory limit (host RAM until mem_limit is set).')
out.append('# TYPE zoci_container_memory_limit_bytes gauge')
out.append('# HELP zoci_container_network_receive_bytes_total Per-container network bytes received (cumulative).')
out.append('# TYPE zoci_container_network_receive_bytes_total counter')
out.append('# HELP zoci_container_network_transmit_bytes_total Per-container network bytes transmitted (cumulative).')
out.append('# TYPE zoci_container_network_transmit_bytes_total counter')
out.append('# HELP zoci_container_blockio_read_bytes_total Per-container block I/O bytes read (cumulative).')
out.append('# TYPE zoci_container_blockio_read_bytes_total counter')
out.append('# HELP zoci_container_blockio_write_bytes_total Per-container block I/O bytes written (cumulative).')
out.append('# TYPE zoci_container_blockio_write_bytes_total counter')

def pair(field):
    if '/' not in field:
        return None, None
    a, b = field.split('/', 1)
    return to_bytes(a), to_bytes(b)

for line in os.environ.get('STATS', '').splitlines():
    if not line.strip():
        continue
    parts = line.split('|')
    if len(parts) != 5:
        continue
    name, cpu, mem, netio, blockio = parts
    cpu = cpu.strip().rstrip('%')
    try:
        cpu_val = float(cpu)
    except ValueError:
        continue
    out.append(f'zoci_container_cpu_percent{{container="{name}"}} {cpu_val}')
    ub, lb = pair(mem)
    if ub is not None:
        out.append(f'zoci_container_memory_bytes{{container="{name}"}} {ub}')
    if lb is not None:
        out.append(f'zoci_container_memory_limit_bytes{{container="{name}"}} {lb}')
    rx, tx = pair(netio)
    if rx is not None:
        out.append(f'zoci_container_network_receive_bytes_total{{container="{name}"}} {rx}')
    if tx is not None:
        out.append(f'zoci_container_network_transmit_bytes_total{{container="{name}"}} {tx}')
    rd, wr = pair(blockio)
    if rd is not None:
        out.append(f'zoci_container_blockio_read_bytes_total{{container="{name}"}} {rd}')
    if wr is not None:
        out.append(f'zoci_container_blockio_write_bytes_total{{container="{name}"}} {wr}')

print('\n'.join(out))
PY
)"

prom_emit "$block"
prom_commit containers
