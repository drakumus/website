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


def table(title, x, y, w, h, expr, desc=""):
    return {"id": nid(), "type": "table", "title": title, "description": desc, "datasource": DS,
            "gridPos": {"h": h, "w": w, "x": x, "y": y},
            "targets": [{"datasource": DS, "expr": expr, "refId": "A", "editorMode": "code", "instant": True, "format": "table"}],
            "fieldConfig": {"defaults": {"custom": {"filterable": True}}, "overrides": []},
            "options": {"showHeader": True}}


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


def drill_url(system):
    return f"/grafana/d/zoci-sys-{system}/system-{system}?kiosk&${{__url_time_range}}"


# --------------------------------------------------------------------------- General
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

    # ---- Docker ----
    p.append(row("Docker", y)); y += 1
    p.append(stat("Active containers", 0, y, 4, 8, "count(zoci_container_up == 1)",
                  thresholds=[{"color": "green", "value": None}], desc="Running monitored containers."))
    p.append(ts("Container CPU %", 4, y, 10, 8, [("zoci_container_cpu_percent", "{{container}}")], unit="percent"))
    p.append(ts("Container memory", 14, y, 10, 8, [("zoci_container_memory_bytes", "{{container}}")], unit="bytes"))
    y += 8
    p.append(ts("Container network I/O", 0, y, 12, 7,
                [("rate(zoci_container_network_receive_bytes_total[5m]) + rate(zoci_container_network_transmit_bytes_total[5m])", "{{container}}")],
                unit="Bps", desc="Receive + transmit rate per container (host-networked containers report 0)."))
    p.append(ts("Container block I/O", 12, y, 12, 7,
                [("rate(zoci_container_blockio_read_bytes_total[5m]) + rate(zoci_container_blockio_write_bytes_total[5m])", "{{container}}")],
                unit="Bps"))
    y += 7

    # ---- Systems (health rollup) ----
    # Each system is one full-width (24-col) band: aggregate tile + a tile per container. Filling
    # the full width matters: Grafana auto-compacts panels into horizontal gaps, so a short band
    # would pull the next system's tiles up into it. The aggregate is min(up) over the system's
    # containers (red if any down); the panel title carries the name (textMode shows only up/down).
    p.append(row("Systems", y)); y += 1
    AGG_W = 6
    for system, containers in SYSTEMS.items():
        agg = (f'min(zoci_container_up{{container=~"{container_re(containers)}"}})'
               if containers else 'min(zoci_container_up{container="__not_deployed__"})')
        p.append(health_tile(system, 0, y, AGG_W, 4, agg, link=drill_url(system)))
        x = AGG_W
        n = len(containers)
        for i, c in enumerate(containers):
            w = (24 - AGG_W) // n if i < n - 1 else (24 - x)  # last tile fills the remainder
            p.append(health_tile(short(c), x, y, w, 4, f'zoci_container_up{{container="{c}"}}',
                                  link=drill_url(system)))
            x += w
        y += 4

    links = [{"title": "Drill-downs", "type": "dashboards", "tags": ["zoci-system"], "asDropdown": True,
              "includeVars": True, "keepTime": True}]
    return dashboard("zoci-general", "General", p, links)


# --------------------------------------------------------------------------- Drill-downs
def build_system(system, containers):
    p = []
    y = 0
    if not containers:
        p.append(text_panel(f"{system}", 0, 0, 24, 4,
                             f"### {system}\n\n`{system}.zoci.me` has no container deployed yet. When it lands, it "
                             f"joins the systems taxonomy in `infra/grafana/gen-dashboards.py` and this drill-down fills in."))
        return dashboard(f"zoci-sys-{system}", f"System · {system}", p, back_link())

    cre = container_re(containers)
    csel = f'{{container=~"{cre}"}}'

    # ---- Health ----
    p.append(row("Health", y)); y += 1
    x = 0
    for c in containers:
        p.append(health_tile(short(c), x, y, 4, 4, f'zoci_container_up{{container="{c}"}}'))
        x += 4
    y += 4
    p.append(stat("Restarts (max)", 0, y, 6, 5, f'max(zoci_container_restart_count{csel})',
                  thresholds=[{"color": "green", "value": None}, {"color": "yellow", "value": 1}, {"color": "red", "value": 5}]))
    p.append(ts("Uptime", 6, y, 18, 5, [(f'time() - zoci_container_start_time_seconds{csel}', "{{container}}")], unit="s"))
    y += 5

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

    return dashboard(f"zoci-sys-{system}", f"System · {system}", p, back_link())


def back_link():
    return [{"title": "General", "type": "link", "url": "/grafana/d/zoci-general/general?kiosk&${__url_time_range}",
             "icon": "dashboard", "keepTime": True, "targetBlank": False}]


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
