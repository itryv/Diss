# Diss server

TypeScript Fastify backend for the Diss web meeting app. Implements the full
[API contract](../docs/api-contract.md) including the v2 additions:
cookie-session auth, meetings CRUD + settings (waiting room / lock), LiveKit
token minting with waiting-room and lock gating, host/co-host moderation
(mute/remove/promote/demote) via `RoomServiceClient`, persistent chat
messages, recording via LiveKit Egress, and per-route rate limiting.

## Stack

- Fastify 5 (+ `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit`)
- SQLite via `better-sqlite3` (tables created and migrated on boot —
  `ALTER TABLE` guarded by `PRAGMA table_info` checks)
- `livekit-server-sdk` for join tokens, moderation (`RoomServiceClient`), and
  recording (`EgressClient` room-composite egress to file)
- Passwords: `node:crypto` scrypt with a per-user salt
- Sessions: random 32-byte token in a `diss_session` httpOnly SameSite=Lax cookie, 30-day expiry

## Run

```bash
npm install
cp .env.example .env   # optional — every var has a working dev default
npm run dev            # tsx watch, http://localhost:8787
```

Production:

```bash
npm run build   # tsc -> dist/
npm start       # node dist/index.js
```

Dev LiveKit server (needed for actual calls; the API itself boots without it):

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev
```

For recording you need the full dev stack (LiveKit + Redis + Egress) — see
[`../dev/README.md`](../dev/README.md) — and `EGRESS_ENABLED=true` in the
server env. With `EGRESS_ENABLED=false` (the default) the recording endpoints
respond `503 {error}`.

## Test

```bash
npm test
```

Boots the server on a random port with a temp SQLite DB and exercises the whole
API with `fetch` — auth, meetings CRUD + PATCH settings, host/guest tokens
(JWT grant checks), the waiting-room flow (202 → poll → admit/deny), meeting
lock (423), moderation authorization incl. promote/demote rules, persistent
messages (2000-char cap, history order), recording endpoints with egress
disabled (503), and the register rate limit (429). No LiveKit server required.

## Environment

See `.env.example`. A `.env` file in this directory is loaded on boot (existing
`process.env` values win). Defaults match the contract:

| Var | Default |
| --- | --- |
| `PORT` | `8787` |
| `DATABASE_PATH` | `./data/diss.db` (directory auto-created) |
| `SESSION_SECRET` | random per boot (set one for stable deployments) |
| `LIVEKIT_URL` | `ws://localhost:7880` |
| `LIVEKIT_API_URL` | `http://localhost:7880` |
| `LIVEKIT_API_KEY` | `devkey` |
| `LIVEKIT_API_SECRET` | `secret` |
| `CORS_ORIGIN` | `http://localhost:5173` |
| `EGRESS_ENABLED` | `false` — recording endpoints return 503 until set to `true` |
| `RECORDINGS_DIR` | `./data/recordings` — shared with the egress container's `/out` |
| `RATE_LIMIT_WINDOW_MS` | `60000` — rate-limit window (register/login 10, token/waiting/messages 60, global 300 per window per IP) |

## Layout

- `src/index.ts` — env load + listen
- `src/app.ts` — Fastify instance, all routes, JSON-schema validation
- `src/db.ts` — SQLite open + schema + v2 migration
- `src/auth.ts` — scrypt hashing, session helpers, cookie helpers
- `src/meetings.ts` — meeting queries + unique `abc-defg-hij` code generation
- `test/smoke.ts` — end-to-end smoke test
