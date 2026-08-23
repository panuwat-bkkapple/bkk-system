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

import { percentile, correlation, readRow, bangkokDays, summarize } from "../../scripts/overview-latency.mjs";

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

// 2026-08-23T18:00Z is already the 24th in Bangkok (UTC+7) — the off-by-one
// that would make the report silently skip today's rows.
const days = bangkokDays(Date.parse("2026-08-23T18:00:00Z"), 3);
check("bangkokDays: uses Bangkok's day, not UTC's", days[0] === "2026-08-24");
check("bangkokDays: walks backwards, newest first", days.join(",") === "2026-08-24,2026-08-23,2026-08-22");

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

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
