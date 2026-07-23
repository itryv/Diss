# Diss server

TypeScript Fastify backend for the Diss web meeting app. Implements the full
[API contract](../docs/api-contract.md): cookie-session auth, meetings CRUD,
LiveKit token minting, and host moderation via `RoomServiceClient`.

## Stack

- Fastify 5 (+ `@fastify/cookie`, `@fastify/cors`)
- SQLite via `better-sqlite3` (tables created on boot)
- `livekit-server-sdk` for join tokens and moderation
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

## Test

```bash
npm test
```

Boots the server on a random port with a temp SQLite DB and exercises the whole
API with `fetch` — auth, meetings CRUD, host/guest tokens (JWT grant checks),
and moderation error handling. No LiveKit server required.

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

## Layout

- `src/index.ts` — env load + listen
- `src/app.ts` — Fastify instance, all routes, JSON-schema validation
- `src/db.ts` — SQLite open + schema
- `src/auth.ts` — scrypt hashing, session helpers, cookie helpers
- `src/meetings.ts` — meeting queries + unique `abc-defg-hij` code generation
- `test/smoke.ts` — end-to-end smoke test
