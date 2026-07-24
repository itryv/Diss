/**
 * Smoke test: boots the server on a random port with a temp DB and exercises
 * the whole API contract with fetch. No LiveKit server required — moderation
 * is pointed at an unreachable endpoint and asserted on error shape.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
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

async function request(
  baseUrl: string,
  method: string,
  path: string,
  ctx: Ctx = {},
  body?: unknown,
): Promise<{ status: number; json: any; setCookie: string | null }> {
  const res = await fetch(baseUrl + path, {
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

const api = (method: string, path: string, ctx: Ctx = {}, body?: unknown) =>
  request(base, method, path, ctx, body);

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

let adminApp: Awaited<ReturnType<typeof buildServer>> | null = null;

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

  // --- v4: chatToken minting ---
  let hostChat: string;
  let hostIdentity: string;
  let guestChat: string;
  let guestIdentity: string;
  let thirdChat: string;
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, host, {
      displayName: "Remi",
    });
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.chatToken, "string");
    const [payload, sig] = r.json.chatToken.split(".");
    assert.ok(payload && sig, "chatToken must be <b64url(payload)>.<sig>");
    assert.equal(
      Buffer.from(payload, "base64url").toString("utf8"),
      `${instant.id}.user-${instant.hostUserId}.Remi`,
    );
    hostChat = r.json.chatToken;
    hostIdentity = r.json.identity;
    ok("token response carries a chatToken over <meetingId>.<identity>.<displayName>");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Visitor",
    });
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.chatToken, "string");
    guestChat = r.json.chatToken;
    guestIdentity = r.json.identity;
    ok("guest token response carries a chatToken too");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Third Party",
    });
    assert.equal(r.status, 200);
    thirdChat = r.json.chatToken;
    ok("a third participant gets its own chatToken");
  }
  {
    // waiting-room admit must mint one as well
    const patch = await api("PATCH", `/api/meetings/${instant.id}`, host, { waitingRoom: true });
    assert.equal(patch.status, 200);
    const join = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Admitted Chatter",
    });
    assert.equal(join.status, 202);
    const admit = await api(
      "POST",
      `/api/meetings/${instant.code}/waiting/${join.json.waitingId}`,
      host,
      { action: "admit" },
    );
    assert.equal(admit.status, 204);
    const poll = await api("GET", `/api/meetings/${instant.code}/waiting/${join.json.waitingId}`);
    assert.equal(poll.json.status, "admitted");
    assert.equal(typeof poll.json.chatToken, "string");
    assert.equal(
      Buffer.from(poll.json.chatToken.split(".")[0], "base64url").toString("utf8"),
      `${instant.id}.${poll.json.identity}.Admitted Chatter`,
    );
    await api("PATCH", `/api/meetings/${instant.id}`, host, { waitingRoom: false });
    ok("waiting-room admit response mints a chatToken for the admitted guest");
  }
  {
    const flipped =
      hostChat.slice(0, -1) + (hostChat.slice(-1) === "A" ? "B" : "A");
    const r = await api("GET", `/api/meetings/${instant.code}/messages?chatToken=${encodeURIComponent(flipped)}`);
    assert.equal(r.status, 401);
    assert.equal(typeof r.json.error, "string");
    ok("chatToken with a flipped signature byte is rejected with 401");
  }
  {
    const payload = Buffer.from(hostChat.split(".")[0]!, "base64url").toString("utf8");
    const swapped = payload.replace(hostIdentity, guestIdentity);
    assert.notEqual(swapped, payload);
    const forged = `${Buffer.from(swapped, "utf8").toString("base64url")}.${hostChat.split(".")[1]}`;
    const r = await api("GET", `/api/meetings/${instant.code}/messages?chatToken=${encodeURIComponent(forged)}`);
    assert.equal(r.status, 401);
    ok("chatToken with a swapped identity (signature kept) is rejected with 401");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/messages`);
    assert.equal(r.status, 401);
    const post = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      text: "no token here",
    });
    assert.equal(post.status, 400);
    ok("message read without a chatToken is 401; write without one fails validation");
  }

  // --- v2/v4: persistent messages ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      chatToken: guestChat,
      text: "hello from a guest",
      displayName: "SPOOFED",
      identity: "user-somebody-else",
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.message.identity, guestIdentity);
    assert.equal(r.json.message.displayName, "Visitor");
    assert.equal(r.json.message.text, "hello from a guest");
    assert.equal(r.json.message.meetingId, instant.id);
    assert.equal(r.json.message.toIdentity, null);
    assert.deepEqual(r.json.message.mentions, []);
    assert.ok(r.json.message.id && r.json.message.ts);
    ok("guest message POST needs no session; identity/displayName come from the chatToken");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      chatToken: hostChat,
      text: "hello from the host",
      mentions: [guestIdentity, "*"],
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.message.identity, `user-${instant.hostUserId}`);
    assert.deepEqual(r.json.message.mentions, [guestIdentity, "*"]);
    ok("member message POST records identity user-<id> and keeps mentions");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      chatToken: guestChat,
      text: "x".repeat(2001),
    });
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.error, "string");
    ok("message over 2000 chars is rejected by schema with 400");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      chatToken: guestChat,
      text: "x".repeat(2000),
    });
    assert.equal(r.status, 201);
    ok("message of exactly 2000 chars is accepted");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      chatToken: guestChat,
      text: "too many mentions",
      mentions: Array.from({ length: 51 }, (_, i) => `user-${i}`),
    });
    assert.equal(r.status, 400);
    ok("more than 50 mentions is rejected by schema with 400");
  }
  {
    const r = await api(
      "GET",
      `/api/meetings/${instant.code}/messages?chatToken=${encodeURIComponent(guestChat)}`,
    );
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

  // --- v4: private messages ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/messages`, {}, {
      chatToken: hostChat,
      text: "psst, just for you",
      toIdentity: guestIdentity,
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.message.toIdentity, guestIdentity);
    ok("DM POST stores toIdentity");
  }
  {
    const recipient = await api(
      "GET",
      `/api/meetings/${instant.code}/messages?chatToken=${encodeURIComponent(guestChat)}`,
    );
    assert.equal(recipient.status, 200);
    assert.ok(
      recipient.json.messages.some((m: any) => m.text === "psst, just for you"),
      "the recipient must see the DM",
    );
    const sender = await api(
      "GET",
      `/api/meetings/${instant.code}/messages?chatToken=${encodeURIComponent(hostChat)}`,
    );
    assert.ok(
      sender.json.messages.some((m: any) => m.text === "psst, just for you"),
      "the sender must see their own DM",
    );
    ok("a DM is visible to its sender and its recipient");
  }
  {
    const third = await api(
      "GET",
      `/api/meetings/${instant.code}/messages?chatToken=${encodeURIComponent(thirdChat)}`,
    );
    assert.equal(third.status, 200);
    assert.ok(
      !third.json.messages.some((m: any) => m.text === "psst, just for you"),
      "a third party must NOT see someone else's DM",
    );
    assert.ok(
      third.json.messages.some((m: any) => m.text === "hello from a guest"),
      "a third party still sees public messages",
    );
    ok("a DM is invisible to a third party's GET");
  }
  {
    const other = await api("POST", "/api/meetings", host, { title: "Other" });
    assert.equal(other.status, 201);
    const r = await api(
      "GET",
      `/api/meetings/${other.json.meeting.code}/messages?chatToken=${encodeURIComponent(hostChat)}`,
    );
    assert.equal(r.status, 401);
    const post = await api("POST", `/api/meetings/${other.json.meeting.code}/messages`, {}, {
      chatToken: hostChat,
      text: "wrong room",
    });
    assert.equal(post.status, 401);
    await api("DELETE", `/api/meetings/${other.json.meeting.id}`, host);
    ok("a chatToken minted for one meeting cannot read or write another meeting");
  }

  // --- v4: host permissions enforced in the minted JWT ---
  {
    const r = await api("GET", `/api/meetings/${instant.code}`);
    assert.equal(r.json.meeting.allowShare, true);
    assert.equal(r.json.meeting.allowChat, true);
    assert.equal(r.json.meeting.allowUnmute, true);
    ok("meeting JSON exposes allowShare/allowChat/allowUnmute, all true by default");
  }
  {
    const guest = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Default Guest",
    });
    const payload = decodeJwtPayload(guest.json.token);
    assert.equal(payload.video.canPublishSources, undefined);
    assert.equal(payload.video.canPublishData, true);
    ok("with everything allowed a guest token is unrestricted (no canPublishSources)");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, member, { allowShare: false });
    assert.equal(r.status, 403);
    ok("PATCH of a permission by a non-host returns 403");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, host, { allowShare: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.allowShare, false);
    assert.ok(r.json.liveUpdate, "permission PATCH reports the live update attempt");
    assert.equal(typeof r.json.liveUpdate.error, "string");
    assert.equal(r.json.liveUpdate.applied, 0);
    ok("allowShare=false PATCH degrades gracefully when LiveKit is unreachable");
  }
  {
    const guest = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Restricted Guest",
    });
    const payload = decodeJwtPayload(guest.json.token);
    assert.deepEqual(payload.video.canPublishSources, ["camera", "microphone"]);
    assert.equal(payload.video.canPublishData, true);
    ok("allowShare=false: guest JWT grants canPublishSources [camera, microphone] only");
  }
  {
    const h = await api("POST", `/api/meetings/${instant.code}/token`, host, {
      displayName: "Remi",
    });
    const payload = decodeJwtPayload(h.json.token);
    assert.equal(payload.video.canPublishSources, undefined);
    assert.equal(payload.video.roomAdmin, true);
    ok("allowShare=false does not restrict the host's own token");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, host, { allowChat: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.allowChat, false);
    const guest = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Muzzled Guest",
    });
    const payload = decodeJwtPayload(guest.json.token);
    assert.equal(payload.video.canPublishData, false);
    const h = await api("POST", `/api/meetings/${instant.code}/token`, host, {
      displayName: "Remi",
    });
    assert.equal(decodeJwtPayload(h.json.token).video.canPublishData, true);
    ok("allowChat=false: guest JWT has canPublishData false, host keeps it true");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, host, { allowUnmute: false });
    assert.equal(r.status, 200);
    const guest = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Silent Guest",
    });
    const sources = decodeJwtPayload(guest.json.token).video.canPublishSources;
    assert.ok(!sources.includes("microphone"), "allowUnmute=false must drop the mic source");
    assert.ok(sources.includes("camera"));
    ok("allowUnmute=false: guest JWT cannot publish the microphone source");
  }
  {
    const r = await api("PATCH", `/api/meetings/${instant.id}`, host, {
      allowShare: true,
      allowChat: true,
      allowUnmute: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.meeting.allowShare, true);
    const guest = await api("POST", `/api/meetings/${instant.code}/token`, {}, {
      displayName: "Freed Guest",
    });
    const payload = decodeJwtPayload(guest.json.token);
    assert.equal(payload.video.canPublishSources, undefined);
    assert.equal(payload.video.canPublishData, true);
    ok("restoring the permissions un-restricts newly minted guest tokens");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, member, {
      action: "deny-share",
      identity: guestIdentity,
    });
    assert.equal(r.status, 403);
    ok("per-person deny-share by a non-host returns 403");
  }
  for (const action of ["deny-share", "allow-share"] as const) {
    const r = await api("POST", `/api/meetings/${instant.code}/moderate`, host, {
      action,
      identity: guestIdentity,
    });
    assert.ok(r.status === 502 || r.status === 204, `expected 502 or 204, got ${r.status}`);
    if (r.status === 502) assert.equal(typeof r.json.error, "string");
    ok(`moderation "${action}" degrades gracefully (${r.status}) when LiveKit is unreachable`);
  }

  // --- v4: breakout rooms ---
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts`, {}, {
      rooms: [{ name: "Room A", identities: [] }],
    });
    assert.equal(r.status, 401);
    ok("breakout create without session returns 401");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts`, member, {
      rooms: [{ name: "Room A", identities: [] }],
    });
    assert.equal(r.status, 403);
    ok("breakout create by a non-host member returns 403");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts`, host, { rooms: [] });
    assert.equal(r.status, 400);
    ok("breakout create with an empty rooms array returns 400");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts`, host, {
      rooms: [
        { name: "Room A", identities: [guestIdentity] },
        { name: "Room B", identities: [hostIdentity] },
      ],
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.breakouts.length, 2);
    assert.equal(r.json.breakouts[0].idx, 0);
    assert.equal(r.json.breakouts[0].name, "Room A");
    assert.equal(r.json.breakouts[1].idx, 1);
    assert.deepEqual(
      r.json.breakouts[0].participants.map((p: any) => p.identity),
      [guestIdentity],
    );
    assert.ok(r.json.breakouts[0].id);
    ok("host breakout create returns 201 with idx-ordered rooms and their participants");
  }
  {
    const r = await api("GET", `/api/meetings/${instant.code}/breakouts`);
    assert.equal(r.status, 200);
    assert.equal(r.json.open, true);
    assert.equal(r.json.breakouts.length, 2);
    assert.equal(r.json.breakouts[1].participants[0].identity, hostIdentity);
    ok("breakout list reports open: true with both rooms");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/token`, {}, {
      chatToken: guestChat,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.room, `${instant.code}__b0`);
    assert.equal(r.json.breakoutName, "Room A");
    assert.equal(r.json.url, env.LIVEKIT_URL);
    const payload = decodeJwtPayload(r.json.token);
    assert.equal(payload.video.room, `${instant.code}__b0`);
    assert.equal(payload.video.roomJoin, true);
    assert.ok(!payload.video.roomAdmin, "an assigned guest must not get roomAdmin in a breakout");
    ok("assigned guest gets a breakout token for its own room only");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/token`, {}, {
      chatToken: guestChat,
      idx: 1,
    });
    assert.equal(r.status, 404);
    ok("a non-host asking for a breakout it is not assigned to returns 404");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/token`, {}, {
      chatToken: thirdChat,
    });
    assert.equal(r.status, 404);
    assert.equal(typeof r.json.error, "string");
    ok("an unassigned participant gets 404 from the breakout token endpoint");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/token`, {}, {
      chatToken: hostChat,
      idx: 0,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.room, `${instant.code}__b0`);
    assert.equal(decodeJwtPayload(r.json.token).video.roomAdmin, true);
    ok("the host may request a token for any breakout idx");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/token`, {}, {
      chatToken: "not-a-real-token",
    });
    assert.equal(r.status, 401);
    ok("breakout token with an invalid chatToken returns 401");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts`, host, {
      rooms: [{ name: "Solo", identities: [guestIdentity] }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.breakouts.length, 1);
    const list = await api("GET", `/api/meetings/${instant.code}/breakouts`);
    assert.equal(list.json.breakouts.length, 1);
    assert.equal(list.json.breakouts[0].name, "Solo");
    ok("creating a new set replaces the previous open breakouts");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/close`, member);
    assert.equal(r.status, 403);
    ok("breakout close by a non-host member returns 403");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/close`, host);
    assert.equal(r.status, 204);
    const list = await api("GET", `/api/meetings/${instant.code}/breakouts`);
    assert.equal(list.json.open, false);
    assert.deepEqual(list.json.breakouts, []);
    ok("host breakout close returns 204 and the list reports open: false");
  }
  {
    const r = await api("POST", `/api/meetings/${instant.code}/breakouts/token`, {}, {
      chatToken: guestChat,
    });
    assert.equal(r.status, 404);
    ok("after close a stale client cannot mint a breakout token (404)");
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

  // ==================== admin API (docs/api-contract-admin.md) ====================
  // A second server instance with its own DB, recordings dir and rate-limit
  // counters: the admin surface changes global settings (registrationOpen, the
  // default* meeting seeds) and deletes users, so it must not share state with
  // the checks above.
  {
    const adminDir = join(tempDir, "admin");
    const adminRecordings = join(adminDir, "recordings");
    mkdirSync(adminRecordings, { recursive: true });
    const adminEnv = readEnv({
      PORT: 0,
      DATABASE_PATH: join(adminDir, "diss.db"),
      LIVEKIT_URL: "ws://localhost:7880",
      // Unreachable on purpose: every LiveKit-touching admin route must degrade.
      LIVEKIT_API_URL: "http://127.0.0.1:9",
      EGRESS_ENABLED: false,
      RECORDINGS_DIR: adminRecordings,
      // Deliberately messy: extra spaces, an empty entry, and mixed case.
      ADMIN_EMAILS: "  Admin@Example.COM , , MiXeD@Example.com ",
    });
    adminApp = await buildServer(adminEnv);
    const adminBase = await adminApp.listen({ port: 0, host: "127.0.0.1" });
    const aapi = (method: string, path: string, ctx: Ctx = {}, body?: unknown) =>
      request(adminBase, method, path, ctx, body);

    const adminDb = new Database(join(adminDir, "diss.db"));
    const count = (table: string, where: string, ...args: any[]) =>
      (adminDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args) as any).n;
    const seedRecording = (meetingId: string, fileName: string, contents: string | null) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      adminDb
        .prepare(
          "INSERT INTO recordings (id, meeting_id, egress_id, file_name, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, meetingId, `eg-${id}`, fileName, now, now);
      if (contents !== null) writeFileSync(join(adminRecordings, fileName), contents);
      return id;
    };

    const admin: Ctx = {};
    const alice: Ctx = {};
    const victim: Ctx = {};
    const mixed: Ctx = {};
    let adminId: string;
    let aliceId: string;
    let victimId: string;
    let mixedId: string;

    {
      const r = await aapi("POST", "/api/auth/register", {}, {
        name: "Admin",
        email: "admin@example.com",
        password: "admin-passw0rd-1",
      });
      assert.equal(r.status, 201);
      adminId = r.json.user.id;
      captureSession(admin, r.setCookie);
      const a = await aapi("POST", "/api/auth/register", {}, {
        name: "Alice",
        email: "alice@example.com",
        password: "alice-passw0rd-1",
      });
      aliceId = a.json.user.id;
      captureSession(alice, a.setCookie);
      const v = await aapi("POST", "/api/auth/register", {}, {
        name: "Victor Victim",
        email: "victim@example.com",
        password: "victim-passw0rd-1",
      });
      victimId = v.json.user.id;
      captureSession(victim, v.setCookie);
      const m = await aapi("POST", "/api/auth/register", {}, {
        name: "Mixed Case Admin",
        email: "mixed@example.com",
        password: "mixed-passw0rd-1",
      });
      mixedId = m.json.user.id;
      captureSession(mixed, m.setCookie);
      ok("admin fixture: four users registered against a fresh instance");
    }

    // --- §0 identity ---
    {
      const r = await aapi("GET", "/api/auth/me", admin);
      assert.equal(r.status, 200);
      assert.equal(r.json.isAdmin, true);
      assert.equal(r.json.user.isAdmin, true);
      ok("me for an ADMIN_EMAILS user reports isAdmin true (envelope and user)");
    }
    {
      const r = await aapi("GET", "/api/auth/me", alice);
      assert.equal(r.json.isAdmin, false);
      assert.equal(r.json.user.isAdmin, false);
      ok("me for a normal user reports isAdmin false");
    }
    {
      const r = await aapi("GET", "/api/auth/me", mixed);
      assert.equal(r.json.isAdmin, true);
      ok("ADMIN_EMAILS matching is case-insensitive and trims whitespace");
    }

    // A meeting to aim the destructive routes at while checking authorization.
    let aliceMeeting: any;
    {
      const r = await aapi("POST", "/api/meetings", alice, { title: "Alice sync" });
      assert.equal(r.status, 201);
      aliceMeeting = r.json.meeting;
    }

    const adminRoutes: [string, string, unknown?][] = [
      ["GET", "/api/admin/overview"],
      ["GET", "/api/admin/users"],
      ["PATCH", `/api/admin/users/${victimId}`, { disabled: true }],
      ["DELETE", `/api/admin/users/${victimId}`],
      ["GET", "/api/admin/meetings"],
      ["DELETE", `/api/admin/meetings/${aliceMeeting.id}`],
      ["POST", `/api/admin/meetings/${aliceMeeting.id}/end`],
      ["GET", "/api/admin/live"],
      ["POST", "/api/admin/live/some-room/kick", { identity: "guest-1" }],
      ["POST", "/api/admin/live/some-room/end"],
      ["GET", "/api/admin/recordings"],
      ["DELETE", "/api/admin/recordings/nope"],
      ["GET", "/api/admin/settings"],
      ["PATCH", "/api/admin/settings", { registrationOpen: true }],
      ["GET", "/api/admin/audit"],
    ];
    {
      for (const [method, path, body] of adminRoutes) {
        const r = await aapi(method, path, alice, body);
        assert.equal(r.status, 403, `${method} ${path} for a non-admin should be 403`);
        assert.equal(typeof r.json.error, "string");
      }
      ok(`all ${adminRoutes.length} admin routes return 403 {error} for a non-admin session`);
    }
    {
      for (const [method, path, body] of adminRoutes) {
        const r = await aapi(method, path, {}, body);
        assert.equal(r.status, 403, `${method} ${path} without a session should be 403`);
      }
      ok("all admin routes return 403 (not 401) without a session");
    }
    {
      const gets = [
        "/api/admin/overview",
        "/api/admin/users",
        "/api/admin/meetings",
        "/api/admin/live",
        "/api/admin/recordings",
        "/api/admin/settings",
        "/api/admin/audit",
      ];
      for (const path of gets) {
        const r = await aapi("GET", path, admin);
        assert.equal(r.status, 200, `${path} for an admin should be 200`);
      }
      ok("every admin GET route returns 200 for an admin session");
    }

    // --- §1 overview ---
    {
      const r = await aapi("GET", "/api/admin/overview", admin);
      assert.equal(r.status, 200);
      assert.equal(r.json.users.total, 4);
      assert.equal(r.json.users.disabled, 0);
      assert.equal(r.json.users.admins, 2);
      assert.equal(r.json.meetings.total, 1);
      assert.equal(r.json.meetings.scheduled, 0);
      assert.equal(r.json.meetings.live, 0);
      assert.equal(r.json.recordings.count, 0);
      assert.equal(r.json.messages.total, 0);
      assert.ok(r.json.storage.dbBytes > 0, "dbBytes should be non-zero");
      assert.equal(typeof r.json.storage.recordingsBytes, "number");
      assert.equal(typeof r.json.storage.diskFreeBytes, "number");
      assert.equal(typeof r.json.server.uptimeS, "number");
      assert.equal(r.json.server.nodeVersion, process.version);
      assert.ok(r.json.server.startedAt);
      ok("overview reports user/meeting/recording/message/storage/server stats");
    }
    {
      const r = await aapi("GET", "/api/admin/overview", admin);
      assert.equal(r.json.livekit.reachable, false);
      assert.equal(typeof r.json.livekit.error, "string");
      assert.equal(r.json.livekit.rooms, 0);
      assert.equal(r.json.livekit.participants, 0);
      ok("overview degrades to livekit.reachable false + error when LiveKit is down");
    }

    // --- §4 live rooms with LiveKit down ---
    {
      const r = await aapi("GET", "/api/admin/live", admin);
      assert.equal(r.status, 200);
      assert.equal(r.json.reachable, false);
      assert.deepEqual(r.json.rooms, []);
      assert.equal(typeof r.json.error, "string");
      ok("live rooms returns 200 {rooms: [], reachable: false, error} when LiveKit is down");
    }
    for (const [label, path, body] of [
      ["kick", "/api/admin/live/some-room/kick", { identity: "guest-1" }],
      ["end", "/api/admin/live/some-room/end", undefined],
    ] as const) {
      const r = await aapi("POST", path, admin, body);
      assert.equal(r.status, 502, `live ${label} should be 502, got ${r.status}`);
      assert.equal(typeof r.json.error, "string");
      ok(`live ${label} returns 502 {error} rather than hanging or 500 when LiveKit is down`);
    }
    {
      const r = await aapi("POST", `/api/admin/meetings/${aliceMeeting.id}/end`, admin);
      assert.equal(r.status, 502);
      assert.equal(typeof r.json.error, "string");
      const missing = await aapi("POST", "/api/admin/meetings/does-not-exist/end", admin);
      assert.equal(missing.status, 404);
      ok("meeting end reports 502 when LiveKit is unreachable and 404 for an unknown meeting");
    }

    // --- §2 users list, search and pagination ---
    {
      const r = await aapi("GET", "/api/admin/users", admin);
      assert.equal(r.status, 200);
      assert.equal(r.json.total, 4);
      assert.equal(r.json.users.length, 4);
      const row = r.json.users.find((u: any) => u.id === aliceId);
      assert.equal(row.email, "alice@example.com");
      assert.equal(row.name, "Alice");
      assert.equal(row.isAdmin, false);
      assert.equal(row.disabled, false);
      assert.ok(row.createdAt);
      assert.equal(row.meetingCount, 1);
      assert.ok(row.lastSeenAt, "lastSeenAt should come from the newest session");
      const adminRow = r.json.users.find((u: any) => u.id === adminId);
      assert.equal(adminRow.isAdmin, true);
      ok("users list returns {users, total} with isAdmin/disabled/meetingCount/lastSeenAt");
    }
    {
      const byEmail = await aapi("GET", "/api/admin/users?q=VICTIM@", admin);
      assert.equal(byEmail.json.total, 1);
      assert.equal(byEmail.json.users[0].id, victimId);
      const byName = await aapi("GET", "/api/admin/users?q=victor", admin);
      assert.equal(byName.json.total, 1);
      assert.equal(byName.json.users[0].id, victimId);
      const none = await aapi("GET", "/api/admin/users?q=nobody-here", admin);
      assert.equal(none.json.total, 0);
      assert.deepEqual(none.json.users, []);
      ok("users q filters on name and email, case-insensitively");
    }
    {
      const page = await aapi("GET", "/api/admin/users?limit=2&offset=0", admin);
      assert.equal(page.json.users.length, 2);
      assert.equal(page.json.total, 4, "total is the unpaginated count");
      const next = await aapi("GET", "/api/admin/users?limit=2&offset=2", admin);
      assert.equal(next.json.users.length, 2);
      assert.notEqual(next.json.users[0].id, page.json.users[0].id);
      const bad = await aapi("GET", "/api/admin/users?limit=500", admin);
      assert.equal(bad.status, 400);
      ok("users pagination honours limit/offset, keeps total, and caps limit at 200");
    }

    // --- §0/§2 guard rails ---
    {
      const self = await aapi("PATCH", `/api/admin/users/${adminId}`, admin, { disabled: true });
      assert.equal(self.status, 400);
      assert.equal(typeof self.json.error, "string");
      const selfDelete = await aapi("DELETE", `/api/admin/users/${adminId}`, admin);
      assert.equal(selfDelete.status, 400);
      ok("an admin cannot disable or delete their own account (400)");
    }
    {
      // `mixed@example.com` is only an admin via the differently-cased
      // `MiXeD@Example.com` entry in ADMIN_EMAILS — the guard must still bite.
      const disable = await aapi("PATCH", `/api/admin/users/${mixedId}`, admin, { disabled: true });
      assert.equal(disable.status, 400);
      const del = await aapi("DELETE", `/api/admin/users/${mixedId}`, admin);
      assert.equal(del.status, 400);
      assert.equal(count("users", "id = ?", mixedId), 1, "the other admin must still exist");
      ok("an admin cannot disable or delete another admin, even one matched case-insensitively");
    }
    {
      const r = await aapi("PATCH", "/api/admin/users/nope", admin, { disabled: true });
      assert.equal(r.status, 404);
      const d = await aapi("DELETE", "/api/admin/users/nope", admin);
      assert.equal(d.status, 404);
      const bad = await aapi("PATCH", `/api/admin/users/${victimId}`, admin, { nope: true });
      assert.equal(bad.status, 400);
      ok("user PATCH/DELETE 404 on an unknown id and 400 on an invalid body");
    }

    // --- §0 disabling really disables ---
    {
      const r = await aapi("PATCH", `/api/admin/users/${victimId}`, admin, { disabled: true });
      assert.equal(r.status, 200);
      assert.equal(r.json.user.id, victimId);
      assert.equal(r.json.user.disabled, true);
      ok("PATCH {disabled:true} returns 200 {user} with disabled true");
    }
    {
      assert.equal(count("sessions", "user_id = ?", victimId), 0, "sessions must be deleted");
      const me = await aapi("GET", "/api/auth/me", victim);
      assert.equal(me.status, 401);
      ok("disabling a user deletes their sessions; the old cookie is now 401");
    }
    {
      const r = await aapi("POST", "/api/auth/login", {}, {
        email: "victim@example.com",
        password: "victim-passw0rd-1",
      });
      assert.equal(r.status, 401);
      assert.equal(typeof r.json.error, "string");
      ok("a disabled user cannot log in (401)");
    }
    {
      const r = await aapi("PATCH", `/api/admin/users/${victimId}`, admin, { disabled: false });
      assert.equal(r.status, 200);
      assert.equal(r.json.user.disabled, false);
      const login = await aapi("POST", "/api/auth/login", {}, {
        email: "victim@example.com",
        password: "victim-passw0rd-1",
      });
      assert.equal(login.status, 200);
      captureSession(victim, login.setCookie);
      ok("re-enabling a user lets them log in again");
    }

    // --- §6 settings ---
    {
      const r = await aapi("GET", "/api/admin/settings", admin);
      assert.deepEqual(r.json.settings, {
        registrationOpen: true,
        defaultAllowShare: true,
        defaultAllowChat: true,
        defaultAllowUnmute: true,
        defaultWaitingRoom: false,
      });
      ok("settings read through defaults when no rows exist");
    }
    {
      const r = await aapi("PATCH", "/api/admin/settings", admin, { registrationOpen: false });
      assert.equal(r.status, 200);
      assert.equal(r.json.settings.registrationOpen, false);
      assert.equal(r.json.settings.defaultAllowShare, true, "other keys are untouched");
      const blocked = await aapi("POST", "/api/auth/register", {}, {
        name: "Late",
        email: "late@example.com",
        password: "late-passw0rd-1",
      });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.json.error, "registration is closed");
      ok("registrationOpen:false blocks POST /api/auth/register with 403 {error}");
    }
    {
      const r = await aapi("PATCH", "/api/admin/settings", admin, { registrationOpen: true });
      assert.equal(r.json.settings.registrationOpen, true);
      const allowed = await aapi("POST", "/api/auth/register", {}, {
        name: "Late",
        email: "late@example.com",
        password: "late-passw0rd-1",
      });
      assert.equal(allowed.status, 201);
      ok("registrationOpen:true lets registration through again");
    }
    {
      const r = await aapi("PATCH", "/api/admin/settings", admin, {
        defaultWaitingRoom: true,
        defaultAllowChat: false,
        defaultAllowShare: false,
      });
      assert.equal(r.status, 200);
      const created = await aapi("POST", "/api/meetings", alice, { title: "Seeded" });
      assert.equal(created.status, 201);
      assert.equal(created.json.meeting.waitingRoom, true);
      assert.equal(created.json.meeting.allowChat, false);
      assert.equal(created.json.meeting.allowShare, false);
      assert.equal(created.json.meeting.allowUnmute, true);
      // An existing meeting is untouched.
      const existing = await aapi("GET", `/api/meetings/${aliceMeeting.code}`);
      assert.equal(existing.json.meeting.waitingRoom, false);
      assert.equal(existing.json.meeting.allowChat, true);
      await aapi("DELETE", `/api/meetings/${created.json.meeting.id}`, alice);
      await aapi("PATCH", "/api/admin/settings", admin, {
        defaultWaitingRoom: false,
        defaultAllowChat: true,
        defaultAllowShare: true,
      });
      ok("default* settings seed a NEW meeting's waiting_room/allow_* and leave old ones alone");
    }
    {
      const r = await aapi("PATCH", "/api/admin/settings", admin, { registrationOpen: "yes" });
      assert.equal(r.status, 400);
      const bad = await aapi("PATCH", "/api/admin/settings", admin, { registrationOpen: 5 });
      assert.equal(bad.status, 400);
      // Fastify strips unknown properties rather than rejecting them, so an
      // unknown key is a no-op — never a silent write of a bogus setting.
      const unknown = await aapi("PATCH", "/api/admin/settings", admin, { somethingElse: true });
      assert.equal(unknown.status, 200);
      assert.deepEqual(unknown.json.settings, {
        registrationOpen: true,
        defaultAllowShare: true,
        defaultAllowChat: true,
        defaultAllowUnmute: true,
        defaultWaitingRoom: false,
      });
      ok("settings PATCH rejects non-boolean values (400) and ignores unknown keys");
    }

    // --- §3 meetings list ---
    {
      const r = await aapi("GET", "/api/admin/meetings", admin);
      assert.equal(r.status, 200);
      assert.equal(r.json.total, 1);
      const row = r.json.meetings[0];
      assert.equal(row.id, aliceMeeting.id);
      assert.equal(row.code, aliceMeeting.code);
      assert.equal(row.hostName, "Alice");
      assert.equal(row.hostEmail, "alice@example.com");
      assert.equal(row.live, false);
      assert.equal(row.participantCount, 0);
      assert.equal(row.messageCount, 0);
      assert.equal(row.recordingCount, 0);
      ok("meetings list returns {meetings, total} with host, live and counts");
    }
    {
      const byCode = await aapi(
        `GET`,
        `/api/admin/meetings?q=${aliceMeeting.code.slice(0, 3)}`,
        admin,
      );
      assert.equal(byCode.json.total, 1);
      const byTitle = await aapi("GET", "/api/admin/meetings?q=SYNC", admin);
      assert.equal(byTitle.json.total, 1);
      const none = await aapi("GET", "/api/admin/meetings?q=zzzz-nothing", admin);
      assert.equal(none.json.total, 0);
      const live = await aapi("GET", "/api/admin/meetings?live=1", admin);
      assert.equal(live.status, 200);
      assert.equal(live.json.total, 0, "nothing is live while LiveKit is down");
      ok("meetings q filters code and title; live=1 filters to active rooms");
    }

    // --- §5 recordings ---
    let presentRecording: string;
    let missingRecording: string;
    {
      presentRecording = seedRecording(aliceMeeting.id, "present.mp4", "video-bytes");
      missingRecording = seedRecording(aliceMeeting.id, "absent.mp4", null);
      const r = await aapi("GET", "/api/admin/recordings", admin);
      assert.equal(r.status, 200);
      assert.equal(r.json.total, 2);
      assert.equal(r.json.totalBytes, "video-bytes".length);
      const present = r.json.recordings.find((x: any) => x.id === presentRecording);
      assert.equal(present.meetingCode, aliceMeeting.code);
      assert.equal(present.meetingTitle, "Alice sync");
      assert.equal(present.hostName, "Alice");
      assert.equal(present.sizeBytes, "video-bytes".length);
      assert.equal(present.missing, false);
      assert.ok(present.startedAt && present.endedAt);
      const absent = r.json.recordings.find((x: any) => x.id === missingRecording);
      assert.equal(absent.missing, true);
      assert.equal(absent.sizeBytes, null);
      ok("admin recordings list returns {recordings,total,totalBytes} and flags missing files");
    }
    {
      const page = await aapi("GET", "/api/admin/recordings?limit=1&offset=0", admin);
      assert.equal(page.json.recordings.length, 1);
      assert.equal(page.json.total, 2);
      ok("admin recordings pagination keeps the unpaginated total");
    }
    {
      const res = await fetch(`${adminBase}/api/recordings/${presentRecording}/file`, {
        headers: { cookie: admin.cookie! },
      });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "video-bytes");
      ok("an admin may stream a recording they do not host");
    }
    {
      const res = await fetch(`${adminBase}/api/recordings/${presentRecording}/file`, {
        headers: { cookie: alice.cookie! },
      });
      assert.equal(res.status, 200, "the host path must still work");
      await res.arrayBuffer();
      const stranger = await fetch(`${adminBase}/api/recordings/${presentRecording}/file`, {
        headers: { cookie: victim.cookie! },
      });
      assert.equal(stranger.status, 403);
      await stranger.arrayBuffer();
      ok("the host still streams their own recording; an unrelated user gets 403");
    }
    {
      const r = await aapi("DELETE", `/api/admin/recordings/${presentRecording}`, admin);
      assert.equal(r.status, 204);
      assert.equal(count("recordings", "id = ?", presentRecording), 0);
      assert.equal(
        existsSync(join(adminRecordings, "present.mp4")),
        false,
        "the file must be removed from disk",
      );
      const missing = await aapi("DELETE", "/api/admin/recordings/nope", admin);
      assert.equal(missing.status, 404);
      ok("admin recording delete removes the row AND the file; unknown id is 404");
    }

    // --- §3 meeting delete cascades ---
    {
      const meeting = (await aapi("POST", "/api/meetings", alice, { title: "Doomed" })).json.meeting;
      const token = await aapi("POST", `/api/meetings/${meeting.code}/token`, alice, {
        displayName: "Alice",
      });
      await aapi("POST", `/api/meetings/${meeting.code}/messages`, {}, {
        chatToken: token.json.chatToken,
        text: "this will be deleted",
      });
      const breakouts = await aapi("POST", `/api/meetings/${meeting.code}/breakouts`, alice, {
        rooms: [{ name: "B", identities: [token.json.identity] }],
      });
      const breakoutId = breakouts.json.breakouts[0].id;
      const recId = seedRecording(meeting.id, "doomed.mp4", "doomed-bytes");
      await aapi("PATCH", `/api/meetings/${meeting.id}`, alice, { waitingRoom: true });
      await aapi("POST", `/api/meetings/${meeting.code}/token`, {}, { displayName: "Waiter" });
      assert.equal(count("waiting_guests", "meeting_id = ?", meeting.id), 1);

      const r = await aapi("DELETE", `/api/admin/meetings/${meeting.id}`, admin);
      assert.equal(r.status, 204);
      assert.equal(count("meetings", "id = ?", meeting.id), 0);
      assert.equal(count("messages", "meeting_id = ?", meeting.id), 0);
      assert.equal(count("waiting_guests", "meeting_id = ?", meeting.id), 0);
      assert.equal(count("breakouts", "meeting_id = ?", meeting.id), 0);
      assert.equal(count("breakout_assignments", "breakout_id = ?", breakoutId), 0);
      assert.equal(count("recordings", "id = ?", recId), 0);
      assert.equal(existsSync(join(adminRecordings, "doomed.mp4")), false);
      const gone = await aapi("DELETE", `/api/admin/meetings/${meeting.id}`, admin);
      assert.equal(gone.status, 404);
      ok("admin meeting delete removes every dependent row and the recording file");
    }

    // --- §2 user delete cascades ---
    {
      const meeting = (await aapi("POST", "/api/meetings", victim, { title: "Victim standup" }))
        .json.meeting;
      const token = await aapi("POST", `/api/meetings/${meeting.code}/token`, victim, {
        displayName: "Victor",
      });
      await aapi("POST", `/api/meetings/${meeting.code}/messages`, {}, {
        chatToken: token.json.chatToken,
        text: "cascade me",
      });
      const breakouts = await aapi("POST", `/api/meetings/${meeting.code}/breakouts`, victim, {
        rooms: [{ name: "Victim room", identities: [token.json.identity] }],
      });
      const breakoutId = breakouts.json.breakouts[0].id;
      const recId = seedRecording(meeting.id, "victim.mp4", "victim-bytes");
      await aapi("PATCH", `/api/meetings/${meeting.id}`, victim, { waitingRoom: true });
      await aapi("POST", `/api/meetings/${meeting.code}/token`, {}, { displayName: "Waiter" });

      assert.equal(count("sessions", "user_id = ?", victimId) > 0, true);
      assert.equal(count("messages", "meeting_id = ?", meeting.id), 1);
      assert.equal(count("waiting_guests", "meeting_id = ?", meeting.id), 1);
      assert.equal(count("breakout_assignments", "breakout_id = ?", breakoutId), 1);
      assert.equal(existsSync(join(adminRecordings, "victim.mp4")), true);

      const r = await aapi("DELETE", `/api/admin/users/${victimId}`, admin);
      assert.equal(r.status, 204);
      assert.equal(count("users", "id = ?", victimId), 0, "user row");
      assert.equal(count("sessions", "user_id = ?", victimId), 0, "sessions");
      assert.equal(count("meetings", "host_user_id = ?", victimId), 0, "meetings");
      assert.equal(count("messages", "meeting_id = ?", meeting.id), 0, "messages");
      assert.equal(count("waiting_guests", "meeting_id = ?", meeting.id), 0, "waiting guests");
      assert.equal(count("breakouts", "meeting_id = ?", meeting.id), 0, "breakouts");
      assert.equal(count("breakout_assignments", "breakout_id = ?", breakoutId), 0, "assignments");
      assert.equal(count("recordings", "id = ?", recId), 0, "recording rows");
      assert.equal(
        existsSync(join(adminRecordings, "victim.mp4")),
        false,
        "the recording file must be gone from disk",
      );
      ok("user delete cascades to sessions, meetings, messages, waiting guests, breakouts, assignments, recordings + files");
    }
    {
      const me = await aapi("GET", "/api/auth/me", victim);
      assert.equal(me.status, 401);
      const login = await aapi("POST", "/api/auth/login", {}, {
        email: "victim@example.com",
        password: "victim-passw0rd-1",
      });
      assert.equal(login.status, 401);
      ok("a deleted user's session and credentials no longer work");
    }

    // --- §7 audit log ---
    {
      const r = await aapi("GET", "/api/admin/audit", admin);
      assert.equal(r.status, 200);
      assert.ok(r.json.total >= 8, `expected several audit rows, got ${r.json.total}`);
      const actions = r.json.entries.map((e: any) => e.action);
      for (const action of [
        "user.disable",
        "user.enable",
        "user.delete",
        "meeting.delete",
        "recording.delete",
        "settings.update",
      ]) {
        assert.ok(actions.includes(action), `audit should contain ${action}`);
      }
      ok("audit log records every state-changing admin action by name");
    }
    {
      const r = await aapi("GET", "/api/admin/audit", admin);
      const entry = r.json.entries.find((e: any) => e.action === "user.delete");
      assert.equal(entry.actorUserId, adminId);
      assert.equal(entry.actorEmail, "admin@example.com");
      assert.equal(entry.targetType, "user");
      assert.equal(entry.targetId, victimId);
      assert.equal(entry.detail.email, "victim@example.com");
      assert.ok(entry.createdAt);
      const raw = JSON.stringify(r.json.entries);
      assert.ok(!/passw0rd|password_hash|password_salt|diss_session/.test(raw), "no secrets");
      ok("audit entries carry the actor id/email, target and a short JSON detail, no secrets");
    }
    {
      const r = await aapi("GET", "/api/admin/audit?limit=1", admin);
      assert.equal(r.json.entries.length, 1);
      assert.ok(r.json.total > 1);
      const second = await aapi("GET", "/api/admin/audit?limit=1&offset=1", admin);
      assert.notEqual(second.json.entries[0].id, r.json.entries[0].id);
      const times = (await aapi("GET", "/api/admin/audit", admin)).json.entries.map(
        (e: any) => e.createdAt,
      );
      assert.deepEqual(times, [...times].sort().reverse(), "newest first");
      ok("audit log is newest-first and paginates with limit/offset + total");
    }
    {
      // Failed guard-rail attempts must not be recorded as if they happened.
      const r = await aapi("GET", "/api/admin/audit?limit=200", admin);
      const targets = r.json.entries
        .filter((e: any) => e.action.startsWith("user."))
        .map((e: any) => e.targetId);
      assert.ok(!targets.includes(mixedId), "a rejected action must not be audited");
      assert.ok(!targets.includes(adminId));
      ok("rejected admin actions (self/other admin) write no audit rows");
    }

    // --- §0 admin rate limit ---
    {
      let saw429 = false;
      for (let i = 0; i < 130 && !saw429; i++) {
        const r = await aapi("GET", "/api/admin/settings", admin);
        if (r.status === 429) saw429 = true;
        else assert.equal(r.status, 200);
      }
      assert.ok(saw429, "expected /api/admin/* to be limited to 120 per window");
      ok("admin routes are rate limited to 120 per window per IP (429)");
    }

    adminDb.close();
  }

  console.log(`\nAll ${passed} smoke checks passed.`);
} finally {
  await app.close();
  if (adminApp) await adminApp.close();
  rmSync(tempDir, { recursive: true, force: true });
}
