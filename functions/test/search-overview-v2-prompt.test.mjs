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
check("format: JSON only", P.includes('{"summary": "...", "detail": "...", "key_point": "..."}'));
check("format: key_point demanded verbatim from summary", P.includes("คัดลอกมาจาก summary แบบคำต่อคำ"));
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
check(
  "wiring: stage 3 picks the prompt by pipeline",
  handlerSrc.includes("isV2 ? buildV2SystemPrompt(assistantName) : buildOverviewSystemPrompt(assistantName)")
);

// ── done ───────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll v2 prompt checks passed");
