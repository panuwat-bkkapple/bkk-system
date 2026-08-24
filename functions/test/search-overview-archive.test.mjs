// ---------------------------------------------------------------------------
// Offline unit test for the answer archive of customerSearchOverview.
// No API key, no Firebase — the builders are pure and the writer runs against
// a fake db.
//
//   node functions/test/search-overview-archive.test.mjs
//
// THE ONE RULE THIS SUITE EXISTS TO ENFORCE: the customer's question is owned
// by the search analytics table in Firestore, where it is redacted on the way
// in and deleted after 90 days. Nothing written by this file may contain it.
// Two stores of customer questions with two retentions and two redaction
// rules is the failure mode; the assertions below walk every field of every
// row looking for it rather than checking the fields we happened to think of.
//
// The second rule: archiving is not part of answering. A dead archive must
// cost a customer nothing, so the writer is checked for returning before its
// write settles and for surviving a db that throws outright.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../search-overview.js");
const {
  buildCacheRow,
  buildArchiveAnswerRow,
  buildArchiveSkipRow,
  buildArchiveHitRow,
  archiveWrite,
  archiveGateSkip,
  ARCHIVE_ROOT,
  runArchiveGc,
  ARCHIVE_RETENTION_DAYS,
  ARCHIVE_GC_WINDOW_DAYS,
} = __test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// A question with something identifying in it, so a leak is unmistakable.
const QUERY = "iphone 15 pro max ราคาเท่าไหร่ โทร 0812345678";
const TS = 1_755_000_000_000;

/** Every string anywhere in a value, at any depth. */
function allStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}

/**
 * Does this row carry the customer's question?
 *
 * NOT "does it contain any word the customer used". Our own answer says
 * "รับซื้อ iPhone 15 Pro Max สูงสุด 34,000 บาท", and the device name in that
 * sentence is our catalog vocabulary priced from our own data — it is there
 * because we wrote it, not because they typed it. A check that flagged it
 * would have to be satisfied by not storing the answer, which is the one
 * thing this archive exists to keep.
 *
 * So the needles are the things that can only have come from the customer:
 * the raw string itself, the contact detail inside it, and the interrogative
 * phrasing that a generated summary never uses.
 */
const NEEDLES = [QUERY, "0812345678", "ราคาเท่าไหร่"];
function leaksQuery(row) {
  return allStrings(row).some((s) =>
    NEEDLES.some((n) => s.toLowerCase().includes(n.toLowerCase()))
  );
}

/**
 * The structural half, which does not depend on guessing needles at all:
 * no field ANYWHERE may be named like a place a question would be put. This
 * is what catches a future edit that adds `query` back under a new parent.
 */
const FORBIDDEN_KEYS = /^(query|q|q_norm|raw|text|question|prompt|context|messages|input|uid)$/i;
function forbiddenKeysIn(value, path = "", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => forbiddenKeysIn(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(k)) out.push(`${path}.${k}`);
      forbiddenKeysIn(v, `${path}.${k}`, out);
    }
  }
  return out;
}

/** A db whose writes resolve, recording what was asked of it. */
function fakeDb() {
  const calls = [];
  let settle;
  const gate = new Promise((r) => { settle = r; });
  return {
    calls,
    releaseWrites: settle,
    ref(path) {
      return {
        set: (v) => { calls.push({ path, op: "set", value: v }); return gate; },
        update: (v) => { calls.push({ path, op: "update", value: v }); return gate; },
        transaction: (fn) => { calls.push({ path, op: "transaction", value: fn(null) }); return gate; },
      };
    },
  };
}

// ─── 1. the answer row ──────────────────────────────────────────────────────
{
  const row = buildArchiveAnswerRow({
    model: "claude-haiku-4-5",
    latencyMs: 1234,
    inputChars: 4096,
    summary: "รับซื้อ iPhone 15 Pro Max สูงสุด 34,000 บาท",
    detail: "รายละเอียดยาวกว่านี้",
    topics: ["delivery"],
    ts: TS,
  });

  check(
    "answer row has exactly the generator-only fields (+ the origin dimension)",
    JSON.stringify(Object.keys(row).sort()) ===
      JSON.stringify(["detail", "inputChars", "latencyMs", "model", "origin", "summary", "topics", "ts"])
  );
  // The channel dimension, stamped before the second channel opens (Ops
  // Dashboard chunk) — this archive only ever holds search answers today.
  check("answer row is stamped origin=search", row.origin === "search");
  check("answer row keeps the model", row.model === "claude-haiku-4-5");
  check("answer row keeps latency and prompt size", row.latencyMs === 1234 && row.inputChars === 4096);
  check("answer row keeps OUR text (the half worth reviewing)", row.summary.includes("34,000"));
  check("answer row does not leak the question", !leaksQuery(row));
  // Our own sentence naming the device is expected and allowed — see the note
  // on leaksQuery. What must never appear is a field to put a question in.
  check("answer row keeps the device name it priced", row.summary.includes("iPhone 15 Pro Max"));
  check("answer row has no question-shaped field", forbiddenKeysIn(row).length === 0);

  // The context is what the prompt was built from and it wraps the question,
  // so its SIZE is archived and its text never is.
  const withContext = buildArchiveAnswerRow({
    model: "m", latencyMs: 1, inputChars: 10, summary: "s", detail: "d", topics: [], ts: TS,
  });
  check("answer row has no context field at all", !("context" in withContext) && !("query" in withContext));
}

// ─── 1b. which phrases the answer highlighted ───────────────────────────────
//
// Added because "no highlight on the card" was unreadable from the archive:
// a writer that chose to mark nothing (allowed) and a writer that marked
// three phrases and then wrote all three differently in the prose (a silent,
// repeating failure) produced the same row.
{
  const SUMMARY = "iPhone 15 Pro Max รับซื้อสูงสุด 34,000 บาทครับ";
  const DETAIL = "ราคาลดลง 8% ในเดือนที่ผ่านมาครับ";
  const row = buildArchiveAnswerRow({
    model: "claude-haiku-4-5", latencyMs: 1, inputChars: 10,
    summary: SUMMARY, detail: DETAIL, topics: [], ts: TS,
    v2: true, extractModel: "claude-haiku-4-5", extractMs: 200,
    keyPoints: ["iPhone 15 Pro Max รับซื้อสูงสุด 34,000 บาท", "ราคาลดลง 8%"],
    keyPointsDropped: 1,
  });

  // Defensively shaped: if the field stops being written, this must read as a
  // named failure, not a TypeError that takes the whole file down with it.
  check("v2 row records the phrases that were highlighted", Array.isArray(row.key_points) && row.key_points.length === 2);
  check("v2 row records how many were proposed and lost", row.key_points_dropped === 1);

  // THE PROPERTY THAT MAKES THIS SAFE, asserted rather than promised: an
  // admitted key point is a verbatim slice of text this row already carries,
  // so it cannot introduce anything new to a node whose one rule is that the
  // customer's words never reach it.
  const stored = `${row.summary}\n${row.detail}`;
  check(
    "every stored phrase is a slice of text already on the row",
    Array.isArray(row.key_points) && row.key_points.every((k) => stored.includes(k))
  );
  check("the rejected phrases themselves are NOT stored, only counted", !("key_points_rejected" in row));
  check("still no question-shaped field", forbiddenKeysIn(row).length === 0);
  check("still no leak", !leaksQuery(row));

  // Absent rather than empty: a row that marked nothing says so by having
  // neither field, which is also how a v1 row looks.
  const none = buildArchiveAnswerRow({
    model: "m", latencyMs: 1, inputChars: 1, summary: "s", detail: "", topics: [], ts: TS,
    v2: true, extractModel: "m", extractMs: 1, keyPoints: [], keyPointsDropped: 0,
  });
  check("nothing highlighted leaves both fields off", !("key_points" in none) && !("key_points_dropped" in none));

  // v1 has no key points at all, and its row shape is pinned above.
  const v1 = buildArchiveAnswerRow({
    model: "m", latencyMs: 1, inputChars: 1, summary: "s", detail: "", topics: [], ts: TS,
    keyPoints: ["s"], keyPointsDropped: 2,
  });
  check("a v1 row never grows the v2 fields", !("key_points" in v1) && !("key_points_dropped" in v1));
}

// ─── 1c. the sweep: old days go, and nothing is read to find them ───────────
{
  const NOW = Date.parse("2026-08-21T12:00:00Z");
  const reads = [];
  const writes = [];
  const db = {
    ref(path) {
      reads.push(path);
      return {
        once: () => { throw new Error("the sweep must not read the archive"); },
        update: (v) => { writes.push({ path, value: v }); return Promise.resolve(); },
      };
    },
  };

  const out = await runArchiveGc(db, NOW);
  const [{ path, value }] = writes;
  const keys = Object.keys(value);

  check("sweeps at the archive root, in one multi-path update", writes.length === 1 && path === ARCHIVE_ROOT);
  check("every path is a delete", Object.values(value).every((v) => v === null));
  check("covers exactly the window", keys.length === ARCHIVE_GC_WINDOW_DAYS && out.days === keys.length);

  // The two edges that decide whether a customer's answer outlives the
  // question it belongs to: yesterday must survive, retention+1 must not.
  const ymd = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  check("today and yesterday are untouched", !keys.includes(ymd(NOW)) && !keys.includes(ymd(NOW - 86400000)));
  check(
    "the day just inside retention is untouched",
    !keys.includes(ymd(NOW - (ARCHIVE_RETENTION_DAYS - 1) * 86400000))
  );
  check(
    "the first day past retention is deleted",
    keys.includes(ymd(NOW - ARCHIVE_RETENTION_DAYS * 86400000))
  );
  check("retention matches the Firestore half it is joined to", ARCHIVE_RETENTION_DAYS === 90);
}

// ─── 2. refusals: every reason, no text ─────────────────────────────────────
{
  const reasons = [
    "cap_reached", "suspended", "disabled", "no_api_key",
    "settings_unavailable", "unparseable", "timeout", "error",
  ];
  let ok = true;
  for (const r of reasons) {
    const row = buildArchiveSkipRow(r, TS);
    if (row.skipped !== r || row.ts !== TS) ok = false;
    if (Object.keys(row).length !== 3) ok = false;
    if (row.origin !== "search") ok = false;
    if (leaksQuery(row)) ok = false;
  }
  check(`refusal rows carry reason + ts + origin only, for all ${reasons.length} reasons`, ok);
  check("an unknown reason still produces a row", buildArchiveSkipRow(undefined, TS).skipped === "unknown");
}

// ─── 3. cache hit: counts reuse without ever rewriting the answer ───────────
{
  const answer = buildArchiveAnswerRow({
    model: "claude-haiku-4-5", latencyMs: 900, inputChars: 100,
    summary: "รับซื้อ iPhone 15 Pro Max สูงสุด 34,000 บาท", detail: "d",
    topics: [], ts: TS,
  });

  const first = buildArchiveHitRow(answer, TS + 60_000);
  check("a hit keeps the answer text", first.summary === answer.summary && first.detail === "d");
  check("a hit keeps the answer's own timestamp", first.ts === TS);
  check("a hit stamps when it happened", first.lastHitTs === TS + 60_000);
  check("first hit on an answered row counts 1", first.hits === 1);
  check("second hit counts 2", buildArchiveHitRow(first, TS + 120_000).hits === 2);
  check("a hit does not leak the question", !leaksQuery(first));

  // The case the K5 follow-up called out: a cache entry written before this
  // archive existed (or yesterday, across midnight) has no row to bump.
  const orphan = buildArchiveHitRow(null, TS);
  check(
    "an orphan hit seeds hits/lastHitTs/ts/origin and nothing else",
    JSON.stringify(Object.keys(orphan).sort()) === JSON.stringify(["hits", "lastHitTs", "origin", "ts"])
  );
  check("an orphan hit carries no answer", !("summary" in orphan) && !("detail" in orphan));
  check("an orphan hit starts at 1", orphan.hits === 1);
  check("an orphan hit has a timestamp of its own", orphan.ts === TS);

  // A malformed existing row must not turn into NaN.
  check("a row with a junk hit count recovers", buildArchiveHitRow({ hits: "x" }, TS).hits === 1);

  const db = fakeDb();
  archiveWrite(db, "t", `${ARCHIVE_ROOT}/2026-08-17/abc123`, (ref) =>
    ref.transaction((cur) => buildArchiveHitRow(cur, TS))
  );
  check("hit is written as a transaction, not a blind write", db.calls[0].op === "transaction");
  check("hit lands under the day bucket and the hash", db.calls[0].path === `${ARCHIVE_ROOT}/2026-08-17/abc123`);
  db.releaseWrites();
}

// ─── 4. pre-hash refusals become per-reason day counters ────────────────────
{
  const db = fakeDb();
  archiveGateSkip(db, "t", "2026-08-17", "suspended");
  check("gate refusal is counted per reason per day", db.calls[0].path === `${ARCHIVE_ROOT}/2026-08-17/_gate/suspended`);
  check("gate refusal writes a counter, not a row", db.calls[0].op === "set" && typeof db.calls[0].value === "object");
  check("gate refusal carries no text", !leaksQuery(db.calls[0]));
  db.releaseWrites();
}

// ─── 5. the cache row no longer carries the raw query ───────────────────────
{
  const row = buildCacheRow({ summary: "s", detail: "d", now: TS });
  check(
    "cache row is summary/detail/created_at/expires_at only",
    JSON.stringify(Object.keys(row).sort()) === JSON.stringify(["created_at", "detail", "expires_at", "summary"])
  );
  // The field this change removed. Nothing ever read it — the lookup uses
  // expires_at/summary/detail — and it was raw, unredacted customer text.
  check("cache row has no query field", !("query" in row));
  check("cache row expiry is stamped forward", row.expires_at > row.created_at);
}

// ─── 6. fire-and-forget: never blocks, never throws ─────────────────────────
{
  const db = fakeDb();
  let returned = false;
  let settled = false;
  const p = new Promise((resolve) => {
    db.ref = () => ({
      update: () => new Promise((r) => setTimeout(() => { settled = true; r(); resolve(); }, 30)),
    });
    archiveWrite(db, "t", "p", (ref) => ref.update({ a: 1 }));
    returned = true;
  });
  check("archiveWrite returns before its write settles", returned === true && settled === false);
  await p;

  // A rejected write must be swallowed. If it were not, an unhandled rejection
  // would take the function instance down AFTER the customer already had
  // their answer — the worst possible time to fail.
  let threw = false;
  try {
    archiveWrite({ ref: () => ({ update: () => Promise.reject(new Error("permission denied")) }) }, "t", "p",
      (r) => r.update({}));
  } catch { threw = true; }
  check("a rejected archive write does not throw", threw === false);

  // And a db that blows up on ref() itself — the case a try/catch around the
  // promise alone would miss.
  let threw2 = false;
  try {
    archiveWrite({ ref: () => { throw new Error("db gone"); } }, "t", "p", (r) => r.update({}));
  } catch { threw2 = true; }
  check("a db that throws on ref() does not throw", threw2 === false);

  // A writer that returns nothing at all (not a promise) must not crash.
  let threw3 = false;
  try {
    archiveWrite({ ref: () => ({ update: () => undefined }) }, "t", "p", (r) => r.update({}));
  } catch { threw3 = true; }
  check("a non-promise return does not throw", threw3 === false);
}

// ─── 7. the whole-shape sweep ───────────────────────────────────────────────
{
  const rows = [
    buildArchiveAnswerRow({
      model: "claude-haiku-4-5", latencyMs: 10, inputChars: 20,
      summary: "สรุปของเรา", detail: "รายละเอียดของเรา", topics: ["branches"], ts: TS,
    }),
    buildArchiveSkipRow("cap_reached", TS),
    buildArchiveHitRow(null, TS),
    buildArchiveHitRow({ summary: "สรุปของเรา", ts: TS, hits: 1 }, TS),
    buildCacheRow({ summary: "s", detail: "d", now: TS }),
  ];
  check("no row of any kind contains the customer's question", rows.every((r) => !leaksQuery(r)));
  const named = rows.flatMap((r) => forbiddenKeysIn(r));
  check(`no row of any kind has a question-shaped field${named.length ? ` (found ${named.join(", ")})` : ""}`, named.length === 0);
}

// THE FIELD NAMES THEMSELVES. Reading `input_tokens` where
// `cache_read_input_tokens` was meant yields a plausible number, no error,
// and a permanent report of zero hits — the same shape as caching simply not
// working, so nobody would look at the code.
{
  const u = {
    cache_read_input_tokens: 14646,
    cache_creation_input_tokens: 0,
    input_tokens: 812,
    output_tokens: 40,
  };
  const got = __test.cacheUsageOf(u);
  check("usage: read comes from cache_read_input_tokens", got.read === 14646);
  check("usage: write comes from cache_creation_input_tokens", got.write === 0);
  // The decoys have to be distinguishable, or the assertion above proves
  // nothing about WHICH field was read.
  check("usage: and not from input_tokens", got.read !== u.input_tokens && got.write !== u.input_tokens);
  check(
    "usage: a cold write reads back on the write side",
    __test.cacheUsageOf({ cache_creation_input_tokens: 14646, input_tokens: 812 }).write === 14646
  );
  check("usage: a missing usage object is zeros, not a throw", (() => {
    const z = __test.cacheUsageOf(undefined);
    return z.read === 0 && z.write === 0;
  })());
}

// ---------------------------------------------------------------------------
// STAGE 1's CACHE ACCOUNTING REACHES THE ARCHIVE.
//
// Injection-testing the caching change found this gap: deleting the two lines
// that write these fields left every other suite green. That is the worst
// shape a gap can have, because the report downstream then prints
//
//   extract cache      no rows carry the field yet (shipped after these answers)
//
// which is the BENIGN message — indistinguishable from "this ran before
// caching existed". The feature would look un-shipped rather than broken.
//
// The zeros matter as much as the hits: every way prompt caching fails is a
// silent zero, so a row that omits the field when nothing cached destroys
// exactly the reading these exist to give.
// ---------------------------------------------------------------------------
{
  const base = {
    model: "claude-haiku-4-5",
    latencyMs: 1000,
    inputChars: 10,
    summary: "s",
    detail: "",
    topics: [],
    ts: 1,
  };
  const hit = __test.buildArchiveAnswerRow({
    ...base,
    v2: true,
    extractModel: "claude-haiku-4-5",
    extractMs: 900,
    extractCacheRead: 14646,
    extractCacheWrite: 0,
  });
  check("archive: a cache hit is recorded", hit.extract_cache_read === 14646);
  check("archive: and the write side with it", hit.extract_cache_write === 0);

  const miss = __test.buildArchiveAnswerRow({
    ...base,
    v2: true,
    extractModel: "claude-haiku-4-5",
    extractMs: 2200,
    extractCacheRead: 0,
    extractCacheWrite: 14646,
  });
  // Present-and-zero, never absent: absent is what the report reads as
  // "predates the feature".
  check("archive: a miss writes 0, it does not omit the field", miss.extract_cache_read === 0);
  check("archive: the write that filled the cache is recorded", miss.extract_cache_write === 14646);
  check(
    "archive: both keys exist on a v2 row even when nothing cached at all",
    (() => {
      const cold = __test.buildArchiveAnswerRow({ ...base, v2: true, extractModel: "m", extractMs: 1 });
      return "extract_cache_read" in cold && "extract_cache_write" in cold;
    })()
  );
  // v1 has no stage 1 to account for.
  check(
    "archive: a v1 row carries neither",
    (() => {
      const v1 = __test.buildArchiveAnswerRow(base);
      return !("extract_cache_read" in v1) && !("extract_cache_write" in v1);
    })()
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
