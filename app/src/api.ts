// Typed client for the Diss backend (see ../docs/api-contract.md).
// All requests go through the Vite dev proxy: /api → http://localhost:8787.

export interface User {
  id: number | string;
  name: string;
  email: string;
  /**
   * Admin contract §0 — derived on the server from `ADMIN_EMAILS`, never
   * grantable through the API. Optional in the type only so an older server
   * (which doesn't send it) still signs people in; absent === not an admin.
   */
  isAdmin?: boolean;
}

export interface Meeting {
  id: number | string;
  code: string;
  title: string;
  hostUserId: number | string;
  hostName: string;
  startsAt: string | null;
  createdAt: string;
  // Contract v2
  waitingRoom?: boolean;
  locked?: boolean;
  // Contract v4 — room-wide host controls (default true on the server)
  allowShare?: boolean;
  allowChat?: boolean;
  allowUnmute?: boolean;
}

export interface TokenResponse {
  token: string;
  url: string;
  identity: string;
  isHost: boolean;
  /**
   * Contract v4 §0 — proof of "I am this identity in this meeting". Required by
   * every message read/write; the server derives identity from it, so a client
   * can never read or post as anyone else. Optional in the type only so an
   * older server (v2) still connects.
   */
  chatToken?: string;
}

/** 202 from the token endpoint when the meeting has a waiting room. */
export interface WaitingResponse { waitingId: string; status: 'waiting'; }

export type WaitingStatus =
  | { status: 'waiting' }
  | { status: 'denied' }
  | ({ status: 'admitted' } & TokenResponse);

export interface WaitingGuest { waitingId: string; displayName: string; requestedAt: string; }

export type ModerateAction =
  | 'mute' | 'remove' | 'promote' | 'demote'
  // Contract v4 §2 — per-person screen-share override (host/co-host only)
  | 'allow-share' | 'deny-share';

export interface PersistedMessage {
  id: number | string;
  meetingId: number | string;
  identity: string;
  displayName: string;
  text: string;
  ts: string | number;
  /** Contract v4 — null/absent = everyone; otherwise a private message to that identity. */
  toIdentity?: string | null;
  /** Identities mentioned; `"*"` means @all. */
  mentions?: string[];
}

/** Body of `POST /messages` (contract v4 §1) — identity comes from the chatToken. */
export interface OutgoingMessage {
  chatToken: string;
  text: string;
  toIdentity?: string;
  mentions?: string[];
}

// ── Breakout rooms (contract v4 §3) ──────────────────────────────────────────

export interface BreakoutMember { identity: string; displayName: string; }

export interface Breakout {
  id: number | string;
  /** Position in the open set. The LiveKit room is `<code>__b<idx>`. */
  idx: number;
  name: string;
  participants: BreakoutMember[];
}

/** `POST /breakouts/token` — a LiveKit token for ONE breakout room. */
export interface BreakoutToken {
  token: string;
  url: string;
  /** `<code>__b<idx>` */
  room: string;
  breakoutName: string;
}

export interface Recording {
  id: number | string;
  meetingCode: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  sizeBytes: number | null;
}

// ── Admin dashboard (docs/api-contract-admin.md) ─────────────────────────────
// Everything below needs a session whose user is in ADMIN_EMAILS; anything else
// gets a 403 with an {error} body, which `req` turns into an ApiError.

export interface AdminOverview {
  users: { total: number; disabled: number; admins: number };
  meetings: { total: number; scheduled: number; live: number };
  recordings: { count: number; bytes: number };
  messages: { total: number };
  storage: { dbBytes: number; recordingsBytes: number; diskFreeBytes: number };
  /** `reachable:false` means the numbers here are unknown, NOT zero. */
  livekit: { reachable: boolean; rooms: number; participants: number; error?: string };
  server: { uptimeS: number; nodeVersion: string; startedAt: string };
}

export interface AdminUser {
  id: number | string;
  name: string;
  email: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  meetingCount: number;
  lastSeenAt: string | null;
}

export interface AdminMeeting extends Meeting {
  hostEmail: string;
  live: boolean;
  participantCount: number;
  messageCount: number;
  recordingCount: number;
}

export interface LiveParticipant {
  identity: string;
  name: string;
  joinedAt: string;
  isPublishing: boolean;
  isHost: boolean;
}

export interface LiveRoom {
  /** LiveKit room name — the join code, or `<code>__b<idx>` for a breakout. */
  name: string;
  meetingCode: string;
  meetingTitle: string;
  hostName: string;
  numParticipants: number;
  startedAt: string;
  participants: LiveParticipant[];
}

export interface AdminRecording {
  id: number | string;
  meetingCode: string;
  meetingTitle: string;
  hostName: string;
  startedAt: string;
  endedAt: string | null;
  sizeBytes: number | null;
  /** The DB row exists but the file on disk doesn't. */
  missing?: boolean;
}

export interface AdminSettings {
  registrationOpen: boolean;
  defaultAllowShare: boolean;
  defaultAllowChat: boolean;
  defaultAllowUnmute: boolean;
  defaultWaitingRoom: boolean;
}

/**
 * One row of `admin_audit`. The snake_case aliases are deliberate: the contract
 * specifies the COLUMN names, not the JSON casing, so accept either rather than
 * render blank cells if the server serialises the row as-is.
 */
export interface AuditEntry {
  id: number | string;
  actorEmail?: string; actor_email?: string;
  actorUserId?: number | string; actor_user_id?: number | string;
  action: string;
  targetType?: string; target_type?: string;
  targetId?: number | string | null; target_id?: number | string | null;
  detail?: string | null;
  createdAt?: string; created_at?: string;
}

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server — is it running?");
  }
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') message = body.error;
      else if (body && typeof body.message === 'string') message = body.message;
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  register: (name: string, email: string, password: string) =>
    req<{ user: User }>('/auth/register', { method: 'POST', json: { name, email, password } }),
  login: (email: string, password: string) =>
    req<{ user: User }>('/auth/login', { method: 'POST', json: { email, password } }),
  logout: () => req<void>('/auth/logout', { method: 'POST' }),
  me: () => req<{ user: User }>('/auth/me'),

  // Meetings
  createMeeting: (body: { title?: string; startsAt?: string }) =>
    req<{ meeting: Meeting }>('/meetings', { method: 'POST', json: body }),
  listMeetings: () => req<{ meetings: Meeting[] }>('/meetings'),
  getMeeting: (code: string) => req<{ meeting: Meeting }>(`/meetings/${encodeURIComponent(code)}`),
  deleteMeeting: (id: number | string) =>
    req<void>(`/meetings/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),

  patchMeeting: (id: number | string, body: {
    title?: string; startsAt?: string; waitingRoom?: boolean; locked?: boolean;
    allowShare?: boolean; allowChat?: boolean; allowUnmute?: boolean;
  }) =>
    req<{ meeting: Meeting }>(`/meetings/${encodeURIComponent(String(id))}`, { method: 'PATCH', json: body }),

  // Joining / LiveKit — 200 with a token, or 202 {waitingId} when the waiting room is on
  meetingToken: (code: string, displayName: string) =>
    req<TokenResponse | WaitingResponse>(`/meetings/${encodeURIComponent(code)}/token`, { method: 'POST', json: { displayName } }),

  // Waiting room
  waitingStatus: (code: string, waitingId: string) =>
    req<WaitingStatus>(`/meetings/${encodeURIComponent(code)}/waiting/${encodeURIComponent(waitingId)}`),
  waitingList: (code: string) =>
    req<{ guests: WaitingGuest[] }>(`/meetings/${encodeURIComponent(code)}/waiting`),
  waitingAct: (code: string, waitingId: string, action: 'admit' | 'deny') =>
    req<void>(`/meetings/${encodeURIComponent(code)}/waiting/${encodeURIComponent(waitingId)}`, { method: 'POST', json: { action } }),

  // Moderation (host or co-host; promote/demote host only)
  moderate: (code: string, action: ModerateAction, identity: string) =>
    req<void>(`/meetings/${encodeURIComponent(code)}/moderate`, { method: 'POST', json: { action, identity } }),

  // Persistent chat (contract v4 — chatToken required, 401 without it).
  // GET returns only what the caller may see: public messages + their own DMs.
  listMessages: (code: string, chatToken: string) =>
    req<{ messages: PersistedMessage[] }>(
      `/meetings/${encodeURIComponent(code)}/messages?chatToken=${encodeURIComponent(chatToken)}`),
  postMessage: (code: string, body: OutgoingMessage) =>
    req<{ message: PersistedMessage }>(`/meetings/${encodeURIComponent(code)}/messages`, { method: 'POST', json: body }),

  // Breakout rooms (contract v4 §3). Create/close are host or co-host only;
  // the token endpoint is chatToken-authenticated and server-authoritative —
  // a client can never mint a token for a room it isn't assigned to.
  createBreakouts: (code: string, rooms: { name: string; identities: string[] }[]) =>
    req<{ breakouts: Breakout[] }>(`/meetings/${encodeURIComponent(code)}/breakouts`, { method: 'POST', json: { rooms } }),
  listBreakouts: (code: string) =>
    req<{ breakouts: Breakout[]; open: boolean }>(`/meetings/${encodeURIComponent(code)}/breakouts`),
  /** `idx` is host-only: visit any room. Everyone else gets their own, or a 404. */
  breakoutToken: (code: string, chatToken: string, idx?: number) =>
    req<BreakoutToken>(`/meetings/${encodeURIComponent(code)}/breakouts/token`, {
      method: 'POST',
      json: { chatToken, ...(idx !== undefined ? { idx } : {}) },
    }),
  closeBreakouts: (code: string) =>
    req<void>(`/meetings/${encodeURIComponent(code)}/breakouts/close`, { method: 'POST' }),

  // Recording
  recording: (code: string, action: 'start' | 'stop') =>
    req<{ recording: { id: number | string; meetingCode: string; startedAt: string } }>(
      `/meetings/${encodeURIComponent(code)}/recording`, { method: 'POST', json: { action } }),
  listRecordings: () => req<{ recordings: Recording[] }>('/recordings'),
  deleteRecording: (id: number | string) =>
    req<void>(`/recordings/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),

  // ── Admin (contract: docs/api-contract-admin.md) ──────────────────────────
  admin: {
    overview: () => req<AdminOverview>('/admin/overview'),

    users: (p: { q?: string; limit?: number; offset?: number } = {}) =>
      req<{ users: AdminUser[]; total: number }>(`/admin/users${qs(p)}`),
    setUserDisabled: (id: number | string, disabled: boolean) =>
      req<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(String(id))}`, {
        method: 'PATCH', json: { disabled },
      }),
    deleteUser: (id: number | string) =>
      req<void>(`/admin/users/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),

    meetings: (p: { q?: string; live?: 1 | ''; limit?: number; offset?: number } = {}) =>
      req<{ meetings: AdminMeeting[]; total: number }>(`/admin/meetings${qs(p)}`),
    deleteMeeting: (id: number | string) =>
      req<void>(`/admin/meetings/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
    /** Ends the live room without deleting the meeting. 409 when it isn't live. */
    endMeeting: (id: number | string) =>
      req<void>(`/admin/meetings/${encodeURIComponent(String(id))}/end`, { method: 'POST' }),

    live: () => req<{ rooms: LiveRoom[]; reachable: boolean; error?: string }>('/admin/live'),
    kick: (room: string, identity: string) =>
      req<void>(`/admin/live/${encodeURIComponent(room)}/kick`, { method: 'POST', json: { identity } }),
    endRoom: (room: string) =>
      req<void>(`/admin/live/${encodeURIComponent(room)}/end`, { method: 'POST' }),

    recordings: (p: { limit?: number; offset?: number } = {}) =>
      req<{ recordings: AdminRecording[]; total: number; totalBytes: number }>(`/admin/recordings${qs(p)}`),
    deleteRecording: (id: number | string) =>
      req<void>(`/admin/recordings/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),

    settings: () => req<{ settings: AdminSettings }>('/admin/settings'),
    patchSettings: (body: Partial<AdminSettings>) =>
      req<{ settings: AdminSettings }>('/admin/settings', { method: 'PATCH', json: body }),

    audit: (p: { limit?: number; offset?: number } = {}) =>
      req<{ entries: AuditEntry[]; total: number }>(`/admin/audit${qs(p)}`),
  },
};

/** URL that streams a recording's MP4 (cookie-authenticated). */
export function recordingFileUrl(id: number | string): string {
  return `/api/recordings/${encodeURIComponent(String(id))}/file`;
}

/** Extract an abc-defg-hij join code from raw input (code or pasted link). */
export function extractCode(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/);
  return m ? m[0] : null;
}

/** Shareable link for a meeting code. */
export function meetingLink(code: string): string {
  return `${window.location.origin}/?join=${code}`;
}
