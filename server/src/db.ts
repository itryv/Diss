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
  `);
  return db;
}
