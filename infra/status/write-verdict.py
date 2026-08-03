#!/usr/bin/env python3
"""Host-side verdict evaluator (spec §4, Part G).

Queries VictoriaMetrics on the host loopback, applies the broken/degraded/healthy rule set, and
writes two files atomically with a fresh updatedAt:
  - verdict.json:    the full verdict (served ONLY on the tailnet admin surface).
  - health-dot.json: the public aggregate status (the only thing that crosses to zoci.me).

Fail-safe: if the VM query fails the verdict is written as "unknown", never a stale green. Both
consumers also gate on updatedAt and render "unknown" when the file is stale, so a dead evaluator
cannot read green either.

The rules own every threshold. Green signals are trusted only when their backing collector/scrape
is fresh; a stale input yields a "collector down" problem, never an assumed-healthy reading.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

VM = os.environ.get("VM_URL", "http://127.0.0.1:8428")
OUT_DIR = os.environ.get("VERDICT_DIR", os.path.dirname(os.path.abspath(__file__)))

# Thresholds (the evaluator owns these).
DISK_FULL = 0.02          # < 2% free -> broken
DISK_HIGH = 0.80          # > 80% used -> degraded
MEM_LOW = 0.10            # < 10% available -> degraded
LOAD15_HIGH = 8.0         # 15-min load avg -> degraded
CERT_HARD_DAYS = 7        # < 7 days -> broken
CERT_WARN_DAYS = 21       # < 21 days -> degraded
SSD_SPARE_LOW = 0.10      # < 10% spare -> broken
SSD_WEAR_HIGH = 80        # > 80% used -> degraded
API_ERR_RATIO = 0.05      # > 5% 5xx over 5m -> degraded
CRASHLOOP_CHANGES = 3     # start-time changes in 15m -> broken

# Max age (seconds) before a collector's textfile series is considered stale.
FRESH = {"containers": 180, "tailnet": 180, "backup": 600, "cert": 7200, "ssd": 7200, "images": 172800}
# Public health dot depends only on these container-up signals plus a valid cert (§4).
PUBLIC_CONTAINERS = {"web": "infra-web-1", "api": "infra-api-1", "caddy": "caddy"}


def vm_query(expr):
    """Return the instant-query result vector [(labels, float)]; raise on any transport error."""
    url = VM + "/api/v1/query?" + urllib.parse.urlencode({"query": expr})
    with urllib.request.urlopen(url, timeout=8) as r:
        d = json.load(r)
    if d.get("status") != "success":
        raise RuntimeError(f"vm query failed: {expr}")
    return [(x["metric"], float(x["value"][1])) for x in d["data"]["result"]]


def scalar(expr, default=None):
    r = vm_query(expr)
    return r[0][1] if r else default


def labels_of(expr, key):
    return [m.get(key, "") for m, _ in vm_query(expr)]


def collector_fresh(q, name):
    age = q(f'time() - zoci_collector_last_run_time_seconds{{collector="{name}"}}')
    return age is not None and age <= FRESH[name]


def build_signals(q, labels):
    """Pull every signal the rules need. `q` = scalar query, `labels` = label extractor."""
    s = {}
    s["containers_fresh"] = collector_fresh(q, "containers")
    s["containers_down"] = labels("zoci_container_up == 0", "container")
    s["containers_unhealthy"] = labels('zoci_container_health_info{state="unhealthy"} == 1', "container")
    s["containers_crashloop"] = labels(f"changes(zoci_container_start_time_seconds[15m]) > {CRASHLOOP_CHANGES}", "container")
    s["node_up"] = q('up{job="node"}') == 1
    s["disk_full"] = labels(f"node_filesystem_avail_bytes / node_filesystem_size_bytes < {DISK_FULL}", "mountpoint")
    s["disk_high"] = labels(f"(1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) > {DISK_HIGH} and (node_filesystem_avail_bytes / node_filesystem_size_bytes) >= {DISK_FULL}", "mountpoint")
    s["mem_low"] = (q("node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes") or 1.0) < MEM_LOW
    s["load_high"] = (q("node_load15") or 0.0) > LOAD15_HIGH
    s["cert_fresh"] = collector_fresh(q, "cert")
    s["cert_days"] = q('zoci_cert_expiry_days{host="wildcard"}')
    s["ssd_fresh"] = collector_fresh(q, "ssd")
    s["ssd_critical"] = (q("zoci_ssd_critical_warning") or 0) != 0
    s["ssd_spare"] = q("zoci_ssd_available_spare_ratio")
    s["ssd_wear"] = q("zoci_ssd_percentage_used")
    s["backup_fresh"] = collector_fresh(q, "backup")
    s["backup_failed"] = bool(vm_query('zoci_backup_status_info{result="failed"} == 1'))
    s["tailnet_fresh"] = collector_fresh(q, "tailnet")
    s["vps_up"] = q('zoci_tailnet_peer_up{peer="vps"}')
    s["ha_reachable"] = q("zoci_ha_reachable")
    s["api_up"] = q('up{job="api"}') == 1
    s["api_err_ratio"] = q('sum(rate(zoci_api_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(zoci_api_requests_total[5m])), 0.0001)') or 0.0
    s["images_stale"] = labels("zoci_image_stale == 1", "service")
    s["images_fresh"] = collector_fresh(q, "images")
    for name, cid in PUBLIC_CONTAINERS.items():
        s[f"up_{name}"] = q(f'zoci_container_up{{container="{cid}"}}')
    return s


def evaluate(s):
    """Pure rule application: signals dict -> (verdict dict, public dot status). Testable."""
    broken, degraded = [], []

    def add(bucket, service, detail):
        bucket.append({"service": service, "detail": detail})

    # --- Broken (red) ---
    if not s["containers_fresh"]:
        add(degraded, "collectors", "container collector stale (health unknown)")
    else:
        for c in s["containers_down"]:
            add(broken, c, "container down")
        for c in s["containers_unhealthy"]:
            add(broken, c, "container unhealthy")
        for c in s["containers_crashloop"]:
            add(broken, c, "crash-looping")
    if s["cert_fresh"] and s["cert_days"] is not None and s["cert_days"] < CERT_HARD_DAYS:
        add(broken, "cert", f"expires in {int(s['cert_days'])}d")
    if s["ha_reachable"] == 0:
        add(broken, "home-assistant", "unreachable")
    if s["tailnet_fresh"] and s["vps_up"] == 0:
        add(broken, "tailnet", "VPS peer down")
    for m in s["disk_full"]:
        add(broken, "disk", f"{m} full")
    if s["ssd_fresh"]:
        if s["ssd_critical"]:
            add(broken, "ssd", "SMART critical warning")
        if s["ssd_spare"] is not None and s["ssd_spare"] < SSD_SPARE_LOW:
            add(broken, "ssd", "spare exhausted")
    if s["backup_fresh"] and s["backup_failed"]:
        add(broken, "backup", "last backup failed")

    # --- Degraded (amber) ---
    if s["api_up"] and s["api_err_ratio"] > API_ERR_RATIO:
        add(degraded, "api", f"5xx ratio {s['api_err_ratio']*100:.0f}%")
    if s["cert_fresh"] and s["cert_days"] is not None and CERT_HARD_DAYS <= s["cert_days"] < CERT_WARN_DAYS:
        add(degraded, "cert", f"expires in {int(s['cert_days'])}d")
    for m in s["disk_high"]:
        add(degraded, "disk", f"{m} above 80%")
    if s["mem_low"]:
        add(degraded, "memory", "available below 10%")
    if s["load_high"]:
        add(degraded, "cpu", "sustained high load")
    if s["ssd_fresh"] and s["ssd_wear"] is not None and s["ssd_wear"] > SSD_WEAR_HIGH:
        add(degraded, "ssd", f"wear at {int(s['ssd_wear'])}%")
    if s["images_fresh"]:
        for svc in s["images_stale"]:
            add(degraded, svc, "image behind latest")
    for name in ("containers", "tailnet", "backup", "cert", "ssd"):
        if not s[f"{name}_fresh"] and name != "containers":  # containers handled above
            add(degraded, "collectors", f"{name} collector stale")
    if not s["node_up"]:
        add(degraded, "collectors", "host metrics scrape down")

    if broken:
        overall, summary = "broken", plural(len(broken) + len(degraded))
    elif degraded:
        overall, summary = "degraded", plural(len(degraded))
    else:
        overall, summary = "healthy", "All systems healthy"

    problems = [{**p, "severity": "broken"} for p in broken] + [{**p, "severity": "degraded"} for p in degraded]
    verdict = {"overall": overall, "summary": summary, "problems": problems}

    # --- Public health dot: only public-relevant inputs (§4). Unknown if any is stale/missing. ---
    if not s["containers_fresh"] or not s["cert_fresh"] or s["cert_days"] is None:
        dot = "unknown"
    elif any(s[f"up_{n}"] != 1 for n in PUBLIC_CONTAINERS) or s["cert_days"] <= 0:
        dot = "unhealthy"
    else:
        dot = "healthy"
    return verdict, dot


def plural(n):
    return "All systems healthy" if n == 0 else f"{n} problem" + ("s" if n != 1 else "")


def write_atomic(path, obj):
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def main():
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        signals = build_signals(scalar, labels_of)
        verdict, dot = evaluate(signals)
    except Exception as e:  # VM unreachable / query error -> fail safe, never stale green
        print(f"write-verdict: query failed: {e}", file=sys.stderr)
        verdict = {"overall": "unknown", "summary": "Verdict unavailable", "problems": []}
        dot = "unknown"
    verdict["updatedAt"] = now
    write_atomic(os.path.join(OUT_DIR, "verdict.json"), verdict)
    write_atomic(os.path.join(OUT_DIR, "health-dot.json"), {"status": dot, "updatedAt": now})


if __name__ == "__main__":
    main()
