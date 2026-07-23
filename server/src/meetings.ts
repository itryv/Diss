import { randomInt } from "node:crypto";
import type Database from "better-sqlite3";
import type { MeetingRow } from "./db.js";

/** Lowercase letters only, minus easily-confused l/o — URL-safe and unambiguous. */
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz";

function codeSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Generates a unique join code like `abc-defg-hij`. */
export function generateMeetingCode(db: Database.Database): string {
  const exists = db.prepare("SELECT 1 FROM meetings WHERE code = ?");
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = `${codeSegment(3)}-${codeSegment(4)}-${codeSegment(3)}`;
    if (!exists.get(code)) return code;
  }
  throw new Error("could not generate a unique meeting code");
}

export interface MeetingJson {
  id: string;
  code: string;
  title: string;
  hostUserId: string;
  hostName: string;
  startsAt: string | null;
  createdAt: string;
}

export function meetingJson(row: MeetingRow & { host_name: string }): MeetingJson {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    hostUserId: row.host_user_id,
    hostName: row.host_name,
    startsAt: row.starts_at,
    createdAt: row.created_at,
  };
}

const SELECT_MEETING = `
  SELECT m.*, u.name AS host_name
  FROM meetings m JOIN users u ON u.id = m.host_user_id
`;

export function findMeetingByCode(db: Database.Database, code: string) {
  return db.prepare(`${SELECT_MEETING} WHERE m.code = ?`).get(code) as
    | (MeetingRow & { host_name: string })
    | undefined;
}

export function findMeetingById(db: Database.Database, id: string) {
  return db.prepare(`${SELECT_MEETING} WHERE m.id = ?`).get(id) as
    | (MeetingRow & { host_name: string })
    | undefined;
}

export function listMeetingsForHost(db: Database.Database, hostUserId: string) {
  return db
    .prepare(
      `${SELECT_MEETING} WHERE m.host_user_id = ?
       ORDER BY COALESCE(m.starts_at, m.created_at) ASC, m.created_at ASC`,
    )
    .all(hostUserId) as (MeetingRow & { host_name: string })[];
}
