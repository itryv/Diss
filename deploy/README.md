# Diss production deploy (single VPS)

> **REVIEW BEFORE FIRST USE.** This stack was written against the repo's
> package.json scripts and `docs/api-contract.md` but has not been executed on
> a real VPS. Walk through every step below, check the domains/ports against
> your host, and do a test call before pointing real users at it.

Target: one VPS that **already runs Caddy** in Docker, attached to an external
docker network named `web`, owning ports 80/443.

Services (see `docker-compose.yml`):

| Service | What | Exposure |
| --- | --- | --- |
| `diss-server` | Fastify API (built from `../server` via `Dockerfile.server`) | `web` network only; Caddy routes `/api/*` |
| `diss-app` | Vite build served by nginx (`Dockerfile.app` + `nginx.conf`) | `web` network only |
| `livekit` | LiveKit SFU (`livekit.yaml`) | 7881/tcp, 7882/udp, 3478/udp, 5349/tcp on the host; 7880 proxied by Caddy |
| `redis` | LiveKit/egress message bus | internal only |
| `egress` | LiveKit recording worker | internal only; writes MP4s to the shared `./data/server/recordings` volume |

Persistent data lives in `deploy/data/server/` on the host (SQLite DB at
`data/server/diss.db`, recordings under `data/server/recordings/`). Back this
directory up.

## 1. DNS

Create A (and AAAA if you have IPv6) records pointing at the VPS:

- `meet.example.com` — the app + API (your `APP_DOMAIN`)
- `livekit.example.com` — LiveKit websocket (your `LIVEKIT_DOMAIN`)
- `turn.example.com` — TURN (your `TURN_DOMAIN`; plain A record, no proxying/CDN)

Do **not** put the TURN or LiveKit domains behind a CDN/proxy layer
(e.g. Cloudflare orange cloud) — WebRTC needs to reach the host directly.

## 2. Environment

```bash
cd deploy
cp .env.example .env
```

Generate the secrets:

```bash
# session cookie signing secret
openssl rand -hex 32                      # -> SESSION_SECRET

# LiveKit API credentials (shared by server, livekit, egress)
echo "LK$(openssl rand -hex 8)"           # -> LIVEKIT_API_KEY
openssl rand -base64 32                   # -> LIVEKIT_API_SECRET
```

Set the three domains in `.env`, and edit `turn.domain` in `livekit.yaml` to
match `TURN_DOMAIN`. Decide how TURN TLS is terminated (next section).

## 3. TURN TLS

Port 5349 is TURN over TLS — raw TCP, not HTTP — so the plain Caddyfile can't
proxy it. Two options (see the comments in `livekit.yaml`):

- **a) Proxy-terminated** (`external_tls: true`, the default here): run a TLS
  terminator on 5349 for `turn.example.com`, e.g. Caddy built with the
  `layer4` module (`xcaddy build --with github.com/mholt/caddy-l4`).
- **b) LiveKit-terminated**: set `external_tls: false`, obtain a certificate
  for the TURN domain (e.g. `certbot certonly --standalone -d turn.example.com`),
  mount it into the livekit container, and uncomment `cert_file`/`key_file`.

If neither is set up yet the stack still works for most users — TURN/UDP on
3478 and direct WebRTC on 7881/7882 don't need TLS — but clients on networks
that only allow 443/5349-style TLS egress will fail to connect media.

## 4. Firewall

With ufw (Caddy already has 80/443):

```bash
ufw allow 7881/tcp    # WebRTC over TCP
ufw allow 7882/udp    # WebRTC UDP mux
ufw allow 3478/udp    # TURN/UDP
ufw allow 5349/tcp    # TURN/TLS
```

## 5. Caddy

Append `caddy-snippet.txt` (with your real domains) to the Caddyfile and
reload Caddy:

```bash
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

## 6. Build and start

```bash
cd deploy
docker network inspect web >/dev/null   # sanity check: the network exists
docker compose up -d --build
docker compose ps
```

Smoke checks:

```bash
curl -s https://meet.example.com/api/auth/me        # expect a 401 JSON body
curl -sI https://meet.example.com | head -1          # 200, the SPA
curl -s https://livekit.example.com                  # LiveKit responds ("OK")
```

Then open `https://meet.example.com`, register, start an instant meeting, and
join from a second browser/phone on mobile data (that path exercises TURN).

## Upgrades

```bash
cd deploy && git pull && docker compose up -d --build
```

The SQLite DB and recordings survive because they live in `./data/server`.

## MONITORING

- **Caddy access logs** — the `log { output file … }` block in
  `caddy-snippet.txt` writes rotated JSON access logs for the app domain to
  `/var/log/caddy/diss-access.log` inside the Caddy container (mount a host
  volume there to keep them). Tail with:

  ```bash
  docker exec <caddy-container> tail -f /var/log/caddy/diss-access.log
  ```

- **Service logs**:

  ```bash
  cd deploy
  docker compose logs -f diss-server     # API logs (Fastify)
  docker compose logs -f livekit egress  # media + recording
  docker compose logs --since 1h         # everything, last hour
  ```

- **Resource usage**:

  ```bash
  docker stats                           # live CPU/mem/net per container
  ```

- **Optional: netdata** (full host + container dashboard on :19999, bind it
  to localhost and reach it over SSH tunnel):

  ```bash
  docker run -d --name=netdata --pid=host --network=host \
    -v netdataconfig:/etc/netdata -v netdatalib:/var/lib/netdata \
    -v netdatacache:/var/cache/netdata -v /:/host/root:ro,rslave \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    --restart unless-stopped --cap-add SYS_PTRACE --cap-add SYS_ADMIN \
    --security-opt apparmor=unconfined netdata/netdata
  ```

- **Disk**: recordings accumulate in `deploy/data/server/recordings` — watch
  `du -sh deploy/data/server` and prune via the app's recordings API
  (`DELETE /api/recordings/:id`) or a cron job.
