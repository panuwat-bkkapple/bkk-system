// ---------------------------------------------------------------------------
// V2-D acceptance — the SPEC's correctness cases, run offline.
//
//   node functions/test/search-overview-v2-acceptance.test.mjs
//
// WHAT OFFLINE MEANS HERE, said plainly: stage 1 is a model call, so its
// OUTPUT is a fixture in these tests — each case feeds stage 2 the extraction
// the spec expects stage 1 to produce, and pins that the context (and so the
// answer's entire world) is then right. Whether the live model actually
// produces that extraction is exactly what scripts/v2-live-probe.mjs and the
// owner's manual pass exist to verify — the two halves together are the
// acceptance, and neither substitutes for the other.
//
// Written from the customer's real sentences in the spec, not from the
// implementation (กติกา §4.12) — the fixture catalog speaks the price shapes
// of the real one.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const v2 = require("../search-overview-v2.js");
const {
  sanitizeIngredients,
  parseExtraction,
  hasAnythingToWrite,
  buildV2Context,
} = v2;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const FUTURE = Date.now() + 7 * 24 * 3600 * 1000;

const ING = sanitizeIngredients({
  models: [
    {
      id: "ip16pm",
      name: "iPhone 16 Pro Max",
      alias: "ไอโฟน 16 โปรแม็กซ์",
      family: "iphone",
      min: 30000,
      max: 42000,
      capacities: [
        { name: "256GB", min: 30000, max: 32000 },
        { name: "512GB", min: 36000, max: 38000 },
      ],
      conditionSetId: "set16",
    },
    { id: "ip16", name: "iPhone 16", family: "iphone", min: 18000, max: 24000, conditionSetId: "set16" },
    { id: "ip15pm", name: "iPhone 15 Pro Max", family: "iphone", min: 22000, max: 28000, conditionSetId: "set15" },
    { id: "ipadair", name: "iPad Air 6", family: "ipad", min: 12000, max: 16000 },
  ],
  conditionSets: {
    set16: {
      groups: [
        { title: "สภาพหน้าจอ", options: [{ label: "ปกติ" }, { label: "จอแตก มองเห็นชัด", pct: 20 }] },
        { title: "โครงเครื่อง", options: [{ label: "ปกติ" }, { label: "ตัวเครื่องงอ/บิด", deduct: 3000 }] },
      ],
    },
    set15: {
      groups: [{ title: "สภาพหน้าจอ", options: [{ label: "ปกติ" }, { label: "จอแตก", pct: 20 }] }],
    },
  },
  marketFacts: [
    {
      label: "iPhone 18 เปิดตัวราวเดือนกันยายน",
      appliesTo: "iphone",
      certainty: "ความมั่นใจปานกลาง",
      dropPctMin: 5,
      dropPctMax: 12,
      expiresAt: FUTURE,
    },
    {
      label: "ตลาดรวม",
      appliesTo: "all",
      text: "ช่วงเปิดเทอมตลาดคึกคัก ราคาทรงตัว",
      certainty: "ความมั่นใจต่ำ",
      expiresAt: FUTURE,
    },
  ],
  series: [{ modelId: "ip16pm", days: 30, changePct: -3.5 }],
  pages: [{ title: "ขั้นตอนการขาย", path: "/how-it-works", description: "ขายยังไง ได้เงินเมื่อไหร่" }],
});

const ex = (over = {}) => ({
  models: [],
  capacity: null,
  conditions: [],
  topics: [],
  intent: "other",
  family: null,
  unknownModels: [],
  confidence: "high",
  dropped: { models: 0, conditions: 0, topics: 0 },
  ...over,
});

// ── ACC1: the flagship sentence ─────────────────────────────────────────────
// "ถ้าจะขาย iPhone 16 Pro Max 256GB เดือนหน้า หลังจาก iPhone 18 รุ่นใหม่
//  เปิดตัว ราคาจะลงอีกไหม" → real 16PM price AT 256GB + forecast + iPhone 18
//  as an absence — and no ghost model anywhere.
{
  const extraction = ex({
    models: ["ip16pm"],
    capacity: "256GB",
    intent: "forecast",
    family: "iphone",
    unknownModels: ["iPhone 18"],
  });
  const { context } = buildV2Context({
    query: "ถ้าจะขาย iPhone 16 Pro Max 256GB เดือนหน้า หลังจาก iPhone 18 รุ่นใหม่ เปิดตัว ราคาจะลงอีกไหม",
    ingredients: ING,
    extraction,
    serviceFacts: "",
  });
  check("ACC1: 256GB price, not the model span", context.includes("30,000 - 32,000 บาท"));
  check("ACC1: the whole-span number never appears", !context.includes("42,000"));
  check("ACC1: forecast header + percentage present", context.includes("แนวโน้มราคาที่ทีมงานประเมินไว้") && context.includes("5-12%"));
  // Baht conversion by CODE off the 256GB rung: 30000*5% = 1,500 .. 32000*12% = 3,840.
  check("ACC1: forecast baht computed off the narrowed capacity", context.includes("1,500 - 3,840 บาท"));
  check("ACC1: iPhone 18 stated as an absence", context.includes("iPhone 18") && context.includes("ยังไม่มีในระบบรับซื้อ"));
  check("ACC1: 30-day history line rides along", context.includes("-3.5%"));
}

// ── ACC2: "ราคาจะลงอีกไหม" — a forecast, never a condition ────────────────
// The v1 bug family this kills: "งอ" hiding inside "ลงอีก". Structurally the
// extraction has no condition id to carry, and stage 2 must produce a
// forecast context with ZERO deduction lines.
{
  const extraction = ex({ intent: "forecast" });
  check("ACC2: answerable from the general fact alone", hasAnythingToWrite(ING, extraction));
  const { context } = buildV2Context({
    query: "ราคาจะลงอีกไหม",
    ingredients: ING,
    extraction,
    serviceFacts: "",
  });
  check("ACC2: zero condition lines — the substring bug is structurally dead", !context.includes("หักประมาณ"));
  check("ACC2: the general fact answers", context.includes("ช่วงเปิดเทอมตลาดคึกคัก"));
}

// ── ACC3: "iPhone 20 Ultra" — absence plus the real devices ────────────────
{
  const extraction = ex({ intent: "price", family: "iphone", unknownModels: ["iPhone 20 Ultra"] });
  check("ACC3: an unknown model alone is worth answering", hasAnythingToWrite(ING, extraction));
  const { context } = buildV2Context({
    query: "iPhone 20 Ultra",
    ingredients: ING,
    extraction,
    serviceFacts: "",
  });
  check("ACC3: absence stated in the customer's own words", context.includes("iPhone 20 Ultra") && context.includes("ยังไม่มีในระบบรับซื้อ"));
  check("ACC3: real family devices offered with real prices", context.includes("iPhone 16 Pro Max") && context.includes("ช่วงราคารับซื้อของทุกรุ่น"));
  check("ACC3: the iPad never wanders into an iPhone answer", !context.includes("iPad Air 6"));
}

// ── ACC4: "เครื่องงอ" still gets a deduction figure ────────────────────────
// In v1 the word could not even be matched safely (substring trap) — in v2 it
// arrives as a picked option id and prices exactly like any other condition.
{
  const extraction = ex({ models: ["ip16pm"], conditions: ["set16:1:1"], intent: "deduction" });
  const { context } = buildV2Context({
    query: "iphone 16 pro max เครื่องงอ",
    ingredients: ING,
    extraction,
    serviceFacts: "",
  });
  check("ACC4: the bent-body option prices", context.includes("ตัวเครื่องงอ/บิด") && context.includes("หักประมาณ 3,000 บาท"));
  check("ACC4: remainder present and hedged", context.includes("เหลือประมาณ") && context.includes("ประเมินเบื้องต้น"));
}

// ── ACC5: a service question must not leak market facts ────────────────────
// "มีสาขาที่ไหนบ้าง" holds no model and no family, and the live `all` fact
// must NOT ride along dressed as part of the answer.
{
  const extraction = ex({ intent: "service", topics: ["branches"] });
  const { context } = buildV2Context({
    query: "มีสาขาที่ไหนบ้าง",
    ingredients: ING,
    extraction,
    serviceFacts: "\n\nข้อมูลร้าน (ข้อเท็จจริงจากระบบ):\nสาขาที่เปิดให้บริการ (2 แห่ง):\n- สาขาลาดปลาเค้า",
  });
  check("ACC5: store facts answer the question", context.includes("สาขาลาดปลาเค้า"));
  check("ACC5: no market fact leaks into a service answer", !context.includes("แนวโน้มราคาที่ทีมงานประเมินไว้") && !context.includes("เปิดเทอม"));
}

// ── ACC6: junk stays unanswered — and unpaid ───────────────────────────────
{
  const extraction = ex();
  const junkIng = sanitizeIngredients({
    models: [{ id: "a", name: "A", min: 1, max: 2 }],
    marketFacts: [
      { label: "ตลาดรวม", appliesTo: "all", text: "x", certainty: "y", expiresAt: FUTURE },
    ],
  });
  check("ACC6: junk query has nothing to write — stage 3 is never paid for", !hasAnythingToWrite(junkIng, extraction));
}

// ── ACC7: stage-1 validation — the ghost-model channel stays closed ────────
// The extractor answering with ids OUTSIDE the lists (the "iPhone 18 gets a
// price" family of bugs) is dropped at the parser, whatever the model says.
{
  const parsed = parseExtraction(
    '{"models": ["ip18", "ip16pm"], "conditions": ["set16:9:9", "set16:1:1"], "intent": "forecast", "unknown_models": ["iPhone 18"]}',
    ING
  );
  check("ACC7: phantom model id dropped, real one kept", parsed.models.length === 1 && parsed.models[0] === "ip16pm");
  check("ACC7: out-of-range condition address dropped", parsed.conditions.length === 1 && parsed.conditions[0] === "set16:1:1");
  check("ACC7: the absence still travels as words, never as an id", parsed.unknownModels[0] === "iPhone 18");
}

// ── done ───────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll v2 acceptance checks passed");
