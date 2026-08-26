// ---------------------------------------------------------------------------
// WHEN STAGE 1 PICKS THE SUB-LINE THE CUSTOMER DID NOT NAME.
//
//   node functions/test/search-overview-plain-line.test.mjs
//
// Production, 26 ส.ค. 2569, bkkapple.com/search?q=ipad+11+128GB. The quote
// card read
//
//   iPad Air 11" (ชิป M2, 2024) ความจุ 128GB ประเมินราคาที่ 9,000 - 11,000 บาท
//
// with a CTA to assess that Air — printed above the page's own product cards,
// which led with iPad (A16). The owner has ruled twice that "ipad 11" is the
// plain iPad: a sub-line is something you SAY, and 11 is the SCREEN SIZE in an
// iPad Air's name.
//
// The frontend was already fixed for this (bkk-frontend-next #896, #898) and
// it did not help, because stage 1 is a SECOND MATCHER: it reads the whole
// catalog and names the models itself, so the narrowed context never reaches
// the decision that titles the card.
//
// The fixtures below are that query and those rows.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { preferPlainLine } = require("../search-overview-v2.js");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const MODELS = [
  { id: "ipad_a16", name: "iPad (A16)", family: "ipad", category: "Tablets", min: 8000, max: 10000 },
  { id: "air_m2", name: 'iPad Air 11" (ชิป M2, 2024)', family: "ipad", category: "Tablets", min: 9000, max: 11000 },
  { id: "air_m4", name: 'iPad Air 11" (ชิป M4, 2026)', family: "ipad", category: "Tablets", min: 12000, max: 16000 },
  { id: "pro_m5", name: 'iPad Pro 11" (ชิป M5, 2025)', family: "ipad", category: "Tablets", min: 20000, max: 31500 },
  { id: "ip13", name: "iPhone 13", family: "iphone", category: "Smartphones", min: 9000, max: 12000 },
  { id: "ip13pro", name: "iPhone 13 Pro", family: "iphone", category: "Smartphones", min: 13000, max: 16000 },
  // Mac rows: the number in every one of these names is INCHES.
  { id: "mbp14", name: 'MacBook Pro 14" (ชิป M5 Max, 2026)', family: "mac", category: "Mac / Laptop", min: 40000, max: 55000 },
  { id: "mba13", name: 'MacBook Air 13" (ชิป M4, 2025)', family: "mac", category: "Mac / Laptop", min: 25000, max: 29000 },
  { id: "neo13", name: 'MacBook Neo 13" (ชิป A18 Pro, 2026)', family: "mac", category: "Mac / Laptop", min: 18000, max: 22000 },
];
const ING = { models: MODELS, matchedIds: [], pages: [], marketFacts: [], series: [], conditionSets: {} };
const ex = (ids) => ({ models: ids, capacity: null, conditions: [], topics: [], intent: "price", unknownModels: [] });
const idsOf = (r) => (r && r.models ? r.models.join(",") : "");

// THE REPORTED CARD. Stage 1 named the Air; the plain iPad is what "ipad 11"
// means, and it was in the pick list too.
check(
  "ipad 11 128GB -> the plain iPad, not the Air",
  idsOf(preferPlainLine(ING, ex(["air_m2", "ipad_a16"]), "ipad 11 128GB")) === "ipad_a16"
);
check(
  "the same in Thai",
  idsOf(preferPlainLine(ING, ex(["air_m2", "ipad_a16"]), "ไอแพด 11 128GB")) === "ipad_a16"
);
check(
  "iphone 13 -> the plain 13, not the Pro",
  idsOf(preferPlainLine(ING, ex(["ip13pro", "ip13"]), "iphone 13")) === "ip13"
);

// SAYING THE SUB-LINE IS HOW YOU GET THE SUB-LINE.
check(
  "ipad air 11 -> untouched, they named the Air",
  idsOf(preferPlainLine(ING, ex(["air_m2", "ipad_a16"]), "ipad air 11")) === "air_m2,ipad_a16"
);
check(
  "ไอแพดแอร์ 11 -> untouched",
  idsOf(preferPlainLine(ING, ex(["air_m2", "ipad_a16"]), "ไอแพดแอร์ 11")) === "air_m2,ipad_a16"
);

// A CAPACITY IS NOT A GENERATION. 256 is above the 3..20 window, which is the
// whole reason that window exists.
check(
  "ipad 256gb -> untouched, no generation named",
  idsOf(preferPlainLine(ING, ex(["air_m4", "ipad_a16"]), "ipad 256gb")) === "air_m4,ipad_a16"
);

// A MAC'S NUMBER IS ITS SCREEN. Without this the Neo — the one Mac row whose
// name carries no line word — wins a query about 13-inch MacBooks.
check(
  "macbook 13 -> untouched, 13 is inches",
  idsOf(preferPlainLine(ING, ex(["mba13", "neo13"]), "macbook 13")) === "mba13,neo13"
);
check(
  "mac 14 -> untouched",
  idsOf(preferPlainLine(ING, ex(["mbp14"]), "mac 14")) === "mbp14"
);

// NO OPINION WHEN THERE IS NOTHING TO PREFER, OR NOTHING TO NARROW.
check(
  "every pick is a sub-line -> untouched",
  idsOf(preferPlainLine(ING, ex(["air_m2", "pro_m5"]), "ipad 11")) === "air_m2,pro_m5"
);
check(
  "no pick is a sub-line -> untouched",
  idsOf(preferPlainLine(ING, ex(["ipad_a16"]), "ipad 11")) === "ipad_a16"
);
check(
  "no models at all -> untouched",
  preferPlainLine(ING, ex([]), "ipad 11").models.length === 0
);
check("null extraction survives", preferPlainLine(ING, null, "ipad 11") === null);

// THE CHIP PARENTHETICAL COMES OFF FIRST. `MacBook Neo 13" (ชิป A18 Pro,
// 2026)` says "Pro" — in its CHIP. Reading that would call the Neo a sub-line
// and, in a family this gate did act on, quietly drop it.
check(
  "a chip named Pro does not make the row a Pro line",
  idsOf(preferPlainLine(ING, ex(["neo13", "mbp14"]), "ipad 11 neo")) === "neo13"
);

// THE FLAG IS SET ONLY WHEN IT ACTED, so the caller can log the narrowing
// without re-deriving it.
check(
  "narrowedToPlainLine set when it acts",
  preferPlainLine(ING, ex(["air_m2", "ipad_a16"]), "ipad 11").narrowedToPlainLine === true
);
check(
  "and absent when it does not",
  preferPlainLine(ING, ex(["air_m2", "ipad_a16"]), "ipad air 11").narrowedToPlainLine === undefined
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
