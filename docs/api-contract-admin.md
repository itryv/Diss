# Diss API contract — admin dashboard

Extends `docs/api-contract.md` (v1/v2) and `api-contract-v4.md`. Same conventions.

## 0. Who is an admin

- New env `ADMIN_EMAILS` — comma-separated, case-insensitive, trimmed. Empty = no admins.
- `users` gains `disabled INTEGER NOT NULL DEFAULT 0` (additive, PRAGMA-guarded).
- Admin status is derived from `ADMIN_EMAILS` at request time. It is deliberately
  **not** grantable through the API: an admin cannot create another admin, so a
  stolen admin session cannot widen itself. Changing admins is a server config
  change + restart.
- `GET /api/auth/me` response gains `isAdmin: boolean`.
- Every `/api/admin/*` route requires a valid session whose user is an admin,
  else `403 {error}`. Rate limit 120/min/IP.
- A disabled user cannot log in (`401`) and their existing sessions are deleted
  when they are disabled.

## 1. Overview

`GET /api/admin/overview` → `200`
```
{
  users: {total, disabled, admins},
  meetings: {total, scheduled, live},          // live = has an active LiveKit room
  recordings: {count, bytes},
  messages: {total},
  storage: {dbBytes, recordingsBytes, diskFreeBytes},
  livekit: {reachable: boolean, rooms: number, participants: number, error?: string},
  server: {uptimeS, nodeVersion, startedAt}
}
```
LiveKit being unreachable must degrade to `reachable:false` with the rest intact.

## 2. Users

- `GET /api/admin/users?q=&limit=&offset=` → `200 {users: [{id, name, email, isAdmin, disabled, createdAt, meetingCount, lastSeenAt}], total}`
  `q` matches name or email (case-insensitive substring). Default limit 50, max 200.
- `PATCH /api/admin/users/:id` `{disabled}` → `200 {user}`. Disabling deletes that
  user's sessions. `400` if the target is an admin or yourself.
- `DELETE /api/admin/users/:id` → `204`. Deletes the user, their sessions, their
  meetings and everything hanging off those meetings (messages, waiting guests,
  breakouts, recording rows) and the recording FILES on disk. `400` if the target
  is an admin or yourself.

## 3. Meetings

- `GET /api/admin/meetings?q=&live=&limit=&offset=` → `200 {meetings: [{...meeting, hostName, hostEmail, live, participantCount, messageCount, recordingCount}], total}`
  `q` matches code or title. `live=1` filters to meetings with an active room.
- `DELETE /api/admin/meetings/:id` → `204`. Ends the LiveKit room if live, then
  deletes the meeting and its dependents (including recording files).
- `POST /api/admin/meetings/:id/end` → `204`. Ends the live room (LiveKit
  `deleteRoom`) without deleting the meeting. `409` if not live.

## 4. Live rooms

- `GET /api/admin/live` → `200 {rooms: [{name, meetingCode, meetingTitle, hostName, numParticipants, startedAt, participants: [{identity, name, joinedAt, isPublishing, isHost}]}], reachable, error?}`
  Includes breakout rooms, tagged with the meeting they belong to.
- `POST /api/admin/live/:room/kick` `{identity}` → `204`.
- `POST /api/admin/live/:room/end` → `204`.

## 5. Recordings

- `GET /api/admin/recordings?limit=&offset=` → `200 {recordings: [{id, meetingCode, meetingTitle, hostName, startedAt, endedAt, sizeBytes, missing}], total, totalBytes}`
  `missing:true` when the DB row has no file on disk.
- `DELETE /api/admin/recordings/:id` → `204` (row + file).
- Admins may stream any recording: the existing `GET /api/recordings/:id/file`
  additionally allows admins (today it is host-only).

## 6. Settings

`settings` table: `key TEXT PRIMARY KEY, value TEXT NOT NULL`. Read through a
helper with defaults, so a missing row is never an error.

- `GET /api/admin/settings` → `200 {settings: {registrationOpen, defaultAllowShare, defaultAllowChat, defaultAllowUnmute, defaultWaitingRoom}}`
- `PATCH /api/admin/settings` `{...any subset}` → `200 {settings}`

Behaviour:
- `registrationOpen:false` ⇒ `POST /api/auth/register` returns `403 {error: "registration is closed"}`.
  **This is the point of the setting** — the live site is currently open to anyone
  who finds the URL.
- The `default*` values seed a NEWLY created meeting's `allow_*` / `waiting_room`
  columns. Existing meetings are untouched.

## 7. Audit log

Every state-changing admin action writes a row.

`admin_audit` (id, actor_user_id, actor_email, action, target_type, target_id, detail TEXT, created_at).

- `GET /api/admin/audit?limit=&offset=` → `200 {entries, total}` newest first.
- Actions: `user.disable`, `user.enable`, `user.delete`, `meeting.delete`,
  `meeting.end`, `live.kick`, `live.end`, `recording.delete`, `settings.update`.
- `detail` is a short JSON blob (e.g. the changed keys). Never log secrets.

## 8. Frontend

- Admin screen reachable only when `me.isAdmin` — a nav entry that simply does not
  exist for anyone else, plus a guard on the screen itself.
- Sections: Overview, Live, Users, Meetings, Recordings, Settings, Audit.
- Destructive actions (delete user/meeting/recording, end room, kick) require an
  explicit typed or two-step confirmation naming the target — an admin dashboard
  is exactly where a misclick is most expensive.
