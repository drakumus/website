#!/usr/bin/env python3
"""Access-audit processor (spec §6, Part H).

Reads Caddy's JSON access log for the private + guest vhosts, resolves the accessing identity, and
appends curated records to an append-only store the api serves on the tailnet admin surface. Runs
from ROOT cron: it reads Caddy's root-owned log and runs `tailscale whois`.

Identity: for the private vhosts (admin/ha/finance) the accessing tailnet device via `tailscale
whois` on the source IP (device + login); for guest the oauth2 email header. Only the device login
name is kept, never the raw whois output (which holds the tailnet name, keys, and real IPs).

Curated record: {ts, vhost, method, path, status, device, user}. Both this store and the raw Caddy
log hold identities, so both are host-only, gitignored, restricted, and never served publicly (§5).
"""
import json
import os
import re
import subprocess
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
CADDY_LOG = os.environ.get("CADDY_AUDIT_LOG", os.path.join(REPO, "audit", "caddy", "audit.log"))
STORE = os.environ.get("ACCESS_STORE", os.path.join(HERE, "access.jsonl"))
STATE = os.environ.get("AUDIT_STATE", os.path.join(REPO, "audit", ".audit-offset"))
RETAIN_S = 180 * 86400  # 6 months
GUEST_VHOST = "guest.zoci.me"


def to_epoch(ts):
    if isinstance(ts, (int, float)):
        return float(ts)
    try:
        return float(ts)
    except Exception:
        try:
            return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
        except Exception:
            return time.time()


def read_offset():
    try:
        with open(STATE) as f:
            d = json.load(f)
        st = os.stat(CADDY_LOG)
        # Restart if the log rolled (inode changed) or was truncated below our offset.
        if d.get("inode") != st.st_ino or d.get("offset", 0) > st.st_size:
            return 0
        return d.get("offset", 0)
    except Exception:
        return 0


def write_offset(offset):
    try:
        st = os.stat(CADDY_LOG)
        tmp = STATE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"inode": st.st_ino, "offset": offset}, f)
        os.replace(tmp, STATE)
    except Exception:
        pass


_whois_cache = {}


def whois(ip):
    if not ip:
        return "", ""
    if ip in _whois_cache:
        return _whois_cache[ip]
    dev, user = "", ""
    try:
        out = subprocess.run(["tailscale", "whois", "--json", ip], capture_output=True, timeout=5, text=True)
        if out.returncode == 0:
            d = json.loads(out.stdout)
            dev = (d.get("Node") or {}).get("ComputedName", "") or ""      # short device name, no tailnet
            user = (d.get("UserProfile") or {}).get("LoginName", "") or ""
    except Exception:
        pass
    _whois_cache[ip] = (dev, user)
    return dev, user


# The audit records who accessed a surface, not every sub-resource. Drop static assets, the
# embedded Grafana's internal asset/query traffic, and the admin app's own background polling, so
# a record is a meaningful navigation (an admin page load, a dashboard view, a guest action).
NOISE_PREFIXES = ("/grafana/public/", "/grafana/api/", "/grafana/apis/", "/grafana/avatar/",
                  "/assets/", "/oauth2/")
NOISE_EXACT = {"/api/verdict", "/api/recent-access", "/api/health-dot", "/api/status",
               "/health", "/favicon.ico", "/favicon-planet.png", "/favicon.svg", "/robots.txt"}
NOISE_EXT = re.compile(r"\.(js|mjs|css|svg|woff2?|ttf|png|jpe?g|ico|gif|map|webp|json)(\?|$)", re.I)


def is_noise(path):
    p = path.split("?", 1)[0]
    if any(p.startswith(x) for x in NOISE_PREFIXES):
        return True
    if p in NOISE_EXACT:
        return True
    return bool(NOISE_EXT.search(path))


def header(req, name):
    hdrs = req.get("headers") or {}
    for k, v in hdrs.items():
        if k.lower() == name.lower() and v:
            return v[0] if isinstance(v, list) else v
    return ""


def process():
    if not os.path.exists(CADDY_LOG):
        return
    offset = read_offset()
    records = []
    with open(CADDY_LOG, "r", errors="replace") as f:
        f.seek(offset)
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            req = e.get("request") or {}
            path = req.get("uri", "")
            if is_noise(path):
                continue
            vhost = req.get("host", "")
            ip = req.get("client_ip") or req.get("remote_ip") or ""
            if vhost == GUEST_VHOST:
                dev, user = "", header(req, "X-Auth-Request-Email")
            else:
                dev, user = whois(ip)
            records.append({
                "ts": round(to_epoch(e.get("ts", time.time())), 3),
                "vhost": vhost,
                "method": req.get("method", ""),
                "path": path,
                "status": e.get("status", 0),
                "device": dev,
                "user": user,
            })
        offset = f.tell()
    if records:
        with open(STORE, "a") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")
        os.chmod(STORE, 0o644)  # api (non-root) reads it read-only; only this processor writes it
    write_offset(offset)
    trim()


def trim():
    if not os.path.exists(STORE):
        return
    cutoff = time.time() - RETAIN_S
    try:
        with open(STORE) as f:
            lines = f.readlines()
        kept = [ln for ln in lines if _ts_of(ln) >= cutoff]
        if len(kept) != len(lines):
            tmp = STORE + ".tmp"
            with open(tmp, "w") as f:
                f.writelines(kept)
            os.chmod(tmp, 0o644)
            os.replace(tmp, STORE)
    except Exception:
        pass


def _ts_of(line):
    try:
        return json.loads(line).get("ts", 0)
    except Exception:
        return time.time()  # unparseable: keep it


if __name__ == "__main__":
    process()
