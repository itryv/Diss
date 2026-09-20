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

Set the three domains in `.env`. The LiveKit config (including `turn.domain`)
is generated from these in `docker-compose.yml` — there is no separate file to
edit.

## 3. TURN TLS (optional, off by default)

The stack ships with TURN/UDP on 3478 and ICE/TCP on 7881. That covers home
wifi, mobile data, and most office networks. It does **not** cover networks
that block UDP *and* all non-443 TCP; those clients need TURN over TLS on 5349.

5349 is raw TLS, not HTTP, so a plain Caddyfile cannot proxy it. To enable it:

- **a) Proxy-terminated**: run a TLS terminator on 5349 for your TURN domain —
  e.g. Caddy built with the layer4 module
  (`xcaddy build --with github.com/mholt/caddy-l4`) — then add
  `tls_port: 5349` and `external_tls: true` to the `turn:` block in
  `docker-compose.yml`, and publish `"5349:5349"`.
- **b) LiveKit-terminated**: obtain a cert for the TURN domain, mount it into
  the livekit container, and add `tls_port: 5349` plus `cert_file`/`key_file`
  (leave `external_tls` unset).

Either way, add `ufw allow 5349/tcp`.

## 4. Firewall

With ufw (Caddy already has 80/443):

```bash
ufw allow 7881/tcp    # WebRTC over TCP
ufw allow 7882/udp    # WebRTC UDP mux
ufw allow 3478/udp    # TURN/UDP
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

## Desktop releases

Native installers are intentionally kept out of Git. The app container mounts
`deploy/downloads/` read-only and serves versioned files at `/downloads/`.

Build and publish the current macOS release from a Mac:

```bash
cd desktop
npm ci
npm run dist:mac
mkdir -p ../deploy/downloads
cp dist/Diss-1.0.0.dmg ../deploy/downloads/
cp dist/Diss-1.0.0-arm64.dmg ../deploy/downloads/
rsync -a ../deploy/downloads/ <host>:<repo>/deploy/downloads/
```

`downloads/` is a bind mount, so the new files are served the moment rsync
finishes — no `docker compose` step, and no container restart.

`-a` without `-z`: a dmg is already compressed, so `-z` only burns CPU.

That rsync needs `<repo>/deploy/downloads/` to be writable by the user you SSH
in as. If it is owned by root you get `mkstemp … Permission denied`; fix the
directory once rather than reaching for `sudo` on every release:

```bash
sudo chown "$USER:$USER" <repo>/deploy/downloads
```

Verify what is actually being served, rather than trusting the upload:

```bash
curl -sI https://<APP_DOMAIN>/downloads/Diss-1.0.0.dmg | grep -i content-length
```

The current preview is unsigned. Before presenting it as a stable release,
configure a Developer ID Application certificate and Apple notarization for
electron-builder, rebuild, and replace both files under the same versioned names.

Because both files keep the same versioned names across rebuilds, size or
checksum is the only way to tell a stale installer from a fresh one. Compare
`shasum -a 256` on the Mac against `sha256sum` on the host after publishing.

## Upgrades

This assumes `<repo>` on the host is a Git checkout of this repository:

```bash
cd <repo> && git pull && cd deploy && docker compose up -d --build
```

The SQLite DB and recordings survive because they live in `./data/server`.
`deploy/.env`, `deploy/data/` and `deploy/downloads/` are all ignored, so a
pull never touches them.

`--build` rebuilds `diss-app` and `diss-server` from the pulled source. Name a
service to rebuild just one, e.g. `docker compose up -d --build diss-app` after
a frontend-only change.

### If the host was deployed by rsync instead of Git

An `rsync`-ed tree has no `.git`, so `git pull` fails with *not a git
repository* and the host silently drifts from `main` — which is how a stale
frontend bundle survives a "deploy". Convert it once, in place:

```bash
cd <repo> && git init -b main && git remote add origin <REPO_URL> && git fetch origin main && git reset origin/main
```

`git reset` without `--hard` moves `HEAD` and the index only, leaving every
file on disk untouched, so `git status` then shows exactly how far the host had
drifted. Review that list, then take the committed version of whatever should
not differ:

```bash
cd <repo> && git checkout -f -- .
```

Ignored files — `.env`, `data/`, `downloads/` — survive both commands, because
neither `reset` nor `checkout` touches files Git is not tracking.

### Verifying a frontend deploy

`docker compose up -d --build` reports success even when the running container
still serves the previous bundle, so check the hash actually being served:

```bash
curl -s https://<APP_DOMAIN>/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js'
```

Vite hashes the filename by content, so that string changing is what proves a
frontend deploy landed. It should match `dist/assets/index-*.js` from the build
output.

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
