// ---------------------------------------------------------------------------
// The two brakes added around the overview generator: a per-client hourly
// limit, and a sweep for the nodes that otherwise only grow.
//
//   node functions/test/search-overview-rate-gc.test.mjs
//
// What is really being tested here is the SAFE DIRECTION of each decision.
// Both of these are protective structures, and a protective structure that
// fails closed can cause the outage it was built to prevent — so most of the
// assertions below are about what happens when something goes wrong.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../search-overview.js");
const {
  sanitizeClientKey,
  bangkokHourBucket,
  clientOverBudget,
  runCacheGc,
  runRateBucketGc,
  CACHE_GC_BATCH,
  DEFAULT_CLIENT_HOURLY_LIMIT,
} = __test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

/** A counter node backed by a plain object, with transaction semantics. */
const counterDb = (store = {}, { failOn } = {}) => ({
  ref(path) {
    return {
      async transaction(fn) {
        if (failOn && path.includes(failOn)) throw new Error("rtdb down");
        const next = fn(store[path]);
        store[path] = next;
        return { snapshot: { val: () => next } };
      },
    };
  },
  __store: store,
});

const KEY = "a".repeat(32);

// ---------------------------------------------------------------------------
// sanitizeClientKey — what may be used as a database key
// ---------------------------------------------------------------------------
{
  check("accepts a hex hash", sanitizeClientKey(KEY) === KEY);
  check("lowercases", sanitizeClientKey("ABCDEF0123456789") === "abcdef0123456789");
  // The website sends a hash. Anything else is a mistake or an attempt to
  // write somewhere it should not — and this value becomes a path segment.
  check("rejects a path traversal", sanitizeClientKey("../../settings") === "");
  check("rejects a raw IP", sanitizeClientKey("203.0.113.9") === "");
  check("rejects something too short to be a hash", sanitizeClientKey("abc") === "");
  check("rejects nothing at all", sanitizeClientKey(undefined) === "" && sanitizeClientKey(null) === "");
}

// ---------------------------------------------------------------------------
// clientOverBudget — the limit itself
// ---------------------------------------------------------------------------
{
  const db = counterDb();
  const under = [];
  for (let i = 0; i < 3; i++) under.push(await clientOverBudget(db, "t", KEY, 3));
  check("lets a client through up to the limit", under.every((v) => v === false));
  check("stops the one after", (await clientOverBudget(db, "t", KEY, 3)) === true);
}

{
  // NO KEY, NO LIMIT. The only fallback available to this function is the
  // request IP, which belongs to Vercel — every customer in the world would
  // share one bucket and the whole site would cap at thirty an hour. An
  // unidentified caller is therefore not throttled at all.
  const db = counterDb();
  const results = [];
  for (let i = 0; i < 50; i++) results.push(await clientOverBudget(db, "t", "", 1));
  check("never throttles an unidentified caller", results.every((v) => v === false));
  check("and writes no counter for one", Object.keys(db.__store).length === 0);
}

{
  // FAIL-OPEN. A counter that cannot be written must not become an outage:
  // the daily cap is still standing behind this one.
  const db = counterDb({}, { failOn: "overview_rate" });
  check("allows the call when the counter cannot be written", (await clientOverBudget(db, "t", KEY, 1)) === false);
}

{
  const db = counterDb();
  check("a limit of zero disables the check", (await clientOverBudget(db, "t", KEY, 0)) === false);
  check("so does a nonsense limit", (await clientOverBudget(db, "t", KEY, NaN)) === false);
  check("default ceiling is 30/hour", DEFAULT_CLIENT_HOURLY_LIMIT === 30);
}

{
  // Two clients are two budgets — one noisy source must not spend another
  // reader's allowance.
  const db = counterDb();
  const other = "b".repeat(32);
  for (let i = 0; i < 5; i++) await clientOverBudget(db, "t", KEY, 5);
  check("one client hitting the wall does not block another", (await clientOverBudget(db, "t", other, 5)) === false);
}

// ---------------------------------------------------------------------------
// bangkokHourBucket — the window
// ---------------------------------------------------------------------------
{
  const noon = Date.UTC(2026, 7, 19, 5, 0, 0); // 12:00 Bangkok
  check("buckets by Bangkok hour", bangkokHourBucket(noon) === "2026081912");
  check("the same hour is the same bucket", bangkokHourBucket(noon + 59 * 60000) === bangkokHourBucket(noon));
  check("the next hour is a new budget", bangkokHourBucket(noon + 3600000) === "2026081913");
  // Sorted lexically by the sweep below, so the digits must stay fixed width.
  check("stays sortable across a month boundary", bangkokHourBucket(Date.UTC(2026, 8, 1, 0, 0, 0)) === "2026090107");
}

// ---------------------------------------------------------------------------
// runCacheGc — deleting answers whose hour is up
// ---------------------------------------------------------------------------
const cacheDb = (rows) => {
  const captured = {};
  const node = {
    orderByChild() { return node; },
    endAt(bound) { node.__bound = bound; return node; },
    limitToFirst(n) { node.__limit = n; return node; },
    async once() {
      const keys = Object.keys(rows)
        .filter((k) => Number(rows[k].expires_at) <= node.__bound)
        .slice(0, node.__limit);
      return {
        forEach(fn) {
          for (const k of keys) fn({ key: k, val: () => rows[k] });
        },
      };
    },
    async update(patch) { Object.assign(captured, patch); },
  };
  return { db: { ref: () => node }, captured };
};

{
  const now = Date.now();
  const { db, captured } = cacheDb({
    stale1: { expires_at: now - 1000, summary: "x" },
    stale2: { expires_at: now - 5000, summary: "y" },
    fresh: { expires_at: now + 60000, summary: "z" },
  });
  const out = await runCacheGc(db, "t");
  check("deletes only what has expired", captured.stale1 === null && captured.stale2 === null);
  check("leaves a live answer alone", !("fresh" in captured));
  check("reports what it saw and what it removed", out.deleted === 2 && out.scanned === 2);
}

{
  // A row with no expiry is MALFORMED, not expired. Deleting data because a
  // field is missing is how a cleanup becomes data loss.
  const now = Date.now();
  const { db, captured } = cacheDb({ broken: { summary: "no expiry" } });
  const out = await runCacheGc(db, "t");
  check("never deletes a row with no expiry", !("broken" in captured) && out.deleted === 0);
  void now;
}

{
  check("caps a sweep so the first one cannot spike", CACHE_GC_BATCH === 500);
  const rows = {};
  for (let i = 0; i < 600; i++) rows[`k${i}`] = { expires_at: 1 };
  const { db, captured } = cacheDb(rows);
  const out = await runCacheGc(db, "t");
  check("stops at the batch size, leaving the rest for tomorrow", out.deleted === CACHE_GC_BATCH);
  check("and the leftovers are untouched", Object.keys(captured).length === CACHE_GC_BATCH);
}

// ---------------------------------------------------------------------------
// runRateBucketGc — yesterday's hour buckets
// ---------------------------------------------------------------------------
{
  const captured = {};
  const old = bangkokHourBucket(Date.now() - 96 * 3600000);
  const recent = bangkokHourBucket(Date.now() - 1 * 3600000);
  const current = bangkokHourBucket();
  const node = {
    async once() {
      return {
        forEach(fn) {
          for (const k of [old, recent, current]) fn({ key: k, val: () => ({}) });
        },
      };
    },
    async update(patch) { Object.assign(captured, patch); },
  };
  const out = await runRateBucketGc({ ref: () => node });
  check("drops a bucket well past its window", captured[old] === null);
  check("keeps the hour in progress", !(current in captured));
  check("keeps recent hours, so a clock skew cannot erase a live budget", !(recent in captured));
  check("reports its count", out.deleted === 1);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
