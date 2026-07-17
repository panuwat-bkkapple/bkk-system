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
const {
  buildLastQuoteBlock,
  buildLastSearchBlock,
  buildDeviceCheckBlock,
  shouldOverrideDeclinedReply,
  batteryOptionRange,
  pickBatteryOptionId,
  modelLineMismatch,
  pickSiblingModel,
  priceHaggleIntent,
  humanRequestIntent,
  claimsHumanForwarding,
  buildKbGraphBlock,
} = __test;

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
  "instructs patch semantics — send only the groups the customer just mentioned",
  withGroups.includes("เฉพาะกลุ่มที่ลูกค้าเพิ่งพูดถึง"),
);
check(
  "forbids inventing groups the customer never mentioned",
  withGroups.includes("ห้ามใส่กลุ่มที่ลูกค้าไม่ได้พูดถึง"),
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

// last_search block — the pre-first-card blind spot ("iPhone 17" dead-end):
// tool results vanish across turns, so the found model's id must ride the
// system prompt or a later quote turn can only guess or escalate.
check("no last_search -> empty string", buildLastSearchBlock(null) === "");
check("empty results -> empty string", buildLastSearchBlock({ results: [] }) === "");
const searchBlock = buildLastSearchBlock({
  at: 1,
  results: [
    {
      model_id: "ip17",
      name: "iPhone 17",
      variants: [
        { name: "256GB", used_price: 22000, new_price: 24000 },
        { name: "512GB", used_price: 25000, new_price: 28000 },
      ],
    },
  ],
});
check("search block carries model_id", searchBlock.includes("ip17"));
check("search block carries both prices", searchBlock.includes("22,000") && searchBlock.includes("24,000"));
check(
  "search block forbids escalating for lack of an id",
  searchBlock.includes("ห้าม escalate ด้วยเหตุ 'ไม่รู้รุ่น/ไม่รู้ id'"),
);

// Device-check block — appended ONLY when the back-office toggle is on, so a
// disabled SickW integration never tempts the model to ask for an IMEI.
check("device check off -> empty", buildDeviceCheckBlock(false) === "");
check("device check undefined -> empty", buildDeviceCheckBlock(undefined) === "");
const dcBlock = buildDeviceCheckBlock(true);
check("device check on -> tool named", dcBlock.includes("check_device_by_serial"));
check("device check on -> locked means decline, no card", dcBlock.includes("locked=true") && dcBlock.includes("ห้ามออกการ์ด"));
check("device check on -> forbids invented serials", dcBlock.includes("ห้ามแต่งเลขหรือเดาเลข"));

// Delisted-model decline guard: a reply that defers to staff or never says
// "งดรับซื้อ" must be overridden; a clean decline must be left alone. Guards
// the "iPhone 6 / iPhone X → escalate dead-end" bug (data has them as
// isActive:false, so search_models returns declined_model).
check(
  "defer-to-staff about price -> override",
  shouldOverrideDeclinedReply("ขอให้เจ้าหน้าที่ตรวจสอบราคา iPhone 6 ให้ครับ เพราะรุ่นนี้เก่ามากแล้ว") === true,
);
check(
  "reply suggesting other models (some also งดรับซื้อ) -> override",
  shouldOverrideDeclinedReply("ตอนนี้เรางดรับซื้อ iPhone 7 Plus แล้วครับ แต่ถ้ามี iPhone รุ่นอื่น เช่น iPhone 8, X, 11, 12, 13 ก็บอกมาได้เลย") === true,
);
check(
  "bare decline (no offer) -> normalise to deterministic",
  shouldOverrideDeclinedReply("ต้องขออภัยครับ ตอนนี้ทางร้านงดรับซื้อรุ่น iPhone 6 แล้วครับ") === true,
);
check(
  "mixed reply offering an active model's price -> keep (do not clobber the offer)",
  shouldOverrideDeclinedReply("iPhone 6 เก่าไปครับ แต่ iPhone 15 รับซื้อ ราคาประเมิน 15,000 บาทครับ") === false,
);

// Battery bucketing guard: the model kept rounding a stated battery % UP to a
// better bracket (79% -> "81-85%", 70% -> "90% ขึ้นไป"), inflating the quote.
// The server now buckets deterministically from battery_pct. These are the real
// labels on iphone_standard_set: o_bt1 "90% ขึ้นไป", o_bt2 "85-89%",
// o_bt3 "80-84%", o_bt4 "แบตต่ำกว่า 80% (Service)".
const BAT_OPTS = [
  { id: "o_bt1", label: "90% ขึ้นไป" },
  { id: "o_bt2", label: "85-89%" },
  { id: "o_bt3", label: "80-84%" },
  { id: "o_bt4", label: "แบตต่ำกว่า 80% (Service)" },
];
check("range: '90% ขึ้นไป' -> [90, Infinity)", (() => {
  const r = batteryOptionRange("90% ขึ้นไป");
  return r.min === 90 && r.max === Infinity;
})());
check("range: '85-89%' -> [85, 89]", (() => {
  const r = batteryOptionRange("85-89%");
  return r.min === 85 && r.max === 89;
})());
check("range: 'แบตต่ำกว่า 80% (Service)' -> [0, 79]", (() => {
  const r = batteryOptionRange("แบตต่ำกว่า 80% (Service)");
  return r.min === 0 && r.max === 79;
})());
check("range: no digits -> null", batteryOptionRange("ไม่ทราบ") === null);
// The exact bug the user reported: customer said 79%, card recorded "81%-85%".
check("79% -> o_bt4 (below 80, Service)", pickBatteryOptionId(BAT_OPTS, 79) === "o_bt4");
check("82% -> o_bt3 (80-84)", pickBatteryOptionId(BAT_OPTS, 82) === "o_bt3");
check("80% boundary -> o_bt3 (80-84)", pickBatteryOptionId(BAT_OPTS, 80) === "o_bt3");
check("89% boundary -> o_bt2 (85-89)", pickBatteryOptionId(BAT_OPTS, 89) === "o_bt2");
check("87% -> o_bt2 (85-89)", pickBatteryOptionId(BAT_OPTS, 87) === "o_bt2");
check("95% -> o_bt1 (90+)", pickBatteryOptionId(BAT_OPTS, 95) === "o_bt1");
check("100% -> o_bt1 (90+)", pickBatteryOptionId(BAT_OPTS, 100) === "o_bt1");
check("70% -> o_bt4 (below 80, not rounded up)", pickBatteryOptionId(BAT_OPTS, 70) === "o_bt4");
check("invalid pct -> null", pickBatteryOptionId(BAT_OPTS, NaN) === null);
check("undefined pct -> null", pickBatteryOptionId(BAT_OPTS, undefined) === null);
check("no matching bucket -> null", pickBatteryOptionId([{ id: "x", label: "50-60%" }], 79) === null);

// Model-line guard: the real lost deal — customer said "iPhone 16 Pro Max",
// the model passed the base "iPhone 16 Pro" model_id, card quoted 23,000 vs the
// /sell app's 29,000, customer walked. The guard must flag the downgrade so the
// card is re-resolved to the correct sibling.
check("Pro Max named, Pro quoted -> flags 'Pro Max'", modelLineMismatch("iphone 16 pro max 256gb สีทะเลทราย", "iPhone 16 Pro") === "Pro Max");
check("Pro Max named, Pro Max quoted -> null", modelLineMismatch("iphone 16 pro max", "iPhone 16 Pro Max") === null);
check("promax (no space) still flags", modelLineMismatch("16 promax", "iPhone 16 Pro") === "Pro Max");
check("plain Pro named, Pro quoted -> null (not a downgrade)", modelLineMismatch("iphone 16 pro 256", "iPhone 16 Pro") === null);
check("plain Pro named, Pro Max quoted -> null (upgrade not flagged)", modelLineMismatch("iphone 16 pro", "iPhone 16 Pro Max") === null);
check("Plus named, base quoted -> flags 'Plus'", modelLineMismatch("iphone 15 plus", "iPhone 15") === "Plus");
check("Plus named, Plus quoted -> null", modelLineMismatch("iphone 15 plus", "iPhone 15 Plus") === null);
check("mini named, base quoted -> flags 'mini'", modelLineMismatch("iphone 13 mini ครับ", "iPhone 13") === "mini");
check("base named, base quoted -> null", modelLineMismatch("iphone 16 256gb", "iPhone 16") === null);
check("brand-qualified name matches (Apple prefix)", modelLineMismatch("iphone 16 pro max", "Apple iPhone 16 Pro Max") === null);
check("no customer text -> null (no false positive)", modelLineMismatch("", "iPhone 16 Pro") === null);

// Sibling auto-correct: when the guard flags a downgrade, the server finds the
// correct sibling itself (the LLM can't be trusted to re-pick — real test:
// "16 Pro Max" quote failed and escalated). Uses the light model list.
const MODELS = [
  { id: "p16", name: "iPhone 16", brand: "Apple", category: "iPhone", is_active: true },
  { id: "p16pro", name: "iPhone 16 Pro", brand: "Apple", category: "iPhone", is_active: true },
  { id: "p16pm", name: "iPhone 16 Pro Max", brand: "Apple", category: "iPhone", is_active: true },
  { id: "p15plus", name: "iPhone 15 Plus", brand: "Apple", category: "iPhone", is_active: true },
  { id: "p15", name: "iPhone 15", brand: "Apple", category: "iPhone", is_active: true },
  { id: "w11", name: "Apple Watch Series 11", brand: "Apple", category: "Apple Watch", is_active: true },
];
check("Pro Max sibling of 'iPhone 16 Pro' -> p16pm", pickSiblingModel(MODELS, "Apple iPhone 16 Pro", "Pro Max", "iPhone")?.id === "p16pm");
check("Plus sibling of 'iPhone 15' -> p15plus", pickSiblingModel(MODELS, "Apple iPhone 15", "Plus", "iPhone")?.id === "p15plus");
check("no matching sibling -> null", pickSiblingModel(MODELS, "Apple iPhone 16 Pro", "Ultra", "iPhone") === null);
check("wrong generation not matched", pickSiblingModel(MODELS, "Apple iPhone 14 Pro", "Pro Max", "iPhone") === null);
check("inactive sibling excluded", pickSiblingModel(
  [{ id: "x", name: "iPhone 16 Pro Max", brand: "Apple", category: "iPhone", is_active: false }],
  "Apple iPhone 16 Pro", "Pro Max", "iPhone") === null);
check("category mismatch excluded", pickSiblingModel(MODELS, "Apple iPhone 16 Pro", "Pro Max", "iPad") === null);

// --- priceHaggleIntent: haggling-for-more-money detector ------------------
// Guards the "10,100 -> '12,000 ได้ไหม' -> 12,500 card" lost-deal bug.
check("haggle: 'เพิ่มราคานะครับ 12,000 ได้ไหม'", priceHaggleIntent("เพิ่มราคานะครับ 12,000 ได้ไหม") === true);
check("haggle: 'ขอเพิ่มได้ไหมครับ'", priceHaggleIntent("ขอเพิ่มได้ไหมครับ") === true);
check("haggle: 'ได้มากกว่านี้ไหม'", priceHaggleIntent("ได้มากกว่านี้ไหม") === true);
check("haggle: 'ราคาน้อยไป'", priceHaggleIntent("ราคาน้อยไป") === true);
check("haggle: 'ขึ้นราคาหน่อยครับ'", priceHaggleIntent("ขึ้นราคาหน่อยครับ") === true);
check("haggle: 'ต่อราคาได้ไหม'", priceHaggleIntent("ต่อราคาได้ไหม") === true);
check("condition correction is NOT haggle: 'จอไม่มีรอยเลยครับ'", priceHaggleIntent("จอไม่มีรอยเลยครับ") === false);
check("battery info is NOT haggle: 'แบต 95% ครับ'", priceHaggleIntent("แบต 95% ครับ") === false);
check("plain accept is NOT haggle: 'ตกลงครับ ขายเลย'", priceHaggleIntent("ตกลงครับ ขายเลย") === false);
check("empty -> not haggle", priceHaggleIntent("") === false);

// --- buildKbGraphBlock: admin answer-web -> prompt block --------------------
const KBG = {
  nodes: {
    fee:  { label: "ค่าบริการรับเครื่อง", type: "custom", enabled: true,
            items: { a: { q: "มีค่าบริการไหม", a: "คิดตามระยะทางครับ", order: 1 } } },
    sub:  { label: "ต่างจังหวัด", type: "custom", enabled: true,
            items: { a: { q: "ตจว.ส่งยังไง", a: "ส่งพัสดุ ร้านออกค่าส่ง", order: 1 } } },
    off:  { label: "ปิดอยู่", type: "custom", enabled: false,
            items: { a: { q: "x", a: "y", order: 1 } } },
    live: { label: "โปรโมชั่น", type: "live" },
    empty:{ label: "ว่าง", type: "custom", enabled: true, items: {} },
  },
  edges: { e1: { from: "root", to: "fee" }, e2: { from: "fee", to: "sub" } },
};
const kbg = buildKbGraphBlock(KBG);
check("kb graph includes enabled custom Q&A", kbg.includes("มีค่าบริการไหม") && kbg.includes("คิดตามระยะทางครับ"));
check("kb graph child shows parent path", kbg.includes("ค่าบริการรับเครื่อง › ต่างจังหวัด"));
check("kb graph skips disabled node", !kbg.includes("ปิดอยู่"));
check("kb graph skips live node", !kbg.includes("[หมวด: โปรโมชั่น]"));
check("kb graph skips empty node", !kbg.includes("ว่าง"));
check("kb graph header pins tool precedence", kbg.includes("ต้องมาจาก tool"));
check("kb graph header pins escalation as an action, not an answer", kbg.includes("escalate_to_human") && kbg.includes("ห้ามตอบข้อความจากคลังแทนการส่งต่อ"));
check("empty graph -> empty string", buildKbGraphBlock(null) === "" && buildKbGraphBlock({}) === "");
check("all-disabled graph -> empty string", buildKbGraphBlock({ nodes: { x: { label: "x", type: "custom", enabled: false, items: { a: { q: "q", a: "a" } } } } }) === "");

// --- humanRequestIntent / claimsHumanForwarding: forced-escalation guard ----
// Guards the "ขอคุยกับแอดมิน -> 'เดี๋ยวส่งต่อให้ครับ' -> nobody notified" bug.
check("wants human: 'ขอคุยกับแอดมิน'", humanRequestIntent("ขอคุยกับแอดมิน") === true);
check("wants human: 'ขอคุยกับเจ้าหน้าที่ครับ'", humanRequestIntent("ขอคุยกับเจ้าหน้าที่ครับ") === true);
check("wants human: 'ขอคุยกับคนหน่อย'", humanRequestIntent("ขอคุยกับคนหน่อย") === true);
check("wants human: 'อยากคุยกับพนักงานจริงๆ'", humanRequestIntent("อยากคุยกับพนักงานจริงๆ") === true);
check("wants human: 'ไม่อยากคุยกับบอท'", humanRequestIntent("ไม่อยากคุยกับบอท") === true);
check("wants human: 'แอดมินอยู่ไหมครับ'", humanRequestIntent("แอดมินอยู่ไหมครับ") === true);
check("not human req: 'iPhone 15 ราคาเท่าไหร่'", humanRequestIntent("iPhone 15 ราคาเท่าไหร่") === false);
check("not human req: 'จอไม่มีรอยครับ'", humanRequestIntent("จอไม่มีรอยครับ") === false);
check("not human req: empty", humanRequestIntent("") === false);

check("claims fwd: 'เดี๋ยวผมส่งต่อให้เจ้าหน้าที่นะครับ'", claimsHumanForwarding("เดี๋ยวผมส่งต่อให้เจ้าหน้าที่นะครับ") === true);
check("claims fwd: 'ส่งเรื่องถึงเจ้าหน้าที่แล้วครับ'", claimsHumanForwarding("ส่งเรื่องถึงเจ้าหน้าที่แล้วครับ") === true);
check("claims fwd: 'แจ้งทีมงานให้แล้วครับ'", claimsHumanForwarding("แจ้งทีมงานให้แล้วครับ") === true);
check("claims fwd: 'เจ้าหน้าที่จะติดต่อกลับครับ'", claimsHumanForwarding("เจ้าหน้าที่จะติดต่อกลับครับ") === true);
check("not fwd: quote copy 'ราคายืนยันตอนเจ้าหน้าที่ตรวจเครื่องจริง'", claimsHumanForwarding("ราคาสุดท้ายยืนยันตอนเจ้าหน้าที่ตรวจเครื่องจริงครับ") === false);
check("not fwd: 'iPhone 15 ราคา 12,000 บาทครับ'", claimsHumanForwarding("iPhone 15 ราคาประเมิน 12,000 บาทครับ") === false);
check("not fwd: empty", claimsHumanForwarding("") === false);

console.log(`\n${failures === 0 ? "all passed" : failures + " failed"}`);
process.exit(failures ? 1 : 0);
