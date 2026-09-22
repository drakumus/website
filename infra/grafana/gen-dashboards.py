#!/usr/bin/env python3
"""Generate the Grafana dashboards for the admin surface (spec §2/Part C).

Source of truth for all dashboard JSON under ./dashboards. Run after editing the SYSTEMS taxonomy
or any panel:  python3 infra/grafana/gen-dashboards.py   (then recreate grafana to reload).

Produces:
  - general.json          the overview: Hardware + Docker + a systems-health rollup.
  - system-<name>.json    one RCA drill-down per system (container health + per-resource graphs +
                          app metrics where the system owns api / ha-broker).

A container may belong to several systems; repeating a metric across drill-downs is intended.
Grafana supplies the palette; status colors (green up / red down) always ship with a text label.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "dashboards")
DS = {"type": "prometheus", "uid": "victoriametrics"}

# system -> full docker container names (the `container` metric label). Order matters for display.
SYSTEMS = {
    "edge":    ["caddy", "infra-coredns-1"],
    "web":     ["infra-web-1", "infra-api-1"],
    "guest":   ["infra-oauth2-proxy-1", "infra-ha-broker-1", "infra-api-1"],
    "admin":   ["infra-admin-web-1", "infra-api-1"],
    "metrics": ["infra-victoria-metrics-1", "infra-node-exporter-1", "infra-grafana-1"],
    "media":   ["jellyfin"],
    "music":   ["muse"],
    "AI":      ["hermes"],
    "finance": [],
}


def short(c):
    """infra-api-1 -> api, caddy -> caddy, hermes -> hermes."""
    return re.sub(r"-\d+$", "", re.sub(r"^infra-", "", c))


def container_re(names):
    # Container names are [a-z0-9-] only (no regex metachars); join as an RE2 alternation. Do NOT
    # re.escape: it turns '-' into '\-', which RE2 (VictoriaMetrics) rejects as an invalid escape.
    return "|".join(names)


_id = [0]


def nid():
    _id[0] += 1
    return _id[0]


def _targets(specs):
    out = []
    for i, (expr, legend) in enumerate(specs):
        out.append({"datasource": DS, "expr": expr, "legendFormat": legend,
                    "refId": chr(65 + i), "editorMode": "code", "range": True, "instant": False})
    return out


def ts(title, x, y, w, h, specs, unit=None, desc=""):
    """A time-series panel (change-over-time). Thin 2px lines, light fill, no points."""
    defaults = {"color": {"mode": "palette-classic"},
                "custom": {"lineWidth": 2, "fillOpacity": 8, "showPoints": "never",
                           "spanNulls": True, "axisBorderShow": False, "gradientMode": "none"}}
    if unit:
        defaults["unit"] = unit
    return {"id": nid(), "type": "timeseries", "title": title, "description": desc, "datasource": DS,
            "gridPos": {"h": h, "w": w, "x": x, "y": y}, "targets": _targets(specs),
            "fieldConfig": {"defaults": defaults, "overrides": []},
            "options": {"legend": {"displayMode": "list", "placement": "bottom", "calcs": []},
                        "tooltip": {"mode": "multi", "sort": "desc"}}}


def stat(title, x, y, w, h, expr, unit=None, thresholds=None, desc="", legend=""):
    defaults = {"color": {"mode": "thresholds" if thresholds else "palette-classic"}, "custom": {}}
    if unit:
        defaults["unit"] = unit
    if thresholds:
        defaults["thresholds"] = {"mode": "absolute", "steps": thresholds}
    return {"id": nid(), "type": "stat", "title": title, "description": desc, "datasource": DS,
            "gridPos": {"h": h, "w": w, "x": x, "y": y}, "targets": _targets([(expr, legend)]),
            "fieldConfig": {"defaults": defaults, "overrides": []},
            "options": {"colorMode": "value", "graphMode": "area", "justifyMode": "auto",
                        "textMode": "auto", "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}}}


def gauge(title, x, y, w, h, expr, unit="percent", steps=None):
    defaults = {"unit": unit, "min": 0, "max": 100, "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": steps or [{"color": "red", "value": None}, {"color": "yellow", "value": 20}, {"color": "green", "value": 40}]}}
    return {"id": nid(), "type": "gauge", "title": title, "datasource": DS,
            "gridPos": {"h": h, "w": w, "x": x, "y": y}, "targets": _targets([(expr, "")]),
            "fieldConfig": {"defaults": defaults, "overrides": []},
            "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                        "showThresholdLabels": False, "showThresholdMarkers": True}}


def health_tile(title, x, y, w, h, expr, link=None):
    """Status tile: green 'up' / red 'down' / gray 'n/a'. Color is always paired with the label."""
    defaults = {"color": {"mode": "thresholds"}, "noValue": "n/a",
                "mappings": [{"type": "value", "options": {"1": {"text": "up", "index": 0}, "0": {"text": "down", "index": 1}}}],
                "thresholds": {"mode": "absolute", "steps": [{"color": "red", "value": None}, {"color": "green", "value": 0.5}]}}
    if link:
        defaults["links"] = [{"title": "drill down", "url": link, "targetBlank": False}]
    return {"id": nid(), "type": "stat", "title": title, "datasource": DS,
            "gridPos": {"h": h, "w": w, "x": x, "y": y}, "targets": _targets([(expr, "")]),
            "fieldConfig": {"defaults": defaults, "overrides": []},
            "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center",
                        "textMode": "value", "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}}}


def status_table(title, x, y, w, h, containers):
    """A per-container list of uptime + restarts + last exit code (clearer than a sawtooth uptime
    graph). `max by (container)` drops instance/job so the join leaves clean columns."""
    csel = f'{{container=~"{container_re(containers)}"}}'
    targets = [
        {"datasource": DS, "refId": "uptime", "instant": True, "format": "table", "editorMode": "code",
         "expr": f'max by (container) (time() - zoci_container_start_time_seconds{csel})'},
        {"datasource": DS, "refId": "restarts", "instant": True, "format": "table", "editorMode": "code",
         "expr": f'max by (container) (zoci_container_restart_count{csel})'},
        {"datasource": DS, "refId": "exit", "instant": True, "format": "table", "editorMode": "code",
         "expr": f'max by (container) (zoci_container_last_exit_code{csel})'},
    ]
    transformations = [
        {"id": "joinByField", "options": {"byField": "container", "mode": "outer"}},
        {"id": "filterFieldsByName", "options": {"include": {"pattern": "^(container|Value.*)$"}}},
        {"id": "organize", "options": {"renameByName": {
            "container": "Container", "Value #uptime": "Uptime",
            "Value #restarts": "Restarts", "Value #exit": "Exit code"}}},
    ]
    overrides = [
        {"matcher": {"id": "byName", "options": "Uptime"}, "properties": [{"id": "unit", "value": "s"}]},
        {"matcher": {"id": "byName", "options": "Restarts"},
         "properties": [{"id": "custom.cellOptions", "value": {"type": "color-text"}},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                            {"color": "text", "value": None}, {"color": "yellow", "value": 1}, {"color": "red", "value": 5}]}}]},
    ]
    return {"id": nid(), "type": "table", "title": title, "datasource": DS,
            "gridPos": {"h": h, "w": w, "x": x, "y": y}, "targets": targets,
            "transformations": transformations,
            "fieldConfig": {"defaults": {"custom": {"filterable": True, "align": "auto"}}, "overrides": overrides},
            "options": {"showHeader": True, "sortBy": [{"displayName": "Restarts", "desc": True}]}}


def text_panel(title, x, y, w, h, md):
    return {"id": nid(), "type": "text", "title": title, "gridPos": {"h": h, "w": w, "x": x, "y": y},
            "options": {"mode": "markdown", "content": md}}


def row(title, y):
    return {"id": nid(), "type": "row", "title": title, "collapsed": False,
            "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []}


def dashboard(uid, title, panels, links=None):
    return {"uid": uid, "title": title, "tags": ["zoci"], "timezone": "browser",
            "schemaVersion": 39, "version": 1, "editable": False, "refresh": "30s",
            "time": {"from": "now-6h", "to": "now"}, "links": links or [], "panels": panels}


# --------------------------------------------------------------------------- General
def system_band(p, system, containers, y):
    """One system group: a titled row, its health tiles (aggregate + per-container up/down), then
    that system's CPU% and Memory graphs. Each line fills 24 cols so Grafana's auto-compaction
    can't pull the next system's panels up into a gap."""
    p.append(row(system, y)); y += 1
    AGG_W = 6
    agg = (f'min(zoci_container_up{{container=~"{container_re(containers)}"}})'
           if containers else 'min(zoci_container_up{container="__not_deployed__"})')
    p.append(health_tile(system, 0, y, AGG_W, 4, agg))
    if not containers:
        p.append(text_panel("", AGG_W, y, 24 - AGG_W, 4, f"_{system}.zoci.me is not deployed yet._"))
        return y + 4
    x = AGG_W
    n = len(containers)
    for i, c in enumerate(containers):
        w = (24 - AGG_W) // n if i < n - 1 else (24 - x)
        p.append(health_tile(short(c), x, y, w, 4, f'zoci_container_up{{container="{c}"}}'))
        x += w
    y += 4
    csel = f'{{container=~"{container_re(containers)}"}}'
    p.append(ts("CPU %", 0, y, 12, 7, [(f'zoci_container_cpu_percent{csel}', "{{container}}")], unit="percent"))
    p.append(ts("Memory", 12, y, 12, 7, [(f'zoci_container_memory_bytes{csel}', "{{container}}")], unit="bytes"))
    return y + 7


def build_general():
    p = []
    y = 0
    # ---- Hardware ----
    p.append(row("Hardware", y)); y += 1
    p.append(ts("CPU load average", 0, y, 8, 8,
                [("node_load1", "1m"), ("node_load5", "5m"), ("node_load15", "15m")], desc="System load average."))
    p.append(gauge("Memory available", 8, y, 4, 8,
                   "100 * node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes"))
    p.append(ts("CPU busy %", 12, y, 12, 8,
                [("100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])))", "busy")], unit="percent"))
    y += 8
    p.append(ts("Memory used", 0, y, 12, 7,
                [("node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes", "used")], unit="bytes"))
    p.append(ts("Network throughput", 12, y, 12, 7,
                [("rate(zoci_host_network_receive_bytes_total[5m])", "rx {{device}}"),
                 ("rate(zoci_host_network_transmit_bytes_total[5m])", "tx {{device}}")],
                unit="Bps", desc="Per-interface host throughput (loopback + container veths excluded)."))
    y += 7

    # ---- Docker summary ----
    p.append(row("Docker", y)); y += 1
    p.append(stat("Active containers", 0, y, 4, 5, "count(zoci_container_up == 1)",
                  thresholds=[{"color": "green", "value": None}], desc="Running monitored containers."))
    p.append(stat("Down", 4, y, 4, 5, "count(zoci_container_up == 0) or on() vector(0)",
                  thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 1}]))
    p.append(ts("Total container CPU %", 8, y, 8, 5, [("sum(zoci_container_cpu_percent)", "total")], unit="percent"))
    p.append(ts("Total container memory", 16, y, 8, 5, [("sum(zoci_container_memory_bytes)", "total")], unit="bytes"))
    y += 5

    # ---- Per-system groups: status + utilization grouped by system ----
    for system, containers in SYSTEMS.items():
        y = system_band(p, system, containers, y)

    return dashboard("zoci-general", "General", p)


# --------------------------------------------------------------------------- Drill-downs
def build_system(system, containers):
    p = []
    y = 0
    if not containers:
        p.append(text_panel(f"{system}", 0, 0, 24, 4,
                             f"### {system}\n\n`{system}.zoci.me` has no container deployed yet. When it lands, it "
                             f"joins the systems taxonomy in `infra/grafana/gen-dashboards.py` and this drill-down fills in."))
        return dashboard(f"zoci-sys-{system}", f"System · {system}", p)

    cre = container_re(containers)
    csel = f'{{container=~"{cre}"}}'

    # ---- Health ----
    p.append(row("Health", y)); y += 1
    x = 0
    for c in containers:
        p.append(health_tile(short(c), x, y, 4, 4, f'zoci_container_up{{container="{c}"}}'))
        x += 4
    y += 4
    th = len(containers) + 3  # panel title + header + one grid row per container
    p.append(status_table("Restarts & uptime", 0, y, 24, th, containers))
    y += th

    # ---- Resources ----
    p.append(row("Resources", y)); y += 1
    p.append(ts("CPU %", 0, y, 12, 8, [(f'zoci_container_cpu_percent{csel}', "{{container}}")], unit="percent"))
    p.append(ts("Memory", 12, y, 12, 8, [(f'zoci_container_memory_bytes{csel}', "{{container}}")], unit="bytes"))
    y += 8
    p.append(ts("Network I/O", 0, y, 12, 7,
                [(f'rate(zoci_container_network_receive_bytes_total{csel}[5m])', "rx {{container}}"),
                 (f'rate(zoci_container_network_transmit_bytes_total{csel}[5m])', "tx {{container}}")], unit="Bps"))
    p.append(ts("Block I/O", 12, y, 12, 7,
                [(f'rate(zoci_container_blockio_read_bytes_total{csel}[5m])', "read {{container}}"),
                 (f'rate(zoci_container_blockio_write_bytes_total{csel}[5m])', "write {{container}}")], unit="Bps"))
    y += 7

    # ---- App metrics (only where the system owns the instrumented container) ----
    if "infra-api-1" in containers:
        p.append(row("API", y)); y += 1
        p.append(ts("Request rate by route", 0, y, 12, 8,
                    [("sum by (route) (rate(zoci_api_requests_total[5m]))", "{{route}}")], unit="reqps"))
        p.append(ts("p95 latency by route", 12, y, 12, 8,
                    [("histogram_quantile(0.95, sum by (le, route) (rate(zoci_api_request_duration_seconds_bucket[5m])))", "{{route}}")], unit="s"))
        y += 8
        p.append(ts("Error ratio (5xx)", 0, y, 12, 7,
                    [("sum(rate(zoci_api_requests_total{status=~\"5..\"}[5m])) / clamp_min(sum(rate(zoci_api_requests_total[5m])), 0.0001)", "5xx")], unit="percentunit"))
        p.append(ts("In-flight requests", 12, y, 12, 7, [("zoci_api_inflight_requests", "inflight")]))
        y += 7

    if "infra-ha-broker-1" in containers:
        p.append(row("Home Assistant", y)); y += 1
        p.append(stat("HA reachable", 0, y, 6, 7, "zoci_ha_reachable",
                      thresholds=[{"color": "red", "value": None}, {"color": "green", "value": 1}]))
        p.append(ts("Round-trip failures", 6, y, 9, 7, [("rate(zoci_ha_roundtrip_failures_total[5m])", "failures/s")]))
        p.append(ts("Round-trip p95", 15, y, 9, 7,
                    [("histogram_quantile(0.95, sum by (le) (rate(zoci_ha_roundtrip_seconds_bucket[5m])))", "p95")], unit="s"))
        y += 7

    return dashboard(f"zoci-sys-{system}", f"System · {system}", p)


def write(name, obj, tag_system=False):
    if tag_system:
        obj["tags"] = ["zoci", "zoci-system"]
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")
    return name


def main():
    os.makedirs(OUT, exist_ok=True)
    written = [write("general.json", build_general())]
    for system, containers in SYSTEMS.items():
        written.append(write(f"system-{system}.json", build_system(system, containers), tag_system=True))
    # Remove the superseded single dashboard if present.
    old = os.path.join(OUT, "system-health.json")
    if os.path.exists(old):
        os.remove(old)
    print("wrote:", ", ".join(written))


if __name__ == "__main__":
    main()
