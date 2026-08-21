// ---------------------------------------------------------------------------
// WHOSE NUMBER IS IT — the label bug, round two.
//
//   node functions/test/search-overview-attribution.test.mjs
//
// Round one fixed the combined-range line, which described its subject only
// by how it had been selected ("ทุกรุ่นที่ตรงกับคำค้นนี้"). It shipped, and
// production immediately produced two more of the same shape — every digit
// ours, every digit verified by exciseUnverifiedNumbers, and the SUBJECT of
// the sentence wrong. Real answers, 21 ส.ค. 2569:
//
//   q=iphone   "เรารับซื้อ iPhone ทุกรุ่นตั้งแต่รุ่นเก่าจนถึง iPhone 17 Pro Max
//               ที่ราคา 35,000 - 38,000 บาท"
//              35,000-38,000 is the top model's own range, lifted out of the
//              sample list. The same page's cards say iPhone 12 is 5,000.
//
//   quote 11,900  "ปรับลง 1,400 - 2,800 บาท จากยอดปัจจุบัน"
//   quote  6,400  "10-20% (คิดเป็นประมาณ 800 - 1,600 บาท) จากราคาปัจจุบัน"
//              Both computed off the CATALOG price (14,000 / 8,000). The drop
//              is overstated against the figure the reader holds, in the
//              direction that says "sell now" — and 1,400 at 10% names the
//              base, which rule 6 forbids revealing by any arithmetic.
//
// The numbers in the fixtures below are those cases.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const v2 = require("../search-overview-v2.js");
const { marketFactSection, familySection, buildV2SystemPrompt } = { ...v2.__test, ...v2 };

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const FUTURE = Date.now() + 86400000;
const FACT = {
  label: "iPhone 18",
  appliesTo: "iphone",
  certainty: "ปานกลาง",
  dropPctMin: 10,
  dropPctMax: 20,
  expiresAt: FUTURE,
};
// iPhone 14 Pro 128GB as the catalog holds it, and the quote the customer was
// actually shown for a worn battery.
const PRO = { id: "p", name: "iPhone 14 Pro", min: 14000, max: 14000 };
const QUOTE = { model_name: "iPhone 14 Pro", variant: "128GB", net_price: 11900 };

// ── The percentage applies to the figure the customer was given ────────────
{
  const out = marketFactSection([FACT], [PRO], null, QUOTE);
  check("quote in play: baht computed from the quote (10-20% of 11,900)", out.includes("1,190 - 2,380"));
  check("quote in play: the line says which figure it is a percentage of", out.includes("จากยอดประเมิน 11,900 บาท"));
  // The regression itself: 10% and 20% of the CATALOG price.
  check("quote in play: the catalog-derived pair is gone", !out.includes("1,400") && !out.includes("2,800"));
  // Rule 6 by arithmetic — 1,400 at 10% names 14,000 without ever printing it.
  check("quote in play: the base price cannot be recovered from the line", !out.includes("14,000"));
}

// ── No quote: browsing a model, nothing to leak, behaviour unchanged ───────
{
  const out = marketFactSection([FACT], [PRO], null, null);
  check("no quote: still converts, from the catalog price", out.includes("1,400 - 2,800"));
  check("no quote: labelled as the model's current buy price", out.includes("จากราคารับซื้อปัจจุบันของ iPhone 14 Pro"));
}

// ── Two models: the ambiguity the conversion refuses, quote or not ─────────
{
  const out = marketFactSection([FACT], [PRO, { id: "q", name: "iPhone 14", min: 8000, max: 9000 }], null, null);
  check("two models: no baht conversion at all", !out.includes("คิดเป็นเงินประมาณ"));
}

// ── The family sample lines say what they may NOT stand in for ─────────────
{
  const ING = {
    models: [
      { id: "a", name: "iPhone 17 Pro Max", category: "smartphone", min: 35000, max: 38000 },
      { id: "b", name: "iPhone 17 Pro", category: "smartphone", min: 31000, max: 34000 },
      { id: "c", name: "iPhone 12", category: "smartphone", min: 2000, max: 5000 },
    ],
  };
  const out = familySection(ING, {
    family: "iphone",
    intent: "family_overview",
    models: [],
    unknownModels: [],
  });
  check("family: the combined range is the family's, named as such", out.includes("ทุกรุ่นในตระกูล iPhone (3 รุ่น): 2,000 - 38,000"));
  check("family: the per-model samples are fenced off from 'ทุกรุ่น'", out.includes('ห้ามใช้แทนราคาของตระกูลหรือของ "ทุกรุ่น"'));
  check("family: the overview sentence is pointed at the combined line", out.includes("ให้ใช้ตัวเลขจากบรรทัดนี้เท่านั้น"));
  // The sample still carries the top model's real figures — fencing them off
  // is not the same as hiding them.
  check("family: the sample keeps the real per-model numbers", out.includes("iPhone 17 Pro Max: 35,000 - 38,000"));
}

// ── The prompt locks, second line of defence ───────────────────────────────
{
  const P = buildV2SystemPrompt("มาติน");
  check("prompt: a number must sit in a sentence its subject owns", P.includes("4.1") && P.includes('ห้ามวางในประโยคที่พูดถึงตระกูล'));
  check("prompt: the baht line's base may not be swapped", P.includes("ต้องอ้างฐานตามที่บรรทัดนั้นบอกเท่านั้น"));
  check("prompt: no channels we have no facts about", P.includes("เทิร์นเครื่องกับศูนย์"));
  check("prompt: no invented reason for a model we do not carry", P.includes("ยังไม่วางจำหน่าย"));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll attribution checks passed");
process.exit(failures ? 1 : 0);
