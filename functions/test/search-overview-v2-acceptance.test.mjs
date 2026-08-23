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
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
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
    // The per-model split CLONES a set per model, so equivalent options carry
    // identical labels across sets — the fixture mirrors that reality, and
    // the cross-set resolution below depends on it.
    set15: {
      groups: [{ title: "สภาพหน้าจอ", options: [{ label: "ปกติ" }, { label: "จอแตก มองเห็นชัด", pct: 20 }] }],
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
  check("ACC3: real family devices offered with real prices", context.includes("iPhone 16 Pro Max") && context.includes("ช่วงราคารับซื้อรวมของทุกรุ่นในตระกูล iPhone"));
  // The span covers the family, and the customer's model is not in it. Saying
  // so is the difference between a helpful fallback and a price quoted for a
  // device we do not have.
  check("ACC3: the span is not pinned to the model that does not exist", context.includes("ห้ามผูกกับรุ่นที่ลูกค้าพิมพ์มา"));
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
  // NET ONLY: base 30,000-42,000 minus flat 3,000 → 27,000 - 39,000. The
  // เครื่องงอ answer still carries a real figure — just never the worksheet.
  check("ACC4: the bent-body condition prices as a NET estimate", context.includes("ตัวเครื่องงอ/บิด") && context.includes("ราคาประเมินเบื้องต้นอยู่ที่ประมาณ 27,000 - 39,000 บาท"));
  check("ACC4: no deduction amount, no base price for the conditioned model", !context.includes("หักประมาณ") && !context.includes("30,000 - 42,000"));
  check("ACC4: hedged as pre-inspection", context.includes("เป็นการประเมินเบื้องต้น"));
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

// ── ACC8 (probe round 1, fix 1): tolerant parser — a broken tail must not ──
// cost the customer a complete summary.
{
  const { parseOverviewV2 } = v2;
  const fenced = parseOverviewV2('```json\n{"summary": "ราคา 30,000 บาทครับ", "detail": "ขยาย"}\n```');
  check("ACC8: markdown fence stripped, clean parse", !!fenced && fenced.summary === "ราคา 30,000 บาทครับ" && fenced.salvaged === false);

  const truncated = v2.parseOverviewV2('{"summary": "iPhone 16 Pro Max รับซื้อ 30,000 - 32,000 บาทครับ", "detail": "แนวโน้มหลัง iPhone 18 เปิดตัวราคาอาจปรับลง 5-12% ซึ่ง');
  check("ACC8: truncated detail — the complete summary is salvaged whole", !!truncated && truncated.summary.includes("30,000 - 32,000") && truncated.salvaged === true);
  check("ACC8: the cut-off detail never ships half a sentence", truncated.detail === "");

  const cutSummary = parseOverviewV2('{"summary": "ราคาอยู่ที่ 30,0');
  check("ACC8: a summary cut mid-string is refused, not served broken", cutSummary === null);
}

// ── ACC9 (probe round 1, fix 2): the number gate — 21,120 must never reach ──
// the customer, however fluent the sentence around it.
{
  const { exciseUnverifiedNumbers } = v2;
  const context = "ราคารับซื้อ 30,000 - 32,000 บาท\nหักประมาณ 6,000 - 6,400 บาท";
  const good = exciseUnverifiedNumbers(
    { summary: "รับซื้อ 30,000 - 32,000 บาทครับ หักจอแตกประมาณ 6,000 - 6,400 บาทครับ", detail: "" },
    context
  );
  check("ACC9: verified numbers pass untouched", good.excised === 0 && good.summary.includes("30,000"));

  const bad = exciseUnverifiedNumbers(
    {
      summary: "รับซื้อ 30,000 - 32,000 บาทครับ หักแล้วเหลือประมาณ 21,120 บาทครับ",
      detail: "ยอด 21,120 บาทคือยอดหลังหักครับ",
    },
    context
  );
  check("ACC9: the self-computed 21,120 sentence is cut from summary", !!bad && !bad.summary.includes("21,120") && bad.summary.includes("30,000"));
  check("ACC9: and cut from detail, with the excisions counted", !bad.detail.includes("21,120") && bad.excised === 2);

  const allBad = exciseUnverifiedNumbers({ summary: "เหลือประมาณ 21,120 บาทครับ", detail: "" }, context);
  check("ACC9: a summary with nothing verifiable left is refused, not served empty", allBad === null);

  const commaFree = exciseUnverifiedNumbers({ summary: "รับซื้อสูงสุด 32000 บาทครับ", detail: "" }, context);
  check("ACC9: comma-free restatement of a context number still verifies", commaFree.excised === 0);
}

// ── ACC10 (probe round 1, fix 3): a condition with no model gets the honest ─
// generic answer — named, priced-by-inspection, and ZERO baht.
{
  const extraction = ex({ conditions: ["set16:1:1"], intent: "deduction" });
  // Answerability asserted on a fixture with NO pages and NO facts — the ING
  // fixture carries both, which let a mutation drop the conditions clause
  // without any test noticing (mutation testing round: hollow test caught).
  const bareIng = sanitizeIngredients({
    models: [{ id: "m", name: "M", min: 1, max: 2 }],
    conditionSets: ING.conditionSets,
  });
  check("ACC10: a picked condition ALONE is worth answering now", hasAnythingToWrite(bareIng, extraction));
  const { context } = buildV2Context({
    query: "เครื่องงอ ขายได้ไหม",
    ingredients: ING,
    extraction,
    serviceFacts: "",
  });
  check("ACC10: the condition is acknowledged by name", context.includes("ตัวเครื่องงอ/บิด") && context.includes("ยังไม่ระบุรุ่น"));
  check("ACC10: and carries no baht figure at all", !context.includes("บาท"));
  check("ACC10: with the buy-any-condition fact stated", context.includes("เรารับซื้อเครื่องทุกสภาพ"));
}

// ── ACC11: the generic note stands down when a real figure exists ──────────
{
  const extraction = ex({ models: ["ip16pm"], conditions: ["set16:1:1"], intent: "deduction" });
  const { context } = buildV2Context({
    query: "iphone 16 pro max เครื่องงอ",
    ingredients: ING,
    extraction,
    serviceFacts: "",
  });
  check("ACC11: real net estimate present", context.includes("ราคาประเมินเบื้องต้นอยู่ที่ประมาณ 27,000 - 39,000 บาท"));
  check("ACC11: the vague note never shadows a computed figure", !context.includes("ยังไม่ระบุรุ่น"));
  check("ACC11: the worksheet stays secret here too", !context.includes("หักประมาณ"));
}

// ── ACC12 (feedback เทสมือ: ไฮไลท์ใจความ + CTA ชี้รุ่นผิด): ใจความตัดสิน ──
// ก่อนเขียน — key_points เป็น "ตัวชี้" 1-3 วลี ไม่ใช่ช่องส่งข้อความใหม่ และ
// primary_model_id เป็นรหัสจากลิสต์เท่านั้น (drop, never promote)
{
  const { parseOverviewV2, exciseUnverifiedNumbers, admittedKeyPoints, primaryModelLegend } = v2;
  const clean = parseOverviewV2(
    '{"key_points": ["ตอนนี้เป็นจังหวะขายที่ดีครับ", "iPhone 16 Pro Max อยู่ที่ 30,000 บาท"], "primary_model_id": "ip16pm", "summary": "ตอนนี้เป็นจังหวะขายที่ดีครับ ราคา 30,000 บาทครับ", "detail": "iPhone 16 Pro Max อยู่ที่ 30,000 บาท"}',
    ING
  );
  check("ACC12: parser reads key_points as an array", clean.keyPoints.length === 2);
  check("ACC12: in-list primary_model_id survives", clean.primaryModelId === "ip16pm");
  check(
    "ACC12: out-of-list primary_model_id drops to null, never repaired",
    parseOverviewV2('{"key_points": [], "primary_model_id": "ip99", "summary": "ก"}', ING).primaryModelId === null
  );
  check(
    "ACC12: more than 3 key points = first 3 kept",
    parseOverviewV2('{"key_points": ["ก", "ข", "ค", "ง"], "summary": "กขคง"}', ING).keyPoints.join("") === "กขค"
  );
  check(
    "ACC12: empty key_points is a valid answer with no highlight",
    parseOverviewV2('{"key_points": [], "summary": "ไปที่หน้าประเมินได้เลยครับ"}', ING).keyPoints.length === 0
  );
  check(
    "ACC12: legacy single key_point folds in (prompt-drift tolerance)",
    parseOverviewV2('{"summary": "จังหวะดีครับ", "key_point": "จังหวะดีครับ"}', ING).keyPoints[0] === "จังหวะดีครับ"
  );

  const admitted = admittedKeyPoints(clean.keyPoints, { summary: clean.summary, detail: clean.detail });
  check("ACC12: a phrase verbatim in summary is admitted", admitted.includes("ตอนนี้เป็นจังหวะขายที่ดีครับ"));
  check("ACC12: a phrase verbatim in detail is admitted too", admitted.includes("iPhone 16 Pro Max อยู่ที่ 30,000 บาท"));
  check(
    "ACC12: a reworded phrase is dropped — no text enters through the side door",
    admittedKeyPoints(["จังหวะขายดีมาก"], { summary: clean.summary, detail: clean.detail }).length === 0
  );

  // Excision interaction: a key point aimed at the sentence the number gate
  // cut must die with it — a highlight would resurrect the cut sentence.
  const parsed = parseOverviewV2(
    '{"key_points": ["เหลือประมาณ 21,120 บาทครับ", "ราคารับซื้อ 30,000 บาทครับ"], "summary": "ราคารับซื้อ 30,000 บาทครับ เหลือประมาณ 21,120 บาทครับ"}',
    ING
  );
  const served = exciseUnverifiedNumbers(parsed, "ราคารับซื้อ 30,000 บาท");
  check("ACC12: excise cut the bad sentence", !served.summary.includes("21,120"));
  const afterExcise = admittedKeyPoints(parsed.keyPoints, served);
  check(
    "ACC12: key point aimed at an excised sentence dies with it, siblings survive",
    !afterExcise.includes("เหลือประมาณ 21,120 บาทครับ") && afterExcise.includes("ราคารับซื้อ 30,000 บาทครับ")
  );

  // key_points is FIRST in the demanded field order, so a reply truncated
  // mid-detail still carries it whole through the salvage path.
  const salvage = parseOverviewV2(
    '{"key_points": ["ขายก่อนเปิดตัวคุ้มกว่าครับ"], "primary_model_id": "ip16pm", "summary": "ขายก่อนเปิดตัวคุ้มกว่าครับ", "detail": "ยาวมากแล้วโดนตั',
    ING
  );
  check(
    "ACC12: salvage carries key_points and primary_model_id",
    salvage.salvaged === true && salvage.keyPoints[0] === "ขายก่อนเปิดตัวคุ้มกว่าครับ" && salvage.primaryModelId === "ip16pm"
  );

  // The id legend: chosen models only, and never for an empty pick — the CTA
  // may point at what the answer is about, not at a sibling.
  const legend = primaryModelLegend(ING, ex({ models: ["ip16pm"] }));
  check(
    "ACC12: legend lists exactly the chosen models",
    legend.includes("iPhone 16 Pro Max = ip16pm") && !legend.includes("ip15pm")
  );
  check("ACC12: no chosen model = no legend", primaryModelLegend(ING, ex()) === "");

  const P = v2.buildV2SystemPrompt("มาติน");
  // Twice rewritten, and the history is the argument. It first pinned
  // key_points FIRST ("decide the point, then write the prose from it") —
  // 5 of 77 production answers carried a highlight, 69 phrases rejected for
  // not matching the prose word for word. Then prose-first-then-copy — 0 of
  // the 4 answers measured after. Reproducing your own phrase exactly is not
  // something to instruct harder; it is something to stop asking for. The
  // writer now sends a sentence NUMBER. Full contract at the end of this file.
  check(
    "ACC12: prompt demands the answer first, then the NUMBER of a sentence in it",
    P.includes('"key_point_sentences"') &&
      P.includes("เขียน summary กับ detail ให้เสร็จก่อน") &&
      P.includes("หมายเลขประโยค")
  );
}

// ── ACC13 (พบบน preview): ชื่อที่ catalog รู้จัก ห้ามกลายเป็น "ยังไม่มีข้อมูล" ─
// stage 1 เคยใส่ iPhone 16 Pro Max ลง unknown_models ทั้งที่การ์ดข้างล่าง
// ขายอยู่ที่ 30,000 — การ์ด guard ต้องดักที่ parser ไม่ใช่หวังพึ่ง prompt
{
  const both = parseExtraction(
    '{"models": ["ip16"], "unknown_models": ["iPhone 16 Pro Max", "ไอโฟน 16 โปรแม็กซ์", "iphone16promax", "iPhone 20 Ultra"], "intent": "price"}',
    ING
  );
  check(
    "ACC13: catalog-known names dropped from unknown_models (name, Thai alias, squashed spelling)",
    both.unknownModels.length === 1 && both.unknownModels[0] === "iPhone 20 Ultra"
  );
  check("ACC13: the drops are counted for the log", both.dropped.knownAsUnknown === 3);
  check(
    "ACC13: prompt pushes back on shorthand before unknown",
    v2.buildExtractSystemPrompt().includes("ก่อนใส่ต้องเช็คลิสต์")
  );
}

// ── ACC14 (พบบน preview): ชุดประเมินรายรุ่น — cid คือแนวคิดสภาพ ไม่ใช่แถว ──
// "iphone 16 pro max จอแตก ขายได้เท่าไหร่" เคยได้คำตอบไร้ตัวเลข: stage 1
// เลือก "จอแตก" จากชุดของรุ่นอื่น (per-model split = ชุดใครชุดมัน) แล้ว
// equality check เดิม (setId === conditionSetId) หาไม่เจอเงียบๆ. กติกาใหม่:
// รุ่นที่ถูกเลือกไปหา option ป้ายเดียวกันในชุดของตัวเอง
{
  const { conditionChoices, deductionSection } = v2.__test;

  // The stage-1 menu carries ONE row per concept — the three-clones-of-จอแตก
  // menu is exactly the pick a small model gets wrong.
  const choices = conditionChoices(ING);
  const cracked = choices.filter((c) => c.label === "จอแตก มองเห็นชัด");
  check("ACC14: duplicate per-model clones collapse to one menu row", cracked.length === 1);
  check(
    "ACC14: the surviving rows all come from the first set seen",
    choices.every((c) => c.cid.startsWith("set16:"))
  );

  // The cid from ip15pm's set prices ip16pm from ip16pm's OWN set:
  // 20% of 30,000-42,000 → net 21,600 - 36,000.
  const extraction = ex({ models: ["ip16pm"], conditions: ["set15:0:1"], intent: "deduction" });
  const { context } = buildV2Context({
    query: "iphone 16 pro max จอแตก ขายได้เท่าไหร่",
    ingredients: ING,
    extraction,
    serviceFacts: "",
  });
  check(
    "ACC14: cross-set cid still yields the NET estimate",
    context.includes("จอแตก มองเห็นชัด") && context.includes("ราคาประเมินเบื้องต้นอยู่ที่ประมาณ 21,600 - 36,000 บาท")
  );
  check(
    "ACC14: net only — no worksheet, no base price, no vague fallback note",
    !context.includes("หักประมาณ") && !context.includes("30,000 - 42,000") && !context.includes("ยังไม่ระบุรุ่น")
  );

  // Both clones picked at once = one concept, priced once — never stacked.
  const both = ex({ models: ["ip16pm"], conditions: ["set16:0:1", "set15:0:1"], intent: "deduction" });
  const twice = buildV2Context({
    query: "iphone 16 pro max จอแตก",
    ingredients: ING,
    extraction: both,
    serviceFacts: "",
  });
  check(
    "ACC14: the same concept picked twice deducts once",
    twice.context.includes("21,600 - 36,000") && !twice.context.includes("13,200")
  );

  // A set that genuinely lacks the concept still prices nothing — cross-set
  // resolution widens the address, never invents an option.
  const ip15pm = ING.models.find((m) => m.id === "ip15pm");
  const lacks = deductionSection([ip15pm], ING, ex({ conditions: ["set16:1:1"], intent: "deduction" }));
  check(
    "ACC14: a set without the option prices nothing for that model",
    lacks.text === "" && lacks.coveredIds.size === 0
  );

  // The loose fallback: an admin renames a GROUP in one clone but keeps the
  // option label — same label under a different title still resolves, but
  // only while it is unambiguous. Two same-label homes = refuse, never guess.
  const { resolveConditionForSet } = v2.__test;
  const renamedIng = sanitizeIngredients({
    models: [{ id: "m1", name: "M1", min: 1000, max: 2000, conditionSetId: "setB" }],
    conditionSets: {
      setA: { groups: [{ title: "สภาพหน้าจอ", options: [{ label: "ปกติ" }, { label: "จอแตก", pct: 20 }] }] },
      setB: { groups: [{ title: "หน้าจอ", options: [{ label: "ปกติ" }, { label: "จอแตก", pct: 25 }] }] },
      setC: {
        groups: [
          { title: "จอด้านหน้า", options: [{ label: "จอแตก", pct: 10 }] },
          { title: "จอด้านหลัง", options: [{ label: "จอแตก", pct: 15 }] },
        ],
      },
    },
  });
  const renamed = resolveConditionForSet("setA:0:1", renamedIng, renamedIng.conditionSets.setB);
  check(
    "ACC14: renamed group, same label — the loose fallback still resolves",
    renamed !== null && renamed.option.pct === 25
  );
  const ambiguous = resolveConditionForSet("setA:0:1", renamedIng, renamedIng.conditionSets.setC);
  check("ACC14: two same-label homes in one set — refuse rather than guess", ambiguous === null);
}

// ── the highlight the writer could not hit ─────────────────────────────────
//
// Production, 23 ส.ค. 2569, 77 v2 answers: FIVE carried a highlight. 69
// proposed phrases were rejected, and roughly 60% of answers never proposed
// one at all. The feature worked 6.5% of the time and failed silently, since
// an answer without a highlight still reads perfectly.
//
// Both halves trace to the same instruction. key_points was demanded FIRST —
// name the point, then write the prose from it — so the writer produced the
// phrase from intention and then worded the prose differently, and the
// verbatim rule (which markKeyPoints needs: it does a literal startsWith on
// the served text) threw the phrase away. The escape hatch, "a short answer
// may use []", was wide enough that most answers took it.
//
// The fix is order, not tolerance: prose first, then COPY a span out of it.
{
  const P = v2.buildV2SystemPrompt("มาติน");

  check(
    "keypoints: the answer body is demanded before the highlight",
    P.indexOf('{"summary"') !== -1 &&
      P.indexOf('"key_point_sentences": [0]}') > P.indexOf('{"summary"')
  );
  // Round two of this fix, and the last one that touches the writer's job at
  // all: asking it to reproduce a phrase failed twice (5 highlights in 77
  // answers, then 0 in the 4 measured after the reorder). It now sends a
  // NUMBER, and a number cannot be misspelled.
  check(
    "keypoints: the writer sends a sentence number, never the sentence",
    P.includes("หมายเลขประโยค") && P.includes("ห้ามพิมพ์ข้อความของประโยคซ้ำ")
  );
  check(
    "keypoints: and is told exactly how the sentences are counted",
    P.includes("นับ summary ก่อนจนหมด แล้วนับ detail ต่อ เริ่มที่ 0")
  );
  check(
    "keypoints: nothing in the prompt asks for the phrase text any more",
    !P.includes("คัดลอกวลีออกมาจาก") && !P.includes("แบบคำต่อคำทุกตัวอักษร")
  );
  // The old permission ("a SHORT answer may use []") let length excuse the
  // field. The floor is now what the answer CONTAINS.
  check(
    "keypoints: an answer carrying a figure or a verdict must mark something",
    P.includes("ต้องมี key_point_sentences อย่างน้อย 1 หมายเลขเสมอ")
  );
  check(
    "keypoints: [] survives only for a pure signpost",
    P.includes("ใส่ [] ได้เฉพาะคำตอบที่เป็นการชี้ทางล้วนๆ") && !P.includes("คำตอบสั้นหรือเป็นการชี้ทางที่ไม่มีใจความต้องเน้น")
  );

  // Order is a live property of the parser too: a reply cut short must lose
  // the highlight, never the answer.
  const truncated = v2.parseOverviewV2(
    '{"summary": "iPhone 16 Pro Max อยู่ที่ 30,000 บาทครับ", "detail": "ราคานี้คิดจากสภาพปกติ", "primary_model_id": "ip16pm", "key_p',
    { models: [{ id: "ip16pm" }] }
  );
  check("keypoints: a truncated reply keeps its summary", truncated && truncated.summary.includes("30,000"));
  check("keypoints: and its detail", truncated && truncated.detail.includes("ราคานี้คิดจากสภาพ"));
  check("keypoints: losing only the highlight", truncated && truncated.keyPointSentences.length === 0);
}

// ── resolving a highlight from a number ───────────────────────────────────
//
// The mechanism that replaces verbatim matching. Every case here is one the
// phrase version could get wrong and this one cannot.
{
  const written = {
    summary: "iPhone 16 Pro Max อยู่ที่ 30,000 บาทครับ ตอนนี้เป็นจังหวะขายที่ดีครับ",
    detail: "ราคานี้คิดจากสภาพปกติครับ",
  };
  const servedAll = { summary: written.summary, detail: written.detail };

  const first = v2.keyPointsFromSentences([0], written, servedAll);
  check("index 0 is the first sentence of the summary", first[0] === "iPhone 16 Pro Max อยู่ที่ 30,000 บาทครับ");
  const second = v2.keyPointsFromSentences([1], written, servedAll);
  check("index 1 is the second", second[0] === "ตอนนี้เป็นจังหวะขายที่ดีครับ");
  // The count runs on into detail, exactly as the prompt says it does.
  const intoDetail = v2.keyPointsFromSentences([2], written, servedAll);
  check("the count continues into detail", intoDetail[0] === "ราคานี้คิดจากสภาพปกติครับ");

  // Whatever comes back IS a substring of the served text — which is the only
  // property markKeyPoints needs, and the one the phrase version kept missing.
  check(
    "every resolved highlight is a real substring of what is served",
    v2.keyPointsFromSentences([0, 1], written, servedAll).every(
      (k) => servedAll.summary.includes(k) || servedAll.detail.includes(k)
    )
  );

  // Excision runs between writing and serving. A sentence the number gate cut
  // must not come back as a highlight pointing at text nobody can see.
  const servedCut = { summary: "iPhone 16 Pro Max อยู่ที่ 30,000 บาทครับ", detail: "" };
  check("a highlight orphaned by excision is dropped", v2.keyPointsFromSentences([1], written, servedCut).length === 0);
  check("its surviving neighbour still resolves", v2.keyPointsFromSentences([0], written, servedCut).length === 1);

  // Junk in, nothing out — never a guess at what was meant.
  check("an out-of-range number yields nothing", v2.keyPointsFromSentences([99], written, servedAll).length === 0);
  check("no numbers means no highlight", v2.keyPointsFromSentences([], written, servedAll).length === 0);
  // Refused: anything that would have to be GUESSED at. Accepted: a number
  // that happens to arrive quoted — models emit "0" for 0 often enough that
  // refusing it would throw away a perfectly unambiguous index.
  const junk = v2.parseOverviewV2(
    '{"summary": "s", "key_point_sentences": [-1, 1.5, null, "x", "0"]}',
    { models: [] }
  ).keyPointSentences;
  check("negatives, fractions, null and words are refused, not rounded", !junk.some((n) => n !== 0));
  check("a quoted number is still a number", junk.length === 1 && junk[0] === 0);
  check(
    "a duplicate number highlights once",
    v2.keyPointsFromSentences([0, 0], written, servedAll).length === 1
  );

  // WIRING. Everything above passes with a resolver nothing calls — proved by
  // injection: breaking the handler's branch left this whole file green. The
  // mechanism is only real if stage 3 actually reaches for it.
  const handlerSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "search-overview.js"),
    "utf-8"
  );
  check(
    "wiring: the handler resolves highlights from sentence numbers",
    handlerSrc.includes("keyPointsFromSentences(sentences, parsed, verified)")
  );
  check(
    "wiring: and only falls back to phrases when no number came",
    /keyPoints = sentences\.length\s*\?\s*keyPointsFromSentences/.test(handlerSrc) &&
      handlerSrc.includes(": admittedKeyPoints(parsed.keyPoints, verified)")
  );
  check(
    "wiring: resolved against the answer AS WRITTEN, before it is rebound to the served text",
    handlerSrc.indexOf("keyPointsFromSentences(sentences, parsed, verified)") <
      handlerSrc.indexOf("parsed = { summary: verified.summary")
  );
}

// ── done ───────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll v2 acceptance checks passed");
