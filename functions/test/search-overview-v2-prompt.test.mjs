// ---------------------------------------------------------------------------
// Offline test for the v2 three-layer prompt (V2-C).
//
//   node functions/test/search-overview-v2-prompt.test.mjs
//
// Three things are pinned, in rising order of subtlety:
//
//   1. Layer 1 carries the WHOLE substance of the v1 rulebook — every ban
//      that exists because of a real production failure must survive the
//      rewrite (the button invitation, the branch paragraph with no branch,
//      the range collapsed to a single figure).
//   2. Layers 2-3 exist and are positively phrased WITHOUT reopening the
//      call-to-action door — the exact hazard the spec names for positive
//      rules.
//   3. The prompt's quoted anchors match what stage 2 actually prints.
//      A rule that says "only speak from the line named X" dies silently the
//      day the section stops printing X — so the anchors are asserted against
//      the real section builders, not against the prompt alone.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const v2 = require("../search-overview-v2.js");
const { buildV2SystemPrompt } = v2;
const { marketFactSection, seriesSection } = v2.__test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const P = buildV2SystemPrompt("มาติน");

// ── 1. Layer 1: the v1 substance, present and negative ─────────────────────

check("layer1: numbers from the system context only", P.includes("ข้อมูลจากระบบ") && P.includes("ห้ามคำนวณ"));
check("layer1: condition estimates are read-only", P.includes("ราคาประเมินตามสภาพ") && P.includes("ใช้ตรงๆ เท่านั้น"));
check(
  "layer1: unpriced defects get an inspection answer, not an estimate",
  P.includes("ตำหนิที่ไม่มีบรรทัดราคาประเมินให้ ห้ามประมาณตัวเลขเอง")
);
check(
  "layer1: the deduction table is a trade secret — net only, no worksheet",
  P.includes("ความลับทางการค้า") && P.includes("ห้ามแจกแจงว่าราคาเต็มเท่าไหร่ หักรายการละเท่าไหร่")
);
check("layer1: every figure is pre-inspection", P.includes("ยืนยันหลังตรวจสภาพเครื่อง"));
check("layer1: no guarantee words", P.includes("รับประกัน") && P.includes("การันตี"));
check("layer1: forecast range must not collapse", P.includes("ห้ามทำช่วงให้แคบลงหรือเปลี่ยนเป็นเลขเดี่ยว"));
check("layer1: no self-made percent-to-baht", P.includes("ห้ามแปลงเปอร์เซ็นต์เป็นบาทเอง"));
check("layer1: unknown model is an absence, not a refusal", P.includes("ห้ามบอกว่าเราไม่รับซื้อ"));
check("layer1: paused model gets no price", P.includes("งดรับซื้อ") && P.includes("ห้ามเสนอราคาให้"));
check("layer1: say-what-is-missing rule", P.includes("ให้บอกตรงๆ ในประโยคแรก"));
check("layer1: no questions back (one-shot surface)", P.includes("ห้ามถามคำถามกลับ"));
check("layer1: no internal ids or mechanisms", P.includes("ห้ามเอ่ยถึงข้อมูลภายในระบบ"));
check("layer1: no emoji", P.includes("อีโมจิ"));
check("layer1: no outside knowledge, no market prices", P.includes("ราคาตลาด") && P.includes("ความรู้นอกเหนือ"));
check("layer1: buyback price is not resale price", P.includes("ไม่ใช่ราคาขายต่อ"));

// ── 2. Layers 2-3: positive, with the CTA door still closed ────────────────

check("layer2: think the next step for the customer", P.includes("คิดขั้นถัดไปแทนลูกค้า"));
check(
  "layer2: next-step is data, never an invitation (the spec's named hazard)",
  P.includes("ไม่ใช่การชวนให้ทำอะไร")
);
check("layer2: compare alternatives with real figures", P.includes("เทียบทางเลือกด้วยเลขจริง"));
check("layer2: join the blocks into one picture", P.includes("ภาพเดียว"));
check("layer2: answer completeness standard", P.includes("อ่านจบแล้วตัดสินใจได้"));
check("layer3: verdict when the data points", P.includes("ให้ฟันธง"));
check("layer3: no escape into 'up to you'", P.includes("ขึ้นอยู่กับคุณ"));
check("layer3: every verdict carries checkable reasons", P.includes("เหตุผลที่ตรวจสอบได้"));
check("layer3: ambiguity said out loud", P.includes("ก้ำกึ่งตรงไหน"));
check("layer3: red line — data, never the shop's interest", P.includes("ห้ามฟันธงจากผลประโยชน์ของร้าน"));
check("layer3: the day the data says wait, say wait", P.includes("ให้พูดว่ารอ"));
check("layer3: tone — no urgency, no selling", P.includes("ไม่เร่งเร้า") && P.includes("ไม่ขายของ"));

// The closing bans, kept verbatim in spirit from v1 — these are the lines the
// positive layers must never override, and the original reason the whole
// rulebook is negative.
// THE WRITER MARKS THE SPAN IN PLACE. Three mechanisms died here and the
// prompt carries the scar tissue of all three, so these checks pin the one
// that survived rather than its wording.
//
//   1. name the phrase first, then write the prose  -> 5 highlights / 77
//   2. write the prose first, then copy the phrase  -> 0 / 4
//   3. send the sentence NUMBER, slice it in code   -> whole answer, or none
//
// (3) failed on Thai itself: Thai separates sentences with SPACES, so
// splitSentences returns ONE chunk for a whole paragraph — index 0 marked
// everything, index 1 fell off the end. Both are in the same screenshot pair.
//
// Marking in place asks for none of that: no reproducing, no copying, no
// counting, no agreement with a splitter. What the model writes between the
// marks IS the span, and the code strips the marks before anyone sees them.
check(
  "format: JSON only, and no highlight field is asked for at all",
  P.includes('{"summary": "...", "detail": "...", "primary_model_id": "..."}') &&
    !P.includes("key_point_sentences")
);
check(
  "format: the span is marked inside the prose, with both marks named",
  P.includes("\u00ab") && P.includes("\u00bb") && P.includes("ในเนื้อความเลย")
);
check(
  "format: and the three dead mechanisms are not asked for as well",
  !P.includes("หมายเลขประโยค") && !P.includes("คัดลอกวลีออกมาจาก") && !P.includes("แบบคำต่อคำทุกตัวอักษร")
);
check(
  "format: the marks are reserved — no quoting with them",
  P.includes("ห้ามใช้เครื่องหมาย \u00ab \u00bb เพื่อจุดประสงค์อื่นเด็ดขาด")
);
// One span, and short. The ceiling is enforced in extractMarkedSpans against
// the answer's own length (MARK_MAX_SHARE) because production marked a whole
// two-sentence summary under mechanism 3 and a prompt asking for restraint had
// already failed to prevent it once.
// THE SPAN NAMES THE DEVICE. Production, 23 ส.ค. 2569, "iPhone 11 128GB แบต
// 78% ขายได้ไหม": the answer read "ขายได้ครับ iPhone 11 128GB แบตเตอรี่ 78%
// ประเมินราคาที่ 2,000 บาท ..." and the marked span was "ประเมินราคาที่ 2,000
// บาท" alone. True, and the wrong shape — the highlight is what gets read
// first, and a figure with no device attached does not say whose 2,000 baht it
// is. The results list under it had iPhone 11 at 2,500.
//
// "must stand on its own, subject and substance" was already in the prompt and
// did not produce it, so the replacement has two endpoints instead of a
// standard: start at the model name, end at the figure. These pin BOTH halves
// — the rule and the counter-example — because the rule alone is what already
// failed once.
check(
  "format: a priced answer must mark from the model name through to the figure",
  P.includes("เริ่มที่ชื่อรุ่น") && P.includes("จบที่ตัวเลขราคา")
);
check(
  "format: and the price-clause-only span is named as wrong, not merely discouraged",
  P.includes("ห้ามครอบเฉพาะท่อนราคาโดยไม่มีชื่อรุ่นอยู่ในช่วง")
);
check(
  "format: asks for one short span and says why a long one is worthless",
  P.includes("ครอบ 1 ช่วงต่อคำตอบ") && P.includes("เท่ากับไม่ได้เน้นอะไรเลย")
);
// The old escape hatch keyed on LENGTH ("a short answer may use []") and most
// answers took it. The floor is what the answer contains.
check(
  "format: a figure or a verdict obliges a span",
  P.includes("ต้องครอบอย่างน้อย 1 ช่วงเสมอ") && P.includes("ไม่ครอบเลยได้เฉพาะคำตอบที่เป็นการชี้ทางล้วนๆ")
);
check(
  "format: primary_model_id comes from the legend or is null",
  P.includes("รหัสรุ่นสำหรับ field primary_model_id") && P.includes("ใส่ null")
);
check("format: no closing call-to-action", P.includes("ห้ามเขียนชวนให้กดประเมินราคาหรือกดปุ่มใดๆ"));
check("format: no links, no button names", P.includes("ห้ามใส่ลิงก์ URL"));

// ── 3. Anchors match what stage 2 actually prints ──────────────────────────

const FUTURE = Date.now() + 86400000;
const factLines = marketFactSection(
  [{ label: "iPhone 18", appliesTo: "iphone", certainty: "ปานกลาง", dropPctMin: 5, dropPctMax: 12, expiresAt: FUTURE }],
  [{ id: "x", name: "iPhone 16", min: 20000, max: 24000 }],
  null
);
check(
  "anchor: forecast header exists in prompt AND in the rendered section",
  P.includes("แนวโน้มราคาที่ทีมงานประเมินไว้") && factLines.includes("แนวโน้มราคาที่ทีมงานประเมินไว้")
);
check(
  "anchor: precomputed-baht line exists in prompt AND in the rendered section",
  P.includes("คิดเป็นเงินประมาณ") && factLines.includes("คิดเป็นเงินประมาณ")
);
const seriesLines = seriesSection(
  { series: [{ modelId: "x", days: 30, changePct: -8 }] },
  [{ id: "x", name: "iPhone 16" }]
);
check(
  "anchor: history header exists in prompt AND in the rendered section",
  P.includes("ความเคลื่อนไหวราคาที่ผ่านมา") && seriesLines.includes("ความเคลื่อนไหวราคาที่ผ่านมา")
);

// ── 4. Wiring: the handler serves each pipeline its own prompt ─────────────

const handlerSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "search-overview.js"),
  "utf-8"
);
// Both halves, separately: the pipeline chooses WHICH prompt, and the
// customer's own text chooses what language it answers in (answer-language.js).
// Matching the old one-line form would have made this assertion a formatting
// test — it broke on a reflow that changed neither fact.
check(
  "wiring: stage 3 picks the prompt by pipeline",
  /isV2\s*\?\s*buildV2SystemPrompt\(assistantName/.test(handlerSrc) &&
    /:\s*buildOverviewSystemPrompt\(assistantName/.test(handlerSrc)
);
check(
  "wiring: and both prompts are told which language to answer in",
  handlerSrc.includes("buildV2SystemPrompt(assistantName, answerLang)") &&
    handlerSrc.includes("buildOverviewSystemPrompt(assistantName, answerLang)")
);
// The id legend must ride OUTSIDE the excise context: the gate whitelists
// every digit run in `context`, and catalog ids can contain digits — a legend
// folded into the context would hand the model price-shaped numbers the gate
// then cannot cut. So: legend appended in the user message only, and the
// excise call still sees the pure context.
check(
  "wiring: primary-model legend is appended to the user message, not the context",
  handlerSrc.includes("${context}${v2Legend ? `\\n\\n${v2Legend}` : \"\"}")
);
check(
  "wiring: the excise gate still runs on the pure context",
  handlerSrc.includes("exciseUnverifiedNumbers(parsed, context)")
);

// ── done ───────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll v2 prompt checks passed");

// ── the facts own the model's identity ─────────────────────────────────────
//
// PRODUCTION, 26 ส.ค. 2569, "ipad a16 256gb แบต 89% ประกันหมด". With the alias
// finally on the fact line the answer priced the device correctly — and then:
//
//   "อย่างไรก็ตาม iPad Generation 11 ใช้ชิป A14 ไม่ใช่ A16
//    หากคุณมีรุ่นอื่น ลองตรวจสอบชื่อรุ่นให้แน่ใจก่อนครับ"
//
// iPad Generation 11 IS the A16 iPad. The model invented A14 and used it to
// CORRECT the facts, telling a customer holding the exact device we had just
// quoted that they own something else. The same answer opened by denying we
// had any A16 iPad, two clauses before pricing that very iPad.
//
// Rule 7 already banned outside knowledge and it was not enough — it reads as
// a rule about prices and news, and a chip felt like something the model
// simply knew.
{
  const sys = v2.buildV2SystemPrompt("มาติน");

  check(
    "identity: the system data owns which chip a model has",
    sys.includes("7.1") && sys.includes("เจ้าของความจริงเรื่องรุ่นไหนใช้ชิปอะไร")
  );

  check(
    "identity: a remembered chip is treated as a WRONG memory, not a correction",
    sys.includes("ให้ถือว่าความจำผิด") && sys.includes("ห้ามแก้ให้เป็นชิปอื่นจากความจำ")
  );

  check(
    "identity: naming a chip absent from the data is banned outright",
    sys.includes("ห้ามเอ่ยชื่อชิปที่ไม่ปรากฏในข้อมูล")
  );

  check(
    "identity: a priced model is IN the system — no denial before the price",
    sys.includes("7.2") && sys.includes("ห้ามขึ้นต้นว่าไม่มีรุ่นนั้น")
  );

  check(
    "identity: the parenthetical counts as one of the model's names",
    sys.includes("ชื่อในวงเล็บนับเป็นชื่อของรุ่นนั้นด้วย")
  );

  // Rule 7 stays: these narrow it onto identity, they do not replace it.
  check("identity: the general outside-knowledge ban is untouched", sys.includes("ห้ามใช้ความรู้นอกเหนือจากข้อมูลจากระบบ"));
}
