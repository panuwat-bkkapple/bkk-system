// Guards the generated status vocabulary that functions/ runs on.
//
// functions/ cannot import the canonical TS enum, so the vocabulary is
// generated from it (scripts/generate-status-vocab.mjs) instead of hand-copied.
// The hand-copied era ended because both copies had silently fallen behind the
// source: the 'Sent to QC Lab' and 'Ready to Sell' aliases were missing, so
// runStatusMigration skipped the 93 production rows carrying those spellings.
//
// Two gates, deliberately different:
//   1. CI runs `generate-status-vocab.mjs --check` in the admin-app job, where
//      esbuild is installed. That is the authoritative staleness gate.
//   2. This file runs in the functions job, which installs only functions/
//      dependencies (no esbuild). It re-derives the enum values from the TS
//      source with a cheap parse, so a stale — or hand-edited — generated file
//      is still caught on the side of the build that actually deploys it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vocab = require(path.join(root, "functions/status-vocab.generated.js"));
const tsSource = readFileSync(path.join(root, "src/types/job-statuses.ts"), "utf8");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log("status-vocab.generated.js");

check("exports the surface functions/ consumes", () => {
  for (const key of ["JOB_STATUS", "normalizeStatus", "CANCEL_CATEGORY_LABEL_TH", "getPhase", "isTerminal"]) {
    assert.ok(vocab[key], `missing export: ${key}`);
  }
});

check("carries every JOB_STATUS value declared in the TS source", () => {
  // Values inside the `export const JOB_STATUS = {...} as const;` block.
  const block = tsSource.match(/export const JOB_STATUS = \{([\s\S]*?)\} as const;/);
  assert.ok(block, "could not locate JOB_STATUS in src/types/job-statuses.ts");
  const declared = [...block[1].matchAll(/^\s*[A-Z0-9_]+:\s*'([^']+)'/gm)].map((m) => m[1]);
  assert.ok(declared.length > 20, `parsed only ${declared.length} statuses — parser drifted from the source`);
  const generated = new Set(Object.values(vocab.JOB_STATUS));
  const missing = declared.filter((s) => !generated.has(s));
  assert.deepEqual(missing, [], `generated file is stale — run: npm run generate:status-vocab`);
  assert.equal(generated.size, declared.length, "generated file has statuses the TS source does not declare");
});

check("carries every LEGACY_ALIAS key declared in the TS source", () => {
  const block = tsSource.match(/const LEGACY_ALIAS: Record<string, JobStatus> = \{([\s\S]*?)^\};/m);
  assert.ok(block, "could not locate LEGACY_ALIAS in src/types/job-statuses.ts");
  const keys = [...block[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*)):/gm)].map((m) => m[1] ?? m[2]);
  assert.ok(keys.length >= 9, `parsed only ${keys.length} aliases — parser drifted from the source`);
  for (const key of keys) {
    assert.ok(vocab.normalizeStatus(key, "Pickup"), `alias not honoured by the generated module: ${key}`);
  }
});

// Written from the 1 Sep 2026 production census (~499 jobs), not from the spec:
// these are the exact spellings live rows carry. Two of them are the reason the
// census was run at all.
check("normalizes the spellings production actually contains", () => {
  const census = [
    ["Pending QC", "Pending QC"],
    ["Sent to QC Lab", "Sent To QC Lab"],
    ["Ready to Sell", "Ready To Sell"],
    ["Waiting for Handover", "Waiting For Handover"],
    ["Active Leads", "Active Lead"],
    ["Closed (Lost)", "Closed (Lost)"],
    ["Rider En Route", "Rider En Route"],
    ["Parcel In Transit", "Parcel In Transit"],
  ];
  for (const [raw, expected] of census) {
    assert.equal(vocab.normalizeStatus(raw, "Pickup"), expected, `normalizeStatus(${JSON.stringify(raw)})`);
  }
});

check("keeps the In-Transit overload split by receive method", () => {
  // Pickup: the rider is driving a device we have already paid for.
  // Anything else: a customer's parcel is inbound and unpaid. Collapsing these
  // two would put a paid device and an unpaid one in the same bucket.
  assert.equal(vocab.normalizeStatus("In-Transit", "Pickup"), "Rider Returning");
  assert.equal(vocab.normalizeStatus("In-Transit", "Mail-in"), "Parcel In Transit");
});

check("reports unknown values as null rather than guessing", () => {
  assert.equal(vocab.normalizeStatus("Totally Made Up"), null);
  assert.equal(vocab.normalizeStatus(""), null);
  assert.equal(vocab.normalizeStatus(null), null);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
