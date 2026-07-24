import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: number; // epoch ms
  created_at: string;
}

export interface MeetingRow {
  id: string;
  code: string;
  title: string;
  host_user_id: string;
  starts_at: string | null;
  created_at: string;
  waiting_room: number; // 0 | 1
  locked: number; // 0 | 1
  allow_share: number; // 0 | 1 — non-hosts may publish a screen share
  allow_chat: number; // 0 | 1 — non-hosts may publish data (chat/reactions)
  allow_unmute: number; // 0 | 1 — non-hosts may publish their microphone
}

export interface WaitingGuestRow {
  id: string;
  meeting_id: string;
  display_name: string;
  identity: string;
  status: "waiting" | "admitted" | "denied";
  created_at: string;
  last_seen_at: number; // epoch ms
}

export interface MessageRow {
  id: string;
  meeting_id: string;
  identity: string;
  display_name: string;
  text: string;
  ts: string;
  to_identity: string | null; // NULL = visible to everyone
  mentions: string; // JSON array of identities, "*" = @all
}

export interface BreakoutRow {
  id: string;
  meeting_id: string;
  idx: number;
  name: string;
  created_at: string;
  closed_at: string | null;
}

export interface BreakoutAssignmentRow {
  breakout_id: string;
  identity: string;
  display_name: string;
}

export interface RecordingRow {
  id: string;
  meeting_id: string;
  egress_id: string;
  file_name: string;
  started_at: string;
  ended_at: string | null;
}

export function openDb(databasePath: string): Database.Database {
  const absolute = resolve(databasePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new Database(absolute);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS meetings (
      id           TEXT PRIMARY KEY,
      code         TEXT NOT NULL UNIQUE,
      title        TEXT NOT NULL,
      host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      starts_at    TEXT,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings(host_user_id);

    CREATE TABLE IF NOT EXISTS waiting_guests (
      id           TEXT PRIMARY KEY,
      meeting_id   TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      identity     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','admitted','denied')),
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_waiting_guests_meeting ON waiting_guests(meeting_id);

    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      meeting_id   TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      identity     TEXT NOT NULL,
      display_name TEXT NOT NULL,
      text         TEXT NOT NULL,
      ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_meeting ON messages(meeting_id);

    CREATE TABLE IF NOT EXISTS breakouts (
      id         TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      idx        INTEGER NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      closed_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_breakouts_meeting ON breakouts(meeting_id);

    CREATE TABLE IF NOT EXISTS breakout_assignments (
      breakout_id  TEXT NOT NULL REFERENCES breakouts(id) ON DELETE CASCADE,
      identity     TEXT NOT NULL,
      display_name TEXT NOT NULL,
      PRIMARY KEY (breakout_id, identity)
    );
    CREATE INDEX IF NOT EXISTS idx_breakout_assignments_identity
      ON breakout_assignments(identity);

    CREATE TABLE IF NOT EXISTS recordings (
      id         TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      egress_id  TEXT NOT NULL,
      file_name  TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings(meeting_id);
  `);

  // v2 migration: add waiting_room / locked to meetings created before v2,
  // guarded by a PRAGMA column check so re-running is a no-op.
  const meetingCols = (db.pragma("table_info(meetings)") as { name: string }[]).map(
    (c) => c.name,
  );
  if (!meetingCols.includes("waiting_room")) {
    db.exec("ALTER TABLE meetings ADD COLUMN waiting_room INTEGER NOT NULL DEFAULT 0");
  }
  if (!meetingCols.includes("locked")) {
    db.exec("ALTER TABLE meetings ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
  }

  // v4 migration: host permission defaults on meetings, plus DM/mention columns
  // on messages. Same PRAGMA guard, so booting an existing database is additive
  // (every pre-v4 row gets the permissive default) and re-running is a no-op.
  const meetingColsV4 = (db.pragma("table_info(meetings)") as { name: string }[]).map(
    (c) => c.name,
  );
  for (const column of ["allow_share", "allow_chat", "allow_unmute"]) {
    if (!meetingColsV4.includes(column)) {
      db.exec(`ALTER TABLE meetings ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`);
    }
  }

  const messageCols = (db.pragma("table_info(messages)") as { name: string }[]).map(
    (c) => c.name,
  );
  if (!messageCols.includes("to_identity")) {
    db.exec("ALTER TABLE messages ADD COLUMN to_identity TEXT");
  }
  if (!messageCols.includes("mentions")) {
    db.exec("ALTER TABLE messages ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]'");
  }
  return db;
}
