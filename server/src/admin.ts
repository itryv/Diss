import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AdminAuditRow, UserRow } from "./db.js";

// ---------- Admin identity (contract §0) ----------

/**
 * Parses `ADMIN_EMAILS` into a set of lowercase, trimmed emails. Empty or
 * whitespace-only entries are dropped, so `""` (the default) means **nobody**
 * is an admin. Admin status is derived from this at request time and is
 * deliberately not grantable through the API.
 */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const email = part.trim().toLowerCase();
    if (email) out.add(email);
  }
  return out;
}

/** Case-insensitive, whitespace-tolerant membership test. */
export function isAdminEmail(admins: Set<string>, email: string | null | undefined): boolean {
  if (!email) return false;
  return admins.has(email.trim().toLowerCase());
}

// ---------- Settings (contract §6) ----------

export interface AdminSettings {
  registrationOpen: boolean;
  defaultAllowShare: boolean;
  defaultAllowChat: boolean;
  defaultAllowUnmute: boolean;
  defaultWaitingRoom: boolean;
}

/** Defaults match today's live behaviour, so seeding changes nothing by itself. */
export const SETTINGS_DEFAULTS: AdminSettings = {
  registrationOpen: true,
  defaultAllowShare: true,
  defaultAllowChat: true,
  defaultAllowUnmute: true,
  defaultWaitingRoom: false,
};

export const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof AdminSettings)[];

/** Reads all settings, falling back to the defaults — a missing row is never an error. */
export function readSettings(db: Database.Database): AdminSettings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...SETTINGS_DEFAULTS };
  for (const key of SETTINGS_KEYS) {
    const value = stored.get(key);
    if (value === undefined) continue;
    out[key] = value === "true" || value === "1";
  }
  return out;
}

export function writeSettings(db: Database.Database, patch: Partial<AdminSettings>): void {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  db.transaction(() => {
    for (const key of SETTINGS_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      upsert.run(key, value ? "true" : "false");
    }
  })();
}

// ---------- Audit log (contract §7) ----------

export type AuditAction =
  | "user.disable"
  | "user.enable"
  | "user.delete"
  | "meeting.delete"
  | "meeting.end"
  | "live.kick"
  | "live.end"
  | "recording.delete"
  | "settings.update";

/**
 * Records a state-changing admin action. `detail` is serialized to a short JSON
 * blob — callers pass only non-sensitive descriptors (ids, names, changed keys),
 * never secrets.
 */
export function writeAudit(
  db: Database.Database,
  actor: UserRow,
  action: AuditAction,
  targetType: string,
  targetId: string | null,
  detail: unknown = null,
): void {
  db.prepare(
    `INSERT INTO admin_audit (id, actor_user_id, actor_email, action, target_type, target_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    actor.id,
    actor.email,
    action,
    targetType,
    targetId,
    detail === null || detail === undefined ? null : JSON.stringify(detail).slice(0, 2000),
  );
}

export function auditJson(row: AdminAuditRow) {
  let detail: unknown = null;
  if (row.detail) {
    try {
      detail = JSON.parse(row.detail);
    } catch {
      detail = row.detail; // hand-edited row — surface it rather than 500
    }
  }
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail,
    createdAt: row.created_at,
  };
}

// ---------- Cascading deletes (contract §2 / §3) ----------

/**
 * Every recording file belonging to the given meetings. Collected BEFORE the
 * rows are deleted so the caller can unlink them afterwards — the filesystem is
 * not transactional, so file removal happens outside the DB transaction.
 */
export function recordingFilesForMeetings(
  db: Database.Database,
  meetingIds: string[],
): string[] {
  if (meetingIds.length === 0) return [];
  const placeholders = meetingIds.map(() => "?").join(",");
  return (
    db
      .prepare(`SELECT file_name FROM recordings WHERE meeting_id IN (${placeholders})`)
      .all(...meetingIds) as { file_name: string }[]
  ).map((r) => r.file_name);
}

/**
 * Deletes the given meetings and everything hanging off them, atomically.
 * Explicit rather than relying on `ON DELETE CASCADE` so the result is the same
 * regardless of the `foreign_keys` pragma, and so breakout_assignments (which
 * cascade through breakouts) are provably gone.
 */
export function deleteMeetingsCascade(db: Database.Database, meetingIds: string[]): void {
  if (meetingIds.length === 0) return;
  const placeholders = meetingIds.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM breakout_assignments WHERE breakout_id IN
       (SELECT id FROM breakouts WHERE meeting_id IN (${placeholders}))`,
  ).run(...meetingIds);
  db.prepare(`DELETE FROM breakouts WHERE meeting_id IN (${placeholders})`).run(...meetingIds);
  db.prepare(`DELETE FROM messages WHERE meeting_id IN (${placeholders})`).run(...meetingIds);
  db.prepare(`DELETE FROM waiting_guests WHERE meeting_id IN (${placeholders})`).run(...meetingIds);
  db.prepare(`DELETE FROM recordings WHERE meeting_id IN (${placeholders})`).run(...meetingIds);
  db.prepare(`DELETE FROM meetings WHERE id IN (${placeholders})`).run(...meetingIds);
}

export function meetingIdsForHost(db: Database.Database, userId: string): string[] {
  return (
    db.prepare("SELECT id FROM meetings WHERE host_user_id = ?").all(userId) as { id: string }[]
  ).map((r) => r.id);
}
