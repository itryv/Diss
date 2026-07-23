/**
 * Smoke test: boots the server on a random port with a temp DB and exercises
 * the whole API contract with fetch. No LiveKit server required — moderation
 * is pointed at an unreachable endpoint and asserted on error shape.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnv } from "../src/env.js";
import { buildServer } from "../src/app.js";

process.env.NODE_ENV = "test";

const tempDir = mkdtempSync(join(tmpdir(), "diss-smoke-"));
const env = readEnv({
  PORT: 0,
  DATABASE_PATH: join(tempDir, "diss.db"),
  LIVEKIT_URL: "ws://localhost:7880",
  // Deliberately unreachable: moderation must fail gracefully with 502.
  LIVEKIT_API_URL: "http://127.0.0.1:9",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "secret",
  EGRESS_ENABLED: false,
  RECORDINGS_DIR: join(tempDir, "recordings"),
});

const app = await buildServer(env);
const address = await app.listen({ port: 0, host: "127.0.0.1" });
const base = address;

let passed = 0;
function ok(label: string) {
  passed++;
  console.log(`  ok ${passed} - ${label}`);
}

interface Ctx {
  cookie?: string;
}

async function api(
  method: string,
  path: string,
  ctx: Ctx = {},
  body?: unknown,
): Promise<{ status: number; json: any; setCookie: string | null }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(ctx.cookie ? { cookie: ctx.cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, setCookie };
}

function captureSession(ctx: Ctx, setCookie: string | null) {
  assert.ok(setCookie, "expected a Set-Cookie header");
  const match = /diss_session=([^;]+)/.exec(setCookie);
  assert.ok(match, "expected diss_session cookie");
  ctx.cookie = `diss_session=${match![1]}`;
  assert.match(setCookie!, /HttpOnly/i, "cookie must be httpOnly");
  assert.match(setCookie!, /SameSite=Lax/i, "cookie must be SameSite=Lax");
}

function decodeJwtPayload(token: string): any {
  const parts = token.split(".");
  assert.equal(parts.length, 3, "token must be a three-part JWT");
  return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
}

try {
  const host: Ctx = {};

  // --- register ---
  {
    const r = await api("POST", "/api/auth/register", {}, {
      name: "Remi",
      email: "remi@example.com",
      password: "hunter22-hunter22",
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.user.name, "Remi");
    assert.equal(r.json.user.email, "remi@example.com");
    assert.ok(r.json.user.id);
    captureSession(host, r.setCookie);
    ok("register returns 201 + user + session cookie");
  }
  {
    const r = await api("POST", "/api/auth/register", {}, {
      name: "Dup",
      email: "remi@example.com",
      password: "hunter22-hunter22",
    });
    assert.equal(r.status, 409);
    assert.equal(typeof r.json.error, "string");
    ok("duplicate email registration returns 409 {error}");
  }
  {
    const r = await api("POST", "/api/auth/register", {}, { name: "x", email: "bad" });
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.error, "string");
    ok("invalid register body returns 400 {error}");
  }

  // --- login / me / logout ---
  {
    const r = await api("POST", "/api/auth/login", {}, {
      email: "remi@example.com",
      password: "wrong-password",
    });
    assert.equal(r.status, 401);
    ok("login with wrong password returns 401");
  }
  {
    const r = await api("POST", "/api/auth/login", {}, {
      email: "remi@example.com",
      password: "hunter22-hunter22",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.email, "remi@example.com");
    captureSession(host, r.setCookie);
    ok("login returns 200 + user + fresh session cookie");
  }
  {
    const r = await api("GET", "/api/auth/me", host);
    assert.equal(r.status, 200);
    assert.equal(r.json.user.email, "remi@example.com");
    ok("me returns the session user");
  }
  {
    const r = await api("GET", "/api/auth/me");
    assert.equal(r.status, 401);
    ok("me without session returns 401");
  }

  // --- meetings CRUD ---
  let instant: any;
  let scheduled: any;
  {
    const r = await api("POST", "/api/meetings", host, { title: "Standup" });
    assert.equal(r.status, 201);
    instant = r.json.meeting;
    assert.match(instant.code, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    assert.equal(instant.title, "Standup");
    assert.equal(instant.startsAt, null);
    assert.equal(instant.hostName, "Remi");
    assert.ok(instant.hostUserId);
    assert.ok(instant.createdAt);
    ok("create instant meeting returns 201 {meeting} with code abc-defg-hij");
  }
  {
    const r = await api("POST", "/api/meetings", host, {
      title: "Planning",
      startsAt: "2027-01-05T10:00:00.000Z",
    });
    assert.equal(r.status, 201);
    scheduled = r.json.meeting;
    assert.equal(scheduled.startsAt, "2027-01-05T10:00:00.000Z");
    ok("create scheduled meeting keeps startsAt");
  }
  {
    const r = await api("POST", "/api/meetings", {}, { title: "Nope" });
    assert.equal(r.status, 401);
    ok("create meeting without session returns 401");
  }
  {
    const r = await api("GET", "/api/meetings", host);
    assert.equal(r.status, 200);
    assert.equal(r.json.meetings.length, 2);
    const codes = r.json.meetings.map((m: any) => m.code);
    assert.ok(codes.includes(instant.code) && codes.includes(scheduled.code));
    ok("list returns the host's meetings");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.id, instant.id);
    assert.equal(r.json.meeting.hostName, "Remi");
    ok("get by code is public and returns the meeting");
  }
  {
    const r = await api("GET", "/api/meetings/zzz-zzzz-zzz");
    assert.equal(r.status, 404);
    assert.equal(typeof r.json.error, "string");
    ok("unknown code returns 404 {error}");
  }

  // --- token endpoint ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, host, {
      displayName: "Remi",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.isHost, true);
    assert.equal(r.json.url, env.LIVEKIT_URL);
    assert.equal(r.json.identity, `user-${instant.hostUserId}`);
    const payload = decodeJwtPayload(r.json.token);
    assert.equal(payload.video.room, instant.code);
    assert.equal(payload.video.roomJoin, true);
    assert.equal(payload.video.roomAdmin, true);
    assert.equal(payload.video.roomCreate, true);
    assert.equal(payload.name, "Remi");
    ok("host token: isHost true, roomAdmin+roomCreate grants, room = code");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Visitor",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.isHost, false);
    assert.match(r.json.identity, /^guest-[0-9a-f]+$/);
    const payload = decodeJwtPayload(r.json.token);
    assert.equal(payload.video.room, instant.code);
    assert.equal(payload.video.roomJoin, true);
    assert.ok(!payload.video.roomAdmin, "guest must not get roomAdmin");
    ok("guest token: no session needed, isHost false, guest-<random> identity");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, {}, {});
    assert.equal(r.status, 400);
    ok("token without displayName returns 400");
  }
  {
    const r = await api("POST", "/api/meetings/zzz-zzzz-zzz/token", {}, {
      displayName: "x",
    });
    assert.equal(r.status, 404);
    ok("token for unknown code returns 404");
  }

  // --- moderation (LiveKit unreachable -> graceful 502, or 204 if a server happens to run) ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, {}, {
      action: "mute",
      identity: "guest-abc",
    });
    assert.equal(r.status, 401);
    ok("moderation without session returns 401");
  }
  {
    const guest: Ctx = {};
    const reg = await api("POST", "/api/auth/register", {}, {
      name: "Guest",
      email: "guest@example.com",
      password: "another-passw0rd",
    });
    captureSession(guest, reg.setCookie);
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, guest, {
      action: "remove",
      identity: "guest-abc",
    });
    assert.equal(r.status, 403);
    ok("moderation by a non-host returns 403");
  }
  for (const action of ["mute", "remove"] as const) {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, host, {
      action,
      identity: "guest-abc",
    });
    assert.ok(
      r.status === 502 || r.status === 204,
      `expected 502 or 204, got ${r.status}`,
    );
    if (r.status === 502) {
      assert.equal(typeof r.json.error, "string");
    }
    ok(`moderation "${action}" degrades gracefully (${r.status}) when LiveKit is unreachable`);
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, host, {
      action: "explode",
      identity: "guest-abc",
    });
    assert.equal(r.status, 400);
    ok("invalid moderation action returns 400");
  }

  // --- v2: meeting settings (PATCH) ---
  const member: Ctx = {};
  {
    const reg = await api("POST", "/api/auth/register", {}, {
      name: "Member",
      email: "member@example.com",
      password: "member-passw0rd",
    });
    assert.equal(reg.status, 201);
    captureSession(member, reg.setCookie);
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, {}, { title: "Nope" });
    assert.equal(r.status, 401);
    ok("PATCH meeting without session returns 401");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, member, { title: "Nope" });
    assert.equal(r.status, 403);
    ok("PATCH meeting by non-host returns 403");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, host, {
      title: "Renamed standup",
      waitingRoom: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.title, "Renamed standup");
    assert.equal(r.json.meeting.waitingRoom, true);
    assert.equal(r.json.meeting.locked, false);
    ok("host PATCH updates title and turns the waiting room on");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.waitingRoom, true);
    assert.equal(r.json.meeting.locked, false);
    ok("meeting JSON now carries waitingRoom/locked booleans");
  }

  // --- v2: waiting room flow ---
  let waitingId: string;
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Patient Guest",
    });
    assert.equal(r.status, 202);
    assert.equal(r.json.status, "waiting");
    assert.ok(r.json.waitingId);
    assert.equal(r.json.token, undefined, "202 must not include a token");
    waitingId = r.json.waitingId;
    ok("guest token with waiting room on returns 202 {waitingId, status: waiting}");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, host, {
      displayName: "Remi",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.isHost, true);
    ok("host bypasses the waiting room and still gets a token");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/waiting/${waitingId}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "waiting");
    ok("guest poll returns status waiting before admission");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/waiting/${crypto.randomUUID()}`);
    assert.equal(r.status, 404);
    ok("poll with unknown waitingId returns 404");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/waiting`, member);
    assert.equal(r.status, 403);
    ok("waiting list for a non-host member returns 403 (not a co-host)");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/waiting`);
    assert.equal(r.status, 401);
    ok("waiting list without session returns 401");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/waiting`, host);
    assert.equal(r.status, 200);
    assert.equal(r.json.guests.length, 1);
    assert.equal(r.json.guests[0].waitingId, waitingId);
    assert.equal(r.json.guests[0].displayName, "Patient Guest");
    assert.ok(r.json.guests[0].requestedAt);
    ok("host waiting list shows the queued guest");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/waiting/${waitingId}`, member, {
      action: "admit",
    });
    assert.equal(r.status, 403);
    ok("admit by a non-host member returns 403");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/waiting/${waitingId}`, host, {
      action: "admit",
    });
    assert.equal(r.status, 204);
    ok("host admit returns 204");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/waiting/${waitingId}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "admitted");
    assert.equal(r.json.isHost, false);
    assert.equal(r.json.url, env.LIVEKIT_URL);
    assert.match(r.json.identity, /^guest-[0-9a-f]+$/);
    const payload = decodeJwtPayload(r.json.token);
    assert.equal(payload.video.room, instant.code);
    assert.equal(payload.video.roomJoin, true);
    assert.ok(!payload.video.roomAdmin, "admitted guest must not get roomAdmin");
    assert.equal(payload.name, "Patient Guest");
    ok("admitted guest poll returns a valid non-admin JWT for the room");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Unwanted Guest",
    });
    assert.equal(r.status, 202);
    const deniedId = r.json.waitingId;
    const deny = await api("POST", `/api/meetings/${instant.code}/waiting/${deniedId}`, host, {
      action: "deny",
    });
    assert.equal(deny.status, 204);
    const poll = await api("GET", `/api/meetings/${instant.code}/waiting/${deniedId}`);
    assert.equal(poll.status, 200);
    assert.equal(poll.json.status, "denied");
    assert.equal(poll.json.token, undefined);
    ok("denied guest poll returns status denied with no token");
  }

  // --- v2: locked meeting ---
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, host, {
      waitingRoom: false,
      locked: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.locked, true);
    const guest = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Late Guest",
    });
    assert.equal(guest.status, 423);
    assert.equal(typeof guest.json.error, "string");
    const hostToken = await api("POST", `/api/meetings/${instant.code}/token`, host, {
      displayName: "Remi",
    });
    assert.equal(hostToken.status, 200);
    assert.equal(hostToken.json.isHost, true);
    ok("locked meeting: guest gets 423 {error}, host still joins");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, host, { locked: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.locked, false);
    ok("host can unlock the meeting again");
  }

  // --- v2: moderation promote/demote authorization ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, member, {
      action: "promote",
      identity: `user-anyone`,
    });
    assert.equal(r.status, 403);
    ok("promote by a non-host (non-cohost) member returns 403");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, host, {
      action: "promote",
      identity: "guest-abc123",
    });
    assert.equal(r.status, 403);
    ok("promoting a guest-* identity returns 403 (guests can't be co-hosts)");
  }
  for (const action of ["promote", "demote"] as const) {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, host, {
      action,
      identity: "user-someone",
    });
    assert.ok(r.status === 502 || r.status === 204, `expected 502 or 204, got ${r.status}`);
    ok(`host "${action}" reaches LiveKit and degrades gracefully (${r.status}) when unreachable`);
  }

  // --- v2: persistent messages ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      text: "hello from a guest",
      displayName: "Visitor",
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.message.identity, "guest");
    assert.equal(r.json.message.displayName, "Visitor");
    assert.equal(r.json.message.text, "hello from a guest");
    assert.equal(r.json.message.meetingId, instant.id);
    assert.ok(r.json.message.id && r.json.message.ts);
    ok("guest message POST needs no session, identity guest");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, host, {
      text: "hello from the host",
      displayName: "Remi",
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.message.identity, `user-${instant.hostUserId}`);
    ok("member message POST records identity user-<id>");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      text: "x".repeat(2001),
      displayName: "Spammy",
    });
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.error, "string");
    ok("message over 2000 chars is rejected by schema with 400");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      text: "x".repeat(2000),
      displayName: "Chatty",
    });
    assert.equal(r.status, 201);
    ok("message of exactly 2000 chars is accepted");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/messages`);
    assert.equal(r.status, 200);
    assert.equal(r.json.messages.length, 3);
    assert.equal(r.json.messages[0].text, "hello from a guest");
    assert.equal(r.json.messages[1].text, "hello from the host");
    ok("message GET returns history oldest first");
  }
  {
    const r = await api("GET", "/api/meetings/zzz-zzzz-zzz/messages");
    assert.equal(r.status, 404);
    ok("messages for unknown meeting code return 404");
  }

  // --- v2: recordings (EGRESS_ENABLED=false) ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/recording`, {}, {
      action: "start",
    });
    assert.equal(r.status, 401);
    ok("recording without session returns 401");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/recording`, member, {
      action: "start",
    });
    assert.equal(r.status, 403);
    ok("recording by a non-host member returns 403");
  }
  for (const action of ["start", "stop"] as const) {
    const r = await api("POST", `/api/meetings/${instant.code}/recording`, host, { action });
    assert.equal(r.status, 503);
    assert.equal(typeof r.json.error, "string");
    ok(`recording "${action}" returns 503 {error} while EGRESS_ENABLED=false`);
  }
  {
    const r = await api("GET", "/api/recordings", host);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.recordings, []);
    ok("recordings list is empty and requires auth");
  }
  {
    const r = await api("GET", "/api/recordings");
    assert.equal(r.status, 401);
    ok("recordings list without session returns 401");
  }
  {
    const r = await api("GET", "/api/recordings/nonexistent/file", host);
    assert.equal(r.status, 404);
    const del = await api("DELETE", "/api/recordings/nonexistent", host);
    assert.equal(del.status, 404);
    ok("recording file/delete for unknown id return 404");
  }

  // --- delete ---
  {
    const r = await api("DELETE", `/api/meetings/${scheduled.id}`, host);
    assert.equal(r.status, 204);
    const gone = await api("GET", `/api/meetings/${scheduled.code}`);
    assert.equal(gone.status, 404);
    ok("host delete returns 204 and the meeting is gone");
  }
  {
    const r = await api("DELETE", `/api/meetings/${instant.id}`);
    assert.equal(r.status, 401);
    ok("delete without session returns 401");
  }

  // --- logout ---
  {
    const r = await api("POST", "/api/auth/logout", host);
    assert.equal(r.status, 204);
    assert.ok(r.setCookie && /diss_session=;|diss_session=""/.test(r.setCookie));
    const me = await api("GET", "/api/auth/me", host);
    assert.equal(me.status, 401);
    ok("logout clears the cookie and invalidates the session");
  }

  // --- v2: rate limiting (kept last so 429s can't poison other checks) ---
  {
    let saw429: { status: number; json: any } | null = null;
    for (let i = 0; i < 15 && !saw429; i++) {
      const r = await api("POST", "/api/auth/register", {}, {
        name: `Limit ${i}`,
        email: `limit-${i}@example.com`,
        password: "limit-passw0rd",
      });
      if (r.status === 429) saw429 = r;
      else assert.ok(r.status === 201 || r.status === 409, `unexpected status ${r.status}`);
    }
    assert.ok(saw429, "expected register to hit the 10/window rate limit");
    assert.equal(typeof saw429!.json.error, "string");
    ok("register rate limit returns 429 {error} after 10 requests per window");
  }

  console.log(`\nAll ${passed} smoke checks passed.`);
} finally {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
}
