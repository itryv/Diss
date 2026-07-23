import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  RoomServiceClient,
  TrackSource,
  TrackType,
} from "livekit-server-sdk";
import type { Env } from "./env.js";
import {
  openDb,
  type MeetingRow,
  type MessageRow,
  type RecordingRow,
  type UserRow,
  type WaitingGuestRow,
} from "./db.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  publicUser,
  sessionUser,
  setSessionCookie,
  verifyPassword,
} from "./auth.js";
import {
  findMeetingByCode,
  findMeetingById,
  generateMeetingCode,
  listMeetingsForHost,
  meetingJson,
} from "./meetings.js";

const userSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
  },
} as const;

const errorReply = { type: "object", properties: { error: { type: "string" } } } as const;

/** Waiting-room entries not polled for this long may be pruned. */
const WAITING_STALE_MS = 60_000;

function perRoute(max: number) {
  return { config: { rateLimit: { max } } };
}

export async function buildServer(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const db = openDb(env.DATABASE_PATH);
  const recordingsDir = resolve(env.RECORDINGS_DIR);

  app.register(cookie, { secret: env.SESSION_SECRET });
  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  // Awaited so its onRoute hook is live before the routes below register —
  // otherwise the per-route limits would silently not apply. 429s are thrown
  // as errors with statusCode 429, so the setErrorHandler below turns them
  // into the contract's {error} shape.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });

  app.addHook("onClose", async () => {
    db.close();
  });

  // Uniform {error} JSON for validation failures and unexpected errors.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: error.message });
    }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) app.log.error(error);
    return reply.status(status).send({ error: status >= 500 ? "internal server error" : error.message });
  });
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "not found" });
  });

  function requireUser(request: Parameters<typeof sessionUser>[1]): UserRow | null {
    return sessionUser(db, request);
  }

  function roomService(): RoomServiceClient {
    return new RoomServiceClient(env.LIVEKIT_API_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }

  async function mintToken(
    meeting: MeetingRow,
    identity: string,
    displayName: string,
    isHost: boolean,
  ): Promise<string> {
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      ttl: "6h",
    });
    at.addGrant({
      room: meeting.code,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      ...(isHost ? { roomAdmin: true, roomCreate: true } : {}),
    });
    return at.toJwt();
  }

  /**
   * Host-or-cohost authorization per contract: the meeting host, or a member
   * whose live LiveKit participant metadata has role == "cohost" (verified via
   * RoomService getParticipant on `user-<sessionUserId>`).
   */
  async function requesterRole(
    meeting: MeetingRow,
    user: UserRow,
  ): Promise<"host" | "cohost" | null> {
    if (user.id === meeting.host_user_id) return "host";
    try {
      const participant = await roomService().getParticipant(meeting.code, `user-${user.id}`);
      const metadata = participant.metadata ? JSON.parse(participant.metadata) : {};
      if (metadata && metadata.role === "cohost") return "cohost";
    } catch {
      // not in the room / unreachable / bad metadata -> not a co-host
    }
    return null;
  }

  /** Delete waiting-room entries that have not polled for 60s. */
  function pruneStaleWaiting(meetingId: string): void {
    db.prepare("DELETE FROM waiting_guests WHERE meeting_id = ? AND last_seen_at < ?").run(
      meetingId,
      Date.now() - WAITING_STALE_MS,
    );
  }

  // ---------- Auth ----------

  app.post<{ Body: { name: string; email: string; password: string } }>(
    "/api/auth/register",
    {
      ...perRoute(10),
      schema: {
        body: {
          type: "object",
          required: ["name", "email", "password"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            email: {
              type: "string",
              minLength: 3,
              maxLength: 320,
              pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
            },
            password: { type: "string", minLength: 8, maxLength: 512 },
          },
        },
        response: {
          201: { type: "object", properties: { user: userSchema } },
          409: errorReply,
        },
      },
    },
    async (request, reply) => {
      const { name, email, password } = request.body;
      const existing = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
      if (existing) return reply.status(409).send({ error: "email already registered" });

      const { hash, salt } = hashPassword(password);
      const id = randomUUID();
      try {
        db.prepare(
          "INSERT INTO users (id, name, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)",
        ).run(id, name.trim(), email.toLowerCase(), hash, salt);
      } catch (err: unknown) {
        // race on the unique email index
        if (err instanceof Error && err.message.includes("UNIQUE")) {
          return reply.status(409).send({ error: "email already registered" });
        }
        throw err;
      }
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
      setSessionCookie(reply, createSession(db, id));
      return reply.status(201).send({ user: publicUser(user) });
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    {
      ...perRoute(10),
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", minLength: 1 },
            password: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { type: "object", properties: { user: userSchema } },
          401: errorReply,
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
        | UserRow
        | undefined;
      if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
        return reply.status(401).send({ error: "invalid email or password" });
      }
      setSessionCookie(reply, createSession(db, user.id));
      return reply.status(200).send({ user: publicUser(user) });
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) destroySession(db, token);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = requireUser(request);
    if (!user) return reply.status(401).send({ error: "not authenticated" });
    return reply.status(200).send({ user: publicUser(user) });
  });

  // ---------- Meetings ----------

  app.post<{ Body: { title?: string; startsAt?: string } }>(
    "/api/meetings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 300 },
            startsAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });

      const { title, startsAt } = request.body ?? {};
      const id = randomUUID();
      const code = generateMeetingCode(db);
      db.prepare(
        "INSERT INTO meetings (id, code, title, host_user_id, starts_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, code, title?.trim() || `${user.name}'s meeting`, user.id, startsAt ?? null);
      const meeting = findMeetingById(db, id)!;
      return reply.status(201).send({ meeting: meetingJson(meeting) });
    },
  );

  app.get("/api/meetings", async (request, reply) => {
    const user = requireUser(request);
    if (!user) return reply.status(401).send({ error: "not authenticated" });
    const meetings = listMeetingsForHost(db, user.id).map(meetingJson);
    return reply.status(200).send({ meetings });
  });

  app.get<{ Params: { code: string } }>(
    "/api/meetings/:code",
    {
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });
      return reply.status(200).send({ meeting: meetingJson(meeting) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/meetings/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      const meeting = findMeetingById(db, request.params.id);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });
      if (meeting.host_user_id !== user.id) {
        return reply.status(403).send({ error: "only the host can delete a meeting" });
      }
      db.prepare("DELETE FROM meetings WHERE id = ?").run(meeting.id);
      return reply.status(204).send();
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { title?: string; startsAt?: string | null; waitingRoom?: boolean; locked?: boolean };
  }>(
    "/api/meetings/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 300 },
            startsAt: { type: ["string", "null"], format: "date-time" },
            waitingRoom: { type: "boolean" },
            locked: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      const meeting = findMeetingById(db, request.params.id);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });
      if (meeting.host_user_id !== user.id) {
        return reply.status(403).send({ error: "only the host can update a meeting" });
      }

      const body = request.body ?? {};
      if (body.title !== undefined) {
        db.prepare("UPDATE meetings SET title = ? WHERE id = ?").run(body.title.trim(), meeting.id);
      }
      if (body.startsAt !== undefined) {
        db.prepare("UPDATE meetings SET starts_at = ? WHERE id = ?").run(body.startsAt, meeting.id);
      }
      if (body.waitingRoom !== undefined) {
        db.prepare("UPDATE meetings SET waiting_room = ? WHERE id = ?").run(
          body.waitingRoom ? 1 : 0,
          meeting.id,
        );
      }
      if (body.locked !== undefined) {
        db.prepare("UPDATE meetings SET locked = ? WHERE id = ?").run(
          body.locked ? 1 : 0,
          meeting.id,
        );
      }
      return reply.status(200).send({ meeting: meetingJson(findMeetingById(db, meeting.id)!) });
    },
  );

  // ---------- Joining / LiveKit ----------

  app.post<{ Params: { code: string }; Body: { displayName: string } }>(
    "/api/meetings/:code/token",
    {
      ...perRoute(60),
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
        body: {
          type: "object",
          required: ["displayName"],
          additionalProperties: false,
          properties: { displayName: { type: "string", minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      const user = requireUser(request);
      const isHost = user !== null && user.id === meeting.host_user_id;
      const identity = user
        ? `user-${user.id}`
        : `guest-${randomBytes(6).toString("hex")}`;

      if (!isHost && meeting.locked === 1) {
        return reply.status(423).send({ error: "meeting is locked" });
      }
      if (!isHost && meeting.waiting_room === 1) {
        const waitingId = randomUUID();
        pruneStaleWaiting(meeting.id);
        db.prepare(
          `INSERT INTO waiting_guests (id, meeting_id, display_name, identity, status, last_seen_at)
           VALUES (?, ?, ?, ?, 'waiting', ?)`,
        ).run(waitingId, meeting.id, request.body.displayName, identity, Date.now());
        return reply.status(202).send({ waitingId, status: "waiting" });
      }

      const token = await mintToken(meeting, identity, request.body.displayName, isHost);
      return reply.status(200).send({ token, url: env.LIVEKIT_URL, identity, isHost });
    },
  );

  // ---------- Waiting room ----------

  app.get<{ Params: { code: string; waitingId: string } }>(
    "/api/meetings/:code/waiting/:waitingId",
    {
      ...perRoute(60),
      schema: {
        params: {
          type: "object",
          required: ["code", "waitingId"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 100 },
            waitingId: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      // Refresh this guest's lastSeenAt first so the prune never removes an
      // actively polling guest, then prune everyone who stopped polling.
      db.prepare("UPDATE waiting_guests SET last_seen_at = ? WHERE id = ? AND meeting_id = ?").run(
        Date.now(),
        request.params.waitingId,
        meeting.id,
      );
      pruneStaleWaiting(meeting.id);

      const guest = db
        .prepare("SELECT * FROM waiting_guests WHERE id = ? AND meeting_id = ?")
        .get(request.params.waitingId, meeting.id) as WaitingGuestRow | undefined;
      if (!guest) return reply.status(404).send({ error: "unknown waiting id" });

      if (guest.status === "admitted") {
        const token = await mintToken(meeting, guest.identity, guest.display_name, false);
        return reply.status(200).send({
          status: "admitted",
          token,
          url: env.LIVEKIT_URL,
          identity: guest.identity,
          isHost: false,
        });
      }
      return reply.status(200).send({ status: guest.status });
    },
  );

  app.get<{ Params: { code: string } }>(
    "/api/meetings/:code/waiting",
    {
      ...perRoute(60),
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      if ((await requesterRole(meeting, user)) === null) {
        return reply.status(403).send({ error: "host or co-host required" });
      }

      pruneStaleWaiting(meeting.id);
      const guests = (
        db
          .prepare(
            "SELECT * FROM waiting_guests WHERE meeting_id = ? AND status = 'waiting' ORDER BY created_at ASC",
          )
          .all(meeting.id) as WaitingGuestRow[]
      ).map((g) => ({ waitingId: g.id, displayName: g.display_name, requestedAt: g.created_at }));
      return reply.status(200).send({ guests });
    },
  );

  app.post<{ Params: { code: string; waitingId: string }; Body: { action: "admit" | "deny" } }>(
    "/api/meetings/:code/waiting/:waitingId",
    {
      ...perRoute(60),
      schema: {
        params: {
          type: "object",
          required: ["code", "waitingId"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 100 },
            waitingId: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
        body: {
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: { action: { type: "string", enum: ["admit", "deny"] } },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      if ((await requesterRole(meeting, user)) === null) {
        return reply.status(403).send({ error: "host or co-host required" });
      }

      pruneStaleWaiting(meeting.id);
      const guest = db
        .prepare("SELECT * FROM waiting_guests WHERE id = ? AND meeting_id = ?")
        .get(request.params.waitingId, meeting.id) as WaitingGuestRow | undefined;
      if (!guest) return reply.status(404).send({ error: "unknown waiting id" });

      db.prepare("UPDATE waiting_guests SET status = ? WHERE id = ?").run(
        request.body.action === "admit" ? "admitted" : "denied",
        guest.id,
      );
      return reply.status(204).send();
    },
  );

  // ---------- Moderation ----------

  app.post<{
    Params: { code: string };
    Body: { action: "mute" | "remove" | "promote" | "demote"; identity: string };
  }>(
    "/api/meetings/:code/moderate",
    {
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
        body: {
          type: "object",
          required: ["action", "identity"],
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["mute", "remove", "promote", "demote"] },
            identity: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      const role = await requesterRole(meeting, user);
      if (role === null) {
        return reply.status(403).send({ error: "host or co-host required" });
      }

      const { action, identity } = request.body;

      if (action === "promote" || action === "demote") {
        if (role !== "host") {
          return reply.status(403).send({ error: "only the host can promote or demote" });
        }
        if (!identity.startsWith("user-")) {
          return reply.status(403).send({ error: "guests cannot be co-hosts" });
        }
      } else if (role === "cohost") {
        // Co-hosts may mute/remove, but not the host and not themselves.
        if (identity === `user-${meeting.host_user_id}`) {
          return reply.status(403).send({ error: "co-hosts cannot moderate the host" });
        }
        if (identity === `user-${user.id}`) {
          return reply.status(403).send({ error: "co-hosts cannot moderate themselves" });
        }
      }

      const rooms = roomService();
      try {
        if (action === "remove") {
          await rooms.removeParticipant(meeting.code, identity);
        } else if (action === "promote" || action === "demote") {
          const metadata = action === "promote" ? JSON.stringify({ role: "cohost" }) : "{}";
          await rooms.updateParticipant(meeting.code, identity, metadata);
        } else {
          const participant = await rooms.getParticipant(meeting.code, identity);
          const micTrack =
            participant.tracks.find((t) => t.source === TrackSource.MICROPHONE) ??
            participant.tracks.find((t) => t.type === TrackType.AUDIO);
          if (micTrack) {
            await rooms.mutePublishedTrack(meeting.code, identity, micTrack.sid, true);
          }
        }
      } catch (err) {
        app.log.warn({ err }, "LiveKit moderation call failed");
        return reply.status(502).send({ error: "LiveKit server unreachable or rejected the request" });
      }
      return reply.status(204).send();
    },
  );

  // ---------- Persistent chat ----------

  const messageJson = (row: MessageRow) => ({
    id: row.id,
    meetingId: row.meeting_id,
    identity: row.identity,
    displayName: row.display_name,
    text: row.text,
    ts: row.ts,
  });

  app.post<{ Params: { code: string }; Body: { text: string; displayName: string } }>(
    "/api/meetings/:code/messages",
    {
      ...perRoute(60),
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
        body: {
          type: "object",
          required: ["text", "displayName"],
          additionalProperties: false,
          properties: {
            text: { type: "string", minLength: 1, maxLength: 2000 },
            displayName: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      // No session required; a session upgrades the identity to user-<id>.
      const user = requireUser(request);
      const identity = user ? `user-${user.id}` : "guest";
      const id = randomUUID();
      db.prepare(
        "INSERT INTO messages (id, meeting_id, identity, display_name, text) VALUES (?, ?, ?, ?, ?)",
      ).run(id, meeting.id, identity, request.body.displayName, request.body.text);
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow;
      return reply.status(201).send({ message: messageJson(row) });
    },
  );

  app.get<{ Params: { code: string } }>(
    "/api/meetings/:code/messages",
    {
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });
      // Last 200, returned oldest first.
      const rows = db
        .prepare(
          "SELECT * FROM messages WHERE meeting_id = ? ORDER BY ts DESC, rowid DESC LIMIT 200",
        )
        .all(meeting.id) as MessageRow[];
      return reply.status(200).send({ messages: rows.reverse().map(messageJson) });
    },
  );

  // ---------- Recording (LiveKit Egress) ----------

  type RecordingJoined = RecordingRow & {
    meeting_code: string;
    meeting_title: string;
    host_user_id: string;
  };

  const SELECT_RECORDING = `
    SELECT r.*, m.code AS meeting_code, m.title AS meeting_title, m.host_user_id
    FROM recordings r JOIN meetings m ON m.id = r.meeting_id
  `;

  const recordingJson = (row: RecordingJoined) => ({
    id: row.id,
    meetingCode: row.meeting_code,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  });

  app.post<{ Params: { code: string }; Body: { action: "start" | "stop" } }>(
    "/api/meetings/:code/recording",
    {
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
        body: {
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: { action: { type: "string", enum: ["start", "stop"] } },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      if ((await requesterRole(meeting, user)) === null) {
        return reply.status(403).send({ error: "host or co-host required" });
      }
      if (!env.EGRESS_ENABLED) {
        return reply.status(503).send({ error: "recording is not enabled on this server" });
      }

      const egress = new EgressClient(env.LIVEKIT_API_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
      const active = db
        .prepare(`${SELECT_RECORDING} WHERE r.meeting_id = ? AND r.ended_at IS NULL`)
        .get(meeting.id) as RecordingJoined | undefined;

      if (request.body.action === "start") {
        if (active) return reply.status(409).send({ error: "already recording" });
        await mkdir(recordingsDir, { recursive: true });
        const startedAt = new Date().toISOString();
        // The egress container writes to /out (a shared volume with RECORDINGS_DIR).
        const fileName = `${meeting.code}-${startedAt.replace(/[:.]/g, "-")}.mp4`;
        let egressId: string;
        try {
          const info = await egress.startRoomCompositeEgress(meeting.code, {
            file: new EncodedFileOutput({ filepath: `/out/${fileName}` }),
          });
          egressId = info.egressId;
        } catch (err) {
          app.log.warn({ err }, "egress start failed");
          return reply.status(503).send({ error: "egress unreachable or rejected the request" });
        }
        const id = randomUUID();
        db.prepare(
          "INSERT INTO recordings (id, meeting_id, egress_id, file_name, started_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL)",
        ).run(id, meeting.id, egressId, fileName, startedAt);
        const row = db.prepare(`${SELECT_RECORDING} WHERE r.id = ?`).get(id) as RecordingJoined;
        return reply.status(201).send({ recording: recordingJson(row) });
      }

      // stop
      if (!active) return reply.status(409).send({ error: "not recording" });
      try {
        await egress.stopEgress(active.egress_id);
      } catch (err) {
        // If the egress no longer exists (crashed, restarted, already ended),
        // finalize the recording anyway — otherwise the meeting is stuck in
        // "recording" state with no way to clear it.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not found|does not exist|already|ended|aborted|failed|complete|cannot be stopped/i.test(msg)) {
          app.log.warn({ err }, "egress stop failed");
          return reply.status(503).send({ error: "egress unreachable or rejected the request" });
        }
        app.log.warn({ err }, "egress already gone; finalizing recording row");
      }
      const endedAt = new Date().toISOString();
      db.prepare("UPDATE recordings SET ended_at = ? WHERE id = ?").run(endedAt, active.id);
      const row = db.prepare(`${SELECT_RECORDING} WHERE r.id = ?`).get(active.id) as RecordingJoined;
      return reply.status(200).send({ recording: recordingJson(row) });
    },
  );

  app.get("/api/recordings", async (request, reply) => {
    const user = requireUser(request);
    if (!user) return reply.status(401).send({ error: "not authenticated" });
    const rows = db
      .prepare(`${SELECT_RECORDING} WHERE m.host_user_id = ? ORDER BY r.started_at DESC`)
      .all(user.id) as RecordingJoined[];
    const recordings = await Promise.all(
      rows.map(async (row) => {
        let sizeBytes: number | null = null;
        try {
          sizeBytes = (await stat(join(recordingsDir, row.file_name))).size;
        } catch {
          // file missing (still recording, pruned, or egress writing elsewhere)
        }
        return {
          id: row.id,
          meetingCode: row.meeting_code,
          title: row.meeting_title,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          sizeBytes,
        };
      }),
    );
    return reply.status(200).send({ recordings });
  });

  function findRecordingForHost(id: string, userId: string, reply: FastifyReply) {
    const row = db.prepare(`${SELECT_RECORDING} WHERE r.id = ?`).get(id) as
      | RecordingJoined
      | undefined;
    if (!row) {
      reply.status(404).send({ error: "recording not found" });
      return null;
    }
    if (row.host_user_id !== userId) {
      reply.status(403).send({ error: "only the host can access this recording" });
      return null;
    }
    return row;
  }

  app.get<{ Params: { id: string } }>(
    "/api/recordings/:id/file",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      const row = findRecordingForHost(request.params.id, user.id, reply);
      if (!row) return reply;

      const filePath = join(recordingsDir, row.file_name);
      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        return reply.status(404).send({ error: "recording file not found" });
      }
      const size = fileStat.size;
      reply.header("accept-ranges", "bytes").type("video/mp4");

      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start: number;
        let end: number;
        if (match && match[2] !== "" && match[1] === "") {
          // suffix range: last N bytes
          start = Math.max(0, size - Number(match[2]));
          end = size - 1;
        } else if (match && match[1] !== "") {
          start = Number(match[1]);
          end = match[2] !== "" ? Math.min(Number(match[2]), size - 1) : size - 1;
        } else {
          start = NaN;
          end = NaN;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
          return reply
            .status(416)
            .header("content-range", `bytes */${size}`)
            .send({ error: "invalid range" });
        }
        return reply
          .status(206)
          .header("content-range", `bytes ${start}-${end}/${size}`)
          .header("content-length", end - start + 1)
          .send(createReadStream(filePath, { start, end }));
      }

      return reply.status(200).header("content-length", size).send(createReadStream(filePath));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/recordings/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!user) return reply.status(401).send({ error: "not authenticated" });
      const row = findRecordingForHost(request.params.id, user.id, reply);
      if (!row) return reply;

      db.prepare("DELETE FROM recordings WHERE id = ?").run(row.id);
      try {
        await unlink(join(recordingsDir, row.file_name));
      } catch {
        // file already gone — row deletion is what matters
      }
      return reply.status(204).send();
    },
  );

  return app;
}
