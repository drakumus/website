# VPS ingress setup (OVH → home over Tailscale)

The VPS is a dumb L4 passthrough: it forwards `:80`/`:443` to the home server over
Tailscale without decrypting. TLS terminates at home. See `zoci-networking.md`.

> Concrete addresses (VPS IP, home tailnet IP, tailnet name, etc.) are intentionally
> **not** in the repo. Keep them in your local, gitignored `PROJECT_STATUS.md` or your
> own infra notes. Placeholders below: `<VPS_PUBLIC_IP>`, `<VPS_IPV6>`,
> `<HOME_TAILNET_IP>`, `<TAILNET>`.

## Steps (run on the VPS)

### 1. Join Tailscale
```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=vps-zoci
```
Authorize the printed URL into your `<TAILNET>` tailnet, then verify it reaches home:
```sh
tailscale ping <HOME_TAILNET_IP>
```

### 2. Install the nginx passthrough forwarder
```sh
sudo HOME_TS_IP=<HOME_TAILNET_IP> bash setup.sh
```
(Copy `setup.sh` to the VPS first — scp over the tailnet, or paste it.)

### 3. Add DNS records (DigitalOcean panel)
Start with IPv4 only; add IPv6 once verified on the VPS (`curl -6 https://ifconfig.co`).
```
zoci.me       A     <VPS_PUBLIC_IP>     (TTL 300 during bring-up)
js1.zoci.me   A     <VPS_PUBLIC_IP>
# later, once VPS IPv6 works:
zoci.me       AAAA  <VPS_IPV6>
js1.zoci.me   AAAA  <VPS_IPV6>
```

### 4. (Optional, later) firewall hardening
OVH VPSes ship open. To lock down — **allow SSH first so you don't lock yourself out**:
```sh
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow in on tailscale0
sudo ufw enable
```
(Once Tailscale SSH is confirmed working, you can drop public `22`.)

## Bring-up order (important)
Certs (TLS-ALPN-01 at home) only issue when the whole chain is live:
**DNS → VPS (Tailscale + nginx forwarder) → home Caddy.**
Until the home Caddy is running, `https://zoci.me` will fail to connect — expected.
