/**
 * Migration safety check: reconstruct pre-admin databases with REAL rows, then
 * boot the new server against a copy of each twice. Asserts the migration is
 * additive (nothing lost), idempotent (second boot is a no-op) and that the new
 * admin tables/columns appear with safe defaults.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnv } from "../src/env.js";
import { buildServer } from "../src/app.js";

process.env.NODE_ENV = "test";
const dir = mkdtempSync(join(tmpdir(), "diss-migrate-"));

// ---- v1-era schema: no waiting_room/locked, no allow_*, no DM columns ----
const V1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE meetings (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, starts_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE waiting_guests (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL, identity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','admitted','denied')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at INTEGER NOT NULL);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  identity TEXT NOT NULL, display_name TEXT NOT NULL, text TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE breakouts (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), closed_at TEXT);
CREATE TABLE breakout_assignments (
  breakout_id TEXT NOT NULL REFERENCES breakouts(id) ON DELETE CASCADE,
  identity TEXT NOT NULL, display_name TEXT NOT NULL, PRIMARY KEY (breakout_id, identity));
CREATE TABLE recordings (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  egress_id TEXT NOT NULL, file_name TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT);
`;

// v4-era = v1 plus the v2/v4 ALTERs that the live database has already had.
const V4_ALTERS = `
ALTER TABLE meetings ADD COLUMN waiting_room INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN allow_share INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN allow_chat INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN allow_unmute INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN to_identity TEXT;
ALTER TABLE messages ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]';
`;

function seed(path: string, era: "v1" | "v4") {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(V1);
  if (era === "v4") db.exec(V4_ALTERS);
  db.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)",
  ).run("u1", "Real Person", "real@diss.example", "deadbeef", "cafe", "2026-01-02T03:04:05.000Z");
  db.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)",
  ).run("u2", "Guest User", "guest@diss.example", "beefdead", "face", "2026-02-02T03:04:05.000Z");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(
    "tok-1",
    "u1",
    Date.now() + 86_400_000,
  );
  db.prepare(
    "INSERT INTO meetings (id,code,title,host_user_id,starts_at,created_at) VALUES (?,?,?,?,?,?)",
  ).run("m1", "abc-defg-hij", "Weekly sync", "u1", null, "2026-01-03T00:00:00.000Z");
  db.prepare(
    "INSERT INTO meetings (id,code,title,host_user_id,starts_at,created_at) VALUES (?,?,?,?,?,?)",
  ).run("m2", "klm-nopq-rst", "Viva", "u1", "2026-09-01T09:00:00.000Z", "2026-01-04T00:00:00.000Z");
  db.prepare(
    "INSERT INTO messages (id,meeting_id,identity,display_name,text,ts) VALUES (?,?,?,?,?,?)",
  ).run("msg1", "m1", "user-u1", "Real Person", "hello everyone", "2026-01-03T00:01:00.000Z");
  db.prepare(
    "INSERT INTO waiting_guests (id,meeting_id,display_name,identity,status,last_seen_at) VALUES (?,?,?,?,?,?)",
  ).run("w1", "m1", "Someone", "guest-abc", "admitted", Date.now());
  db.prepare("INSERT INTO breakouts (id,meeting_id,idx,name) VALUES (?,?,?,?)").run(
    "b1",
    "m1",
    0,
    "Group A",
  );
  db.prepare(
    "INSERT INTO breakout_assignments (breakout_id,identity,display_name) VALUES (?,?,?)",
  ).run("b1", "guest-abc", "Someone");
  db.prepare(
    "INSERT INTO recordings (id,meeting_id,egress_id,file_name,started_at,ended_at) VALUES (?,?,?,?,?,?)",
  ).run("r1", "m1", "EG_123", "abc.mp4", "2026-01-03T00:00:00.000Z", "2026-01-03T00:30:00.000Z");
  db.close();
}

function snapshot(path: string) {
  const db = new Database(path, { readonly: true });
  const out: Record<string, unknown> = {};
  for (const t of [
    "users",
    "sessions",
    "meetings",
    "messages",
    "waiting_guests",
    "breakouts",
    "breakout_assignments",
    "recordings",
  ]) {
    out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  }
  const cols = (t: string) =>
    (db.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name).sort();
  const meta = {
    userCols: cols("users"),
    meetingCols: cols("meetings"),
    messageCols: cols("messages"),
    tables: (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  };
  db.close();
  return { data: out, meta };
}

for (const era of ["v1", "v4"] as const) {
  const path = join(dir, `${era}.db`);
  seed(path, era);
  const before = snapshot(path);

  const env = readEnv({
    PORT: 0,
    DATABASE_PATH: path,
    RECORDINGS_DIR: join(dir, "rec"),
    LIVEKIT_API_URL: "http://127.0.0.1:9",
    ADMIN_EMAILS: "real@diss.example",
  });

  const first = await buildServer(env);
  await first.close();
  const afterFirst = snapshot(path);

  const second = await buildServer(env);
  await second.close();
  const afterSecond = snapshot(path);

  // --- additive: every pre-existing row survives byte for byte ---
  for (const table of Object.keys(before.data)) {
    const old = before.data[table] as any[];
    const now = afterFirst.data[table] as any[];
    assert.equal(now.length, old.length, `${era}: ${table} row count changed`);
    for (let i = 0; i < old.length; i++) {
      for (const key of Object.keys(old[i])) {
        assert.deepEqual(now[i][key], old[i][key], `${era}: ${table}.${key} changed`);
      }
    }
  }
  // --- new schema present with safe defaults ---
  assert.ok(afterFirst.meta.userCols.includes("disabled"), `${era}: users.disabled missing`);
  assert.ok(afterFirst.meta.tables.includes("settings"), `${era}: settings table missing`);
  assert.ok(afterFirst.meta.tables.includes("admin_audit"), `${era}: admin_audit missing`);
  const users = afterFirst.data.users as any[];
  assert.ok(
    users.every((u) => u.disabled === 0),
    `${era}: existing users must default to enabled`,
  );
  for (const column of ["waiting_room", "locked", "allow_share", "allow_chat", "allow_unmute"]) {
    assert.ok(afterFirst.meta.meetingCols.includes(column), `${era}: meetings.${column} missing`);
  }
  for (const column of ["to_identity", "mentions"]) {
    assert.ok(afterFirst.meta.messageCols.includes(column), `${era}: messages.${column} missing`);
  }
  // --- idempotent: the second boot changes nothing at all ---
  assert.deepEqual(afterSecond, afterFirst, `${era}: second boot was not a no-op`);
  assert.equal(afterFirst.meta.userCols.filter((c) => c === "disabled").length, 1);

  console.log(
    `ok - ${era}-era database: ${(before.data.users as any[]).length} users / ` +
      `${(before.data.meetings as any[]).length} meetings preserved, migration additive + idempotent`,
  );
}

rmSync(dir, { recursive: true, force: true });
console.log("\nMigration safety check passed.");
