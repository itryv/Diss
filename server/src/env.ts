import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/** Minimal .env loader: KEY=VALUE lines, `#` comments, optional surrounding quotes.
 *  Never overrides variables already present in process.env. */
export function loadDotenv(path = ".env"): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // no .env file — fine
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export interface Env {
  PORT: number;
  DATABASE_PATH: string;
  SESSION_SECRET: string;
  LIVEKIT_URL: string;
  LIVEKIT_API_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  CORS_ORIGIN: string;
  EGRESS_ENABLED: boolean;
  RECORDINGS_DIR: string;
  /** Rate-limit window in ms (default 60s). Overridable mainly for tests. */
  RATE_LIMIT_WINDOW_MS: number;
  /**
   * Comma-separated list of admin emails (case-insensitive, trimmed). Empty =
   * nobody is an admin. This is the ONLY way to grant admin — deliberately not
   * grantable through the API, so a stolen admin session cannot widen itself.
   */
  ADMIN_EMAILS: string;
}

/**
 * `??` only falls back on null/undefined, and `.env` templates ship these keys
 * present but blank — which Docker passes through as "". An empty SESSION_SECRET
 * would sail past the fallback and become the HMAC key for every chatToken,
 * making them forgeable by anyone; empty LiveKit credentials produce tokens the
 * SFU rejects while the API still answers 200. Treat blank as absent.
 */
const fromEnv = (name: string): string | undefined => {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? undefined : raw;
};

/** Secrets with no safe default: in production a wrong value is worse than a crash. */
const REQUIRED_IN_PRODUCTION = [
  "SESSION_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CORS_ORIGIN",
] as const;

export function readEnv(overrides: Partial<Env> = {}): Env {
  if (process.env.NODE_ENV === "production") {
    const missing = REQUIRED_IN_PRODUCTION.filter(
      (name) => fromEnv(name) === undefined && !(name in overrides),
    );
    if (missing.length > 0) {
      // Refusing to boot is recoverable and obvious. Booting on a random
      // per-restart session secret is a mystery bug: every cookie and every
      // chatToken silently stops working on each deploy.
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}. ` +
          `Set them in deploy/.env — they have no safe default in production.`,
      );
    }
  }
  return {
    PORT: Number(process.env.PORT ?? 8787),
    DATABASE_PATH: fromEnv("DATABASE_PATH") ?? "./data/diss.db",
    SESSION_SECRET: fromEnv("SESSION_SECRET") ?? randomBytes(32).toString("hex"),
    LIVEKIT_URL: fromEnv("LIVEKIT_URL") ?? "ws://localhost:7880",
    LIVEKIT_API_URL: fromEnv("LIVEKIT_API_URL") ?? "http://localhost:7880",
    LIVEKIT_API_KEY: fromEnv("LIVEKIT_API_KEY") ?? "devkey",
    LIVEKIT_API_SECRET: fromEnv("LIVEKIT_API_SECRET") ?? "secret",
    CORS_ORIGIN: fromEnv("CORS_ORIGIN") ?? "http://localhost:5173",
    EGRESS_ENABLED: (fromEnv("EGRESS_ENABLED") ?? "false").toLowerCase() === "true",
    RECORDINGS_DIR: fromEnv("RECORDINGS_DIR") ?? "./data/recordings",
    RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? "",
    ...overrides,
  };
}
