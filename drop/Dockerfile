# Drop server: stdlib-only Python, no dependencies to install. Base image floats to
# latest like the other bases (node:24-alpine, nginx:alpine); see infra/CLAUDE.md.
FROM python:3.13-alpine

RUN adduser -D -H drop
# /state seeds the opened-history named volume with drop-writable ownership (rootfs is
# read_only at runtime; this volume is the one writable path).
RUN mkdir /state && chown drop /state
WORKDIR /srv
COPY server.py .
COPY viewerlib/ viewerlib/

USER drop
ENV DROP_ROOT=/data
EXPOSE 8484
CMD ["python3", "server.py"]
