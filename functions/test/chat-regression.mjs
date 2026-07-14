// ---------------------------------------------------------------------------
// Chat AI regression harness
// ---------------------------------------------------------------------------
// Runs a fixed set of "tricky" customer questions (the ones that have bitten us
// in production) through the REAL system prompt + tool loop + verifier, using
// STUBBED tool results (no Firebase / no network except the Claude API), and
// asserts the final customer-facing reply against must-include / must-exclude
// patterns.
//
// Purpose: stop shipping the same regression twice. Run this before every
// deploy that touches the chat prompt/tools/verifier.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node functions/test/chat-regression.mjs
//
// Exit code 0 = all pass, 1 = at least one failure (CI-friendly).
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../chat-ai.js");
const {
  buildSystemPrompt,
  callClaude,
  verifyReply,
  pickModel,
  TOOLS,
} = __test;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("SKIP: set ANTHROPIC_API_KEY to run the regression harness.");
  process.exit(2);
}

// --- fixed context -----------------------------------------------------------
const pub = { hours_start: "10:00", hours_end: "19:00" };
const SYSTEM = buildSystemPrompt({
  assistantName: "น้องบีเค",
  pub,
  kb: "",
  customerBlock: "ข้อมูลลูกค้าคนนี้:\n- ชื่อที่ทราบ: ยังไม่ทราบ\n- เบอร์ที่ทราบ: ยังไม่ทราบ",
  inHours: true,
});

// --- stubbed tool executor ---------------------------------------------------
// Canned, deterministic tool results so the harness needs no Firebase.
function stubTool(name, input) {
  switch (name) {
    case "search_models": {
      const q = String(input.query || input.model || "").toLowerCase();
      // Apple Watch Series 5 = intentionally NOT in catalogue (unpriceable case).
      if (q.includes("watch") && q.includes("5")) {
        return { models: [], note: "ไม่พบรุ่นนี้ในระบบ" };
      }
      // iPhone 17 Pro Max = priced, has new_price.
      if (q.includes("17 pro max") || q.includes("iphone 17")) {
        return {
          models: [
            {
              model_id: "iphone-17-pro-max",
              name: "iPhone 17 Pro Max",
              variants: [{ storage: "256GB", price: 38000, new_price: 41000 }],
            },
          ],
        };
      }
      return { models: [], note: "ไม่พบรุ่นนี้ในระบบ" };
    }
    case "get_condition_questions":
      return {
        groups: [
          { id: "screen", label: "จอ/ตัวเครื่อง" },
          { id: "battery", label: "แบตเตอรี่" },
          { id: "box", label: "กล่อง/อุปกรณ์" },
          { id: "repair", label: "ประวัติซ่อม" },
        ],
      };
    case "create_quote_card":
      return { ok: true, quote_id: "q_stub", note: "ออกการ์ดสำเร็จ" };
    case "check_pickup_service":
      return { in_area: true, fee_estimate: 150, note: "อยู่ในพื้นที่บริการ" };
    case "get_branches":
      return { branches: [{ name: "สาขาอโศก", open_hours: "10:00 - 19:00 น." }] };
    case "get_promotions":
      return { coupons: [], pickup_fee_promotions: [], note: "ไม่มีโปรตอนนี้" };
    case "save_customer_info":
      return { ok: true };
    case "escalate_to_human":
      return { ok: true, escalated: true };
    case "get_faq":
      return __test.searchFaq(input.query || "");
    default:
      return { ok: true };
  }
}

async function runConversation(userText) {
  const model = pickModel({ text: userText });
  let messages = [{ role: "user", content: userText }];
  let finalText = "";
  let lastRoundText = "";
  for (let round = 0; round < 6; round++) {
    const resp = await callClaude({ apiKey, model, system: SYSTEM, messages, tools: TOOLS });
    const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
    const roundText = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (roundText) lastRoundText = roundText;
    if (resp.stop_reason === "tool_use" && toolUses.length > 0) {
      messages.push({ role: "assistant", content: resp.content });
      const results = toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(stubTool(tu.name, tu.input || {})).slice(0, 6000),
      }));
      messages.push({ role: "user", content: results });
      continue;
    }
    finalText = roundText;
    break;
  }
  if (!finalText) finalText = lastRoundText;
  // Run the verifier gate exactly like production.
  const verdict = await verifyReply({ apiKey, userText, reply: finalText });
  if (verdict.ok === false && verdict.corrected) finalText = verdict.corrected;
  return { finalText, model, verdict };
}

// --- test cases --------------------------------------------------------------
// mustExclude patterns are the dangerous phrasings; mustInclude is a light
// signal that the reply is on-topic. Fuzzy by nature (free-form LLM text) —
// we weight mustExclude (high-signal) over mustInclude.
const CASES = [
  {
    name: "installment device -> not purchased",
    text: "เครื่องผ่อนอยู่ขายได้ไหมครับ",
    mustExclude: [/รับซื้อได้/, /หักราคา/],
    mustInclude: [/ไม่รับ|ผ่อนครบ|ผ่อนหมด/],
  },
  {
    name: "iCloud locked -> not purchased, no unlock myth",
    text: "เครื่องติด icloud รับซื้อไหม",
    mustExclude: [/รับซื้อได้/, /ปลดล็อกให้|ปลดล็อกเอง/, /ราคาต่ำกว่า/],
    mustInclude: [/ไม่รับ/, /ปลดล็อก|sign ?out|ออกจาก/i],
  },
  {
    name: "activated device (warranty left) is NOT first-hand",
    text: "iPhone 17 Pro Max 256GB ประกันเหลือ 10 เดือน แบต 100% รับเท่าไหร่ครับ",
    mustExclude: [/ยังไม่แกะซีล/, /มือ 1|มือหนึ่ง/],
    mustInclude: [/38,?000|ประเมิน|สภาพ/],
  },
  {
    name: "pickup question -> direct answer, not 3-method menu",
    text: "มีบริการรับซื้อถึงที่ไหม",
    mustExclude: [/store-in[\s\S]*mail-in/i],
    mustInclude: [/ไรเดอร์|รับถึง|ถึงบ้าน/, /แถวไหน|ทำเล|เขต|อยู่ที่ไหน|จังหวัด/],
  },
  {
    name: "pickup payment = pay on-site, not later",
    text: "รับถึงที่จ่ายเงินตอนไหนครับ",
    mustExclude: [/กลับ[\s\S]*ร้าน[\s\S]*จ่าย/, /จ่ายทีหลัง|โอนทีหลัง/],
    mustInclude: [/หน้างาน|ทันที|เดี๋ยวนั้น|ตอนรับเครื่อง/],
  },
  {
    name: "unpriceable model -> escalate, don't ask 6 conditions first",
    text: "Apple Watch Series 5 รับซื้อไหมครับ",
    mustInclude: [/เจ้าหน้าที่|ยืนยันราคา|ตรวจสอบ/],
    mustExclude: [/แบตเตอรี่กี่ ?%[\s\S]*กล่อง/],
  },
  {
    name: "no fabricated verbal price / no jargon leak",
    text: "iPhone 13 128GB จอแตกร้าว รับเท่าไหร่ครับ",
    // must not throw out an invented price range or a mismatched estimate,
    // and must not leak internal jargon to the customer.
    mustExclude: [/\d[\d,]*\s*[-–]\s*\d[\d,]*\s*บาท/, /เรียก tool|search_models|new_price|model_id/i],
  },
];

// --- run ---------------------------------------------------------------------
let failures = 0;
for (const c of CASES) {
  let res;
  try {
    res = await runConversation(c.text);
  } catch (err) {
    console.log(`FAIL  ${c.name}\n      error: ${err && err.message}`);
    failures++;
    continue;
  }
  const reply = res.finalText || "";
  const problems = [];
  for (const re of c.mustInclude || []) if (!re.test(reply)) problems.push(`missing ${re}`);
  for (const re of c.mustExclude || []) if (re.test(reply)) problems.push(`forbidden ${re}`);
  if (problems.length) {
    failures++;
    console.log(`FAIL  ${c.name}  [model=${res.model}]`);
    for (const p of problems) console.log(`      - ${p}`);
    console.log(`      reply: ${reply.replace(/\n/g, " ").slice(0, 220)}`);
  } else {
    console.log(`PASS  ${c.name}  [model=${res.model}]`);
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
process.exit(failures ? 1 : 0);
