// ---------------------------------------------------------------------------
// WHEN STAGE 1 MISSES A DEVICE THE PAGE IS ALREADY SHOWING.
//
//   node functions/test/search-overview-recover.test.mjs
//
// Production, 22 ส.ค. 2569. The customer searched "MacBook Air M4 256GB".
// Stage 1 filed "MacBook Air M4" under unknownModels and named no model, so
// the answer opened with
//
//   "ยังไม่มีข้อมูลรุ่น MacBook Air M4 ในระบบรับซื้อของเรา"
//
// printed directly above the page's own cards for MacBook Air 15" (ชิป M4,
// 2025) ฿33,000 and MacBook Air 13" (ชิป M4, 2025) ฿29,000. A sentence that
// contradicts the cards under it turns a customer away from a device the shop
// is buying today.
//
// The fixtures below are those two models and that query.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const v2 = require("../search-overview-v2.js");
const { recoverMatchedModels, sanitizeIngredients, buildV2Context } = v2;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const MODELS = [
  { id: "mba15", name: 'MacBook Air 15" (ชิป M4, 2025)', family: "mac", category: "Mac / Laptop", min: 29000, max: 33000 },
  { id: "mba13", name: 'MacBook Air 13" (ชิป M4, 2025)', family: "mac", category: "Mac / Laptop", min: 25000, max: 29000 },
  { id: "paused", name: "MacBook Air 13\" (M1, 2020)", family: "mac", category: "Mac / Laptop", min: 8000, max: 9000, paused: true },
  { id: "ip15", name: "iPhone 15", family: "iphone", category: "Smartphones", min: 13000, max: 15000 },
];
const ING = { models: MODELS, matchedIds: ["mba15", "mba13"], pages: [], marketFacts: [], series: [], conditionSets: {} };
const ex = (o = {}) => ({
  models: [], conditions: [], topics: [], unknownModels: [], capacity: null,
  family: null, intent: "price", batteryPct: null, dropped: {}, ...o,
});

// ── the reported case ──────────────────────────────────────────────────────
{
  const out = recoverMatchedModels(ING, ex({ unknownModels: ["MacBook Air M4"] }));
  check("recovers the matcher's priced picks as the answer's models", out.models.join(",") === "mba15,mba13");
  check("drops the absence claim the page contradicts", out.unknownModels.length === 0);
  check("flags itself so the miss can be logged", out.recovered === true);
}

// ── the three conditions, each on its own ──────────────────────────────────
{
  // Stage 1 named something: an absence line beside a real answer is true and
  // useful ("iPhone 20 Ultra กับ iPhone 15 อันไหนดี").
  const named = recoverMatchedModels(ING, ex({ models: ["ip15"], unknownModels: ["iPhone 20 Ultra"] }));
  check("a named model is left alone, absence line and all", named.models.join(",") === "ip15" && named.unknownModels.length === 1);

  // No absence claimed = nothing to correct.
  const quiet = recoverMatchedModels(ING, ex({}));
  check("no absence claim, no recovery", quiet.recovered === undefined && quiet.models.length === 0);

  // The genuinely-absent device: the matcher found nothing priced, so the
  // absence line is the truth and must survive.
  const nothing = recoverMatchedModels(
    { ...ING, matchedIds: [] },
    ex({ unknownModels: ["iPhone 20 Ultra"] })
  );
  check("nothing matched: the absence line stands", nothing.unknownModels.join(",") === "iPhone 20 Ultra" && !nothing.recovered);

  // A paused match is not a price — recovering into it would answer with a
  // device the shop has stopped buying.
  const pausedOnly = recoverMatchedModels(
    { ...ING, matchedIds: ["paused"] },
    ex({ unknownModels: ["MacBook Air M1"] })
  );
  check("a paused-only match does not count as a contradiction", !pausedOnly.recovered);
}

// ── end to end: the context stops printing the false sentence ──────────────
{
  const before = buildV2Context({
    query: "MacBook Air M4 256GB",
    ingredients: ING,
    extraction: ex({ unknownModels: ["MacBook Air M4"] }),
    serviceFacts: "",
  }).context;
  check("without recovery the context still carries the absence line", before.includes("ยังไม่มีในระบบรับซื้อของเรา"));

  const after = buildV2Context({
    query: "MacBook Air M4 256GB",
    ingredients: ING,
    extraction: recoverMatchedModels(ING, ex({ unknownModels: ["MacBook Air M4"] })),
    serviceFacts: "",
  }).context;
  check("after recovery the false sentence is gone", !after.includes("ยังไม่มีในระบบรับซื้อของเรา"));
  check("and the answer now has the real devices to price", after.includes('MacBook Air 15" (ชิป M4, 2025)'));
}

// ── the wire: ids must survive the sanitizer, and only real ones ───────────
{
  const clean = sanitizeIngredients({
    models: MODELS,
    matchedIds: ["mba15", "not-in-catalog", "", null, "mba13"],
  });
  check("sanitizer keeps the real ids in order", clean.matchedIds.join(",") === "mba15,mba13");
  check("sanitizer drops ids that name nothing in the catalog", !clean.matchedIds.includes("not-in-catalog"));
  const none = sanitizeIngredients({ models: MODELS });
  check("a payload without the field arrives as an empty list, not undefined", Array.isArray(none.matchedIds) && none.matchedIds.length === 0);
}

// ── the wiring: recovery must run before anything reads the extraction ─────
{
  const { readFileSync } = await import("fs");
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "search-overview.js"), "utf-8");
  // ASSERTED AS A PROPERTY, NOT AS A LINE OF SOURCE. This used to pin the
  // literal `const extraction = recoverMatchedModels(ingredients,
  // parsedExtraction)`, and it went red when preferPlainLine was added around
  // it (26 ส.ค. 2569) — a correct change to the code, caught by an assertion
  // that had over-specified HOW rather than WHAT. What has to hold is that
  // recovery runs at the parse site, exactly once, and that its result is
  // what the single `extraction` binding carries; the pipeline around it is
  // free to grow.
  check(
    "the handler corrects the extraction at the parse site",
    src.includes("recoverMatchedModels(ingredients, parsedExtraction)")
  );
  check(
    "and its result is what the one extraction binding carries",
    /const extraction = (?:recoverMatchedModels|preferPlainLine)\(/.test(src) &&
      src.split("const extraction =").length - 1 === 1
  );
  // One application, at the top: the answerability gate, the context and the
  // primary-model legend all have to read the same extraction, or the card
  // ends up with a champion the paragraph never had.
  check("and exactly once", src.split("recoverMatchedModels(").length - 1 === 1);
  check("the plain-line gate likewise runs once", src.split("preferPlainLine(").length - 1 === 1);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll recovery checks passed");
process.exit(failures ? 1 : 0);
