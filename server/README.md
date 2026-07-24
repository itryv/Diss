# Diss server

TypeScript Fastify backend for the Diss web meeting app. Implements the full
[API contract](../docs/api-contract.md) (v1 + v2) and the
[v4 contract](../docs/api-contract-v4.md): cookie-session auth, meetings CRUD +
settings (waiting room / lock), LiveKit token minting with waiting-room and
lock gating, host/co-host moderation (mute/remove/promote/demote/allow-share/
deny-share) via `RoomServiceClient`, persistent chat with signed chat identities,
private messages and mentions, host permission controls enforced in the LiveKit
grant, breakout rooms, recording via LiveKit Egress, and per-route rate limiting.

## v4: chat identity, DMs, host permissions, breakouts

- **`chatToken`** — `HMAC-SHA256(SESSION_SECRET, "<meetingId>.<identity>.<displayName>")`,
  returned as `<b64url(payload)>.<b64url(sig)>` by `POST /api/meetings/:code/token`
  and by the waiting-room admit poll. Verified with `crypto.timingSafeEqual`
  (`src/chatToken.ts`). Every message read/write derives the caller's identity
  and display name from it; `identity`/`displayName` in the request body are
  accepted for compatibility and **ignored**. Without it, reads are `401`.
- **Messages** — `POST` takes `{chatToken, text, toIdentity?, mentions?}`
  (text ≤ 2000, mentions ≤ 50); `GET …/messages?chatToken=…` returns the last 200
  the caller may see: every public message plus DMs they sent or received.
- **Host permissions** — `allowShare` / `allowChat` / `allowUnmute` on the meeting
  (default true), set via `PATCH /api/meetings/:id`. Enforced where it counts, in
  the minted LiveKit grant: a non-host gets `canPublishSources` without
  `screen_share` when `allowShare` is false, without `microphone` when
  `allowUnmute` is false, and `canPublishData: false` when `allowChat` is false.
  The PATCH also pushes the new permissions to everyone already in the room via
  `updateParticipant` and reports the outcome as `{liveUpdate: {applied, error?}}`.
- **Breakout rooms** — `POST/GET /api/meetings/:code/breakouts`,
  `POST …/breakouts/token`, `POST …/breakouts/close`. LiveKit room name is
  `<code>__b<idx>`. Membership is server-authoritative: the token endpoint only
  issues a token for the breakout the caller is assigned to (the host may pass
  `idx` to visit any), and closing marks every room closed so a stale client
  cannot rejoin.

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

98 checks. Boots the server on a random port with a temp SQLite DB and exercises
the whole API with `fetch` — auth, meetings CRUD + PATCH settings, host/guest
tokens (JWT grant checks), the waiting-room flow (202 → poll → admit/deny),
meeting lock (423), moderation authorization incl. promote/demote and
allow-share/deny-share, chatToken minting and tamper rejection (flipped
signature, swapped identity, wrong meeting), persistent messages (2000-char cap,
50-mention cap, history order) and DM visibility (invisible to a third party),
permission enforcement decoded out of the minted JWT
(`canPublishSources`/`canPublishData` for host vs guest), the four breakout
endpoints incl. "not assigned → 404" and "closed → no token", recording
endpoints with egress disabled (503), and the register rate limit (429).
No LiveKit server required — the live `updateParticipant` and moderation calls
are asserted on their degraded error shape.

## Environment

See `.env.example`. A `.env` file in this directory is loaded on boot (existing
`process.env` values win). Defaults match the contract:

| Var | Default |
| --- | --- |
| `PORT` | `8787` |
| `DATABASE_PATH` | `./data/diss.db` (directory auto-created) |
| `SESSION_SECRET` | random per boot (set one for stable deployments — it also signs v4 chatTokens) |
| `LIVEKIT_URL` | `ws://localhost:7880` |
| `LIVEKIT_API_URL` | `http://localhost:7880` |
| `LIVEKIT_API_KEY` | `devkey` |
| `LIVEKIT_API_SECRET` | `secret` |
| `CORS_ORIGIN` | `http://localhost:5173` |
| `EGRESS_ENABLED` | `false` — recording endpoints return 503 until set to `true` |
| `RECORDINGS_DIR` | `./data/recordings` — shared with the egress container's `/out` |
| `RATE_LIMIT_WINDOW_MS` | `60000` — rate-limit window (register/login 10, token/waiting/messages/breakouts 60, global 300 per window per IP) |

## Layout

- `src/index.ts` — env load + listen
- `src/app.ts` — Fastify instance, all routes, JSON-schema validation
- `src/db.ts` — SQLite open + schema + v2/v4 migrations (guarded `ALTER TABLE`s)
- `src/chatToken.ts` — chatToken minting + timing-safe verification
- `src/auth.ts` — scrypt hashing, session helpers, cookie helpers
- `src/meetings.ts` — meeting queries + unique `abc-defg-hij` code generation
- `test/smoke.ts` — end-to-end smoke test
