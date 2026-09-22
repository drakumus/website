#!/usr/bin/env bash
#
# Report whether the digest-pinned third-party images in infra/docker-compose.yml are behind
# the latest release. Digest pins keep deploys reproducible + supply-chain-safe, but they also
# freeze the version, so run this periodically (`make check-updates`). When something is STALE,
# re-pin its `image:` line to the new `tag@sha256:…` and `make deploy`. See DEVELOPMENT.md.
set -uo pipefail
# Locate the repo from this script's own path: the images collector invokes this from
# outside the repo (cron runs from $HOME), where git rev-parse would fail and leave
# every pin() grep reading a missing file (reported as STALE with an empty version).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
stale=0
pin() { grep -oE "image: $1[^[:space:]]*" infra/docker-compose.yml | head -1 | sed 's/image: //'; }

# Newest semver-ish tag for a Docker Hub repo, filtered by an exact-match pattern.
hub_latest() {
  curl -sS --max-time 20 "https://hub.docker.com/v2/repositories/$1/tags?page_size=100" 2>/dev/null \
    | python3 -c 'import json,sys,re;d=json.load(sys.stdin);p=sys.argv[1];s=sorted({t["name"] for t in d.get("results",[]) if re.fullmatch(p,t["name"])},key=lambda t:tuple(map(int,re.findall(r"\d+",t))),reverse=True);print(s[0] if s else "")' "$2"
}

# For a container running a floating :latest tag: compare the running image's digest to the
# digest Docker Hub currently serves for :latest. No pull; skips quietly if the container
# does not exist on this host.
latest_drift() {
  local c="$1" repo="$2" img local_digest remote
  docker inspect "$c" >/dev/null 2>&1 || return 0
  img=$(docker inspect "$c" --format '{{.Image}}')
  local_digest=$(docker image inspect "$img" --format '{{join .RepoDigests "\n"}}' 2>/dev/null | grep -oE 'sha256:[0-9a-f]+' | head -1)
  remote=$(curl -sS --max-time 20 "https://hub.docker.com/v2/repositories/$repo/tags/latest" 2>/dev/null \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("digest") or (d.get("images") or [{}])[0].get("digest") or "")')
  if [ -n "$remote" ] && [ -n "$local_digest" ] && [ "$remote" != "$local_digest" ]; then
    echo "  STALE  $repo  ->  newer :latest published; pull and recreate $c"; stale=1
  else
    echo "  ok     $repo (:latest, running current)"
  fi
}

echo "Pinned third-party images (infra/docker-compose.yml):"

# caddy:2-alpine, a rolling tag (patched in place): compare the pinned digest to the current one.
ref=$(pin 'caddy:2-alpine'); name="${ref%@*}"
docker pull -q "$name" >/dev/null 2>&1
cur=$(docker inspect "$name" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/.*@//')
if [ -n "$cur" ] && [ "$cur" != "${ref#*@}" ]; then echo "  STALE  $name  ->  re-pin @$cur"; stale=1; else echo "  ok     $name"; fi

# coredns, version-pinned: check Docker Hub for a newer release.
ref=$(pin 'coredns/coredns'); nt="${ref%@*}"; curv="${nt##*:}"
latest=$(curl -sS --max-time 20 'https://hub.docker.com/v2/repositories/coredns/coredns/tags?page_size=100' 2>/dev/null \
  | python3 -c 'import json,sys,re;d=json.load(sys.stdin);s=sorted({t["name"] for t in d.get("results",[]) if re.fullmatch(r"\d+\.\d+\.\d+",t["name"])},key=lambda t:tuple(map(int,t.split("."))),reverse=True);print(s[0] if s else "")')
if [ -n "$latest" ] && [ "$curv" != "$latest" ]; then echo "  STALE  coredns/coredns $curv  ->  $latest available"; stale=1; else echo "  ok     coredns/coredns ($curv)"; fi

# oauth2-proxy, version-pinned: check Quay for a newer release.
ref=$(pin 'quay.io/oauth2-proxy/oauth2-proxy'); nt="${ref%@*}"; curv="${nt##*:}"
latest=$(curl -sS --max-time 20 'https://quay.io/api/v1/repository/oauth2-proxy/oauth2-proxy/tag/?onlyActiveTags=true&limit=100' 2>/dev/null \
  | python3 -c 'import json,sys,re;d=json.load(sys.stdin);s=sorted({t["name"] for t in d.get("tags",[]) if re.fullmatch(r"v\d+\.\d+\.\d+",t["name"])},key=lambda t:tuple(map(int,t[1:].split("."))),reverse=True);print(s[0] if s else "")')
if [ -n "$latest" ] && [ "$curv" != "$latest" ]; then echo "  STALE  oauth2-proxy $curv  ->  $latest available"; stale=1; else echo "  ok     oauth2-proxy ($curv)"; fi

# victoria-metrics, version-pinned: check Docker Hub for a newer release.
ref=$(pin 'victoriametrics/victoria-metrics'); nt="${ref%@*}"; curv="${nt##*:}"
latest=$(hub_latest 'victoriametrics/victoria-metrics' 'v\d+\.\d+\.\d+')
if [ -n "$latest" ] && [ "$curv" != "$latest" ]; then echo "  STALE  victoriametrics/victoria-metrics $curv  ->  $latest available"; stale=1; else echo "  ok     victoriametrics/victoria-metrics ($curv)"; fi

# grafana, version-pinned: check Docker Hub for a newer release.
ref=$(pin 'grafana/grafana'); nt="${ref%@*}"; curv="${nt##*:}"
latest=$(hub_latest 'grafana/grafana' '\d+\.\d+\.\d+')
if [ -n "$latest" ] && [ "$curv" != "$latest" ]; then echo "  STALE  grafana/grafana $curv  ->  $latest available"; stale=1; else echo "  ok     grafana/grafana ($curv)"; fi

# node-exporter, version-pinned: check Docker Hub for a newer release.
ref=$(pin 'prom/node-exporter'); nt="${ref%@*}"; curv="${nt##*:}"
latest=$(hub_latest 'prom/node-exporter' 'v\d+\.\d+\.\d+')
if [ -n "$latest" ] && [ "$curv" != "$latest" ]; then echo "  STALE  prom/node-exporter $curv  ->  $latest available"; stale=1; else echo "  ok     prom/node-exporter ($curv)"; fi

# postgres:17-alpine, a rolling tag (patched in place): digest-compare like caddy.
ref=$(pin 'postgres:17-alpine'); name="${ref%@*}"
docker pull -q "$name" >/dev/null 2>&1
cur=$(docker inspect "$name" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/.*@//')
if [ -n "$cur" ] && [ "$cur" != "${ref#*@}" ]; then echo "  STALE  $name  ->  re-pin @$cur"; stale=1; else echo "  ok     $name"; fi

echo
echo "Host services outside this compose (skipped where not present):"

# muse, version-pinned in its own compose project: check GitHub for a newer release.
MUSE_COMPOSE="$HOME/projects/music-bot/docker-compose.yml"
if [ -f "$MUSE_COMPOSE" ]; then
  ref=$(grep -oE 'image: ghcr.io/museofficial/muse[^[:space:]]*' "$MUSE_COMPOSE" | head -1 | sed 's/image: //')
  nt="${ref%@*}"; curv="${nt##*:}"
  latest=$(curl -sS --max-time 20 'https://api.github.com/repos/museofficial/muse/releases/latest' 2>/dev/null \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tag_name","").lstrip("v"))')
  if [ -n "$latest" ] && [ "$curv" != "$latest" ]; then echo "  STALE  museofficial/muse $curv  ->  $latest available"; stale=1; else echo "  ok     museofficial/muse ($curv)"; fi
fi

# Floating :latest services: flag when the registry has a newer :latest than what is running.
latest_drift jellyfin 'jellyfin/jellyfin'
latest_drift hermes 'nousresearch/hermes-agent'

echo
echo "Base images (node:24-alpine, nginx:alpine) float to latest on 'make deploy'; no pin to bump."
if [ "$stale" -eq 0 ]; then echo "All pinned images current."; else echo "Re-pin the STALE line(s) above, then 'make deploy'."; fi
exit 0
