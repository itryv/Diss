import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  TrackType,
} from "livekit-server-sdk";
import type { Env } from "./env.js";
import { openDb, type UserRow } from "./db.js";
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

export function buildServer(env: Env): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const db = openDb(env.DATABASE_PATH);

  app.register(cookie, { secret: env.SESSION_SECRET });
  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

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

  // ---------- Auth ----------

  app.post<{ Body: { name: string; email: string; password: string } }>(
    "/api/auth/register",
    {
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

  // ---------- Joining / LiveKit ----------

  app.post<{ Params: { code: string }; Body: { displayName: string } }>(
    "/api/meetings/:code/token",
    {
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

      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity,
        name: request.body.displayName,
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
      const token = await at.toJwt();
      return reply.status(200).send({ token, url: env.LIVEKIT_URL, identity, isHost });
    },
  );

  // ---------- Moderation ----------

  app.post<{ Params: { code: string }; Body: { action: "mute" | "remove"; identity: string } }>(
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
            action: { type: "string", enum: ["mute", "remove"] },
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
      if (user.id !== meeting.host_user_id) {
        return reply.status(403).send({ error: "only the host can moderate" });
      }

      const { action, identity } = request.body;
      const rooms = new RoomServiceClient(
        env.LIVEKIT_API_URL,
        env.LIVEKIT_API_KEY,
        env.LIVEKIT_API_SECRET,
      );
      try {
        if (action === "remove") {
          await rooms.removeParticipant(meeting.code, identity);
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

  return app;
}
