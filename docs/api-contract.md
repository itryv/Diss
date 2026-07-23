# Diss API Contract — v1

Backend base URL: `/api` (Vite dev proxies `/api` → `http://localhost:8787`; in production Caddy routes it).
All request/response bodies are JSON. Auth is a `diss_session` httpOnly cookie set by the backend.

## Auth

- `POST /api/auth/register` `{name, email, password}` → `201 {user: {id, name, email}}` + session cookie. `409` if email taken.
- `POST /api/auth/login` `{email, password}` → `200 {user}` + session cookie. `401` on bad credentials.
- `POST /api/auth/logout` → `204`, clears cookie.
- `GET /api/auth/me` → `200 {user}` or `401`.

## Meetings

Meeting object: `{id, code, title, hostUserId, hostName, startsAt | null, createdAt}`.
`code` is a URL-safe join code like `abc-defg-hij` (server-generated, unique).

- `POST /api/meetings` (auth required) `{title?, startsAt?}` → `201 {meeting}`. No `startsAt` = instant meeting.
- `GET /api/meetings` (auth required) → `200 {meetings: [...]}` — meetings hosted by the current user, soonest first.
- `GET /api/meetings/:code` → `200 {meeting}` (public: lets the lobby show title/host before joining). `404` unknown code.
- `DELETE /api/meetings/:id` (auth required, host only) → `204`.

## Joining / LiveKit

- `POST /api/meetings/:code/token` `{displayName}` → `200 {token, url, identity, isHost}`.
  - `url` is the LiveKit websocket URL (from server env `LIVEKIT_URL`).
  - If the request carries a valid session for the meeting's host → token has `roomAdmin: true` grants and `isHost: true`.
  - Guests need no session — `displayName` required, identity is `guest-<random>` (members: `user-<id>`).
  - Room name = meeting code. `roomCreate: true` on host tokens.

## Moderation (host only, session-authenticated)

- `POST /api/meetings/:code/moderate` `{action: "mute" | "remove", identity}` → `204`.
  - `mute` = mute the participant's mic track server-side; `remove` = disconnect them.
  - Backend uses LiveKit `RoomServiceClient` against `LIVEKIT_API_URL` (http endpoint of the same server).

## Server env

```
PORT=8787
DATABASE_PATH=./data/diss.db
SESSION_SECRET=<random>
LIVEKIT_URL=ws://localhost:7880        # what browsers connect to
LIVEKIT_API_URL=http://localhost:7880  # what the backend calls
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
CORS_ORIGIN=http://localhost:5173
```

Dev LiveKit server: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev`
(`--dev` mode uses API key `devkey` / secret `secret`.)

## Data-channel topics

- `chat` `{name, text, ts}` — realtime delivery (persistence is separate, see Messages below). Max 2000 chars.
- `reaction` `{name, emoji, ts}`, `hand` `{name, up, ts}`.
- `caption` `{name, text, interim: boolean, ts}` — live captions from the speaker's browser (Web Speech API). `interim: true` messages replace the speaker's previous interim; `interim: false` finalizes the line.
- Screen share = `localParticipant.setScreenShareEnabled(true)`.

---

# Contract v2 additions

Meeting object gains: `{waitingRoom: boolean, locked: boolean}` (both default false).

## Meeting settings (host only, session-authenticated)

- `PATCH /api/meetings/:id` `{title?, startsAt?, waitingRoom?, locked?}` → `200 {meeting}`. `403` non-host.

## Waiting room + lock (token endpoint behavior change)

`POST /api/meetings/:code/token {displayName}`:
- Meeting `locked` and requester is not host → `423 {error: "meeting is locked"}`.
- Meeting `waitingRoom` on and requester is not host → `202 {waitingId, status: "waiting"}` (NO token). Creates a `waiting_guests` row (id, meetingId, displayName, identity, status waiting|admitted|denied, createdAt, lastSeenAt).
- Otherwise → `200 {token, url, identity, isHost}` as v1.

- `GET /api/meetings/:code/waiting/:waitingId` (guest polls, ~2s interval; refreshes lastSeenAt) →
  `200 {status: "waiting"}` | `200 {status: "denied"}` | `200 {status: "admitted", token, url, identity, isHost: false}`. Entries not polled for 60s may be pruned. `404` unknown id.
- `GET /api/meetings/:code/waiting` (host/co-host) → `200 {guests: [{waitingId, displayName, requestedAt}]}` (status waiting only).
- `POST /api/meetings/:code/waiting/:waitingId` (host/co-host) `{action: "admit" | "deny"}` → `204`.

## Co-host (moderation extension)

`POST /api/meetings/:code/moderate` `{action, identity}` — actions now: `"mute" | "remove" | "promote" | "demote"`.
- `promote`/`demote` set participant metadata `{"role":"cohost"}` / `{}` via RoomService `updateParticipant` (host ONLY, and only for `user-*` identities — guests can't be co-hosts).
- Authorization: requester must be the meeting host, OR a member whose LiveKit participant metadata has `role == "cohost"` (server verifies via RoomService `getParticipant(room, "user-<sessionUserId>")`). Co-hosts may `mute`/`remove` (not the host, not themselves) but NOT `promote`/`demote`.
- Frontend derives co-host status of any participant from their `participant.metadata` (JSON, `role` field).
- Waiting-room admit/deny follows the same host-or-cohost rule.

## Persistent chat

Realtime delivery stays on the `chat` data topic. Additionally the SENDER persists each message:
- `POST /api/meetings/:code/messages` `{text, displayName}` → `201 {message: {id, meetingId, identity, displayName, text, ts}}`. Identity from session (`user-<id>`) or `guest` if no session. Max 2000 chars (schema-enforced). No session required.
- `GET /api/meetings/:code/messages` → `200 {messages: [...]}` last 200, oldest first. Clients load this on join to show history.

## Recording (LiveKit Egress)

Server env additions: `EGRESS_ENABLED=false`, `RECORDINGS_DIR=./data/recordings` (shared volume with the egress container, which sees it as `/out`).
- `POST /api/meetings/:code/recording` (host/co-host) `{action: "start" | "stop"}` →
  start: `201 {recording: {id, meetingCode, startedAt}}` — EgressClient `startRoomCompositeEgress(room, {file: {filepath: "/out/<code>-<startedAt>.mp4"}})`; store row (id, meetingId, egressId, fileName, startedAt, endedAt NULL).
  stop: `200 {recording}` — `stopEgress`, set endedAt.
  `503 {error}` when `EGRESS_ENABLED` is false or egress unreachable; `409` start when already recording / stop when not.
- `GET /api/recordings` (auth) → `200 {recordings: [{id, meetingCode, title, startedAt, endedAt, sizeBytes | null}]}` for meetings the user hosts (sizeBytes from stat on the file; null if missing).
- `GET /api/recordings/:id/file` (auth, host only) → streams the MP4 (Range supported via send/stream).
- `DELETE /api/recordings/:id` (auth, host only) → `204`, deletes row + file.

## Rate limiting (@fastify/rate-limit)

register/login: 10/min/IP. token + waiting endpoints: 60/min/IP. messages POST: 60/min/IP. Global default: 300/min/IP. `429 {error}`.

## Dev stack for egress testing

`dev/docker-compose.yml`: livekit (dev keys, `--bind 0.0.0.0 --node-ip 127.0.0.1`), redis, livekit/egress (dev keys, redis, `/out` volume → `../server/data/recordings`). Egress requires livekit + redis config via config.yaml mounted volumes.
