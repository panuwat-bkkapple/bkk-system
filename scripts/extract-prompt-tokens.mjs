// ---------------------------------------------------------------------------
// HOW BIG IS STAGE 1's PROMPT, IN TOKENS — the number the caching decision
// turns on, measured rather than estimated.
//
//   OVERVIEW_API_KEY=sk-... node scripts/extract-prompt-tokens.mjs
//
// READ-ONLY and free: it reads the world-readable /models node and calls
// /v1/messages/count_tokens, which generates nothing and bills no tokens.
//
// WHY
//
// Stage 1 costs 2,225ms of a 10,133ms wait (p50, 62 production answers) for a
// one-line JSON answer. What it READS is the whole catalog — every model, on
// every request, whatever the customer typed:
//
//   /** The whole catalog, raw — stage 1 must be able to name a model the
//    *  local matcher missed ("ip16 pm 256"), so the list is never just the
//    *  matches. */                    — lib/searchOverviewIngredients.ts
//
// A large input that barely changes between requests is the shape prompt
// caching exists for. Two things have to be true before it pays, and only
// one of them can be reasoned about without measuring:
//
//   1. ORDER (checkable by reading). Caching is a prefix match, and
//      buildExtractUser puts the customer's query on line ONE, before the
//      lists. Everything after a value that changes every request is
//      uncacheable, so today the answer is no regardless of size.
//
//   2. SIZE (this script). claude-haiku-4-5's minimum cacheable prefix is
//      4,096 tokens. BELOW IT A cache_control MARKER IS ACCEPTED, COSTS
//      NOTHING, AND SILENTLY DOES NOTHING — cache_creation_input_tokens: 0,
//      no error, no warning. The minimum is not monotonic across models
//      (1,024 on several newer ones), so it cannot be recalled, only looked
//      up per model.
//
// WHAT IS COUNTED, AND WHAT IS NOT
//
// Only the part that is the SAME on every request: the system prompt, the
// model list, and the topic list. Condition options are deliberately
// excluded — buildOverviewIngredients ships the sets of MATCHED models only,
// so that block changes with the query and would have to sit after the cache
// breakpoint anyway. Counting it in would inflate the answer with tokens
// that could never be cached.
//
// FIDELITY
//
// The prompt is built by importing buildExtractSystemPrompt and
// buildExtractUser — the same two functions production calls, not a copy.
// The only thing reproduced here is how a raw catalog row becomes the three
// fields those functions read (id, name, alias); toIngredientModel computes
// more, and none of the rest reaches this prompt.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildExtractSystemPrompt, buildExtractStable } = require(
  join(root, "functions", "search-overview-v2.js")
);

/** claude-haiku-4-5. Per-model, and NOT monotonic across generations — never
 *  recall this number, look it up for the model actually in use. */
export const HAIKU_45_MIN_CACHEABLE_TOKENS = 4096;

const DB =
  process.env.FIREBASE_DATABASE_URL ||
  "https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app";

/**
 * A raw /models row -> the three fields buildExtractUser reads.
 *
 * Mirrors toIngredientModel (lib/searchOverviewIngredients.ts) for those
 * three only. A row without both id and name is dropped there too.
 */
export function extractFieldsOf(raw) {
  const id = String((raw && raw.id) || "").trim();
  const name = String((raw && raw.name) || "").trim();
  if (!id || !name) return null;
  const aliases = [raw.alias_th, raw.alias_en]
    .map((a) => String(a || "").trim())
    .filter(Boolean);
  const out = { id, name };
  if (aliases.length) out.alias = aliases.join(" / ");
  return out;
}

/** RTDB hands back an object keyed by id; the id also rides inside each row
 *  in this catalog, but falling back to the key keeps a row without one. */
export function modelsFromCatalog(node) {
  const rows = [];
  for (const [key, raw] of Object.entries(node || {})) {
    if (!raw || typeof raw !== "object") continue;
    const m = extractFieldsOf({ ...raw, id: raw.id || key });
    if (m) rows.push(m);
  }
  return rows;
}

async function countTokens({ apiKey, model, system, user }) {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json.input_tokens;
}

async function main() {
  const apiKey = process.env.OVERVIEW_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("need a key: OVERVIEW_API_KEY=... (or ANTHROPIC_API_KEY=...)");
    process.exit(2);
  }
  // The same resolution production uses, so a changed env var is measured
  // rather than missed.
  const model = process.env.OVERVIEW_EXTRACT_MODEL || "claude-haiku-4-5";

  const res = await fetch(`${DB}/models.json`);
  if (!res.ok) throw new Error(`GET /models.json -> ${res.status}`);
  const models = modelsFromCatalog(await res.json());
  if (!models.length) throw new Error("catalog came back empty — refusing to report a size for it");

  const system = buildExtractSystemPrompt();
  // buildExtractStable IS the cached block — the same function production
  // marks with cache_control. Measuring it directly beats reconstructing it,
  // which is what this script did before the split existed.
  const user = buildExtractStable({ models });
  // The same block minus the catalog, so the catalog's own share is a
  // difference of two measurements rather than a second estimate.
  const withoutModels = buildExtractStable({ models: [] });

  const [tFull, tNoModels, tSystemOnly] = await Promise.all([
    countTokens({ apiKey, model, system, user }),
    countTokens({ apiKey, model, system, user: withoutModels }),
    countTokens({ apiKey, model, system, user: "x" }),
  ]);

  console.log(`model                ${model}`);
  console.log(`catalog rows         ${models.length}`);
  console.log(`system prompt        ${system.length} chars`);
  console.log(`cached block         ${user.length} chars  (catalog + topics)`);
  console.log("");
  console.log(`tokens: system only            ${tSystemOnly}`);
  console.log(`tokens: without the catalog    ${tNoModels}`);
  console.log(`tokens: STABLE PREFIX          ${tFull}   <- the number that decides`);
  console.log(`        of which the catalog   ${tFull - tNoModels}`);
  console.log("");
  const min = HAIKU_45_MIN_CACHEABLE_TOKENS;
  if (tFull >= min) {
    console.log(`OVER the ${min}-token minimum by ${tFull - min}. This block can cache on ${model}.`);
    console.log(`Whether it DOES is a separate question the archive answers:`);
    console.log(`  node scripts/overview-latency.mjs --key <sa.json> --days 3   -> "extract cache"`);
  } else {
    console.log(`UNDER the ${min}-token minimum by ${min - tFull}. On ${model} a cache_control`);
    console.log(`marker here is accepted, costs nothing, and does nothing. Whatever the archive`);
    console.log(`reports, this block cannot be the reason — take the marker back off.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
