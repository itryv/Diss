// Typed client for the Diss backend (see ../docs/api-contract.md).
// All requests go through the Vite dev proxy: /api → http://localhost:8787.

export interface User { id: number | string; name: string; email: string; }

export interface Meeting {
  id: number | string;
  code: string;
  title: string;
  hostUserId: number | string;
  hostName: string;
  startsAt: string | null;
  createdAt: string;
}

export interface TokenResponse {
  token: string;
  url: string;
  identity: string;
  isHost: boolean;
}

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

  // Joining / LiveKit
  meetingToken: (code: string, displayName: string) =>
    req<TokenResponse>(`/meetings/${encodeURIComponent(code)}/token`, { method: 'POST', json: { displayName } }),

  // Moderation (host only)
  moderate: (code: string, action: 'mute' | 'remove', identity: string) =>
    req<void>(`/meetings/${encodeURIComponent(code)}/moderate`, { method: 'POST', json: { action, identity } }),
};

/** Extract an abc-defg-hij join code from raw input (code or pasted link). */
export function extractCode(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/);
  return m ? m[0] : null;
}

/** Shareable link for a meeting code. */
export function meetingLink(code: string): string {
  return `${window.location.origin}/?join=${code}`;
}
