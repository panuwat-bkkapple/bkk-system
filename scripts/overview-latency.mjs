// ---------------------------------------------------------------------------
// WHERE THE CUSTOMER'S WAIT ACTUALLY GOES.
//
//   node scripts/overview-latency.mjs --key <service-account.json>
//   node scripts/overview-latency.mjs --key <sa.json> --days 7
//
// READ-ONLY. It opens the archive and prints; it writes nothing, calls no
// model, and bills nothing. (The dry-run-by-default rule is about scripts
// with effects — this one has none to gate.)
//
// WHY THIS EXISTS
//
// The overview is two model calls in series, and "make it faster" has four
// candidate levers that are NOT interchangeable:
//
//   stage 1  extract   read the raw query -> ids        (extractMs)
//   stage 2  context   pure code, every number computed (not timed: it is µs)
//   stage 3  write     turn the context into prose      (latencyMs)
//
// If the wait is mostly stage 3, the lever is OUTPUT SIZE (an LLM's time
// scales with the tokens it writes) or streaming, and shrinking the prompt
// buys nothing. If it is mostly stage 1, the lever is the prompt the
// extractor reads. Guessing wrong means shipping a change that measures well
// in a benchmark and does nothing on the page.
//
// PROMPT CACHING IS NOT ON THAT LIST, AND THAT IS THE FINDING. The generator
// runs claude-haiku-4-5, whose minimum cacheable prefix is 4,096 tokens —
// below it a cache_control marker is accepted, costs nothing, and silently
// does nothing (cache_creation_input_tokens: 0, no error). The v2 writer's
// system prompt is 5,542 chars, 85% Thai; the extractor's is 1,682. Neither
// is comfortably over that line, and the traffic makes it worse: at the
// measured ~40 searches/day a 5-minute cache entry expires long before the
// next search reaches it, so nearly every request would pay the 1.25x WRITE
// premium and read it back zero times. Caching is for hot prefixes; this is
// a cold one.
//
// WHAT THE COLUMNS MEAN
//
//   extractMs   stage 1 only
//   latencyMs   stage 3 only (the timer is reset immediately before the call)
//   total       the sum — what the customer waits for, minus network
//   answerChars summary + detail, the size of what stage 3 wrote
//   ms/kchar    total time divided by answer size — if this is flat across
//               short and long answers, output length IS the cost driver
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, isAbsolute, resolve } from "path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The same module the archive writer uses to name its day buckets. Reached by
// explicit path for the reason spelled out at the firebase-admin require
// below: nothing under functions/ resolves by bare name from scripts/.
const { opsBangkokYmd } = require(join(root, "functions", "ops-dashboard.js"));

// ── pure helpers, unit-tested in functions/test/overview-latency.test.mjs ──

/** Nearest-rank percentile. Empty input is 0, not NaN — a column of NaN in a
 *  report reads as a broken script rather than as "no rows yet". */
export function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const rank = Math.ceil((p / 100) * xs.length);
  return xs[Math.min(Math.max(rank, 1), xs.length) - 1];
}

/** Pearson correlation. Returns null when it cannot be computed (fewer than
 *  two points, or one side constant) — null prints as "n/a", where 0 would
 *  read as "measured, and there is no relationship". */
export function correlation(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((s, [a]) => s + a, 0) / n;
  const my = pairs.reduce((s, [, b]) => s + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [a, b] of pairs) {
    sxy += (a - mx) * (b - my);
    sxx += (a - mx) ** 2;
    syy += (b - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** One archive row -> the numbers this report is about. Tolerant by design:
 *  v1 rows carry no extractMs, and a row written before a field existed is a
 *  real row, not a parse error. */
export function readRow(row) {
  if (!row || typeof row !== "object") return null;
  if (typeof row.latencyMs !== "number") return null;
  const answerChars = String(row.summary || "").length + String(row.detail || "").length;
  const extractMs = typeof row.extractMs === "number" ? row.extractMs : 0;
  return {
    v2: row.v2 === true,
    extractMs,
    latencyMs: row.latencyMs,
    total: extractMs + row.latencyMs,
    inputChars: typeof row.inputChars === "number" ? row.inputChars : 0,
    answerChars,
    model: String(row.model || ""),
    excised: typeof row.excised === "number" ? row.excised : 0,
  };
}

/**
 * The Bangkok day keys the archive is bucketed by, newest first.
 *
 * THE FORMATTER IS IMPORTED, NOT REWRITTEN. The first version of this file
 * built the key itself and produced "2026-08-23"; the writer produces
 * "20260823" (opsBangkokYmd ends in .replace(/-/g, "")). Every read hit a
 * path that does not exist, and the report said "0 answer rows" — which
 * reads exactly like a quiet week. Two dozen rows were sitting one string
 * format away.
 *
 * The test written for that first version asserted the dashed form, because
 * it was written from what the key ought to look like instead of from the
 * function that writes it. It passed, and proved nothing. Importing the
 * writer's own formatter is what makes the two impossible to disagree.
 *
 * Passed a clock rather than reading one, so the report is reproducible.
 */
export function bangkokDays(nowMs, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(opsBangkokYmd(nowMs - i * 86400000));
  return out;
}

export function summarize(rows) {
  const col = (key) => rows.map((r) => r[key]);
  return {
    n: rows.length,
    extract: { p50: percentile(col("extractMs"), 50), p90: percentile(col("extractMs"), 90) },
    write: { p50: percentile(col("latencyMs"), 50), p90: percentile(col("latencyMs"), 90) },
    total: { p50: percentile(col("total"), 50), p90: percentile(col("total"), 90), p95: percentile(col("total"), 95) },
    answerChars: { p50: percentile(col("answerChars"), 50), p90: percentile(col("answerChars"), 90) },
    // The context the writer READ, as production actually built it. Collected
    // from the first version for the correlation below but never printed,
    // which left the one question the correlation raises — "is 0.57 pointing
    // at a prompt that is big, or at one that merely varies?" — unanswerable
    // from the report that raised it.
    inputChars: {
      p50: percentile(col("inputChars"), 50),
      p90: percentile(col("inputChars"), 90),
      max: percentile(col("inputChars"), 100),
    },
    // The lever test. Strong positive = the answer's LENGTH drives the wait,
    // so the lever is output size. Near zero = the wait is fixed overhead and
    // trimming the prompt or the answer will not move it.
    lengthVsTime: correlation(col("answerChars"), col("latencyMs")),
    inputVsTime: correlation(col("inputChars"), col("latencyMs")),
  };
}

const pct = (v) => (v === null ? "n/a" : v.toFixed(2));
const ms = (v) => `${Math.round(v)}ms`;

function report(label, s) {
  if (!s.n) {
    console.log(`\n${label}: no rows`);
    return;
  }
  console.log(`\n${label} — ${s.n} answers`);
  console.log(`  stage 1 extract   p50 ${ms(s.extract.p50)}   p90 ${ms(s.extract.p90)}`);
  console.log(`  stage 3 write     p50 ${ms(s.write.p50)}   p90 ${ms(s.write.p90)}`);
  console.log(`  TOTAL             p50 ${ms(s.total.p50)}   p90 ${ms(s.total.p90)}   p95 ${ms(s.total.p95)}`);
  console.log(`  answer size       p50 ${s.answerChars.p50} chars   p90 ${s.answerChars.p90} chars`);
  console.log(`  prompt context    p50 ${s.inputChars.p50} chars   p90 ${s.inputChars.p90}   max ${s.inputChars.max}`);
  console.log(`  corr(answer length, write time) = ${pct(s.lengthVsTime)}`);
  console.log(`  corr(prompt size,   write time) = ${pct(s.inputVsTime)}`);
  const share = s.total.p50 ? Math.round((s.write.p50 / s.total.p50) * 100) : 0;
  console.log(`  -> stage 3 is ${share}% of the median wait`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  };
  const keyPath = opt("key") || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const days = Number(opt("days") || 7);
  if (!keyPath || !existsSync(keyPath)) {
    console.error("need a service account: --key <path.json> (or GOOGLE_APPLICATION_CREDENTIALS)");
    process.exit(2);
  }

  // firebase-admin lives ONLY in functions/node_modules — nothing installs it
  // at the repo root. Requiring it by bare module name from scripts/ walks
  // scripts/ -> repo root -> / and finds nothing (MODULE_NOT_FOUND), so every
  // script here that touches RTDB points at that path explicitly:
  // audit-payouts.cjs, strip-ledger-emails.cjs, backfill-image-cache-control.cjs.
  const admin = require(join(root, "functions", "node_modules", "firebase-admin"));
  const cred = require(isAbsolute(keyPath) ? keyPath : resolve(process.cwd(), keyPath));
  admin.initializeApp({
    credential: admin.credential.cert(cred),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app",
  });
  const db = admin.database();

  const rows = [];
  // One read per DAY, not one per row: the archive is bucketed by Bangkok day
  // and pulling a whole bucket is a single download. Reading rows one at a
  // time would be the RTDB cost rule broken by a reporting tool.
  for (const day of bangkokDays(Date.now(), days)) {
    const snap = await db.ref(`search_overview_archive/${day}`).once("value");
    const bucket = snap.val() || {};
    for (const raw of Object.values(bucket)) {
      const r = readRow(raw);
      if (r) rows.push(r);
    }
  }

  console.log(`search_overview_archive — last ${days} day(s), ${rows.length} answer rows`);
  report("v2 (extract + write)", summarize(rows.filter((r) => r.v2)));
  report("v1 (write only)", summarize(rows.filter((r) => !r.v2)));

  const models = new Map();
  for (const r of rows) models.set(r.model, (models.get(r.model) || 0) + 1);
  console.log("\nmodels seen:", [...models].map(([m, n]) => `${m} x${n}`).join(", ") || "none");
  await admin.app().delete();
}

// Only when invoked directly — importing this file for its helpers must not
// open a database connection.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
