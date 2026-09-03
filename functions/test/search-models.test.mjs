// ---------------------------------------------------------------------------
// Offline unit test for the model matcher (rankModels).
// Runs with NO API key and NO Firebase — pure function over a fixture.
//
//   node functions/test/search-models.test.mjs
//
// Guards the "Apple Watch Series 5" class of bug: a generation number the shop
// does not carry must NOT fuzzy-match a different generation it does carry.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../chat-ai.js");
const { rankModels, expandLineShorthand, exactModelPin, modelLineMismatch } = __test;

// Minimal fixture mirroring the real catalogue shape. is_active === false marks
// a delisted ("งดรับซื้อ") model, as loadModelsLight sets it.
const CATALOG = [
  { brand: "Apple", name: "Apple Watch Series 8", category: "Smart Watch", is_active: true },
  { brand: "Apple", name: "Apple Watch Series 9", category: "Smart Watch", is_active: true },
  { brand: "Apple", name: "Apple Watch Series 10", category: "Smart Watch", is_active: true },
  { brand: "Apple", name: "Apple Watch Series 11", category: "Smart Watch", is_active: true },
  { brand: "Apple", name: "Apple Watch SE 2", category: "Smart Watch", is_active: true },
  { brand: "Apple", name: "Apple Watch Ultra 2", category: "Smart Watch", is_active: true },
  { brand: "Apple", name: "iPhone 13", category: "Smartphone", is_active: true },
  { brand: "Apple", name: "iPhone 13 mini", category: "Smartphone", is_active: false },
  { brand: "Apple", name: "iPhone 13 Pro Max", category: "Smartphone", is_active: true },
  { brand: "Apple", name: "iPhone 17", category: "Smartphone", is_active: true },
  { brand: "Apple", name: "iPhone 17 Plus", category: "Smartphone", is_active: true },
  { brand: "Apple", name: "iPhone 17 Pro", category: "Smartphone", is_active: true },
  { brand: "Apple", name: "iPhone 17 Pro Max", category: "Smartphone", is_active: true },
  { brand: "Apple", name: "iPad Generation 9", category: "Tablet", is_active: true },
  { brand: "Apple", name: "iPad Air 5 (ชิป M1, 2022)", category: "Tablet", is_active: true },
  { brand: "Apple", name: 'iPad Pro 11" (ชิป M2, 2022)', category: "Tablet", is_active: true },
  { brand: "Apple", name: 'MacBook Air 13" (Intel, 2020)', category: "Mac", is_active: true },
];

const ranked = (q) => rankModels(CATALOG, q);
const names = (q) => ranked(q).map((m) => m.name);

const CASES = [
  // The reported bug: Series 5 is not carried -> must return nothing (escalate),
  // never a different Watch generation or an unrelated iPad.
  { q: "Apple Watch Series 5", expectEmpty: true },
  { q: "Apple Watch Series 6", expectEmpty: true },
  { q: "Apple Watch Series 7", expectEmpty: true },
  // Carried generations must match, and the correct one must rank first.
  { q: "Apple Watch Series 10", top: "Apple Watch Series 10" },
  { q: "iPhone 13 128GB", top: "iPhone 13" },
  { q: "iPhone 17 Pro Max 256GB", top: "iPhone 17 Pro Max" },
  { q: "iPad 9", top: "iPad Generation 9" },
  { q: "iPad Air 5", top: "iPad Air 5 (ชิป M1, 2022)" },
  // LINE SHORTHAND (ส.ค. 2569). "17 PM 256 sillver" is the string a real
  // customer typed; it used to match NOTHING, because "pm" appears in no name,
  // alias or category and meaningfulOk therefore failed on every row at once.
  // The empty result is what pushed the LLM into choosing a model_id itself.
  { q: "17 PM 256 sillver", top: "iPhone 17 Pro Max" },
  { q: "17pm", top: "iPhone 17 Pro Max" },
  { q: "17 pmax", top: "iPhone 17 Pro Max" },
  { q: "17 p max", top: "iPhone 17 Pro Max" },
  // Even with a family word carrying the search, the shorthand used to lose
  // the LINE: all three iPhone 17s tied on hits and the name-length tiebreak
  // handed first place to the base model — the cheapest of the three.
  { q: "iphone 17 pm", top: "iPhone 17 Pro Max" },
  { q: "iphone 17 pl", top: "iPhone 17 Plus" },
  // ...and a plain query must still mean the plain model. This is the case
  // that fails if the expansion ever fires on something it should not.
  { q: "iphone 17", top: "iPhone 17" },
  { q: "iphone 17 pro max", top: "iPhone 17 Pro Max" },
  // Inch-quote names must still match on their generation number.
  { q: "iPad Pro 11", top: 'iPad Pro 11" (ชิป M2, 2022)' },
  { q: "macbook air 13", top: 'MacBook Air 13" (Intel, 2020)' },
  // A delisted model asked by name ranks first (executor then declines it);
  // it must NOT be the top when the customer asks the active sibling.
  { q: "iPhone 13 mini", top: "iPhone 13 mini", topInactive: true },
  { q: "iPhone 13", top: "iPhone 13" },

  // Thai has no spaces, so the intent word arrives glued to the model name.
  // Reported on the web search, where "ขายไอโฟน 13" found nothing while
  // "iphone 13" found six; the chat matcher had the same hole.
  { q: "ขายmacbook air 13", top: 'MacBook Air 13" (Intel, 2020)' },
  // Intent words and nothing else: no device was named, so nothing was
  // searched for. Unchanged behaviour — the caller escalates.
  { q: "ขายเครื่อง", expectEmpty: true },

  // TWO GENERATIONS IN ONE SENTENCE (live bug, ส.ค. 2569 — found on the web
  // search, fixed here because the rule is a mirror). Version tokens were
  // {17, 18}; no device is both generations, and the old "candidate must
  // contain EVERY version token" rule therefore rejected the whole catalogue.
  // Asking about the phone you own alongside the one you are waiting for is
  // the most natural way to ask when to sell, and it was the one shape that
  // found nothing at all.
  {
    q: "ถ้าจะขาย iPhone 17 Pro Max 256GB เดือนหน้า หลังจาก iPhone 18 รุ่นใหม่ เปิดตัว ราคาจะลงอีกไหม",
    top: "iPhone 17 Pro Max",
  },
  { q: "ขาย iphone 13 ก่อน iphone 18 เปิดตัว ดีไหม", top: "iPhone 13" },
  // An incidental small number ("ภายใน 7 วัน") makes 7 a version token. The
  // device that was actually named must still come first.
  { q: "ขาย iphone 13 pro max ภายใน 7 วัน", top: "iPhone 13 Pro Max" },
  // THE RULE THE FIX MUST NOT BREAK, restated with the generation named ONCE:
  // with a single version token "one of" and "every" are the same test, so
  // Series 5 (not carried) must still return nothing rather than Series 10.
  // Covered by the first three cases above; repeated here in the two-number
  // shape so a future edit cannot pass by loosening only the single case.
  { q: "apple watch series 5 หรือ series 6 ดี", expectEmpty: true },
];

let failures = 0;
for (const c of CASES) {
  const got = names(c.q);
  let ok = true;
  if (c.expectEmpty) ok = got.length === 0;
  else if (c.topInactive)
    ok = got[0] === c.top && ranked(c.q)[0].is_active === false;
  else ok = got[0] === c.top && !got.includes("Apple Watch Series 5");
  if (!ok) {
    failures++;
    console.log(`FAIL  ${JSON.stringify(c.q)}`);
    console.log(`      expected: ${c.expectEmpty ? "[] (escalate)" : c.top}`);
    console.log(`      got:      ${JSON.stringify(got)}`);
  } else {
    console.log(`PASS  ${JSON.stringify(c.q)} -> ${c.expectEmpty ? "[] (escalate)" : got[0]}`);
  }
}

// ---------------------------------------------------------------------------
// The expander itself, and the two other seams that read customer text.
// A query and a pin key must not disagree about what the customer typed.
//
// INJECTION MATRIX — eight breaks run against this file; seven went red:
//   each of the three rules removed ................ its own cases
//   \b word boundaries dropped ..................... "pm inside a word"
//   expansion moved BEFORE the letter/digit splitter  "17pm" and friends
//   normalizeForPin loses it ....................... the pin cases
//   modelLineMismatch loses it ..................... the guard cases
// The eighth — ALSO expanding catalog names — was NOT caught, and stays
// documented rather than papered over with a contrived fixture: no name,
// alias or category in the catalogue contains "pm", "pl" or "p max", so on
// today's data both sides behave identically. "customer text only" is
// therefore a scope rule, not a guard, and expandLineShorthand says so.
// ---------------------------------------------------------------------------
const expectEq = (label, got, want) => {
  if (got === want) { console.log(`PASS  ${label}`); return; }
  failures++; extra++;
  console.log(`FAIL  ${label}\n      expected: ${JSON.stringify(want)}\n      got:      ${JSON.stringify(got)}`);
};
let extra = 0;
const before = failures;

expectEq("expand: pm", expandLineShorthand("17 pm"), "17 pro max");
expectEq("expand: pmax", expandLineShorthand("17 pmax"), "17 pro max");
expectEq("expand: p max", expandLineShorthand("17 p max"), "17 pro max");
expectEq("expand: pl", expandLineShorthand("17 pl"), "17 plus");
expectEq("expand: idempotent", expandLineShorthand(expandLineShorthand("17 pm")), "17 pro max");
// A word that merely CONTAINS the shorthand is not shorthand.
expectEq("expand: pm inside a word is left alone", expandLineShorthand("pmt spm"), "pmt spm");
expectEq("expand: nothing to do", expandLineShorthand("iphone 17 pro max"), "iphone 17 pro max");
// Glued input reaches modelLineMismatch unsplit, so the expander splits its
// own input rather than trusting the caller to have done it.
expectEq("expand: glued '17pm'", expandLineShorthand("17pm"), "17 pro max");
expectEq("expand: glued '16PM' via the guard", modelLineMismatch("16PM", "Apple iPhone 16 Pro"), "Pro Max");
// The accepted false positive, asserted so it stays a decision rather than a
// surprise: a clock time expands. Nobody searches a trade-in catalogue for a
// time of day, and since the quoted-model guard landed, a mis-resolution asks
// the customer to confirm the model instead of pricing one.
expectEq("expand: a clock time expands too (known, accepted)", expandLineShorthand("ขาย 2 pm"), "ขาย 2 pro max");

// normalizeForPin runs the same expansion, so shorthand can PIN.
expectEq("pin: '17 PM' resolves to the Pro Max", (exactModelPin(CATALOG, "17 PM") || {}).name, "iPhone 17 Pro Max");
expectEq("pin: '17 pl' resolves to the Plus", (exactModelPin(CATALOG, "17 pl") || {}).name, "iPhone 17 Plus");
expectEq("pin: a plain query still pins the plain model", (exactModelPin(CATALOG, "iPhone 17") || {}).name, "iPhone 17");

// modelLineMismatch expands the CUSTOMER side only — "PM" is something only a
// customer writes, and without this the guard reads "16 PM" as naming no line.
expectEq("guard: '16 PM' vs a plain Pro is a downgrade", modelLineMismatch("16 PM", "Apple iPhone 16 Pro"), "Pro Max");
expectEq("guard: '16 PM' vs the Pro Max agrees", modelLineMismatch("16 PM", "Apple iPhone 16 Pro Max"), null);

console.log(`\n${CASES.length - (before)}/${CASES.length} case(s) + ${15 - extra}/15 shorthand check(s) passed`);
process.exit(failures ? 1 : 0);
