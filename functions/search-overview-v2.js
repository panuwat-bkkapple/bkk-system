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
    "2. รุ่นที่ลูกค้าเอ่ยถึงแต่ไม่มีในลิสต์รุ่น ให้ใส่ชื่อตามที่ลูกค้าเรียกลงใน unknown_models ห้ามจับคู่กับรุ่นอื่นที่ใกล้เคียง — แต่ก่อนใส่ต้องเช็คลิสต์ให้ถี่ถ้วน: ลูกค้ามักพิมพ์ตัวย่อหรือสะกดต่าง (เช่น 16pm / ip16 promax = iPhone 16 Pro Max, ไอโฟน = iPhone) ถ้าชื่อที่เอ่ยคือรุ่นเดียวกับที่มีในลิสต์ ให้เลือก id นั้นลง models ห้ามใส่ unknown_models",
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
function parseOverviewV2(raw) {
  const text = String(raw || "").trim().replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  const end = text.lastIndexOf("}");
  if (end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const summary = String(obj.summary || "").trim();
      if (summary) {
        return {
          summary,
          detail: String(obj.detail || "").trim(),
          keyPoint: String(obj.key_point || "").trim(),
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
  const summary = grab("summary");
  if (!summary) return null;
  return { summary, detail: grab("detail"), keyPoint: grab("key_point"), salvaged: true };
}

/**
 * The key point, ADMITTED ONLY VERBATIM. The model does not write markup and
 * does not get to introduce text through a side door either: key_point is a
 * POINTER into the summary the customer will actually read, so it counts
 * only when it appears there character-for-character — checked against the
 * SERVED summary (post-excision), because a highlight pointing at a sentence
 * the number gate just cut would resurrect it. Anything else — reworded,
 * abbreviated, hallucinated, or orphaned by excision — is dropped silently:
 * a missing highlight is a shrug, a wrong one is a lie about what matters.
 */
function admittedKeyPoint(keyPoint, servedSummary) {
  const k = String(keyPoint || "").trim();
  if (!k) return "";
  return String(servedSummary || "").includes(k) ? k : "";
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
  const clean = (text) => {
    const kept = [];
    for (const sentence of splitSentences(text)) {
      const runs = sentence.replace(/,/g, "").match(/\d{3,}/g) || [];
      if (runs.every((r) => allowed.has(r))) kept.push(sentence);
      else excised++;
    }
    return kept.join(" ");
  };
  const summary = clean(parsed.summary);
  if (!summary) return null;
  return { summary, detail: clean(parsed.detail || ""), excised };
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
function buildV2SystemPrompt(assistantName) {
  return [
    `คุณคือ${assistantName} ผู้เชี่ยวชาญประเมินราคาของ BKK APPLE ร้านรับซื้ออุปกรณ์ Apple มือสอง`,
    "หน้าที่ของคุณคือตอบคำค้นของลูกค้าในหน้าค้นหา จากข้อมูลจากระบบที่ให้ไว้ด้านล่างเท่านั้น ให้จบในคำตอบเดียว",
    "",
    "ชั้นที่ 1 — ความจริง (ละเมิดไม่ได้ทุกกรณี):",
    "1. ตัวเลขทุกตัวที่พูดถึงต้องมาจาก 'ข้อมูลจากระบบ' เท่านั้น ห้ามคำนวณ ห้ามประมาณ ห้ามปัดเศษเพิ่มเอง — ห้ามนำตัวเลขจากข้อมูลมาบวก ลบ คูณ หาร หรือประกอบเป็นตัวเลขใหม่ แม้ผลลัพธ์จะถูกต้องทางคณิตศาสตร์ ตัวเลขที่ไม่มีอยู่ในข้อมูลคือตัวเลขที่ห้ามพูดถึง — ราคาประเมินตามสภาพ (บรรทัด 'ราคาประเมินเบื้องต้นอยู่ที่ประมาณ') และยอดที่แปลงเป็นบาทแล้ว เป็นตัวเลขสำเร็จที่ระบบคำนวณมาให้ ใช้ตรงๆ เท่านั้น ตำหนิที่ไม่มีบรรทัดราคาประเมินให้ ห้ามประมาณตัวเลขเอง ให้บอกว่าต้องตรวจสภาพจริงก่อนจึงจะทราบยอด",
    "2. ทุกยอดเป็นการประเมินก่อนตรวจเครื่องจริง — ถ้าพูดถึงยอดต้องกำกับว่ายอดสุดท้ายยืนยันหลังตรวจสภาพเครื่อง ห้ามใช้คำว่ารับประกัน การันตี หรือคำที่ฟังเป็นยอดที่ตกลงแล้ว",
    "3. เรื่องแนวโน้มราคาในอนาคต พูดได้เฉพาะจากบรรทัด 'แนวโน้มราคาที่ทีมงานประเมินไว้' — ไม่มีบรรทัดนั้นห้ามคาดการณ์เอง และเมื่อมี: ห้ามทำช่วงให้แคบลงหรือเปลี่ยนเป็นเลขเดี่ยว ห้ามแปลงเปอร์เซ็นต์เป็นบาทเอง (บรรทัด 'คิดเป็นเงินประมาณ' คือค่าที่ระบบแปลงให้แล้ว) ห้ามตัดคำกำกับความไม่แน่นอนออก — ส่วนบรรทัด 'ความเคลื่อนไหวราคาที่ผ่านมา' คือประวัติจริง ห้ามใช้มันพยากรณ์อนาคต",
    "4. รุ่นที่ระบุว่ายังไม่มีในระบบรับซื้อ ให้บอกตรงๆ ว่ายังไม่มีข้อมูลรุ่นนั้น ห้ามเดาราคา ห้ามบอกว่าเราไม่รับซื้อ และตัวเลขทุกตัวที่เอ่ยต้องระบุชัดว่าเป็นของรุ่นไหน — รุ่นที่ระบุว่างดรับซื้อ ให้บอกตามนั้น ห้ามเสนอราคาให้",
    "5. ข้อมูลไม่พอจะตอบส่วนไหน ให้บอกตรงๆ ในประโยคแรกแล้วชี้ว่าหน้าไหนในเว็บน่าจะมี — ห้ามเดา ห้ามเขียนย่อหน้าที่ฟังเหมือนคำตอบโดยไม่มีข้อมูลรองรับ และห้ามถามคำถามกลับไม่ว่ากรณีใด (กล่องนี้ตอบครั้งเดียวจบ การซักถามเป็นหน้าที่ของแชทและฟอร์มประเมิน)",
    "6. ห้ามเอ่ยถึงข้อมูลภายในระบบ (id, ชื่อฟิลด์, ชื่อเครื่องมือ, กลไกการทำงาน) ห้ามเขียนลิงก์หรือ URL ห้ามใช้อีโมจิ — และเกณฑ์การหักราคาตามสภาพเป็นความลับทางการค้าของร้าน: เมื่อลูกค้าระบุตำหนิ บอกได้เฉพาะราคาประเมินที่เขาจะได้รับ ห้ามแจกแจงว่าราคาเต็มเท่าไหร่ หักรายการละเท่าไหร่ หรือคิดเป็นกี่เปอร์เซ็นต์ ไม่ว่าจะคำนวณเองหรืออนุมานจากตัวเลขใดๆ",
    "7. ห้ามใช้ความรู้นอกเหนือจากข้อมูลจากระบบ — ไม่มีราคาตลาด ราคาร้านอื่น สเปก ปีที่วางขาย หรือข่าวใดๆ จากความจำของคุณ ราคาที่บอกคือราคารับซื้อของเรา ไม่ใช่ราคาขายต่อ ห้ามเอาไปเทียบกับราคาที่ลูกค้าขายเองได้",
    "",
    "ชั้นที่ 2 — ความฉลาด (มาตรฐานของคำตอบ):",
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
    "16. น้ำเสียง: ผู้เชี่ยวชาญหน้างานจริง ภาษาไทยธรรมชาติ มั่นใจแบบมีหลักฐาน ไม่เร่งเร้า ไม่ขายของ",
    "",
    "รูปแบบคำตอบ: ตอบเป็น JSON เท่านั้น ไม่ต้องมีข้อความอื่นนอก JSON",
    '{"summary": "...", "detail": "...", "key_point": "..."}',
    "- summary = ย่อหน้าเดียว 2-3 ประโยค ตอบคำถามให้ตรงที่สุด พร้อมตัวเลขจริง และคำฟันธงถ้าข้อมูลชี้ชัด",
    "- key_point = ประโยคใจความสำคัญที่สุดหนึ่งประโยค คัดลอกมาจาก summary แบบคำต่อคำทุกตัวอักษร ห้ามเขียนใหม่ ห้ามย่อ — ประโยคที่ถ้าลูกค้าอ่านได้บรรทัดเดียวต้องเป็นบรรทัดนี้ (ปกติคือคำฟันธงหรือคำตอบตรงของคำถาม)",
    "- detail = ส่วนขยาย (รายรุ่น เหตุผลของคำฟันธง เงื่อนไขที่ทำให้ราคาต่างกัน ทางเลือกเทียบ) — กระชับ: ไม่เกินราว 6 ประโยค เลือกเฉพาะที่ช่วยตัดสินใจจริง ห้ามทวนซ้ำสิ่งที่อยู่ใน summary แล้ว ถ้าไม่มีอะไรจะขยายให้ใส่ค่าว่าง",
    // Same two closing bans as v1, verbatim in spirit: the website renders the
    // real button, and an invitation written in text is the same instruction
    // twice — once from a thing that can be pressed and once from one that
    // cannot. Layer 2's positive rules must never reopen this door.
    "- ห้ามเขียนชวนให้กดประเมินราคาหรือกดปุ่มใดๆ ปิดท้าย เว็บมีปุ่มให้อยู่แล้ว",
    "- ห้ามใส่ลิงก์ URL หรือชื่อปุ่มลงในคำตอบ",
    "- ภาษาไทย สุภาพ ลงท้ายด้วยครับ",
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
function deductionSection(chosen, ingredients, extraction) {
  if (!extraction.conditions.length) return { text: "", coveredIds: new Set() };
  const lines = [];
  const coveredIds = new Set();
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
      rows.push({ label: opt.label, min: Math.min(dLow, dHigh), max: Math.max(dLow, dHigh) });
    }
    if (!rows.length) continue;

    const totalMin = rows.reduce((s, r) => s + r.min, 0);
    const totalMax = rows.reduce((s, r) => s + r.max, 0);
    const name = p.capacity ? `${m.name} ความจุ ${p.capacity}` : m.name;
    coveredIds.add(m.id);
    lines.push(
      `- ${name} (สภาพที่ระบุ: ${rows.map((r) => r.label).join(", ")}): ราคาประเมินเบื้องต้นอยู่ที่ประมาณ ${span(
        resolveFinalPrice(baseMin, totalMax),
        resolveFinalPrice(baseMax, totalMin)
      )}`
    );
  }
  if (!lines.length) return { text: "", coveredIds: new Set() };
  return {
    text: [
      "ราคาประเมินตามสภาพที่ลูกค้าระบุ (คำนวณจากเกณฑ์ประเมินจริงของรุ่นนั้น — ตัวเลขนี้คือยอดที่ลูกค้าจะได้รับ):",
      ...lines,
      "เป็นการประเมินเบื้องต้น ยอดสุดท้ายยืนยันหลังตรวจสภาพเครื่องจริง",
    ].join("\n"),
    coveredIds,
  };
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
  const deductions = deductionSection(chosen, ingredients, extraction);
  const ordered = [
    // A model with a condition-adjusted estimate below has NO base-price line
    // — see priceSection's exclude note.
    { name: "prices", text: priceSection(chosen, extraction.capacity, deductions.coveredIds) },
    ...(serviceFirst ? [{ name: "service_facts", text: String(serviceFacts || "").trim() }] : []),
    { name: "deductions", text: deductions.text },
    // The generic acknowledgement stands in ONLY when no real figure could —
    // a vague line under a computed one is noise.
    { name: "condition_note", text: deductions.text ? "" : conditionNoteSection(ingredients, extraction) },
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
  buildV2SystemPrompt,
  parseOverviewV2,
  exciseUnverifiedNumbers,
  admittedKeyPoint,
  V2_MAX_OUTPUT_TOKENS,
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
    conditionNoteSection,
    marketFactSection,
    seriesSection,
    familySection,
    siblingSection,
    allowedNumberRuns,
    splitSentences,
  },
};
