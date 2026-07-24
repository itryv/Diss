# Diss server

TypeScript Fastify backend for the Diss web meeting app. Implements the full
[API contract](../docs/api-contract.md) (v1 + v2), the
[v4 contract](../docs/api-contract-v4.md) and the
[admin contract](../docs/api-contract-admin.md): cookie-session auth, meetings CRUD +
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

## Admin dashboard API

### Who is an admin — `ADMIN_EMAILS`

`ADMIN_EMAILS` is a comma-separated list of email addresses. It is compared
case-insensitively with surrounding whitespace trimmed, and empty entries are
ignored — so `ADMIN_EMAILS=" Remi@Example.com , ops@example.com "` works.
**Empty (the default) means nobody is an admin.**

> **This env var is the ONLY way to grant admin.** Admin status is derived from
> it on every request; there is no "make admin" endpoint, no column and no way
> to set it through the API. An admin therefore cannot create another admin, so
> a stolen admin session cannot widen its own blast radius. Changing the admin
> list is a config change plus a restart.

`GET /api/auth/me` reports `isAdmin` (both as `me.isAdmin` and `me.user.isAdmin`).
Every `/api/admin/*` route requires a session belonging to an admin and answers
`403 {error}` otherwise — including when there is no session at all, so the
admin surface never advertises itself. Admin routes are rate limited to
**120/min/IP** each.

`users` gains `disabled INTEGER NOT NULL DEFAULT 0`. Disabling a user deletes
their sessions immediately and blocks login with `401`.

### Endpoints

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/admin/overview` | user/meeting/recording/message counts, storage (db, recordings, free disk), LiveKit state, server uptime |
| `GET` | `/api/admin/users?q=&limit=&offset=` | `{users, total}`; `q` matches name or email; limit 50 default, 200 max |
| `PATCH` | `/api/admin/users/:id` `{disabled}` | `200 {user}`; deletes sessions when disabling |
| `DELETE` | `/api/admin/users/:id` | `204`; full cascade (below) |
| `GET` | `/api/admin/meetings?q=&live=&limit=&offset=` | `{meetings, total}` with `hostName/hostEmail/live/participantCount/messageCount/recordingCount` |
| `DELETE` | `/api/admin/meetings/:id` | `204`; ends the live room first, then cascades |
| `POST` | `/api/admin/meetings/:id/end` | `204`; `409` if not live, `502` if LiveKit is unreachable |
| `GET` | `/api/admin/live` | `{rooms, reachable, error?}`, breakout rooms included and tagged with their meeting |
| `POST` | `/api/admin/live/:room/kick` `{identity}` | `204` |
| `POST` | `/api/admin/live/:room/end` | `204` |
| `GET` | `/api/admin/recordings?limit=&offset=` | `{recordings, total, totalBytes}`; `missing:true` when the file is gone |
| `DELETE` | `/api/admin/recordings/:id` | `204` (row + file) |
| `GET`/`PATCH` | `/api/admin/settings` | `{settings}` |
| `GET` | `/api/admin/audit?limit=&offset=` | `{entries, total}`, newest first |

`GET /api/recordings/:id/file` additionally accepts admins — the host path is
unchanged.

### Deletion is complete

Deleting a user removes their sessions, their meetings, and everything hanging
off those meetings (messages, waiting guests, breakouts + assignments, recording
rows) **and** the recording files on disk. Deleting a meeting does the same for
that meeting. The DB side runs in a single SQLite transaction with explicit
per-table deletes (not relying on the `foreign_keys` pragma); the files are
unlinked *after* the commit, because the filesystem is not transactional — a
failed unlink can leave a stray file but never an orphan row.

### Guard rails

An admin may not disable or delete **another admin or themselves** — `400`. The
admin test is on the email and case-insensitive, so a differently-cased address
cannot slip past the check. Rejected attempts write no audit row.

### Settings

`settings` is a `key`/`value` table read through a helper with defaults, so a
missing row is never an error. Defaults: `registrationOpen: true`,
`defaultAllowShare/Chat/Unmute: true`, `defaultWaitingRoom: false`.

- `registrationOpen: false` makes `POST /api/auth/register` return
  `403 {error: "registration is closed"}`.
- The `default*` values seed a **newly** created meeting's `waiting_room` and
  `allow_*` columns. Existing meetings are untouched.

### Audit log

Every state-changing admin action writes an `admin_audit` row with the actor's
id and email, the target, and a short JSON `detail` (returned parsed).
Actions: `user.disable`, `user.enable`, `user.delete`, `meeting.delete`,
`meeting.end`, `live.kick`, `live.end`, `recording.delete`, `settings.update`.
`admin_audit` has no foreign key to `users` on purpose: deleting a user must not
erase the record of it. Nothing secret is ever logged.

### LiveKit degradation

Every admin route that touches LiveKit races the call against a 3s timeout
(`LIVEKIT_TIMEOUT_MS`). Read routes degrade to `reachable: false` plus an error
string with the rest of the payload intact; action routes answer `502 {error}`.
An unreachable media server never produces a 500 and never hangs a request.

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
npm test             # 141 smoke checks
npm run test:migration   # additive + idempotent migration check
```

141 checks. Boots the server on a random port with a temp SQLite DB and exercises
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

The admin section runs against a **second** server instance (its own DB,
recordings dir and rate-limit counters, `ADMIN_EMAILS` set) because it changes
global settings and deletes users. It covers: `403` on all 15 admin routes for
a non-admin and for no session, `200` on every admin GET, the overview and live
payloads degrading to `reachable:false` when LiveKit is down (and `502` rather
than a hang for kick/end), users search + pagination + `total`, the
self/other-admin guard rails including a case-differing address, disabling
killing sessions and blocking login, `registrationOpen` closing and reopening
registration, `default*` settings seeding a new meeting, full cascade deletes
for a meeting and for a user (every dependent table asserted empty and the
recording file asserted gone from disk), admin streaming of a recording it does
not host next to the unchanged host path, and audit rows with the right action
names, actor id/email and no secrets.

`npm run test:migration` reconstructs a **v1-era** and a **v4-era** database
with real rows, boots the server against each twice, and asserts every
pre-existing row survives byte for byte, that `users.disabled` / `settings` /
`admin_audit` appear with safe defaults, and that the second boot is a complete
no-op.

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
| `RATE_LIMIT_WINDOW_MS` | `60000` — rate-limit window (register/login 10, token/waiting/messages/breakouts 60, `/api/admin/*` 120, global 300 per window per IP) |
| `ADMIN_EMAILS` | *(empty — nobody is an admin)* — comma-separated, case-insensitive, trimmed. **The only way to grant admin access.** See above. |
| `LIVEKIT_TIMEOUT_MS` | `3000` — ceiling on any LiveKit call made by an admin route |

## Layout

- `src/index.ts` — env load + listen
- `src/app.ts` — Fastify instance, all routes, JSON-schema validation
- `src/db.ts` — SQLite open + schema + v2/v4/admin migrations (guarded `ALTER TABLE`s)
- `src/chatToken.ts` — chatToken minting + timing-safe verification
- `src/auth.ts` — scrypt hashing, session helpers, cookie helpers
- `src/meetings.ts` — meeting queries + unique `abc-defg-hij` code generation
- `src/admin.ts` — `ADMIN_EMAILS` parsing, settings helper, audit writer, cascade deletes
- `test/smoke.ts` — end-to-end smoke test
- `test/migration.ts` — pre-admin database boot-twice migration check
