// ---------------------------------------------------------------------------
// The real quote on the /search overview — the gate, the resolver, and the
// two rules that decide whether a figure may exist at all.
//
//   node functions/test/search-overview-v2-quote.test.mjs
//
// What these pin, and why each one is here:
//   - a device the shop does not buy gets NO number, ever, in any form
//   - a group the customer never answered is FILLED and SAID, not skipped —
//     skipping it quotes above what the shop pays whenever the cheapest option
//     in that group still deducts
//   - a stated battery percentage picks its own bucket (a language model kept
//     rounding 79% up into a better bracket, which inflates every quote)
//   - a capacity that names two priced rows can never become one figure
//   - the figure in the context is the figure in the response: one arithmetic,
//     two renderings, and the excision gate can vouch for it
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const v2 = require("../search-overview-v2.js");
const { sanitizeIngredients, parseExtraction, buildV2Context } = v2;
const { resolveConditions, pickBatteryOptionId, quoteGate, resolveModelConditions } = v2.__test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// ── Fixtures ────────────────────────────────────────────────────────────────

const SCREEN = {
  title: "สภาพหน้าจอ",
  options: [
    { label: "ไม่มีรอย", deduct: 0 },
    { label: "มีรอยขีดข่วน", deduct: 800 },
    // as-is class: the shop still buys this one (live label, 83 sets).
    { label: "จอเสีย / ทัชมีปัญหา", failBehavior: "reject" },
    { label: "เปิดไม่ติด", defect: true },
  ],
};
/** The live power group — the one class that really is a closed door. */
const POWER = {
  title: "เปิดเครื่อง / ใช้งานทั่วไป",
  options: [
    { label: "ปกติ", deduct: 0 },
    { label: "เปิดไม่ติด / ค้าง / ดับเอง", failBehavior: "reject" },
  ],
};
const BATTERY = {
  title: "สุขภาพแบตเตอรี่",
  options: [
    { label: "90% ขึ้นไป", deduct: 0 },
    { label: "85-89%", deduct: 500 },
    { label: "80-84%", deduct: 1000 },
    { label: "แบตต่ำกว่า 80% (Service)", deduct: 2500 },
  ],
};
/** The group whose BEST case still costs money — the shape that makes the
 *  fill rule matter rather than being a tidy-up. */
const WARRANTY = {
  title: "ประกันศูนย์",
  options: [
    { label: "ประกันเหลือ", deduct: 0 },
    { label: "หมดประกัน", deduct: 1200 },
  ],
};

const raw = (over = {}) => ({
  models: [
    {
      id: "ip16pm",
      name: "iPhone 16 Pro Max",
      category: "Smartphones",
      family: "iphone",
      min: 30000,
      max: 36000,
      conditionSetId: "set16",
      capacities: [
        { name: "256GB", min: 30000, max: 30000, rows: 1, variant: "256GB" },
        { name: "512GB", min: 36000, max: 36000, rows: 1, variant: "512GB" },
      ],
    },
    {
      id: "mba",
      name: 'MacBook Air 13" M2',
      category: "Mac / Laptop",
      family: "mac",
      min: 12000,
      max: 15000,
      conditionSetId: "setMBA",
      // 256GB spans two priced rows — naming the capacity has NOT named a
      // machine.
      capacities: [
        { name: "256GB", min: 12000, max: 14000, rows: 2 },
        { name: "512GB", min: 15000, max: 15000, rows: 1, variant: "M2 | 8GB | 512GB" },
      ],
    },
  ],
  conditionSets: {
    set16: { groups: [SCREEN, BATTERY, WARRANTY, POWER] },
    setMBA: { groups: [SCREEN, WARRANTY] },
  },
  marketFacts: [],
  series: [],
  pages: [],
  ...over,
});

const ing = (over) => sanitizeIngredients(raw(over));

/** cid of one option, by group/option index inside a set. */
const cid = (setId, gi, oi) => `${setId}:${gi}:${oi}`;

const extract = (over = {}) =>
  parseExtraction(
    JSON.stringify({
      models: ["ip16pm"],
      capacity: "256GB",
      conditions: [],
      topics: [],
      intent: "price",
      family: "iphone",
      unknown_models: [],
      confidence: "high",
      ...over,
    }),
    ing()
  );

// ── sanitize: the three new facts survive, the noise does not ───────────────

{
  const i = ing({ acceptDefective: true });
  check("sanitize: acceptDefective is carried", i.acceptDefective === true);
  check("sanitize: acceptDefective FAILS CLOSED when absent", ing().acceptDefective === false);
  check(
    "sanitize: acceptDefective fails closed on a truthy non-true",
    sanitizeIngredients(raw({ acceptDefective: "yes" })).acceptDefective === false
  );

  const opts = i.conditionSets.set16.groups[0].options;
  check("sanitize: failBehavior reject crosses", opts[2].failBehavior === "reject");
  check("sanitize: defect crosses", opts[3].defect === true);
  check("sanitize: a plain option carries neither flag", !("failBehavior" in opts[0]) && !("defect" in opts[0]));

  const rungs = i.models[0].capacities;
  check("sanitize: rows + variant survive", rungs[0].rows === 1 && rungs[0].variant === "256GB");
  const mac = i.models[1].capacities;
  check("sanitize: a multi-row rung keeps rows and NO variant", mac[0].rows === 2 && !("variant" in mac[0]));
  // An older website deploy sends neither field. Absent must stay absent:
  // defaulting rows to 1 would claim every capacity names one machine, which
  // is exactly the MacBook mistake the field exists to prevent.
  const legacy = sanitizeIngredients({
    ...raw(),
    models: [{ id: "x", name: "X", min: 1, max: 1, capacities: [{ name: "256GB", min: 1, max: 1 }] }],
  });
  check(
    "sanitize: rows is absent, never defaulted to 1, on an older payload",
    !("rows" in legacy.models[0].capacities[0]) && !("variant" in legacy.models[0].capacities[0])
  );
  check(
    "sanitize: a variant name without rows === 1 is dropped",
    !(
      "variant" in
      sanitizeIngredients({
        ...raw(),
        models: [
          { id: "x", name: "X", min: 1, max: 1, capacities: [{ name: "256GB", min: 1, max: 1, rows: 3, variant: "M2 | 8GB | 256GB" }] },
        ],
      }).models[0].capacities[0]
    )
  );
}

// ── stage 1: battery_pct ────────────────────────────────────────────────────

{
  check("stage1: a stated percentage is kept", extract({ battery_pct: 85 }).batteryPct === 85);
  check("stage1: absent reads as null", extract().batteryPct === null);
  check("stage1: out of range is dropped", extract({ battery_pct: 0 }).batteryPct === null);
  check("stage1: over 100 is dropped", extract({ battery_pct: 250 }).batteryPct === null);
  check("stage1: junk is dropped", extract({ battery_pct: "แปดสิบ" }).batteryPct === null);
  check("stage1: a fraction is rounded", extract({ battery_pct: 84.6 }).batteryPct === 85);
  check(
    "stage1: the prompt asks for the NUMBER, and forbids rounding",
    v2.buildExtractSystemPrompt().includes("battery_pct") &&
      v2.buildExtractSystemPrompt().includes("ห้ามปัดเลข")
  );
}

// ── the resolver (mirror of quotePolicy) ────────────────────────────────────

{
  const groups = v2.__test.withPositionalIds([SCREEN, BATTERY, WARRANTY]);

  const filled = resolveConditions({ groups, answers: { 0: "1" }, basePrice: 30000 });
  check(
    "resolver: an unanswered group is filled with its cheapest option",
    filled.answers["2"] === "0" && filled.assumedGroups.includes("ประกันศูนย์")
  );
  check(
    "resolver: never assumes a reject or defect row",
    resolveConditions({ groups: v2.__test.withPositionalIds([SCREEN]), answers: {}, basePrice: 30000 })
      .answers["0"] === "0"
  );
  check(
    "resolver: a stated battery percentage overrides the caller's option",
    resolveConditions({ groups, answers: { 1: "0" }, basePrice: 30000, batteryPct: 79 }).answers["1"] === "3"
  );
  check("resolver: 79 goes to the service bucket, not the one above", pickBatteryOptionId(
    v2.__test.withPositionalIds([BATTERY])[0].options, 79
  ) === "3");
  check(
    "resolver: a defect answer declines while the shop is not accepting",
    resolveConditions({ groups, answers: { 0: "3" }, basePrice: 30000 }).declined !== null
  );
  check(
    "resolver: and does not while it is",
    resolveConditions({ groups, answers: { 0: "3" }, basePrice: 30000, acceptDefective: true }).declined === null
  );
}

// ── the gate ────────────────────────────────────────────────────────────────

const quoteOf = (over, ingOver) => quoteGate(ing(ingOver), extract(over));

{
  // Everything present: screen answered, battery stated, one row named.
  const ok = quoteOf({
    conditions: [cid("set16", 0, 1)],   // มีรอยขีดข่วน -800
    battery_pct: 87,                    // 85-89% -500
  });
  check("gate: quotes when the model, the row and both core groups are known", !!ok.quote);
  check(
    "gate: the figure is base minus every resolved deduction",
    // 30,000 - 800 (จอ) - 500 (แบต) - 0 (ประกันเหลือ, assumed) = 28,700
    ok.quote && ok.quote.net_price === 28700 && ok.quote.base_price === 30000
  );
  check("gate: names the sellable row", ok.quote && ok.quote.variant === "256GB");
  check(
    "gate: says what it assumed",
    ok.quote &&
      ok.quote.assumed_groups.join("|") === "ประกันศูนย์|เปิดเครื่อง / ใช้งานทั่วไป"
  );
  check(
    "gate: every condition row is reported, assumed ones flagged",
    ok.quote &&
      ok.quote.conditions.length === 4 &&
      ok.quote.conditions.filter((c) => c.assumed).length === 2
  );

  check(
    "G1: two models is two prices — no figure",
    quoteOf({ models: ["ip16pm", "mba"], conditions: [cid("set16", 0, 1)], battery_pct: 87 }).reason ===
      "not_one_model"
  );
  check(
    "G1: a model we could not name at all blocks the figure",
    quoteOf({ conditions: [cid("set16", 0, 1)], battery_pct: 87, unknown_models: ["iPhone 19"] }).reason ===
      "unknown_model_named"
  );
  check(
    "G2: stage 1's own doubt blocks the figure",
    quoteOf({ conditions: [cid("set16", 0, 1)], battery_pct: 87, confidence: "low" }).reason === "low_confidence"
  );
  check(
    "G4: a capacity spanning two priced rows can never be one figure",
    quoteOf({ models: ["mba"], capacity: "256GB", conditions: [cid("setMBA", 0, 1)] }).reason ===
      "variant_ambiguous"
  );
  check(
    "G4: no capacity at all is not a device either",
    quoteOf({ capacity: null, conditions: [cid("set16", 0, 1)], battery_pct: 87 }).reason === "variant_ambiguous"
  );
  check(
    "G5: an unanswered core group blocks the figure",
    // Screen answered, battery NOT stated -> the battery group is assumed.
    quoteOf({ conditions: [cid("set16", 0, 1)] }).reason === "core_group_unanswered"
  );
  check(
    "G5: a set without a core group does not have to answer it",
    // The MacBook set has no battery group at all; 512GB names one row. The
    // cid is set16's — conditionChoices dedupes identical (group, option)
    // pairs across sets, so a concept is offered once and each model prices
    // it from its OWN set (resolveConditionForSet).
    !!quoteOf({ models: ["mba"], capacity: "512GB", conditions: [cid("set16", 0, 1)] }).quote
  );
  check(
    "battery: an absent percentage is not 'below 80%' — Number(null) is 0",
    pickBatteryOptionId(v2.__test.withPositionalIds([BATTERY])[0].options, null) === null
  );
  check(
    "G6: a rejected device has no price, full stop",
    quoteOf({ conditions: [cid("set16", 0, 2)], battery_pct: 87 }).reason === "declined"
  );
  check(
    "G6: a defect device is refused while the shop is not accepting",
    quoteOf({ conditions: [cid("set16", 0, 3)], battery_pct: 87 }).reason === "declined"
  );
  check(
    "G6: and is quotable once the shop accepts them",
    !!quoteOf({ conditions: [cid("set16", 0, 3)], battery_pct: 87 }, { acceptDefective: true }).quote
  );
}

// ── reject is TWO classes, and the copy has to know which ──────────────────

{
  // as-is: a dead screen. /sell buys this at roughly 10-20% of base with an
  // admin confirming, and /corporate promises it in writing — so the page may
  // refuse to QUOTE it, never to buy it.
  const asIs = buildV2Context({
    query: "iphone 16 pro max 256 จอเสีย",
    ingredients: ing(),
    extraction: extract({ conditions: [cid("set16", 0, 2)] }),
    serviceFacts: "",
  });
  check("as-is: no figure", !asIs.quote);
  check("as-is: says we still buy it", asIs.context.includes("แต่เรายังรับซื้อตามสภาพ"));
  check(
    "as-is: forbids the writer from saying we do not",
    asIs.context.includes("ห้ามบอกว่าไม่รับซื้อ")
  );
  check(
    "as-is: does NOT use the closed-door sentence",
    !asIs.context.includes("อยู่นอกเกณฑ์รับซื้อ")
  );
  check("as-is: still no baht anywhere", !/\d{1,3},\d{3}\s*บาท/.test(asIs.context));

  // no-buy: will not power on. This one really is a closed door.
  const noBuy = buildV2Context({
    query: "iphone 16 pro max 256 เปิดไม่ติด",
    ingredients: ing(),
    extraction: extract({ conditions: [cid("set16", 3, 1)] }),
    serviceFacts: "",
  });
  check("no-buy: no figure", !noBuy.quote);
  check("no-buy: uses the closed-door sentence", noBuy.context.includes("อยู่นอกเกณฑ์รับซื้อ"));
  check(
    "no-buy: names the reason in the customer's own terms",
    noBuy.context.includes("iCloud/MDM") || noBuy.context.includes("เปิดไม่ติด")
  );
  check(
    "no-buy: never invites them to sell it anyway",
    // "ยังรับซื้อไม่ได้" contains "ยังรับซื้อ" — match the invitation itself.
    !noBuy.context.includes("แต่เรายังรับซื้อตามสภาพ")
  );
  check("no-buy: no baht anywhere", !/\d{1,3},\d{3}\s*บาท/.test(noBuy.context));
}

// ── the context: the figure is IN it, and a refusal carries none ────────────

{
  const ctx = buildV2Context({
    query: "iphone 16 pro max 256 จอมีรอย แบต 87",
    ingredients: ing(),
    extraction: extract({ conditions: [cid("set16", 0, 1)], battery_pct: 87 }),
    serviceFacts: "",
  });
  check("context: carries the quote object", !!ctx.quote && ctx.quote.net_price === 28700);
  check(
    "context: the exact figure is in the text, so the excision gate can vouch for it",
    ctx.context.includes("28,700")
  );
  check(
    "context: the assumption is stated, not hidden",
    ctx.context.includes("ระบบประเมินตามสภาพปกติไว้แล้ว") && ctx.context.includes("ประกันศูนย์")
  );
  // The writer echoes the vocabulary this line hands it. It shipped once
  // saying "โดยสมมติว่าจอและตัวเครื่องสมบูรณ์" because the instruction itself
  // said สมมติ — in spoken Thai that reads as "we made it up", which
  // understates a figure computed from a real condition set. What the
  // context can be held to is the phrasing it prescribes, so hold it to that.
  check(
    "context: prescribes the spoken-Thai phrasing for the assumption",
    ctx.context.includes("ราคานี้คิดจากสภาพ")
  );
  check(
    "context: the only สมมติ left is the one banning it",
    ctx.context.split("สมมติ").length - 1 === 1 &&
      ctx.context.includes('ห้ามใช้คำว่า "สมมติ"')
  );

  const refused = buildV2Context({
    query: "iphone 16 pro max 256 จอเสีย",
    ingredients: ing(),
    extraction: extract({ conditions: [cid("set16", 0, 2)] }),
    serviceFacts: "",
  });
  check("context: a refused device produces no quote object", !refused.quote);
  // set16:0:2 is the AS-IS class (a dead screen), so the wording is the
  // still-buying one — the closed door has its own block above.
  check("context: and says so in words", refused.context.includes("ยังรับซื้อ"));
  check(
    "context: a refused device carries NO baht figure anywhere",
    !/\d{1,3},\d{3}\s*บาท/.test(refused.context)
  );
}

// ── the fill rule changes a real number ─────────────────────────────────────

{
  // Same query, same model, but the shop's warranty group costs money at its
  // best case. Before the fill rule this device quoted 30,000 - 800 - 500;
  // now the un-mentioned group is priced too.
  const withCost = raw();
  withCost.conditionSets.set16 = {
    groups: [
      SCREEN,
      BATTERY,
      { title: "ประกันศูนย์", options: [{ label: "ประกันเหลือ", deduct: 300 }, { label: "หมดประกัน", deduct: 1200 }] },
    ],
  };
  const g = quoteGate(
    sanitizeIngredients(withCost),
    parseExtraction(
      JSON.stringify({
        models: ["ip16pm"],
        capacity: "256GB",
        conditions: [cid("set16", 0, 1)],
        battery_pct: 87,
        topics: [],
        intent: "price",
        family: "iphone",
        unknown_models: [],
        confidence: "high",
      }),
      sanitizeIngredients(withCost)
    )
  );
  check(
    "fill rule: a group nobody answered is CHARGED, not treated as free",
    g.quote && g.quote.net_price === 30000 - 800 - 500 - 300
  );
}

// ── a model the customer's words never reached keeps its range ─────────────

{
  // The customer named a defect that exists in one model's set and not in
  // another's. The model that cannot price it must NOT be given an estimate
  // built entirely out of assumptions — that quotes it as if the defect had
  // never been mentioned.
  const twoSets = raw();
  twoSets.conditionSets.setMBA = { groups: [WARRANTY] }; // no screen group at all
  const i = sanitizeIngredients(twoSets);
  const ex2 = parseExtraction(
    JSON.stringify({
      models: ["mba"],
      capacity: "512GB",
      conditions: [cid("set16", 0, 1)], // มีรอยขีดข่วน — a screen answer
      topics: [],
      intent: "deduction",
      family: "mac",
      unknown_models: [],
      confidence: "high",
    }),
    i
  );
  const built = buildV2Context({ query: "macbook air 512 จอมีรอย", ingredients: i, extraction: ex2, serviceFacts: "" });
  check(
    "unreachable condition: no estimate line for a model whose set lacks it",
    !built.context.includes("ราคาประเมินเบื้องต้นอยู่ที่ประมาณ")
  );
  check("unreachable condition: and no single figure either", !built.quote);
  check(
    "unreachable condition: the ordinary price line survives",
    built.context.includes("ราคารับซื้อของเรา")
  );
}

// ── resolveModelConditions returns nothing it cannot price ──────────────────

{
  const i = ing();
  check(
    "resolver: a capacity the model does not stock is not resolvable",
    resolveModelConditions(i.models[0], i, extract({ capacity: "1TB" })) === null
  );
}

console.log("");
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All v2 quote checks passed");
