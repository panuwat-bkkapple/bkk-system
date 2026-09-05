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
  buildLastQuoteBlock: buildLastQuoteBlockRaw,
  buildLastSearchBlock: buildLastSearchBlockRaw,
  aiStateEntryFresh,
  AI_STATE_TTL_MS,
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
  buildWaitingModeBlock,
} = __test;

// Both blocks take a clock now (ai_state entries expire — see AI_STATE_TTL_MS).
// The existing cases below are about SHAPE, not age, so they run against a
// clock pinned to the fixtures' own `at: 1`. Age has its own section at the
// bottom, which calls the real functions with explicit stamps.
const NOW = 1;
const buildLastQuoteBlock = (q, g, n = NOW) => buildLastQuoteBlockRaw(q, g, n);
const buildLastSearchBlock = (ls, n = NOW) => buildLastSearchBlockRaw(ls, n);

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
check("missing model_id -> empty", buildLastQuoteBlock({ variant_name: "256GB", at: NOW }) === "");
check("missing variant -> empty", buildLastQuoteBlock({ model_id: "m1", at: NOW }) === "");

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
check("empty results -> empty string", buildLastSearchBlock({ results: [], at: NOW }) === "");
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

// --- buildWaitingModeBlock: holding mode while queued for a human -----------
// Guards the dead-zone bug: after escalation the AI went mute, messages piled
// up unanswered until staff released the chat.
const wm = buildWaitingModeBlock({ summary: "ลูกค้าขอคุยเรื่องยอดโอน", at: 1 });
check("waiting block keeps AI serving at full capability", wm.includes("เต็มรูปแบบ") && wm.includes("ห้ามเงียบ"));
check("waiting block forbids duplicate escalation", wm.includes("ไม่ต้องเรียก escalate_to_human ซ้ำ"));
check("waiting block carries the queued reason", wm.includes("ลูกค้าขอคุยเรื่องยอดโอน"));
check("waiting block instructs handoff summary updates", wm.includes("update_handoff_summary"));
check("waiting block without escalation record still renders", buildWaitingModeBlock(null).includes("ห้ามเงียบ"));

// --- contact-before-price flow (owner's call) --------------------------------
// Guards the "card issued, panel still shows ยังไม่มีเบอร์" lost-lead bug.
const sys = __test.buildSystemPrompt({ assistantName: "มาติน", pub: {}, kb: "", customerBlock: "", inHours: true });
check("system prompt: contact ask bundled into the condition questions", sys.includes("(0) ขอชื่อและเบอร์โทรติดต่อ"));
check("system prompt: no price number before the card", sys.includes("โดยยังไม่ประกาศตัวเลขราคา"));
// Owner's revision (22 Jul): never advertise skipping ("ข้ามได้/ไม่บังคับ" opens
// the door to refuse — real test: first ask skipped, natural pre-card re-ask
// got both name and phone). Silent customer = keep selling; one re-ask max,
// right before the card.
check("system prompt: contact ask never advertises skipping", sys.includes('"ห้าม" พูดว่า "ข้ามได้/ไม่บังคับ/ไม่ให้ก็ได้"'));
check("system prompt: one natural re-ask right before the card", sys.includes('ขอซ้ำได้อีก "หนึ่งครั้งเดียว" ตอนกำลังจะออกใบเสนอราคา'));
check("canned contact ask has no skip copy", !__test.buildSystemPrompt({ assistantName: "x", pub: {}, kb: "", customerBlock: "", inHours: true }).includes("ไม่สะดวกให้ก็เดินหน้าต่อได้"));
// Landmark rule: a famous place name goes straight to the geocoder with the
// model_id attached (promos are model-bound) — never "เมเจอร์รัชโยธินอยู่ที่ไหนครับ".
check("system prompt: landmarks go straight to geocoding", sys.includes('ห้ามถามกลับว่า "อยู่ที่ไหน" เหมือนไม่รู้จัก'));
check("system prompt: always pass model_id for fee promos", sys.includes("ต้องส่ง model_id ของรุ่นที่คุยกันอยู่ไปด้วยทุกครั้ง"));
check("system prompt: free pickup is a selling point", sys.includes("free_pickup/promo_applied ให้บอกลูกค้าเป็นจุดขายทันที"));
check("system prompt: short sales-first greeting", sys.includes("ทักทายครั้งแรกให้สั้นและพุ่งเข้าเรื่องขายทันที"));

// --- wrong-family match guard (MacBook M5 Max -> iPad mini 5 bug) -----------
// "M5" tokenized to "m 5"; bare "m" substring-hit "mini" and the delisted iPad
// mini 5 became the top match — the reply declined the WRONG model, twice.
const CATALOG = [
  { id: "ipm5", brand: "Apple", name: "iPad mini 5 (2019)", category: "iPad", is_active: false },
  { id: "mbp14", brand: "Apple", name: 'MacBook Pro 14" M3', category: "Mac" },
  { id: "ip15", brand: "Apple", name: "iPhone 15", category: "iPhone" },
];
const rmQuery = __test.rankModels(CATALOG, "MacBook Pro M5 Max");
check("MacBook M5 Max never matches iPad mini 5", !rmQuery.some((m) => m.id === "ipm5"));
check("iPad mini 5 still matches its own query", __test.rankModels(CATALOG, "iPad mini 5")[0]?.id === "ipm5");
check("iPhone query unaffected", __test.rankModels(CATALOG, "iPhone 15")[0]?.id === "ip15");
// Chip-name tokenization: query splits "m3" into "m 3" — the name side must
// split the same way or M-chip MacBooks can never satisfy versionOk (real
// test: 'macbook pro 14" m3 max' -> "ยังไม่มีข้อมูลรุ่นนี้" while it existed).
const MAC_CATALOG = [
  ...CATALOG,
  { id: "mbp14m3max", brand: "Apple", name: 'MacBook Pro 14" M3 Max', category: "Mac" },
];
check("chip query matches the M3 Max MacBook", __test.rankModels(MAC_CATALOG, 'macbook pro 14" m3 max')[0]?.id === "mbp14m3max");
check("chip query without inch mark still matches", __test.rankModels(MAC_CATALOG, "macbook pro 14 m3 max")[0]?.id === "mbp14m3max");
check("system prompt: store-contact request means the STORE's number", sys.includes("13.1.1"));

// --- buildStoreProfileBlock: central store standard values -------------------
// Guards the "08:00-20:00 vs 10:00-20:00" contradiction: standard contact/hours
// now come from ONE owner-edited profile, not scattered copies.
const spb = __test.buildStoreProfileBlock({
  phone: "083-495-6556", line_id: "@bkkapple", hours_start: "10:00", hours_end: "20:00",
});
check("store profile block carries the central phone", spb.includes("083-495-6556"));
check("store profile block carries standard hours", spb.includes("10:00-20:00 น."));
check("store profile block tells AI to answer from it first", spb.includes("ให้ตอบจากตรงนี้ก่อนเสมอ"));
check("empty store profile renders nothing", __test.buildStoreProfileBlock({}) === "" && __test.buildStoreProfileBlock(null) === "");

// --- iPad Air generation alias + sub-line guard ------------------------------
// Real lost-lead (LINE "mamo", 2026-07-22): customer asked "Ipad air 6" — the
// catalog names it by chip ('iPad Air 11" (ชิป M2, 2024)'), so the strict
// version match found nothing with "air 6" but "iPad mini (รุ่นที่ 6)" carried
// the 6 and won: reply said Air 6 is not in the system while /sell quoted it
// at 8,000. Air/mini/SE are different products (sub-line guard), and chip-named
// Airs earn their generation number as a synthetic token (Air 6=M2, 7=M3, 8=M4).
const IPAD_CATALOG = [
  { id: "air11m2", brand: "Apple", name: 'iPad Air 11" (ชิป M2, 2024)', category: "Tablets" },
  { id: "air13m2", brand: "Apple", name: 'iPad Air 13" (ชิป M2, 2024)', category: "Tablets" },
  { id: "air11m3", brand: "Apple", name: 'iPad Air 11" (ชิป M3, 2025)', category: "Tablets" },
  { id: "air11m4", brand: "Apple", name: ' iPad Air 11" (ชิป M4, 2026)', category: "Tablets" },
  { id: "air5", brand: "Apple", name: "iPad Air 5 (ชิป M1, 2022)", category: "Tablets" },
  { id: "mini6", brand: "Apple", name: "iPad mini (รุ่นที่ 6)", category: "Tablets" },
  { id: "gen6", brand: "Apple", name: "iPad Generation 6 (2018)", category: "Tablets", is_active: false },
  { id: "app", brand: "Apple", name: "AirPods Pro 2", category: "Accessories" },
];
const air6 = __test.rankModels(IPAD_CATALOG, "Ipad air 6");
check("iPad Air 6 resolves to the M2 Airs", air6.length === 2 && air6.every((m) => ["air11m2", "air13m2"].includes(m.id)));
check("iPad Air 6 never matches iPad mini 6", !air6.some((m) => m.id === "mini6"));
check("iPad Air 6 never matches base iPad Generation 6", !air6.some((m) => m.id === "gen6"));
check("iPad Air 7 resolves to the M3 Air", __test.rankModels(IPAD_CATALOG, "ipad air 7")[0]?.id === "air11m3");
check("Thai gen phrasing works too", __test.rankModels(IPAD_CATALOG, "iPad Air รุ่นที่ 6").every((m) => ["air11m2", "air13m2"].includes(m.id)));
check("iPad Air 5 still matches its literal name", __test.rankModels(IPAD_CATALOG, "ipad air 5")[0]?.id === "air5");
check("iPad mini 6 still resolves to the mini", __test.rankModels(IPAD_CATALOG, "ipad mini 6")[0]?.id === "mini6");
check("plain iPad Air 11 query unaffected by aliases", __test.rankModels(IPAD_CATALOG, "ipad air 11 m2")[0]?.id === "air11m2");
check("AirPods query not caught by the air sub-line guard", __test.rankModels(IPAD_CATALOG, "airpods pro 2")[0]?.id === "app");
check("Thai AirPods spelling not caught either", __test.rankModels(IPAD_CATALOG, "แอร์พอด pro")[0]?.id === "app");
check("MacBook Air query excludes MacBook Pro", !__test.rankModels(MAC_CATALOG, "macbook air m3").some((m) => m.id === "mbp14m3max"));
check("alias note names the M2 mapping", String(__test.ipadAirGenAliasNote("ขาย ipad air 6 ได้เท่าไหร่")).includes("M2, 2024"));
check("alias note silent for literal generations", __test.ipadAirGenAliasNote("ipad air 5") === null && __test.ipadAirGenAliasNote("iphone 16") === null);

// --- invented model options guard (iPad Air 5 "2 ขนาด" hallucination) --------
// Real bug (2026-07-22): search returned exactly ONE model (iPad Air 5 — one
// screen size; variants only Wi-Fi/Cellular x storage) and the reply offered
// "มีให้เลือก 2 ขนาด คือ 10.9 นิ้วหรือ 12.9 นิ้ว" from model memory — 12.9" is
// an iPad Pro size. Spec/options must come from the tool result only.
check("system prompt: rule 2.2 forbids invented specs", sys.includes("2.2 สเปกและตัวเลือกของรุ่น"));
check("system prompt: rule 2.2 names the real bug", sys.includes("iPad Air 5 มีจอ 10.9 กับ 12.9"));
const srn = __test.singleResultVariantNote({
  name: "iPad Air 5 (ชิป M1, 2022)",
  variants: [{ name: "Wi-Fi | 64GB" }, { name: "Wi-Fi + Cellular | 256GB" }],
});
check("single-result note names the model", srn.includes("iPad Air 5 (ชิป M1, 2022)"));
check("single-result note lists the real variants", srn.includes("Wi-Fi | 64GB") && srn.includes("Wi-Fi + Cellular | 256GB"));
check("single-result note forbids memory options", srn.includes("ห้ามเสนอขนาดจอหรือตัวเลือกอื่นจากความจำ"));
check("single-result note handles missing variants", __test.singleResultVariantNote({ name: "X" }).includes("X") && __test.singleResultVariantNote(null) === null);

// --- quick-reply chips (closed questions become tappable options) -----------
// Owner's UX call: options the customer can tap = no typos, and by rule 2.3
// the options must come from tool data. The AI ends its message with a
// trailing "[ตัวเลือก: A | B]" marker; extractChoices strips it into
// message.choices. Malformed markers vanish silently — customers must never
// see raw syntax.
check("system prompt: rule 2.3 quick-reply chips", sys.includes("2.3 คำถามเลือกตอบ"));
const ec = __test.extractChoices("รับซื้อครับ เครื่องของคุณเป็นแบบไหนครับ\n[ตัวเลือก: Wi-Fi | Wi-Fi + Cellular]");
check("extractChoices strips the marker from the text", ec.text === "รับซื้อครับ เครื่องของคุณเป็นแบบไหนครับ");
check("extractChoices returns the options", JSON.stringify(ec.choices) === JSON.stringify(["Wi-Fi", "Wi-Fi + Cellular"]));
check("no marker = no choices", __test.extractChoices("สวัสดีครับ").choices === null && __test.extractChoices("สวัสดีครับ").text === "สวัสดีครับ");
check("marker mid-text is not parsed", __test.extractChoices("ก [ตัวเลือก: A | B] ข").choices === null);
const ecBad = __test.extractChoices("ถามครับ\n[ตัวเลือก: อย่างเดียว]");
check("single-option marker stripped silently", ecBad.choices === null && ecBad.text === "ถามครับ");
check("duplicate and empty options dropped", JSON.stringify(__test.extractChoices("x\n[ตัวเลือก: A | A | | B]").choices) === JSON.stringify(["A", "B"]));
check("marker-only message still renders text", __test.extractChoices("[ตัวเลือก: 64GB | 256GB]").text.length > 0);

// --- history-poisoning guard (Air 5 sizes repeated to stay consistent) ------
// After rule 2.2 shipped the AI STILL asked "10.9 หรือ 12.9 นิ้ว" on the next
// turn — its own earlier wrong message sat in chat history and consistency
// beat the new rule. The last_search block (re-injected every turn) now says
// data beats history, and rule 2.2 says old self-messages are not a spec
// source.
const lsGuard = buildLastSearchBlock({
  at: 1,
  results: [{ model_id: "air5", name: "iPad Air 5 (ชิป M1, 2022)", variants: [{ name: "Wi-Fi | 64GB", used_price: 8000 }] }],
});
check("last_search block: no size axis = one size, never ask", lsGuard.includes("ห้ามถาม 'จอกี่นิ้ว'"));
check("last_search block: own old message loses to data", lsGuard.includes("ข้อความเก่านั้นผิด"));
check("rule 2.2: old self-messages are not a spec source", sys.includes("ข้อความเก่าของคุณเองในแชทก็ไม่ใช่แหล่งข้อมูลสเปก"));

// --- chip-driven condition assessment (owner: "ประเมินสภาพ ไม่เป็น chips") --
// The 5-topic condition bundle asked everything in one long text message —
// chips could not apply (one question = one chip set). Step 3 is now
// sequential: contact ask + first condition question with chips, then one
// topic per message, options summarized from the REAL condition-set labels.
check("step 3 asks one topic per message with chips", sys.includes('ทีละเรื่อง ทีละข้อความ" พร้อมปุ่มตัวเลือกตามข้อ 2.3'));
check("step 3 chips come from real option labels", sys.includes("label ของ option จริงใน get_condition_questions"));
check("step 3 never re-asks an answered topic", sys.includes("ข้ามเรื่องนั้นทันที ห้ามถามซ้ำ"));
check("rule 2.3: one message = one question + its chip set", sys.includes("หนึ่งข้อความ = หนึ่งคำถาม"));

// --- intent chips + pre-card price leak (both from the 10:39 retest) --------
// (1) The AI attached a "ให้ชื่อและเบอร์" chip to the contact ask; tapping it
// sent that meaningless phrase and the AI looped back asking again. Chips must
// be ready-made ANSWERS; intent/acknowledgement chips are dropped in code.
const ecIntent = __test.extractChoices("ขอชื่อและเบอร์หน่อยครับ\n[ตัวเลือก: ให้ชื่อและเบอร์ | ไม่สะดวก]");
check("intent chip dropped, too few remain -> no chips", ecIntent.choices === null);
check("intent chip: text keeps the question", ecIntent.text === "ขอชื่อและเบอร์หน่อยครับ");
check("real answers unaffected by intent filter", JSON.stringify(__test.extractChoices("x\n[ตัวเลือก: 64GB | 256GB | ตกลง]").choices) === JSON.stringify(["64GB", "256GB"]));
check("rule 2.3: chips are ready-made answers only", sys.includes('ปุ่มต้องเป็น "คำตอบสำเร็จรูป" เท่านั้น'));
check("rule 2.3: contact ask never gets its own chips", sys.includes("คำถามขอชื่อ/เบอร์จึงไม่มีปุ่มเสมอ"));
// (2) The same reply leaked "รับซื้อประมาณ 8,000-10,000 บาท" before any card —
// the LLM verifier is probabilistic; this deterministic check backs it up.
const leak = __test.priceLeakBeforeCard;
check("price range with commas leaks", leak("ขนาดนี้รับซื้อประมาณ 8,000-10,000 บาท ขึ้นกับสภาพ") === true);
check("bare price range leaks", leak("ได้ราวๆ 8000 - 10000 บาทครับ") === true);
check("approx single price leaks", leak("ประเมินไว้ประมาณ 8,500 ครับ") === true);
check("battery percent range does not leak", leak("แบตอยู่ช่วง 90-100% ไหมครับ") === false);
check("storage options do not leak", leak("ความจุ 64GB หรือ 256GB ครับ") === false);
check("plain question does not leak", leak("มีรอยไหมครับ") === false);

// --- 3-name aliases (owner's call after "ipad alr 8" found Generation 8) ----
// Every model can carry: the official Apple name (name) + the everyday Thai
// name (alias_th) + the everyday English name (alias_en), edited in the
// product editor. The matcher uses all three — Thai-only queries finally work.
const ALIAS_CATALOG = [
  { id: "air11m4", brand: "Apple", name: 'iPad Air 11" (ชิป M4, 2026)', alias_th: "ไอแพดแอร์ 8", alias_en: "iPad Air 8", category: "Tablets" },
  { id: "gen8", brand: "Apple", name: "iPad Generation 8 (2020)", category: "Tablets", is_active: false },
  { id: "mini6", brand: "Apple", name: "iPad mini (รุ่นที่ 6)", alias_th: "ไอแพดมินิ 6", category: "Tablets" },
];
check("Thai-only alias query finds the model", __test.rankModels(ALIAS_CATALOG, "ไอแพดแอร์ 8")[0]?.id === "air11m4");
check("English alias query finds the model", __test.rankModels(ALIAS_CATALOG, "iPad Air 8")[0]?.id === "air11m4");
check("alias query does not fall through to the delisted Generation 8", !__test.rankModels(ALIAS_CATALOG, "iPad Air 8").some((m) => m.id === "gen8"));
check("Thai mini alias works and stays in its sub-line", __test.rankModels(ALIAS_CATALOG, "ไอแพดมินิ 6")[0]?.id === "mini6");
check("Thai air alias never matches the mini", !__test.rankModels(ALIAS_CATALOG, "ไอแพดแอร์ 8").some((m) => m.id === "mini6"));
check("models without aliases still match by official name", __test.rankModels(ALIAS_CATALOG, "ipad mini 6")[0]?.id === "mini6");

// --- ambiguous nickname vs delisted model (the "ipad 6" owner rule) ----------
// "ipad 6" usually MEANS iPad Gen 6 (delisted, งดรับซื้อ) but can mean
// mini 6 / Air 6 which we still buy — the AI must CONFIRM the model before
// declining OR assessing. declinedAmbiguity flags a top-score TIE between a
// delisted and a buyable model; a pinned query is not ambiguous.
const IPAD6_CATALOG = [
  { id: "gen6", brand: "Apple", name: "iPad Gen 6", category: "Tablets", is_active: false },
  { id: "mini6", brand: "Apple", name: "iPad mini (รุ่นที่ 6)", alias_th: "ไอแพดมินิ 6", alias_en: "iPad mini 6", category: "Tablets" },
  { id: "air11m2", brand: "Apple", name: 'iPad Air 11" (ชิป M2, 2024)', alias_th: "ไอแพดแอร์ 6", alias_en: "iPad Air 6", category: "Tablets" },
];
const amb6 = __test.declinedAmbiguity(__test.rankModelsScored(IPAD6_CATALOG, "ipad 6"));
check("'ipad 6' ties delisted Gen 6 with buyable siblings -> ambiguous", !!amb6);
check("ambiguity carries the delisted candidate", !!amb6 && amb6.declined.some((m) => m.id === "gen6"));
check("ambiguity carries buyable alternatives", !!amb6 && amb6.buyable.length >= 1);
check("pinned 'ipad gen 6' is NOT ambiguous (outscores siblings)", __test.declinedAmbiguity(__test.rankModelsScored(IPAD6_CATALOG, "ipad gen 6")) === null);
check("pinned 'ipad mini 6' is NOT ambiguous", __test.declinedAmbiguity(__test.rankModelsScored(IPAD6_CATALOG, "ipad mini 6")) === null);
const NO_DELIST_CATALOG = IPAD6_CATALOG.map((m) => ({ ...m, is_active: true }));
check("no delisted model in the tie -> not ambiguous", __test.declinedAmbiguity(__test.rankModelsScored(NO_DELIST_CATALOG, "ipad 6")) === null);
check("empty search -> not ambiguous", __test.declinedAmbiguity([]) === null);

// --- branch hallucination guard (เซ็นทรัลลาดพร้าว case) ----------------------
// Real bug: customer asked the pickup fee AT Central Ladprao; the AI replied
// it was a Store-in "นำเครื่องมาที่หน้าร้านเลย" — inventing a storefront we do
// not have (the HQ address contains the WORD ลาดพร้าว). Rules: a new location
// always re-runs check_pickup_service, and our branches exist ONLY per
// get_branches data.
check("rule 12.1: every new location re-checks via the tool", sys.includes("12.1 ลูกค้าเปลี่ยน/เพิ่มทำเลใหม่"));
check("rule 12.2: branches exist only per data", sys.includes("ห้ามอ้างหรือใบ้ว่ามีหน้าร้านที่อื่นเด็ดขาด"));
check("rule 12.2: customer location means rider pickup point", sys.includes('สถานที่ที่ลูกค้าเอ่ยคือ "จุดให้ไรเดอร์ไปรับ" เสมอ'));

// --- rider-fee promo model fallback (86-baht-vs-free bug) --------------------
// Real bug: the LLM called check_pickup_service without model_id, so the
// FREERIDE waive promo (model-bound) was skipped and an iPhone 16 Pro Max
// customer in Bangkok was quoted ~86 baht — checkout showed ฟรี. Promo model
// ids now resolve server-side from context, in priority order.
const rp = __test.resolvePromoModelIds;
check("explicit model_id wins", JSON.stringify(rp("m1", { lastSearchModelIds: ["s1"] }, { last_quote: { model_id: "q1" } })) === JSON.stringify(["m1"]));
check("same-turn search results are the first fallback", JSON.stringify(rp("", { lastSearchModelIds: ["s1", "s2"] }, { last_quote: { model_id: "q1" } })) === JSON.stringify(["s1", "s2"]));
check("last issued card beats stale last_search", JSON.stringify(rp("", {}, { last_quote: { model_id: "q1" }, last_search: { results: [{ model_id: "old" }] } })) === JSON.stringify(["q1"]));
check("ai_state last_search is the final fallback", JSON.stringify(rp("", {}, { last_search: { results: [{ model_id: "a" }, { model_id: "b" }] } })) === JSON.stringify(["a", "b"]));
check("no context at all yields empty", JSON.stringify(rp("", {}, {})) === JSON.stringify([]));

// --- natural fee phrasing (the "ประมาณ 0 บาท" case) --------------------------
// Owner: say the normal fee first, THEN the promo as good news — never
// "ค่าบริการประมาณ 0 บาท (ฟรี)".
const pfFree = __test.pickupFeeNote(86, { name: "ส่วนลดค่าไรเดอร์ [Bangkok]", discount: 86 }, 0);
check("free-promo note forbids saying 0 baht", pfFree.includes('ห้ามพูดว่า "ประมาณ 0 บาท"'));
check("free-promo note carries the normal fee", pfFree.includes("ประมาณ 86 บาท"));
check("free-promo note names the promo", pfFree.includes("ส่วนลดค่าไรเดอร์ [Bangkok]"));
const pfPartial = __test.pickupFeeNote(200, { name: "โปรลด", discount: 100 }, 100);
check("partial-discount note shows before and after", pfPartial.includes("200") && pfPartial.includes("100"));
check("no-promo note unchanged in spirit", __test.pickupFeeNote(86, null, 86).includes("ค่าประมาณจากทำเล"));

// --- handler declaration-order guard (the "ipad 6 ระบบขัดข้อง" crash) --------
// A refactor moved `const contactGateWillBlock` BELOW the announcedQuote
// guard that reads it — every turn whose draft narrated a quote crashed on
// the TDZ ReferenceError and a real customer got "ระบบขัดข้องชั่วคราว"
// mid-assessment. The handler body never runs in this offline suite, so we
// assert the ORDER in the source itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const srcPath = join(dirname(fileURLToPath(import.meta.url)), "..", "chat-ai.js");
const src = readFileSync(srcPath, "utf8");
// The FAQ tables moved to service-facts.js when the store-facts layer was
// extracted for the /search overview. The guards below are about FAQ CONTENT,
// so they follow the content rather than the filename.
const faqSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "service-facts.js"), "utf8");
const declAt = src.indexOf("const contactGateWillBlock");
const useAt = src.indexOf("announcedQuote && contactGateWillBlock");
check("contactGateWillBlock declared before the recovery guard uses it", declAt > 0 && useAt > 0 && declAt < useAt);
const markDeclAt = src.indexOf("const markContactAsked");
const markUseAt = src.indexOf("await markContactAsked()");
check("markContactAsked declared before first use", markDeclAt > 0 && markUseAt > 0 && markDeclAt < markUseAt);
// Canned pre-card asks must stay neutral — they can fire while the model
// match is ambiguous ("ipad 6" = Air 6 / mini 6 / Gen 6).
check("no canned line overclaims รับซื้อแน่นอน", !src.includes('"รุ่นนี้เรารับซื้อแน่นอนครับ'));
check("no canned line still advertises skipping", !src.includes("ไม่สะดวกให้ก็เดินหน้าต่อได้"));

// --- prompt caching (cost control) -------------------------------------------
// The system prompt must be split into a byte-stable store-level block
// (cached across ALL conversations) and a per-conversation block. Customer
// data leaking into the static block would both poison the shared cache and
// waste the discount, so assert the split in the source.
check("static system block carries cache_control", src.includes('{ type: "text", text: systemStatic, cache_control: { type: "ephemeral" } }'));
check("dynamic system block carries its own breakpoint", src.includes('{ type: "text", text: systemDynamic, cache_control: { type: "ephemeral" } }'));
check("static block is built WITHOUT the customer block", src.includes('buildSystemPrompt({ assistantName, pub, kb, customerBlock: "", inHours })'));
check("customer block leads the dynamic (uncached-prefix) tail", /const systemDynamic =\s*\n\s*customerBlock \+/.test(src));
check("per-conversation last_search stays out of the static block", src.indexOf("buildLastSearchBlock(convo.ai_state") > src.indexOf("const systemDynamic"));
check("verifier system is cache-marked too", src.includes("text: VERIFIER_SYSTEM, cache_control"));
check("cache reads are accounted", src.includes("cache_read_input_tokens"));
check("cache writes are accounted", src.includes("cache_creation_input_tokens"));
check("cache counters land in the daily ledger", src.includes("cache_read_tokens: ServerValue.increment"));
// buildSystemPrompt with an empty customerBlock must not smuggle any
// customer-context header into the shared static prefix.
const sysNoCust = __test.buildSystemPrompt({
  assistantName: "มาติน",
  pub: {},
  kb: "",
  customerBlock: "",
  inHours: true,
});
check("empty customerBlock leaves no customer header in static prefix", !sysNoCust.includes("ข้อมูลลูกค้าคนนี้"));
check("static prefix still carries the iron rules", sysNoCust.includes("กฎเหล็ก"));

// --- anti-boilerplate acknowledgements (the "ดีครับ ขอถามต่อนะครับ" case) -----
// Owner's feedback: every assessment message opened with the same
// "ดีครับ ... ขอถามต่อนะครับ" formula — real people do not announce every
// follow-up question. The personality rules must forbid the repeated
// connector and force varied, direct follow-ups.
check("rule bans repeating the 'ขอถามต่อนะครับ' connector", sysNoCust.includes("ห้ามให้การรับทราบกลายเป็นสูตรซ้ำ"));
check("connector allowed at most once per conversation", sysNoCust.includes('ซ้ำเกิน 1 ครั้งต่อบทสนทนา'));
check("openers must vary between consecutive messages", sysNoCust.includes("อย่าขึ้นต้นข้อความเหมือนหรือคล้ายกับข้อความก่อนหน้า"));
check("condition sequence reminds no per-message announcement", sysNoCust.includes('ห้ามประกาศ "ขอถามต่อนะครับ" ทุกข้อความ'));

// --- echo the model back before doing anything else -------------------------
// Owner's instruction: "พอลูกค้าพิมพ์ชื่อรุ่นมา ให้ทักสั้นๆ ทวนรุ่นที่เจอใน
// ระบบก่อนเสมอ". The point is not politeness — echoing the CATALOG name
// (customer types "ไอโฟน13", we say "iPhone 13") is the cheapest possible
// check that the matcher understood them, before the conversation walks ten
// turns down the wrong model and has to be unwound.
{
  const E = (re) => new RegExp(`6\\.1\\.1[\\s\\S]{0,2200}${re}`).test(sysNoCust);
  check("persona has the echo-the-model rule", sysNoCust.includes("6.1.1"));
  check("greeting + model echo opens the first reply", E("ทักทายสั้นๆ แล้ว \"ทวนรุ่นที่เจอในระบบ\""));
  check("echo uses the catalog name, not the customer's spelling", E("ชื่อรุ่นตามที่ระบบเจอ") && E("ไอโฟน13") && E("iPhone 13"));
  check("the reason is stated: catch a mis-match early", E("จับผิดได้ทันทีถ้าระบบเข้าใจรุ่นผิด"));
  // Guard rails, each one an existing rule this could have broken.
  check("echo does not stall the flow into an extra round", E("เดินหน้าต่อในข้อความเดียวกันทันที") && E("ห้ามส่งข้อความสั้นๆ แค่ทวนรุ่นแล้วหยุดรอ"));
  check("echo message still reveals no price", E("ห้ามพูดตัวเลขราคาในข้อความนี้"));
  check("echo message still does not ask capacity", E('"ห้ามถามความจุ" ตรงนี้'));
  // The live "ย้ำรุ่นซ้ำๆ" bug: repeating the model every bubble reads as a bot.
  check("echo happens once, not every bubble", E("ทวนรุ่น \"ครั้งเดียวตอนเจอรุ่น\"") && E("ห้ามขึ้นต้นทุกข้อความด้วยชื่อรุ่นซ้ำๆ"));
  check("re-echo allowed only when the customer switches model", E("ลูกค้าเปลี่ยนไปคุยรุ่นอื่น"));
  check("greeting only on the room's first message", E("ทักทายใส่เฉพาะข้อความแรกของห้อง"));
  // Paths that must NOT get an echo: they have their own opening move.
  check("declined models still decline immediately", E("รุ่นงดรับซื้อ"));
  check("ambiguous names still ask which model first", E("ชื่อกำกวม"));
  check("no-price models still go to offer mode", E("โหมดรับ Offer"));
  check("owner-visible behaviors mention the model echo", src.includes("ทวนชื่อรุ่นตามที่ระบบเจอก่อนเสมอ"));
}

// --- bare single-price leak + empty quote promise (iPad mini 7 case) ---------
// Real conversation: "เรารับซื้อมือสองในราคา 8,500 บาทครับ" shipped pre-card
// (old regex only caught ranges and ประมาณ-numbers), then "ผมจะสร้างใบเสนอ
// ราคาให้ทันทีครับ" went out with no card ever following — dead-end escalate.
check("bare 'ในราคา 8,500 บาท' is a price leak", __test.priceLeakBeforeCard("iPad mini รุ่นที่ 7 Wi-Fi 128GB เรารับซื้อมือสองในราคา 8,500 บาทครับ"));
check("bare 'ราคา 12000 บาท' (no comma) is a price leak", __test.priceLeakBeforeCard("รุ่นนี้ราคา 12000 บาทครับ"));
check("2-digit pickup fee is NOT a price leak", !__test.priceLeakBeforeCard("ปกติค่าบริการประมาณ 86 บาท แต่ตอนนี้ฟรีครับ"));
check("3-digit fee is NOT a price leak", !__test.priceLeakBeforeCard("ค่าบริการรับเครื่องอยู่ที่ 120 บาทครับ"));
check("battery percent is NOT a price leak", !__test.priceLeakBeforeCard("แบต 100% สภาพดีมากครับ"));
check("immediate card promise triggers quote recovery", __test.announcedQuoteIntent("ขอโทษครับ ผมจะสร้างใบเสนอราคาให้ทันทีครับ"));
check("'กำลังจัดทำใบเสนอราคา' triggers quote recovery", __test.announcedQuoteIntent("ขออภัยครับ ผมกำลังจัดทำใบเสนอราคาให้ครับ"));
check("'ในราคา X บาท' narration triggers quote recovery", __test.announcedQuoteIntent("เรารับซื้อมือสองในราคา 8,500 บาทครับ"));
check("mid-assessment future plan does NOT force a card", !__test.announcedQuoteIntent("พอทราบสภาพครบ เดี๋ยวผมออกใบเสนอราคาให้หลังจากนี้ครับ"));
check("contact-first ask does NOT force a card", !__test.announcedQuoteIntent("ได้เลยครับ เดี๋ยวผมประเมินราคาให้ ยอดที่แน่นอนจะสรุปบนใบเสนอราคาครับ"));
check("rule 8 no longer bundles 4 questions into one message", !sysNoCust.includes("รวมเป็นข้อความเดียว 4 เรื่อง"));
check("rule 8 forbids numbered-list condition questions", sysNoCust.includes("ห้ามรวมหลายเรื่องเป็นลิสต์เลขข้อ"));

// --- human-mode rules (owner: customers must not FEEL they talk to a bot) ----
// Naturalness comes from rhythm variance + no lists + never volunteering
// AI-ness. Hard line stays: when asked point-blank, answer truthfully in one
// short confident line and move on — lying "I'm human" is forbidden (a caught
// lie costs far more trust than the AI label).
check("human-mode: no bullets/numbered lists to customers", sysNoCust.includes("ห้ามใช้ bullet หรือเลขข้อกับลูกค้า"));
check("human-mode: never volunteer being an AI", sysNoCust.includes("ห้ามเอ่ยถึงความเป็น AI/บอท/ระบบอัตโนมัติของตัวเองโดยลูกค้าไม่ได้ถาม"));
check("human-mode: never lie about being human", sysNoCust.includes('"ห้ามโกหกว่าเป็นคน"'));
check("human-mode: perfection reads as bot", sysNoCust.includes("ความสมบูรณ์แบบสม่ำเสมอเกินไปคือสิ่งที่ทำให้ดูเป็นบอทที่สุด"));

// --- two-zone knowledge policy (owner: 'โดนบล็อกไม่ให้ฉลาด') ------------------
// Shop facts (prices/fees/promos/branches/policies) stay system-only; general
// world knowledge and how-tos are answered like a real expert admin — never
// escalated for "not in the system".
check("zone A: shop data still system-only", sysNoCust.includes('ข้อมูล "ของร้าน" ต้องมาจากระบบเท่านั้น'));
check("zone B: general knowledge unlocked", sysNoCust.includes('"ใช้ความรู้ทั่วไปตอบได้เต็มที่"'));
check("zone B: never escalate a how-to", sysNoCust.includes('ห้ามโยนเจ้าหน้าที่หรืออ้างว่าไม่มีข้อมูลในระบบ'));
check("zone B cannot leak into prices/variants", sysNoCust.includes("ห้ามให้ความรู้ทั่วไปลามไปเป็นตัวเลขราคา"));
check("rule 14 scoped to shop matters only", sysNoCust.includes('นโยบาย/ขั้นตอน/บริการ "ของร้าน" ใดที่ไม่มีใน tool'));

// --- strong-model outage diagnostics (27/27 haiku-only mystery) --------------
// The Sonnet-5 override silently served everything on haiku with no visible
// reason. The fallback now records the actual API error, and the verifier /
// price-scrub calls go through the resilient path so a refused verifier model
// DOWNGRADES instead of failing open (unverified replies shipped a price leak).
check("fallback records the refused model's error", src.includes("last_model_fallback"));
check("verifier call is resilient (downgrades, not fail-open)", /during the Sonnet-5 outage[\s\S]{0,120}callClaudeResilient/.test(src));
const scrubAt = src.indexOf("แก้ร่างข้อความของผู้ช่วยร้านรับซื้อมือถือ");
check("price-scrub call is resilient too", scrubAt > 0 && src.lastIndexOf("callClaudeResilient", scrubAt) > src.lastIndexOf("await callClaude(", scrubAt));

// --- prep-before-selling answer must be ONE consistent voice -----------------
// Live wobble: "ไม่ต้องล้างเครื่องก่อน" then, re-asked, "ต้องครับ ให้ Factory
// Reset ก่อนนำมา" — the latter is risky (customer wipes but forgets iCloud
// sign-out -> Activation Lock at handover, we cannot buy the device at all).
check("prep answer: shop does the reset in front of the customer", sysNoCust.includes('ไม่จำเป็นต้อง Factory Reset มาเอง'));
check("prep answer: never tell customers to self-wipe beforehand", sysNoCust.includes('อย่าแนะนำให้ลูกค้าล้างเครื่องเองก่อนมา'));
check("prep answer: the one required step is iCloud sign-out", sysNoCust.includes("Sign out iCloud/ปิด Find My ให้ได้"));

// --- the temperature-deprecation outage (the WHOLE haiku-only mystery) -------
// Live 400 from Sonnet 5: "`temperature` is deprecated for this model" —
// one legacy param made every Sonnet-5 request fail and silently fall back
// to haiku (27/27 then 46/46 calls). Known rejectors skip the param up
// front; unknown future rejectors get one same-model retry without it.
check("sonnet-5 never gets the temperature param", src.includes("NO_TEMPERATURE_MODEL_RE") && /NO_TEMPERATURE_MODEL_RE = \/claude-\(sonnet-5/.test(src));
check("temperature-deprecated 400 retries on the SAME model", src.includes("delete body.temperature"));
check("retry guard matches the live error text", /temperature\[\\s\\S\]\{0,40\}deprecated/.test(src));
check("haiku still gets the low-temperature guard", src.includes("body.temperature = 0.2"));

// --- stale FAQ vs live fee system --------------------------------------------
// Three FAQ entries predated the distance-based rider fee and told customers
// pickup was free ("ไม่มีค่าจัดส่ง", "ไม่คิดค่าบริการใดๆ") — contradicting the
// checkout total the customer then sees. FAQ must match the fee system.
check("FAQ no longer claims rider pickup is free of delivery fee", !faqSrc.includes("Rider รับถึงบ้าน (กทม.+ปริมณฑล) ไม่มีค่าจัดส่ง"));
check("FAQ no longer claims zero service fees outright", !faqSrc.includes('a: "ไม่คิดค่าบริการใดๆ'));
check("FAQ fee answers point to the promo + pre-confirm quote", faqSrc.includes("บางรุ่น/บางพื้นที่มีโปรฟรีค่าบริการ"));

// --- binary battery sets (iPhone 11 "แจ้ง 70% แต่การ์ดคิดปกติ" leak) ----------
// Live condition set has only "ปกติ" / "แบตเตอรี่เสื่อม" — no numeric ranges,
// so the range scan returned null and the quote deducted nothing. Below 80%
// (Apple's service threshold) must map to the degraded option; 80%+ correctly
// stays null (= ปกติ). Range-labeled sets keep exact bucketing.
const BIN_BATTERY = [
  { id: "b_ok", label: "ปกติ" },
  { id: "b_bad", label: "แบตเตอรี่เสื่อม" },
];
check("70% on a binary set picks the degraded option", __test.pickBatteryOptionId(BIN_BATTERY, 70) === "b_bad");
check("79% on a binary set picks the degraded option", __test.pickBatteryOptionId(BIN_BATTERY, 79) === "b_bad");
check("85% on a binary set stays null (= ปกติ)", __test.pickBatteryOptionId(BIN_BATTERY, 85) === null);
const RANGE_BATTERY = [
  { id: "r_hi", label: "90% ขึ้นไป" },
  { id: "r_mid", label: "80-89%" },
  { id: "r_low", label: "แบตต่ำกว่า 80% (Service)" },
];
check("range-labeled sets still bucket exactly", __test.pickBatteryOptionId(RANGE_BATTERY, 84) === "r_mid" && __test.pickBatteryOptionId(RANGE_BATTERY, 70) === "r_low");

// --- wait-promise dead air (the "รอสักครู่ครับ" case) ------------------------
// Live: after picking iPad Generation 11 the reply was "ขอเช็คราคารับซื้อ ...
// ให้ก่อนนะครับ รอสักครู่ครับ" and the turn ended — nothing ever came back.
// waitPromiseIntent triggers the forced same-turn check; bare "เดี๋ยวผมเช็คให้"
// after ASKING for info must stay untouched (nothing to check yet).
check("'รอสักครู่ครับ' is a wait promise", __test.waitPromiseIntent("ขอเช็คราคารับซื้อ iPad Generation 11 ให้ก่อนนะครับ รอสักครู่ครับ"));
check("'กำลังเช็คให้ครับ' is a wait promise", __test.waitPromiseIntent("กำลังเช็คราคาให้ครับ"));
check("'ขอเช็ค...ให้ก่อนนะครับ' is a wait promise", __test.waitPromiseIntent("ขอเช็คพื้นที่บริการให้ก่อนนะครับ"));
check("asking for info with 'เดี๋ยวผมเช็คให้' is NOT a wait promise", !__test.waitPromiseIntent("รุ่นไหนครับ แจ้งมาได้เลย เดี๋ยวผมเช็คราคามือหนึ่งให้ครับ"));
check("normal condition question is NOT a wait promise", !__test.waitPromiseIntent("จอหรือตัวเครื่องมีรอยไหมครับ"));
check("prompt rule forbids ending on a wait", sysNoCust.includes('ห้ามจบข้อความด้วยการให้ลูกค้า "รอ"'));

// --- rapid-fire customer messages (ตอบซ้ำสอง) --------------------------------
// Live: "iPad Air (2013)" + "กี่ร้อย" sent seconds apart produced the SAME
// decline reply twice — each message spawns an invocation. Guards: an
// invocation superseded by a newer customer message stands down (checked at
// start AND again right before sending), and writeAiMessage drops a reply
// identical to the newest AI bubble within 3 minutes.
check("superseded turn stands down at start", src.includes("superseded by newer customer message"));
check("stale reply dropped when newer message arrived mid-turn", src.includes("dropping stale reply"));
check("identical consecutive AI reply is deduped", src.includes("identical AI reply within 3 min"));
const supersededAt = src.indexOf("superseded by newer customer message");
const floodAt = src.indexOf("Flood guard");
check("superseded guard runs before the flood guard", supersededAt > 0 && floodAt > 0 && supersededAt < floodAt);

// --- customer pronouns (live: AI called the customer 'น้อง') -----------------
check("pronoun rule: khun+name or khun-lukka only", sysNoCust.includes('ยังไม่รู้ชื่อ = "คุณลูกค้า" หรือ "คุณ"'));
check("pronoun rule bans นอง/พี่ forms", sysNoCust.includes('ห้ามเรียก "น้อง/พี่/ลุง/ป้า/เธอ/นาย" เด็ดขาดทุกกรณี'));

// --- internal-jargon leak net + iCloud unlock red line ------------------------
// Owner: "กลัวจะหลุดไปหาลูกค้าโดยไม่ตั้งใจ". Two nets: deterministic detector
// for tool/field names in the outgoing reply (backs up the probabilistic
// verifier rule 7), and a hard rule that iCloud-unlock help is official-
// owner-channels only — never bypass tools/services.
check("tool name in reply is detected", __test.internalLeak("เดี๋ยวผมเรียก search_models ให้ครับ"));
check("field name in reply is detected", __test.internalLeak("ต้องใช้ model_id ของรุ่นนี้ครับ"));
check("system-command marker is detected", __test.internalLeak("[คำสั่งระบบ ไม่ใช่ลูกค้า] ทดสอบ"));
check("normal Thai reply is NOT flagged", !__test.internalLeak("ได้เลยครับ รุ่นไหนครับ เดี๋ยวผมเช็คราคาให้"));
check("english storage answer is NOT flagged", !__test.internalLeak("ความจุ 128GB ราคาดีมากครับ new ไหมครับ"));
check("iCloud unlock: official owner channels only", sysNoCust.includes('ช่องทางทางการของเจ้าของเครื่องเอง'));
check("iCloud unlock: bypass firmly banned", sysNoCust.includes('ห้ามแนะนำวิธี bypass/hack/เครื่องมือปลดล็อก/บริการปลดล็อกภายนอก'));
check("iCloud unlock: refuse when device is not theirs", sysNoCust.includes('ให้ปฏิเสธการช่วยปลดล็อกอย่างสุภาพ'));

// --- warranty affects price on SOME sets (iPad Gen 11 ~1,000 baht) ----------
// Live: customer asked "ประกันหมดแล้ว ได้ราคาเดิมไหม" and the AI answered
// "ประกันศูนย์ไม่ได้มีผล" from memory — the Gen 11 set HAS a warranty group.
// Per-factor price impact must be read from the model's real condition set.
check("'ประกันไม่ได้มีผล' claim is detected", __test.warrantyNoEffectClaim("ประกันศูนย์ไม่ได้มีผลต่อราคาประเมินตรงนี้ครับ"));
check("'ประกันไม่กระทบราคา' claim is detected", __test.warrantyNoEffectClaim("สถานะประกันไม่กระทบราคาครับ"));
check("asking about warranty status is NOT a claim", !__test.warrantyNoEffectClaim("ประกันศูนย์ยังเหลือไหมครับ"));
check("rule 6.4.4 forbids memory answers on price factors", sysNoCust.includes('ห้ามตอบว่า "มีผล/ไม่มีผล" จากความจำเด็ดขาด'));
check("stated warranty status must enter the quote answers", sysNoCust.includes('ให้ใส่ option ตามที่ลูกค้าบอกเข้า answers ด้วยเสมอ'));
check("old absolute 'warranty not in questions' text is gone", !sysNoCust.includes("ประกันไม่ได้อยู่ในคำถามสภาพ 5 ข้อ"));

// --- e-series models (iPhone 16e) are a separate line from the plain digit --
// Live case #CI63: "รับซื้อ iPhone 16e ไหม" — the letter-digit splitter turned
// "16e" into "16 e", dropped the single-letter token, and the query collapsed
// into "iPhone 16" (a different device, thousands of baht apart). Symmetric
// guard: e-query only matches same-gen e-models; plain query never surfaces
// an e-model.
const E_CATALOG = [
  { id: "ip16", brand: "Apple", name: "iPhone 16", isActive: true },
  { id: "ip16p", brand: "Apple", name: "iPhone 16 Plus", isActive: true },
  { id: "ip16pro", brand: "Apple", name: "iPhone 16 Pro", isActive: true },
  { id: "ip16pm", brand: "Apple", name: "iPhone 16 Pro Max", isActive: true },
];
check("16e query finds nothing when no e-model exists", __test.rankModels(E_CATALOG, "iPhone 16e").length === 0);
check("16e query with space finds nothing either", __test.rankModels(E_CATALOG, "รับซื้อ iphone 16 e ไหม").length === 0);
const E_CATALOG2 = [...E_CATALOG, { id: "ip16e", brand: "Apple", name: "iPhone 16e", isActive: true }];
check("16e query matches only the 16e once it exists", __test.rankModels(E_CATALOG2, "iphone 16e").map((m) => m.id).join(",") === "ip16e");
check("plain 16 query excludes the 16e", !__test.rankModels(E_CATALOG2, "iphone 16").some((m) => m.id === "ip16e"));
check("plain 16 query still finds the 16", __test.rankModels(E_CATALOG2, "iphone 16")[0]?.id === "ip16");
check("16 plus query unaffected", __test.rankModels(E_CATALOG2, "iphone 16 plus")[0]?.id === "ip16p");
check("16 pro max query unaffected", __test.rankModels(E_CATALOG2, "iphone 16 pro max")[0]?.id === "ip16pm");
check("different-gen e never cross-matches", !__test.rankModels(E_CATALOG2, "iphone 15e").some((m) => m.id === "ip16e"));

// --- offer-mode contact gate on escalate (no bare-handed handoffs) -----------
// Same live case: the AI escalated with no name/phone collected, leaving staff
// a lead with nobody to call. First escalate attempt after a no-price search
// bounces back demanding contact; a repeat attempt or an explicit human
// request passes (no deadlock with forced-guard escalations).
{
  const esc = src.indexOf('case "escalate_to_human"');
  const gate = src.indexOf("contact_required_first", esc);
  const statusUpdate = src.indexOf('status: "waiting_human"', esc);
  check("escalate executor exists", esc > 0);
  check("contact gate lives inside the escalate executor", gate > esc && gate < statusUpdate);
  check("gate keys on this turn's no-price search", src.indexOf("state.lastSearchNoPrice &&", esc) > esc && src.indexOf("state.lastSearchNoPrice &&", esc) < statusUpdate);
  check("gate skips when a callback number exists", /!\(convo\.customer_phone \|\| state\.savedPhone\)/.test(src.slice(esc, statusUpdate)));
  check("gate never blocks an explicit human request", src.slice(esc, statusUpdate).includes("!humanRequestIntent(lastCustomerText)"));
  check("second attempt passes (prompted-at marker)", src.slice(esc, statusUpdate).includes("offer_contact_prompted_at"));
  check("search_models resets the no-price flag each call", src.includes("state.lastSearchNoPrice = false;"));
  const searchCase = src.indexOf('case "search_models"');
  const searchEnd = src.indexOf('case "get_condition_questions"');
  const searchBody = src.slice(searchCase, searchEnd);
  check("empty search marks no-price", searchBody.includes("state.lastSearchNoPrice = true;"));
  check("unpriced top result marks no-price", searchBody.includes("if (topUnpriced) state.lastSearchNoPrice = true;"));
}

// --- offer-mode gate must never strand a callback promise -------------------
// Live case (right after the gate shipped): the forced escalate in the
// escalation-promise guard was bounced by the gate, the bounce was ignored,
// and "เดี๋ยวแจ้งราคากลับ" went out with NO callback number and NOTHING queued
// for staff. Two nets: the forced-escalate call now reads its result, and a
// final backstop swaps any no-contact draft for OFFER_CONTACT_ASK whenever
// the gate fired this turn without a later successful escalate.
{
  const guard = src.indexOf("forcing escalate");
  check("forced escalate captures its result", src.indexOf("const forcedResult = await executeTool(\"escalate_to_human\"", guard) > 0);
  check("bounced forced escalate swaps to contact ask", src.indexOf('forcedResult.error === "contact_required_first"', guard) > guard);
  const backstop = src.indexOf("Offer-mode backstop");
  check("offer-mode backstop exists after the guard", backstop > guard);
  check("backstop keys on the gate having fired this turn", src.indexOf("state.offerContactPromptedThisTurn &&", backstop) > backstop);
  check("backstop keeps drafts that already ask for a number", src.indexOf("!/เบอร์|phone/i.test(finalText)", backstop) > backstop);
  check("backstop overrides with the canned contact ask", src.indexOf("offerContactAskText(replyInEnglish, brandNewSealedIntent(text));", backstop) > backstop);
  check("OFFER_CONTACT_ASK asks for name+phone+device details", /const OFFER_CONTACT_ASK\s*=\s*\n?\s*"[^"]*เบอร์โทร[^"]*ความจุ/.test(src));
}

// --- multilingual mode (live case: "english please" -> AI claimed Thai-only) -
// The Thai-only policy never existed; the AI invented it. Now: reply in the
// customer's language, guard/canned texts are bilingual, the verifier must
// not translate corrections back to Thai, and English "talk to a human"
// forces escalation like the Thai phrases do.
check("language rule: mirror the customer's language", sysNoCust.includes("ภาษาเดียวกับข้อความล่าสุดของลูกค้า"));
check("language rule: bans the invented Thai-only claim", sysNoCust.includes("ห้ามอ้างว่าร้านให้บริการเฉพาะภาษาไทย"));
check("language rule: tool answers stay Thai-canonical", sysNoCust.includes("ต้องใช้ label ภาษาไทยตรงตามชุดคำถามจริงจาก get_condition_questions เสมอ"));
check("isEnglishText: plain English detected", __test.isEnglishText("brand new box iphone 16"));
check("isEnglishText: Thai not misdetected", !__test.isEnglishText("รับซื้อ iPhone 16 ไหมครับ"));
check("isEnglishText: mixed Thai+English is Thai", !__test.isEnglishText("มี iPhone 16 อยากขายครับ"));
check("isEnglishText: empty/short is not English", !__test.isEnglishText("ok") === false || !__test.isEnglishText(""));
check("English human request triggers the escalate guard", __test.humanRequestIntent("Can I talk to a human please"));
check("English agent request triggers too", __test.humanRequestIntent("I want to speak to an agent"));
check("plain English question does NOT trigger", !__test.humanRequestIntent("How much for an iPhone 15?"));
check("English forwarding claim is detected", __test.claimsHumanForwarding("I have forwarded your request to our staff."));
check("English callback claim is detected", __test.claimsHumanForwarding("Our team will get back to you shortly."));
check("plain English answer is NOT a forwarding claim", !__test.claimsHumanForwarding("The exact amount will be on your quote card."));
check("EN canned texts exist and ask for phone", /const CONTACT_FIRST_ASK_EN\s*=\s*\n?\s*"[^"]*phone number/.test(src) && /const OFFER_CONTACT_ASK_EN\s*=\s*\n?\s*"[^"]*phone number/.test(src));
check("all canned-text sites are language-aware", !/finalText =\s*\n?\s*(CONTACT_FIRST_ASK|OFFER_CONTACT_ASK);/.test(src));
check("escalate system message is bilingual", src.includes("Your request has been forwarded to our staff"));
check("verifier keeps the reply's original language", src.includes("ใช้ภาษาเดียวกับคำตอบเดิมเสมอ"));
check("offer backstop accepts English phone asks", src.includes("!/เบอร์|phone/i.test(finalText)"));

// --- tracking link posted into the chat on order creation --------------------
// Owner: customer completes an order via chat -> the /track link must land in
// the chat thread itself (customer can re-find it after closing the track
// page; staff see it in-console). Deterministic DB trigger, not AI behavior.
{
  const fn = src.indexOf("const onJobCreatedChatTrackLink = onValueCreated(");
  check("chat track-link trigger exists", fn > 0);
  check("fires on job creation", src.indexOf('ref: "/jobs/{jobId}"', fn) > fn);
  check("links via the chat conversation key (job.uid)", src.indexOf("inbox/${uid}/lastMessageAt", fn) > fn);
  check("idempotent across retries", src.indexOf("chat_track_link_sent_at", fn) > fn);
  check("URL mirrors checkout's own redirect", src.indexOf("https://www.bkkapple.com/track/${jobId}", fn) > fn);
  check("bilingual by checkout locale", src.indexOf('job.cust_locale === "en"', fn) > fn);
  check("failures never break order creation", src.indexOf("a failed chat note must never break order creation", fn) > fn);
  check("exported from registerChatAi", src.includes("return { chatWidgetAiReply, getChatAiKnowledge, suggestAdminReplies, onJobCreatedChatTrackLink, onChatCsatSubmitted };"));
  // Guest checkout with no prior chat: the trigger SEEDS the conversation so
  // the link waits in the widget, with order contact info pre-verified.
  check("no-chat guests get a seeded conversation", src.includes("const isNewConvo = !convoSnap.exists();"));
  check("seed carries account-verified phone", /isNewConvo[\s\S]{0,900}phone_source: "account"/.test(src));
  // ชนิดงานลูกมาจาก seam เดียว (stock-child-types.js — ครอบ B2C-Unpacked ด้วย) ไม่ใช่
  // literal ที่พิมพ์ในไฟล์นี้ ซึ่งเคยได้รายการไม่ครบเมื่อมีชนิดที่สาม
  check("seed skips system child rows", src.includes("if (STOCK_CHILD_TYPES.includes(job.type)) return;"));
  check("...via the shared child-type list", src.includes('require("./stock-child-types")'));
  const idx = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  check("wired up in index.js", idx.includes("exports.onJobCreatedChatTrackLink = chatAi.onJobCreatedChatTrackLink;"));
}

// --- order status across sessions (uid = session, identity = link/phone) ----
// Live case OID-MRYEA7KM-240: order placed at 10:42, chat at 10:50, same
// device — but checkout uid ≠ chat uid, so the uid-only lookup found nothing.
// Verification ladder: session uid / tracking-link possession (the /track
// page is public to link holders and shows more than chat ever will) /
// ref_no+phone (same standard as the public track lookup) / account phone.
check("track URL parses to the job id", __test.parseTrackJobId("https://www.bkkapple.com/track/-OyHD-fG12iV8BMNeZb0") === "-OyHD-fG12iV8BMNeZb0");
check("path-only URL parses too", __test.parseTrackJobId("/track/-OyHD-fG12iV8BMNeZb0") === "-OyHD-fG12iV8BMNeZb0");
check("bare pasted push id parses", __test.parseTrackJobId("-OyHD-fG12iV8BMNeZb0") === "-OyHD-fG12iV8BMNeZb0");
check("non-track text yields nothing", __test.parseTrackJobId("อยากเช็คสถานะออเดอร์ครับ") === "");
check("homepage path yields nothing", __test.parseTrackJobId("/") === "");
check("short garbage id rejected", __test.parseTrackJobId("-abc") === "");
{
  const cs = src.indexOf('case "check_order_status"');
  const csEnd = src.indexOf('case "save_customer_info"', cs);
  const body = src.slice(cs, csEnd);
  check("tool accepts a pasted track link", body.includes("parseTrackJobId(input.track_url"));
  check("tool uses the page-context track id", body.includes("state.trackJobId"));
  check("ref_no must match the claimed phone", body.includes('String(job.ref_no || "").toUpperCase() === refNo'));
  check("account-source phone unlocks identity join", body.includes('convo.phone_source === "account"'));
  check("no amounts in any redacted order", !/job\.net_payout|job\.price|net_payout:|price:/.test(body));
  check("handler remembers the track page across turns", src.includes("ai_state/last_track_job_id"));
  check("prompt orders line has the link fallback", src.includes("ออเดอร์จากลิงก์ติดตามที่ลูกค้าถืออยู่"));
  check("rule 10 teaches the link/ref_no recovery path", sysNoCust.includes("ส่งลิงก์ติดตาม หรือเลขออเดอร์"));
}

// --- copilot drafts mirror the customer's language ---------------------------
// Live case: Kate Jackson's conversation ran in English but every copilot
// draft came out Thai. Drafts are customer-facing (sent verbatim via
// "ใช้ร่างนี้") so they follow the customer's language; intent/situation/label
// stay Thai — they are admin-facing.
check("copilot: drafts follow the customer's language", src.includes('ร่างทุกฉบับต้องเป็น "ภาษาเดียวกับข้อความล่าสุดของลูกค้า"'));
check("copilot: admin-facing fields stay Thai", src.includes("intent/situation/label ยังเขียนเป็นไทยเสมอ"));

// --- proactive coupon hook at search time ------------------------------------
// Owner: "ในแชทยังเสนอคูปองไม่ได้". The card already resolves the best coupon
// (pickBestCouponForModel) — now search_models does too, so the AI can open
// with the bonus instead of waiting for the card. Same fail-closed picker;
// numbers come from the system only.
{
  const searchCase = src.indexOf('case "search_models"');
  const searchEnd = src.indexOf('case "get_condition_questions"');
  const body = src.slice(searchCase, searchEnd);
  check("search resolves the best coupon for the top model", body.includes("searchCoupon = await pickBestCouponForModel(db, buyable[0].id, topPrice)"));
  check("offer-mode searches skip the coupon hook", body.includes("if (!topUnpriced && buyable.length > 0)"));
  check("coupon note forbids inventing name/value", body.includes("ห้ามแต่งชื่อ/มูลค่าเอง ใช้ตามนี้เท่านั้น"));
  check("search result carries eligible_coupon for the model", body.includes("...(searchCoupon ? { eligible_coupon:"));
}

// --- a wait-promise must never survive to the customer -----------------------
// Live case #PSP1: customer confirmed "iPad Generation 10" via chip, the AI
// replied "ขอเช็คราคา...รอสักครู่ครับ" and went silent — the recovery loop is
// best-effort (if every recovery draft is still a wait-promise, the original
// text used to ship). Deterministic tail now replaces any surviving wait
// promise with the flow's real next step.
{
  const rec = src.indexOf("wait-promise reply — forcing the check to finish this turn");
  const tail = src.indexOf("wait promise survived recovery — overriding with the next real step");
  check("deterministic tail exists after the recovery loop", tail > rec && rec > 0);
  check("tail re-checks the surviving draft", src.slice(rec, tail).includes("deadPromise(txt)"));
  check("wait guard triggers on the combined dead-promise check", src.slice(rec - 900, rec).includes("!state.cannedFinal && deadPromise(finalText)"));
  check("tail delegates to the shared override", src.slice(tail, tail + 300).includes("await overrideWaitPromise()"));
  const ov = src.indexOf("const overrideWaitPromise = async () => {");
  check("shared override is declared before the tail", ov > 0 && ov < tail);
  const ovBody = src.slice(ov, ov + 2800);
  check("offer mode with no phone -> offer contact ask", ovBody.includes("state.lastSearchNoPrice && !(convo.customer_phone || state.savedPhone)"));
  check("contact gate pending -> contact-first ask", ovBody.includes("contactFirstAskText(en, sealed)"));
  check("otherwise -> ask storage+condition, never wait", ovBody.includes("รบกวนบอกความจุกับสภาพเครื่องคร่าวๆ"));
  check("the fallback lines are not themselves wait-promises", !__test.waitPromiseIntent("ได้เลยครับ รบกวนบอกความจุกับสภาพเครื่องคร่าวๆ หน่อยครับ เดี๋ยวผมประเมินราคาให้ทันทีเลยครับ"));
  check("live #PSP1 reply would be caught", __test.waitPromiseIntent("ขอบคุณครับ ขอเช็คราคารับซื้อ iPad Generation 10 ในระบบให้ก่อนนะครับ รอสักครู่ครับ"));
  check("live IMG_5131 reply would be caught", __test.waitPromiseIntent("ขอบคุณครับ รบกวนขอเช็คให้ก่อนนะครับว่าตอนนี้ร้านรับซื้อรุ่นนี้อยู่ไหม รอสักครู่ครับ"));
}

// --- holding mode must NOT disarm the guard chain (live case IMG_5131) -------
// The convo sat in waiting_human from an earlier escalation; the model
// redundantly called escalate_to_human on an offer-mode iPad and the
// already_waiting shortcut flipped state.escalated=true SILENTLY (no system
// message) — which skipped the wait guard, the deterministic tail, the offer
// backstop AND the verifier, so "รอสักครู่ครับ" shipped unguarded.
{
  const aw = src.indexOf("already_waiting: true");
  check("already_waiting shortcut exists", aw > 0);
  const shortcut = src.slice(src.lastIndexOf("if ((convo.status ||", aw), aw);
  check("already_waiting sets its own flag, NOT escalated", shortcut.includes("state.alreadyWaiting = true") && !shortcut.includes("state.escalated = true"));
  check("state init carries alreadyWaiting", src.includes("escalatedThisTurn: false, alreadyWaiting: false"));
  check("empty-text fallback honors holding mode", src.includes("state.escalated || state.alreadyWaiting") && src.includes("if (!state.escalated && !state.alreadyWaiting) {"));
  // Final pre-send assertion: a wait-promise reintroduced AFTER the tail (a
  // verifier `corrected` rewrite, a scrub fallback) is still replaced. It must
  // sit after the verifier applies corrections and before writeAiMessage.
  const assertAt = src.indexOf("dead promise at pre-send — final assertion override");
  const corrected = src.indexOf("finalText = verdict.corrected.trim()");
  const send = src.indexOf("await writeAiMessage(db, convoId, assistantName, finalText.slice(0, 2000));");
  check("final assertion exists", assertAt > 0);
  check("final assertion runs after verifier corrections", corrected > 0 && assertAt > corrected);
  check("final assertion runs before the send", send > 0 && assertAt < send);
  check("final assertion delegates to the shared override", src.slice(assertAt, assertAt + 300).includes("await overrideWaitPromise()"));
  check("real escalations and canned finals stay exempt from the assertion", src.slice(assertAt - 900, assertAt).includes("!state.escalated && !state.cannedFinal && !quoteOk && deadPromise(finalText)"));
  check("verifier corrections lose canned status (re-checked)", /finalText = verdict\.corrected\.trim\(\);\s*\n\s*state\.cannedFinal = false;/.test(src));
  // The INVARIANT is "the verifier call sits inside the !cannedFinal guard",
  // not "the two lines touch". Byte adjacency broke the day the call site
  // gained the device-naming lookup that feeds verifier rule 9, so the check
  // now asserts containment with a window instead of a literal join.
  {
    const vGuard = src.indexOf("if (finalText && !state.escalated && !state.cannedFinal) {");
    const vCall = src.indexOf("const verdict = await verifyReply(");
    check("verifier skips canned finals", vGuard > 0 && vCall > vGuard && vCall - vGuard < 1400);
  }
}

// --- callback promises need a number to call (IMG_5131 turn 2) ---------------
// "เดี๋ยวเจ้าหน้าที่จะเช็คให้และแจ้งราคากลับครับ" shipped with no phone on
// file and no staff queue: not caught by waitPromiseIntent (no "wait here"
// phrasing) nor claimsHumanForwarding ("แจ้งราคากลับ" is not "ติดต่อกลับ").
// callbackPromiseIntent catches the class; deadPromise() enforces it only
// when we hold no callback number; claimsHumanForwarding was extended so a
// with-phone callback promise forces a REAL escalation (queue = promise kept).
{
  const t2 = "ขอเช็คราคารับซื้อ iPad Generation 9 ให้ก่อนนะครับ รบกวนแจ้งความจุ และเป็น Wi-Fi หรือ Wi-Fi + Cellular ด้วยครับ เดี๋ยวเจ้าหน้าที่จะเช็คให้และแจ้งราคากลับครับ";
  check("IMG_5131 turn-2 reply is a callback promise", __test.callbackPromiseIntent(t2));
  check("bare staff-will-check promise is caught", __test.callbackPromiseIntent("เดี๋ยวเจ้าหน้าที่จะเช็คให้และแจ้งราคากลับครับ"));
  check("'จะติดต่อกลับ' is caught", __test.callbackPromiseIntent("ทีมงานจะติดต่อกลับครับ"));
  check("EN callback promise is caught", __test.callbackPromiseIntent("Our team will call you back with the best offer."));
  check("factual past tense is NOT a callback promise", !__test.callbackPromiseIntent("เจ้าหน้าที่ตรวจสอบแล้วพบว่าเครื่องอยู่ในเกณฑ์ปกติครับ"));
  check("CONTACT_FIRST_ASK is NOT a callback promise", !__test.callbackPromiseIntent("ได้เลยครับ เดี๋ยวผมประเมินราคาให้ ยอดที่แน่นอนจะสรุปบนใบเสนอราคาครับ ขอชื่อและเบอร์โทรติดต่อไว้ให้เจ้าหน้าที่ดูแลใบเสนอราคาของคุณหน่อยครับ และขอถามสภาพเครื่องนิดนึงครับ — จอหรือตัวเครื่องมีรอยหรือความเสียหายไหมครับ"));
  check("storage+condition fallback is NOT a callback promise", !__test.callbackPromiseIntent("ได้เลยครับ รบกวนบอกความจุกับสภาพเครื่องคร่าวๆ หน่อยครับ เดี๋ยวผมประเมินราคาให้ทันทีเลยครับ"));
  check("forwarding claim now covers staff-will-check phrasing", __test.claimsHumanForwarding("เดี๋ยวเจ้าหน้าที่จะเช็คให้และแจ้งราคากลับครับ"));
  // Live case IMG_5141 (MacBook Neo — model priced in catalog, AI skipped
  // search_models and narrated a future check): both sentences dodge the
  // original anchors ("ในระบบก่อนนะ" not "ให้ก่อนนะ"; causative "ให้เจ้าหน้าที่
  // ตรวจสอบ...แจ้งราคาให้" has no "จะ" and no "กลับ").
  const t5141 = "ขอบคุณสำหรับข้อมูลครับ ผมขอเช็ครุ่น MacBook Neo นี้ในระบบก่อนนะครับ ว่าทางร้านรับซื้อรุ่นนี้หรือไม่ และราคาประเมินเท่าไหร่ รบกวนขอชื่อกับเบอร์โทรติดต่อไว้ด้วยครับ เดี๋ยวผมให้เจ้าหน้าที่ตรวจสอบและแจ้งราคาให้เลยครับ";
  check("IMG_5141 'ขอเช็ค...ในระบบก่อน' is a wait promise", __test.waitPromiseIntent(t5141));
  check("IMG_5141 causative staff-check is a callback promise", __test.callbackPromiseIntent("เดี๋ยวผมให้เจ้าหน้าที่ตรวจสอบและแจ้งราคาให้เลยครับ"));
  check("clarifying opener 'ขอเช็คให้ชัดก่อนนะครับ' stays clean", !__test.waitPromiseIntent("ขอเช็คให้ชัดก่อนนะครับ หมายถึงรุ่นไหนครับ [ตัวเลือก: iPad Gen 9 | iPad mini 6]"));
  check("warranty correction opener stays clean", !__test.waitPromiseIntent("ขอเช็คให้ชัวร์ก่อนครับ รุ่นนี้สถานะประกันศูนย์มีผลกับราคาประเมินด้วยครับ"));
  // Canned-final plumbing: our own deterministic copy (OFFER_CONTACT_ASK's
  // conditional "ฝากเบอร์...เดี๋ยวทีมงานติดต่อกลับ") must not be re-mangled
  // or force-escalated empty-handed.
  check("overrideWaitPromise marks its output as canned", /state\.cannedFinal = true;\s*\n\s*};\s*\n\s*\/\/ A promise the customer/.test(src));
  check("forwarding force-escalate skips canned finals", src.includes("const saidForwarded = !state.cannedFinal && claimsHumanForwarding(finalText);"));
  check("state init carries cannedFinal", src.includes("alreadyWaiting: false, cannedFinal: false"));
  check("recovery acceptance clears canned status", src.includes("if (txt && !deadPromise(txt)) { finalText = txt; state.cannedFinal = false; }"));
  check("deadPromise enforces callback promises only without a number", src.includes("waitPromiseIntent(t) || (callbackPromiseIntent(t) && !hasCallbackNumber())"));
  check("persona forbids callback promises before a phone number", sysNoCust.includes("ห้ามสัญญาว่า \"เจ้าหน้าที่จะเช็คแล้วแจ้งกลับ / จะติดต่อกลับ\" ทั้งที่ยังไม่มีเบอร์โทรลูกค้า"));
}

// --- exact-name pin breaks the ambiguity dead-loop (live case #PGA3) ---------
// "iPhone 13" ties with 13 mini / Pro / Pro Max on token hits (the base name
// is a substring of every sibling); mini is delisted, so declinedAmbiguity
// fired on EVERY query in the family — including the disambiguation chip
// "iPhone 13" itself. Customer clicked the chip, got asked again, typed
// "ไอโฟน13ธรรมดาคะ", and the model finally declined the WRONG sibling.
// exactModelPin resolves any query equal to one model's full name or alias.
{
  const P_CATALOG = [
    { id: "b13", name: "iPhone 13", brand: "Apple", alias_th: "ไอโฟน 13", alias_en: "iPhone 13", category: "iPhone", is_active: true, variants: [] },
    { id: "m13", name: "iPhone 13 mini", brand: "Apple", alias_th: "ไอโฟน 13 มินิ", alias_en: "iPhone 13 mini", category: "iPhone", is_active: false, variants: [] },
    { id: "p13", name: "iPhone 13 Pro", brand: "Apple", alias_th: "ไอโฟน 13 โปร", alias_en: "iPhone 13 Pro", category: "iPhone", is_active: true, variants: [] },
    { id: "pm13", name: "iPhone 13 Pro Max", brand: "Apple", alias_th: "ไอโฟน 13 โปรแม็กซ์", alias_en: "iPhone 13 Pro Max", category: "iPhone", is_active: true, variants: [] },
    { id: "g6", name: "iPad Generation 6 (2018)", brand: "Apple", alias_th: "ไอแพด เจน 6 2018, ไอแพด Gen 6", alias_en: "iPad Generation 6 2018, iPad Gen 6", category: "iPad", is_active: false, variants: [] },
    { id: "a11m2", name: 'iPad Air 11" (ชิป M2, 2024)', brand: "Apple", alias_th: "ไอแพดแอร์ 11 M2 2024, ไอแพดแอร์ 6", alias_en: "iPad Air 11 M2 2024, iPad Air 6", category: "iPad", is_active: true, variants: [] },
    { id: "a13m2", name: 'iPad Air 13" (ชิป M2, 2024)', brand: "Apple", alias_th: "ไอแพดแอร์ 13 M2 2024, ไอแพดแอร์ 6", alias_en: "iPad Air 13 M2 2024, iPad Air 6", category: "iPad", is_active: true, variants: [] },
    { id: "a11m3", name: 'iPad Air 11" (ชิป M3, 2025)', brand: "Apple", alias_th: "ไอแพดแอร์ 11 M3 2025, ไอแพดแอร์ 7", alias_en: "iPad Air 11 M3 2025, iPad Air 7", category: "iPad", is_active: true, variants: [] },
    { id: "air1", name: "iPad Air (2013)", brand: "Apple", alias_th: "ไอแพดแอร์ 2013", alias_en: "iPad Air 2013", category: "iPad", is_active: false, variants: [] },
    { id: "air5", name: "iPad Air 5 (ชิป M1, 2022)", brand: "Apple", alias_th: "ไอแพดแอร์ 5 M1 2022", alias_en: "iPad Air 5 M1 2022", category: "iPad", is_active: true, variants: [] },
  ];
  const pin = (q) => { const r = __test.exactModelPin(P_CATALOG, q); return r ? r.id : null; };
  check("chip answer 'iPhone 13' pins the base model", pin("iPhone 13") === "b13");
  check("Thai alias pins the base model", pin("ไอโฟน 13") === "b13");
  check("storage tail is stripped before pinning", pin("ไอโฟน13 256GB") === "b13");
  check("'ธรรมดา' + polite particle pins the base model", pin("ไอโฟน13ธรรมดาคะ") === "b13");
  check("explicit mini pins the (delisted) mini", pin("iPhone 13 mini") === "m13");
  check("Thai 'โปรแม็กซ์' pins Pro Max", pin("ไอโฟน 13 โปรแม็กซ์") === "pm13");
  check("nickname 'iPad 6' stays unpinned (confirm flow preserved)", pin("iPad 6") === null && pin("ไอแพด 6") === null);
  check("comma-separated alias part pins Gen 6", pin("iPad Gen 6") === "g6");
  check("shared alias across two models never pins", pin("ไอแพดแอร์ 6") === null);
  // Live case #VYI2: "iPad Air รุ่นแรก (iPad Air 1) ... จอมีรอยร้าว" — the
  // customer named the model precisely, yet still got confirm-which-model
  // chips: Apple's first-gen names carry no "1" ("iPad Air (2013)") and
  // chip-suffixed names ("iPad Air 5 (ชิป M1, 2022)") never equaled the
  // bare query. Ordinal + chip-designator normalization fix both.
  check("'iPad Air 1' pins the unnumbered first gen", pin("iPad Air 1") === "air1");
  check("'iPad Air รุ่นแรก' pins the first gen", pin("iPad Air รุ่นแรก") === "air1");
  check("'iPad Air first gen' pins the first gen", pin("iPad Air first gen") === "air1");
  check("bare official name pins the first gen", pin("iPad Air") === "air1");
  check("chip suffix is transparent ('iPad Air 5' = M1 2022)", pin("iPad Air 5") === "air5");
  check("chip-only siblings stay unpinned ('iPad Air 11' = M2 or M3)", pin("iPad Air 11") === null);
  // Live case #CIF1: "Macbook Air M1 256GB" got declined as "MacBook Air 11"
  // (Intel, 2013)". Three stacked failures: the pin's old chip-DROP ate the
  // customer's M1; the "1" split off "M1" substring-matched 11/13/2013 so
  // every Intel Air tied; and the top-5 truncation (shortest names = all
  // delisted Intels) hid the buyable M1 from the ambiguity check, which then
  // concluded unambiguous-declined. Chip tokens are now kept (merged as
  // "m1"), the subset rule pins chip-qualified queries, numeric tokens match
  // whole name tokens only, and the ambiguity window widened to 12.
  const MB_CATALOG = [
    { id: "mba11i13", name: 'MacBook Air 11" (Intel, 2013)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 11 Intel 2013", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "mba11i14", name: 'MacBook Air 11" (Intel, 2014)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 11 Intel 2014", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "mba11i15", name: 'MacBook Air 11" (Intel, 2015)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 11 Intel 2015", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "mba13i13", name: 'MacBook Air 13" (Intel, 2013)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 13 Intel 2013", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "mba13i14", name: 'MacBook Air 13" (Intel, 2014)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 13 Intel 2014", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "mba13i15", name: 'MacBook Air 13" (Intel, 2015)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 13 Intel 2015", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "mbam1", name: 'MacBook Air 13" (ชิป M1, 2020)', brand: "Apple", alias_th: "แมคบุ๊คแอร์ 13 M1 2020", alias_en: "MacBook Air 13 M1 2020", category: "Mac / Laptop", is_active: true, variants: [] },
    { id: "mbam2_13", name: 'MacBook Air 13" (ชิป M2, 2022)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 13 M2 2022", category: "Mac / Laptop", is_active: true, variants: [] },
    { id: "mbam2_15", name: 'MacBook Air 15" (ชิป M2, 2023)', brand: "Apple", alias_th: "", alias_en: "MacBook Air 15 M2 2023", category: "Mac / Laptop", is_active: true, variants: [] },
  ];
  const mpin = (q) => { const r = __test.exactModelPin(MB_CATALOG, q); return r ? r.id : null; };
  check("'Macbook Air M1 256GB' pins the M1 2020", mpin("Macbook Air M1 256GB") === "mbam1");
  check("'MacBook Air M1' pins the M1 2020", mpin("MacBook Air M1") === "mbam1");
  check("'MacBook Air M2' stays unpinned (13 vs 15)", mpin("MacBook Air M2") === null);
  check("bare 'MacBook Air' stays unpinned", mpin("MacBook Air") === null);
  const mbsd = __test.rankModelsScored(MB_CATALOG, "Macbook Air M1 256GB");
  check("M1 2020 outranks the Intels (no fake '1' hits)", mbsd[0].m.id === "mbam1" && mbsd[0].hits > mbsd[1].hits);
  const mbAmb = __test.declinedAmbiguity(__test.rankModelsScored(MB_CATALOG, "MacBook Air"));
  check("bare 'MacBook Air' is ambiguous, never a straight decline", !!mbAmb && mbAmb.buyable.length > 0);
  // The old dead-loop, proven: without the pin the family is ambiguous even
  // for the exact base name; with the pin search_models skips the ambiguity.
  const sd = __test.rankModelsScored(P_CATALOG, "iPhone 13");
  check("family still ties in raw scoring (why the loop existed)", !!__test.declinedAmbiguity(sd));
  check("search skips ambiguity when pinned", src.includes("const amb = pin ? null : declinedAmbiguity(scoredDetailed);"));
  check("pinned model leads the results (capped at 5)", src.includes("const scored = (pin ? [pin, ...scoredRaw.filter((m) => m.id !== pin.id)] : scoredRaw).slice(0, 5);"));
  check("pin note tells the model not to re-ask", src.includes("ห้ามถามแยกรุ่นซ้ำ"));
}

// --- sealed brand-new devices skip the used-condition question ---------------
// Live case #NE52: "Air 11 มือ 1 รับซื้อเท่าไหร่ครับ ยังไม่ได้แกะกล่อง" got the
// canned contact-ask ending with "จอหรือตัวเครื่องมีรอยไหม" — a nonsense
// question for a sealed unit. Every canned guard text now swaps its trailing
// question to receipt/proof-of-purchase when the customer says sealed.
{
  const ne52 = "Air 11 มือ 1 รับซื้อเท่าไหร่ครับ ยังไม่ได้แกะกล่อง";
  check("IMG #NE52 message reads as sealed-new", __test.brandNewSealedIntent(ne52));
  check("'ซีลอยู่' reads as sealed-new", __test.brandNewSealedIntent("มือหนึ่ง ซีลอยู่ครับ"));
  check("EN 'brand new sealed' reads as sealed-new", __test.brandNewSealedIntent("selling a brand new sealed iPad"));
  check("'มือ 1' alone is NOT sealed (still has condition)", !__test.brandNewSealedIntent("iPad มือ 1 ใช้มาสองเดือนครับ"));
  check("used-device text is NOT sealed", !__test.brandNewSealedIntent("มือสอง สภาพดี จอมีรอยนิดหน่อย"));
  const sealedAsk = __test.contactFirstAskText(false, true);
  check("sealed contact-ask asks for the receipt", sealedAsk.includes("ใบเสร็จ") && !/มีรอยหรือความเสียหาย/.test(sealedAsk));
  check("sealed contact-ask still asks name+phone", sealedAsk.includes("เบอร์โทร"));
  check("normal contact-ask unchanged", __test.contactFirstAskText(false, false).includes("จอหรือตัวเครื่องมีรอยหรือความเสียหายไหมครับ"));
  const sealedOffer = __test.offerContactAskText(false, true);
  check("sealed offer-ask asks receipt not condition", sealedOffer.includes("ใบเสร็จ") && !sealedOffer.includes("สภาพเครื่อง"));
  check("sealed offer-ask keeps phone + callback framing", sealedOffer.includes("เบอร์โทร") && sealedOffer.includes("ติดต่อกลับ"));
  check("normal offer-ask unchanged", __test.offerContactAskText(false, false) === "รุ่นนี้ทีมงานเสนอราคาพิเศษให้โดยตรงครับ รบกวนฝากชื่อ เบอร์โทร แล้วก็ความจุกับสภาพเครื่องคร่าวๆ ไว้ตรงนี้ได้เลยครับ เดี๋ยวทีมงานติดต่อกลับพร้อมราคาที่ดีที่สุดให้ครับ");
  check("sealed canned texts are not dead promises themselves", !__test.waitPromiseIntent(sealedAsk) && !__test.waitPromiseIntent(sealedOffer));
  check("override tail has a sealed branch", src.includes("รบกวนบอกความจุ และมีใบเสร็จหรือหลักฐานการซื้อไหมครับ"));
  check("persona: sealed units skip the condition series", sysNoCust.includes("เครื่องมือ 1 ที่ยังไม่แกะกล่อง/ยังไม่แกะซีล: ข้ามชุดคำถามสภาพมือสองทั้งหมด"));
}

// --- a bare model name must not flip a Thai conversation to English ----------
// Live bug (#R3H2 / #FOH1): the customer opened in Thai, answered "IPhone 15
// 128" / "apple watch se2", and got the ENGLISH canned contact ask — product
// names are Latin script for Thai customers too, and the language decision
// only looked at the latest message. Now: a message with no real English word
// is language-NEUTRAL and inherits the conversation's language.
{
  const thaiConvo = [
    { senderRole: 'customer', text: 'สวัสดีครับ อยากประเมินราคาขายเครื่องครับ' },
    { senderRole: 'ai', text: 'สวัสดีครับ อยากขายรุ่นไหนแจ้งมาได้เลยครับ' },
  ];
  const en = (t, h) => __test.preferEnglishReply(t, h);
  check('#R3H2 "IPhone 15 128" after Thai stays Thai', en('IPhone 15 128', [...thaiConvo, { senderRole: 'customer', text: 'IPhone 15 128' }]) === false);
  check('#FOH1 "apple watch se2" after Thai stays Thai', en('apple watch se2', [...thaiConvo, { senderRole: 'customer', text: 'apple watch se2' }]) === false);
  check('a bare storage size stays Thai', en('256GB', thaiConvo) === false);
  check('a phone + nickname stays Thai', en('0655610223 จีน', thaiConvo) === false);
  // The multilingual feature must not regress: real English still gets English.
  const enConvo = [{ senderRole: 'customer', text: 'Hi, I want to sell my iPhone' }];
  check('a genuine English opener gets English', en('Hi, I want to sell my iPhone', enConvo) === true);
  check('a bare model name inside an English convo stays English', en('iPhone 15 128', [...enConvo, { senderRole: 'customer', text: 'iPhone 15 128' }]) === true);
  check('switching to English mid-Thai is honoured', en('can you speak english please', thaiConvo) === true);
  check('any Thai characters always mean Thai', en('แบต 89 สวย ครบกล่อง', enConvo) === false);
  check('no history + neutral text defaults to Thai', en('iPhone 15', []) === false);
  check('neutral detector: model names are neutral', __test.isLanguageNeutralText('apple watch se2') === true);
  check('neutral detector: real English is not', __test.isLanguageNeutralText('how much') === false);
  check('canned replies use the conversation-aware decision', !/= isEnglishText\(text\)/.test(src) && !/\(isEnglishText\(text\)/.test(src));
  check('the escalation system message uses it too', src.includes('const enCustomer = replyInEnglish === true;'));
  check('persona carries the neutral-language rule', sysNoCust.includes('ยกเว้นข้อความที่เป็นภาษากลาง'));
}

// --- Martin can actually see customer photos ---------------------------------
// Live gap: the customer sent a retail box + tax invoice (model, storage and
// origin in one shot) and got "ผมไม่สามารถดูรูปภาพที่ส่งมาได้" — a dead end on
// the highest-intent message in the funnel. Photos now ride on the last user
// turn as vision blocks, with cost + failure bounds.
{
  const realFetch = globalThis.fetch;
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  let calls = 0;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length),
  });
  const history = [
    { senderRole: 'customer', text: 'สวัสดีครับ' },
    { senderRole: 'ai', text: 'ยินดีครับ' },
    { senderRole: 'customer', text: 'ส่งรูปภาพ', imageUrl: 'https://firebasestorage.googleapis.com/a.jpg?token=1' },
  ];
  const msgs = [
    { role: 'user', content: 'สวัสดีครับ' },
    { role: 'assistant', content: 'ยินดีครับ' },
    { role: 'user', content: 'ส่งรูปภาพ' },
  ];
  const r1 = await __test.attachCustomerImages(msgs, history);
  const last = msgs[msgs.length - 1];
  check('a customer photo is attached', r1.attached === 1);
  check('it lands on the last USER turn as image+text blocks', Array.isArray(last.content) && last.content[0].type === 'image' && last.content[1].type === 'text');
  check('the block is a valid base64 source', last.content[0].source.type === 'base64' && last.content[0].source.media_type === 'image/jpeg' && last.content[0].source.data.length > 0);
  check('the original message text survives', last.content[1].text.includes('ส่งรูปภาพ'));
  check('the money guardrail rides with the photo', last.content[1].text.includes('ห้ามใช้ตัวเลขบนใบเสร็จ'));
  calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length) }; };
  await __test.attachCustomerImages([{ role: 'user', content: 'ส่งรูปภาพ' }], history);
  check('the same photo is cached, not re-downloaded every turn', calls === 0);
  const r2 = await __test.attachCustomerImages([{ role: 'user', content: 'hi' }], [{ senderRole: 'customer', text: 'hi' }]);
  check('a text-only conversation is left untouched', r2.attached === 0);
  const r3 = await __test.attachCustomerImages(
    [{ role: 'user', content: 'hi' }],
    [{ senderRole: 'admin', text: 'ส่งรูปภาพ', imageUrl: 'https://firebasestorage.googleapis.com/staff.jpg' }, { senderRole: 'customer', text: 'hi' }],
  );
  check('staff photos are NOT billed into the model turn', r3.attached === 0);
  globalThis.fetch = async () => { throw new Error('network down'); };
  const msgsFail = [{ role: 'user', content: 'ส่งรูปภาพ' }];
  const r4 = await __test.attachCustomerImages(msgsFail, [{ senderRole: 'customer', text: 'ส่งรูปภาพ', imageUrl: 'https://firebasestorage.googleapis.com/down.jpg' }]);
  check('a download failure degrades to text-only', r4.attached === 0 && typeof msgsFail[0].content === 'string');
  globalThis.fetch = async () => ({ ok: true, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => jpeg.buffer });
  const r5 = await __test.attachCustomerImages([{ role: 'user', content: 'x' }], [{ senderRole: 'customer', text: 'x', imageUrl: 'https://firebasestorage.googleapis.com/doc.pdf' }]);
  check('non-image media types are refused', r5.attached === 0);
  globalThis.fetch = realFetch;
  check('attach is wired into the handler turn', src.includes('const vision = await attachCustomerImages(messages, history);'));
  check('cost bounds are explicit', /VISION_RECENT_MESSAGES = 8/.test(src) && /VISION_MAX_IMAGES = 2/.test(src));
  check('persona says photos ARE visible', sysNoCust.includes('ลูกค้าส่งรูปได้และ "คุณดูรูปได้จริง"'));
  // Identification workflow: the live follow-up was "รูปอ่านได้ แต่ระบุรุ่นไม่ได้".
  // A box front carries no model name, so the model must reason from visible
  // hardware traits, VALIDATE against the catalog (never assert from memory),
  // and ask for the side sticker for what a box front genuinely cannot show.
  check('persona: infer traits then validate via search_models', sysNoCust.includes('เรียก search_models ด้วยชื่อนั้น') && sysNoCust.includes('ห้ามฟันธงชื่อรุ่นจากความจำโดยไม่เทียบกับระบบ'));
  check('persona: offer catalog candidates as chips', sysNoCust.includes('เสนอเป็นปุ่มตัวเลือกจากชื่อรุ่นจริงในผลค้นหา'));
  check('persona: never guess storage or Pro vs Pro Max', sysNoCust.includes('ขนาด Pro กับ Pro Max'));
  check('persona: ask for the side sticker', sysNoCust.includes('รูปสติกเกอร์ข้างกล่อง'));
  check('persona: part-number suffix maps to origin', sysNoCust.includes('TH/A = ศูนย์ไทย') && sysNoCust.includes('ห้ามเอาไปหักราคาเอง'));
  check('the attached photo prompt carries the workflow', src.includes('ทำตามข้อ 2.4.1'));
  check('persona keeps prices tool-only for photos', sysNoCust.includes('ห้ามเอาตัวเลขบนใบเสร็จ/กล่อง/ป้ายราคามาเป็นราคารับซื้อ'));
  check('persona requires confirming what the photo shows', sysNoCust.includes('บอกลูกค้าแล้วขอยืนยัน'));
}

// --- every deduction must trace back to something the customer said ---------
// Live bug #WFQ1: iPhone 16 Pro Max 256GB is 28,500 in the catalog, but the
// card came out 21,375 — exactly -25%, and the only 25% option in that
// condition set is "เครื่องนอกมีข้อจำกัด (LL / J / CH / KH)". The customer had
// typed "0655610223 จีน" answering "ขอชื่อกับเบอร์โทร": จีน was their
// nickname, the model read it as CH/China origin. Nobody ever asked about
// country. The owner had to quote 29,000 by hand.
{
  const COUNTRY = "ประเทศที่ซื้อ";
  const BATTERY = "สุขภาพแบตเตอรี่";
  const unsup = (groupTitle, evidenceText, assistantText = "") =>
    __test.conditionAnswerUnsupported({ groupTitle, evidenceText, assistantText });
  check("a phone-bearing message is a contact reply", __test.looksLikeContactReply("0655610223 จีน"));
  check("phone with dashes/spaces still detected", __test.looksLikeContactReply("065 561 0223 จีน") && __test.looksLikeContactReply("065-561-0223"));
  check("battery percent is NOT a phone", !__test.looksLikeContactReply("แบต 89%"));
  check("storage size is NOT a phone", !__test.looksLikeContactReply("256GB"));
  // The live turn: evidence excludes the contact reply, so จีน is invisible.
  check(
    "#WFQ1 country deduction is refused (nobody asked, nobody said)",
    unsup(COUNTRY, "iPhone 16 Pro Max \n 256GB", "ก่อนออกใบเสนอราคาให้ รบกวนขอชื่อกับเบอร์โทร"),
  );
  // Genuine deductions must survive — under-quoting loses the deal, but
  // over-quoting loses margin, so both directions matter.
  check("customer stating 'เครื่องนอก LL' keeps the deduction", !unsup(COUNTRY, "เครื่องนอก LL ครับ"));
  check("customer stating 'ซื้อมาจากจีน' keeps the deduction", !unsup(COUNTRY, "ซื้อมาจากจีนครับ"));
  check("AI having asked about origin keeps the deduction", !unsup(COUNTRY, "ไม่แน่ใจ", "เครื่องศูนย์ไทย (TH/A) หรือเครื่องนอกครับ"));
  check("battery answer after the AI asked keeps the deduction", !unsup(BATTERY, "85%", "สุขภาพแบตเตอรี่กี่ % ครับ"));
  check("unknown group titles stay permissive (never block what we cannot judge)", !unsup("กลุ่มพิเศษที่ไม่รู้จัก", "", ""));
  check("every mapped topic resolves keywords", ["สุขภาพแบตเตอรี่", "สภาพจอภาพและกระจก", "สภาพตัวเครื่องและฝาหลัง", "ประกัน", "ประเทศที่ซื้อ", "ประวัติการซ่อม", "อุปกรณ์เสริมที่นำมาด้วย"].every((t) => (__test.conditionTopicWords(t) || []).length > 0));
  // Wiring: the guard runs before the defect/reject branch (an invented
  // reject answer must not decline a healthy device either), skips answers
  // already confirmed on a previous card, and drops to the best-case default.
  const guard = src.indexOf("PROVENANCE GUARD");
  const defect = src.indexOf('if (opt && (opt.failBehavior === "reject" || (opt.defect === true && !acceptDefective))) {');
  check("provenance guard exists", guard > 0);
  check("guard runs before the defect decline", defect > 0 && guard < defect);
  check("guard covers reject/defect answers too", src.slice(guard, guard + 1400).includes('opt.failBehavior === "reject" ||'));
  check("guard respects answers confirmed on an earlier card", src.slice(guard, guard + 1400).includes("prevQuote.answers[group.id] !== opt.id"));
  check("dropped answer falls through to best case", src.slice(guard, guard + 1800).includes("opt = null;"));
  check("evidence excludes contact replies", src.includes('m.senderRole === "customer" && !looksLikeContactReply(m.text)'));
  check("the model is told it guessed", src.includes("ห้ามเดาคำตอบสภาพเครื่องแทนลูกค้าเด็ดขาด"));
  check("persona forbids inventing condition answers", sysNoCust.includes("ห้ามเดา/กรอกคำตอบสภาพเครื่องแทนลูกค้าเด็ดขาด"));
}

// --- a fault the customer describes in their own words still counts ---------
// Found by the owner's own question: "iPhone 12 Pro แบต 86% แต่ใช้ไปสักพักดับ
// เปิดขึ้นมาเหลือ 10% แบบนี้ขายได้เท่าไหร่". That set's "เปิดไม่ติด / ค้าง /
// ดับเอง" carries failBehavior:reject — the shop does not buy the device. But
// the provenance guard above matched only the option's literal wording, and
// "ใช้ไปสักพักดับ" contains no "ดับเอง", so the REJECT answer was dropped and
// the phone would have been quoted at nearly full price. Guarding a deduction
// must never turn into ignoring a fault: for faults the vocabulary is
// deliberately generous, because a missed symptom costs far more than an
// over-eager one (the worst case is one extra question).
{
  const FUNC = "เปิดเครื่อง / ใช้งานทั่วไป";
  const unsup = (evidenceText, assistantText = "") =>
    __test.conditionAnswerUnsupported({ groupTitle: FUNC, evidenceText, assistantText });
  check(
    "the owner's verbatim sentence keeps the reject answer",
    !unsup("ต้องการขาย iPhone 12 Pro แบต 86% แต่ใช้ไปสักพักดับ เปิดขึ้นมาเหลือ 10% แบบนี้ขายได้เท่าไหร่"),
  );
  for (const [phrase, label] of [
    ["เครื่องดับเองบ่อยครับ", "ดับเอง"],
    ["เปิดไม่ติดเลย", "เปิดไม่ติด"],
    ["จอค้างแล้วรีเอง", "ค้าง/รีเอง"],
    ["ใช้ๆ อยู่แล้วเครื่องวูบ", "วูบ"],
    ["ลำโพงมีปัญหา", "ลำโพง"],
    ["กล้องหลังเสีย", "กล้องเสีย"],
    ["ทัชไม่ค่อยติด", "ทัช"],
    ["เครื่องปกติดีทุกอย่าง", "ปกติ (คำตอบ pass)"],
  ]) check(`fault vocabulary covers "${label}"`, !unsup(phrase));
  for (const [phrase, label] of [
    ["it shuts down randomly", "shuts down"],
    ["the phone dies suddenly", "dies"],
    ["screen freezes and reboots", "freeze/reboot"],
    ["camera not working", "not working"],
  ]) check(`fault vocabulary covers EN "${label}"`, !unsup(phrase));
  // The guard must still block a fault answer nobody mentioned — otherwise
  // widening the vocabulary would have quietly disarmed it for this group.
  check("a bare model+storage line still cannot justify a fault answer", unsup("iPhone 12 Pro 256GB"));
  check("a contact reply still cannot justify a fault answer", unsup("0655610223 จีน"));
  // Ambiguous symptoms: 86% battery + unexpected shutdown maps to BOTH
  // "แบตเตอรี่เสื่อม" (pct 20, still buyable) and "ดับเอง" (reject). The first
  // cut asked the customer to pick a branch — but a customer who could name
  // the cause would have named it already. Owner's steer: diagnose like a
  // technician instead — hypothesise the COMMONEST cause, then ask what
  // actually discriminates, battery health first, repair history second.
  const R = (re) => new RegExp(`6\\.10\\.1[\\s\\S]{0,3000}${re}`).test(sysNoCust);
  check("persona has the symptom-diagnosis rule", sysNoCust.includes("6.10.1"));
  check("rule reads the real condition set before judging", R("get_condition_questions"));
  check("rule hypothesises the commonest cause, not the worst", R("พบบ่อยที่สุด") && R("อย่าเดาสาเหตุที่แย่ที่สุด"));
  check("shutdown-at-86% points at a battery that cannot hold charge", R("แบตเสื่อม เก็บประจุไม่อยู่"));
  check("battery health is asked first", R("สุขภาพแบตกี่ %"));
  check("repair history is asked next, battery replacement specifically", R("เคยซ่อมหรือเปลี่ยนอะไหล่ไหม โดยเฉพาะเคยเปลี่ยนแบตมาหรือยัง"));
  check("customer is told why we are asking, in plain words", R("พูดสมมติฐานให้ลูกค้าฟังสั้นๆ เป็นภาษาคน"));
  // The playbook must cover the other faults a buyback desk actually meets,
  // otherwise only the battery case is diagnosed and the rest fall back to
  // guessing.
  for (const [sym, probe] of [
    ["เปิดไม่ติด จอดำ", "ชาร์จทิ้งไว้สักพักแล้วติดไหม"],
    ["ค้าง/รีเอง", "อัปเดต iOS ล่าสุดแล้วยังเป็นไหม"],
    ["ร้อน/ชาร์จไม่เข้า", "เปลี่ยนสาย/หัวชาร์จแล้วยังเป็นไหม"],
    ["จอลาย/ทัชไม่ติด", "เคยเปลี่ยนจอมาไหม"],
  ]) check(`playbook covers "${sym}"`, R(probe));
  // Guardrails: diagnosing must not turn into repair advice, an interrogation,
  // or a made-up number.
  check("rule forbids inventing a price for a symptom", R("ห้ามเดาราคาให้อาการเด็ดขาด"));
  check("we price the device, we do not diagnose for the service centre", R("ห้ามให้คำแนะนำเชิงซ่อม"));
  check("unsure defaults to the worse branch plus a staff inspection", R("ยึดทางที่หนักกว่าไว้ก่อน") && R("เจ้าหน้าที่ตรวจเครื่อง"));
  check("questioning is capped at two, then move on", R("ซักได้ไม่เกิน 2 คำถามแล้วต้องเดินหน้าต่อ"));
  // Diagnosis reuses the standard condition questions (battery %, repair
  // history) reordered — it must not read as a second round, which rule 6.3
  // forbids outright.
  check("diagnosis reuses the standard questions instead of a second round", R("ไม่ใช่ถามเพิ่มเป็นรอบใหม่"));
  check("owner-visible behaviors describe the specialist questioning", src.includes("ซักแบบช่าง") && src.includes("แบตเก็บประจุไม่อยู่"));
}

// --- punctuation in the query must not invent matches (iPad (A16), #HXV1) ----
// Live case: the customer typed "i Pad (A16)" — Apple's official retail name
// for the 11th-gen iPad. The NAME side of the matcher strips punctuation but
// the QUERY side never did, so "(a16)" shattered into junk tokens and "16)"
// substring-matched the year in 'iPad Pro 9.7" (2016)' — a delisted model —
// which outranked everything. Martin declared "A16 iPads not bought" while
// recommending iPad Generation 11 in the same breath: the same device.
{
  const CAT = [
    { id: "g11", name: "iPad Generation 11", brand: "Apple", alias_th: "ไอแพด เจน 11, ไอแพด Gen 11", alias_en: "iPad Generation 11, iPad Gen 11", category: "Tablet", variants: [{ used_price: 9000 }] },
    { id: "p97", name: 'iPad Pro 9.7" (2016)', brand: "Apple", alias_th: "ไอแพดโปร 9.7 2016", alias_en: "", category: "Tablet", is_active: false, variants: [] },
    { id: "a13", name: "iPad Air (2013)", brand: "Apple", alias_th: "", alias_en: "", category: "Tablet", is_active: false, variants: [] },
    { id: "m7", name: "iPad mini รุ่นที่ 7 (ชิป A17 Pro)", brand: "Apple", alias_th: "", alias_en: "iPad mini 7 A17 Pro, iPad mini 7", category: "Tablet", variants: [{ used_price: 12000 }] },
    { id: "m1a", name: 'MacBook Air 13" (ชิป M1, 2020)', brand: "Apple", alias_th: "", alias_en: "", category: "Mac / Laptop", variants: [{ used_price: 15000 }] },
  ];
  // The exact customer keystrokes must pin the exact device.
  for (const q of ["i Pad (A16)", "iPad (A16)", "ipad a16", "ไอแพด A16"]) {
    check(`"${q}" pins iPad Generation 11`, __test.exactModelPin(CAT, q)?.id === "g11");
    check(`"${q}" ranks Gen 11 first, never the 2016 model`, __test.rankModels(CAT, q, 5)[0]?.id === "g11");
  }
  // The junk-token mechanism itself: chip digits must not bleed into years.
  const { tokens } = __test.rankQueryTokens("i Pad (A16)");
  check("query tokens are clean (pad + a16, no parens, no bare 16)", tokens.includes("a16") && tokens.includes("pad") && !tokens.some((t) => /[()]/.test(t)) && !tokens.includes("16"));
  check("chip token survives for M-chips too", __test.rankQueryTokens("macbook air m1").tokens.includes("m1"));
  // The synthetic alias is scoped to exactly one model.
  check("Gen 11 carries the official A16 alias", __test.officialChipAlias(CAT[0]) === "iPad A16");
  check("no other model gets the alias", CAT.slice(1).every((m) => __test.officialChipAlias(m) === ""));
  check("mini 7 matches its A17 chip from its real name", __test.exactModelPin(CAT, "iPad mini a17")?.id === "m7");
  // The note teaches the LLM the naming so it can explain, not just obey.
  check("A16 alias note fires on the live phrasing", !!__test.ipadA16AliasNote("i Pad (A16)"));
  check("A16 alias note stays quiet on unrelated queries", __test.ipadA16AliasNote("iphone 16") === null && __test.ipadA16AliasNote("ipad air m2") === null);
  check("note is wired into search_models", src.includes("ipadAirGenAliasNote(input.query) || ipadA16AliasNote(input.query)"));
  // Spaced-out brand spellings and the live Thai typo.
  check('"i Phone 13" pins like "iphone 13" would rank', __test.normalizeForPin("i Phone 13") === __test.normalizeForPin("iphone 13"));
  check('"mac book air m1" pins the M1 Air', __test.exactModelPin(CAT, "mac book air m1")?.id === "m1a");
  check('typo "ไอแพคเจน11" pins iPad Generation 11', __test.exactModelPin(CAT, "ไอแพคเจน11")?.id === "g11");
  check('typo "ไอแพตเจน11" pins too', __test.exactModelPin(CAT, "ไอแพตเจน11")?.id === "g11");
}

// --- year-only decline: old years never become a which-model quiz ------------
// Live case #YDD2 "macbook pro 2012": every tied candidate was itself a
// delisted Intel, yet the customer got 8 chips to choose from (bottoming at
// 2013 — 2012 is not even in the catalog). Owner's rule: a year older than
// anything we still buy = decline immediately. Data-driven, no hardcoded
// cutoff year.
{
  const YCAT = [
    { id: "i13", name: 'MacBook Pro 13" (Intel, 2013)', brand: "Apple", alias_th: "", alias_en: "", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "i14", name: 'MacBook Pro 13" (Intel, 2014)', brand: "Apple", alias_th: "", alias_en: "", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "i15x", name: 'MacBook Pro 15" (Intel, 2015)', brand: "Apple", alias_th: "", alias_en: "", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "i19", name: 'MacBook Pro 13" (Intel, 2019)', brand: "Apple", alias_th: "", alias_en: "", category: "Mac / Laptop", is_active: false, variants: [] },
    { id: "m4", name: 'MacBook Pro 14" (ชิป M4, 2024)', brand: "Apple", alias_th: "", alias_en: "", category: "Mac / Laptop", is_active: true, variants: [] },
  ];
  const yd = (q) => __test.yearOnlyDecline(YCAT, q);
  check("2012 (older than everything) declines with a year label", yd("macbook pro 2012")?.label === "MacBook Pro ปี 2012");
  check("2013 (exists, all delisted) declines", !!yd("macbook pro 2013"));
  check("2019 delisted single model declines with its real name", yd("macbook pro 2019")?.label === 'MacBook Pro 13" (Intel, 2019)');
  check("2024 (buyable year) stays in the normal flow", yd("macbook pro 2024") === null);
  check("no year in the query -> no year decline", yd("macbook pro") === null);
  check("family label strips size and parens", __test.modelFamilyLabel(YCAT[0]) === "MacBook Pro");
  const ydAt = src.indexOf("const yd = pin ? null : yearOnlyDecline(scoredRaw, input.query);");
  const ambAt = src.indexOf("const amb = pin ? null : declinedAmbiguity(scoredDetailed);");
  check("year decline runs before the ambiguity quiz", ydAt > 0 && ambAt > 0 && ydAt < ambAt);
  check("year decline note forbids re-asking", src.includes("ห้ามถามให้เลือกปี/รุ่นซ้ำ"));
  // Ambiguous-turn override: the canned replacement must re-ask WHICH MODEL,
  // never ask name/phone while the model is unconfirmed (rule 2.1.1 —
  // live case "ipad 6" got the contact ask instead of the chips).
  check("amb candidates remembered for the guards", src.includes("state.ambCandidates = candidateNames.slice(0, 6);"));
  check("override re-asks which model first", src.includes("ขอยืนยันรุ่นให้ชัดก่อนนะครับ หมายถึงรุ่นไหนครับ [ตัวเลือก: ${state.ambCandidates.join(\" | \")}]"));
  check("amb branch outranks the contact branches", /state\.ambCandidates && state\.ambCandidates\.length >= 2/.test(src));
}

// --- human pacing: wait for the customer's keyboard to go quiet --------------
// The AI used to answer bubble #1 immediately while the customer was still
// typing bubbles #2-3 — interleaved replies. Now: a settle delay + the
// widget's typing/customer heartbeat hold the turn until typing stops; if a
// newer bubble lands while waiting, that invocation owns the reply and this
// one yields BEFORE spending tokens (the pre-send superseded check remains
// as the late-arrival net).
{
  const pacing = src.indexOf("---- Human pacing");
  const typingSet = src.indexOf("update({ ai_typing: true })");
  check("pacing block exists", pacing > 0);
  check("pacing runs BEFORE the typing indicator + LLM work", typingSet > 0 && pacing < typingSet);
  const body = src.slice(pacing, pacing + 1600);
  check("pacing reads the widget heartbeat", body.includes("typing/customer"));
  check("pacing yields to a newer bubble", body.includes("newer bubble arrived while pacing — yielding"));
  check("pacing is capped (never eats the function budget)", body.includes("pacingStart > 20000"));
  check("pacing failure never blocks the reply", body.includes("pacing is best-effort"));
}

// --- low customer CSAT -> push staff + queue the comment for teaching --------
{
  const fn = src.indexOf("const onChatCsatSubmitted = onValueCreated(");
  check("csat trigger exists", fn > 0);
  const body = src.slice(fn, fn + 2600);
  check("fires on the write-once csat node", body.includes('ref: "/inbox/{convoId}/csat"'));
  check("neutral and good scores are report-only", body.includes("if (score >= 3) return;"));
  check("low score pushes staff", body.includes("ลูกค้าให้ ${score} ดาว"));
  check("only commented ratings enter the teach queue", body.includes("if (comment) {"));
  check("queue entry is marked as customer-sourced", body.includes('source: "customer_csat"'));
  check("queue entry starts untaught (fail-closed)", body.includes("taught: false"));
  const idx = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  check("wired up in index.js", idx.includes("exports.onChatCsatSubmitted = chatAi.onChatCsatSubmitted;"));
}

// ---------------------------------------------------------------------------
// Age. inbox/{uid} is keyed by the CUSTOMER, so these two rows outlive the
// conversation that wrote them unless something stops them — and the heading
// they sit under used to tell the model it could reuse the id without
// searching again. That is one of the two ways an iPhone 15 model_id reached
// a card for a customer holding an iPhone 17 Pro Max.
// ---------------------------------------------------------------------------
{
  const fresh = { model_id: "m1", model_name: "iPhone 17 Pro Max", variant_name: "256GB", answers: {}, estimated_price: 38000, at: 1_000_000 };
  const search = { at: 1_000_000, results: [{ model_id: "ip17", name: "iPhone 17", variants: [{ name: "256GB", used_price: 22000 }] }] };
  const justInside = 1_000_000 + AI_STATE_TTL_MS;
  const justOutside = justInside + 1;

  check("quote block: fresh entry renders", buildLastQuoteBlockRaw(fresh, null, justInside).includes("iPhone 17 Pro Max"));
  check("quote block: expired entry renders nothing", buildLastQuoteBlockRaw(fresh, null, justOutside) === "");
  check("search block: fresh entry renders", buildLastSearchBlockRaw(search, justInside).includes("iPhone 17"));
  check("search block: expired entry renders nothing", buildLastSearchBlockRaw(search, justOutside) === "");

  // Rows written before `at` existed are older than any TTL by definition.
  // Fail closed: no stamp is not a young stamp.
  check("quote block: no stamp is treated as expired", buildLastQuoteBlockRaw({ ...fresh, at: undefined }, null, justInside) === "");
  check("search block: no stamp is treated as expired", buildLastSearchBlockRaw({ ...search, at: undefined }, justInside) === "");

  // The predicate itself, so a break shows up here and not only downstream.
  check("fresh: null entry", aiStateEntryFresh(null, justInside) === false);
  check("fresh: no stamp", aiStateEntryFresh({}, justInside) === false);
  check("fresh: zero stamp", aiStateEntryFresh({ at: 0 }, justInside) === false);
  check("fresh: garbage stamp", aiStateEntryFresh({ at: "เมื่อวาน" }, justInside) === false);
  check("fresh: exactly on the boundary still counts", aiStateEntryFresh({ at: 1_000_000 }, justInside) === true);
  check("fresh: one ms past does not", aiStateEntryFresh({ at: 1_000_000 }, justOutside) === false);

  // The heading must no longer claim these rows came from this conversation,
  // and must no longer tell the model to skip searching unconditionally.
  const heading = buildLastSearchBlockRaw(search, justInside);
  check("search block: heading drops the 'this chat' claim", !heading.includes("ค้นพบแล้วในแชทนี้"));
  check("search block: heading tells the model to re-search a different model", heading.includes("ให้ search_models ใหม่"));
}

// The prompt blocks are not the only readers of these two rows, and the other
// three are not less dangerous — the amend merge reaches PRICE (it folds an
// old card's condition answers into a new one), the contact gate decides
// whether a lead gets asked for a phone number at all, and the handoff summary
// tells a HUMAN what the customer was quoted. Source-level, because they sit
// inside async handlers that need a live Firebase to call.
{
  check("amend merge is age-aware", /aiStateEntryFresh\(lq, Date\.now\(\)\)/.test(src));
  check("contact gate is age-aware", src.includes("!aiStateEntryFresh(convo.ai_state && convo.ai_state.last_quote, now)"));
  check("staff handoff summary is age-aware", src.includes("aiStateEntryFresh(lqRaw, Date.now())"));
}

// A reopened conversation must forget the device, but NOT the two keys that
// are permanent by design: processed/{msgId} (answer-once) and
// contact_prompted_at (have we ever asked).
{
  const reopen = src.slice(src.indexOf('if (status === "resolved")'), src.indexOf('if (status === "resolved")') + 700);
  check("reopen clears last_search", reopen.includes('"ai_state/last_search": null'));
  check("reopen clears last_quote", reopen.includes('"ai_state/last_quote": null'));
  check("reopen does not wipe ai_state wholesale", !/ai_state`\)\.remove\(\)/.test(reopen) && !reopen.includes('ai_state: null'));
  check("reopen clears the in-memory copy too", reopen.includes("delete convo.ai_state.last_search"));
}

console.log(`\n${failures === 0 ? "all passed" : failures + " failed"}`);
process.exit(failures ? 1 : 0);
