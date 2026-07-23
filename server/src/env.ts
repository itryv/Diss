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
}

export function readEnv(overrides: Partial<Env> = {}): Env {
  return {
    PORT: Number(process.env.PORT ?? 8787),
    DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/diss.db",
    SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString("hex"),
    LIVEKIT_URL: process.env.LIVEKIT_URL ?? "ws://localhost:7880",
    LIVEKIT_API_URL: process.env.LIVEKIT_API_URL ?? "http://localhost:7880",
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? "devkey",
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? "secret",
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    EGRESS_ENABLED: (process.env.EGRESS_ENABLED ?? "false").toLowerCase() === "true",
    RECORDINGS_DIR: process.env.RECORDINGS_DIR ?? "./data/recordings",
    RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    ...overrides,
  };
}
