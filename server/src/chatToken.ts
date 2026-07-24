import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * chatToken (contract v4 §0) — proof of "I am this identity in this meeting",
 * issued by the token endpoint and by the waiting-room admit response.
 *
 * Format: `<b64url(meetingId.identity.displayName)>.<b64url(HMAC-SHA256(secret, payload))>`
 *
 * It is deliberately NOT a session: guests have no session, but they still need
 * an identity the server can trust before private messages can exist.
 */

export interface ChatIdentity {
  meetingId: string;
  identity: string;
  displayName: string;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintChatToken(
  secret: string,
  meetingId: string,
  identity: string,
  displayName: string,
): string {
  const payload = `${meetingId}.${identity}.${displayName}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(secret, payload)}`;
}

/**
 * Verifies the signature with a constant-time compare and returns the identity
 * it carries, or null. When `meetingId` is given the token must belong to that
 * meeting — a token for meeting A must never read meeting B's messages.
 */
export function verifyChatToken(
  secret: string,
  token: unknown,
  meetingId?: string,
): ChatIdentity | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  // Reject non-canonical encodings so one payload has exactly one token.
  if (Buffer.from(payload, "utf8").toString("base64url") !== encoded) return null;

  const expected = Buffer.from(sign(secret, payload), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  // meetingId (uuid) and identity (`user-<uuid>` / `guest-<hex>`) never contain
  // a dot; the display name is the rest, so it may.
  const first = payload.indexOf(".");
  const second = payload.indexOf(".", first + 1);
  if (first <= 0 || second <= first + 1) return null;
  const parsed: ChatIdentity = {
    meetingId: payload.slice(0, first),
    identity: payload.slice(first + 1, second),
    displayName: payload.slice(second + 1),
  };
  if (parsed.displayName.length === 0) return null;
  if (meetingId !== undefined && parsed.meetingId !== meetingId) return null;
  return parsed;
}
