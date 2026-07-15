// ---------------------------------------------------------------------------
// Offline unit test for buildLastQuoteBlock (chat-ai.js).
// Runs with NO API key and NO Firebase — pure function.
//
//   node functions/test/last-quote-block.test.mjs
//
// Guards the "ไม่มีกล่องด้วยครับ" class of bug: cross-turn Claude history is
// text-only, so after a card is issued the ONLY channel that carries
// model_id/variant/answers into later turns is this system-prompt block. If it
// is empty when a last_quote exists, follow-up condition changes dead-end.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../chat-ai.js");
const { buildLastQuoteBlock } = __test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// No quote yet -> no block at all (do not pollute the prompt).
check("no last_quote -> empty string", buildLastQuoteBlock(null) === "");
check("undefined -> empty string", buildLastQuoteBlock(undefined) === "");
// Malformed / partial records must not produce a half-block the model could
// misread as authoritative.
check("missing model_id -> empty", buildLastQuoteBlock({ variant_name: "256GB" }) === "");
check("missing variant -> empty", buildLastQuoteBlock({ model_id: "m1" }) === "");

const block = buildLastQuoteBlock({
  model_id: "iphone_17_pro_max",
  model_name: "iPhone 17 Pro Max",
  variant_name: "256GB",
  condition_type: "used",
  answers: { battery_health: "bat_95" },
  estimated_price: 38000,
  at: 1,
});
check("block carries model_id", block.includes("iphone_17_pro_max"));
check("block carries variant", block.includes("256GB"));
check("block carries prior answers", block.includes("bat_95"));
check("block carries last estimate", block.includes("38,000"));
check(
  "block instructs re-quote via create_quote_card on amended conditions",
  block.includes("create_quote_card")
);

// With a condition-group catalog the block must list every option id so the
// model can remap an amended answer ("มีกล่องครบ") without calling tools —
// the fix for the "answers ชุดเดิม ยอดไม่ขยับ 18,500 สามใบ" bug.
const withGroups = buildLastQuoteBlock(
  {
    model_id: "m15pm",
    model_name: "iPhone 15 Pro Max",
    variant_name: "256GB",
    condition_type: "used",
    answers: { g_battery: "o_bt3", g_accessory: "o_a2" },
    estimated_price: 18500,
    at: 1,
  },
  [
    {
      id: "g_accessory",
      title: "อุปกรณ์เสริมที่นำมาด้วย",
      options: [
        { id: "o_a1", label: "ครบกล่อง (เครื่อง+สาย+กล่อง)" },
        { id: "o_a2", label: "ขาดกล่อง (มีเครื่อง+สายชาร์จ)" },
        { id: "o_a3", label: "เครื่องเปล่า (ไม่มีสาย/กล่อง)" },
      ],
    },
  ],
);
check("catalog lists group id", withGroups.includes("g_accessory"));

// Options flagged reject (failBehavior 'reject' in the Condition Sets Engine)
// must be visibly marked — a 0-baht tier on them means "decline", never
// "quote at full price".
const withReject = buildLastQuoteBlock(
  {
    model_id: "m15pm",
    model_name: "iPhone 15 Pro Max",
    variant_name: "256GB",
    condition_type: "used",
    answers: {},
    estimated_price: 18500,
    at: 1,
  },
  [
    {
      id: "g_cam",
      title: "กล้องหน้า / กล้องหลัง",
      options: [
        { id: "o_c1", label: "ปกติ / ใช้งานได้" },
        { id: "o_c2", label: "มีปัญหา / ใช้งานไม่ได้", reject: true },
      ],
    },
  ],
);
check("reject option is marked in the catalog", withReject.includes("o_c2=มีปัญหา / ใช้งานไม่ได้ [ร้านปฏิเสธรับซื้อถ้าเลือกข้อนี้]"));
check("normal option is not marked", withReject.includes("o_c1=ปกติ / ใช้งานได้ |"));
check("catalog lists the option the customer could switch to", withGroups.includes("o_a1=ครบกล่อง"));
check(
  "instructs to update the amended group, not resend identical answers",
  withGroups.includes("ห้ามส่ง answers ชุดเดิมเป๊ะๆ"),
);
check(
  "no-catalog call still renders the base block",
  !block.includes("group_id | option_id") && block.includes("create_quote_card"),
);

// New-device quotes must surface has_receipt so a re-issue keeps the -500 rule.
const newBlock = buildLastQuoteBlock({
  model_id: "m2",
  model_name: "iPhone 16",
  variant_name: "128GB",
  condition_type: "new",
  has_receipt: false,
  answers: {},
  estimated_price: 20000,
  at: 1,
});
check("new-device block carries has_receipt", newBlock.includes("has_receipt: false"));

console.log(`\n${failures === 0 ? "all passed" : failures + " failed"}`);
process.exit(failures ? 1 : 0);
