// ---------------------------------------------------------------------------
// Offline unit test for the quoted-model identity guard (quotedModelMismatch).
// Runs with NO API key and NO Firebase — pure functions over a fixture.
//
//   node functions/test/quoted-model-mismatch.test.mjs
//
// Guards the "iPhone 15 card for an iPhone 17 Pro Max" class of bug: the
// model_id handed to create_quote_card is chosen by the LLM, and before this
// guard the only check was modelLineMismatch, which knows four words, no
// generation numbers, and was fed every customer utterance joined together.
//
// LIVE CASE (ส.ค. 2569) is fixture 1: the customer typed "17 PM 256 sillver"
// and the card shipped as "iPhone 15 256GB (มือ 1 ยังไม่แกะซีล): 19,500 บาท".
//
// INJECTION MATRIX — break one rule in chat-ai.js, these must go RED. A green
// run after any of these means that layer is not actually covered. All eleven
// were run before this file shipped; all eleven were caught.
//
//   statedModelUnsupported -> false always ......... 12
//   familyMismatch call removed .................... 5
//   sublineMismatch call removed ................... 6
//   statedGenerationOf -> 0 always ................. 1, 2
//   statedGenerationOf bare-number branch removed .. 1
//   GENERATION_RE size lookahead removed ........... catalog 'iPad 11"'
//   BARE_GENERATION_RE size lookahead removed ...... stated '11 นิ้ว'
//   modelLineMismatch call removed ................. 4
//   exactModelPin identity check removed ........... 3
//   a naive two-way line rule added ................ 3, 8
//   family AND generation removed TOGETHER ......... 1, 2, 5
//
// Two of these earned their fixtures the hard way. The size lookaheads passed
// for the WRONG REASON at first — 'MacBook Pro 16"' scores 0 because no intro
// word touches its digit and '13 นิ้ว' on a Mac was refused by a family gate,
// so neither ever asked the lookahead; the direct 'iPad 11"' / '11 นิ้ว'
// checks are what reach it. And a per-family allowlist that looked like a
// third guard turned out to be unreachable and was deleted instead of
// shipped (see BARE_GENERATION_RE in chat-ai.js).
//
// The last row is the point of fixtures 5 and 6: family and generation both
// catch the classic "MacBook Pro M5 Max -> iPad mini 5", so removing either
// ALONE stays green. 5 keeps the generation number identical so only family
// can fire; 6 keeps family and number identical so only sub-line can.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../chat-ai.js");
const { quotedModelMismatch, catalogGenerationOf, statedGenerationOf, recoveryTerminalText } = __test;

// Mirrors the loadModelsLight shape. Every row is_active: true on purpose —
// a paused row is sorted out before the rules under test are ever asked
// (see the Injection test section of CLAUDE.md).
const V256 = [{ name: "256GB", used_price: 14000, new_price: 20000 }];
const CATALOG = [
  { id: "iphone-15", brand: "Apple", name: "iPhone 15", category: "Smartphone", is_active: true, variants: V256 },
  { id: "iphone-15-pro-max", brand: "Apple", name: "iPhone 15 Pro Max", category: "Smartphone", is_active: true, variants: V256 },
  { id: "iphone-16-pro", brand: "Apple", name: "iPhone 16 Pro", category: "Smartphone", is_active: true, variants: V256 },
  { id: "iphone-16-pro-max", brand: "Apple", name: "iPhone 16 Pro Max", category: "Smartphone", is_active: true, variants: V256 },
  { id: "iphone-17-pro-max", brand: "Apple", name: "iPhone 17 Pro Max", category: "Smartphone", is_active: true, variants: [{ name: "256GB", used_price: 38000, new_price: 0 }] },
  { id: "ipad-air-5", brand: "Apple", name: "iPad Air 5", category: "Tablet", is_active: true, variants: V256 },
  { id: "ipad-mini-5", brand: "Apple", name: "iPad mini 5", category: "Tablet", is_active: true, variants: V256 },
  { id: "ipad-gen-11", brand: "Apple", name: "iPad Generation 11", category: "Tablet", is_active: true, variants: V256 },
  { id: "mba-13-m1", brand: "Apple", name: 'MacBook Air 13" (ชิป M1, 2020)', category: "Mac", is_active: true, variants: V256 },
  { id: "mbp-16-m3", brand: "Apple", name: 'MacBook Pro 16" (ชิป M3, 2023)', category: "Mac", is_active: true, variants: V256 },
];
const byId = (id) => CATALOG.find((m) => m.id === id);
const resolvedOf = (id) => {
  const m = byId(id);
  return { id: m.id, name: `${m.brand} ${m.name}` };
};

// Default evidence carries the live conversation, so provenance (L1) passes
// for every case except the one written to fail it.
const LIVE_EVIDENCE = "เครื่องใหม่ \n ยังไม่แกะ \n 17 PM 256 sillver \n iPhone 17 Pro Max 256GB";
const ALL_NAMES_EVIDENCE = `${LIVE_EVIDENCE} \n ${CATALOG.map((m) => m.name).join(" \n ")} \n MacBook Air 5 \n iPhone Pro Max \n MacBook Air 13 นิ้ว M1`;

const CASES = [
  // #, stated, resolved id, expected kind
  [1, "17 PM 256 sillver", "iphone-15", "generation_mismatch"],
  [2, "iPhone 17 Pro Max 256GB", "iphone-15", "generation_mismatch"],
  [3, "iPhone 15", "iphone-15-pro-max", "identity_mismatch"],
  [4, "iPhone 16 Pro Max", "iphone-16-pro", "line_downgrade"],
  [5, "MacBook Air 5", "ipad-air-5", "family_mismatch"],
  [6, "iPad Air 5", "ipad-mini-5", "subline_mismatch"],
  [7, "iPhone 15", "iphone-15", null],
  [8, "17 PM", "iphone-17-pro-max", null],
  [9, "MacBook Air 13 นิ้ว M1", "mba-13-m1", null],
  [10, "iPhone Pro Max", "iphone-17-pro-max", null],
  [11, "iPad Generation 11", "ipad-gen-11", null],
];

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
};

for (const [n, stated, id, expected] of CASES) {
  const res = quotedModelMismatch({
    statedModel: stated,
    resolved: resolvedOf(id),
    catalog: CATALOG,
    customerSaid: ALL_NAMES_EVIDENCE,
  });
  // Assert the KIND, never mere truthiness: a fixture that only checks
  // "blocked / not blocked" goes green when a DIFFERENT layer fires, and the
  // layer it was written for stays untested.
  check(`#${n} "${stated}" vs ${byId(id).name}`, res ? res.kind : null, expected);
}

// The provenance input is EVERY customer utterance, not the condition-answer
// evidence — those differ by exactly one thing, and it matters. Naming the
// device in the same message as a phone number ("ขาย iPhone 15 ครับ
// 0812345678") is an ordinary Thai message; conditionEvidence drops it whole
// (looksLikeContactReply), which is right for a DEDUCTION and wrong for a
// model name. Fed the stripped text, this guard refused a card for the model
// the customer had just named — on the contact-capture turn, the highest
// intent moment in the conversation.
check(
  "#14 the model named alongside a phone number still counts as said",
  quotedModelMismatch({
    statedModel: "iPhone 15",
    resolved: resolvedOf("iphone-15"),
    catalog: CATALOG,
    customerSaid: "สวัสดีครับ \n ขาย iPhone 15 ครับ 0812345678",
  }),
  null
);

// ...and the same input, STRIPPED the way conditionEvidence is, does block —
// which is the whole reason the call site must not pass that one. The pair
// pins the behaviour; neither half alone says anything about the wiring.
check(
  "#15 the same message stripped of its contact line would block (why the input matters)",
  (quotedModelMismatch({
    statedModel: "iPhone 15",
    resolved: resolvedOf("iphone-15"),
    catalog: CATALOG,
    customerSaid: "สวัสดีครับ",
  }) || {}).kind,
  "unsupported_stated_model"
);

// And the wiring itself. #14/#15 exercise the pure function; the bug was in
// which of two nearly identical strings the call site handed it, which no
// pure-function fixture can reach — create_quote_card is async and
// Firebase-bound. Source-level, like the call-site checks in
// last-quote-block.test.mjs.
{
  const src = readFileSync(new URL("../chat-ai.js", import.meta.url), "utf8");
  const call = src.slice(src.indexOf("const modelMiss = quotedModelMismatch({"), src.indexOf("const modelMiss = quotedModelMismatch({") + 1600);
  check("#16 provenance is wired to the UNstripped customer text", call.includes("customerSaid: customerText"), true);
  check("#16b and never to the condition-answer evidence", /customerSaid:\s*conditionEvidence/.test(call), false);
}

// #12 — provenance: the LLM filled the field with a model nobody mentioned.
check(
  '#12 stated model absent from what the customer said',
  (quotedModelMismatch({
    statedModel: "iPhone 15",
    resolved: resolvedOf("iphone-15"),
    catalog: CATALOG,
    customerSaid: "อยากขายเครื่องครับ",
  }) || {}).kind,
  "unsupported_stated_model"
);

// Empty evidence must never block — permissive fallback, same as
// conditionAnswerUnsupported's unknown-group rule.
check(
  "#13 empty evidence does not block",
  quotedModelMismatch({ statedModel: "iPhone 15", resolved: resolvedOf("iphone-15"), catalog: CATALOG, customerSaid: "" }),
  null
);

// Generation extractors, asserted directly so a break shows up here rather
// than only as a downstream fixture.
check("gen: catalog 'iPhone 17 Pro Max'", catalogGenerationOf("iPhone 17 Pro Max"), 17);
check("gen: catalog 'iPad Generation 11'", catalogGenerationOf("iPad Generation 11"), 11);
check("gen: catalog 'Apple Watch Series 10'", catalogGenerationOf("Apple Watch Series 10"), 10);
check("gen: catalog 'MacBook Pro 16\" (ชิป M3, 2023)' is not 16", catalogGenerationOf('MacBook Pro 16" (ชิป M3, 2023)'), 0);
check("gen: catalog 'iPad Pro 9.7\" (2016)' is not 9 or 2016", catalogGenerationOf('iPad Pro 9.7" (2016)'), 0);
check("gen: stated '17 PM 256 sillver'", statedGenerationOf("17 PM 256 sillver"), 17);
check("gen: stated '256' alone is a capacity, not a generation", statedGenerationOf("256"), 0);
check("gen: stated bare '13' is a generation", statedGenerationOf("13"), 13);
// The two screen-size lookaheads, reached DIRECTLY. Without these the size
// guards pass for the wrong reason: 'MacBook Pro 16"' scores 0 because no
// intro word sits next to the number, and '13 นิ้ว' on macbook scores 0
// because the family gate refused it first — neither ever asks the lookahead.
// A hand-typed 'iPad 11"' (the catalog is typed in the admin; it is
// 'iPad Pro 11"' minus one word) is the shape that does.
check("gen: catalog 'iPad 11\"' is a screen size, not generation 11", catalogGenerationOf('iPad 11"'), 0);
check("gen: stated '11 นิ้ว' is a screen size", statedGenerationOf("11 นิ้ว"), 0);
// A Mac never reaches the comparison at all: the catalog side is 0, so even a
// bare "14" from the customer cannot produce a mismatch. This is the fixture
// that replaced the per-family allowlist injection proved inert.
check("gen: a Mac name yields no generation, so Macs never compare", catalogGenerationOf('MacBook Pro 14" (ชิป M3, 2023)'), 0);

// Recovery escape: the loop must have something true to say instead of
// hunting for another row it is allowed to quote.
const noNewPrice = recoveryTerminalText("new_price_not_available", { en: false });
check("recovery: no-first-hand-price answer exists", typeof noNewPrice === "string" && noNewPrice.includes("มือ 1"), true);
check("recovery: it never quotes a number", /\d[\d,]{2,}/.test(noNewPrice), false);
check("recovery: unknown error is not terminal", recoveryTerminalText("some_other_error", {}), null);
const mismatchAsk = recoveryTerminalText("model_identity_mismatch", { candidates: ["iPhone 17 Pro Max", "iPhone 15"] });
check("recovery: mismatch re-asks with chips", mismatchAsk.includes("[ตัวเลือก:"), true);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
