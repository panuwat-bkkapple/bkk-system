// The pure halves of scripts/extract-prompt-tokens.mjs.
//
// What is worth pinning here is the FIDELITY of the catalog mapping: the
// script measures a prompt that production builds, and the only thing it
// reproduces rather than imports is how a raw /models row becomes the three
// fields buildExtractUser reads. If that mapping drifts, the script reports a
// size for a prompt nobody sends — and reports it with the same confidence.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  extractFieldsOf,
  modelsFromCatalog,
  HAIKU_45_MIN_CACHEABLE_TOKENS,
} from "../../scripts/extract-prompt-tokens.mjs";

let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

// ── the three fields, exactly as toIngredientModel produces them ──────────
check(
  "fields: id and name come through",
  (() => {
    const m = extractFieldsOf({ id: "m1", name: "iPhone 11" });
    return m.id === "m1" && m.name === "iPhone 11" && m.alias === undefined;
  })()
);
check(
  "fields: both aliases join with ' / ' — the separator the real builder uses",
  extractFieldsOf({ id: "m1", name: "iPhone 11", alias_th: "ไอโฟน 11", alias_en: "ip11" }).alias ===
    "ไอโฟน 11 / ip11"
);
check(
  "fields: one alias alone carries no separator",
  extractFieldsOf({ id: "m1", name: "iPhone 11", alias_th: "ไอโฟน 11" }).alias === "ไอโฟน 11"
);
check(
  "fields: an empty alias string is dropped, not joined as an empty segment",
  extractFieldsOf({ id: "m1", name: "iPhone 11", alias_th: "", alias_en: "ip11" }).alias === "ip11"
);
// toIngredientModel returns null without both; a row counted here that
// production drops would inflate the measurement.
check("fields: a row with no name is dropped", extractFieldsOf({ id: "m1" }) === null);
check("fields: a row with no id is dropped", extractFieldsOf({ name: "iPhone 11" }) === null);
check("fields: whitespace-only name is dropped", extractFieldsOf({ id: "m1", name: "   " }) === null);

// ── the catalog node ──────────────────────────────────────────────────────
{
  const node = {
    k1: { id: "m1", name: "iPhone 11" },
    k2: { name: "iPhone 12" }, // id only on the key
    k3: { id: "m3" }, // no name — dropped
    k4: null, // RTDB can hand back a hole
    k5: "not an object",
  };
  const rows = modelsFromCatalog(node);
  check("catalog: keeps the rows production keeps", rows.length === 2);
  check("catalog: falls back to the RTDB key when the row carries no id", rows[1].id === "k2");
  check("catalog: an empty node yields nothing", modelsFromCatalog({}).length === 0);
  check("catalog: a missing node does not throw", modelsFromCatalog(null).length === 0);
}

// ── the threshold ─────────────────────────────────────────────────────────
// Not monotonic across models: 1,024 on several newer ones, 4,096 on Haiku
// 4.5. Wrong here and the script's verdict inverts while still reading like a
// measurement.
check("threshold: haiku 4.5 is 4096", HAIKU_45_MIN_CACHEABLE_TOKENS === 4096);

// ── the script itself ─────────────────────────────────────────────────────
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "extract-prompt-tokens.mjs"),
  "utf-8"
);
check(
  "script: measures the REAL cached block, not a reconstruction of it",
  src.includes("buildExtractSystemPrompt, buildExtractStable") &&
    src.includes('join(root, "functions", "search-overview-v2.js")') &&
    src.includes("buildExtractStable({ models })")
);
// The variable block must stay out: it can never be cached, and counting it
// would inflate the answer past the threshold on tokens that do not qualify.
// buildExtractStable cannot contain them by construction now, so what is left
// to guard is that the script does not reach for the variable half by another
// route and quietly count tokens that can never be cached.
check(
  "script: never counts the variable half",
  !src.includes("buildExtractVariable") && !src.includes("conditionChoices(")
);
// firebase-admin is not needed and must not creep in: /models is
// world-readable, and a service-account requirement would put this behind a
// credential nobody needs.
check("script: reads the public node over REST, no service account", !src.includes("firebase-admin"));
check(
  "script: resolves the key the way production does",
  src.includes("OVERVIEW_API_KEY") && src.includes("ANTHROPIC_API_KEY")
);
// An empty catalog would count a prompt with no models in it and print a
// confident "UNDER the minimum".
check("script: refuses to report a size for an empty catalog", src.includes("refusing to report"));
check(
  "script: says out loud that a marker under the minimum fails SILENTLY",
  src.includes("SILENTLY DOES NOTHING")
);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
