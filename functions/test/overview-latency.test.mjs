// ---------------------------------------------------------------------------
// THE MATH BEHIND THE LATENCY REPORT.
//
//   node functions/test/overview-latency.test.mjs
//
// The report exists to CHOOSE a lever — output size, streaming, or the
// extractor's prompt — and a report that quietly computes the wrong number
// picks the wrong one, then a day is spent optimising something that was
// never the cost. So the arithmetic is tested against cases with known
// answers, and the two "cannot compute" paths are pinned: they must read as
// n/a, never as a confident zero.
//
// Also pins that importing the script does not open a database connection —
// this file importing it IS that test.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { percentile, correlation, readRow, bangkokDays, summarize, parseSince, splitAt, MIN_SAMPLE } from "../../scripts/overview-latency.mjs";

const require = createRequire(import.meta.url);

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// ── percentile ─────────────────────────────────────────────────────────────

check("percentile: median of an odd set", percentile([3, 1, 2], 50) === 2);
check("percentile: p90 of 1..10 is 9", percentile([1,2,3,4,5,6,7,8,9,10], 90) === 9);
check("percentile: p100 is the max", percentile([5, 1, 9], 100) === 9);
check("percentile: sorts numerically, not as strings", percentile([9, 10, 100], 50) === 10);
// A NaN column would otherwise poison every downstream comparison silently.
check("percentile: empty is 0, not NaN", percentile([], 50) === 0);
check("percentile: ignores non-numbers", percentile([1, undefined, 3, null], 100) === 3);

// ── correlation ────────────────────────────────────────────────────────────

const near = (a, b) => a !== null && Math.abs(a - b) < 1e-9;
check("correlation: perfect positive is 1", near(correlation([1,2,3], [2,4,6]), 1));
check("correlation: perfect negative is -1", near(correlation([1,2,3], [6,4,2]), -1));
// The distinction the report depends on: "no relationship" and "cannot say"
// must not print the same thing.
check("correlation: a constant column is n/a, not 0", correlation([1,1,1], [1,2,3]) === null);
check("correlation: one point is n/a", correlation([1], [1]) === null);
check("correlation: no points is n/a", correlation([], []) === null);

// ── readRow: tolerant of every archive vintage ─────────────────────────────

const v2row = readRow({ v2: true, latencyMs: 900, extractMs: 300, summary: "abc", detail: "de", inputChars: 1200, model: "claude-haiku-4-5" });
check("readRow: totals the two model calls", v2row.total === 1200);
check("readRow: answer size is summary + detail", v2row.answerChars === 5);

// v1 rows predate extractMs entirely — they are real rows, not parse errors.
const v1row = readRow({ latencyMs: 800, summary: "x", detail: "" });
check("readRow: a v1 row has no extract stage", v1row.v2 === false && v1row.extractMs === 0);
check("readRow: and its total is the write alone", v1row.total === 800);

check("readRow: a skip row (no latency) is dropped", readRow({ skipped: "cap_reached" }) === null);
check("readRow: garbage is dropped", readRow(null) === null && readRow("x") === null);

// ── the day keys the archive is bucketed by ────────────────────────────────
//
// THIS BLOCK IS WHY THE FIRST REPORT SAID "0 answer rows" ON A DATABASE WITH
// TWO DOZEN OF THEM. The old assertion read `days[0] === "2026-08-24"` —
// written from what a date key ought to look like, not from the function that
// writes one. The writer's opsBangkokYmd ends in .replace(/-/g, ""), so every
// real bucket is "20260824". The test passed, the reader read paths that do
// not exist, and an empty result is indistinguishable from a quiet week.
//
// So the expectation now comes from the WRITER, not from this file's opinion.
// If the archive ever changes how it names a day, this goes red instead of
// the report going quietly empty.

const { opsBangkokYmd } = require("../ops-dashboard.js");

const AFTERNOON_UTC = Date.parse("2026-08-23T18:00:00Z"); // already the 24th in Bangkok
const days = bangkokDays(AFTERNOON_UTC, 3);
check(
  "bangkokDays: matches the key the archive writer actually uses",
  days[0] === opsBangkokYmd(AFTERNOON_UTC)
);
check(
  "bangkokDays: every key matches the writer's, not just the first",
  days.every((d, i) => d === opsBangkokYmd(AFTERNOON_UTC - i * 86400000))
);
// The two properties the format check cannot see on its own.
check("bangkokDays: uses Bangkok's day, not UTC's", days[0] === "20260824");
check("bangkokDays: walks backwards, newest first", days.join(",") === "20260824,20260823,20260822");

// ── summarize: the shape the report prints ─────────────────────────────────

const rows = [
  readRow({ v2: true, latencyMs: 1000, extractMs: 200, summary: "a".repeat(100), detail: "" }),
  readRow({ v2: true, latencyMs: 2000, extractMs: 400, summary: "a".repeat(200), detail: "" }),
  readRow({ v2: true, latencyMs: 3000, extractMs: 600, summary: "a".repeat(300), detail: "" }),
];
const s = summarize(rows);
check("summarize: counts the rows", s.n === 3);
check("summarize: median total", s.total.p50 === 2400);
// The whole point of the column: longer answers took longer here, so the
// lever is output size.
check("summarize: reports length as the driver when it is", near(s.lengthVsTime, 1));
check("summarize: an empty set summarizes to zeros, not NaN", summarize([]).n === 0 && summarize([]).total.p50 === 0);

// The context size is REPORTED, not merely correlated. Without the printed
// number, corr(prompt size, write time) = 0.57 cannot be acted on: a strong
// correlation over a prompt that is already small means something different
// from the same correlation over one pinned at its 6,000-char ceiling.
const ctxRows = [
  readRow({ v2: true, latencyMs: 1, extractMs: 1, summary: "", detail: "", inputChars: 1000 }),
  readRow({ v2: true, latencyMs: 1, extractMs: 1, summary: "", detail: "", inputChars: 5000 }),
  readRow({ v2: true, latencyMs: 1, extractMs: 1, summary: "", detail: "", inputChars: 6000 }),
];
const c = summarize(ctxRows);
check("summarize: reports the context size it reads", c.inputChars.p50 === 5000 && c.inputChars.max === 6000);

// ── emitted vs displayed ──────────────────────────────────────────────────
//
// v2 writes its key_points AND repeats every one verbatim in the prose, so
// the characters it types exceed the characters the customer reads. Comparing
// pipelines on the displayed figure produced an impossible fit (a negative
// fixed cost); this is the field that fixes it.

const kp = readRow({
  v2: true, latencyMs: 1000, extractMs: 0,
  summary: "a".repeat(300), detail: "b".repeat(200),
  key_points: ["c".repeat(40), "d".repeat(60)],
});
check("readRow: counts key_points as characters the model typed", kp.keyPointChars === 100);
check("readRow: emitted = displayed + key_points", kp.outputChars === 600 && kp.answerChars === 500);

// v1 rows have no key_points at all — emitted and displayed are the same, and
// that must not read as missing data.
const noKp = readRow({ latencyMs: 500, summary: "x".repeat(50), detail: "" });
check("readRow: a row with no key_points emits exactly what it displays", noKp.outputChars === 50 && noKp.keyPointChars === 0);
// A field written by an older deploy, or a malformed one, must not throw.
check("readRow: survives a non-array key_points", readRow({ latencyMs: 1, summary: "s", key_points: "oops" }).keyPointChars === 0);

// The row MUST carry key_points, or displayed and emitted are equal and the
// assertion cannot tell which one the rate was computed from — the first
// version of this check used an empty key_points array and passed happily
// with the rate wired to the wrong column.
const rate = summarize([
  readRow({
    v2: true, latencyMs: 1000, extractMs: 0,
    summary: "a".repeat(100), detail: "", key_points: ["b".repeat(100)],
  }),
]);
check("summarize: ms per emitted char, not per displayed char", rate.msPerOutputChar === 5);
check("summarize: no divide-by-zero on an empty answer", summarize([readRow({ latencyMs: 5, summary: "", detail: "" })]).msPerOutputChar === 0);

// ── why a highlight is missing ────────────────────────────────────────────
//
// The production report came back with zero admitted key points across every
// v2 answer. That single number cannot say whether the writer marked nothing
// or marked phrases it then paraphrased, so the verbatim rule rejected them
// all — and the two need opposite fixes. This pair separates them.

// The two counts must come out DIFFERENT, or the assertions cannot tell which
// column each was computed from — a fixture where both are 1 passes just as
// happily with the two predicates swapped.
const hl = summarize([
  // marked nothing: no admitted, none rejected
  readRow({ v2: true, latencyMs: 1, summary: "a", detail: "" }),
  // marked and kept
  readRow({ v2: true, latencyMs: 1, summary: "a", detail: "", key_points: ["a"] }),
  readRow({ v2: true, latencyMs: 1, summary: "a", detail: "", key_points: ["a"] }),
  // marked and every one rejected — the failure that hides as "no highlight"
  readRow({ v2: true, latencyMs: 1, summary: "a", detail: "", key_points_dropped: 3 }),
]);
check("summarize: counts answers that actually carry a highlight", hl.highlights.rowsWithAny === 2);
check("summarize: counts answers whose phrases were rejected", hl.highlights.rowsWithRejected === 1);
check("summarize: totals the rejected phrases", hl.highlights.rejectedTotal === 3);
// An absent field is "none rejected", not missing data — it is only written
// when non-zero.
check("readRow: an absent key_points_dropped reads as zero", readRow({ latencyMs: 1, summary: "a" }).keyPointsDropped === 0);

// ── the dependency the script cannot resolve by name ──────────────────────
//
// firebase-admin is installed ONLY in functions/node_modules. A bare
// require("firebase-admin") from scripts/ walks scripts/ -> repo root -> /
// and throws MODULE_NOT_FOUND — which the first version of this script did,
// and which no test caught because the failure lives past the argument check,
// on a line that only runs with a real service account in hand. Every other
// RTDB script here points at the path explicitly; this pins that.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "..", "scripts", "overview-latency.mjs"), "utf8");
check(
  "script: does not require firebase-admin by bare name",
  !/require\(\s*["']firebase-admin["']\s*\)/.test(src)
);
check(
  "script: resolves it out of functions/node_modules like its neighbours",
  src.includes('join(root, "functions", "node_modules", "firebase-admin")')
);
// A --key given relative to the shell's cwd must not be resolved relative to
// the module — require() treats a bare relative string as a module specifier.
check(
  "script: resolves a relative --key against the shell's cwd",
  src.includes("isAbsolute(keyPath) ? keyPath : resolve(process.cwd(), keyPath)")
);

// ---------------------------------------------------------------------------
// THE CUT POINT — comparing a window against itself across a deploy.
//
// Without one the report can only compare whole Bangkok days, and a prompt
// change that lands mid-afternoon has its before and after averaged into the
// same percentiles. That is not a weak measurement, it is a measurement that
// reports "no change" whatever happened.
// ---------------------------------------------------------------------------

check("since: absent means no cut", parseSince(null) === null && parseSince("") === null);
check("since: epoch ms passes through", parseSince("1787505618882") === 1787505618882);
check(
  "since: an ISO stamp — the form a CI job prints — is read as the same instant",
  parseSince("2026-08-23T17:23:54Z") === Date.parse("2026-08-23T17:23:54Z")
);
// A silent fallback would compare two windows that are not the ones asked
// for, and print the answer with the same confidence as a correct one.
let threw = false;
try { parseSince("last tuesday"); } catch { threw = true; }
check("since: unreadable input throws rather than defaulting", threw);

{
  const CUT = 1000;
  const rows = [
    { ts: 400, tag: "old" },
    { ts: 999, tag: "just-before" },
    { ts: 1000, tag: "on-the-cut" },
    { ts: 5000, tag: "after" },
    { ts: 0, tag: "undateable" },
  ];
  const { before, after } = splitAt(rows, CUT);
  check(
    "split: the cut instant itself counts as after",
    after.map((r) => r.tag).join(",") === "on-the-cut,after"
  );
  check(
    "split: an undateable row (ts 0) falls BEFORE, never into the window being measured",
    before.map((r) => r.tag).join(",") === "old,just-before,undateable"
  );
  check("split: nothing is lost or duplicated", before.length + after.length === rows.length);

  // THE ts > 0 CLAUSE, EXERCISED. With any realistic cut the arithmetic alone
  // already puts an undateable row before it (0 >= cut is false), so the two
  // checks above pass with or without that clause — they were written as if
  // they proved it and did not. A cut of 0 is the input that separates them,
  // and parseSince("0") produces exactly that, so it is reachable rather than
  // hypothetical.
  const atZero = splitAt(rows, 0);
  check(
    "split: even a cut of 0 leaves the undateable row out of the measured window",
    !atZero.after.some((r) => r.tag === "undateable") &&
      atZero.after.map((r) => r.tag).join(",") === "old,just-before,on-the-cut,after"
  );
}

// ts has to survive readRow or the split has nothing to read.
check("readRow: carries ts through", readRow({ latencyMs: 10, ts: 1787505618882 }).ts === 1787505618882);
check("readRow: a row written before the field existed reads as ts 0", readRow({ latencyMs: 10 }).ts === 0);

// THE SMALL-SAMPLE WARNING IS PART OF THE REPORT, not a thing the reader is
// expected to know. At ~40 searches/day a few hours holds single digits, and
// a p90 over 6 rows is the 6th-largest of 6 — it prints like a measurement.
check("script: the report warns when either side is under MIN_SAMPLE", src.includes("MIN_SAMPLE"));
check(
  "script: and the warning says the numbers are indicative, not a conclusion",
  src.includes("indicative only")
);
check("script: MIN_SAMPLE is a real threshold, not zero", MIN_SAMPLE >= 10);
check("script: --since is documented in the usage header", src.includes("--since 2026-08-23T17:23:54Z"));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
