/**
 * search overview V2 — the two-call pipeline behind customerSearchOverview.
 *
 * V1 asked the website to understand the customer's Thai (regex extractors,
 * keyword classifiers) and handed this function a finished context. V2 flips
 * that: the WEBSITE sends raw ingredients (its catalog rows, the condition
 * sets of the models it matched, market facts, series summaries, page hits)
 * and this function runs three stages on a cache miss:
 *
 *   stage 1 — a small model reads the RAW query plus id lists and returns
 *             strict JSON. Every id must come from the lists, so there is no
 *             channel for phantom models or invented conditions — the whole
 *             family of substring bugs ("งอ" inside "ลงอีก") dies
 *             structurally, not by adding one more regex.
 *   stage 2 — CODE pulls and computes. Prices, deduction baht, forecast baht,
 *             family ranges: every number the answer may contain is computed
 *             here, before the writing model is ever involved.
 *   stage 3 — the model writes the answer from stage 2's context. It decides
 *             phrasing, never arithmetic.
 *
 * WHO DECIDES WHAT REACHES V2: the website. The exact matcher stays there as
 * the first gate — an exact model-name query renders the free template and
 * never calls this function. Everything stricter than that arrives here.
 *
 * THE CACHE KEY IS THE INGREDIENTS, NOT THE STAGE-2 CONTEXT. The key must be
 * computable before stage 1 (a hit must cost zero model calls), and the
 * ingredients are exactly the facts the answer is written from: a price
 * change, an expired market fact, or an edited branch list changes the key,
 * so a stale paragraph becomes unreachable rather than served — the same
 * property v1's query+context hash had.
 *
 * This module is PURE apart from module-level constants: no fetch, no
 * Firebase. The handler in search-overview.js owns the gates (secret,
 * settings, cache, rate limit, cap), the two Anthropic calls, and the
 * archive. That split is what the offline tests pin.
 */

const crypto = require("crypto");
const { languageLines, languageDirective } = require("./answer-language");

// Chosen models per answer. Mirrors MODEL_FACT_LIMIT on the website: a
// summary reads three or four devices; past that it becomes the list it is
// supposed to be summarising.
const MODEL_PICK_LIMIT = 4;
const CONDITION_PICK_LIMIT = 6;
const TOPIC_PICK_LIMIT = 2;
const UNKNOWN_MODEL_LIMIT = 3;
const SIBLING_LIMIT = 3;
const FAMILY_TOP_LIMIT = 3;

// The ingredients payload is bounded so a buggy or malicious caller cannot
// make this function hash and log megabytes per request. The full catalog is
// ~200 models; 400 leaves headroom without inviting abuse.
const MAX_INGREDIENT_MODELS = 400;
const MAX_CONDITION_SETS = 8;
const MAX_MARKET_FACTS = 12;
const MAX_SERIES_ROWS = 8;
const MAX_PAGES = 3;
const MAX_CANONICAL_CHARS = 160000;

// Stage-2 context budget — same ceiling the v1 catalog context had. Spent in
// priority order; whole sections are dropped from the tail, never cut
// mid-sentence (a fact ending mid-word invites the model to finish it).
const V2_MAX_CONTEXT_CHARS = 6000;

// Stage 1 returns a few hundred characters of JSON. The frontend aborts the
// whole request at 22s, so the extraction gets a short leash and the writer
// keeps the long one.
const EXTRACT_MAX_TOKENS = 500;
const EXTRACT_TIMEOUT_MS = 8000;

/**
 * The v2 writer's own output budget — twice v1's 700.
 *
 * Live probe round 1: 3/10 answers arrived as JSON cut off mid-`detail`,
 * because a three-layer answer (verdict + reasons + comparison) simply is
 * longer than "restate these numbers". V1 keeps its 700 untouched — its
 * answers are the short kind, and the A/B stays honest.
 */
const V2_MAX_OUTPUT_TOKENS = 1400;

const INTENTS = new Set([
  "price",
  "deduction",
  "forecast",
  "service",
  "store",
  "compare",
  "family_overview",
  "other",
]);

const FAMILIES = new Set(["iphone", "ipad", "mac", "apple-watch"]);
/** How a family is named to the customer. The family sections carry a
 *  combined range across every member, and a range whose line does not say
 *  whose it is gets attributed to whatever name is nearest — the query's. */
const FAMILY_LABELS = {
  iphone: "iPhone",
  ipad: "iPad",
  mac: "Mac",
  "apple-watch": "Apple Watch",
};
const familyLabel = (fam) => FAMILY_LABELS[fam] || String(fam || "");

// MIRROR of modelFamily in bkk-frontend-next/lib/priceForecast.ts — the
// category strings are the catalog's own. The website also sends `family`
// per model; this map is the fallback when it does not.
function familyOfCategory(category) {
  const c = String(category || "").toLowerCase();
  if (c.includes("smartphone")) return "iphone";
  if (c.includes("tablet")) return "ipad";
  if (c.includes("mac") || c.includes("laptop")) return "mac";
  if (c.includes("watch")) return "apple-watch";
  return null;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
const baht = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

/** "256" and "256gb" both mean 256GB; anything else is not a capacity this
 *  catalog prices by and is dropped rather than guessed at. */
function normalizeCapacity(raw) {
  const s = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if (!s) return null;
  if (/^\d+(GB|TB)$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `${s}GB`;
  return null;
}

// ---------------------------------------------------------------------------
// Ingredients — what the website sends, reduced to something safe to use.
// ---------------------------------------------------------------------------

function sanitizeModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw.id, 64).trim();
  const name = str(raw.name, 120).trim();
  if (!id || !name) return null;
  const out = {
    id,
    name,
    min: Math.max(0, num(raw.min)),
    max: Math.max(0, num(raw.max)),
  };
  const alias = str(raw.alias, 120).trim();
  if (alias) out.alias = alias;
  const category = str(raw.category, 40).trim();
  if (category) out.category = category;
  const family = str(raw.family, 20).trim().toLowerCase();
  if (FAMILIES.has(family)) out.family = family;
  if (raw.paused === true) out.paused = true;
  const pausedMessage = str(raw.pausedMessage, 200).trim();
  if (pausedMessage) out.pausedMessage = pausedMessage;
  const setId = str(raw.conditionSetId, 64).trim();
  if (setId) out.conditionSetId = setId;
  const lf = Number(raw.liquidityFactor);
  if (Number.isFinite(lf) && lf > 0) out.liquidityFactor = lf;
  if (Array.isArray(raw.capacities)) {
    const rungs = [];
    for (const c of raw.capacities.slice(0, 12)) {
      const rung = normalizeCapacity(c && c.name);
      if (!rung) continue;
      const row = { name: rung, min: Math.max(0, num(c.min)), max: Math.max(0, num(c.max)) };
      // How many sellable rows this capacity covers, and the row's own name
      // when it covers exactly one. NOT defaulted: an older website deploy
      // sends neither, and guessing 1 would claim a MacBook's "256GB" names a
      // single machine when it spans two prices. Absent means unknown, and
      // unknown never passes the quote gate.
      const rows = Math.round(num(c.rows));
      if (rows > 0) row.rows = rows;
      const variant = str(c.variant, 120).trim();
      if (rows === 1 && variant) row.variant = variant;
      rungs.push(row);
    }
    if (rungs.length) out.capacities = rungs;
  }
  // The same fact at model level, for a model whose whole catalogue row is one
  // variant — it has no capacity ladder at all (a ladder needs two rungs), so
  // without this it could never be quoted as one device.
  const soleVariant = str(raw.soleVariant, 120).trim();
  if (soleVariant) out.soleVariant = soleVariant;
  return out;
}

function sanitizeConditionSets(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const setId of Object.keys(raw).slice(0, MAX_CONDITION_SETS)) {
    const set = raw[setId];
    if (!set || typeof set !== "object" || !Array.isArray(set.groups)) continue;
    const groups = [];
    for (const g of set.groups.slice(0, 20)) {
      if (!g || typeof g !== "object") continue;
      const options = [];
      for (const o of (Array.isArray(g.options) ? g.options : []).slice(0, 12)) {
        if (!o || typeof o !== "object") continue;
        const opt = { label: str(o.label || o.name, 80).trim() };
        if (!opt.label) continue;
        for (const k of ["deduct", "pct", "t1", "t2", "t3"]) {
          if (o[k] != null && Number.isFinite(Number(o[k]))) opt[k] = Number(o[k]);
        }
        // The two answers that mean "the shop does not buy this device". They
        // carry no deduction (a reject option is worth 0 baht), so without
        // them a refused device is priced like a healthy one.
        if (o.failBehavior === "reject") opt.failBehavior = "reject";
        if (o.defect === true) opt.defect = true;
        options.push(opt);
      }
      groups.push({ title: str(g.title, 80).trim(), options });
    }
    if (groups.length) out[str(setId, 64)] = { groups };
  }
  return out;
}

function sanitizeMarketFacts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const f of raw.slice(0, MAX_MARKET_FACTS)) {
    if (!f || typeof f !== "object") continue;
    const label = str(f.label, 120).trim();
    const appliesTo = str(f.appliesTo, 20).trim().toLowerCase();
    const expiresAt = num(f.expiresAt);
    if (!label || !appliesTo || !(expiresAt > 0)) continue;
    if (appliesTo !== "all" && !FAMILIES.has(appliesTo)) continue;
    const row = { label, appliesTo, expiresAt };
    const text = str(f.text, 300).trim();
    const certainty = str(f.certainty, 60).trim();
    if (certainty) row.certainty = certainty;
    if (text) {
      row.text = text;
    } else {
      const min = Number(f.dropPctMin);
      const max = Number(f.dropPctMax);
      // Both numbers or nothing — same rule as the v1 renderer: a
      // single-figure forecast reads as a target.
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      if (min < 0 || max < 0 || max > 100 || min > max) continue;
      if (!certainty) continue;
      row.dropPctMin = min;
      row.dropPctMax = max;
    }
    out.push(row);
  }
  return out;
}

/**
 * The whole payload, or null when it cannot carry a v2 request at all.
 * The model list is mandatory — stage 1 has nothing to choose from without
 * it — everything else degrades to "that section is absent".
 */
function sanitizeIngredients(raw) {
  if (!raw || typeof raw !== "object") return null;
  const models = [];
  if (Array.isArray(raw.models)) {
    for (const m of raw.models.slice(0, MAX_INGREDIENT_MODELS)) {
      const clean = sanitizeModel(m);
      if (clean) models.push(clean);
    }
  }
  if (!models.length) return null;

  const out = {
    models,
    // The local matcher's own picks, ids only, rank order preserved. Bounded
    // by the same cap as the catalog: a caller cannot make this list longer
    // than the list it points into.
    matchedIds: Array.isArray(raw.matchedIds)
      ? raw.matchedIds
          .slice(0, MAX_INGREDIENT_MODELS)
          .map((id) => str(id, 64).trim())
          .filter((id) => id && models.some((m) => m.id === id))
      : [],
    conditionSets: sanitizeConditionSets(raw.conditionSets),
    // `settings/store/accept_defective_devices`, as the website read it.
    // FAIL CLOSED: anything that is not exactly true means the shop is not
    // buying defective devices, which is what the website and quotePolicy
    // both do when the key is missing.
    acceptDefective: raw.acceptDefective === true,
    marketFacts: sanitizeMarketFacts(raw.marketFacts),
    series: [],
    pages: [],
  };
  if (Array.isArray(raw.series)) {
    for (const s of raw.series.slice(0, MAX_SERIES_ROWS)) {
      if (!s || typeof s !== "object") continue;
      const modelId = str(s.modelId, 64).trim();
      const days = Math.round(num(s.days));
      const changePct = Number(s.changePct);
      if (!modelId || !(days > 0) || !Number.isFinite(changePct)) continue;
      out.series.push({ modelId, days, changePct: Math.round(changePct * 10) / 10 });
    }
  }
  if (Array.isArray(raw.pages)) {
    for (const p of raw.pages.slice(0, MAX_PAGES)) {
      if (!p || typeof p !== "object") continue;
      const title = str(p.title, 120).trim();
      if (!title) continue;
      out.pages.push({
        title,
        path: str(p.path, 120).trim(),
        description: str(p.description, 200).trim(),
      });
    }
  }
  if (canonicalIngredients(out).length > MAX_CANONICAL_CHARS) return null;
  return out;
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

/** Stable stringify — key order must not depend on how the website built the
 *  object, or identical facts would produce different cache keys. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalIngredients(ingredients) {
  return stableStringify(ingredients);
}

/**
 * factsVersion is the store-facts half of the key — a hash of the rendered
 * branch/contact/promotion/delivery blocks, computed by the handler from the
 * same memoized renderers stage 2 reads. It is what lets a branch edit bust
 * cached v2 answers even though those facts never cross the wire in the
 * payload. Market facts are NOT in it: they arrive in the payload and are
 * already hashed there.
 */
function v2CacheKey(query, ingredients, factsVersion, lang = "th") {
  return crypto
    .createHash("sha256")
    .update(
      `${query}\n\n${canonicalIngredients(ingredients)}\n\n${String(factsVersion || "")}` +
        `\n\nlang=${lang === "en" ? "en" : "th"}`
    )
    .digest("hex")
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Stage 1 — extraction
// ---------------------------------------------------------------------------

// Topics stage 1 may pick. market_trend is deliberately absent: market facts
// arrive in the payload and are keyed there; letting stage 1 route to the
// RTDB renderer as well would give one fact two sources that can disagree.
const V2_TOPIC_DESCRIPTIONS = {
  branches: "สาขา ที่ตั้งร้าน เวลาเปิดปิด",
  contact: "ช่องทางติดต่อ เบอร์โทร LINE อีเมล",
  promotions: "โปรโมชั่น คูปอง ส่วนลดที่ใช้ได้ตอนนี้",
  delivery: "ค่าบริการไรเดอร์ไปรับถึงที่ พื้นที่ให้บริการ",
  payment: "การจ่ายเงิน โอนเงิน ได้เงินเมื่อไหร่",
  price_dispute: "ราคาจริงต่ำกว่าประเมิน ยกเลิกการขาย ส่งเครื่องคืน",
  encumbered: "เครื่องติดผ่อน ติด iCloud ติดล็อก",
  data_wipe: "การลบข้อมูลก่อนขาย ความปลอดภัยข้อมูล",
  documents: "เอกสารที่ต้องเตรียม กล่อง อุปกรณ์",
  defects: "เครื่องเสีย จอแตก ตำหนิ รับซื้อไหม",
  process: "ขั้นตอนการขาย การตรวจสภาพ",
};

const normLabel = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

/** Every condition option the payload's sets offer, as pickable ids.
 *  cid = `${setId}:${groupIndex}:${optionIndex}` — an address into data the
 *  website already sent, so resolving one back needs no lookup at all.
 *
 *  DEDUPED by (group, label): the catalog runs one condition set PER MODEL
 *  (per-model split), so a three-model match ships three near-identical
 *  "จอแตก" rows — three ids for one concept is exactly the choice a small
 *  model gets wrong, and the resolver below treats any of them as the
 *  concept anyway. One row per concept, first address wins. */
function conditionChoices(ingredients) {
  const out = [];
  const seen = new Set();
  const sets = (ingredients && ingredients.conditionSets) || {};
  for (const setId of Object.keys(sets)) {
    (sets[setId].groups || []).forEach((g, gi) => {
      (g.options || []).forEach((o, oi) => {
        const dedupe = `${normLabel(g.title)}|${normLabel(o.label)}`;
        if (seen.has(dedupe)) return;
        seen.add(dedupe);
        out.push({ cid: `${setId}:${gi}:${oi}`, group: g.title || "", label: o.label });
      });
    });
  }
  return out;
}

/**
 * A picked cid names a CONDITION CONCEPT, not a row in one model's table.
 *
 * Live finding (preview, "iphone 16 pro max จอแตก"): the catalog runs one
 * condition set per model, so stage 1's list held a "จอแตก" from each matched
 * model's set — it picked one, the chosen model owned a different set, the
 * old `setId === conditionSetId` equality found nothing, and a customer who
 * named both the device and the defect got the vague no-figure note instead
 * of a price. So the cid resolves to its (group title, option label) and each
 * chosen model looks that concept up IN ITS OWN SET — exact normalized label
 * equality on admin-authored data, never a substring match on customer text
 * (the per-model split clones sets, so equivalent options carry equal labels;
 * a set that genuinely lacks the option still prices nothing, correctly).
 */
function resolveConditionForSet(cid, ingredients, set) {
  const [srcSetId, giRaw, oiRaw] = String(cid || "").split(":");
  const src = ingredients.conditionSets[srcSetId];
  const srcGroup = src && src.groups[Number(giRaw)];
  const srcOpt = srcGroup && srcGroup.options[Number(oiRaw)];
  if (!srcOpt) return null;
  if (!set) return null;
  for (const g of set.groups || []) {
    if (normLabel(g.title) !== normLabel(srcGroup.title)) continue;
    for (const o of g.options || []) {
      if (normLabel(o.label) === normLabel(srcOpt.label)) return { group: g, option: o };
    }
  }
  // Same label under a differently-titled group still names the concept —
  // accept it only when it is unambiguous within the set.
  const loose = [];
  for (const g of set.groups || []) {
    for (const o of g.options || []) {
      if (normLabel(o.label) === normLabel(srcOpt.label)) loose.push({ group: g, option: o });
    }
  }
  return loose.length === 1 ? loose[0] : null;
}

function buildExtractSystemPrompt() {
  return [
    "คุณคือตัวแยกความหมายของคำค้นในเว็บร้านรับซื้ออุปกรณ์ Apple มือสอง",
    "หน้าที่: อ่านคำค้นดิบของลูกค้า แล้วตอบเป็น JSON ตามรูปแบบที่กำหนดเท่านั้น",
    "",
    "กฎเหล็ก:",
    "1. id ทุกตัวที่ตอบ ต้องคัดลอกมาจากลิสต์ที่ให้ไว้เป๊ะๆ เท่านั้น ห้ามแต่ง id เอง",
    "2. รุ่นที่ลูกค้าเอ่ยถึงแต่ไม่มีในลิสต์รุ่น ให้ใส่ชื่อตามที่ลูกค้าเรียกลงใน unknown_models ห้ามจับคู่กับรุ่นอื่นที่ใกล้เคียง — แต่ก่อนใส่ต้องเช็คลิสต์ให้ถี่ถ้วน: ลูกค้ามักพิมพ์ตัวย่อหรือสะกดต่าง (เช่น 16pm / ip16 promax = iPhone 16 Pro Max, ไอโฟน = iPhone) ถ้าชื่อที่เอ่ยคือรุ่นเดียวกับที่มีในลิสต์ ให้เลือก id นั้นลง models ห้ามใส่ unknown_models",
    "3. conditions ใส่เฉพาะเมื่อลูกค้าพูดถึงสภาพเครื่องจริงๆ และมี id ที่ตรงความหมาย — ประโยคอย่าง 'ราคาจะลงอีกไหม' ไม่ใช่สภาพเครื่อง ต้องได้ conditions ว่าง",
    // PRODUCTION, 25 ส.ค. 2569, "iPhone 12 pro max 256 เปลี่ยนแบตไม่แท้ ขายได้
    // เท่าไหร่". The card read: สุขภาพแบตเตอรี่ = แบตเตอรี่เสื่อม (STATED) and
    // ประวัติการซ่อม = ไม่เคยซ่อม (ASSUMED, best case). Both wrong off one
    // phrase. Replacing a battery is a REPAIR, not a battery-health reading —
    // and the block headed "what you did not tell us" then asserted the
    // opposite of what the customer had just typed, at the shop's best price.
    //
    // The shop's own numbers say what that costs: chat-ai.js rule 6.8 puts a
    // genuine part at roughly 20% and an unknown or fake one at roughly 70%.
    // So this is not a wording slip, it is quoting a phone that does not exist
    // at a price nobody will honour when it arrives.
    "3.1 การซ่อม/เปลี่ยนอะไหล่เป็นเรื่องของหัวข้อ \"ประวัติการซ่อม\" เสมอ ห้ามลงหัวข้อแบตเตอรี่: \"เปลี่ยนแบต\", \"เปลี่ยนจอ\", \"เคยซ่อม\", \"เปลี่ยนอะไหล่\" คือประวัติการซ่อม. หัวข้อสุขภาพแบตเตอรี่รับเฉพาะคำที่พูดถึง*สภาพ*ของแบต (เปอร์เซ็นต์ หรือคำว่าเสื่อม/ต่ำ/หมดไว) เท่านั้น — ลูกค้าบอกว่าเปลี่ยนแบตแต่ไม่ได้บอกเปอร์เซ็นต์ = ประวัติการซ่อมมีคำตอบ ส่วนแบตเตอรี่ไม่มีคำตอบ",
    "3.2 อะไหล่แท้กับไม่แท้ต้องแยกให้ถูก เพราะหักคนละหลักพัน: \"ไม่แท้\", \"เทียบ\", \"ร้านนอก\", \"ไม่ใช่ศูนย์\", \"ชิ้นส่วนที่ไม่รู้จัก\" → เลือก option ประวัติการซ่อมที่หมายถึงซ่อมด้วยอะไหล่ไม่แท้. \"ศูนย์\", \"ศูนย์ไทย\", \"อะไหล่แท้\", \"Apple\" → เลือก option ที่หมายถึงซ่อมศูนย์/อะไหล่แท้. บอกว่าเคยซ่อมแต่ไม่บอกว่าแท้หรือไม่ → เลือก option ที่หมายถึงเคยซ่อมแบบไม่ระบุ ถ้าชุดนั้นไม่มีให้เลือกทางที่หักหนักกว่า (เดาไปทางที่ดีกว่า = สัญญาเงินที่ร้านจะไม่จ่ายตอนตรวจเครื่องจริง)",
    "3.3 ประโยคเดียวระบุได้หลายหัวข้อ ให้ใส่ครบทุก id ที่ตรง: \"เปลี่ยนแบตไม่แท้ แบตเหลือ 79\" = ประวัติการซ่อม (ไม่แท้) + battery_pct 79 ไม่ใช่เลือกอย่างใดอย่างหนึ่ง",
    "4. เลขในคำค้นที่เป็นความจุ (เช่น 256, 512GB, 1TB) ใส่ใน capacity พร้อมหน่วยเสมอ ไม่ใช่ชื่อรุ่น",
    "5. intent เลือกค่าเดียวที่ตรงที่สุด: price=ถามราคารุ่น, deduction=ถามยอดหักตามสภาพ, forecast=ถามแนวโน้ม/จังหวะขาย, service=ถามบริการหรือขั้นตอน, store=ถามข้อมูลร้าน, compare=เทียบรุ่นหรือทางเลือก, family_overview=พิมพ์ชื่อตระกูลกว้างๆ, other=นอกเหนือจากนี้",
    "6. family ใส่เมื่อคำค้นพูดถึงตระกูลสินค้า (iphone/ipad/mac/apple-watch) แม้ไม่ระบุรุ่น มิฉะนั้นเป็น null",
    "7. confidence=low เมื่อไม่แน่ใจว่าอ่านคำค้นถูก",
    // The number, not the bucket. A model asked to pick the battery OPTION
    // kept rounding upward into a better bracket (79% -> \"81-85%\"), which
    // inflates the quote every time; asked only to copy the digits it cannot.
    // The bucket is chosen by code afterwards (resolveConditions).
    "8. battery_pct ใส่เฉพาะเมื่อลูกค้าบอกเปอร์เซ็นต์สุขภาพแบตเตอรี่เป็นตัวเลข (เช่น 'แบต 85', 'battery 79%') ให้ใส่ตัวเลขล้วน 1-100 ห้ามปัดเลข ห้ามเดา ไม่มีตัวเลข = null",
    "9. ตอบเป็น JSON ล้วนๆ ห้ามมีข้อความอื่นนอก JSON",
    "",
    "รูปแบบคำตอบ:",
    '{"models": ["id"], "capacity": "256GB หรือ null", "conditions": ["id"], "battery_pct": 85, "topics": ["id"], "intent": "price", "family": "iphone หรือ null", "unknown_models": ["ชื่อที่ลูกค้าเรียก"], "confidence": "high"}',
  ].join("\n");
}

/**
 * STAGE 1's PROMPT, SPLIT AT WHAT CHANGES — the split is the whole point.
 *
 * Measured on the live catalog (202 models, scripts/extract-prompt-tokens.mjs):
 * the lists below are 14,646 tokens, 12,883 of them the catalog, and stage 1
 * reads all of it on EVERY search to answer with one line of JSON. It costs
 * 2,225ms of a 10,133ms wait (p50, 62 production answers).
 *
 * That is the shape prompt caching is for, and caching is a PREFIX match:
 * everything after the first byte that changes per request is uncacheable.
 * The previous single-string version opened with the customer's query, which
 * put the 14,646 tokens behind a value that changes every time — no marker
 * could have helped. So the stable half is built on its own, and the caller
 * marks it.
 *
 * WHAT COUNTS AS STABLE, precisely:
 *
 *   models  — id | name | alias. NO PRICES: an admin repricing all 202 models
 *             does not disturb this prefix at all. It moves only when a model
 *             is added, renamed, or realiased.
 *   topics  — a constant in this file.
 *
 * Condition options are NOT here: buildOverviewIngredients ships the sets of
 * MATCHED models only, so that block moves with the query.
 *
 * SORTED BY ID, and not for tidiness. The order used to be whatever order
 * RTDB happened to return the catalog in — a property of the database, not of
 * this code. The day that order shifts, the prefix changes and every request
 * misses the cache with no error and no log: cache_read_input_tokens simply
 * reads 0 forever. Plain byte comparison, never localeCompare, whose result
 * depends on the ICU data built into the running Node.
 */
function buildExtractStable(ingredients) {
  const lines = ["ลิสต์รุ่นในระบบ (id | ชื่อ | ชื่อเรียกอื่น):"];
  const models = [...(((ingredients && ingredients.models) || []))].sort((a, b) => {
    const x = String(a && a.id);
    const y = String(b && b.id);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (const m of models) {
    lines.push(`${m.id} | ${m.name}${m.alias ? ` | ${m.alias}` : ""}`);
  }
  lines.push("", "ลิสต์หัวข้อบริการที่เลือกได้ (id | ความหมาย):");
  for (const [id, desc] of Object.entries(V2_TOPIC_DESCRIPTIONS)) lines.push(`${id} | ${desc}`);
  return lines.join("\n");
}

/** Everything that moves with the request. The query goes LAST — nothing may
 *  follow it that we would rather have cached. */
function buildExtractVariable(query, ingredients) {
  const lines = [];
  const choices = conditionChoices(ingredients);
  if (choices.length) {
    lines.push("ลิสต์สภาพเครื่องที่เลือกได้ (id | หมวด | ตัวเลือก):");
    for (const c of choices) lines.push(`${c.cid} | ${c.group} | ${c.label}`);
    lines.push("");
  }
  lines.push(`คำค้นดิบของลูกค้า: ${query}`);
  return lines.join("\n");
}

/**
 * The user message as content blocks, with the breakpoint between them.
 *
 * ttl "1h", not the 5-minute default, and the traffic is the reason: ~26
 * generated answers a day, clustered in waking hours, is roughly 2 an hour. A
 * 5-minute entry would expire unread almost every time — paying the 1.25x
 * write and reading it back zero times. The 1-hour entry costs 2x to write
 * and needs three requests inside the window to pay for itself, which at this
 * volume is break-even on cost; the reason to do it is the wait, and it
 * improves on its own as traffic grows.
 *
 * Below claude-haiku-4-5's 4,096-token minimum a marker is accepted, costs
 * nothing and does nothing. This prefix measures 14,646 — 3.6x over — but
 * that is a measurement of today's catalog, not a guarantee, which is why the
 * caller logs what actually came back.
 */
function buildExtractContent(query, ingredients) {
  return [
    {
      type: "text",
      text: buildExtractStable(ingredients),
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
    { type: "text", text: buildExtractVariable(query, ingredients) },
  ];
}

/**
 * The model's reply, validated against the lists it was given.
 *
 * Every unknown id is DROPPED AND COUNTED, never repaired: a phantom model id
 * that got "fixed" to the nearest real one would be the ghost-model bug back
 * through a second door. Returns null only when no JSON object could be read
 * at all — an empty-but-valid extraction is a real result (the caller decides
 * whether there is anything to write from).
 */
function parseExtraction(raw, ingredients) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const modelIds = new Set(ingredients.models.map((m) => m.id));
  const cids = new Set(conditionChoices(ingredients).map((c) => c.cid));
  const dropped = { models: 0, conditions: 0, topics: 0 };

  const models = [];
  for (const id of Array.isArray(obj.models) ? obj.models : []) {
    const s = String(id || "").trim();
    if (!s) continue;
    if (!modelIds.has(s)) {
      dropped.models++;
      continue;
    }
    if (!models.includes(s) && models.length < MODEL_PICK_LIMIT) models.push(s);
  }

  const conditions = [];
  for (const id of Array.isArray(obj.conditions) ? obj.conditions : []) {
    const s = String(id || "").trim();
    if (!s) continue;
    if (!cids.has(s)) {
      dropped.conditions++;
      continue;
    }
    if (!conditions.includes(s) && conditions.length < CONDITION_PICK_LIMIT) conditions.push(s);
  }

  const topics = [];
  for (const id of Array.isArray(obj.topics) ? obj.topics : []) {
    const s = String(id || "").trim();
    if (!s) continue;
    if (!V2_TOPIC_DESCRIPTIONS[s]) {
      dropped.topics++;
      continue;
    }
    if (!topics.includes(s) && topics.length < TOPIC_PICK_LIMIT) topics.push(s);
  }

  // A name the CATALOG KNOWS can never be "unknown", whatever the extractor
  // says. Live finding (preview hands-on): stage 1 filed "iPhone 16 Pro Max"
  // under unknown_models while the catalog holds it priced — and the answer
  // told a customer "ยังไม่มีข้อมูล" about a device the card below was
  // selling. The prompt now pushes back too, but a false absence is a lie to
  // a customer, so the guard is structural: normalized name/alias match
  // against the list drops the entry (drop, never promote — auto-promoting
  // to the matched id would be the repair-a-phantom door this parser refuses).
  const knownNames = new Set();
  const normName = (s) => String(s || "").toLowerCase().replace(/[\s\-_/|]+/g, "");
  for (const m of ingredients.models) {
    knownNames.add(normName(m.name));
    if (m.alias) for (const a of m.alias.split("/")) knownNames.add(normName(a));
  }
  const unknownModels = [];
  for (const nameRaw of Array.isArray(obj.unknown_models) ? obj.unknown_models : []) {
    const s = str(nameRaw, 60).trim();
    if (!s) continue;
    if (knownNames.has(normName(s))) {
      dropped.knownAsUnknown = (dropped.knownAsUnknown || 0) + 1;
      continue;
    }
    if (!unknownModels.includes(s) && unknownModels.length < UNKNOWN_MODEL_LIMIT) {
      unknownModels.push(s);
    }
  }

  const intent = INTENTS.has(obj.intent) ? obj.intent : "other";
  const family = FAMILIES.has(String(obj.family || "").toLowerCase())
    ? String(obj.family).toLowerCase()
    : null;

  // A stated battery percentage, or null. Bounded to 1-100 because anything
  // outside it is a misread rather than a number worth acting on, and rounded
  // because the buckets are whole percents.
  const battRaw = Number(obj.battery_pct);
  const batteryPct =
    Number.isFinite(battRaw) && battRaw >= 1 && battRaw <= 100 ? Math.round(battRaw) : null;

  return {
    models,
    capacity: normalizeCapacity(obj.capacity),
    conditions,
    batteryPct,
    topics,
    intent,
    family,
    unknownModels,
    confidence: obj.confidence === "high" ? "high" : "low",
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — parsing and verifying the writer's reply
// ---------------------------------------------------------------------------

/**
 * The v2 reply parser — tolerant where v1's is strict, because the failure it
 * absorbs is REAL (live probe round 1: 3/10 replies unparseable): a model
 * wrapping its JSON in a markdown fence, or a reply cut off mid-`detail` by
 * the output cap. In both cases a COMPLETE summary is usually sitting right
 * there, and throwing it away over a broken tail is the customer paying for
 * an answer they never see.
 *
 * Salvage rules, strict on purpose:
 *   - fences are stripped, then a clean brace-to-brace parse is tried first —
 *     the salvage path never touches a well-formed reply
 *   - salvage only accepts COMPLETE quoted strings (closing quote present),
 *     so a summary cut mid-sentence is never served as whole
 *   - no summary salvageable = null, same contract as before
 *
 * v1 keeps parseOverview untouched — its model, budget and failure rate are
 * the production baseline the A/B measures against.
 */
/** At most this many highlighted phrases per answer. The whole point of the
 *  field is focus — a fourth highlight is the first three losing theirs. */
const MAX_KEY_POINTS = 3;


function parseOverviewV2(raw, ingredients) {
  const text = String(raw || "").trim().replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start === -1) return null;

  const modelIds = new Set((((ingredients && ingredients.models) || [])).map((m) => m.id));
  // Out-of-list id = dropped to null, never repaired — the same "drop, never
  // promote" rule as stage 1's extraction (a wrong CTA points a customer at
  // the wrong device, which is worse than no pointer at all).
  const cleanPrimary = (id) => {
    const s = String(id || "").trim();
    return s && modelIds.has(s) ? s : null;
  };
  // 1-3 standalone phrases, capped hard: extras beyond MAX_KEY_POINTS are cut
  // silently. A legacy single key_point folds in for prompt-drift tolerance.
  const cleanKeyPoints = (list, single) => {
    // An EMPTY array still falls through to the legacy single field: the spans
    // now arrive as an array that is usually empty, and treating "empty" as
    // "the caller supplied a list" would silence the fallback entirely.
    const src = Array.isArray(list) && list.length ? list : single ? [single] : [];
    const out = [];
    for (const k of src) {
      const s = String(k || "").trim();
      if (s) out.push(s);
      if (out.length >= MAX_KEY_POINTS) break;
    }
    return out;
  };

  const end = text.lastIndexOf("}");
  if (end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const rawSummary = String(obj.summary || "").trim();
      if (rawSummary) {
        // Marks come out HERE, before anything downstream sees the text: the
        // excision gate, the archive and the customer all get cleaned prose,
        // and the spans are substrings of it by construction.
        const sum = extractMarkedSpans(rawSummary);
        const det = extractMarkedSpans(String(obj.detail || "").trim());
        return {
          summary: sum.text,
          detail: det.text,
          keyPoints: cleanKeyPoints([...sum.spans, ...det.spans], obj.key_point),
          primaryModelId: cleanPrimary(obj.primary_model_id),
          salvaged: false,
        };
      }
    } catch {
      /* fall through to salvage */
    }
  }
  const grab = (key) => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
    if (!m) return "";
    try {
      return String(JSON.parse(m[1])).trim();
    } catch {
      return "";
    }
  };
  // key_points sits LAST in the demanded field order (copy it out of prose
  // that is already written), so on a truncated reply it is the field most
  // likely to be MISSING — which is the right thing to lose: an answer
  // without a highlight still reads, an answer without its detail does not.
  // Same strictness as grab: an unparseable array is [], never a guess.
  const grabArray = (key) => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*(\\[[^\\]]*\\])`));
    if (!m) return [];
    try {
      const a = JSON.parse(m[1]);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  };
  const rawSummary = grab("summary");
  if (!rawSummary) return null;
  const sum = extractMarkedSpans(rawSummary);
  const det = extractMarkedSpans(grab("detail"));
  return {
    summary: sum.text,
    detail: det.text,
    keyPoints: cleanKeyPoints([...sum.spans, ...det.spans], grab("key_point")),
    primaryModelId: cleanPrimary(grab("primary_model_id")),
    salvaged: true,
  };
}

/**
 * Key points, ADMITTED ONLY VERBATIM. The model does not write markup and
 * does not get to introduce text through a side door either: each key point
 * is a POINTER into the text the customer will actually read, so it counts
 * only when it appears there character-for-character — checked against the
 * SERVED summary/detail (post-excision), because a highlight pointing at a
 * sentence the number gate just cut would resurrect it. Anything else —
 * reworded, abbreviated, hallucinated, or orphaned by excision — is dropped
 * silently: a missing highlight is a shrug, a wrong one is a lie about what
 * matters.
 *
 * This same check IS the number gate for key points: a verbatim substring of
 * the post-excision text can only carry digit runs that already passed
 * allowedNumberRuns. Summary and detail are checked separately, never as one
 * concatenated string — a phrase spanning the artificial join would match
 * text no reader ever sees.
 */
/** The pair the writer wraps its key span in. Guillemets: absent from Thai and
 *  English prose, absent from every price and model name we print, and one
 *  character each, so a truncated reply loses the pair rather than half a word. */
const MARK_OPEN = "\u00ab";
const MARK_CLOSE = "\u00bb";
const MARK_RE = /\u00ab([^\u00ab\u00bb]{1,200})\u00bb/g;

/**
 * A span may be at most this much of the text it sits in.
 *
 * The number this guard exists to reject is ~1.0 — the writer wrapping the
 * entire answer, which is what the sentence-number version shipped and what a
 * reader sees as a coloured block rather than as emphasis.
 *
 * It is NOT meant to reject one sentence out of two. That lands anywhere from
 * 0.4 to 0.65 depending on how long the other sentence is, and it is exactly
 * the emphasis we asked for — an earlier 0.6 here threw away a perfectly good
 * highlight on a two-sentence summary. 0.85 separates "all of it" from "most
 * of a short answer" without adjudicating taste.
 */
const MARK_MAX_SHARE = 0.85;

/**
 * HIGHLIGHTS THE WRITER MARKS IN PLACE — the version with nothing left to
 * disagree about.
 *
 * Three mechanisms failed here, each for its own reason, and each fix removed
 * one more thing the writer had to get right:
 *
 *   1. "repeat the phrase verbatim in key_points" — 5 highlights in 77
 *      production answers. It had to reproduce its own wording exactly.
 *   2. Same, but written after the prose so it could copy — 0 in 4. Copying
 *      is still reproducing.
 *   3. "send the NUMBER of the sentence" — marked the whole answer, or
 *      nothing at all. It had to count sentences the way splitSentences
 *      counts them, and that splitter cannot read Thai: Thai separates
 *      sentences with SPACES, not full stops, so a whole Thai paragraph is
 *      one chunk. Index 0 selected the entire answer; index 1 fell off the
 *      end. Both failures are visible in the same pair of screenshots.
 *
 * What is left is writing the marks where the emphasis goes — no reproducing,
 * no counting, no agreement with any splitter. The span is a substring of the
 * answer because it was never anything else.
 *
 * Returns the cleaned text and its spans. Every marker is stripped, matched or
 * not: an unbalanced one left in place would reach the customer as a stray
 * character, and a span longer than MARK_MAX_SHARE is dropped as shading.
 */
function extractMarkedSpans(text) {
  const src = String(text || "");
  if (!src.includes(MARK_OPEN) && !src.includes(MARK_CLOSE)) return { text: src, spans: [] };
  const found = [];
  MARK_RE.lastIndex = 0;
  let m;
  while ((m = MARK_RE.exec(src)) !== null) {
    const span = m[1].trim();
    if (span) found.push(span);
  }
  const clean = src.split(MARK_OPEN).join("").split(MARK_CLOSE).join("");
  const spans = [];
  for (const span of found) {
    if (spans.includes(span)) continue;
    if (span.length > clean.length * MARK_MAX_SHARE) continue;
    spans.push(span);
    if (spans.length >= MAX_KEY_POINTS) break;
  }
  return { text: clean, spans };
}

function admittedKeyPoints(keyPoints, served) {
  const summary = String((served && served.summary) || "");
  const detail = String((served && served.detail) || "");
  const out = [];
  for (const k of Array.isArray(keyPoints) ? keyPoints : []) {
    const s = String(k || "").trim();
    if (!s) continue;
    if (!summary.includes(s) && !detail.includes(s)) continue;
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_KEY_POINTS) break;
  }
  return out;
}

/**
 * The id legend for primary_model_id — ONLY the chosen models, name = id.
 *
 * Two deliberate boundaries: (1) it is appended to the USER MESSAGE by the
 * handler, never folded into the context string, because the excise gate
 * whitelists every digit run in the context and catalog ids can contain
 * digits — an id in the context would hand the model price-shaped numbers
 * the gate then cannot cut. (2) only chosen models are listed: the CTA may
 * point at a model the answer is actually about, never at a sibling the
 * writer wandered to (the live bug this chunk fixes was the button offering
 * iPhone 12 under an iPhone 17 Pro Max answer).
 */
function primaryModelLegend(ingredients, extraction) {
  const rows = [];
  for (const id of extraction.models) {
    const m = ingredients.models.find((x) => x.id === id);
    if (m) rows.push(`- ${m.name} = ${m.id}`);
  }
  if (!rows.length) return "";
  return [
    "รหัสรุ่นสำหรับ field primary_model_id เท่านั้น (ห้ามให้รหัสเหล่านี้ปรากฏใน summary หรือ detail):",
    ...rows,
  ].join("\n");
}

/**
 * Every price-shaped digit run the context can vouch for, commas stripped.
 * Runs shorter than three digits are not collected — percentages, battery
 * levels, day counts and generation numbers live down there, and none of
 * them is a price a customer will quote at the door.
 */
function allowedNumberRuns(context) {
  const out = new Set();
  for (const m of String(context || "").replace(/,/g, "").match(/\d{3,}/g) || []) {
    out.add(m);
  }
  return out;
}

/** Sentence-ish segments of a Thai answer. Newlines first, then the two
 *  boundaries this register actually produces: a closing "ครับ" and Latin
 *  terminal punctuation. Thai has no full stop — a field that never splits
 *  stays one segment, and the caller drops it whole. */
function splitSentences(text) {
  return String(text || "")
    .split(/\n+|(?<=ครับ)\s+|(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * THE LAST GATE BEFORE THE CUSTOMER: any sentence quoting a price-shaped
 * number the context cannot account for is cut before the answer is served,
 * cached or archived.
 *
 * Live probe round 1 caught the model doing arithmetic — 21,120 baht, a
 * correct subtraction the rules forbid — and a prompt alone cannot make that
 * impossible, only rarer. This makes it structural: the number never reaches
 * the page, however fluent the sentence around it.
 *
 * Shape: {summary, detail, excised}. A summary with nothing left after
 * excision returns null — serving an empty answer is worse than falling back.
 * Deterministic on its inputs, so the cached copy and the served copy are
 * always the same text.
 */
function exciseUnverifiedNumbers(parsed, context) {
  const allowed = allowedNumberRuns(context);
  let excised = 0;
  // Reports its own cuts: whether the SUMMARY lost a sentence is a different
  // question from whether anything anywhere did, and the floor below needs
  // the first one.
  const clean = (text) => {
    const kept = [];
    let cut = 0;
    for (const sentence of splitSentences(text)) {
      const runs = sentence.replace(/,/g, "").match(/\d{3,}/g) || [];
      if (runs.every((r) => allowed.has(r))) kept.push(sentence);
      else cut++;
    }
    excised += cut;
    return { text: kept.join(" "), cut };
  };
  const sum = clean(parsed.summary);
  const summary = sum.text;
  if (!summary) return null;
  // A PRICE ANSWER THAT LOST ITS PRICE IS NOT AN ANSWER.
  //
  // Production, 24 ส.ค. 2569, "Sell iPad Pro M1 128GB battery 80%" on /en:
  // the card's summary read, in full, "iPad Pro 11." Two sentences had been
  // cut for carrying figures the context could not vouch for, and the
  // fragment was served in the answer's position on the page.
  //
  // It only became reachable when English answers started working, and the
  // reason is splitSentences — the same splitter that broke the highlight
  // mechanism. It breaks on `. ! ?` and on "ครับ", so a Thai paragraph is ONE
  // chunk: all of it survives or none does, and none of it is `!summary`,
  // which already refused. English prose splits properly, so the gate began
  // cutting sentence by sentence with nothing beneath it to catch a
  // half-answer.
  //
  // The test is the same thing this gate polices — a figure. If a priced
  // sentence was cut out of the summary and no figure survives, the text
  // cannot do the job it was generated for. A RATIO WAS THE FIRST ATTEMPT AND
  // WAS WRONG: at half, it also refused ACC9's case, where one bad sentence is
  // trimmed off a sound answer that still carries its 30,000 - 32,000 range.
  // Share of text was never the question; whether a price survived is.
  //
  // Gated on `sum.cut` so an answer that never carried a figure — pure
  // guidance, nothing excised — is left exactly as it was.
  //
  // Refusing is cheap and correct: overviewFallback drops to the template,
  // which quotes the same catalogue with numbers that are ours by
  // construction. A fragment is the one outcome worse than either.
  if (sum.cut > 0 && !/\d{3,}/.test(summary.replace(/,/g, ""))) return null;
  return { summary, detail: clean(parsed.detail || "").text, excised };
}

/**
 * CHANNELS WE HAVE NO FACTS ABOUT — cut, not asked nicely about.
 *
 * Rule 7 was extended to forbid recommending a route we do not run, after
 * production answers closed with "ลองเทียบดูทั้งการ trade-in กับศูนย์ และการ
 * ขายเงินสด". The rule shipped; the sentence came back the same evening on a
 * query that had never been asked before ("iPhone 15 128GB", 21 ส.ค. 2569).
 * A prompt makes a behaviour rarer, never impossible — the same lesson the
 * number gate above was built on, and the same answer: make it structural.
 *
 * The list is deliberately SHORT. Two things nearby must keep working:
 *   - "ศูนย์" alone is everywhere legitimately — ประกันศูนย์, เครื่องศูนย์ไทย
 *     is a real condition option and appears in real answers.
 *   - "marketplace" is one of OUR OWN curated market facts; the model quotes
 *     it because we handed it over.
 * So only the act of pointing the customer at a trade-in is matched.
 */
const OFF_LIMITS_RE = /trade[\s-]?in|เทิร์นเครื่อง|เทรด[\s-]?อิน/i;

/**
 * Drop advice about channels we do not run. Runs after the number gate, on
 * the same sentence split, and reports through the same counter — one number
 * for "sentences the gate cut", which is what the dashboard tile means.
 *
 * Returns null when nothing is left of the summary, exactly like the number
 * gate: an empty answer is worse than the fallback below it.
 */
function dropOffLimitsAdvice(parsed) {
  if (!parsed) return null;
  let cut = 0;
  const clean = (text) => {
    const kept = [];
    for (const sentence of splitSentences(text)) {
      if (OFF_LIMITS_RE.test(sentence)) cut++;
      else kept.push(sentence);
    }
    return kept.join(" ");
  };
  const summary = clean(parsed.summary);
  if (!summary) return null;
  return {
    ...parsed,
    summary,
    detail: clean(parsed.detail || ""),
    excised: (Number(parsed.excised) || 0) + cut,
    offLimitsCut: cut,
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — the three-layer prompt
// ---------------------------------------------------------------------------

/**
 * What the v2 writer may and may not do — three layers, in order of rank.
 *
 * Layer 1 is the v1 rulebook's whole substance, restated: negative, because
 * a positively-phrased rule once made the model invite button-presses, and
 * every number in the context is money someone will quote at the door.
 *
 * Layers 2-3 are what v2 adds: the standard is no longer "restate the numbers
 * correctly" but "answer like the expert who has them". They are positive by
 * nature, so each is phrased to keep the door layer 1 closed — "คิดขั้นถัดไป"
 * is answering from data, never inviting an action; a verdict must carry its
 * checkable reasons; and the red line is the owner's own: the verdict comes
 * from the data, never from what profits the shop — the archive keeps every
 * word as evidence.
 */
function buildV2SystemPrompt(assistantName, lang = "th") {
  const en = lang === "en";
  return [
    // FIRST, ahead of the persona. On /en this used to sit eighty lines down
    // and lose to the Thai around it — see languageDirective for the log that
    // proved it. Empty on Thai, so that path is byte-for-byte unchanged.
    ...languageDirective(lang),
    `คุณคือ${assistantName} ผู้เชี่ยวชาญประเมินราคาของ BKK APPLE ร้านรับซื้ออุปกรณ์ Apple มือสอง`,
    "หน้าที่ของคุณคือตอบคำค้นของลูกค้าในหน้าค้นหา จากข้อมูลจากระบบที่ให้ไว้ด้านล่างเท่านั้น ให้จบในคำตอบเดียว",
    "",
    "ชั้นที่ 1 — ความจริง (ละเมิดไม่ได้ทุกกรณี):",
    "1. ตัวเลขทุกตัวที่พูดถึงต้องมาจาก 'ข้อมูลจากระบบ' เท่านั้น ห้ามคำนวณ ห้ามประมาณ ห้ามปัดเศษเพิ่มเอง — ห้ามนำตัวเลขจากข้อมูลมาบวก ลบ คูณ หาร หรือประกอบเป็นตัวเลขใหม่ แม้ผลลัพธ์จะถูกต้องทางคณิตศาสตร์ ตัวเลขที่ไม่มีอยู่ในข้อมูลคือตัวเลขที่ห้ามพูดถึง — ราคาประเมินตามสภาพ (บรรทัด 'ราคาประเมินเบื้องต้นอยู่ที่ประมาณ') และยอดที่แปลงเป็นบาทแล้ว เป็นตัวเลขสำเร็จที่ระบบคำนวณมาให้ ใช้ตรงๆ เท่านั้น ตำหนิที่ไม่มีบรรทัดราคาประเมินให้ ห้ามประมาณตัวเลขเอง ให้บอกว่าต้องตรวจสภาพจริงก่อนจึงจะทราบยอด",
    "2. ทุกยอดเป็นการประเมินก่อนตรวจเครื่องจริง — ถ้าพูดถึงยอดต้องกำกับว่ายอดสุดท้ายยืนยันหลังตรวจสภาพเครื่อง ห้ามใช้คำว่ารับประกัน การันตี หรือคำที่ฟังเป็นยอดที่ตกลงแล้ว",
    "3. เรื่องแนวโน้มราคาในอนาคต พูดได้เฉพาะจากบรรทัด 'แนวโน้มราคาที่ทีมงานประเมินไว้' — ไม่มีบรรทัดนั้นห้ามคาดการณ์เอง และเมื่อมี: ห้ามทำช่วงให้แคบลงหรือเปลี่ยนเป็นเลขเดี่ยว ห้ามแปลงเปอร์เซ็นต์เป็นบาทเอง (บรรทัด 'คิดเป็นเงินประมาณ' คือค่าที่ระบบแปลงให้แล้ว) และต้องอ้างฐานตามที่บรรทัดนั้นบอกเท่านั้น ห้ามเปลี่ยนไปอ้างยอดอื่น ห้ามตัดคำกำกับความไม่แน่นอนออก — ส่วนบรรทัด 'ความเคลื่อนไหวราคาที่ผ่านมา' คือประวัติจริง ห้ามใช้มันพยากรณ์อนาคต",
    "4. รุ่นที่ระบุว่ายังไม่มีในระบบรับซื้อ ให้บอกตรงๆ ว่ายังไม่มีข้อมูลรุ่นนั้น ห้ามเดาราคา ห้ามบอกว่าเราไม่รับซื้อ ห้ามอ้างเหตุผลที่ข้อมูลไม่ได้บอก (เช่น ยังไม่วางจำหน่าย เลิกผลิต) และห้ามสัญญาว่าจะมีราคาให้เมื่อไหร่ — รุ่นที่ระบุว่างดรับซื้อ ให้บอกตามนั้น ห้ามเสนอราคาให้",
    // The label bug, second half — production, ส.ค. 2569. Every figure in the
    // context is labelled with whose it is; the failure is a number moving
    // out of its own sentence into one with a wider subject. "เรารับซื้อ
    // iPhone ทุกรุ่น ... ที่ราคา 35,000 - 38,000" is the top model's range
    // read as the family's, on a page whose own cards say iPhone 12 is 5,000.
    // exciseUnverifiedNumbers cannot see it: the digits are ours.
    "4.1 ตัวเลขทุกตัวต้องอยู่ในประโยคที่มีประธานเป็นเจ้าของตัวเลขนั้นจริง — เลขของรุ่นเดียว ห้ามวางในประโยคที่พูดถึงตระกูล 'ทุกรุ่น' หรือ 'ตั้งแต่รุ่นเก่า' และช่วงราคารวมของหลายรุ่น ห้ามวางในประโยคที่พูดถึงรุ่นเดียว ถ้าไม่แน่ใจว่าเลขเป็นของใคร ให้ระบุชื่อรุ่นกำกับไว้เสมอ",
    "5. ข้อมูลไม่พอจะตอบส่วนไหน ให้บอกตรงๆ ในประโยคแรกแล้วชี้ว่าหน้าไหนในเว็บน่าจะมี — ห้ามเดา ห้ามเขียนย่อหน้าที่ฟังเหมือนคำตอบโดยไม่มีข้อมูลรองรับ และห้ามถามคำถามกลับไม่ว่ากรณีใด (กล่องนี้ตอบครั้งเดียวจบ การซักถามเป็นหน้าที่ของแชทและฟอร์มประเมิน)",
    "6. ห้ามเอ่ยถึงข้อมูลภายในระบบ (id, ชื่อฟิลด์, ชื่อเครื่องมือ, กลไกการทำงาน) ห้ามเขียนลิงก์หรือ URL ห้ามใช้อีโมจิ — และเกณฑ์การหักราคาตามสภาพเป็นความลับทางการค้าของร้าน: เมื่อลูกค้าระบุตำหนิ บอกได้เฉพาะราคาประเมินที่เขาจะได้รับ ห้ามแจกแจงว่าราคาเต็มเท่าไหร่ หักรายการละเท่าไหร่ หรือคิดเป็นกี่เปอร์เซ็นต์ ไม่ว่าจะคำนวณเองหรืออนุมานจากตัวเลขใดๆ",
    "7. ห้ามใช้ความรู้นอกเหนือจากข้อมูลจากระบบ — ไม่มีราคาตลาด ราคาร้านอื่น สเปก ปีที่วางขาย หรือข่าวใดๆ จากความจำของคุณ ราคาที่บอกคือราคารับซื้อของเรา ไม่ใช่ราคาขายต่อ ห้ามเอาไปเทียบกับราคาที่ลูกค้าขายเองได้ และห้ามแนะนำหรือชวนเทียบกับช่องทางอื่นที่ไม่มีในข้อมูลจากระบบ (เช่น เทิร์นเครื่องกับศูนย์ ร้านอื่น หรือขายเอง) — เราเป็นผู้รับซื้อ ทางเลือกที่เราไม่มีข้อเท็จจริงรองรับ ห้ามเอ่ยถึง",
    "",
    "ชั้นที่ 2 — ความฉลาด (มาตรฐานของคำตอบ):",
    // PRODUCTION, 26 ส.ค. 2569, "ipad a16 256gb แบต 89% ประกันหมด". With the
    // alias finally on the fact line the answer priced the device correctly —
    // and then wrote:
    //
    //   "อย่างไรก็ตาม iPad Generation 11 ใช้ชิป A14 ไม่ใช่ A16
    //    หากคุณมีรุ่นอื่น ลองตรวจสอบชื่อรุ่นให้แน่ใจก่อนครับ"
    //
    // iPad Generation 11 IS the A16 iPad. The model invented A14 out of its
    // own memory and used it to CORRECT the facts it had been handed, which
    // tells a customer holding the exact device we just quoted that they have
    // something else. The same answer opened with "ระบบของเราไม่มีข้อมูล iPad
    // รุ่นที่ใช้ชิป A16" two clauses before pricing that very iPad.
    //
    // Rule 7 already bans outside knowledge, and it was not enough: it reads
    // as a rule about prices and news, and a chip felt to the model like
    // something it simply knew. These two say it about identity, where the
    // failure actually happens.
    "7.1 ข้อมูลจากระบบเป็นเจ้าของความจริงเรื่องรุ่นไหนใช้ชิปอะไร — บรรทัดข้อเท็จจริงเขียนว่า \"(ชิป A16)\" แปลว่ารุ่นนั้นใช้ชิปนั้น ห้ามแย้ง ห้ามแก้ให้เป็นชิปอื่นจากความจำ และห้ามเอ่ยชื่อชิปที่ไม่ปรากฏในข้อมูล ถ้าคุณ \"จำได้\" ว่าเป็นชิปอื่น ให้ถือว่าความจำผิด",
    "7.2 รุ่นที่มีบรรทัดข้อเท็จจริงพร้อมราคา = อยู่ในระบบรับซื้อของเรา ห้ามขึ้นต้นว่าไม่มีรุ่นนั้นหรือไม่มีรุ่นที่ใช้ชิปนั้น แล้วตีราคารุ่นเดียวกันในประโยคถัดไป — ชื่อในวงเล็บนับเป็นชื่อของรุ่นนั้นด้วย คำที่ลูกค้าพิมพ์ตรงกับชื่อในวงเล็บ ก็คือตรงกับรุ่นนั้น",
    "8. ตอบสิ่งที่ถามให้ตรงก่อน แล้วคิดขั้นถัดไปแทนลูกค้า — สิ่งที่เขาควรรู้ก่อนตัดสินใจ (แนวโน้ม จังหวะ ทางเลือก) เท่าที่ข้อมูลจากระบบมี 'คิดขั้นถัดไป' คือการเล่าข้อเท็จจริงเพิ่ม ไม่ใช่การชวนให้ทำอะไร",
    "9. เมื่อข้อมูลเอื้อ ให้เทียบทางเลือกด้วยเลขจริงประกอบ — รุ่นข้างเคียงในตระกูล ขายตอนนี้กับรอ — เทียบเฉพาะจากบรรทัดที่ระบบให้มา",
    "10. เชื่อมข้อมูลข้ามก้อนให้เป็นภาพเดียว — ราคาปัจจุบัน + ความเคลื่อนไหวที่ผ่านมา + แนวโน้มที่ทีมงานประเมิน คือภาพที่ลูกค้าเห็นเองไม่ได้ หน้าที่คุณคือประกอบมัน",
    "11. มาตรฐานคือ อ่านจบแล้วตัดสินใจได้เลยโดยไม่ต้องไปถามต่อ — ไม่ใช่ความยาว แต่คือความครบของเหตุผล",
    "",
    "ชั้นที่ 3 — การตัดสินใจ:",
    "12. เมื่อข้อมูลชี้ชัด ให้ฟันธง — ห้ามหนีด้วย 'ขึ้นอยู่กับคุณ' หรือ 'แล้วแต่สถานการณ์' ทั้งที่ข้อมูลตรงหน้าชี้ทางแล้ว",
    "13. ทุกคำฟันธงต้องพกเหตุผลที่ตรวจสอบได้จากข้อมูลจากระบบ (ราคาเท่าไหร่ แนวโน้มเท่าไหร่ ส่วนต่างที่เสี่ยงคือเท่าไหร่)",
    "14. ข้อมูลก้ำกึ่ง ให้บอกตรงๆ ว่าก้ำกึ่งตรงไหน และอะไรจะทำให้ชัดขึ้น — ความก้ำกึ่งที่บอกตรงๆ คือคำตอบที่ดี ไม่ใช่ความล้มเหลว",
    "15. เส้นแดง: ฟันธงจากข้อมูลเท่านั้น ห้ามฟันธงจากผลประโยชน์ของร้าน — วันที่ข้อมูลบอกว่า 'รอ' ให้พูดว่ารอ",
    `16. น้ำเสียง: ผู้เชี่ยวชาญหน้างานจริง ${en ? "ภาษาอังกฤษธรรมชาติ" : "ภาษาไทยธรรมชาติ"} มั่นใจแบบมีหลักฐาน ไม่เร่งเร้า ไม่ขายของ`,
    "",
    "รูปแบบคำตอบ: ตอบเป็น JSON เท่านั้น ไม่ต้องมีข้อความอื่นนอก JSON",
    '{"summary": "...", "detail": "...", "primary_model_id": "..."}',
    // NO HIGHLIGHT FIELD. Three mechanisms asked the writer to hand the span
    // over separately and all three lost it on the way: naming the phrase
    // before writing (5 highlights in 77 answers, 69 rejected for not matching
    // the prose character for character), copying it out afterwards (0 in 4),
    // and sending the sentence's NUMBER (marked the whole answer, or nothing —
    // Thai separates sentences with spaces, so splitSentences sees one chunk).
    //
    // Marking in place removes the handover. The span is a substring of the
    // answer because it was never lifted out of it; extractMarkedSpans pulls
    // the marked text and strips every marker at parse time, so what reaches
    // the website is the same wire format as before — literal substrings —
    // and nothing downstream moves.
    "- ใจความสำคัญ: ครอบข้อความช่วงที่สำคัญที่สุด **ในเนื้อความเลย** ด้วยเครื่องหมาย \u00ab \u00bb เช่น \u00abiPhone 17 Pro Max อยู่ที่ 35,000 - 38,000 บาท\u00bb — ไม่ต้องพิมพ์ซ้ำที่ไหน ไม่ต้องนับประโยค ระบบจะดึงช่วงนั้นออกมาเองแล้วลบเครื่องหมายทิ้งก่อนแสดงผล",
    "- ครอบ 1 ช่วงต่อคำตอบ (สองช่วงเฉพาะคำตอบที่ยาวจริงๆ) และต้องเป็นช่วงสั้นๆ ไม่ใช่ทั้งย่อหน้า — ย่อหน้าที่ถูกเน้นเกือบทั้งย่อหน้า เท่ากับไม่ได้เน้นอะไรเลย",
    "- ห้ามใช้เครื่องหมาย \u00ab \u00bb เพื่อจุดประสงค์อื่นเด็ดขาด ห้ามใช้เป็นอัญประกาศ",
    // THE SPAN MUST NAME THE DEVICE. Reported 23 ส.ค. 2569: on "iPhone 11
    // 128GB แบต 78% ขายได้ไหม" the sentence read "ขายได้ครับ iPhone 11 128GB
    // แบตเตอรี่ 78% ประเมินราคาที่ 2,000 บาท" and only "ประเมินราคาที่ 2,000
    // บาท" came out marked. Every word of that is true and the highlight is
    // still the wrong shape: the customer reads the marked span first and it
    // does not say WHOSE 2,000 baht it is — on a page listing several nearby
    // models (iPhone 11 at 2,500 sat directly beneath it), a figure with no
    // device attached is the M1-range failure in miniature.
    //
    // "must stand on its own, subject and substance" was already here and did
    // not produce it, so the rule stops being a standard to judge against and
    // becomes a mechanical one: start at the model name, end at the figure.
    // A rule with two endpoints can be followed without taste.
    "- ถ้าคำตอบมีตัวเลขราคา: ช่วงที่ครอบต้อง**เริ่มที่ชื่อรุ่น** (พร้อมความจุถ้าคำตอบระบุไว้) และ**จบที่ตัวเลขราคา** เช่น \u00abiPhone 11 128GB ประเมินราคาที่ 2,000 บาท\u00bb",
    "- ห้ามครอบเฉพาะท่อนราคาโดยไม่มีชื่อรุ่นอยู่ในช่วง (เช่น \u00abประเมินราคาที่ 2,000 บาท\u00bb ผิด) — คนอ่านช่วงที่ถูกเน้นก่อนอย่างอื่น ถ้าไม่มีชื่อรุ่นอยู่ในนั้น เขาจะไม่รู้ว่าเป็นราคาของเครื่องไหน",
    "- ช่วงที่ครอบต้องยืนเองได้ มีประธานและสาระครบ ไม่ใช่ตัวเลขลอยๆ — น้อยแต่คมดีกว่าครบแต่ลาย",
    "- ลำดับความสำคัญ: ช่วงที่ตอบคำถามของคำค้นนี้ มาก่อนช่วงที่บอกข้อเท็จจริงที่มีผลต่อการตัดสินใจตอนนี้ (แนวโน้ม จังหวะ)",
    "- วิธีเลือก: อ่านสิ่งที่เพิ่งเขียนอีกครั้ง ช่วงไหนคือคำตอบของคำถามนี้ที่สุด ครอบช่วงนั้น",
    // The escape hatch was too wide: "a short answer may use []" reads as
    // permission to skip, and most answers took it. The floor is now tied to
    // what the answer CONTAINS, not to how long it is.
    "- คำตอบที่มีตัวเลขราคา หรือมีคำฟันธง ต้องครอบอย่างน้อย 1 ช่วงเสมอ — ไม่ครอบเลยได้เฉพาะคำตอบที่เป็นการชี้ทางล้วนๆ ไม่มีทั้งตัวเลขและคำฟันธง",
    "- primary_model_id = รหัสจากรายการ 'รหัสรุ่นสำหรับ field primary_model_id' ท้ายข้อมูล ของรุ่นที่คำตอบชูเป็นหลัก — คำตอบไม่ได้ชูรุ่นใดรุ่นหนึ่ง หรือไม่มีรายการรหัส: ใส่ null",
    "- summary = ย่อหน้าเดียว 2-3 ประโยค ตอบคำถามให้ตรงที่สุด พร้อมตัวเลขจริง และคำฟันธงถ้าข้อมูลชี้ชัด",
    "- detail = ส่วนขยาย (รายรุ่น เหตุผลของคำฟันธง เงื่อนไขที่ทำให้ราคาต่างกัน ทางเลือกเทียบ) — กระชับ: ไม่เกินราว 6 ประโยค เลือกเฉพาะที่ช่วยตัดสินใจจริง ห้ามทวนซ้ำสิ่งที่อยู่ใน summary แล้ว ถ้าไม่มีอะไรจะขยายให้ใส่ค่าว่าง",
    // Same two closing bans as v1, verbatim in spirit: the website renders the
    // real button, and an invitation written in text is the same instruction
    // twice — once from a thing that can be pressed and once from one that
    // cannot. Layer 2's positive rules must never reopen this door.
    "- ห้ามเขียนชวนให้กดประเมินราคาหรือกดปุ่มใดๆ ปิดท้าย เว็บมีปุ่มให้อยู่แล้ว",
    "- ห้ามใส่ลิงก์ URL หรือชื่อปุ่มลงในคำตอบ",
    // The one line the customer's own language decides. Everything above
    // stays Thai: these are instructions TO the model, not its output.
    ...languageLines(lang),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Stage 2 — the context, every number computed by code
// ---------------------------------------------------------------------------

// MIRROR of the pricing resolver used by chat-ai.js and /sell (CLAUDE.md
// invariant #8): pct (% of base) > deduct (flat baht) > legacy tier buckets.
// Kept here rather than required from chat-ai.js — see the note on
// resolveOptionDeduction's export there; this module must stay loadable by
// the offline tests without pulling chat-ai's firebase-admin imports.
function tierDeduction(opt, basePrice) {
  const b = Number(basePrice) || 0;
  if (b >= 30000) return Number((opt && opt.t1) || 0);
  if (b >= 15000) return Number((opt && opt.t2) || 0);
  return Number((opt && opt.t3) || 0);
}

function resolveOptionDeduction(opt, basePrice, liquidityFactor) {
  const lfn = Number(liquidityFactor);
  const lf = lfn > 0 ? lfn : 1;
  if (opt && opt.pct != null && Number.isFinite(Number(opt.pct)) && Number(opt.pct) >= 0) {
    return Math.round((((Number(basePrice) || 0) * Number(opt.pct)) / 100) * lf);
  }
  if (opt && opt.deduct != null && Number.isFinite(Number(opt.deduct)) && Number(opt.deduct) >= 0) {
    return Math.round(Number(opt.deduct) * lf);
  }
  return Math.round(tierDeduction(opt, basePrice) * lf);
}

function resolveFinalPrice(basePrice, totalDeduction) {
  return Math.max(0, (Number(basePrice) || 0) - (Number(totalDeduction) || 0));
}

// ---------------------------------------------------------------------------
// quotePolicy — MIRROR of bkk-frontend-next/functions/src/quotePolicy.ts
//
// The source of truth is that file: it is what `priceCart` runs, so it is what
// the customer is actually paid. This copy exists because the two live in
// different repositories and different languages; `scripts/quote-policy-parity.mjs`
// over there runs BOTH against one set of fixtures and diffs the result, which
// is the only reason a hand-kept mirror is allowed here at all (same
// arrangement as buildPublicTrack / PUBLIC_TRACK_FIELDS_MIRROR).
//
// CHANGE ONE, CHANGE BOTH, THEN RUN THE HARNESS. A drift here does not throw:
// it quotes a number on the search page that the cart will not honour, which
// is the single failure this whole feature exists to avoid.
//
// The one adaptation: this payload's groups and options carry no ids (the
// website strips them — see toConditionSet), so ids are POSITIONAL, "0", "1",
// "2" by index. The algorithm is otherwise line-for-line the original.
// ---------------------------------------------------------------------------

const policyOptionsOf = (group) =>
  (Array.isArray(group && group.options) ? group.options : []).filter((o) => o && o.id != null);

const policyTitleOf = (group) => String((group && (group.title || group.name || group.id)) || "");

const policyLabelOf = (opt) => String((opt && (opt.label || opt.name)) || "");

/** Give every group and option a positional id, so the mirror can run the
 *  id-based algorithm on an id-less payload. */
function withPositionalIds(groups) {
  return (Array.isArray(groups) ? groups : []).map((g, gi) => ({
    ...g,
    id: String(gi),
    options: (Array.isArray(g && g.options) ? g.options : []).map((o, oi) => ({
      ...o,
      id: String(oi),
    })),
  }));
}

/** MIRROR of quotePolicy.deductionOf — itself a mirror of calculateDeductAmount.
 *  Used only to RANK options when choosing the best case, so a drift here
 *  cannot change a price, only which option gets assumed. */
function policyDeductionOf(opt, basePrice, liquidityFactor) {
  return resolveOptionDeduction(opt, basePrice, liquidityFactor);
}

/** MIRROR of quotePolicy.batteryOptionRange. */
function batteryOptionRange(label) {
  const str_ = String(label || "");
  const nums = (str_.match(/\d+/g) || []).map(Number);
  if (nums.length === 0) return null;
  if (/ขึ้นไป|มากกว่า|>=|ขึ้น/.test(str_)) return { min: nums[0], max: Infinity };
  if (/ต่ำกว่า|น้อยกว่า|below|under|</i.test(str_)) return { min: 0, max: nums[0] - 1 };
  if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
  return { min: nums[0], max: nums[0] };
}

/** MIRROR of quotePolicy.pickBatteryOptionId. */
function pickBatteryOptionId(options, pct) {
  // `Number(null)` is 0, and 0 is finite — so a caller passing null for "the
  // customer said nothing" used to land inside the "below 80%" bucket and
  // deduct for a worn battery nobody mentioned. Found by a test on the search
  // path, where the extraction reports an absent percentage as exactly null.
  if (pct == null || pct === "") return null;
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0) return null;
  for (const o of options || []) {
    if (!o || o.id == null) continue;
    const r = batteryOptionRange(o.label || o.name);
    if (r && p >= r.min && p <= r.max) return String(o.id);
  }
  if (p < 80) {
    for (const o of options || []) {
      if (!o || o.id == null) continue;
      if (/เสื่อม|เปลี่ยนแบต|แบตต่ำ|แบตแย่|service/i.test(policyLabelOf(o))) return String(o.id);
    }
  }
  return null;
}

/**
 * MIRROR of `refusalClassOf` in
 * bkk-frontend-next/app/utils/conditionGrade.ts — which is where the rule
 * lives, because /sell's own summary card decides the customer's verdict with
 * it.
 *
 * A `failBehavior: 'reject'` answer means the device FAILED SCREENING, not
 * that the shop walks away:
 *
 *   no_buy — will not power on, or iCloud/MDM locked. Nothing to offer.
 *   as_is  — everything else: a dead camera, a third-party screen, an
 *            out-of-centre repair. THE SHOP STILL BUYS THESE, as-is at
 *            roughly 10-20% of base with an admin confirming. Measured on the
 *            live sets (ส.ค. 2569): ~790 of ~966 reject options.
 *
 * The first cut of this file refused all 966 the same way, with copy that
 * said we only buy fully working devices. For the 790 that is not true, it
 * contradicts /sell and the /corporate page, and it fails in the direction no
 * metric shows: the customer closes the tab instead of seeing the offer they
 * would have been made.
 *
 * `scripts/quote-policy-parity.mjs` over there compares the two regex sources
 * character for character.
 */
const REJECT_NO_BUY_RE = /เปิดไม่ติด|ไม่สามารถเปิดเครื่อง|icloud|mdm/i;
const REJECT_NO_BUY_GROUP_RE = /เปิดเครื่อง/;

/**
 * THE NAME PLUS THE CHIP, WHEN THE NAME CANNOT SUPPLY IT.
 *
 * Production, 26 ส.ค. 2569, "ipad a16 128gb". The answer named the device and
 * quoted its price in the same sentence as denying we sell it:
 *
 *   "...แต่ในระบบรับซื้อของเราไม่มี iPad รุ่นไหนที่ใช้ชิป A16 เลย — รุ่นที่เรา
 *    รับซื้อ 128GB ได้คือ iPad Generation 11 (ประเมินราคา 8,000 - 10,000 บาท)"
 *
 * `iPad Generation 11` IS the A16 iPad. The alias is the only thing that says
 * so, and while stage 1 has always read it (`id | name | alias`), the writer's
 * fact list rendered `- ${name}: ...` and nothing else. It denied having a
 * device it was pricing on the next clause, which is the correct reading of
 * the facts it was handed.
 *
 * THE CHIP DESIGNATOR ONLY, not the whole alias. Most aliases are Thai
 * transliterations of the name ("iPhone 15 Pro Max" -> "ไอโฟน 15 โปรแม็กซ์"),
 * and appending those to every fact line is a per-search token bill for
 * something the writer already knows. A chip the name never states is the one
 * thing missing, and it is exactly what went wrong.
 */
function factLabel(model) {
  const name = String((model && model.name) || "");
  const chips = [];
  for (const part of String((model && model.alias) || "").split("/")) {
    const m = part.trim().match(/\b([MA]\d+(?:\s+(?:Pro|Max|Ultra))?)\b/i);
    if (m && !name.toLowerCase().includes(m[1].toLowerCase()) && !chips.includes(m[1])) {
      chips.push(m[1]);
    }
  }
  return chips.length ? `${name} (ชิป ${chips.join(" / ")})` : name;
}

function refusalClassOf(groupTitle, optionLabel) {
  return REJECT_NO_BUY_RE.test(String(optionLabel || "")) ||
    REJECT_NO_BUY_GROUP_RE.test(String(groupTitle || ""))
    ? "no_buy"
    : "as_is";
}

/** MIRROR of quotePolicy.findBatteryGroup. */
function findBatteryGroup(groups) {
  for (const g of groups || []) {
    if (/แบต|battery/i.test(policyTitleOf(g))) return g;
  }
  return null;
}

/** MIRROR of quotePolicy.resolveConditions. */
function resolveConditions(input) {
  const groups = (Array.isArray(input.groups) ? input.groups : []).filter(
    (g) => g && g.id != null
  );
  const basePrice = Number(input.basePrice) || 0;
  const lf = input.liquidityFactor;
  const acceptDefective = input.acceptDefective === true;

  const answers = { ...(input.answers || {}) };

  const batteryGroup = findBatteryGroup(groups);
  if (batteryGroup) {
    const picked = pickBatteryOptionId(policyOptionsOf(batteryGroup), input.batteryPct);
    if (picked != null) answers[String(batteryGroup.id)] = picked;
  }

  const resolved = [];
  const assumedGroups = [];
  let declined = null;

  for (const group of groups) {
    const groupId = String(group.id);
    const options = policyOptionsOf(group);
    if (options.length === 0) continue;

    const answeredId = answers[groupId];
    let option =
      answeredId != null ? options.find((o) => String(o.id) === String(answeredId)) : undefined;
    let assumed = false;

    if (!option) {
      const pickable = options.filter((o) => o.failBehavior !== "reject" && o.defect !== true);
      const pool = pickable.length > 0 ? pickable : options;
      option = pool.reduce((best, o) =>
        policyDeductionOf(o, basePrice, lf) < policyDeductionOf(best, basePrice, lf) ? o : best
      );
      assumed = true;
      assumedGroups.push(policyTitleOf(group));
      answers[groupId] = String(option.id);
    }

    if (!assumed && option.defect === true && !acceptDefective && !declined) {
      declined = {
        groupId,
        groupTitle: policyTitleOf(group),
        optionLabel: policyLabelOf(option),
      };
    }

    resolved.push({
      groupId,
      groupTitle: policyTitleOf(group),
      option,
      assumed,
    });
  }

  return { answers, resolved, assumedGroups, declined };
}

const span = (min, max) => (max > min ? `${baht(min)} - ${baht(max)} บาท` : `${baht(max)} บาท`);

/** The price range one chosen model answers with, honouring a named
 *  capacity. No fallback to the model range when the capacity is missing —
 *  same rule as the website's priceRange: report the absence instead. */
function modelPrice(model, capacity) {
  if (model.paused) return { paused: true };
  if (capacity && model.capacities && model.capacities.length) {
    const rung = model.capacities.find((c) => c.name === capacity);
    if (!rung) {
      return { capacityUnavailable: true, available: model.capacities.map((c) => c.name) };
    }
    return { min: rung.min, max: rung.max, capacity };
  }
  return { min: model.min, max: model.max };
}

function familyOf(model) {
  return model.family || familyOfCategory(model.category);
}

/** Which market facts may speak here: unexpired, and applying to a family in
 *  play (a chosen model's, stage 1's, or `all` when the question is a
 *  forecast or a device question at all). A junk query has none of those, so
 *  a general fact cannot make "asdfgh" answerable. */
function applicableMarketFacts(ingredients, extraction, now = Date.now()) {
  const families = new Set();
  for (const id of extraction.models) {
    const m = ingredients.models.find((x) => x.id === id);
    const fam = m && familyOf(m);
    if (fam) families.add(fam);
  }
  if (extraction.family) families.add(extraction.family);
  const allOk = families.size > 0 || extraction.intent === "forecast";
  return ingredients.marketFacts.filter((f) => {
    if (!(f.expiresAt > now)) return false;
    if (f.appliesTo === "all") return allOk;
    return families.has(f.appliesTo);
  });
}

/** Is there anything at all a paragraph could be written from? The caller
 *  turns false into {skipped:"nothing_to_write"} without paying for stage 3.
 *  A picked condition counts even with no model: "จอแตกรับซื้อไหม" has a real
 *  answer (yes, and here is what moves the price) before a model is named. */
/**
 * WHEN STAGE 1 MISSES A DEVICE THE PAGE IS ALREADY SHOWING.
 *
 * Stage 1 reading the raw query against the whole catalog is what lets it
 * name a model the local matcher missed — the design goal. It fails the other
 * way too, and that failure is the loud one. Production, 22 ส.ค. 2569:
 *
 *   q = "MacBook Air M4 256GB"
 *   stage 1 -> models: [], unknownModels: ["MacBook Air M4"]
 *   the page -> cards for MacBook Air 15" (ชิป M4, 2025) ฿33,000
 *                     and MacBook Air 13" (ชิป M4, 2025) ฿29,000
 *
 * and the answer opened with "ยังไม่มีข้อมูลรุ่น MacBook Air M4 ในระบบรับซื้อ
 * ของเรา" printed above them. A sentence that contradicts the cards under it
 * does not merely look wrong: it turns a customer away from a device the shop
 * is buying today.
 *
 * The recovery is narrow on purpose, and every condition earns its place:
 *
 *   stage 1 named NO model      — one it did name is a real answer, and an
 *                                 absence line beside it ("iPhone 20 Ultra
 *                                 กับ iPhone 15 อันไหนดี") is true and useful.
 *   it DID claim an absence     — nothing to correct otherwise.
 *   the matcher has priced hits — the contradiction is only a contradiction
 *                                 when the page can actually show a price.
 *                                 "iPhone 20 Ultra" alone matched no priced
 *                                 model, so it keeps its absence line.
 *
 * What comes back is a corrected extraction, applied ONCE at the top so the
 * context, the answerability gate and the primary-model legend all read the
 * same thing. Recovery drops the unknown names: the words the customer typed
 * describe a device we do sell, and no part of the answer should say
 * otherwise.
 */
function recoverMatchedModels(ingredients, extraction) {
  if (!extraction || extraction.models.length || !extraction.unknownModels.length) return extraction;
  const priced = (ingredients.matchedIds || [])
    .map((id) => ingredients.models.find((m) => m.id === id))
    .filter((m) => m && !m.paused && m.max > 0)
    .slice(0, MODEL_PICK_LIMIT);
  if (!priced.length) return extraction;
  return { ...extraction, models: priced.map((m) => m.id), unknownModels: [], recovered: true };
}

function hasAnythingToWrite(ingredients, extraction, now = Date.now()) {
  return (
    extraction.models.length > 0 ||
    extraction.conditions.length > 0 ||
    extraction.topics.length > 0 ||
    extraction.unknownModels.length > 0 ||
    (extraction.intent === "family_overview" && !!extraction.family) ||
    applicableMarketFacts(ingredients, extraction, now).length > 0 ||
    ingredients.pages.length > 0
  );
}

function priceSection(chosen, capacity, excludeIds = new Set()) {
  // Models whose condition-adjusted estimate is in the context lose their
  // base-price line ON PURPOSE: with both endpoints on the page the model
  // (or a competitor) just narrates the subtraction, and the deduction table
  // is exactly the secret this split protects.
  const listed = chosen.filter((m) => !excludeIds.has(m.id));
  if (!listed.length) return "";
  const lines = ["ราคารับซื้อของเรา (ตัวเลขทั้งหมดนี้คือข้อมูลจริงจากระบบ):"];
  for (const m of listed) {
    const p = modelPrice(m, capacity);
    if (p.paused) {
      lines.push(`- ${factLabel(m)}: ตอนนี้งดรับซื้อชั่วคราว${m.pausedMessage ? ` (${m.pausedMessage})` : ""}`);
      continue;
    }
    if (p.capacityUnavailable) {
      const have = p.available && p.available.length ? ` (ความจุที่เรารับซื้อ: ${p.available.join(", ")})` : "";
      lines.push(`- ${factLabel(m)}: ไม่มีความจุ ${capacity} ในรายการรับซื้อของรุ่นนี้${have}`);
      continue;
    }
    if (!(p.max > 0)) continue;
    const spread = p.capacity ? "ปรับตามสภาพจริงตอนตรวจ" : "ต่างกันตามความจุและสภาพ";
    const label = p.capacity ? `${factLabel(m)} ความจุ ${p.capacity}` : factLabel(m);
    lines.push(
      p.min > 0 && p.max > p.min
        ? `- ${label}: ${baht(p.min)} - ${baht(p.max)} บาท (${spread})`
        : `- ${label}: สูงสุด ${baht(p.max)} บาท (${spread})`
    );
    if (!p.capacity && m.capacities && m.capacities.length >= 2) {
      const rungs = m.capacities
        .filter((c) => c.max > 0)
        .map((c) => (c.max > c.min ? `${c.name} = ${baht(c.min)} - ${baht(c.max)} บาท` : `${c.name} = ${baht(c.max)} บาท`))
        .join(" | ");
      if (rungs) lines.push(`  ราคาแยกตามความจุของ ${m.name}: ${rungs}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/** Would another answer in this group have cost the customer more? That is
 *  what makes an assumption worth stating out loud. */
function assumptionCouldCostMore(row, resolvedForModel, liquidityFactor) {
  // Read off the SET, not off the resolver's row: `resolveConditions` is a
  // mirror of quotePolicy and its return shape has to stay identical to the
  // original's, or the parity harness is comparing two different contracts.
  const group = (resolvedForModel.groups || []).find((g) => String(g.id) === row.groupId);
  if (!group) return false;
  const base = resolvedForModel.baseMax;
  const chosen = resolveOptionDeduction(row.option, base, liquidityFactor);
  for (const opt of group.options || []) {
    if (resolveOptionDeduction(opt, base, liquidityFactor) > chosen) return true;
  }
  return false;
}

/**
 * NET ONLY — the deduction arithmetic is a trade secret.
 *
 * The first cut of this section printed the full worksheet ("จอแตก หักประมาณ
 * 6,000 - 6,400 → เหลือ..."), which /sell has never done: the site's own
 * quoting flow shows a customer ONLY what they would receive, because a
 * public per-defect deduction table is a price list for competitors to
 * undercut line by line. So this section now speaks the way /sell does — the
 * condition named (the customer's own words) and the resulting estimate,
 * never the delta and never the pre-deduction figure.
 *
 * The deductions are still COMPUTED exactly as before; they are just not
 * written into the context. That absence is itself a wall: the excision gate
 * cuts any sentence whose numbers the context cannot vouch for, so a model
 * that derives the delta on its own cannot get it past the door.
 *
 * Returns { text, coveredIds } — the caller hides the covered models' base
 * price lines too, or the model narrates the subtraction in words.
 */
/**
 * The answers, resolved against ONE model's own condition set.
 *
 * Everything the price depends on is decided here rather than by the writer:
 * which option each group sits at (including the groups nobody mentioned),
 * which battery bucket a stated percentage falls in, and whether the answers
 * add up to a device the shop does not buy. Returns null when this model
 * cannot be quoted at all.
 */
function resolveModelConditions(model, ingredients, extraction) {
  const set = ingredients.conditionSets[model.conditionSetId];
  if (!set || !Array.isArray(set.groups) || !set.groups.length) return null;
  const p = modelPrice(model, extraction.capacity);
  if (p.paused || p.capacityUnavailable || !(p.max > 0)) return null;

  const groups = withPositionalIds(set.groups);
  const answers = {};
  const stated = new Set();
  for (const cid of extraction.conditions) {
    // Cross-set resolution — the cid names a concept, this model prices it
    // from its OWN set. See resolveConditionForSet.
    const hit = resolveConditionForSet(cid, ingredients, { groups });
    if (!hit) continue;
    const gid = String(hit.group.id);
    if (answers[gid] != null) continue; // first pick per group wins
    answers[gid] = String(hit.option.id);
    stated.add(gid);
  }

  const baseMin = p.min > 0 ? p.min : p.max;
  const baseMax = p.max;
  // Resolved ONCE, at the top of the span. Percentage options rank differently
  // at different prices, and resolving separately at each end could assume a
  // different option at the floor than at the ceiling — one device with two
  // stories. The chosen options are then priced at BOTH ends below, which is
  // where the span comes from.
  const resolved = resolveConditions({
    groups,
    answers,
    basePrice: baseMax,
    liquidityFactor: model.liquidityFactor,
    acceptDefective: ingredients.acceptDefective === true,
    batteryPct: extraction.batteryPct,
  });
  // A battery bucket chosen from a stated percentage is the customer's own
  // answer, not an assumption — resolveConditions writes it into `answers`
  // before the fill pass, so it already reads as stated; this records it for
  // the caller's own accounting.
  if (extraction.batteryPct != null) {
    for (const row of resolved.resolved) {
      if (!row.assumed && answers[row.groupId] == null) stated.add(row.groupId);
    }
  }
  // What the OVERVIEW must refuse to price.
  //
  // `declined` is quotePolicy's own verdict and means exactly one thing —
  // a defect answer while the shop is not accepting defective devices — and
  // it stays that way, because the mirror has to keep mirroring.
  //
  // A `failBehavior: 'reject'` answer is the second case, and it is where the
  // two channels legitimately differ: the assessment pipeline treats it as
  // SALVAGE (priced at 0, tagged for an admin to call back), because a human
  // is about to look at the device. A search page has no such human. It would
  // print a number for a dead screen — the reject option deducts 0 baht, so
  // the arithmetic comes out at the healthy price — and the customer would
  // arrive at the door quoting it. So here it is a refusal, exactly as it is
  // in the chat (chat-ai.js: declined_defect).
  let refused = resolved.declined
    ? { ...resolved.declined, refusalClass: "no_buy" }
    : null;
  if (!refused) {
    for (const row of resolved.resolved) {
      if (!row.assumed && row.option.failBehavior === "reject") {
        const groupTitle = row.groupTitle;
        const optionLabel = policyLabelOf(row.option);
        refused = {
          groupId: row.groupId,
          groupTitle,
          optionLabel,
          refusalClass: refusalClassOf(groupTitle, optionLabel),
        };
        break;
      }
    }
  }
  return { ...resolved, refused, stated, groups, baseMin, baseMax, price: p };
}

/**
 * NET ONLY — the deduction arithmetic is a trade secret.
 *
 * The first cut of this section printed the full worksheet ("จอแตก หักประมาณ
 * 6,000 - 6,400 → เหลือ..."), which /sell has never done: the site's own
 * quoting flow shows a customer ONLY what they would receive, because a
 * public per-defect deduction table is a price list for competitors to
 * undercut line by line. So this section speaks the way /sell does — the
 * condition named (the customer's own words) and the resulting estimate,
 * never the delta and never the pre-deduction figure.
 *
 * TWO THINGS CHANGED WHEN THE ESTIMATE BECAME A REAL QUOTE:
 *
 *   - groups nobody answered are no longer skipped. Skipping them prices the
 *     device as if their best case were free, and on a set whose cheapest
 *     option still deducts (a warranty group, typically) that is a figure
 *     above what the shop will pay. They are filled with the best case and
 *     SAID OUT LOUD, because an assumption the customer cannot see is one
 *     they will argue with at the door.
 *   - an answer that means "we do not buy this" produces a refusal and NO
 *     number at all. A reject option deducts 0 baht, so before this the
 *     section happily quoted the healthy price for a dead screen.
 *
 * Returns { text, coveredIds } — the caller hides the covered models' base
 * price lines too, or the model narrates the subtraction in words.
 */
function deductionSection(chosen, ingredients, extraction) {
  if (!extraction.conditions.length && extraction.batteryPct == null) {
    return { text: "", coveredIds: new Set() };
  }
  const lines = [];
  /** Will not power on / locked — nothing to offer. */
  const noBuy = [];
  /** Failed screening but STILL BOUGHT as-is, with a person confirming the
   *  offer. The large majority of reject answers land here. */
  const asIs = [];
  const coveredIds = new Set();
  for (const m of chosen) {
    if (m.paused || !m.conditionSetId) continue;
    const r = resolveModelConditions(m, ingredients, extraction);
    if (!r) continue;
    const name = r.price.capacity ? `${m.name} ความจุ ${r.price.capacity}` : m.name;

    if (r.refused) {
      // No figure either way, and the base price line goes too: a price
      // printed beside a refusal is the refusal being ignored.
      coveredIds.add(m.id);
      const said = `${r.refused.groupTitle}: ${r.refused.optionLabel}`;
      if (r.refused.refusalClass === "no_buy") noBuy.push(`- ${name}: สภาพที่ลูกค้าบอก (${said})`);
      else asIs.push(`- ${name}: สภาพที่ลูกค้าบอก (${said})`);
      continue;
    }

    // NOTHING the customer said applies to THIS model's set — cross-set
    // resolution widened the address, it did not invent an option. Quoting an
    // estimate here would price the device as if the defect they told us
    // about had never been mentioned, which is the systematically-too-high
    // answer this whole section exists to avoid. It keeps its ordinary price
    // line instead (it is not in coveredIds).
    if (r.stated.size === 0) continue;

    const statedLabels = [];
    const assumedLabels = [];
    let totalMin = 0;
    let totalMax = 0;
    for (const row of r.resolved) {
      const dLow = resolveOptionDeduction(row.option, r.baseMin, m.liquidityFactor);
      const dHigh = resolveOptionDeduction(row.option, r.baseMax, m.liquidityFactor);
      totalMin += Math.min(dLow, dHigh);
      totalMax += Math.max(dLow, dHigh);
      const label = policyLabelOf(row.option);
      if (!label) continue;
      if (row.assumed) {
        // Named when a DIFFERENT answer in that group would have cost the
        // customer more — not when the assumed option itself deducts. The
        // best case is usually 0 baht, and it is precisely those groups where
        // being wrong is expensive: "we assumed your warranty is intact" is
        // worth saying exactly because the other answer is -1,200.
        if (assumptionCouldCostMore(row, r, m.liquidityFactor)) {
          assumedLabels.push(`${row.groupTitle}: ${label}`);
        }
      } else if (r.stated.has(row.groupId)) {
        statedLabels.push(label);
      }
    }
    if (!statedLabels.length && !assumedLabels.length && totalMax === 0) continue;

    coveredIds.add(m.id);
    const said = statedLabels.length ? ` (สภาพที่ระบุ: ${statedLabels.join(", ")})` : "";
    lines.push(
      `- ${name}${said}: ราคาประเมินเบื้องต้นอยู่ที่ประมาณ ${span(
        resolveFinalPrice(r.baseMin, totalMax),
        resolveFinalPrice(r.baseMax, totalMin)
      )}`
    );
    if (assumedLabels.length) {
      // The WORD matters, not just the fact. This line is where the writer
      // gets its vocabulary, and the first version handed it "สมมติ" — which
      // it dutifully echoed to customers as "โดยสมมติว่าจอและตัวเครื่อง
      // สมบูรณ์". In spoken Thai that word carries "we made this up", which
      // is the one thing the estimate is not: every unanswered group is
      // filled with the best-case option of a real condition set, and the
      // figure is computed from it. Naming the condition the price was
      // computed FROM says the same true thing without inviting the customer
      // to discount the number as guesswork.
      lines.push(
        `  ส่วนที่ลูกค้ายังไม่ได้บอก ระบบประเมินตามสภาพปกติไว้แล้ว: ${assumedLabels.join(", ")} ` +
          `— ต้องบอกลูกค้าตรงๆ ด้วยรูปประโยค "ราคานี้คิดจากสภาพ: ..." ` +
          `ห้ามใช้คำว่า "สมมติ" ` +
          `ถ้าสภาพจริงต่างจากนี้ราคาปรับตามการตรวจจริง`
      );
    }
  }

  const blocks = [];
  if (lines.length) {
    blocks.push(
      [
        "ราคาประเมินตามสภาพที่ลูกค้าระบุ (คำนวณจากเกณฑ์ประเมินจริงของรุ่นนั้น — ตัวเลขนี้คือยอดที่ลูกค้าจะได้รับ):",
        ...lines,
        "เป็นการประเมินเบื้องต้น ยอดสุดท้ายยืนยันหลังตรวจสภาพเครื่องจริง",
      ].join("\n")
    );
  }
  if (asIs.length) {
    // NOT a closed door. The shop buys these as-is at roughly 10-20% of base
    // with an admin confirming — /sell says so and /corporate promises it in
    // writing. What this page cannot do is put a figure on it: it knows one
    // sentence the customer typed, and the range /sell shows comes only after
    // every question has been answered.
    blocks.push(
      [
        "เครื่องที่มีอาการแบบนี้ ยังรับซื้อ แต่ประเมินราคาจากหน้านี้ไม่ได้ (ห้ามบอกตัวเลขราคาของเครื่องเหล่านี้เด็ดขาด ไม่ว่ารูปแบบใด):",
        ...asIs,
        "บอกลูกค้าตามนี้: อาการนี้ทำให้ราคาต่างจากเครื่องปกติมาก ประเมินจากหน้านี้ไม่ได้ — แต่เรายังรับซื้อตามสภาพ ให้กดประเมินแล้วเลือกสภาพจริง ทีมงานจะเสนอราคาให้ ห้ามบอกว่าไม่รับซื้อ ห้ามเดาช่วงราคา และห้ามเขียนลิงก์เอง",
      ].join("\n")
    );
  }
  if (noBuy.length) {
    blocks.push(
      [
        "เครื่องที่อยู่นอกเกณฑ์รับซื้อ (ห้ามบอกราคาของเครื่องเหล่านี้เด็ดขาด ไม่ว่ารูปแบบใด):",
        ...noBuy,
        "บอกลูกค้าอย่างสุภาพว่าเครื่องที่เปิดไม่ติดหรือติดล็อก iCloud/MDM ยังรับซื้อไม่ได้ และเสนอให้ประเมินเครื่องอื่นแทนได้",
      ].join("\n")
    );
  }
  if (!blocks.length) return { text: "", coveredIds: new Set() };
  return { text: blocks.join("\n\n"), coveredIds };
}

/**
 * The condition, acknowledged WITHOUT a model to price it against.
 *
 * Live probe round 1: "เครื่องงอ" with no model picked produced silence — the
 * deduction section (rightly) prices nothing it cannot anchor to a device,
 * and the customer who asked whether we even buy a bent phone got nothing.
 * The honest answer exists without a model: name the condition as one our
 * inspection actually grades, say it moves the price, and say the figure
 * needs the model. NO BAHT ANYWHERE — a number here would be a price for a
 * device nobody named, which is the exact bug class the pipeline kills.
 *
 * Renders only when the deduction section produced nothing — when a real
 * figure exists, a vague paragraph under it is noise.
 */
function conditionNoteSection(ingredients, extraction) {
  if (!extraction.conditions.length) return "";
  const lines = [];
  const seen = new Set();
  for (const cid of extraction.conditions) {
    const [setId, giRaw, oiRaw] = cid.split(":");
    const set = ingredients.conditionSets[setId];
    const g = set && set.groups[Number(giRaw)];
    const opt = g && g.options[Number(oiRaw)];
    if (!opt) continue;
    const label = `${g.title ? `${g.title} — ` : ""}${opt.label}`;
    if (seen.has(label)) continue;
    seen.add(label);
    lines.push(`- ${label}: เป็นเงื่อนไขที่มีผลต่อราคารับซื้อ ยอดหักจริงขึ้นกับรุ่นและผลตรวจสภาพเครื่อง`);
  }
  if (!lines.length) return "";
  return [
    "เงื่อนไขสภาพที่ลูกค้าพูดถึง (ยังไม่ระบุรุ่น จึงยังคำนวณยอดหักเป็นตัวเลขไม่ได้ — เรารับซื้อเครื่องทุกสภาพ ราคาปรับตามผลตรวจจริง):",
    ...lines,
  ].join("\n");
}

function marketFactSection(facts, chosen, capacity, quote) {
  if (!facts.length) return "";
  const lines = [];
  for (const f of facts) {
    if (f.text) {
      lines.push(`- ${f.label}: ${f.text}${f.certainty ? ` (${f.certainty})` : ""}`);
      continue;
    }
    lines.push(
      `- ${f.label}: ราคารับซื้ออาจปรับลงประมาณ ${f.dropPctMin}-${f.dropPctMax}% จากราคาปัจจุบัน (${f.certainty})`
    );
    // The baht conversion the v1 renderer refused — refused there because it
    // did not know which device the reader holds. Here stage 1 has named the
    // model, so CODE does the multiplication (spec: ราคา×pct — โค้ดคูณ) and
    // only when exactly one model is in play: two models under one baht range
    // is the ambiguity the refusal existed to prevent.
    //
    // WHICH PRICE IT IS A PERCENTAGE OF DEPENDS ON WHAT THE CUSTOMER WAS
    // TOLD. Two production answers made this unavoidable:
    //
    //   quote 11,900 → "ปรับลง 1,400 - 2,800 บาท จากยอดปัจจุบัน"
    //   quote  6,400 → "10-20% (คิดเป็นประมาณ 800 - 1,600 บาท) จากราคาปัจจุบัน"
    //
    // Both were computed off the CATALOG price (14,000 and 8,000) while the
    // only "current amount" the reader had just been given was the quote. Two
    // separate faults in one line:
    //
    //   1. The drop is overstated against the figure the customer holds — and
    //      overstated in the direction that says "sell now", which rule 15
    //      exists to forbid.
    //   2. It LEAKS the full price by arithmetic. 1,400 at 10% is 14,000, and
    //      rule 6 bans revealing the base "ไม่ว่าจะคำนวณเองหรืออนุมานจาก
    //      ตัวเลขใดๆ" — a leak nobody could see because the sentence never
    //      prints the base itself.
    //
    // So when a condition-adjusted quote exists, the percentage is applied to
    // THAT: the number the customer already knows, which reveals nothing new
    // and matches the sentence they will read.
    const quoted = quote && Number(quote.net_price) > 0 ? Number(quote.net_price) : 0;
    if (quoted > 0) {
      const lo = Math.round((quoted * f.dropPctMin) / 100);
      const hi = Math.round((quoted * f.dropPctMax) / 100);
      lines.push(
        `  คิดเป็นเงินประมาณ ${span(Math.min(lo, hi), Math.max(lo, hi))} จากยอดประเมิน ${baht(
          quoted
        )} บาทของเครื่องเครื่องนี้ — ถ้าเอ่ยถึงต้องบอกว่าเทียบกับยอดประเมินนี้`
      );
    } else if (chosen.length === 1) {
      const p = modelPrice(chosen[0], capacity);
      if (!p.paused && !p.capacityUnavailable && p.max > 0) {
        const lo = Math.round(((p.min > 0 ? p.min : p.max) * f.dropPctMin) / 100);
        const hi = Math.round((p.max * f.dropPctMax) / 100);
        lines.push(
          `  คิดเป็นเงินประมาณ ${span(Math.min(lo, hi), Math.max(lo, hi))} จากราคารับซื้อปัจจุบันของ ${chosen[0].name}`
        );
      }
    }
  }
  if (!lines.length) return "";
  // Header verbatim from the v1 renderer — prompt rule 13 names this line.
  return ["แนวโน้มราคาที่ทีมงานประเมินไว้ (ช่วงประมาณการ ไม่ใช่ราคาผูกมัด):", ...lines].join("\n");
}

function seriesSection(ingredients, chosen) {
  if (!ingredients.series.length || !chosen.length) return "";
  const byId = new Map(chosen.map((m) => [m.id, m]));
  const lines = [];
  for (const s of ingredients.series) {
    const m = byId.get(s.modelId);
    if (!m) continue;
    const sign = s.changePct > 0 ? "+" : "";
    lines.push(
      `- ราคารับซื้อของ ${m.name} ช่วง ${s.days} วันที่ผ่านมาเปลี่ยนแปลงจริง ${sign}${s.changePct}% (ข้อมูลย้อนหลังจากระบบ ไม่ใช่คำพยากรณ์)`
    );
  }
  return lines.length ? ["ความเคลื่อนไหวราคาที่ผ่านมา (คำนวณจากประวัติจริง):", ...lines].join("\n") : "";
}

function familySection(ingredients, extraction) {
  if (!extraction.family) return "";
  // Two doors in: the family-overview intent ("iphone" bare), and an unknown
  // model with a known family and no real model chosen — "iPhone 20 Ultra"
  // must be answered with the absence AND the real devices in that family,
  // or the honest "ยังไม่มีข้อมูล" strands the customer with nothing to act
  // on (acceptance: unknown_model บอกตรง + เสนอรุ่นจริง).
  const unknownNeedsFamily = extraction.unknownModels.length > 0 && extraction.models.length === 0;
  if (extraction.intent !== "family_overview" && !unknownNeedsFamily) return "";
  const members = ingredients.models.filter((m) => familyOf(m) === extraction.family && !m.paused && m.max > 0);
  if (!members.length) return "";
  let min = 0;
  let max = 0;
  for (const m of members) {
    if (m.max > max) max = m.max;
    if (min === 0 || (m.min > 0 && m.min < min)) min = m.min > 0 ? m.min : min;
  }
  const top = [...members].sort((a, b) => b.max - a.max).slice(0, FAMILY_TOP_LIMIT);
  // Named, not merely selected. "ทุกรุ่นที่ตรงกับคำค้นนี้" is at its most
  // misleading exactly here: on the unknown-model door the query names a
  // device we do NOT have, so nothing in this range matched it at all.
  const famName = familyLabel(extraction.family);
  const lines = [
    `ช่วงราคารับซื้อรวมของทุกรุ่นในตระกูล ${famName} (${members.length} รุ่น): ${span(min, max)}`,
    `ช่วงนี้เป็นของหลายรุ่นรวมกัน ห้ามเขียนว่าเป็นราคาของรุ่นใดรุ่นหนึ่ง${unknownNeedsFamily ? " และห้ามผูกกับรุ่นที่ลูกค้าพิมพ์มา เพราะรุ่นนั้นยังไม่มีในระบบ" : ""} — ถ้าจะบอกราคาของตระกูล ${famName} ในภาพรวม ให้ใช้ตัวเลขจากบรรทัดนี้เท่านั้น`,
    // The second half of the same bug, found on production the day the first
    // half shipped. The family range came out correctly labelled ("ช่วงราคา
    // ทั้ง 26 รุ่น ... 2,000 - 38,000") and then the SUMMARY opened with
    // "เรารับซื้อ iPhone ทุกรุ่น ... ที่ราคา 35,000 - 38,000" — the top
    // model's own figures, lifted out of the sample list below and dropped
    // into a sentence whose subject is the whole family. Every digit is ours
    // and verifies; the subject is what changed. The sample lines are
    // correctly labelled per model, so the fix is to say what they may NOT
    // be used for, right where they are handed over.
    `ราคาของบางรุ่นในตระกูล (ตัวอย่าง ${top.length} จาก ${members.length} รุ่น เรียงจากราคาสูงสุด) — เลขในแต่ละบรรทัดเป็นของรุ่นนั้นรุ่นเดียว ห้ามใช้แทนราคาของตระกูลหรือของ "ทุกรุ่น" และห้ามคำนวณช่วงรวมเองจากรายการนี้:`,
  ];
  for (const m of top) lines.push(`- ${factLabel(m)}: ${span(m.min, m.max)}`);
  return lines.join("\n");
}

function siblingSection(ingredients, extraction, chosen) {
  if (!chosen.length || chosen.length >= MODEL_PICK_LIMIT) return "";
  // ONLY WHEN THE CUSTOMER ASKED TO COMPARE.
  //
  // This used to fire on `price` and `forecast` too, which is how "iPhone 17
  // 256GB ราคา" ended with "ถ้าเทียบทางเลือกอื่น iPhone 17 Air อยู่ที่ 20,000 -
  // 22,000 บาท ขณะ iPhone 16 Pro อยู่ที่ 21,000 - 24,000 บาท" (production,
  // 21 ส.ค. 2569). The owner's reading, and it is the right one: someone who
  // names a model and a capacity is holding that device. Prices of two other
  // phones answer a question nobody asked, and they are the loudest numbers
  // in the paragraph — on the iPhone 17 card, 24,000 sits above the 21,000
  // the customer actually gets.
  //
  // Nothing is lost where it helped: `compare` is still served, and an anchor
  // we cannot price already returns "" below, so the "we do not buy yours,
  // here are ones we do" case never depended on this section.
  if (extraction.intent !== "compare") return "";
  const anchor = chosen[0];
  const fam = familyOf(anchor);
  if (!fam || !(anchor.max > 0)) return "";
  const chosenIds = new Set(chosen.map((m) => m.id));
  const sibs = ingredients.models
    .filter((m) => !chosenIds.has(m.id) && !m.paused && m.max > 0 && familyOf(m) === fam)
    .sort((a, b) => Math.abs(a.max - anchor.max) - Math.abs(b.max - anchor.max) || a.name.localeCompare(b.name))
    .slice(0, SIBLING_LIMIT);
  if (!sibs.length) return "";
  const lines = ["รุ่นข้างเคียงในตระกูลเดียวกัน (ราคารับซื้อปัจจุบัน สำหรับเทียบทางเลือก):"];
  for (const m of sibs) lines.push(`- ${factLabel(m)}: ${span(m.min, m.max)}`);
  return lines.join("\n");
}

function pagesSection(ingredients) {
  if (!ingredients.pages.length) return "";
  const lines = ["หน้าในเว็บของเราที่เกี่ยวข้อง:"];
  for (const p of ingredients.pages) {
    lines.push(`- ${p.title}${p.path ? ` (${p.path})` : ""}${p.description ? `: ${p.description}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * The stage-2 context. Sections are assembled in priority order and the
 * budget is spent from the top: when it runs out, whole sections at the tail
 * are dropped and the drop is logged by the caller via the returned list —
 * a rule that bounds coverage and says nothing about what it dropped reads,
 * later, as if it had covered everything.
 */
/**
 * The core groups — the two facts a number cannot honestly be quoted without.
 *
 * Matched on the GROUP TITLE, which is what the Engine authors, and required
 * only when the model's own set actually has one: a Mac mini has no battery
 * group and a Watch band has no screen group, and demanding an answer that
 * does not exist would mean those models could never be quoted.
 */
/**
 * The groups whose answer the CARD may not assume.
 *
 * SCREEN CAME OUT, 24 ส.ค. 2569, and the reason is that the two gates over
 * the same facts disagreed. On "iPhone 11 128GB แบต 78% ขายได้ไหม":
 *
 *   deductionSection (the paragraph)  needs only stated.size > 0
 *     -> published "ประเมินราคาที่ 2,000 บาท"
 *   quoteGate (the card)              also required every core group answered
 *     -> withheld the card
 *
 * So G5 was not protecting the price. The figure went out either way; what it
 * held back was the itemised list saying WHICH answers were the customer's and
 * which the shop filled in — the one thing the card exists for:
 *
 *   "An assumption the customer cannot see is one they will argue with at the
 *    door, and they will be right to"   — QuoteBreakdown, bkk-frontend-next
 *
 * A number with no visible assumption list is the state that comment is
 * against, and that is exactly what withholding the card produced. Letting it
 * through makes the page MORE honest, not less: the assumed screen row renders
 * as "จอ — ยังไม่ได้บอก ระบบประเมินตามสภาพปกติ".
 *
 * BATTERY STAYS, and not out of caution about saying too much — the same
 * argument would remove it too. It stays because the customer cannot answer it
 * by looking: screen damage is something they already know about, so silence
 * about it reads as "no damage", while battery health lives behind a settings
 * screen and silence there reads as "not asked". Assuming the best bucket for
 * a battery nobody checked is a claim about a number, not about something in
 * plain sight. If that distinction stops convincing, this list becomes empty
 * and G5 goes with it — one line, and the reasoning above is the whole case.
 */
const CORE_GROUP_PATTERNS = [/แบต|battery/i];

/**
 * G1-G6 — may this answer carry ONE figure, or must it stay a range?
 *
 * Every gate is a way of being wrong that has already cost money somewhere:
 *
 *   G1  one model, and nothing the catalogue could not name. Two models is
 *       two prices; an unknown_models entry means the customer is talking
 *       about something we did not match at all.
 *   G2  stage 1 said `high`. It reports its own doubt and the field was going
 *       unread.
 *   G3  the model is bought, and the price for the capacity in play is real.
 *   G4  the capacity names exactly ONE sellable row. iPhone "256GB" is a
 *       variant; MacBook "256GB" is the tail of two rows priced 12,000 and
 *       14,000, and quoting either as "the" price is wrong by 2,000 baht in a
 *       way nobody can see. A single-variant model passes through
 *       `soleVariant` instead — it has no ladder at all.
 *   G5  every core group the set HAS is answered. Below that the figure is
 *       mostly assumption wearing a number's clothes.
 *   G6  no refusal. A device we do not buy has no price, full stop.
 *
 * Returns { quote } or { reason } — the reason is logged, never shown: the
 * page simply behaves exactly as it does today (range + chips).
 */
function quoteGate(ingredients, extraction) {
  if (extraction.models.length !== 1) return { reason: "not_one_model" };
  if (extraction.unknownModels.length) return { reason: "unknown_model_named" };
  if (extraction.confidence !== "high") return { reason: "low_confidence" };

  const model = ingredients.models.find((m) => m.id === extraction.models[0]);
  if (!model) return { reason: "model_missing" };
  if (model.paused) return { reason: "paused" };

  const p = modelPrice(model, extraction.capacity);
  if (p.paused || p.capacityUnavailable || !(p.max > 0)) return { reason: "no_price" };

  // G4 — one sellable row, named.
  let variant = null;
  let capacity = null;
  if (extraction.capacity) {
    const rung = (model.capacities || []).find((c) => c.name === extraction.capacity);
    if (rung && rung.rows === 1 && rung.variant) {
      variant = rung.variant;
      capacity = rung.name;
    }
  }
  if (!variant && model.soleVariant && !extraction.capacity) {
    variant = model.soleVariant;
  }
  if (!variant) return { reason: "variant_ambiguous" };
  if (!(p.min === p.max)) return { reason: "price_not_a_point" };

  const r = resolveModelConditions(model, ingredients, extraction);
  if (!r) return { reason: "no_condition_set" };
  if (r.refused) return { reason: "declined" };
  // Nothing the customer said reached THIS model's set. Every row would be an
  // assumption, and a figure made entirely of assumptions is a range wearing
  // a number's clothes — worse than the range, because it looks decided.
  if (r.stated.size === 0) return { reason: "no_stated_condition" };

  // G5 — the core groups this set has must be answered, not assumed.
  for (const re of CORE_GROUP_PATTERNS) {
    const row = r.resolved.find((x) => re.test(x.groupTitle));
    if (!row) continue;               // the set does not ask this: fine
    if (row.assumed) return { reason: "core_group_unanswered" };
  }

  const base = p.max;
  let deductTotal = 0;
  const conditions = [];
  for (const row of r.resolved) {
    const deduct = resolveOptionDeduction(row.option, base, model.liquidityFactor);
    deductTotal += deduct;
    conditions.push({
      group: row.groupTitle,
      label: policyLabelOf(row.option),
      deduct,
      assumed: row.assumed === true,
    });
  }

  return {
    quote: {
      model_id: model.id,
      model_name: model.name,
      variant,
      ...(capacity ? { capacity } : {}),
      base_price: base,
      deduct_total: deductTotal,
      net_price: resolveFinalPrice(base, deductTotal),
      conditions,
      assumed_groups: r.assumedGroups,
    },
  };
}

function buildV2Context({ query, ingredients, extraction, serviceFacts }) {
  const chosen = extraction.models
    .map((id) => ingredients.models.find((m) => m.id === id))
    .filter(Boolean);

  const head = [`คำค้นของลูกค้า: ${query}`];
  if (extraction.capacity && chosen.length) {
    head.push(
      `ลูกค้าระบุความจุ ${extraction.capacity} แล้ว — ตัวเลขทุกตัวด้านล่างเป็นราคาของความจุ ${extraction.capacity} เท่านั้น ห้ามพูดถึงราคาของความจุอื่น และห้ามบอกว่าราคาต่างกันตามความจุ`
    );
  }
  if (extraction.unknownModels.length) {
    head.push(
      `ข้อเท็จจริง: รุ่นต่อไปนี้ที่ลูกค้าเอ่ยถึง ยังไม่มีในระบบรับซื้อของเรา: ${extraction.unknownModels.join(
        ", "
      )} — ให้บอกลูกค้าตรงๆ ว่ายังไม่มีข้อมูลรุ่นนี้ ห้ามบอกว่าเราไม่รับซื้อ และห้ามเดาราคา ตัวเลขทุกตัวที่พูดถึงต้องระบุชัดว่าเป็นของรุ่นไหน`
    );
  }

  const serviceFirst = extraction.intent === "service" || extraction.intent === "store";
  const facts = applicableMarketFacts(ingredients, extraction);
  const deductions = deductionSection(chosen, ingredients, extraction);
  // The single figure, when everything needed for one is on the table. It is
  // computed here rather than by the writer and rides out in the response so
  // the card can show the same number the paragraph does — one arithmetic,
  // two renderings.
  const gate = quoteGate(ingredients, extraction);
  const ordered = [
    // A model with a condition-adjusted estimate below has NO base-price line
    // — see priceSection's exclude note.
    { name: "prices", text: priceSection(chosen, extraction.capacity, deductions.coveredIds) },
    ...(serviceFirst ? [{ name: "service_facts", text: String(serviceFacts || "").trim() }] : []),
    { name: "deductions", text: deductions.text },
    // The exact figure, once, in its own line. It must be IN the context or
    // the excision gate would cut the sentence quoting it — the whitelist is
    // built from this text (allowedNumberRuns).
    {
      name: "quote",
      text: gate.quote
        ? `ยอดประเมินของเครื่องเครื่องนี้โดยเฉพาะ: ${gate.quote.model_name} ${gate.quote.variant} = ${baht(
            gate.quote.net_price
          )} บาท — เป็นยอดที่ลูกค้าจะได้รับถ้าสภาพจริงตรงกับที่บอกมา พูดตัวเลขนี้ได้ตรงๆ ห้ามคำนวณต่อและห้ามปัดเลข`
        : "",
    },
    // The generic acknowledgement stands in ONLY when no real figure could —
    // a vague line under a computed one is noise.
    { name: "condition_note", text: deductions.text ? "" : conditionNoteSection(ingredients, extraction) },
    // gate.quote is computed above, so the percentage can be applied to the
    // figure the customer was actually given rather than to the base price
    // the answer is forbidden to reveal.
    { name: "market_facts", text: marketFactSection(facts, chosen, extraction.capacity, gate.quote) },
    { name: "series", text: seriesSection(ingredients, chosen) },
    { name: "family", text: familySection(ingredients, extraction) },
    { name: "siblings", text: siblingSection(ingredients, extraction, chosen) },
    ...(serviceFirst ? [] : [{ name: "service_facts", text: String(serviceFacts || "").trim() }]),
    { name: "pages", text: pagesSection(ingredients) },
  ].filter((s) => s.text);

  let out = head.join("\n\n");
  const droppedSections = [];
  for (const s of ordered) {
    if (out.length + 2 + s.text.length > V2_MAX_CONTEXT_CHARS) {
      droppedSections.push(s.name);
      continue;
    }
    out = `${out}\n\n${s.text}`;
  }
  return { context: out, droppedSections, ...(gate.quote ? { quote: gate.quote } : {}) };
}

module.exports = {
  MODEL_PICK_LIMIT,
  V2_MAX_CONTEXT_CHARS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_TIMEOUT_MS,
  sanitizeIngredients,
  canonicalIngredients,
  v2CacheKey,
  buildExtractSystemPrompt,
  buildExtractStable,
  buildExtractVariable,
  buildExtractContent,
  parseExtraction,
  recoverMatchedModels,
  applicableMarketFacts,
  hasAnythingToWrite,
  buildV2Context,
  buildV2SystemPrompt,
  parseOverviewV2,
  exciseUnverifiedNumbers,
  dropOffLimitsAdvice,
  OFF_LIMITS_RE,
  admittedKeyPoints,
  extractMarkedSpans,
  primaryModelLegend,
  MAX_KEY_POINTS,
  V2_MAX_OUTPUT_TOKENS,
  __test: {
    normalizeCapacity,
    stableStringify,
    conditionChoices,
    resolveConditionForSet,
    resolveOptionDeduction,
    resolveFinalPrice,
    modelPrice,
    familyOfCategory,
    factLabel,
    resolveConditions,
    batteryOptionRange,
    pickBatteryOptionId,
    findBatteryGroup,
    withPositionalIds,
    resolveModelConditions,
    quoteGate,
    priceSection,
    deductionSection,
    conditionNoteSection,
    marketFactSection,
    seriesSection,
    familySection,
    siblingSection,
    allowedNumberRuns,
    splitSentences,
  },
};
