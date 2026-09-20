# Diss — measurement

The project could describe itself but not measure itself. These are the tools
that turn claims about capacity, latency and throttling into numbers.

Two pieces:

- **`GET /api/metrics`** — Prometheus exposition format, for continuous
  measurement of a running deployment.
- **`api-load.mjs`** — a load generator, for measuring a deployment on demand.

## Metrics

Gated, because request volumes and room occupancy are not public. A scraper
uses a bearer token; a human can use an admin session.

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://<APP_DOMAIN>/api/metrics
```

Set `METRICS_TOKEN` in `deploy/.env`. With no token set, only an admin session
can read it.

Series worth plotting:

| Metric | Why it matters |
|---|---|
| `diss_http_request_duration_seconds` | Histogram, so p50/p95/p99 are derivable over any window |
| `diss_http_requests_total` | Labelled by route **pattern**, not URL — one series per endpoint, not per meeting code |
| `diss_rate_limited_total` | 429s are invisible inside a generic 4xx count |
| `diss_live_rooms` / `diss_live_participants` | Actual concurrent load, straight from the SFU |
| `diss_disk_free_bytes` | The most likely way this deployment dies |
| `diss_db_bytes`, `diss_recordings_bytes` | Growth rates, for a capacity argument |

Counters reset when the process restarts. That is normal — Prometheus handles
resets — but it means uptime matters when reading a raw scrape by hand.

## Load generator

```bash
cd bench
node api-load.mjs --url http://localhost:8787 --concurrency 20 --seconds 30
node api-load.mjs --url http://localhost:8787 --scenario login --concurrency 10
node api-load.mjs --url http://localhost:8787 --json > result.json
```

| Flag | Default | Meaning |
|---|---|---|
| `--url` | `http://localhost:8787` | Target origin |
| `--scenario` | `health` | `health`, `meeting`, `login` |
| `--concurrency` | `10` | Parallel workers |
| `--seconds` | `15` | Measurement window, after warm-up |
| `--warmup` | `2000` | Discarded milliseconds |
| `--code` | — | Meeting code for `--scenario meeting` |
| `--json` | — | Also emit a machine-readable line |

It is read-only: no account, meeting or recording is created on the target. The
`login` scenario deliberately submits credentials that cannot match, because
the point is to measure the limiter and the scrypt verification, not to get in.

**Warm-up is not politeness.** The first requests pay for TLS, DNS and
better-sqlite3's statement cache; folding them in puts a one-off cost into the
tail percentiles.

**Run it from a different machine than the server** if the number is meant to
mean anything. Loopback has no network, and a generator competing with the
server for CPU measures the pair, not the server.

## What it found

Written up because it is the point of having the tool.

Immediately on first run, at 20 concurrent against `/api/health`:

```
status
  429       63494 (100.0%)
```

`/api/health` was under the global 300/window limiter. Under any real burst it
would answer 429, the container healthcheck reads a non-200 as unhealthy, and
Docker restarts a server that was merely busy — an outage manufactured out of
load. Exempting the route fixed it, and there is now a test that holds the line:

```
requests    59598 in 10.0s
throughput  5959.1 req/s
latency p50 2.9 ms   p95 6.2 ms   p99 9.0 ms
status
  200       59598 (100.0%)
```

Same harness against `login` still shows 100% 429 at 10 concurrent, which is
the limiter working as intended on the endpoint that wants protecting.

## Suggested evaluation

1. **Baseline** — `health` at 1, 5, 10, 25, 50 concurrent. Plot throughput and
   p95 against concurrency; the knee is the API's practical ceiling.
2. **Throttling** — `login` at rising concurrency, from one machine and then
   from two. Before the `trustProxy` fix every client shared one bucket, so a
   second machine did not raise the ceiling; afterwards it does. That
   before/after is a clean, defensible result.
3. **Database growth** — sample `diss_db_bytes` and `diss_messages` over a
   week of use for a growth-rate argument.
4. **Media** — capacity of the SFU is LiveKit's to answer and needs real
   bandwidth; the client already polls `getRTCStatsReport()`, so bitrate, RTT,
   packet loss and resolution can be captured per participant from the
   connection panel.

## Limitations, stated plainly

- Measures the API, not media. It does not open WebRTC sessions.
- Single-process generator. Past a few thousand req/s the bottleneck may be the
  generator; run several, on separate machines.
- No think-time model: workers request in a closed loop, which is a stress
  test, not a simulation of human usage.
