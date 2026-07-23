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

## v1 scope notes

- Waiting room, recording, and connection-stats UI stay simulated/disabled in v1 (LiveKit Egress + waiting-room flow are v2).
- Chat and reactions ride LiveKit data messages (`topic: "chat"` / `"reaction"`), no backend persistence in v1.
- Screen share = `localParticipant.setScreenShareEnabled(true)`.
