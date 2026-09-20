/**
 * Prometheus metrics for the Diss server.
 *
 * The point of this is evaluation, not just ops: the project had no way to
 * measure itself, so any claim about capacity or latency was an assertion.
 * These counters are what turn "it works" into numbers you can plot.
 *
 * Everything is kept in memory and resets on restart, which is exactly what
 * Prometheus expects from a counter — it handles resets itself.
 */

/** Request counts keyed by `method|route|status`. */
const requests = new Map<string, number>();

/**
 * Latency buckets in seconds, cumulative (Prometheus histogram semantics).
 * Chosen for a small API in front of SQLite: most responses land under 25ms,
 * and anything past 1s is worth seeing as its own bucket rather than +Inf.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;
const durations = new Map<string, { counts: number[]; sum: number; total: number }>();

/** Rate-limit rejections, which are otherwise invisible in a 4xx bucket. */
let rateLimited = 0;

const key = (method: string, route: string, status: number) => `${method}|${route}|${status}`;

export function recordRequest(
  method: string,
  route: string,
  status: number,
  seconds: number,
): void {
  requests.set(key(method, route, status), (requests.get(key(method, route, status)) ?? 0) + 1);
  if (status === 429) rateLimited += 1;

  const dk = `${method}|${route}`;
  let d = durations.get(dk);
  if (!d) {
    d = { counts: new Array(BUCKETS.length).fill(0), sum: 0, total: 0 };
    durations.set(dk, d);
  }
  d.sum += seconds;
  d.total += 1;
  for (let i = 0; i < BUCKETS.length; i++) {
    if (seconds <= (BUCKETS[i] as number)) d.counts[i] = (d.counts[i] ?? 0) + 1;
  }
}

/** Prometheus rejects a label value containing a quote, backslash or newline. */
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");

export interface MetricsSnapshot {
  users: number;
  meetings: number;
  recordings: number;
  messages: number;
  transcriptLines: number;
  liveRooms: number;
  liveParticipants: number;
  livekitReachable: boolean;
  dbBytes: number;
  recordingsBytes: number;
  diskFreeBytes: number;
  uptimeSeconds: number;
}

/** Render the exposition format. Order does not matter; HELP/TYPE do. */
export function renderMetrics(s: MetricsSnapshot): string {
  const out: string[] = [];
  const gauge = (name: string, help: string, value: number) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
  };

  out.push(
    "# HELP diss_http_requests_total Total HTTP requests by method, route and status.",
    "# TYPE diss_http_requests_total counter",
  );
  for (const [k, count] of requests) {
    const [method = "", route = "", status = ""] = k.split("|");
    out.push(
      `diss_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${esc(status)}"} ${count}`,
    );
  }

  out.push(
    "# HELP diss_http_request_duration_seconds Request latency.",
    "# TYPE diss_http_request_duration_seconds histogram",
  );
  for (const [k, d] of durations) {
    const [method = "", route = ""] = k.split("|");
    const labels = `method="${esc(method)}",route="${esc(route)}"`;
    for (let i = 0; i < BUCKETS.length; i++) {
      out.push(
        `diss_http_request_duration_seconds_bucket{${labels},le="${BUCKETS[i]}"} ${d.counts[i]}`,
      );
    }
    out.push(
      `diss_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${d.total}`,
      `diss_http_request_duration_seconds_sum{${labels}} ${d.sum}`,
      `diss_http_request_duration_seconds_count{${labels}} ${d.total}`,
    );
  }

  out.push(
    "# HELP diss_rate_limited_total Requests rejected with 429.",
    "# TYPE diss_rate_limited_total counter",
    `diss_rate_limited_total ${rateLimited}`,
  );

  gauge("diss_users", "Registered users.", s.users);
  gauge("diss_meetings", "Meetings on record.", s.meetings);
  gauge("diss_recordings", "Recordings on record.", s.recordings);
  gauge("diss_messages", "Stored chat messages.", s.messages);
  gauge("diss_transcript_lines", "Stored transcript lines.", s.transcriptLines);
  gauge("diss_live_rooms", "Rooms currently live on the SFU.", s.liveRooms);
  gauge("diss_live_participants", "Participants currently connected.", s.liveParticipants);
  gauge("diss_livekit_reachable", "1 when the SFU answered, 0 otherwise.", s.livekitReachable ? 1 : 0);
  gauge("diss_db_bytes", "Database size including WAL.", s.dbBytes);
  gauge("diss_recordings_bytes", "Bytes of stored recordings.", s.recordingsBytes);
  gauge("diss_disk_free_bytes", "Free space on the data volume.", s.diskFreeBytes);
  gauge("diss_uptime_seconds", "Process uptime.", s.uptimeSeconds);

  return out.join("\n") + "\n";
}

/** Exposed for tests: wipe the in-memory series. */
export function resetMetrics(): void {
  requests.clear();
  durations.clear();
  rateLimited = 0;
}
