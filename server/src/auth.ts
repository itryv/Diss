import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SessionRow, UserRow } from "./db.js";

export const SESSION_COOKIE = "diss_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(db: Database.Database, userId: string): string {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    Date.now() + SESSION_TTL_MS,
  );
  return token;
}

export function destroySession(db: Database.Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Returns the user for the request's session cookie, or null. */
export function sessionUser(db: Database.Database, request: FastifyRequest): UserRow | null {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token) as SessionRow | undefined;
  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    destroySession(db, token);
    return null;
  }
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as UserRow) ?? null;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function publicUser(user: UserRow): { id: string; name: string; email: string } {
  return { id: user.id, name: user.name, email: user.email };
}
