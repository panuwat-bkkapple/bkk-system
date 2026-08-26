// ---------------------------------------------------------------------------
// Offline unit test for the v2 two-call pipeline (search-overview-v2.js).
// No API key, no Firebase, no network — pure builders against fixtures.
//
//   node functions/test/search-overview-v2.test.mjs
//
// The bugs this pipeline exists to kill, and which these tests pin:
//   - phantom ids: stage 1 may only answer with ids from the lists it was
//     given; anything else is DROPPED AND COUNTED, never repaired
//   - invented numbers: every baht figure in the stage-2 context is computed
//     by code (deduction resolver, forecast multiplication), so the tests
//     hand-compute the same figures and require byte equality
//   - stale answers: the cache key must move when a price, a market fact, or
//     the facts version moves — and must NOT move when the same ingredients
//     arrive with keys in a different order
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const v2 = require("../search-overview-v2.js");
const {
  sanitizeIngredients,
  canonicalIngredients,
  v2CacheKey,
  buildExtractStable,
  buildExtractVariable,
  buildExtractContent,
  buildExtractSystemPrompt,
  parseExtraction,
  isOnlyAModelName,
  applicableMarketFacts,
  hasAnythingToWrite,
  buildV2Context,
  V2_MAX_CONTEXT_CHARS,
} = v2;
const { normalizeCapacity, resolveOptionDeduction, modelPrice } = v2.__test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// ── Fixtures ────────────────────────────────────────────────────────────────

const FUTURE = Date.now() + 7 * 24 * 3600 * 1000;
const PAST = Date.now() - 1000;

const rawIngredients = () => ({
  models: [
    {
      id: "ip16pm",
      name: "iPhone 16 Pro Max",
      alias: "ไอโฟน 16 โปรแม็กซ์",
      category: "Smartphones",
      family: "iphone",
      min: 30000,
      max: 42000,
      capacities: [
        { name: "256GB", min: 30000, max: 32000 },
        { name: "512GB", min: 36000, max: 38000 },
        { name: "1TB", min: 40000, max: 42000 },
      ],
      conditionSetId: "set16",
      liquidityFactor: 1,
    },
    {
      id: "ip16",
      name: "iPhone 16",
      category: "Smartphones",
      min: 18000,
      max: 24000,
      conditionSetId: "set16",
    },
    {
      id: "ip15",
      name: "iPhone 15",
      category: "Smartphones",
      min: 14000,
      max: 19000,
    },
    { id: "ipadair", name: "iPad Air 6", category: "Tablets", min: 12000, max: 16000 },
    { id: "mba", name: "MacBook Air M2", category: "Mac / Laptop", min: 15000, max: 21000, paused: true },
  ],
  conditionSets: {
    set16: {
      groups: [
        {
          title: "สภาพหน้าจอ",
          options: [
            { label: "ปกติ" },
            { label: "จอแตก มองเห็นชัด", pct: 20 },
            { label: "จอมีรอย", deduct: 1500 },
          ],
        },
        {
          title: "แบตเตอรี่",
          options: [{ label: "ปกติ" }, { label: "แบตเสื่อม", deduct: 2000 }],
        },
      ],
    },
  },
  marketFacts: [
    {
      label: "iPhone 18 เปิดตัว ก.ย.",
      appliesTo: "iphone",
      certainty: "ความมั่นใจปานกลาง",
      dropPctMin: 5,
      dropPctMax: 12,
      expiresAt: FUTURE,
    },
    {
      label: "ตลาดรวมช่วงเปิดเทอม",
      appliesTo: "all",
      text: "ตลาดมือสองคึกคักขึ้น ราคาทรงตัว",
      certainty: "ความมั่นใจต่ำ",
      expiresAt: FUTURE,
    },
    {
      label: "หมดอายุแล้ว",
      appliesTo: "iphone",
      certainty: "x",
      dropPctMin: 1,
      dropPctMax: 2,
      expiresAt: PAST,
    },
  ],
  series: [{ modelId: "ip16pm", days: 30, changePct: -8 }],
  pages: [{ title: "ขั้นตอนการขาย", path: "/how-it-works", description: "ขายยังไง ได้เงินเมื่อไหร่" }],
});

const ING = sanitizeIngredients(rawIngredients());

const extraction = (over = {}) => ({
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

// ── sanitizeIngredients ─────────────────────────────────────────────────────

check("sanitize: accepts the fixture", !!ING && ING.models.length === 5);
check("sanitize: null on missing models", sanitizeIngredients({}) === null);
check("sanitize: null on empty models", sanitizeIngredients({ models: [] }) === null);
check(
  "sanitize: drops model rows without id or name",
  sanitizeIngredients({ models: [{ id: "x" }, { id: "ok", name: "OK" }] }).models.length === 1
);
check(
  "sanitize: expired market fact rows survive sanitize (expiry is enforced at use time)",
  ING.marketFacts.some((f) => f.label === "หมดอายุแล้ว")
);
check(
  "sanitize: numeric fact without certainty is dropped",
  sanitizeIngredients({
    models: [{ id: "a", name: "A", min: 1, max: 2 }],
    marketFacts: [{ label: "x", appliesTo: "iphone", dropPctMin: 1, dropPctMax: 2, expiresAt: FUTURE }],
  }).marketFacts.length === 0
);
check(
  "sanitize: capacity rung names are normalized (256 -> 256GB)",
  sanitizeIngredients({
    models: [{ id: "a", name: "A", min: 1, max: 2, capacities: [{ name: "256", min: 1, max: 2 }] }],
  }).models[0].capacities[0].name === "256GB"
);

// ── cache key ───────────────────────────────────────────────────────────────

{
  const a = v2CacheKey("iphone 16", ING, "fv1");
  const shuffled = rawIngredients();
  // Same data, different key order on every object — the canonical form must
  // not care how the website built the payload.
  shuffled.models = shuffled.models.map((m) => {
    const entries = Object.entries(m).reverse();
    return Object.fromEntries(entries);
  });
  const b = v2CacheKey("iphone 16", sanitizeIngredients(shuffled), "fv1");
  check("key: stable across property order", a === b);

  const repriced = rawIngredients();
  repriced.models[0].max = 41000;
  check(
    "key: moves when a price moves",
    v2CacheKey("iphone 16", sanitizeIngredients(repriced), "fv1") !== a
  );
  check("key: moves when factsVersion moves", v2CacheKey("iphone 16", ING, "fv2") !== a);
  check("key: moves when the query moves", v2CacheKey("iphone 17", ING, "fv1") !== a);
  // The answer's LANGUAGE is now part of what is cached. Sharing one entry
  // between /en and the Thai site would serve whichever arrived first to
  // everyone for the next hour.
  check("key: moves when the answer language moves", v2CacheKey("iphone 16", ING, "fv1", "en") !== a);
  check("key: an omitted language means Thai", v2CacheKey("iphone 16", ING, "fv1", "th") === a);
  check("key: 32 hex chars", /^[a-f0-9]{32}$/.test(a));

  // The shuffle test above passes even without sorting, because the sanitizer
  // rebuilds objects in a fixed field order (mutation testing found exactly
  // that hollow). The sort is defense-in-depth for any future caller that
  // hashes an unsanitized object — so it is pinned HERE, on the helper
  // itself, where removing it must go red.
  const { stableStringify } = v2.__test;
  check(
    "stableStringify: sorts keys, not insertion order",
    stableStringify({ b: 2, a: 1 }) === stableStringify({ a: 1, b: 2 })
  );
}

// ── stage-1 prompt inputs ───────────────────────────────────────────────────

{
  const Q = "ip16 pm 256 ขายได้เท่าไหร่";
  const stable = buildExtractStable(ING);
  const variable = buildExtractVariable(Q, ING);
  const user = stable + variable;
  check("extract user: carries the raw query verbatim", user.includes(Q));
  check("extract user: lists model ids", user.includes("ip16pm | iPhone 16 Pro Max"));
  check("extract user: lists condition ids", user.includes("set16:0:1 | สภาพหน้าจอ | จอแตก มองเห็นชัด"));
  check("extract user: lists topics", user.includes("branches | "));

  // ── THE CACHE BOUNDARY ───────────────────────────────────────────────────
  // Caching is a prefix match, so what these pin is not tidiness: one wrong
  // side and 14,646 measured tokens go back to being re-read on every search,
  // with no error and no log to say so.
  check("cache split: the query is NOT in the cached block", !stable.includes(Q));
  check("cache split: condition ids are NOT in the cached block", !stable.includes("set16:0:1"));
  check("cache split: the catalog IS in the cached block", stable.includes("ip16pm | iPhone 16 Pro Max"));
  check("cache split: topics ARE in the cached block", stable.includes("branches | "));
  // Nothing may follow the query that we would rather have cached.
  check("cache split: the query sits last in the variable block", variable.trimEnd().endsWith(Q));

  // Order used to be RTDB's to decide. A shift there would have cost every
  // hit, silently — so it is this code's property now, by plain byte
  // comparison (localeCompare depends on the running Node's ICU data).
  const shuffled = { ...ING, models: [...ING.models].reverse() };
  check(
    "cache split: catalog order does not depend on the order it arrives in",
    buildExtractStable(shuffled) === stable
  );
  const lines = stable.split("\n");
  const ids = lines
    .slice(1, lines.indexOf("")) // the catalog block alone; topics follow the blank line
    .map((l) => l.split(" | ")[0]);
  check(
    "cache split: and that order is ascending by id",
    ids.length > 1 ? ids.every((id, i) => i === 0 || ids[i - 1] <= id) : true
  );

  // A price edit touching all 202 models must not disturb the prefix — the
  // strongest reason this block is worth caching at all.
  const repriced = { ...ING, models: ING.models.map((m) => ({ ...m, min: 1, max: 2 })) };
  check("cache split: repricing every model leaves the prefix identical", buildExtractStable(repriced) === stable);

  // ── THE BLOCKS THE API ACTUALLY RECEIVES ─────────────────────────────────
  const blocks = buildExtractContent(Q, ING);
  check("content: two text blocks", blocks.length === 2 && blocks.every((b) => b.type === "text"));
  check("content: the breakpoint is on the STABLE block, not the variable one",
    !!blocks[0].cache_control && !blocks[1].cache_control);
  // 5 minutes would expire unread at ~2 answers an hour, paying the write and
  // reading it back zero times.
  check("content: one-hour ttl", blocks[0].cache_control.ttl === "1h" && blocks[0].cache_control.type === "ephemeral");
  check("content: the stable block comes first — a prefix cannot be second",
    blocks[0].text === stable && blocks[1].text === variable);
  const sys = buildExtractSystemPrompt();
  check("extract system: forbids ids outside the lists", sys.includes("ห้ามแต่ง id เอง"));
  check(
    "extract system: names the forecast-is-not-a-condition rule",
    sys.includes("ราคาจะลงอีกไหม")
  );
}

// ── parseExtraction ─────────────────────────────────────────────────────────

{
  const good = parseExtraction(
    'คำตอบ: {"models": ["ip16pm"], "capacity": "256", "conditions": ["set16:0:1"], "topics": ["defects"], "intent": "deduction", "family": "iphone", "unknown_models": [], "confidence": "high"} ขอบคุณ',
    ING
  );
  check("parse: reads JSON wrapped in prose", !!good && good.models[0] === "ip16pm");
  check("parse: normalizes capacity 256 -> 256GB", good.capacity === "256GB");
  check("parse: keeps a valid condition id", good.conditions[0] === "set16:0:1");

  const phantom = parseExtraction(
    '{"models": ["ip18ultra", "ip16pm"], "conditions": ["set16:0:1", "setX:0:0"], "topics": ["market_trend", "defects"], "intent": "price"}',
    ING
  );
  check("parse: drops a phantom model id and counts it", phantom.models.length === 1 && phantom.dropped.models === 1);
  check("parse: drops an out-of-list condition id", phantom.conditions.length === 1 && phantom.dropped.conditions === 1);
  check(
    "parse: market_trend is not a pickable topic (facts ride the payload)",
    phantom.topics.length === 1 && phantom.topics[0] === "defects" && phantom.dropped.topics === 1
  );
  check("parse: null on no JSON at all", parseExtraction("ขออภัย ตอบไม่ได้", ING) === null);
  check("parse: bad intent falls to other", parseExtraction('{"intent": "buy_now"}', ING).intent === "other");
  check(
    "parse: unknown models kept as customer's words",
    parseExtraction('{"unknown_models": ["iPhone 20 Ultra"]}', ING).unknownModels[0] === "iPhone 20 Ultra"
  );

  // ── an abbreviation is not an absence ─────────────────────────────────────
  //
  // Production, 26 ส.ค. 2569, "Ipad gen 10". The price sheet above quoted
  // 5,000-8,000 บาท, the product card below said รับซื้อสูงสุด ฿8,000, and
  // between them the overview said "ข้อมูลรุ่น iPad gen 10 ยังไม่มีในระบบ
  // รับซื้อของเรา". The guard compared whole names — `ipadgen10` is not
  // `ipadgeneration10` — so the false absence went straight through.
  //
  // Both halves are pinned here, because a fix in either direction alone is
  // a different bug: too loose and a real absence stops being said out loud.
  const priced = (id, name, extra = {}) => ({
    id,
    name,
    min: 5000,
    max: 8000,
    conditionSetId: "setSmall",
    capacities: [{ name: "64GB", min: 5000, max: 6000, rows: 1, variant: "64GB" }],
    ...extra,
  });
  const ingOf = (...models) =>
    sanitizeIngredients({
      models,
      conditionSets: { setSmall: { groups: [] } },
      marketFacts: [],
      series: [],
      pages: [],
    });
  const filedUnknown = (ing, name) =>
    parseExtraction(JSON.stringify({ unknown_models: [name] }), ing).unknownModels;

  const GEN10 = ingOf(priced("gen10", "iPad Generation 10"));
  check(
    "parse: THE ABBREVIATION THE CUSTOMER TYPED IS NOT AN UNKNOWN MODEL",
    filedUnknown(GEN10, "iPad gen 10").length === 0
  );
  check("parse: lowercase spelling of it too", filedUnknown(GEN10, "ipad gen 10").length === 0);
  check(
    "parse: and it is counted, not silently vanished",
    parseExtraction('{"unknown_models": ["iPad gen 10"]}', GEN10).dropped.knownAsUnknown === 1
  );
  check(
    "parse: A REAL ABSENCE STILL SURVIVES — a generation we do not stock",
    filedUnknown(GEN10, "iPad gen 11")[0] === "iPad gen 11"
  );
  check(
    "parse: and a device from another family entirely",
    filedUnknown(GEN10, "iPhone 20 Ultra")[0] === "iPhone 20 Ultra"
  );

  // ONE entry has to explain the whole name, never the union of several.
  // Without that, an "iPhone 15" and a MacBook with a 16" screen between them
  // would account for every word of "iPhone 16" and delete a true absence.
  const SPLIT = ingOf(priced("ip15", "iPhone 15"), priced("mbp16", 'MacBook Pro 16" (ชิป M4, 2024)'));
  check(
    "parse: two rows cannot jointly explain away a model neither one is",
    filedUnknown(SPLIT, "iPhone 16")[0] === "iPhone 16"
  );

  // The alias carries the base iPad's other official name, so the guard sees
  // it wherever the admin has renamed the row.
  const A16 = ingOf(priced("a16", "iPad (A16)", { aka: "iPad Gen 11 / ไอแพด เจน 11" }));
  check("parse: the alias answers for the row it belongs to", filedUnknown(A16, "iPad gen 11").length === 0);
  check("parse: in Thai as well", filedUnknown(A16, "ไอแพด เจน 11").length === 0);
  check("parse: but not for the next generation along", filedUnknown(A16, "iPad gen 12")[0] === "iPad gen 12");
}

// ── a dent is not a dead device, and a name is not an answer ────────────────
//
// Production, 26 ส.ค. 2569: "Macbook neo 256 มีตำหนิ รอยตกบุบ ขายได้เท่าไหร่"
// returned a card whose whole answer was the words "MacBook Neo 13" — no
// price, no refusal, no sentence, under a heading saying an AI wrote it.
//
// The writer had been handed refusal copy about a device that will not power
// on or is iCloud/MDM locked, for a DENT. `declined` — a defect answer while
// the shop is not buying defective devices — was filed under the class
// written for those two named faults, so every scratch and dent was told it
// would not power on. The model could see that was not what the customer
// said, and wrote nothing rather than say it.
{
  const BODY = {
    title: "สภาพตัวเครื่องและฝาหลัง",
    options: [{ label: "สมบูรณ์ ไร้รอยตำหนิ", deduct: 0 }, { label: "มีรอยตกบุบ", defect: true }],
  };
  const POWER = {
    title: "เปิดเครื่อง / ใช้งานทั่วไป",
    options: [{ label: "ปกติ", deduct: 0 }, { label: "เปิดไม่ติด", failBehavior: "reject" }],
  };
  const NEO = 'MacBook Neo 13" (ชิป A18 Pro, 2026)';
  const ingOf = () =>
    sanitizeIngredients({
      models: [{
        id: "neo13", name: NEO, min: 12000, max: 15000, conditionSetId: "s",
        capacities: [{ name: "256GB", min: 12000, max: 13000, rows: 1, variant: "256GB" }],
      }],
      conditionSets: { s: { groups: [BODY, POWER] } },
      marketFacts: [], series: [], pages: [], acceptDefective: false,
    });
  const contextFor = (condition) => {
    const ing = ingOf();
    const ex = parseExtraction(
      JSON.stringify({ models: ["neo13"], capacity: "256GB", conditions: [condition], topics: [] }),
      ing
    );
    return buildV2Context({ query: "q", ingredients: ing, extraction: ex, serviceFacts: "" }).context;
  };

  const dent = contextFor("s:0:1");
  check(
    "a dent is NOT told it will not power on",
    !dent.includes("เปิดไม่ติดหรือติดล็อก iCloud/MDM")
  );
  check("a dent is refused in the customer's own terms", dent.includes("มีรอยตกบุบ"));
  check(
    "and the writer is told not to invent a fault",
    dent.includes("ห้ามอ้างอาการอื่นที่ลูกค้าไม่ได้บอก")
  );
  check(
    "nor to promise we buy it as-is — defective buying is switched OFF",
    dent.includes("ห้ามบอกว่ารับซื้อตามสภาพ") && !dent.includes("แต่เรายังรับซื้อตามสภาพ")
  );
  check("no price survives the refusal", !/12,000|15,000/.test(dent));

  // The class the copy WAS written for keeps it, unchanged.
  const dead = contextFor("s:1:1");
  check(
    "a device that will not power on still gets its own copy",
    dead.includes("เปิดไม่ติดหรือติดล็อก iCloud/MDM")
  );

  // The backstop. Two unrelated causes have now produced the same shape on
  // screen; a third will.
  const ing = ingOf();
  check("name only: the bare name is refused", isOnlyAModelName("MacBook Neo 13", ing));
  check("name only: the full catalog name too", isOnlyAModelName(NEO, ing));
  check("name only: and an empty summary", isOnlyAModelName("", ing));
  check(
    "name only: BUT a real answer is served",
    !isOnlyAModelName("MacBook Neo 13 รับซื้อ 12,000 - 15,000 บาท", ing)
  );
  check(
    "name only: including a refusal, which carries no price at all",
    !isOnlyAModelName("ตอนนี้เรายังรับซื้อเครื่องที่มีรอยตกบุบไม่ได้ครับ", ing)
  );
}

// ── applicability / emptiness ───────────────────────────────────────────────

{
  const junk = extraction();
  const junkIng = sanitizeIngredients({ models: rawIngredients().models, marketFacts: rawIngredients().marketFacts });
  check(
    "junk query: general fact does NOT make it answerable",
    applicableMarketFacts(junkIng, junk).length === 0 && !hasAnythingToWrite(junkIng, junk)
  );
  check(
    "forecast with no model: general fact applies",
    applicableMarketFacts(junkIng, extraction({ intent: "forecast" })).some((f) => f.appliesTo === "all")
  );
  check(
    "iphone model chosen: iphone fact applies, expired one does not",
    (() => {
      const facts = applicableMarketFacts(ING, extraction({ models: ["ip16pm"] }));
      return facts.some((f) => f.appliesTo === "iphone" && f.dropPctMin === 5) && !facts.some((f) => f.label === "หมดอายุแล้ว");
    })()
  );
  check(
    "ipad model chosen: iphone fact does not apply",
    !applicableMarketFacts(ING, extraction({ models: ["ipadair"] })).some((f) => f.appliesTo === "iphone")
  );
  check("pages alone make it answerable", hasAnythingToWrite(ING, junk));
  check(
    "unknown model alone makes it answerable",
    hasAnythingToWrite(junkIng, extraction({ unknownModels: ["iPhone 20 Ultra"] }))
  );
}

// ── stage-2 context ─────────────────────────────────────────────────────────

{
  const { context } = buildV2Context({
    query: "iphone 16 pro max 256 จอแตก",
    ingredients: ING,
    extraction: extraction({ models: ["ip16pm"], capacity: "256GB", conditions: ["set16:0:1"], intent: "deduction" }),
    serviceFacts: "",
  });
  check("context: carries the raw query", context.includes("คำค้นของลูกค้า: iphone 16 pro max 256 จอแตก"));
  check("context: capacity note present", context.includes("ลูกค้าระบุความจุ 256GB แล้ว"));
  // NET ONLY — the deduction worksheet is a trade secret (/sell has never
  // shown it). Hand-computed net off the 256GB rung: pct 20 of 30000/32000 =
  // 6000/6400 → remain 23,600 - 26,000. The หัก figures and the base price
  // of the conditioned model must BOTH be absent, or the subtraction can be
  // narrated back into existence.
  check("context: net estimate from the resolver, worst-vs-worst", context.includes("ราคาประเมินเบื้องต้นอยู่ที่ประมาณ 23,600 - 26,000 บาท"));
  check("context: no deduction amount anywhere", !context.includes("หักประมาณ"));
  check("context: no base price for the conditioned model", !context.includes("30,000 - 32,000 บาท"));
  check("context: the condition named in the customer's words", context.includes("สภาพที่ระบุ: จอแตก มองเห็นชัด"));
  check(
    "context: pre-inspection disclaimer line present",
    context.includes("เป็นการประเมินเบื้องต้น ยอดสุดท้ายยืนยันหลังตรวจสภาพเครื่องจริง")
  );
}

{
  const { context } = buildV2Context({
    query: "ขาย iphone 16 pro max ตอนนี้หรือรอ iphone 18",
    ingredients: ING,
    extraction: extraction({ models: ["ip16pm"], intent: "forecast", family: "iphone", unknownModels: ["iPhone 18"] }),
    serviceFacts: "",
  });
  check(
    "context: market fact header line is verbatim (prompt rule 13 names it)",
    context.includes("แนวโน้มราคาที่ทีมงานประเมินไว้ (ช่วงประมาณการ ไม่ใช่ราคาผูกมัด):")
  );
  check("context: percentage line intact", context.includes("5-12% จากราคาปัจจุบัน (ความมั่นใจปานกลาง)"));
  // Baht conversion by CODE, single chosen model: 30000*5% = 1500, 42000*12% = 5040.
  check("context: forecast baht computed by code", context.includes("คิดเป็นเงินประมาณ 1,500 - 5,040 บาท"));
  check("context: expired fact absent", !context.includes("หมดอายุแล้ว"));
  check("context: unknown model stated as absence", context.includes("iPhone 18") && context.includes("ยังไม่มีในระบบรับซื้อของเรา"));
  check("context: series line present with sign", context.includes("30 วันที่ผ่านมาเปลี่ยนแปลงจริง -8%"));
  check("context: series labeled as history, not forecast", context.includes("ไม่ใช่คำพยากรณ์"));
  // Was: "siblings for a forecast question". The owner read a production
  // answer that ended "ถ้าเทียบทางเลือกอื่น iPhone 17 Air อยู่ที่ 20,000 -
  // 22,000 บาท ขณะ iPhone 16 Pro อยู่ที่ 21,000 - 24,000 บาท" under a query
  // that named one model and one capacity, and asked the only question that
  // matters: เปรียบเทียบทำไม. Someone who names their device is holding it.
  check("context: no siblings when the customer named their model", !context.includes("รุ่นข้างเคียงในตระกูลเดียวกัน"));
  check("context: paused sibling never offered", !context.includes("MacBook Air M2"));
}

{
  // ...and comparison still gets compared, because that one was asked for.
  const { context } = buildV2Context({
    query: "iphone 16 pro max กับ iphone 16 อันไหนได้ราคาดีกว่า",
    ingredients: ING,
    extraction: extraction({ models: ["ip16pm"], intent: "compare", family: "iphone" }),
    serviceFacts: "",
  });
  check("context: siblings survive for an explicit comparison", context.includes("รุ่นข้างเคียงในตระกูลเดียวกัน"));
}

{
  const { context } = buildV2Context({
    query: "iphone",
    ingredients: ING,
    extraction: extraction({ intent: "family_overview", family: "iphone" }),
    serviceFacts: "",
  });
  // Family span across ALL priced iphone models: min 14000, max 42000, 3 models.
  check(
    "family overview: span computed across every priced member",
    context.includes("ช่วงราคารับซื้อรวมของทุกรุ่นในตระกูล iPhone (3 รุ่น): 14,000 - 42,000 บาท")
  );
  check("family overview: forbids recomputing from the sample", context.includes("ห้ามคำนวณช่วงรวมเองจากรายการนี้"));
  // The label lock. A span across three models must not be readable as one
  // model's price — the production bug attached exactly this kind of number
  // to the name the customer typed.
  check(
    "family overview: says the span belongs to several models",
    context.includes("ห้ามเขียนว่าเป็นราคาของรุ่นใดรุ่นหนึ่ง")
  );
}

{
  // The unknown-model door into the same section. "iPhone 20 Ultra" is not in
  // the catalog, so the family span matched NOTHING the customer typed — the
  // one place where the old "ทุกรุ่นที่ตรงกับคำค้นนี้" wording was not just
  // vague but false.
  const { context } = buildV2Context({
    query: "iPhone 20 Ultra ราคาเท่าไหร่",
    ingredients: ING,
    extraction: extraction({ intent: "price", family: "iphone", unknownModels: ["iPhone 20 Ultra"] }),
    serviceFacts: "",
  });
  check(
    "unknown model: family span is labelled as the family, not the query",
    context.includes("ช่วงราคารับซื้อรวมของทุกรุ่นในตระกูล iPhone")
  );
  check(
    "unknown model: forbids attaching the span to the model that does not exist",
    context.includes("ห้ามผูกกับรุ่นที่ลูกค้าพิมพ์มา")
  );
}

{
  const { context } = buildV2Context({
    query: "มีสาขาที่ไหนบ้าง",
    ingredients: ING,
    extraction: extraction({ intent: "service", topics: ["branches"] }),
    serviceFacts: "\n\nข้อมูลร้าน (ข้อเท็จจริงจากระบบ):\nสาขาที่เปิดให้บริการ (2 แห่ง):\n- สาขาสยาม",
    // service intent: facts must outrank deductions/forecast in the budget
  });
  const factsAt = context.indexOf("ข้อมูลร้าน");
  const trendAt = context.indexOf("แนวโน้มราคา");
  check("service intent: store facts present", factsAt !== -1);
  check("service intent: facts come before any trend block", trendAt === -1 || factsAt < trendAt);
}

{
  // Budget: pages are the tail — a bloated facts block pushes them out, and
  // the drop is reported, never silent.
  const big = "ข้อมูลร้าน (ข้อเท็จจริงจากระบบ):\n" + "ก".repeat(V2_MAX_CONTEXT_CHARS);
  const { context, droppedSections } = buildV2Context({
    query: "ขั้นตอนขาย",
    ingredients: ING,
    extraction: extraction({ intent: "price", models: ["ip16pm"], topics: ["process"] }),
    serviceFacts: big,
  });
  check("budget: context stays under the ceiling", context.length <= V2_MAX_CONTEXT_CHARS);
  check("budget: oversized section dropped and named", droppedSections.includes("service_facts"));
  check("budget: prices survived the squeeze", context.includes("iPhone 16 Pro Max"));
}

{
  const { context } = buildV2Context({
    query: "iphone 16 pro max 2TB",
    ingredients: ING,
    extraction: extraction({ models: ["ip16pm"], capacity: "2TB", intent: "price" }),
    serviceFacts: "",
  });
  check(
    "capacity we do not buy: absence stated, no number on the line",
    context.includes("ไม่มีความจุ 2TB ในรายการรับซื้อของรุ่นนี้") && context.includes("256GB, 512GB, 1TB")
  );
  check("capacity we do not buy: no priced line for that model", !context.includes("สูงสุด 42,000"));
}

// ── helpers ─────────────────────────────────────────────────────────────────

check("normalizeCapacity: bare digits get GB", normalizeCapacity(" 512 ") === "512GB");
check("normalizeCapacity: TB kept", normalizeCapacity("1tb") === "1TB");
check("normalizeCapacity: words rejected", normalizeCapacity("จอแตก") === null);
check("resolver: pct beats deduct", resolveOptionDeduction({ pct: 10, deduct: 999 }, 20000, 1) === 2000);
check("resolver: liquidity factor applies", resolveOptionDeduction({ deduct: 1000 }, 20000, 1.5) === 1500);
check(
  "modelPrice: paused wins over everything",
  modelPrice({ paused: true, min: 1, max: 2, capacities: [{ name: "256GB", min: 1, max: 2 }] }, "256GB").paused === true
);

// ── done ────────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll v2 pipeline checks passed");
