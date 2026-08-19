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
      rungs.push({ name: rung, min: Math.max(0, num(c.min)), max: Math.max(0, num(c.max)) });
    }
    if (rungs.length) out.capacities = rungs;
  }
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
    conditionSets: sanitizeConditionSets(raw.conditionSets),
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
function v2CacheKey(query, ingredients, factsVersion) {
  return crypto
    .createHash("sha256")
    .update(`${query}\n\n${canonicalIngredients(ingredients)}\n\n${String(factsVersion || "")}`)
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

/** Every condition option the payload's sets offer, as pickable ids.
 *  cid = `${setId}:${groupIndex}:${optionIndex}` — an address into data the
 *  website already sent, so resolving one back needs no lookup at all. */
function conditionChoices(ingredients) {
  const out = [];
  const sets = (ingredients && ingredients.conditionSets) || {};
  for (const setId of Object.keys(sets)) {
    (sets[setId].groups || []).forEach((g, gi) => {
      (g.options || []).forEach((o, oi) => {
        out.push({ cid: `${setId}:${gi}:${oi}`, group: g.title || "", label: o.label });
      });
    });
  }
  return out;
}

function buildExtractSystemPrompt() {
  return [
    "คุณคือตัวแยกความหมายของคำค้นในเว็บร้านรับซื้ออุปกรณ์ Apple มือสอง",
    "หน้าที่: อ่านคำค้นดิบของลูกค้า แล้วตอบเป็น JSON ตามรูปแบบที่กำหนดเท่านั้น",
    "",
    "กฎเหล็ก:",
    "1. id ทุกตัวที่ตอบ ต้องคัดลอกมาจากลิสต์ที่ให้ไว้เป๊ะๆ เท่านั้น ห้ามแต่ง id เอง",
    "2. รุ่นที่ลูกค้าเอ่ยถึงแต่ไม่มีในลิสต์รุ่น ให้ใส่ชื่อตามที่ลูกค้าเรียกลงใน unknown_models ห้ามจับคู่กับรุ่นอื่นที่ใกล้เคียง",
    "3. conditions ใส่เฉพาะเมื่อลูกค้าพูดถึงสภาพเครื่องจริงๆ และมี id ที่ตรงความหมาย — ประโยคอย่าง 'ราคาจะลงอีกไหม' ไม่ใช่สภาพเครื่อง ต้องได้ conditions ว่าง",
    "4. เลขในคำค้นที่เป็นความจุ (เช่น 256, 512GB, 1TB) ใส่ใน capacity พร้อมหน่วยเสมอ ไม่ใช่ชื่อรุ่น",
    "5. intent เลือกค่าเดียวที่ตรงที่สุด: price=ถามราคารุ่น, deduction=ถามยอดหักตามสภาพ, forecast=ถามแนวโน้ม/จังหวะขาย, service=ถามบริการหรือขั้นตอน, store=ถามข้อมูลร้าน, compare=เทียบรุ่นหรือทางเลือก, family_overview=พิมพ์ชื่อตระกูลกว้างๆ, other=นอกเหนือจากนี้",
    "6. family ใส่เมื่อคำค้นพูดถึงตระกูลสินค้า (iphone/ipad/mac/apple-watch) แม้ไม่ระบุรุ่น มิฉะนั้นเป็น null",
    "7. confidence=low เมื่อไม่แน่ใจว่าอ่านคำค้นถูก",
    "8. ตอบเป็น JSON ล้วนๆ ห้ามมีข้อความอื่นนอก JSON",
    "",
    "รูปแบบคำตอบ:",
    '{"models": ["id"], "capacity": "256GB หรือ null", "conditions": ["id"], "topics": ["id"], "intent": "price", "family": "iphone หรือ null", "unknown_models": ["ชื่อที่ลูกค้าเรียก"], "confidence": "high"}',
  ].join("\n");
}

function buildExtractUser(query, ingredients) {
  const lines = [`คำค้นดิบของลูกค้า: ${query}`, "", "ลิสต์รุ่นในระบบ (id | ชื่อ | ชื่อเรียกอื่น):"];
  for (const m of ingredients.models) {
    lines.push(`${m.id} | ${m.name}${m.alias ? ` | ${m.alias}` : ""}`);
  }
  const choices = conditionChoices(ingredients);
  if (choices.length) {
    lines.push("", "ลิสต์สภาพเครื่องที่เลือกได้ (id | หมวด | ตัวเลือก):");
    for (const c of choices) lines.push(`${c.cid} | ${c.group} | ${c.label}`);
  }
  lines.push("", "ลิสต์หัวข้อบริการที่เลือกได้ (id | ความหมาย):");
  for (const [id, desc] of Object.entries(V2_TOPIC_DESCRIPTIONS)) lines.push(`${id} | ${desc}`);
  return lines.join("\n");
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

  const unknownModels = [];
  for (const nameRaw of Array.isArray(obj.unknown_models) ? obj.unknown_models : []) {
    const s = str(nameRaw, 60).trim();
    if (s && !unknownModels.includes(s) && unknownModels.length < UNKNOWN_MODEL_LIMIT) {
      unknownModels.push(s);
    }
  }

  const intent = INTENTS.has(obj.intent) ? obj.intent : "other";
  const family = FAMILIES.has(String(obj.family || "").toLowerCase())
    ? String(obj.family).toLowerCase()
    : null;

  return {
    models,
    capacity: normalizeCapacity(obj.capacity),
    conditions,
    topics,
    intent,
    family,
    unknownModels,
    confidence: obj.confidence === "high" ? "high" : "low",
    dropped,
  };
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
 *  turns false into {skipped:"nothing_to_write"} without paying for stage 3. */
function hasAnythingToWrite(ingredients, extraction, now = Date.now()) {
  return (
    extraction.models.length > 0 ||
    extraction.topics.length > 0 ||
    extraction.unknownModels.length > 0 ||
    (extraction.intent === "family_overview" && !!extraction.family) ||
    applicableMarketFacts(ingredients, extraction, now).length > 0 ||
    ingredients.pages.length > 0
  );
}

function priceSection(chosen, capacity) {
  if (!chosen.length) return "";
  const lines = ["ราคารับซื้อของเรา (ตัวเลขทั้งหมดนี้คือข้อมูลจริงจากระบบ):"];
  for (const m of chosen) {
    const p = modelPrice(m, capacity);
    if (p.paused) {
      lines.push(`- ${m.name}: ตอนนี้งดรับซื้อชั่วคราว${m.pausedMessage ? ` (${m.pausedMessage})` : ""}`);
      continue;
    }
    if (p.capacityUnavailable) {
      const have = p.available && p.available.length ? ` (ความจุที่เรารับซื้อ: ${p.available.join(", ")})` : "";
      lines.push(`- ${m.name}: ไม่มีความจุ ${capacity} ในรายการรับซื้อของรุ่นนี้${have}`);
      continue;
    }
    if (!(p.max > 0)) continue;
    const spread = p.capacity ? "ปรับตามสภาพจริงตอนตรวจ" : "ต่างกันตามความจุและสภาพ";
    const label = p.capacity ? `${m.name} ความจุ ${p.capacity}` : m.name;
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

function deductionSection(chosen, ingredients, extraction) {
  if (!extraction.conditions.length) return "";
  const lines = [];
  for (const m of chosen) {
    if (m.paused || !m.conditionSetId) continue;
    const set = ingredients.conditionSets[m.conditionSetId];
    if (!set) continue;
    const p = modelPrice(m, extraction.capacity);
    if (p.paused || p.capacityUnavailable || !(p.max > 0)) continue;
    const baseMin = p.min > 0 ? p.min : p.max;
    const baseMax = p.max;

    const rows = [];
    for (const cid of extraction.conditions) {
      const [setId, giRaw, oiRaw] = cid.split(":");
      if (setId !== m.conditionSetId) continue;
      const g = set.groups[Number(giRaw)];
      const opt = g && g.options[Number(oiRaw)];
      if (!opt) continue;
      // Resolves to 0 = the admin has not priced this option, not "we deduct
      // nothing" — the line must not exist rather than promise a free pass.
      const dLow = resolveOptionDeduction(opt, baseMin, m.liquidityFactor);
      const dHigh = resolveOptionDeduction(opt, baseMax, m.liquidityFactor);
      if (!(Math.max(dLow, dHigh) > 0)) continue;
      rows.push({
        label: `${g.title ? `${g.title} — ` : ""}${opt.label}`,
        min: Math.min(dLow, dHigh),
        max: Math.max(dLow, dHigh),
      });
    }
    if (!rows.length) continue;

    const totalMin = rows.reduce((s, r) => s + r.min, 0);
    const totalMax = rows.reduce((s, r) => s + r.max, 0);
    const name = p.capacity ? `${m.name} ความจุ ${p.capacity}` : m.name;
    if (rows.length === 1) {
      lines.push(
        `- ${name}: ${rows[0].label} หักประมาณ ${span(rows[0].min, rows[0].max)} → เหลือประมาณ ${span(
          resolveFinalPrice(baseMin, totalMax),
          resolveFinalPrice(baseMax, totalMin)
        )}`
      );
    } else {
      for (const r of rows) lines.push(`- ${name}: ${r.label} หักประมาณ ${span(r.min, r.max)}`);
      lines.push(
        `- ${name}: รวมหักประมาณ ${span(totalMin, totalMax)} → เหลือประมาณ ${span(
          resolveFinalPrice(baseMin, totalMax),
          resolveFinalPrice(baseMax, totalMin)
        )}`
      );
    }
  }
  if (!lines.length) return "";
  return [
    "เงื่อนไขสภาพที่ลูกค้าระบุ (ยอดหักคำนวณจากเกณฑ์ประเมินจริงของแต่ละรุ่น):",
    ...lines,
    "ยอดหักและยอดเหลือทั้งหมดเป็นการประเมินเบื้องต้น ยอดสุดท้ายยืนยันหลังตรวจสภาพเครื่องจริง",
  ].join("\n");
}

function marketFactSection(facts, chosen, capacity) {
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
    if (chosen.length === 1) {
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
  if (extraction.intent !== "family_overview" || !extraction.family) return "";
  const members = ingredients.models.filter((m) => familyOf(m) === extraction.family && !m.paused && m.max > 0);
  if (!members.length) return "";
  let min = 0;
  let max = 0;
  for (const m of members) {
    if (m.max > max) max = m.max;
    if (min === 0 || (m.min > 0 && m.min < min)) min = m.min > 0 ? m.min : min;
  }
  const top = [...members].sort((a, b) => b.max - a.max).slice(0, FAMILY_TOP_LIMIT);
  const lines = [
    `ช่วงราคารับซื้อของทุกรุ่นที่ตรงกับคำค้นนี้ (${members.length} รุ่น): ${span(min, max)}`,
    `ตัวอย่างรุ่นราคาสูงสุดในกลุ่ม (แสดง ${top.length} จาก ${members.length} รุ่น — ห้ามคำนวณช่วงรวมเองจากรายการนี้):`,
  ];
  for (const m of top) lines.push(`- ${m.name}: ${span(m.min, m.max)}`);
  return lines.join("\n");
}

function siblingSection(ingredients, extraction, chosen) {
  if (!chosen.length || chosen.length >= MODEL_PICK_LIMIT) return "";
  if (extraction.intent !== "compare" && extraction.intent !== "price" && extraction.intent !== "forecast") return "";
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
  for (const m of sibs) lines.push(`- ${m.name}: ${span(m.min, m.max)}`);
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
  const ordered = [
    { name: "prices", text: priceSection(chosen, extraction.capacity) },
    ...(serviceFirst ? [{ name: "service_facts", text: String(serviceFacts || "").trim() }] : []),
    { name: "deductions", text: deductionSection(chosen, ingredients, extraction) },
    { name: "market_facts", text: marketFactSection(facts, chosen, extraction.capacity) },
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
  return { context: out, droppedSections };
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
  buildExtractUser,
  parseExtraction,
  applicableMarketFacts,
  hasAnythingToWrite,
  buildV2Context,
  __test: {
    normalizeCapacity,
    stableStringify,
    conditionChoices,
    resolveOptionDeduction,
    resolveFinalPrice,
    modelPrice,
    familyOfCategory,
    priceSection,
    deductionSection,
    marketFactSection,
    seriesSection,
    familySection,
    siblingSection,
  },
};
