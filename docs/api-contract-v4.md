# Diss API contract — v4 (chat identity, DMs, host permissions, breakout rooms)

Extends `docs/api-contract.md`. Same conventions: JSON bodies, `{error}` on failure.

## 0. Chat identity (`chatToken`) — why this exists

v2 let anyone `GET /api/meetings/:code/messages` and `POST` as any display name.
That was survivable when every message was public. Private messages are not:
without proof of identity, any client could fetch someone else's DMs by asking
for them. So the token endpoint now also mints a **chatToken**.

- `POST /api/meetings/:code/token` response gains `chatToken: string` —
  `HMAC-SHA256(SESSION_SECRET, "<meetingId>.<identity>.<displayName>")`, base64url,
  prefixed with the payload: `<b64url(meetingId.identity.displayName)>.<sig>`.
- The waiting-room admit response (`GET /:code/waiting/:waitingId` → admitted)
  returns one too.
- The server verifies it with a **timing-safe** compare and derives the caller's
  identity from it. A caller may never read or write messages as anyone else.

## 1. Chat: mentions + private messages

`messages` table gains `to_identity TEXT NULL` (NULL = everyone) and
`mentions TEXT NOT NULL DEFAULT '[]'` (JSON array of identities).

- `POST /api/meetings/:code/messages` `{chatToken, text, toIdentity?, mentions?}` → `201 {message}`
  - identity/displayName come from the chatToken, NOT the body (ignore any sent).
  - `toIdentity` present = private message to that identity.
  - `mentions` = array of identities; `"*"` means @all. Max 50. Text still capped at 2000.
- `GET /api/meetings/:code/messages?chatToken=…` → `200 {messages}` — last 200 that
  the caller is allowed to see: every public message, plus DMs they sent or received.
  Without a valid chatToken → `401`.

Message JSON: `{id, meetingId, identity, displayName, text, ts, toIdentity, mentions}`.

Realtime delivery stays on the LiveKit `chat` data topic; DMs use
`publishData(..., { destinationIdentities: [target] })` so they never touch other
clients. Payload gains `to?: string` and `mentions?: string[]`.

## 2. Host controls (permissions)

`meetings` gains `allow_share`, `allow_chat`, `allow_unmute` INTEGER NOT NULL
DEFAULT 1 — the room-wide defaults applied to non-host participants.

- `PATCH /api/meetings/:id` additionally accepts `{allowShare?, allowChat?, allowUnmute?}`.
  Meeting JSON gains `allowShare`, `allowChat`, `allowUnmute`.
- **Enforced at token mint**: a non-host token gets
  `canPublishSources: [CAMERA, MICROPHONE]` when `allowShare` is false (screen share
  simply cannot be published), and `canPublishData: false` when `allowChat` is false.
  This is the point of the feature — a UI-only toggle is not a control.
- Changing a setting mid-meeting must apply to people already in the room: the
  PATCH handler calls RoomService `updateParticipant` for every non-host
  participant to update their permissions live.
- Per-person override: `POST /api/meetings/:code/moderate` gains actions
  `"allow-share" | "deny-share"` targeting one identity (host/co-host only).

## 3. Breakout rooms

Tables:
- `breakouts` (id, meeting_id, idx, name, created_at, closed_at NULL)
- `breakout_assignments` (breakout_id, identity, display_name)

LiveKit room name for breakout `idx` of meeting `code`: `<code>__b<idx>`.

- `POST /api/meetings/:code/breakouts` (host/co-host) `{rooms: [{name, identities: string[]}]}`
  → `201 {breakouts}`. Replaces any open set. Creating them does not move anyone.
- `GET /api/meetings/:code/breakouts` → `200 {breakouts: [{id, idx, name, participants: [{identity, displayName}]}], open: boolean}`
- `POST /api/meetings/:code/breakouts/token` `{chatToken}` → `200 {token, url, room, breakoutName}`
  for the caller's assigned breakout, or `404` if they aren't assigned / none open.
  Host may pass `{chatToken, idx}` to visit any room.
- `POST /api/meetings/:code/breakouts/close` (host/co-host) → `204`. Marks all closed.

Clients coordinate over the LiveKit data topic `breakout`:
`{action: "open" | "close" | "announce", text?, ts}` broadcast in the MAIN room by
the host. On `open` a client calls the token endpoint, disconnects, and joins its
breakout; on `close` it rejoins the main room. Breakout membership is
server-authoritative — a client cannot mint a token for a room it isn't in.

## 4. Rate limits

breakouts + messages endpoints: 60/min/IP, consistent with v2.
