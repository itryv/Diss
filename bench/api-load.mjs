/**
 * API load harness.
 *
 * Answers questions the project previously could only assert: how many
 * concurrent clients the server sustains, what latency looks like at the tail,
 * and at what point rate limiting starts rejecting legitimate traffic.
 *
 * It deliberately measures the API rather than media. The SFU's capacity is
 * LiveKit's to answer and needs real bandwidth; what is interesting here is
 * the part this project actually wrote — and the part that, before the
 * trustProxy fix, throttled every client through a single shared bucket.
 *
 *   node api-load.mjs --url https://diss.remilekun.dev --concurrency 20 --seconds 30
 *   node api-load.mjs --scenario join --concurrency 50
 *
 * Read-only by default: it hits public GETs and never creates an account or a
 * meeting on the target. `--scenario join` needs --code for a real meeting.
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]]);
    return acc;
  }, []),
);

const URL_BASE = (args.url ?? 'http://localhost:8787').replace(/\/+$/, '');
const CONCURRENCY = Number(args.concurrency ?? 10);
const SECONDS = Number(args.seconds ?? 15);
const SCENARIO = args.scenario ?? 'health';
const CODE = args.code ?? '';
const WARMUP_MS = Number(args.warmup ?? 2000);

/** One request. Returns latency in ms plus the status, never throws. */
async function once(path, init) {
  const t0 = performance.now();
  try {
    const res = await fetch(URL_BASE + path, init);
    // Drain the body: leaving it unread skews latency and leaks sockets.
    await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, error: String(e?.cause?.code ?? e?.message ?? e) };
  }
}

const SCENARIOS = {
  /** Cheapest useful endpoint: proves the process is serving and touches SQLite. */
  health: () => once('/api/health'),
  /** A public read that hits the database by indexed lookup. */
  meeting: () => once(`/api/meetings/${CODE || 'aaa-bbbb-ccc'}`),
  /** The rate-limited path. This is the one that used to be a global bucket. */
  login: () =>
    once('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Intentionally wrong: we are measuring the limiter and the hash, not
      // trying to get in, and this creates nothing on the target.
      body: JSON.stringify({ email: `bench-${Math.random()}@example.invalid`, password: 'x'.repeat(12) }),
    }),
};

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

async function main() {
  const scenario = SCENARIOS[SCENARIO];
  if (!scenario) {
    console.error(`unknown scenario "${SCENARIO}" — one of: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(2);
  }

  console.log(`target      ${URL_BASE}`);
  console.log(`scenario    ${SCENARIO}`);
  console.log(`concurrency ${CONCURRENCY}`);
  console.log(`duration    ${SECONDS}s (after ${WARMUP_MS}ms warm-up)\n`);

  // Warm-up is not politeness: the first requests pay for TLS, DNS and
  // better-sqlite3's prepared-statement cache, and including them would put a
  // one-off cost into the tail percentiles.
  const warmEnd = Date.now() + WARMUP_MS;
  while (Date.now() < warmEnd) await scenario();

  const samples = [];
  const statuses = new Map();
  const errors = new Map();
  const stop = Date.now() + SECONDS * 1000;
  let inFlight = 0;

  const worker = async () => {
    while (Date.now() < stop) {
      inFlight++;
      const r = await scenario();
      inFlight--;
      samples.push(r.ms);
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      if (r.error) errors.set(r.error, (errors.get(r.error) ?? 0) + 1);
    }
  };

  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (performance.now() - started) / 1000;

  samples.sort((a, b) => a - b);
  const total = samples.length;
  const ok = (statuses.get(200) ?? 0) + (statuses.get(204) ?? 0);
  const limited = statuses.get(429) ?? 0;

  console.log(`requests    ${total} in ${elapsed.toFixed(1)}s`);
  console.log(`throughput  ${(total / elapsed).toFixed(1)} req/s`);
  console.log('');
  console.log(`latency p50 ${percentile(samples, 50).toFixed(1)} ms`);
  console.log(`        p95 ${percentile(samples, 95).toFixed(1)} ms`);
  console.log(`        p99 ${percentile(samples, 99).toFixed(1)} ms`);
  console.log(`        max ${samples[samples.length - 1]?.toFixed(1) ?? 0} ms`);
  console.log('');
  console.log('status');
  for (const [code, n] of [...statuses].sort((a, b) => b[1] - a[1])) {
    const pct = ((n / total) * 100).toFixed(1);
    console.log(`  ${code === 0 ? 'error' : code}       ${n} (${pct}%)`);
  }
  if (errors.size > 0) {
    console.log('\nerrors');
    for (const [e, n] of errors) console.log(`  ${e}: ${n}`);
  }

  // The headline number for the rate-limit work: before trustProxy every
  // client shared one bucket, so this would climb towards 100% with load no
  // matter how many distinct machines the traffic came from.
  console.log(`\nrate limited ${limited} (${((limited / total) * 100).toFixed(1)}%)`);
  console.log(`success      ${ok} (${((ok / total) * 100).toFixed(1)}%)`);

  if (args.json) {
    console.log('\n' + JSON.stringify({
      target: URL_BASE, scenario: SCENARIO, concurrency: CONCURRENCY,
      seconds: elapsed, requests: total, throughput: total / elapsed,
      p50: percentile(samples, 50), p95: percentile(samples, 95), p99: percentile(samples, 99),
      statuses: Object.fromEntries(statuses), rateLimited: limited,
    }));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
