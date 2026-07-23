# Diss dev stack

Docker Compose stack for local development with recording (LiveKit Egress)
support: `livekit-server`, `redis`, and `livekit/egress`.

## What it runs

| Service | Image | Ports (host) | Notes |
| --- | --- | --- | --- |
| livekit | `livekit/livekit-server` | 7880 (ws/http), 7881 (tcp rtc), 7882/udp | Dev keys `devkey`/`secret`, config in `livekit.yaml` (Redis enabled so egress works) |
| redis | `redis:7-alpine` | 6379 | Job bus between livekit and egress |
| egress | `livekit/egress` | — | Config in `egress.yaml`; writes recordings to `/out`, which is `../server/data/recordings` on the host |

## Run

```bash
cd dev
docker compose up
```

Then start the backend with egress enabled (from `server/`):

```bash
EGRESS_ENABLED=true npm run dev
```

The backend's defaults already match this stack (`LIVEKIT_URL=ws://localhost:7880`,
`LIVEKIT_API_URL=http://localhost:7880`, key `devkey`, secret `secret`,
`RECORDINGS_DIR=./data/recordings`).

## Recording flow

1. Join a meeting so the LiveKit room exists.
2. `POST /api/meetings/:code/recording {"action":"start"}` as the host — the
   egress container joins the room headlessly and writes
   `/out/<code>-<startedAt>.mp4`, i.e. `server/data/recordings/…` on the host.
3. `{"action":"stop"}` finalizes the file; `GET /api/recordings` then shows its
   size, and `GET /api/recordings/:id/file` streams it (Range supported).

## Notes

- The egress container needs `SYS_ADMIN` (declared in the compose file) for its
  headless Chrome.
- If you only need calls (no recording), you can still use the plain
  single-container dev server instead:
  `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev`
- Tear down with `docker compose down`.

## Note: node-ip is your LAN IP

`docker-compose.yml` pins livekit's `--node-ip` to your Mac's LAN IP (required so
BOTH host browsers and the egress container can complete ICE; `127.0.0.1` breaks
egress, container IPs break host browsers). If your LAN IP changes, update it:

    sed -i '' "s/--node-ip [0-9.]*/--node-ip $(ipconfig getifaddr en0)/" docker-compose.yml
    docker compose up -d --force-recreate livekit egress
