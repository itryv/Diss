import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readdir, stat, statfs, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  type AdminAuditRow,
  type BreakoutRow,
  type MeetingRow,
  type MessageRow,
  type RecordingRow,
  type UserRow,
  type WaitingGuestRow,
} from "./db.js";
import { mintChatToken, verifyChatToken } from "./chatToken.js";
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
import {
  auditJson,
  deleteMeetingsCascade,
  isAdminEmail,
  meetingIdsForHost,
  parseAdminEmails,
  readSettings,
  recordingFilesForMeetings,
  writeAudit,
  writeSettings,
  type AdminSettings,
} from "./admin.js";

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

/** Every /api/admin/* route: 120 requests per rate-limit window per IP. */
const ADMIN_RATE_LIMIT = 120;

/**
 * Hard ceiling on any LiveKit round trip made by an admin route. An admin
 * dashboard must never hang on an unreachable media server, so the calls race
 * against this and degrade to `reachable: false`.
 */
const LIVEKIT_TIMEOUT_MS = Number(process.env.LIVEKIT_TIMEOUT_MS ?? 3000);

function perRoute(max: number) {
  return { config: { rateLimit: { max } } };
}

const adminPagination = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    offset: { type: "integer", minimum: 0, default: 0 },
  },
} as const;

function livekitErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.includes("timed out")) {
    return "LiveKit request timed out";
  }
  return "LiveKit server unreachable or rejected the request";
}

/** Races a LiveKit call against LIVEKIT_TIMEOUT_MS. */
async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), LIVEKIT_TIMEOUT_MS);
    timer.unref?.();
  });
  // The loser of the race must not surface as an unhandled rejection.
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `<code>__b<idx>` breakout rooms belong to the meeting with the base code. */
function baseRoomCode(roomName: string): string {
  const marker = roomName.indexOf("__b");
  return marker === -1 ? roomName : roomName.slice(0, marker);
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    try {
      const info = await stat(join(dir, entry));
      if (info.isFile()) total += info.size;
    } catch {
      // raced with a delete — skip
    }
  }
  return total;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function buildServer(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const db = openDb(env.DATABASE_PATH);
  const recordingsDir = resolve(env.RECORDINGS_DIR);
  const databaseFile = resolve(env.DATABASE_PATH);
  const serverStartedAt = new Date().toISOString();
  /** Derived once per boot: changing the admin list is a config change + restart. */
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);

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
    const user = sessionUser(db, request);
    // Belt and braces: disabling a user deletes their sessions, but a session
    // created in the same instant must not survive either.
    if (!user || user.disabled === 1) return null;
    return user;
  }

  function isAdmin(user: UserRow): boolean {
    return isAdminEmail(adminEmails, user.email);
  }

  /**
   * Contract §0: an /api/admin/* route needs a valid session whose user is an
   * admin. Anything else — no session, disabled, non-admin — is 403, not 401,
   * so the admin surface does not advertise itself.
   */
  function requireAdmin(
    request: Parameters<typeof sessionUser>[1],
    reply: FastifyReply,
  ): UserRow | null {
    const user = requireUser(request);
    if (!user || !isAdmin(user)) {
      reply.status(403).send({ error: "admin access required" });
      return null;
    }
    return user;
  }

  function roomService(): RoomServiceClient {
    return new RoomServiceClient(env.LIVEKIT_API_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }

  type LiveRoom = Awaited<ReturnType<RoomServiceClient["listRooms"]>>[number];
  type LiveParticipant = Awaited<ReturnType<RoomServiceClient["listParticipants"]>>[number];

  /** Active rooms, or `reachable:false` + an error string. Never throws. */
  async function listLiveRooms(): Promise<{
    reachable: boolean;
    rooms: LiveRoom[];
    error?: string;
  }> {
    try {
      const rooms = await withTimeout(roomService().listRooms(), "LiveKit listRooms");
      return { reachable: true, rooms };
    } catch (err) {
      app.log.warn({ err }, "LiveKit listRooms failed");
      return { reachable: false, rooms: [], error: livekitErrorMessage(err) };
    }
  }

  /**
   * The room-wide host controls, expressed as LiveKit publish permissions for a
   * NON-host participant. Restricting `canPublishSources` supersedes
   * `canPublish`, so a denied source genuinely cannot be published — the point
   * of v4 §2: a UI-only toggle is not a control.
   */
  function publishPermission(meeting: MeetingRow): {
    canPublish: boolean;
    canSubscribe: boolean;
    canPublishData: boolean;
    canPublishSources: TrackSource[];
  } {
    const sources: TrackSource[] = [TrackSource.CAMERA];
    if (meeting.allow_unmute !== 0) sources.push(TrackSource.MICROPHONE);
    if (meeting.allow_share !== 0) {
      sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
    }
    return {
      canPublish: true,
      canSubscribe: true,
      canPublishData: meeting.allow_chat !== 0,
      canPublishSources: sources,
    };
  }

  async function mintToken(
    meeting: MeetingRow,
    identity: string,
    displayName: string,
    isHost: boolean,
    room: string = meeting.code,
  ): Promise<string> {
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      ttl: "6h",
    });
    const unrestricted =
      meeting.allow_share !== 0 && meeting.allow_chat !== 0 && meeting.allow_unmute !== 0;
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Hosts are never restricted. Unrestricted meetings keep the v1 grant
      // shape (no canPublishSources) so nothing changes for existing rooms.
      ...(isHost || unrestricted ? {} : publishPermission(meeting)),
      ...(isHost ? { roomAdmin: true, roomCreate: true } : {}),
    });
    return at.toJwt();
  }

  function chatTokenFor(meeting: MeetingRow, identity: string, displayName: string): string {
    return mintChatToken(env.SESSION_SECRET, meeting.id, identity, displayName);
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

  function participantRole(metadata: string | undefined): string | undefined {
    if (!metadata) return undefined;
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed.role === "string" ? parsed.role : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * v4 §2: a permission change must apply to people already in the room, so
   * push the new permissions to every non-host participant with RoomService
   * `updateParticipant`. Degrades gracefully — an unreachable LiveKit is
   * reported in the response, it does not fail the PATCH.
   */
  async function applyLivePermissions(
    meeting: MeetingRow,
  ): Promise<{ applied: number; error?: string }> {
    const hostIdentity = `user-${meeting.host_user_id}`;
    const permission = publishPermission(meeting);
    try {
      const rooms = roomService();
      const participants = await rooms.listParticipants(meeting.code);
      let applied = 0;
      for (const participant of participants) {
        // Hosts and co-hosts are moderators; the room-wide defaults are for
        // everyone else.
        if (participant.identity === hostIdentity) continue;
        if (participantRole(participant.metadata) === "cohost") continue;
        await rooms.updateParticipant(meeting.code, participant.identity, undefined, permission);
        applied++;
      }
      return { applied };
    } catch (err) {
      app.log.warn({ err }, "live permission update failed");
      return {
        applied: 0,
        error: "LiveKit server unreachable or rejected the request",
      };
    }
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
          403: errorReply,
          409: errorReply,
        },
      },
    },
    async (request, reply) => {
      // Admin §6: registrationOpen is the switch that closes the live site.
      if (!readSettings(db).registrationOpen) {
        return reply.status(403).send({ error: "registration is closed" });
      }
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
      if (user.disabled === 1) {
        return reply.status(401).send({ error: "account is disabled" });
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
    // `isAdmin` is exposed both at the top level and on the user object: the
    // contract writes `me.isAdmin` and clients disagree about whether `me` is
    // the envelope or the user, so both readings are true.
    const admin = isAdmin(user);
    return reply.status(200).send({ user: { ...publicUser(user), isAdmin: admin }, isAdmin: admin });
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
      // Admin §6: the default* settings seed a NEWLY created meeting. Existing
      // meetings are untouched.
      const settings = readSettings(db);
      db.prepare(
        `INSERT INTO meetings
           (id, code, title, host_user_id, starts_at, waiting_room, allow_share, allow_chat, allow_unmute)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        code,
        title?.trim() || `${user.name}'s meeting`,
        user.id,
        startsAt ?? null,
        settings.defaultWaitingRoom ? 1 : 0,
        settings.defaultAllowShare ? 1 : 0,
        settings.defaultAllowChat ? 1 : 0,
        settings.defaultAllowUnmute ? 1 : 0,
      );
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
    Body: {
      title?: string;
      startsAt?: string | null;
      waitingRoom?: boolean;
      locked?: boolean;
      allowShare?: boolean;
      allowChat?: boolean;
      allowUnmute?: boolean;
    };
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
            allowShare: { type: "boolean" },
            allowChat: { type: "boolean" },
            allowUnmute: { type: "boolean" },
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
      const permissionFields = [
        ["allowShare", "allow_share"],
        ["allowChat", "allow_chat"],
        ["allowUnmute", "allow_unmute"],
      ] as const;
      let permissionsChanged = false;
      for (const [key, column] of permissionFields) {
        const value = body[key];
        if (value === undefined) continue;
        db.prepare(`UPDATE meetings SET ${column} = ? WHERE id = ?`).run(
          value ? 1 : 0,
          meeting.id,
        );
        permissionsChanged = true;
      }

      const updated = findMeetingById(db, meeting.id)!;
      if (permissionsChanged) {
        const liveUpdate = await applyLivePermissions(updated);
        return reply.status(200).send({ meeting: meetingJson(updated), liveUpdate });
      }
      return reply.status(200).send({ meeting: meetingJson(updated) });
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
      return reply.status(200).send({
        token,
        url: env.LIVEKIT_URL,
        identity,
        isHost,
        chatToken: chatTokenFor(meeting, identity, request.body.displayName),
      });
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
          chatToken: chatTokenFor(meeting, guest.identity, guest.display_name),
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
    Body: {
      action: "mute" | "remove" | "promote" | "demote" | "allow-share" | "deny-share";
      identity: string;
    };
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
            action: {
              type: "string",
              enum: ["mute", "remove", "promote", "demote", "allow-share", "deny-share"],
            },
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
        } else if (action === "allow-share" || action === "deny-share") {
          // Per-person override on top of the room-wide defaults: the other
          // sources still follow the meeting's allowUnmute/allowChat settings.
          const base = publishPermission(meeting);
          const sources: TrackSource[] = base.canPublishSources.filter(
            (s) => s !== TrackSource.SCREEN_SHARE && s !== TrackSource.SCREEN_SHARE_AUDIO,
          );
          if (action === "allow-share") {
            sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
          }
          await rooms.updateParticipant(meeting.code, identity, undefined, {
            ...base,
            canPublishSources: sources,
          });
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

  const messageJson = (row: MessageRow) => {
    let mentions: string[] = [];
    try {
      const parsed = JSON.parse(row.mentions ?? "[]");
      if (Array.isArray(parsed)) mentions = parsed.filter((m) => typeof m === "string");
    } catch {
      // a hand-edited row shouldn't take the whole history down
    }
    return {
      id: row.id,
      meetingId: row.meeting_id,
      identity: row.identity,
      displayName: row.display_name,
      text: row.text,
      ts: row.ts,
      toIdentity: row.to_identity,
      mentions,
    };
  };

  app.post<{
    Params: { code: string };
    Body: {
      chatToken: string;
      text: string;
      toIdentity?: string;
      mentions?: string[];
      // Accepted for backwards compatibility and deliberately IGNORED — the
      // sender's identity comes from the chatToken, never from the body.
      displayName?: string;
      identity?: string;
    };
  }>(
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
          required: ["chatToken", "text"],
          additionalProperties: false,
          properties: {
            chatToken: { type: "string", minLength: 1, maxLength: 4096 },
            text: { type: "string", minLength: 1, maxLength: 2000 },
            toIdentity: { type: "string", minLength: 1, maxLength: 300 },
            mentions: {
              type: "array",
              maxItems: 50,
              items: { type: "string", minLength: 1, maxLength: 300 },
            },
            displayName: { type: "string", maxLength: 200 },
            identity: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      const caller = verifyChatToken(env.SESSION_SECRET, request.body.chatToken, meeting.id);
      if (!caller) return reply.status(401).send({ error: "invalid chat token" });

      const id = randomUUID();
      db.prepare(
        `INSERT INTO messages (id, meeting_id, identity, display_name, text, to_identity, mentions)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        meeting.id,
        caller.identity,
        caller.displayName,
        request.body.text,
        request.body.toIdentity ?? null,
        JSON.stringify(request.body.mentions ?? []),
      );
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow;
      return reply.status(201).send({ message: messageJson(row) });
    },
  );

  app.get<{ Params: { code: string }; Querystring: { chatToken?: string } }>(
    "/api/meetings/:code/messages",
    {
      ...perRoute(60),
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 100 } },
        },
        querystring: {
          type: "object",
          properties: { chatToken: { type: "string", maxLength: 4096 } },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      const caller = verifyChatToken(env.SESSION_SECRET, request.query.chatToken, meeting.id);
      if (!caller) return reply.status(401).send({ error: "invalid chat token" });

      // Last 200 the caller may see — every public message plus the DMs they
      // sent or received — returned oldest first.
      const rows = db
        .prepare(
          `SELECT * FROM messages
           WHERE meeting_id = ?
             AND (to_identity IS NULL OR to_identity = ? OR identity = ?)
           ORDER BY ts DESC, rowid DESC LIMIT 200`,
        )
        .all(meeting.id, caller.identity, caller.identity) as MessageRow[];
      return reply.status(200).send({ messages: rows.reverse().map(messageJson) });
    },
  );

  // ---------- Breakout rooms ----------

  /** LiveKit room name for breakout `idx` of meeting `code` (contract v4 §3). */
  const breakoutRoom = (code: string, idx: number) => `${code}__b${idx}`;

  const openBreakouts = (meetingId: string) =>
    db
      .prepare(
        "SELECT * FROM breakouts WHERE meeting_id = ? AND closed_at IS NULL ORDER BY idx ASC",
      )
      .all(meetingId) as BreakoutRow[];

  function breakoutsPayload(meetingId: string) {
    const rooms = openBreakouts(meetingId);
    const assignments = db.prepare(
      "SELECT identity, display_name FROM breakout_assignments WHERE breakout_id = ? ORDER BY rowid ASC",
    );
    return rooms.map((b) => ({
      id: b.id,
      idx: b.idx,
      name: b.name,
      participants: (
        assignments.all(b.id) as { identity: string; display_name: string }[]
      ).map((a) => ({ identity: a.identity, displayName: a.display_name })),
    }));
  }

  /**
   * Best-effort display name for an assigned identity: the contract's create
   * body carries identities only, but the assignments table stores a name.
   */
  function knownDisplayName(meetingId: string, identity: string): string {
    const fromWaiting = db
      .prepare(
        "SELECT display_name FROM waiting_guests WHERE meeting_id = ? AND identity = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(meetingId, identity) as { display_name: string } | undefined;
    if (fromWaiting) return fromWaiting.display_name;
    const fromMessage = db
      .prepare(
        "SELECT display_name FROM messages WHERE meeting_id = ? AND identity = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(meetingId, identity) as { display_name: string } | undefined;
    if (fromMessage) return fromMessage.display_name;
    if (identity.startsWith("user-")) {
      const user = db
        .prepare("SELECT name FROM users WHERE id = ?")
        .get(identity.slice("user-".length)) as { name: string } | undefined;
      if (user) return user.name;
    }
    return identity;
  }

  app.post<{
    Params: { code: string };
    Body: { rooms: { name: string; identities: string[] }[] };
  }>(
    "/api/meetings/:code/breakouts",
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
          required: ["rooms"],
          additionalProperties: false,
          properties: {
            rooms: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: {
                type: "object",
                required: ["name", "identities"],
                additionalProperties: false,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200 },
                  identities: {
                    type: "array",
                    maxItems: 200,
                    items: { type: "string", minLength: 1, maxLength: 300 },
                  },
                },
              },
            },
          },
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

      const rooms = request.body.rooms;
      db.transaction(() => {
        // "Replaces any open set" — the previous rooms are closed, not deleted,
        // so their history stays and stale clients can't rejoin them.
        db.prepare(
          "UPDATE breakouts SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE meeting_id = ? AND closed_at IS NULL",
        ).run(meeting.id);
        const insertBreakout = db.prepare(
          "INSERT INTO breakouts (id, meeting_id, idx, name) VALUES (?, ?, ?, ?)",
        );
        const insertAssignment = db.prepare(
          "INSERT OR REPLACE INTO breakout_assignments (breakout_id, identity, display_name) VALUES (?, ?, ?)",
        );
        rooms.forEach((room, idx) => {
          const id = randomUUID();
          insertBreakout.run(id, meeting.id, idx, room.name.trim());
          for (const identity of room.identities ?? []) {
            insertAssignment.run(id, identity, knownDisplayName(meeting.id, identity));
          }
        });
      })();

      return reply.status(201).send({ breakouts: breakoutsPayload(meeting.id) });
    },
  );

  app.get<{ Params: { code: string } }>(
    "/api/meetings/:code/breakouts",
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
      const breakouts = breakoutsPayload(meeting.id);
      return reply.status(200).send({ breakouts, open: breakouts.length > 0 });
    },
  );

  app.post<{ Params: { code: string }; Body: { chatToken: string; idx?: number } }>(
    "/api/meetings/:code/breakouts/token",
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
          required: ["chatToken"],
          additionalProperties: false,
          properties: {
            chatToken: { type: "string", minLength: 1, maxLength: 4096 },
            idx: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request, reply) => {
      const meeting = findMeetingByCode(db, request.params.code);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      const caller = verifyChatToken(env.SESSION_SECRET, request.body.chatToken, meeting.id);
      if (!caller) return reply.status(401).send({ error: "invalid chat token" });

      const isHost = caller.identity === `user-${meeting.host_user_id}`;
      const rooms = openBreakouts(meeting.id);
      if (rooms.length === 0) {
        return reply.status(404).send({ error: "no open breakout rooms" });
      }

      // Server-authoritative: the host may visit any room, everyone else only
      // gets a token for the room they were assigned to.
      let target: BreakoutRow | undefined;
      if (isHost && request.body.idx !== undefined) {
        target = rooms.find((b) => b.idx === request.body.idx);
      } else {
        const assigned = db
          .prepare(
            `SELECT b.* FROM breakouts b
             JOIN breakout_assignments a ON a.breakout_id = b.id
             WHERE b.meeting_id = ? AND b.closed_at IS NULL AND a.identity = ?
             ORDER BY b.idx ASC LIMIT 1`,
          )
          .get(meeting.id, caller.identity) as BreakoutRow | undefined;
        if (assigned && request.body.idx !== undefined && assigned.idx !== request.body.idx) {
          return reply.status(404).send({ error: "not assigned to that breakout room" });
        }
        target = assigned;
      }
      if (!target) return reply.status(404).send({ error: "not assigned to a breakout room" });

      const room = breakoutRoom(meeting.code, target.idx);
      const token = await mintToken(meeting, caller.identity, caller.displayName, isHost, room);
      return reply
        .status(200)
        .send({ token, url: env.LIVEKIT_URL, room, breakoutName: target.name });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/meetings/:code/breakouts/close",
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
      db.prepare(
        "UPDATE breakouts SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE meeting_id = ? AND closed_at IS NULL",
      ).run(meeting.id);
      return reply.status(204).send();
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
        // The egress container shares this directory as /out but runs as a
        // non-root user (uid 1001, gid 0). A directory created by root with
        // the default 0755 leaves it unwritable, and egress only discovers
        // that at the very END of a recording — it composites the whole
        // session, then dies with "permission denied" and the recording is
        // lost. Group-writable keeps that from ever happening.
        await chmod(recordingsDir, 0o775).catch(() => {
          /* non-fatal: e.g. the dir is owned by another user on some hosts */
        });
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

  /**
   * The host of the recording's meeting may always access it. Admins may too
   * (contract §5) — the host path is unchanged.
   */
  function findRecordingForHost(id: string, user: UserRow, reply: FastifyReply) {
    const row = db.prepare(`${SELECT_RECORDING} WHERE r.id = ?`).get(id) as
      | RecordingJoined
      | undefined;
    if (!row) {
      reply.status(404).send({ error: "recording not found" });
      return null;
    }
    if (row.host_user_id !== user.id && !isAdmin(user)) {
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
      const row = findRecordingForHost(request.params.id, user, reply);
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
      const row = findRecordingForHost(request.params.id, user, reply);
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

  // ================= Admin (docs/api-contract-admin.md) =================

  /**
   * Removes recording files for rows that have already been deleted. The
   * filesystem is not transactional, so this always runs AFTER the DB
   * transaction has committed: a failed unlink leaves a stray file, never an
   * orphan row.
   */
  async function unlinkRecordingFiles(fileNames: string[]): Promise<void> {
    for (const name of fileNames) {
      try {
        await unlink(join(recordingsDir, name));
      } catch {
        // already gone / never written by egress
      }
    }
  }

  type AdminUserRow = UserRow & { meeting_count: number; last_seen_at: string | null };

  const adminUserJson = (row: AdminUserRow) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    isAdmin: isAdminEmail(adminEmails, row.email),
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    meetingCount: row.meeting_count,
    // No `last_seen_at` column exists on users; the newest session is the best
    // available signal and needs no extra write path.
    lastSeenAt: row.last_seen_at,
  });

  const SELECT_ADMIN_USER = `
    SELECT u.*,
      (SELECT COUNT(*) FROM meetings m WHERE m.host_user_id = u.id) AS meeting_count,
      (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
    FROM users u
  `;

  function loadAdminUser(id: string): AdminUserRow | undefined {
    return db.prepare(`${SELECT_ADMIN_USER} WHERE u.id = ?`).get(id) as AdminUserRow | undefined;
  }

  /**
   * Guard rails: an admin may not disable or delete an admin or themselves.
   * The admin test is on the email and case-insensitive, so `Admin@x.com`
   * cannot be used to slip past a list containing `admin@x.com`.
   */
  function protectedTarget(actor: UserRow, target: UserRow): string | null {
    if (target.id === actor.id) return "you cannot do this to your own account";
    if (isAdminEmail(adminEmails, target.email)) return "cannot modify another admin";
    return null;
  }

  // ---------- §1 Overview ----------

  app.get("/api/admin/overview", perRoute(ADMIN_RATE_LIMIT), async (request, reply) => {
    const actor = requireAdmin(request, reply);
    if (!actor) return reply;

    const users = db.prepare("SELECT email, disabled FROM users").all() as {
      email: string;
      disabled: number;
    }[];
    const meetings = db
      .prepare("SELECT code, starts_at FROM meetings")
      .all() as { code: string; starts_at: string | null }[];
    const recordingFiles = (
      db.prepare("SELECT file_name FROM recordings").all() as { file_name: string }[]
    ).map((r) => r.file_name);
    const messageCount = (
      db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }
    ).n;

    const live = await listLiveRooms();
    const liveCodes = new Set(live.rooms.map((r) => baseRoomCode(r.name)));

    let recordingBytes = 0;
    for (const name of recordingFiles) {
      recordingBytes += await fileSize(join(recordingsDir, name));
    }

    const dbBytes =
      (await fileSize(databaseFile)) +
      (await fileSize(`${databaseFile}-wal`)) +
      (await fileSize(`${databaseFile}-shm`));
    const recordingsBytes = await directorySize(recordingsDir);
    let diskFreeBytes = 0;
    try {
      const fs = await statfs(dirname(databaseFile));
      diskFreeBytes = Number(fs.bavail) * Number(fs.bsize);
    } catch {
      // statfs unsupported on this platform/filesystem — report 0 rather than 500
    }

    return reply.status(200).send({
      users: {
        total: users.length,
        disabled: users.filter((u) => u.disabled === 1).length,
        admins: users.filter((u) => isAdminEmail(adminEmails, u.email)).length,
      },
      meetings: {
        total: meetings.length,
        scheduled: meetings.filter((m) => m.starts_at !== null).length,
        live: meetings.filter((m) => liveCodes.has(m.code)).length,
      },
      recordings: { count: recordingFiles.length, bytes: recordingBytes },
      messages: { total: messageCount },
      storage: { dbBytes, recordingsBytes, diskFreeBytes },
      livekit: {
        reachable: live.reachable,
        rooms: live.rooms.length,
        participants: live.rooms.reduce((sum, r) => sum + Number(r.numParticipants ?? 0), 0),
        ...(live.error ? { error: live.error } : {}),
      },
      server: {
        uptimeS: Math.floor(process.uptime()),
        nodeVersion: process.version,
        startedAt: serverStartedAt,
      },
    });
  });

  // ---------- §2 Users ----------

  app.get<{ Querystring: { q?: string; limit?: number; offset?: number } }>(
    "/api/admin/users",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        querystring: {
          ...adminPagination,
          properties: {
            ...adminPagination.properties,
            q: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;

      const { q, limit = 50, offset = 0 } = request.query;
      const term = (q ?? "").trim().toLowerCase();
      const where = term ? "WHERE lower(u.name) LIKE ? OR lower(u.email) LIKE ?" : "";
      const args = term ? [`%${term}%`, `%${term}%`] : [];

      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).get(...args) as { n: number }
      ).n;
      const rows = db
        .prepare(`${SELECT_ADMIN_USER} ${where} ORDER BY u.created_at DESC, u.rowid DESC LIMIT ? OFFSET ?`)
        .all(...args, limit, offset) as AdminUserRow[];

      return reply.status(200).send({ users: rows.map(adminUserJson), total });
    },
  );

  app.patch<{ Params: { id: string }; Body: { disabled: boolean } }>(
    "/api/admin/users/:id",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
        body: {
          type: "object",
          required: ["disabled"],
          additionalProperties: false,
          properties: { disabled: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;

      const target = loadAdminUser(request.params.id);
      if (!target) return reply.status(404).send({ error: "user not found" });
      const blocked = protectedTarget(actor, target);
      if (blocked) return reply.status(400).send({ error: blocked });

      const disabled = request.body.disabled;
      db.transaction(() => {
        db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, target.id);
        // Disabling must take effect immediately, not at session expiry.
        if (disabled) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        writeAudit(db, actor, disabled ? "user.disable" : "user.enable", "user", target.id, {
          email: target.email,
          disabled,
        });
      })();

      return reply.status(200).send({ user: adminUserJson(loadAdminUser(target.id)!) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/users/:id",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;

      const target = loadAdminUser(request.params.id);
      if (!target) return reply.status(404).send({ error: "user not found" });
      const blocked = protectedTarget(actor, target);
      if (blocked) return reply.status(400).send({ error: blocked });

      const meetingIds = meetingIdsForHost(db, target.id);
      const files = recordingFilesForMeetings(db, meetingIds);

      db.transaction(() => {
        deleteMeetingsCascade(db, meetingIds);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
        writeAudit(db, actor, "user.delete", "user", target.id, {
          email: target.email,
          meetings: meetingIds.length,
          recordings: files.length,
        });
      })();

      await unlinkRecordingFiles(files);
      return reply.status(204).send();
    },
  );

  // ---------- §3 Meetings ----------

  type AdminMeetingRow = MeetingRow & {
    host_name: string;
    host_email: string;
    message_count: number;
    recording_count: number;
  };

  const SELECT_ADMIN_MEETING = `
    SELECT m.*, u.name AS host_name, u.email AS host_email,
      (SELECT COUNT(*) FROM messages x WHERE x.meeting_id = m.id) AS message_count,
      (SELECT COUNT(*) FROM recordings r WHERE r.meeting_id = m.id) AS recording_count
    FROM meetings m JOIN users u ON u.id = m.host_user_id
  `;

  app.get<{ Querystring: { q?: string; live?: string; limit?: number; offset?: number } }>(
    "/api/admin/meetings",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        querystring: {
          ...adminPagination,
          properties: {
            ...adminPagination.properties,
            q: { type: "string", maxLength: 200 },
            live: { type: "string", maxLength: 10 },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;

      const { q, live, limit = 50, offset = 0 } = request.query;
      const term = (q ?? "").trim().toLowerCase();
      const where = term ? "WHERE lower(m.code) LIKE ? OR lower(m.title) LIKE ?" : "";
      const args = term ? [`%${term}%`, `%${term}%`] : [];
      const rows = db
        .prepare(`${SELECT_ADMIN_MEETING} ${where} ORDER BY m.created_at DESC, m.rowid DESC`)
        .all(...args) as AdminMeetingRow[];

      // "live" is LiveKit state, so it is resolved after the SQL filter; an
      // unreachable LiveKit simply means nothing is live, never a 500.
      const liveRooms = await listLiveRooms();
      const participantsByCode = new Map<string, number>();
      for (const room of liveRooms.rooms) {
        const code = baseRoomCode(room.name);
        participantsByCode.set(
          code,
          (participantsByCode.get(code) ?? 0) + Number(room.numParticipants ?? 0),
        );
      }

      const decorated = rows.map((row) => ({
        ...meetingJson(row),
        hostName: row.host_name,
        hostEmail: row.host_email,
        live: participantsByCode.has(row.code),
        participantCount: participantsByCode.get(row.code) ?? 0,
        messageCount: row.message_count,
        recordingCount: row.recording_count,
      }));
      const filtered =
        live === "1" || live === "true" ? decorated.filter((m) => m.live) : decorated;

      return reply.status(200).send({
        meetings: filtered.slice(offset, offset + limit),
        total: filtered.length,
        livekit: {
          reachable: liveRooms.reachable,
          ...(liveRooms.error ? { error: liveRooms.error } : {}),
        },
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/meetings/:id",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;
      const meeting = findMeetingById(db, request.params.id);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      // Best effort: an unreachable LiveKit must not block the deletion.
      const live = await listLiveRooms();
      for (const room of live.rooms) {
        if (baseRoomCode(room.name) !== meeting.code) continue;
        try {
          await withTimeout(roomService().deleteRoom(room.name), "LiveKit deleteRoom");
        } catch (err) {
          app.log.warn({ err }, "deleting the live room before meeting delete failed");
        }
      }

      const files = recordingFilesForMeetings(db, [meeting.id]);
      db.transaction(() => {
        deleteMeetingsCascade(db, [meeting.id]);
        writeAudit(db, actor, "meeting.delete", "meeting", meeting.id, {
          code: meeting.code,
          title: meeting.title,
          recordings: files.length,
        });
      })();

      await unlinkRecordingFiles(files);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/meetings/:id/end",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;
      const meeting = findMeetingById(db, request.params.id);
      if (!meeting) return reply.status(404).send({ error: "meeting not found" });

      const live = await listLiveRooms();
      if (!live.reachable) {
        return reply.status(502).send({ error: live.error ?? "LiveKit server unreachable" });
      }
      const rooms = live.rooms.filter((r) => baseRoomCode(r.name) === meeting.code);
      if (rooms.length === 0) return reply.status(409).send({ error: "meeting is not live" });

      try {
        for (const room of rooms) {
          await withTimeout(roomService().deleteRoom(room.name), "LiveKit deleteRoom");
        }
      } catch (err) {
        app.log.warn({ err }, "admin meeting end failed");
        return reply.status(502).send({ error: livekitErrorMessage(err) });
      }
      writeAudit(db, actor, "meeting.end", "meeting", meeting.id, {
        code: meeting.code,
        rooms: rooms.map((r) => r.name),
      });
      return reply.status(204).send();
    },
  );

  // ---------- §4 Live rooms ----------

  app.get("/api/admin/live", perRoute(ADMIN_RATE_LIMIT), async (request, reply) => {
    const actor = requireAdmin(request, reply);
    if (!actor) return reply;

    const live = await listLiveRooms();
    if (!live.reachable) {
      return reply.status(200).send({ rooms: [], reachable: false, error: live.error });
    }

    const byCode = new Map(
      (
        db.prepare("SELECT code, title, host_user_id FROM meetings").all() as {
          code: string;
          title: string;
          host_user_id: string;
        }[]
      ).map((m) => [m.code, m]),
    );
    const hostNames = new Map(
      (db.prepare("SELECT id, name FROM users").all() as { id: string; name: string }[]).map(
        (u) => [u.id, u.name],
      ),
    );

    const rooms = [];
    for (const room of live.rooms) {
      const code = baseRoomCode(room.name);
      const meeting = byCode.get(code);
      let participants: LiveParticipant[] = [];
      try {
        participants = await withTimeout(
          roomService().listParticipants(room.name),
          "LiveKit listParticipants",
        );
      } catch (err) {
        app.log.warn({ err }, "listing participants failed");
      }
      rooms.push({
        name: room.name,
        meetingCode: meeting ? code : null,
        meetingTitle: meeting?.title ?? null,
        hostName: meeting ? (hostNames.get(meeting.host_user_id) ?? null) : null,
        numParticipants: Number(room.numParticipants ?? 0),
        startedAt: room.creationTime
          ? new Date(Number(room.creationTime) * 1000).toISOString()
          : null,
        participants: participants.map((p) => ({
          identity: p.identity,
          name: p.name,
          joinedAt: p.joinedAt ? new Date(Number(p.joinedAt) * 1000).toISOString() : null,
          isPublishing: (p.tracks?.length ?? 0) > 0,
          isHost: meeting ? p.identity === `user-${meeting.host_user_id}` : false,
        })),
      });
    }

    return reply.status(200).send({ rooms, reachable: true });
  });

  app.post<{ Params: { room: string }; Body: { identity: string } }>(
    "/api/admin/live/:room/kick",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        params: {
          type: "object",
          required: ["room"],
          properties: { room: { type: "string", minLength: 1, maxLength: 200 } },
        },
        body: {
          type: "object",
          required: ["identity"],
          additionalProperties: false,
          properties: { identity: { type: "string", minLength: 1, maxLength: 300 } },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;
      try {
        await withTimeout(
          roomService().removeParticipant(request.params.room, request.body.identity),
          "LiveKit removeParticipant",
        );
      } catch (err) {
        app.log.warn({ err }, "admin kick failed");
        return reply.status(502).send({ error: livekitErrorMessage(err) });
      }
      writeAudit(db, actor, "live.kick", "room", request.params.room, {
        identity: request.body.identity,
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { room: string } }>(
    "/api/admin/live/:room/end",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        params: {
          type: "object",
          required: ["room"],
          properties: { room: { type: "string", minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;
      try {
        await withTimeout(roomService().deleteRoom(request.params.room), "LiveKit deleteRoom");
      } catch (err) {
        app.log.warn({ err }, "admin room end failed");
        return reply.status(502).send({ error: livekitErrorMessage(err) });
      }
      writeAudit(db, actor, "live.end", "room", request.params.room, { room: request.params.room });
      return reply.status(204).send();
    },
  );

  // ---------- §5 Recordings ----------

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    "/api/admin/recordings",
    { ...perRoute(ADMIN_RATE_LIMIT), schema: { querystring: adminPagination } },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;

      const { limit = 50, offset = 0 } = request.query;
      const rows = db
        .prepare(
          `SELECT r.*, m.code AS meeting_code, m.title AS meeting_title, u.name AS host_name
           FROM recordings r
           JOIN meetings m ON m.id = r.meeting_id
           JOIN users u ON u.id = m.host_user_id
           ORDER BY r.started_at DESC, r.rowid DESC`,
        )
        .all() as (RecordingRow & {
        meeting_code: string;
        meeting_title: string;
        host_name: string;
      })[];

      let totalBytes = 0;
      const sizes = new Map<string, number | null>();
      for (const row of rows) {
        let size: number | null = null;
        try {
          size = (await stat(join(recordingsDir, row.file_name))).size;
          totalBytes += size;
        } catch {
          // no file on disk -> `missing: true` below
        }
        sizes.set(row.id, size);
      }

      const recordings = rows.slice(offset, offset + limit).map((row) => ({
        id: row.id,
        meetingCode: row.meeting_code,
        meetingTitle: row.meeting_title,
        hostName: row.host_name,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        sizeBytes: sizes.get(row.id) ?? null,
        missing: sizes.get(row.id) === null || sizes.get(row.id) === undefined,
      }));

      return reply.status(200).send({ recordings, total: rows.length, totalBytes });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/recordings/:id",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;
      const row = db.prepare(`${SELECT_RECORDING} WHERE r.id = ?`).get(request.params.id) as
        | RecordingJoined
        | undefined;
      if (!row) return reply.status(404).send({ error: "recording not found" });

      db.transaction(() => {
        db.prepare("DELETE FROM recordings WHERE id = ?").run(row.id);
        writeAudit(db, actor, "recording.delete", "recording", row.id, {
          meetingCode: row.meeting_code,
          fileName: row.file_name,
        });
      })();
      await unlinkRecordingFiles([row.file_name]);
      return reply.status(204).send();
    },
  );

  // ---------- §6 Settings ----------

  app.get("/api/admin/settings", perRoute(ADMIN_RATE_LIMIT), async (request, reply) => {
    const actor = requireAdmin(request, reply);
    if (!actor) return reply;
    return reply.status(200).send({ settings: readSettings(db) });
  });

  app.patch<{ Body: Partial<AdminSettings> }>(
    "/api/admin/settings",
    {
      ...perRoute(ADMIN_RATE_LIMIT),
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            registrationOpen: { type: "boolean" },
            defaultAllowShare: { type: "boolean" },
            defaultAllowChat: { type: "boolean" },
            defaultAllowUnmute: { type: "boolean" },
            defaultWaitingRoom: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;
      const patch = request.body ?? {};
      writeSettings(db, patch);
      // Only the changed keys and their (boolean) values — no secrets exist here.
      writeAudit(db, actor, "settings.update", "settings", null, patch);
      return reply.status(200).send({ settings: readSettings(db) });
    },
  );

  // ---------- §7 Audit log ----------

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    "/api/admin/audit",
    { ...perRoute(ADMIN_RATE_LIMIT), schema: { querystring: adminPagination } },
    async (request, reply) => {
      const actor = requireAdmin(request, reply);
      if (!actor) return reply;
      const { limit = 50, offset = 0 } = request.query;
      const total = (db.prepare("SELECT COUNT(*) AS n FROM admin_audit").get() as { n: number }).n;
      const rows = db
        .prepare("SELECT * FROM admin_audit ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?")
        .all(limit, offset) as AdminAuditRow[];
      return reply.status(200).send({ entries: rows.map(auditJson), total });
    },
  );

  return app;
}
