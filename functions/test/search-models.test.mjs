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
const { rankModels } = __test;

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

console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
process.exit(failures ? 1 : 0);
