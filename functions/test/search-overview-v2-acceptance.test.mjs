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
// ก่อนเขียน — ไฮไลท์เป็น "ตัวชี้" ไม่ใช่ช่องส่งข้อความใหม่ และ
// primary_model_id เป็นรหัสจากลิสต์เท่านั้น (drop, never promote)
//
// The highlight now arrives MARKED IN PLACE inside the prose. A model-supplied
// `key_points` array is no longer an input at all: it was the channel through
// which the writer could introduce text that is not in the answer, and three
// production rounds showed it mostly introduced text that did not match.
{
  const { parseOverviewV2, exciseUnverifiedNumbers, admittedKeyPoints, primaryModelLegend } = v2;
  const clean = parseOverviewV2(
    '{"primary_model_id": "ip16pm", "summary": "\u00abตอนนี้เป็นจังหวะขายที่ดีครับ\u00bb ราคา 30,000 บาทครับ ยอดสุดท้ายยืนยันหลังตรวจเครื่อง", "detail": "\u00abiPhone 16 Pro Max อยู่ที่ 30,000 บาท\u00bb และรุ่นอื่นในตระกูลราคาต่างกันตามความจุ"}',
    ING
  );
  check("ACC12: the marked spans become the key points", clean.keyPoints.length === 2);
  check("ACC12: in-list primary_model_id survives", clean.primaryModelId === "ip16pm");
  check(
    "ACC12: out-of-list primary_model_id drops to null, never repaired",
    parseOverviewV2('{"primary_model_id": "ip99", "summary": "ก"}', ING).primaryModelId === null
  );
  check(
    "ACC12: more than 3 marked spans = first 3 kept",
    parseOverviewV2(
      '{"summary": "\u00abหนึ่ง\u00bb \u00abสอง\u00bb \u00abสาม\u00bb \u00abสี่\u00bb ปิดท้ายด้วยข้อความยาวพอที่จะไม่ชนเพดานสัดส่วน"}',
      ING
    ).keyPoints.join("") === "หนึ่งสองสาม"
  );
  check(
    "ACC12: no marks is a valid answer with no highlight",
    parseOverviewV2('{"summary": "ไปที่หน้าประเมินได้เลยครับ"}', ING).keyPoints.length === 0
  );
  check(
    "ACC12: a key_points array from the model is ignored — the door is closed",
    parseOverviewV2('{"summary": "จังหวะดีครับ", "key_points": ["ข้อความที่ไม่ได้อยู่ในคำตอบ"]}', ING).keyPoints.length === 0
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
    '{"summary": "\u00abราคารับซื้อ 30,000 บาทครับ\u00bb \u00abเหลือประมาณ 21,120 บาทครับ\u00bb"}',
    ING
  );
  const served = exciseUnverifiedNumbers(parsed, "ราคารับซื้อ 30,000 บาท");
  check("ACC12: excise cut the bad sentence", !served.summary.includes("21,120"));
  const afterExcise = admittedKeyPoints(parsed.keyPoints, served);
  check(
    "ACC12: key point aimed at an excised sentence dies with it, siblings survive",
    !afterExcise.includes("เหลือประมาณ 21,120 บาทครับ") && afterExcise.includes("ราคารับซื้อ 30,000 บาทครับ")
  );

  // The marks live INSIDE summary, so the salvage path — which recovers the
  // summary field from a reply too broken to JSON.parse — recovers them with
  // it. That is a property of putting them in the prose rather than in a
  // sibling field that truncation could take.
  const salvage = parseOverviewV2(
    '{"primary_model_id": "ip16pm", "summary": "\u00abขายก่อนเปิดตัวคุ้มกว่าครับ\u00bb รอไปอีกสองเดือนราคามักจะลง", "detail": "ยาวมากแล้วโดนตั',
    ING
  );
  check(
    "ACC12: salvage carries the marked span and primary_model_id",
    salvage.salvaged === true && salvage.keyPoints[0] === "ขายก่อนเปิดตัวคุ้มกว่าครับ" && salvage.primaryModelId === "ip16pm"
  );
  check("ACC12: and the salvaged summary is clean", !salvage.summary.includes("\u00ab"));

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
    "ACC12: prompt asks for the highlight to be marked inside the prose",
    P.includes("ครอบข้อความช่วงที่สำคัญที่สุด") && P.includes("\u00ab") && P.includes("\u00bb")
  );
}

// ── the highlight contract, in full ───────────────────────────────────────
//
// Four mechanisms, and each one's epitaph is a production number:
//   repeat the phrase          -> 5 / 77
//   copy it after the prose    -> 0 / 4
//   send the sentence number   -> the whole answer, or nothing
//   mark it in place           -> this one
//
// What the first three shared is that the writer had to produce something
// that MATCHED something else. This one has nothing to match.
{
  const P = v2.buildV2SystemPrompt("มาติน");

  check(
    "keypoints: the marks go in the prose, and nothing is repeated anywhere",
    P.includes("ในเนื้อความเลย") && P.includes("ไม่ต้องพิมพ์ซ้ำที่ไหน") && P.includes("ไม่ต้องนับประโยค")
  );
  check(
    "keypoints: the markers are reserved — they mean one thing only",
    P.includes("ห้ามใช้เครื่องหมาย \u00ab \u00bb เพื่อจุดประสงค์อื่นเด็ดขาด")
  );
  check(
    "keypoints: one span, and never the whole paragraph",
    P.includes("ครอบ 1 ช่วงต่อคำตอบ") && P.includes("เท่ากับไม่ได้เน้นอะไรเลย")
  );
  check(
    "keypoints: an answer carrying a figure or a verdict must mark something",
    P.includes("ต้องครอบอย่างน้อย 1 ช่วงเสมอ")
  );
  check(
    "keypoints: the response shape no longer carries a highlight field at all",
    P.includes('{"summary": "...", "detail": "...", "primary_model_id": "..."}') &&
      !P.includes("key_point_sentences")
  );
  check(
    "keypoints: every trace of asking the writer to reproduce text is gone",
    !P.includes("คัดลอกวลีออกมาจาก") && !P.includes("แบบคำต่อคำทุกตัวอักษร") && !P.includes("หมายเลขประโยค")
  );

  const truncated = v2.parseOverviewV2(
    '{"summary": "\u00abiPhone 16 Pro Max อยู่ที่ 30,000 บาทครับ\u00bb ราคานี้คิดจากสภาพปกติ", "detail": "ยอดสุดท้ายยืน',
    { models: [{ id: "ip16pm" }] }
  );
  check("keypoints: a truncated reply keeps its summary", truncated && truncated.summary.includes("30,000"));
  check("keypoints: and its highlight, because the mark rides inside the summary", truncated.keyPoints.length === 1);
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

// ── the highlight the writer marks in place ───────────────────────────────
//
// Mechanism four, and the reasons the first three died are the design:
//
//   1. repeat the phrase in key_points  -> 5 highlights in 77 answers
//   2. same, but copied after the prose -> 0 in 4
//   3. send the sentence NUMBER         -> marked everything, or nothing
//
// Three failed because the writer had to reproduce or to count. Marking in
// place asks it to do neither, and the span is a substring because it was
// never separate from the text.
//
// Number three is worth pinning precisely, because the bug was not in the
// writer at all: splitSentences breaks on `. ! ?` and on "ครับ", and Thai
// separates sentences with SPACES. A Thai paragraph with no full stop is ONE
// chunk, so index 0 meant "the whole answer" and index 1 meant nothing.
{
  const THAI = "iPhone 17e ความจุ 256GB ประเมินราคาเบื้องต้นอยู่ที่ 12,250 บาท ราคานี้คิดจากสภาพปกติ ครบกล่องพร้อมสาย";
  check(
    "the Thai splitter really does see one chunk — the bug this replaces",
    v2.__test.splitSentences(THAI).length === 1
  );

  const marked = `iPhone 17e ความจุ 256GB \u00abประเมินราคาเบื้องต้นอยู่ที่ 12,250 บาท\u00bb ราคานี้คิดจากสภาพปกติ ครบกล่องพร้อมสาย`;
  const out = v2.extractMarkedSpans(marked);
  check("the marked span comes out", out.spans[0] === "ประเมินราคาเบื้องต้นอยู่ที่ 12,250 บาท");
  check("and it is a substring of the cleaned text", out.text.includes(out.spans[0]));
  check("no marker survives into the served text", !out.text.includes("\u00ab") && !out.text.includes("\u00bb"));
  check("the prose is otherwise untouched", out.text === THAI);

  // A stray opener would reach the customer as a loose character.
  const unbalanced = v2.extractMarkedSpans("ราคา \u00ab12,250 บาท ครบกล่อง");
  check("an unbalanced marker yields no span", unbalanced.spans.length === 0);
  check("and is still stripped from the text", !unbalanced.text.includes("\u00ab"));

  // Wrapping the WHOLE answer is not emphasis — that is the state the
  // sentence-number version shipped in, and the only thing this guard is for.
  const greedy = v2.extractMarkedSpans("\u00abทั้งย่อหน้าถูกครอบไว้หมดเลยครับ\u00bb");
  check("a span covering the entire answer is dropped as shading", greedy.spans.length === 0);
  check("but the text still serves, without markers", greedy.text.startsWith("ทั้งย่อหน้า"));
  // ...while one sentence of two is the emphasis we asked for, however large a
  // share of a short answer it happens to be. An earlier 0.6 ceiling here threw
  // this exact case away.
  const half = v2.extractMarkedSpans(
    "\u00abiPhone 16 Pro Max อยู่ที่ 30,000 บาทครับ\u00bb ราคานี้คิดจากสภาพปกติ"
  );
  check("one sentence of two survives", half.spans.length === 1);

  const two = v2.extractMarkedSpans(
    "\u00abหนึ่ง\u00bb กลางประโยคที่ยาวพอสมควรเพื่อให้สัดส่วนไม่เกินเพดาน \u00abสอง\u00bb ปิดท้ายด้วยข้อความอีกหน่อย"
  );
  check("two marked spans both come out, in order", two.spans[0] === "หนึ่ง" && two.spans[1] === "สอง");
  check("no text without markers is touched at all", v2.extractMarkedSpans("ไม่มีเครื่องหมายเลย").spans.length === 0);

  // End to end through the parser: what the handler receives is already clean.
  const parsed = v2.parseOverviewV2(
    JSON.stringify({
      summary: `\u00abiPhone 16 Pro Max อยู่ที่ 30,000 บาท\u00bb ราคานี้คิดจากสภาพปกติ ยอดสุดท้ายยืนยันหลังตรวจเครื่องจริง`,
      detail: "",
      primary_model_id: "ip16pm",
    }),
    { models: [{ id: "ip16pm" }] }
  );
  check("parse: the span becomes a key point", parsed.keyPoints[0] === "iPhone 16 Pro Max อยู่ที่ 30,000 บาท");
  check("parse: the summary is served clean", !parsed.summary.includes("\u00ab"));
  check("parse: and the key point is a substring of it", parsed.summary.includes(parsed.keyPoints[0]));

  // WIRING. The parser can be perfect and the handler can still drop it.
  const handlerSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "search-overview.js"),
    "utf-8"
  );
  check(
    "wiring: the handler admits the spans the parser found",
    handlerSrc.includes("keyPoints = admittedKeyPoints(parsed.keyPoints, verified);")
  );
  check(
    "wiring: checked against the SERVED text, so excision still wins",
    handlerSrc.indexOf("admittedKeyPoints(parsed.keyPoints, verified)") <
      handlerSrc.indexOf("parsed = { summary: verified.summary")
  );
  check("wiring: the sentence-number mechanism is gone, not merely unused", !handlerSrc.includes("keyPointsFromSentences"));
}

// ── done ───────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll v2 acceptance checks passed");
