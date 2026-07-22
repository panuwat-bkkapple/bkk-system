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
  buildWaitingModeBlock,
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

console.log(`\n${failures === 0 ? "all passed" : failures + " failed"}`);
process.exit(failures ? 1 : 0);
