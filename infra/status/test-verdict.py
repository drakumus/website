#!/usr/bin/env python3
"""Unit tests for the verdict rules (spec Part G). Pure evaluate(), no VictoriaMetrics needed.
Run: python3 infra/status/test-verdict.py"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

wv = import_module("write-verdict")
evaluate = wv.evaluate

# A fully-healthy baseline; each test mutates one axis.
BASE = {
    "containers_fresh": True, "containers_down": [], "containers_unhealthy": [], "containers_crashloop": [],
    "node_up": True, "disk_full": [], "disk_high": [], "mem_low": False, "load_high": False,
    "cert_fresh": True, "cert_days": 87.0,
    "ssd_fresh": True, "ssd_critical": False, "ssd_spare": 1.0, "ssd_wear": 0.0,
    "backup_fresh": True, "backup_failed": False,
    "tailnet_fresh": True, "vps_up": 1.0, "ha_reachable": 1.0,
    "api_up": True, "api_err_ratio": 0.0, "images_stale": [], "images_fresh": True,
    "up_web": 1.0, "up_api": 1.0, "up_caddy": 1.0,
}


def sig(**over):
    s = dict(BASE)
    s.update(over)
    return s


passed = 0


def check(name, cond):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}")
        sys.exit(1)


# 1. Healthy baseline.
v, dot = evaluate(sig())
check("healthy baseline -> healthy + green + no problems", v["overall"] == "healthy" and dot == "healthy" and not v["problems"])

# 2. A non-public container down: broken verdict, but public dot stays healthy (internal service).
v, dot = evaluate(sig(containers_down=["jellyfin"]))
check("jellyfin down -> broken verdict", v["overall"] == "broken")
check("jellyfin down -> public dot still healthy", dot == "healthy")
check("jellyfin down -> problem listed as broken", v["problems"][0]["severity"] == "broken" and v["problems"][0]["service"] == "jellyfin")

# 3. A public container down: public dot flips unhealthy.
v, dot = evaluate(sig(up_web=0.0, containers_down=["infra-web-1"]))
check("web down -> public dot unhealthy", dot == "unhealthy")

# 4. SSD wear high (internal-only) -> degraded, public dot NOT flipped.
v, dot = evaluate(sig(ssd_wear=92.0))
check("ssd wear high -> degraded", v["overall"] == "degraded")
check("ssd wear high -> public dot still healthy (internal-only)", dot == "healthy")

# 5. Stale container collector -> can't assert healthy: degraded + public dot unknown.
v, dot = evaluate(sig(containers_fresh=False))
check("stale container collector -> not healthy", v["overall"] == "degraded")
check("stale container collector -> public dot unknown", dot == "unknown")

# 6. Cert thresholds.
v, _ = evaluate(sig(cert_days=3.0))
check("cert 3d -> broken", v["overall"] == "broken")
v, _ = evaluate(sig(cert_days=14.0))
check("cert 14d -> degraded", v["overall"] == "degraded")
_, dot = evaluate(sig(cert_days=-1.0))
check("cert expired -> public dot unhealthy", dot == "unhealthy")

# 7. HA unreachable and VPS peer down -> broken.
v, _ = evaluate(sig(ha_reachable=0.0))
check("HA unreachable -> broken", v["overall"] == "broken")
v, _ = evaluate(sig(vps_up=0.0))
check("VPS peer down -> broken", v["overall"] == "broken")

# 8. Missing cert value -> public dot unknown (fail-safe, never green on missing input).
_, dot = evaluate(sig(cert_days=None))
check("missing cert -> public dot unknown", dot == "unknown")

print(f"\n{passed} checks passed")
