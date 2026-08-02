#!/usr/bin/env bash
#
# Report whether the digest-pinned third-party images in infra/docker-compose.yml are behind
# the latest release. Digest pins keep deploys reproducible + supply-chain-safe, but they also
# freeze the version, so run this periodically (`make check-updates`). When something is STALE,
# re-pin its `image:` line to the new `tag@sha256:…` and `make deploy`. See DEVELOPMENT.md.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
stale=0
pin() { grep -oE "image: $1[^[:space:]]*" infra/docker-compose.yml | head -1 | sed 's/image: //'; }

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

echo
echo "Base images (node:24-alpine, nginx:alpine) float to latest on 'make deploy'; no pin to bump."
if [ "$stale" -eq 0 ]; then echo "All pinned images current."; else echo "Re-pin the STALE line(s) above, then 'make deploy'."; fi
exit 0
