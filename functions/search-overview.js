/**
 * AI overview for the customer site's /search page.
 *
 * THIS FUNCTION DOES NOT KNOW WHAT ANYTHING COSTS. It is handed a block of
 * facts that bkk-frontend-next already assembled from the catalog — prices,
 * paused flags, page titles — and asked to write them up in Thai. That split
 * is the whole design:
 *
 *   - the MATCHING stays in one place (lib/searchMatch.ts + lib/pageIndex.ts
 *     on the website). Mirroring it here would make a fifth copy of a matcher
 *     this project has already been bitten by keeping in sync.
 *   - the ANTHROPIC KEY stays in one place (this codebase), behind the same
 *     daily cap and the same auto-suspension as the chat assistant. A second
 *     caller on Vercel with its own key would be a second way to burn credit
 *     that nothing caps and nothing can switch off — which is the exact
 *     failure the suspension work exists to prevent.
 *
 * Callers authenticate with a shared secret. Without it this would be an open
 * Anthropic proxy on the public internet, and the bill would be somebody
 * else's idea of a good time.
 */

const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase, ServerValue } = require("firebase-admin/database");
const { isPermanentAiFailure, suspendAssistant } = require("./chat-ai");
// The daily ledger's by_origin dimension — one writer for both spenders, so
// the search/chat split can never drift between two hand-rolled copies.
const { recordAiUsage, opsBangkokYmd: bangkokYmd } = require("./ops-dashboard");
const {
  searchFaq,
  loadBranches,
  loadPromotions,
  loadStoreProfile,
  loadDeliveryZones,
} = require("./service-facts");
const {
  sanitizeIngredients,
  v2CacheKey,
  buildExtractSystemPrompt,
  buildExtractUser,
  parseExtraction,
  recoverMatchedModels,
  hasAnythingToWrite,
  buildV2Context,
  buildV2SystemPrompt,
  parseOverviewV2,
  exciseUnverifiedNumbers,
  dropOffLimitsAdvice,
  admittedKeyPoints,
  primaryModelLegend,
  V2_MAX_OUTPUT_TOKENS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_TIMEOUT_MS,
} = require("./search-overview-v2");
const { answerLanguage, languageLines } = require("./answer-language");

const REGION = "asia-southeast1";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Haiku on purpose. The job is "restate these numbers in a sentence", not
// reasoning — and this runs on a page a customer is waiting on, so latency is
// part of the answer.
//
// The env override is OVERVIEW_MODEL, this surface's OWN variable — it used
// to read CHAT_AI_MODEL first, which meant every time the chat was switched
// between Haiku and Sonnet the overview silently switched with it and paid
// Sonnet prices for sentence-restating. The overview never follows the chat
// model again; unset env means the Haiku default below.
const DEFAULT_OVERVIEW_MODEL = "claude-haiku-4-5";
const OVERVIEW_TIMEOUT_MS = 20000;
const MAX_OUTPUT_TOKENS = 700;
const MAX_CONTEXT_CHARS = 6000;

/**
 * A cap of its OWN, separate from the chat assistant's.
 *
 * They spend the same money, so the temptation is one counter. But they fail
 * differently: a search surge is anonymous traffic and can be shed with no
 * one losing anything, while a chat that stops answering leaves a customer
 * mid-sentence. One shared counter means the cheap thing can starve the
 * expensive one, so the search overview gets its own ceiling and hits it
 * alone.
 */
const DEFAULT_DAILY_OVERVIEW_CAP = 2000;

/**
 * PER-CLIENT CEILING — the second brake, and the one that stops a single
 * source draining the first.
 *
 * The daily cap bounds the bill; it does not bound WHO spends it. One script
 * can exhaust two thousand calls in minutes, and every customer for the rest
 * of that day gets nothing. So calls are also counted per client per hour.
 *
 * WHY THE CLIENT IS NAMED BY THE WEBSITE AND NOT BY THIS FUNCTION. `/search`
 * is a server component: the request reaching here comes from Vercel, not
 * from the reader's browser, so the IP this function can see belongs to
 * Vercel. Counting it would put every customer in the world into one bucket
 * and cap the entire site at thirty answers an hour — the exact outage this
 * limit exists to prevent, delivered by the limit itself.
 *
 * The website therefore sends `clientKey`, a SALTED HASH of the reader's IP.
 * Two consequences worth stating plainly:
 *   - No raw IP crosses the wire and none is ever written to RTDB. The same
 *     rule the ledger and the search analytics already follow.
 *   - NO KEY MEANS NO LIMIT. An unidentified caller is not throttled, because
 *     the only fallback available — the request IP — is the site-wide bucket
 *     described above. Fail-open is the safe direction here precisely because
 *     the daily cap still bounds the money.
 *
 * Thirty an hour: a real customer asking real questions does not approach it;
 * a script passes it inside a minute.
 */
const DEFAULT_CLIENT_HOURLY_LIMIT = 30;

/**
 * How long a written answer stays good, in seconds.
 *
 * MIRROR of CATALOG_REVALIDATE_SECONDS in bkk-frontend-next/lib/cachePolicy.ts
 * — the website reads the catalog on that clock, and this answer quotes
 * prices computed from it. Two repos, two languages, so it cannot be one
 * constant — CHANGE BOTH.
 *
 * Both moved 300 -> 3600 in Aug 2026, when the catalog stopped being polled
 * and started being pushed: a Cloud Function now revalidates the website the
 * moment a price is written, so this number is a backstop rather than the
 * freshness mechanism.
 *
 * Worth understanding WHY the paragraph cannot outlive the prices it quotes
 * even at an hour, because it is not this constant that guarantees it: the
 * cache key is a hash of query AND context, and the context carries the
 * prices. A price change produces a different key, so the old paragraph
 * becomes unreachable rather than stale — nothing can look it up to serve it.
 * The TTL only bounds how long an IDENTICAL question about an IDENTICAL
 * catalog is answered from cache, which is exactly what it should bound.
 * Keeping the two numbers equal is belt and braces, and cheap.
 */
const OVERVIEW_CACHE_TTL_SECONDS = 3600;

/**
 * The cache lives HERE rather than in Next, and that is the point.
 *
 * The website's unstable_cache worked in a local production build (1 call for
 * 3 identical requests) but not on Vercel, where every request lands on a
 * different lambda instance — three identical questions produced three
 * different paragraphs and three charges. Rather than keep guessing at a
 * platform's caching semantics, the cache sits beside the thing it protects:
 * the daily cap and the auto-suspension are already here, and so is the only
 * place money is actually spent.
 *
 * Keyed on the CONTEXT as well as the query. The context carries the prices,
 * so when the catalog moves the key moves with it — a price change mid-window
 * cannot leave a stale number being served under the same question.
 */
function cacheKeyFor(query, context, lang = "th") {
  return crypto
    .createHash("sha256")
    .update(`${query}\n\n${context}\n\nlang=${lang === "en" ? "en" : "th"}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Store facts, for the questions the catalog cannot answer.
 *
 * "มีสาขาที่ไหนบ้าง" used to come back as a paragraph of service description
 * with no branch in it: the website had sent the /branches page's marketing
 * blurb and nothing else, and the generator summarised what it was given —
 * correctly, and uselessly.
 *
 * The facts come from service-facts.js, the module the chat assistant reads
 * from, so there is one branch reader in the project rather than two. What is
 * NOT borrowed is how the chat behaves: no tool definitions, no conversation
 * history, no `note:` telling the model to escalate or to attach a map link.
 * The overview has no tools and no thread, and instructions it cannot carry
 * out become promises to a customer that nothing will keep.
 *
 * Topic ids are chosen by the website (lib/serviceTopics.ts) — query
 * understanding lives beside isQuestionQuery rather than being written a
 * second time here, in a second language. They cross the repo boundary as
 * plain strings, so a rename there is a rename here: the same unavoidable
 * seam as OVERVIEW_CACHE_TTL_SECONDS.
 */
const SERVICE_FACTS_MAX_CHARS = 1200;
const MAX_TOPICS = 2;

/**
 * How long a warm instance may reuse the facts it already fetched.
 *
 * The facts go into the cache KEY, which means they have to be fetched before
 * the cache can be consulted — so without this, every request pays the RTDB
 * reads even on a hit. Sixty seconds is short enough that a branch edit shows
 * up while an admin is still looking at the page, and long enough that a burst
 * of searches costs one read instead of hundreds (CLAUDE.md, RTDB cost rules).
 */
const FACTS_MEMO_MS = 60000;
const factsMemo = new Map();

function baht(n) {
  return Number(n || 0).toLocaleString("en-US");
}

/** Contact details, phrased the same way whether they were asked for directly
 *  or arrived alongside branches. */
function contactLines(central) {
  if (!central) return [];
  const bits = [];
  if (central.phone) bits.push(`โทร ${central.phone}`);
  if (central.line_id) bits.push(`LINE ${central.line_id}`);
  if (central.email) bits.push(`อีเมล ${central.email}`);
  if (central.standard_hours) bits.push(`เวลาทำการ ${central.standard_hours}`);
  return bits.length ? [`ช่องทางติดต่อกลาง: ${bits.join(" | ")}`] : [];
}

const TOPIC_RENDERERS = {
  async branches(db) {
    const { central, branches } = await loadBranches(db);
    if (!branches.length) return contactLines(central);
    const lines = [`สาขาที่เปิดให้บริการ (${branches.length} แห่ง):`];
    for (const b of branches) {
      const parts = [b.name];
      if (b.address) parts.push(b.address);
      if (b.open_hours) parts.push(`เปิด ${b.open_hours}`);
      lines.push(`- ${parts.join(" | ")}`);
    }
    return lines.concat(contactLines(central));
  },

  /**
   * The curated market facts — the ONE place anything about a future price
   * may come from.
   *
   * The website owns the same node (bkk-frontend-next lib/priceForecast) and
   * draws the numeric ones as a band on the price chart. This renderer is the
   * second READER of one source, not a second source: nothing here computes a
   * trend, and there is no path on either side from the price history to a
   * prediction. That ban is written out in that module's header; the reason
   * it holds here too is that a buyback price does not move because of its
   * own past, so extending it hands our own pricing decisions to the customer
   * dressed as a market forecast.
   *
   * EXPIRY IS ENFORCED HERE, not just where the fact is written. A fact past
   * its date is skipped, and because the facts are hashed into the cache key
   * (see the call site), the day it lapses the cached paragraphs quoting it
   * stop being reachable too. That is what makes "forgetting to update means
   * saying less, never saying something wrong" true rather than aspirational.
   *
   * PERCENTAGES, NEVER BAHT. This function does not know which device the
   * reader is holding — `appliesTo` is a family, and one search can match a
   * dozen models at a dozen prices. Converting 10-20% into a baht range here
   * would mean picking a price, and the picked one would be wrong for most
   * readers. The chart, which knows the variant, is where the band is drawn
   * in money. Prompt rule 13 forbids the model doing the conversion itself.
   */
  async market_trend(db) {
    const snap = await db.ref("settings/market_facts").once("value");
    const raw = snap.val() || {};
    const now = Date.now();
    const lines = [];

    for (const key of Object.keys(raw)) {
      const f = raw[key];
      if (!f || typeof f !== "object") continue;

      const expiresAt = Number(f.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;

      const label = String(f.label || "").trim();
      const appliesTo = String(f.appliesTo || "").trim();
      if (!label || !appliesTo) continue;

      const certainty = String(f.certainty || "").trim();
      const text = String(f.text || "").trim();

      // Prose wins, exactly as it does in the website's parser: a row with
      // both is a sentence, never a percentage. Two readers of one node that
      // disagreed about which kind a row was would be worse than either
      // choice — this is the same rule, written the same way round.
      if (text) {
        lines.push(`- ${label}: ${text}${certainty ? ` (${certainty})` : ""}`);
        continue;
      }

      const min = Number(f.dropPctMin);
      const max = Number(f.dropPctMax);
      // Both numbers or nothing. A single-figure forecast reads as a target,
      // and a target is a promise about a price we have not agreed to pay.
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      if (min < 0 || max < 0 || max > 100 || min > max) continue;
      if (!certainty) continue;

      lines.push(
        `- ${label}: ราคารับซื้ออาจปรับลงประมาณ ${min}-${max}% จากราคาปัจจุบัน (${certainty})`
      );
    }

    return lines.length
      ? ["แนวโน้มราคาที่ทีมงานประเมินไว้ (ช่วงประมาณการ ไม่ใช่ราคาผูกมัด):"].concat(lines)
      : [];
  },

  async contact(db) {
    const sp = await loadStoreProfile(db);
    return contactLines({
      phone: sp.phone || null,
      line_id: sp.line_id || null,
      email: sp.email || null,
      standard_hours: sp.hours_start && sp.hours_end ? `${sp.hours_start}-${sp.hours_end} น.` : null,
    });
  },

  /**
   * Live campaigns — but ONLY the ones that apply to everybody.
   *
   * A model-restricted coupon is a bonus we cannot promise on a page that does
   * not know which device the reader owns. Announcing "+1,000 บาท" to someone
   * holding the wrong phone is a number they will arrive quoting and we will
   * not pay, which is the same failure the price rules exist to prevent. Those
   * campaigns still reach the customer through /sell and the chat, where the
   * device is known. Province-restricted pickup promotions are dropped for the
   * identical reason: no address here either.
   */
  async promotions(db) {
    const { coupons, pickup_fee_promotions: promos } = await loadPromotions(db);
    const open = coupons.filter((c) => !c.model_restricted);
    const openPromos = promos.filter((p) => !p.province_restricted && !p.model_restricted);
    const lines = [];
    if (open.length) {
      lines.push("โปรโมชั่นที่ใช้ได้กับทุกรุ่นตอนนี้:");
      for (const c of open) {
        const value = c.type === "percentage" ? `+${c.value}%` : `+${baht(c.value)} บาท`;
        const cond = [];
        if (c.min_trade_value) cond.push(`ยอดขั้นต่ำ ${baht(c.min_trade_value)} บาท`);
        if (c.end_date) cond.push(`ถึง ${c.end_date}`);
        lines.push(`- ${c.name || c.code} (${c.code}): ${value}${cond.length ? ` | ${cond.join(" | ")}` : ""}`);
      }
    }
    if (openPromos.length) {
      lines.push("ส่วนลดค่าบริการรับถึงที่:");
      for (const p of openPromos) {
        lines.push(`- ${p.name}${p.end_date ? ` (ถึง ${p.end_date})` : ""}`);
      }
    }
    // Said out loud rather than left as an empty section: "no campaign" is an
    // answer, and silence here invites the model to fill the gap.
    if (!lines.length) {
      lines.push("ตอนนี้ไม่มีโปรโมชั่นที่ใช้ได้กับทุกรุ่น (บางแคมเปญจำกัดเฉพาะบางรุ่น ต้องเช็คจากรุ่นที่ลูกค้าจะขาย)");
    }
    return lines;
  },

  /**
   * The published zone table — a price LIST, never a price.
   *
   * Turning this into a baht figure needs a geocoded address and a distance,
   * which is why that calculation stays in chat-ai.js. The wording below says
   * "เริ่มต้น" and "คิดตามระยะทาง" on purpose: a reader must not come away
   * thinking they have been quoted.
   */
  async delivery(db) {
    const zones = await loadDeliveryZones(db);
    if (!Array.isArray(zones) || !zones.length) return [];
    const lines = ["ค่าบริการไรเดอร์ไปรับถึงที่ (ยอดจริงคำนวณตอนทำรายการ ขึ้นกับระยะทาง):"];
    for (const z of zones) {
      const p = z.pricing || {};
      const how =
        p.type === "flat"
          ? `${baht(p.flatFee)} บาท`
          : `เริ่มต้น ${baht(p.baseFare)} บาท คิดตามระยะทาง${p.maxFee ? ` สูงสุด ${baht(p.maxFee)} บาท` : ""}`;
      lines.push(`- ${z.name}: ${how}${z.etaText ? ` | ใช้เวลาประมาณ ${z.etaText}` : ""}`);
    }
    lines.push("นอกพื้นที่ไรเดอร์: ส่งพัสดุ Mail-in ฟรีทั่วประเทศ หรือนำเครื่องมาที่สาขา");
    return lines;
  },
};

/**
 * Topics answered from the FAQ.
 *
 * The seed query is fixed per topic rather than being the customer's sentence,
 * so the same topic always retrieves the same rows and the cache key stays
 * stable across a hundred phrasings of one question.
 *
 * OFFICIAL_FAQ_LINES is deliberately NOT used here even though it covers the
 * same ground: those lines are written as orders to the chat model ("ตอบว่า…",
 * "ห้ามพูดว่า…"), and feeding instructions to a surface that cannot follow
 * them is the borrowed behaviour this whole design is avoiding. The FAQ rows
 * are plain question-and-answer facts.
 */
const FAQ_TOPICS = {
  payment: "จ่ายเงิน โอนเงิน ได้เงินเร็วแค่ไหน ช่องทางชำระ",
  price_dispute: "ยกเลิกการขาย ราคาจริงต่ำกว่าประเมิน ส่งเครื่องคืน",
  encumbered: "เครื่องผ่อน ติด iCloud Activation Lock MDM",
  data_wipe: "ลบข้อมูล Factory Reset ข้อมูลส่วนบุคคล",
  documents: "เอกสารที่ต้องเตรียม กล่อง ใบเสร็จ",
  defects: "เครื่องจอแตก เครื่องเสีย ตำหนิ รับซื้อไหม",
  process: "ขั้นตอนการขาย ตรวจสภาพเครื่อง",
};

async function renderTopic(db, topic) {
  if (TOPIC_RENDERERS[topic]) return TOPIC_RENDERERS[topic](db);
  const seed = FAQ_TOPICS[topic];
  if (!seed) return [];
  const rows = searchFaq(seed).slice(0, 3);
  if (!rows.length) return [];
  return ["คำถามที่พบบ่อยเรื่องนี้:"].concat(rows.map((r) => `- ${r.q}: ${r.a}`));
}

/** Cached per topic on the warm instance. A read that fails is treated as "no
 *  facts for this topic" — the paragraph is still worth writing from the
 *  catalog alone, and an overview must never fail because a side dish did. */
async function factsFor(db, topic) {
  const hit = factsMemo.get(topic);
  if (hit && hit.until > Date.now()) return hit.lines;
  let lines = [];
  try {
    lines = await renderTopic(db, topic);
  } catch (e) {
    console.warn(`[searchOverview] facts for "${topic}" failed:`, e && e.message);
    return [];
  }
  factsMemo.set(topic, { lines, until: Date.now() + FACTS_MEMO_MS });
  return lines;
}

/**
 * The store-facts block, capped.
 *
 * Truncation is by whole line and announced in the log rather than silently
 * cutting a sentence in half — a fact ending mid-word is worse than a fact
 * that is absent, because the model will finish the thought itself.
 */
/**
 * The hour bucket a call belongs to, Bangkok time.
 *
 * Bangkok rather than UTC so the numbers in the log line up with the working
 * day somebody is reading them in, and with `bangkokYmd` next to it.
 */
function bangkokHourBucket(now = Date.now()) {
  const t = new Date(now + 7 * 3600000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}` +
    `${p(t.getUTCHours())}`
  );
}

/** Whatever the website sent, reduced to something safe to use as a key.
 *  Hex only and short: the website sends a hash, and anything else is either
 *  a mistake or an attempt to write somewhere it should not. */
function sanitizeClientKey(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return /^[a-f0-9]{16,64}$/.test(s) ? s : "";
}

/**
 * Has this client had its hour's worth?
 *
 * COUNTED ONLY WHERE MONEY IS ABOUT TO BE SPENT. This is called after the
 * cache lookup, for the same reason the daily cap is: a cache hit costs
 * nothing, and charging someone for asking a popular question again would
 * throttle the cheapest possible request. What is being protected is the
 * bill, not the number of times a person is allowed to be curious.
 *
 * FAIL-OPEN ON EVERY ERROR. If the counter cannot be read or written, the
 * answer goes ahead. A protective structure that turns a database wobble into
 * a site-wide outage has become the thing it was built to prevent, and the
 * daily cap is still standing behind it.
 */
async function clientOverBudget(db, tag, clientKey, limit) {
  if (!clientKey || !(limit > 0)) return false;
  const bucket = bangkokHourBucket();
  try {
    const tx = await db
      .ref(`overview_rate/${bucket}/${clientKey}`)
      .transaction((cur) => (Number(cur) || 0) + 1);
    const count = Number(tx.snapshot.val()) || 0;
    if (count > limit) {
      // Logged every time it bites, with the hashed key and the count, so the
      // ceiling can be tuned from what actually happened rather than from a
      // guess about what customers do.
      console.warn(
        `[${tag}] client rate limit hit: key=${clientKey.slice(0, 12)} count=${count} limit=${limit} bucket=${bucket}`
      );
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`[${tag}] rate limit check failed, allowing:`, e && e.message);
    return false;
  }
}

async function buildServiceFacts(db, topics) {
  const out = [];
  let used = 0;
  for (const topic of topics) {
    const lines = await factsFor(db, topic);
    for (const line of lines) {
      if (used + line.length + 1 > SERVICE_FACTS_MAX_CHARS) {
        console.warn(`[searchOverview] service facts truncated at ${used} chars (topics: ${topics.join(",")})`);
        return out.length ? `\n\nข้อมูลร้าน (ข้อเท็จจริงจากระบบ):\n${out.join("\n")}` : "";
      }
      out.push(line);
      used += line.length + 1;
    }
  }
  return out.length ? `\n\nข้อมูลร้าน (ข้อเท็จจริงจากระบบ):\n${out.join("\n")}` : "";
}

/** Whatever the caller sent, reduced to something this function recognises. */
function sanitizeTopics(raw) {
  if (!Array.isArray(raw)) return [];
  const known = new Set([...Object.keys(TOPIC_RENDERERS), ...Object.keys(FAQ_TOPICS)]);
  const out = [];
  for (const t of raw) {
    const id = String(t || "").slice(0, 40);
    if (known.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/**
 * What the generator may and may not do.
 *
 * The rules are negative on purpose. A model that knows the going rate for a
 * MacBook Pro M1 from the open internet will volunteer it, and a number we did
 * not set is a number we will be held to at the door.
 */
function buildOverviewSystemPrompt(assistantName, lang = "th") {
  return [
    `คุณคือ${assistantName} ผู้ช่วยของ BKK APPLE ร้านรับซื้ออุปกรณ์ Apple มือสอง`,
    "หน้าที่ของคุณคือสรุปคำตอบสั้นๆ ให้ลูกค้าที่พิมพ์คำถามเข้ามาในช่องค้นหาของเว็บ",
    "",
    "กฎเหล็ก (ห้ามฝ่าฝืนทุกกรณี):",
    "1. ตัวเลขทุกตัวที่คุณพูดถึง ต้องมาจาก 'ข้อมูลจากระบบ' ที่ให้ไว้ด้านล่างเท่านั้น",
    "2. ห้ามใช้ความรู้ทั่วไปเรื่องราคาเครื่องมือสอง ราคาตลาด ราคาร้านอื่น หรือราคาที่คุณเคยเห็นที่ไหนมาก่อน เด็ดขาด",
    "3. ถ้าข้อมูลที่ให้มาไม่พอจะตอบคำถาม ให้บอกตรงๆ ว่ายังไม่มีข้อมูลรุ่นนั้น แล้วชวนให้ประเมินราคา ห้ามเดา",
    "4. ห้ามอ้างสเปก ปีที่วางขาย หรือรายละเอียดสินค้าที่ไม่ได้อยู่ในข้อมูลที่ให้มา",
    "5. ราคาที่บอกคือราคารับซื้อของเรา ไม่ใช่ราคาขายต่อในตลาด ห้ามเปรียบเทียบกับราคาที่ขายเองได้",
    "6. รุ่นที่ระบุว่างดรับซื้อ ให้บอกตามนั้น ห้ามเสนอราคาให้",
    "7. ห้ามใช้อีโมจิ",
    // The rule that stops the production bug from coming back: the per-model
    // rows are a SAMPLE, and a range computed from a sample is stated as if
    // it covered everything. The website sends the true span of every match
    // as its own line precisely so this can be forbidden.
    // Both wordings on purpose. The website and this function deploy on
    // separate pipelines, so for one window the box is served by a new
    // function reading an old context line, or the reverse. A rule that names
    // only one of them points at nothing for that window — and "no line to
    // use" is precisely the state in which the model computes a combined
    // range from the sample, which is the bug rule 8 exists to stop.
    "8. ถ้าจะพูดถึง 'ช่วงราคารวม' ของหลายรุ่น ให้ใช้ตัวเลขจากบรรทัดที่ขึ้นต้นว่า 'ช่วงราคารับซื้อรวมของ' (หรือรูปเดิม 'ช่วงราคารับซื้อของทุกรุ่นที่ตรงกับคำค้นนี้') เท่านั้น ห้ามคำนวณช่วงรวมเองจากรายการรุ่นด้านล่าง เพราะรายการนั้นอาจแสดงไม่ครบทุกรุ่น",
    // The label bug, ส.ค. 2569. Rule 8 protects the DIGITS of the combined
    // range and says nothing about whose range it is, so the model kept the
    // numbers and swapped the subject: asked about "iPhone 14 Pro 128GB" it
    // wrote "ช่วงราคาทั่วไปสำหรับ iPhone 14 Pro 128GB: ... - 16,000" with the
    // Pro MAX's 16,000 inside. Every digit verifies, which is exactly why
    // exciseUnverifiedNumbers lets it through — nothing checks labels. The
    // website now names the models on that line (OverviewGroupRange.names);
    // this rule is the second lock, not the first.
    "8.1 ช่วงราคารวมเป็นของหลายรุ่นรวมกัน ห้ามเขียนว่าเป็นราคาของรุ่นใดรุ่นหนึ่ง หรือของรุ่นที่ลูกค้าพิมพ์มา แม้ลูกค้าจะระบุมารุ่นเดียว — ถ้าบรรทัดนั้นบอกว่าเป็นของหลายรุ่น ต้องเขียนให้ชัดว่าเป็นช่วงของหลายรุ่นรวมกัน ราคาของรุ่นที่ลูกค้าถามให้ใช้บรรทัดของรุ่นนั้นเท่านั้น",
    // The failure this rule is written against: asked "มีสาขาที่ไหนบ้าง" with
    // only catalog rows in hand, the model wrote a fluent paragraph about the
    // service. It read like an answer and contained none. When the facts do
    // not cover the question, saying so is the answer.
    "9. ถ้าข้อมูลจากระบบด้านล่างไม่มีคำตอบของสิ่งที่ลูกค้าถาม (เช่น ถามเรื่องสาขาหรือขั้นตอน แต่ได้มาแต่ราคารุ่น) ให้บอกตรงๆ ในประโยคแรกว่ายังไม่มีข้อมูลส่วนนั้นตรงนี้ แล้วชี้ว่าหน้าไหนในเว็บน่าจะมี — ห้ามเขียนย่อหน้าที่ฟังดูเหมือนคำตอบโดยไม่มีข้อมูลรองรับ",
    // Rules 10-11 ship BEFORE the website starts sending computed deduction
    // lines (deploy order: function first, always). The moment those lines
    // appear in the context, the model must already treat them as read-only
    // figures. Until then both rules match nothing, which is the safe
    // direction — same reasoning as the service-facts line that forbids
    // quoting a deduction percentage.
    "10. ถ้ามีบรรทัดระบุยอดหักตามสภาพ นั่นคือตัวเลขที่ระบบคำนวณจากเกณฑ์ประเมินจริงของรุ่นนั้นแล้ว ให้ใช้ตัวเลขนั้นตรงๆ เท่านั้น ห้ามคำนวณยอดหักหรือเปอร์เซ็นต์การหักเองจากราคารับซื้อ และตำหนิที่ไม่มีบรรทัดยอดหักให้ ห้ามประมาณตัวเลขเองเด็ดขาด ให้บอกว่าต้องตรวจสภาพจริงก่อนจึงจะทราบยอด",
    "11. ยอด 'เหลือประมาณ' ทุกตัวเป็นการประเมินก่อนตรวจเครื่องจริง ถ้าพูดถึงต้องบอกกำกับว่ายอดสุดท้ายยืนยันอีกครั้งหลังตรวจสภาพเครื่อง ห้ามใช้คำว่ารับประกัน การันตี หรือคำที่ทำให้เข้าใจว่าเป็นยอดที่ตกลงแล้ว",
    // Search is answer-then-stop. This box is written once, cached per query,
    // and never hears a reply — a question back ("ความจุเท่าไหร่ครับ?") is a
    // conversation opener on a surface with no ears. Asking is the chat's and
    // the assessment form's job; the overview answers from what it was given
    // and says plainly when that is not enough (rules 3 and 9).
    "12. ห้ามถามคำถามกลับไปหาลูกค้าไม่ว่ากรณีใด — สรุปจากข้อมูลที่มีให้จบในคำตอบเดียว ถ้าข้อมูลไม่พอให้บอกตรงๆ ตามข้อ 3 และข้อ 9 การซักถามข้อมูลเพิ่มเป็นหน้าที่ของแชทและฟอร์มประเมินราคา ไม่ใช่ของกล่องสรุปนี้",
    // The market-trend facts are the only sanctioned way to say anything
    // about a future price, and they arrive as a PERCENTAGE range with a
    // hedge attached. Three failure modes are foreclosed at once: inventing
    // a forecast when none was supplied, tightening a range into a single
    // number, and turning a percentage into baht — which would require
    // picking a price the renderer deliberately did not pick, because one
    // search matches many models at many prices.
    //
    // The last clause is about tone rather than fact. A true statement that
    // the price may fall becomes a sales tactic the moment it is phrased as
    // urgency, and this box is read by someone deciding whether to sell us
    // their phone.
    "13. เรื่องแนวโน้มราคาในอนาคต ให้พูดได้เฉพาะจากบรรทัด 'แนวโน้มราคาที่ทีมงานประเมินไว้' เท่านั้น ถ้าไม่มีบรรทัดนั้นห้ามคาดการณ์เองเด็ดขาด และเมื่อมี: ห้ามเปลี่ยนช่วงเปอร์เซ็นต์เป็นตัวเลขเดียว ห้ามแปลงเปอร์เซ็นต์เป็นจำนวนบาท ห้ามตัดข้อความกำกับความไม่แน่นอนออก และห้ามใช้ถ้อยคำเร่งเร้าให้รีบขาย",
    "",
    "รูปแบบคำตอบ: ตอบเป็น JSON เท่านั้น ไม่ต้องมีข้อความอื่นนอก JSON",
    '{"summary": "...", "detail": "..."}',
    "- summary = ย่อหน้าเดียว 2-3 ประโยค ตอบคำถามให้ตรงที่สุด พร้อมตัวเลขจริง",
    "- detail = ส่วนขยายที่ยาวได้ (รายรุ่น เงื่อนไขที่ทำให้ราคาต่างกัน หน้าที่เกี่ยวข้อง) ถ้าไม่มีอะไรจะขยายให้ใส่ค่าว่าง",
    // NO closing call to action. The website renders a real button under this
    // paragraph, built from the catalog rows the facts came from — so a
    // written "กดประเมินราคา" is the same instruction twice, once from a
    // thing that can be pressed and once from a thing that cannot.
    "- ห้ามเขียนชวนให้กดประเมินราคาหรือกดปุ่มใดๆ ปิดท้าย เว็บมีปุ่มให้อยู่แล้ว",
    "- ห้ามใส่ลิงก์ URL หรือชื่อปุ่มลงในคำตอบ",
    // v1 gets the language switch too. The A/B note below says this prompt
    // stays as production serves it — that is about ANSWER QUALITY, and
    // answering an English customer in Thai is not a quality position either
    // side is meant to hold. Both arms speak the customer's language, so the
    // comparison stays like-for-like.
    ...(lang === "en" ? languageLines(lang) : ["- ภาษาไทย สุภาพ กระชับ ลงท้ายด้วยครับ"]),
  ].join("\n");
}

/** Pull the JSON object out of whatever the model returned. */
function parseOverview(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const summary = String(obj.summary || "").trim();
    if (!summary) return null;
    return { summary, detail: String(obj.detail || "").trim() };
  } catch {
    return null;
  }
}


// ─── Answer archive ──────────────────────────────────────────────────────────
//
// WHAT THIS IS FOR, and the line it must not cross.
//
// The customer's QUESTION is owned by one system: the search analytics table
// in Firestore, written by bkk-frontend-next, where it is redacted before it
// is stored and deleted after 90 days. This archive is the other half — the
// things only the GENERATOR knows and the website has no way to see: which
// model answered, how long it took, how much context it was given, and every
// reason a request was refused.
//
// So the rule for this whole section, and the reason the tests walk every
// field of every row: NOTHING WRITTEN HERE MAY CONTAIN THE CUSTOMER'S WORDS.
// Not the query, not a fragment of it, not a "sample" of one. The moment it
// does, this project has two stores of customer questions with two different
// retentions and two different redaction rules, and the sentence in /privacy
// that says we do not keep raw search text becomes false in the quietest
// possible way.
//
// The join back to a question is `cacheKey` — the sha256 of query+context
// that already exists to key the cache. It is returned to the website, which
// stores it on its own (redacted) row. One identity, two halves, no text
// copied across the boundary.
//
// Path: search_overview_archive/{ymd}/{hash} for anything with an answer
// identity, and search_overview_archive/{ymd}/_gate/{reason} for refusals
// that happen BEFORE a hash exists. The node is not declared in
// database.rules.json, so it inherits the root deny — no client can read it,
// exactly like search_overview_cache next to it.

/**
 * The cache row, as a builder so a test can prove what it does NOT contain.
 *
 * `query` USED TO BE HERE and was removed: it was the customer's raw text,
 * unredacted, stored under a hash for an hour, and nothing ever read it —
 * the cache lookup uses `expires_at`, `summary` and `detail` and never
 * touched it (verified across all three repos before removing). It was the
 * one place customer words lived outside the system that owns them.
 */
function buildCacheRow({ summary, detail, keyPoints, primaryModelId, quote, now }) {
  const points = (Array.isArray(keyPoints) ? keyPoints : []).map((k) => String(k)).filter(Boolean);
  return {
    summary: String(summary || ""),
    detail: String(detail || ""),
    // The v2 key-point pointers, already verified verbatim against the served
    // summary/detail before they get here — cached so a hit highlights the
    // same phrases the original answer did. Absent on v1 rows and on answers
    // without any. (Older rows may still carry the single `key_point` field —
    // the hit path passes it through untouched and the new frontend simply
    // ignores it: no highlight, no error.)
    ...(points.length ? { key_points: points } : {}),
    // The CTA pointer, already validated against the ingredient model ids.
    ...(primaryModelId ? { primary_model_id: String(primaryModelId) } : {}),
    // The single figure, when the gate allowed one. Cached WITH the answer
    // because the cache key is a hash of the ingredients, so a price edit, a
    // condition-set edit or a paused model already moves the key — a quote
    // stored here can never outlive the facts it was computed from. Serving a
    // hit without it would show the paragraph's number and no card, which
    // reads as the page disagreeing with itself.
    ...(quote ? { quote } : {}),
    created_at: Number(now) || 0,
    expires_at: (Number(now) || 0) + OVERVIEW_CACHE_TTL_SECONDS * 1000,
  };
}

const ARCHIVE_ROOT = "search_overview_archive";

/**
 * A generated answer.
 *
 * `inputChars` rather than the context itself: the size is what tells you
 * whether a slow answer was a big prompt or a slow model, and the context
 * contains prices and store facts that are already in the catalog. Storing
 * the text would also mean storing the customer's query inside it, because
 * the context is built around the question.
 */
function buildArchiveAnswerRow({ model, latencyMs, inputChars, summary, detail, topics, ts, v2, extractModel, extractMs, salvaged, excised, keyPoints, keyPointsDropped }) {
  const row = {
    model: String(model || ""),
    latencyMs: Number(latencyMs) || 0,
    inputChars: Number(inputChars) || 0,
    // OUR OWN words: written by our generator from our own catalog facts.
    // This is the half a reviewer needs to judge whether an answer was any
    // good, which is the entire point of keeping it.
    summary: String(summary || ""),
    detail: String(detail || ""),
    topics: Array.isArray(topics) ? topics.map(String) : [],
    ts: Number(ts) || 0,
    // The channel dimension, stamped at every write point from the day the
    // dashboard shipped — it must exist BEFORE the second channel opens, so
    // day one of split traffic is already split. This archive only ever holds
    // search answers today; the constant is the honest value, not a guess.
    origin: "search",
  };
  // The v2 pipeline's extra half: which model read the query and how long it
  // took, so the archive can split extraction cost from writing cost. Absent
  // on v1 rows — and, like every field here, never the customer's words.
  if (v2 === true) {
    row.v2 = true;
    row.extract_model = String(extractModel || "");
    row.extractMs = Number(extractMs) || 0;
    // Repair telemetry, countable per day: how often the tolerant parser had
    // to salvage, and how many sentences the number gate cut. Both are the
    // probe's round-1 findings turned into measurable fields.
    if (salvaged === true) row.salvaged = true;
    if (Number(excised) > 0) row.excised = Number(excised);
    // WHICH PHRASES THE ANSWER PUT IN BOLD, and how many it proposed that did
    // not survive.
    //
    // Without this pair, an answer with no highlight is unreadable from here:
    // "the writer chose not to mark anything" (allowed, and correct for a
    // short or guidance answer) and "it marked three phrases and wrote all
    // three differently in the prose, so every one was dropped" look
    // identical. The first is the system working; the second is the model
    // failing the same way over and over where nobody can see it.
    //
    // SAFE BY CONSTRUCTION, not by promise: admittedKeyPoints only returns
    // phrases that appear verbatim in the served summary or detail, both of
    // which are already on this row. Storing them adds ZERO new text to a
    // node whose one rule is that the customer's words never reach it — it
    // records which slices of our own sentences were chosen. The rejected
    // phrases are the opposite (by definition they match nothing stored, and
    // a drifting writer could have echoed the question into one), so only
    // their COUNT is kept.
    if (Array.isArray(keyPoints) && keyPoints.length) row.key_points = keyPoints.map(String);
    if (Number(keyPointsDropped) > 0) row.key_points_dropped = Number(keyPointsDropped);
  }
  return row;
}

/**
 * A refusal, on a request that had got far enough to have an identity.
 *
 * Reason only. Which question hit the cap is answerable by joining the hash
 * back to the analytics row; repeating the question here would be the second
 * copy this file exists to avoid.
 */
function buildArchiveSkipRow(reason, ts) {
  return { skipped: String(reason || "unknown"), ts: Number(ts) || 0, origin: "search" };
}

/**
 * A cache hit, as a patch on the row the answer already wrote.
 *
 * A TRANSACTION rather than a blind update, for one reason: the row may not
 * exist. A blind `update` would create `{hits, lastHitTs}` and no `ts`, and a
 * row with no timestamp of its own is a row nobody can place in time. The
 * transaction lets an orphan be seeded properly while an existing row keeps
 * the answer — and its original `ts` — untouched.
 *
 * ONE EDGE, worth knowing before reading the data: the row is bucketed by
 * TODAY, while the answer may have been generated yesterday (the cache holds
 * for an hour, so this only happens across midnight). Those rows carry hits
 * and no answer text, and that is what they mean — the answer lives in the
 * bucket of the day it was written.
 */
function buildArchiveHitRow(current, ts) {
  const at = Number(ts) || 0;
  // No row yet: the answer was generated before this archive existed, or
  // yesterday (the cache holds an hour, so this is the midnight case). Seed a
  // row that says what it is — reuse, no answer text — rather than skipping
  // the hit. Backfilling the missing answer is not worth a read on this path.
  if (!current) return { hits: 1, lastHitTs: at, ts: at, origin: "search" };
  // A row exists: bump it and leave everything else exactly as the answer
  // wrote it. `ts` is the moment the ANSWER was written and must survive
  // every later hit — overwriting it would make a popular answer look freshly
  // generated every time somebody asked again.
  return { ...current, hits: (Number(current.hits) || 0) + 1, lastHitTs: at };
}

/**
 * Every archive write goes through here, and none of them is awaited.
 *
 * The archive is a record of an answer, not part of producing one. A customer
 * waiting on a paragraph must never wait on a write to it, and an archive
 * that is down must never turn a good answer into a failed request — so this
 * returns immediately, swallows rejections into a warn, and cannot throw even
 * if `db.ref` itself blows up.
 */
function archiveWrite(db, tag, path, mutate) {
  try {
    const ref = db.ref(path);
    const p = mutate(ref);
    if (p && typeof p.catch === "function") {
      p.catch((e) => console.warn(`[${tag}] archive write failed (${path}):`, e));
    }
  } catch (e) {
    console.warn(`[${tag}] archive write threw (${path}):`, e);
  }
}

/** Refusals that happen before a hash exists are counted per reason per day.
 *  A counter, not a row: there is no answer identity to hang one on, and the
 *  question that would identify it belongs to the other system. */
function archiveGateSkip(db, tag, ymd, reason) {
  archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/_gate/${reason}`, (ref) =>
    ref.set(ServerValue.increment(1))
  );
}


/**
 * How many rows one sweep may delete.
 *
 * A cap rather than "everything expired", because the first sweep meets a
 * cache nobody has ever pruned and a single delete of every row in it is a
 * write spike against the same database that is serving customers. Whatever
 * is left over is still expired an hour later, and the sweep runs every day —
 * the backlog drains, it just drains politely.
 */
const CACHE_GC_BATCH = 500;

/**
 * Delete answers whose hour is up.
 *
 * The cache had no reaper. It grows with the number of DISTINCT questions
 * ever asked, and every expired row is dead weight: unreachable by
 * construction (the key is a hash of the question and the prices, so a
 * changed price makes the old row unfindable rather than stale) and paid for
 * in storage forever.
 *
 * QUERIED, NOT SCANNED. `orderByChild("expires_at")` needs `.indexOn` on this
 * node — it lives in bkk-frontend-next/database.rules.json, the one place
 * rules are allowed to live. Without the index RTDB still answers correctly,
 * but by downloading the entire node and filtering in the client, which is
 * the exact bill this function exists to stop growing. If the log line below
 * ever reports a large `scanned` with a small `deleted`, check the index
 * first.
 *
 * FOUR IN THE MORNING, not three: the daily archive rollup already runs at
 * three, and two sweeps of the same database in the same minute make each
 * other's timings unreadable when something goes wrong at four in the
 * morning.
 */
async function runCacheGc(db, tag) {
  const now = Date.now();
  const snap = await db
    .ref("search_overview_cache")
    .orderByChild("expires_at")
    .endAt(now)
    .limitToFirst(CACHE_GC_BATCH)
    .once("value");

  const updates = {};
  let scanned = 0;
  snap.forEach((child) => {
    scanned += 1;
    // Belt and braces against a row with no expiry at all: those are not
    // expired, they are malformed, and deleting data because a field is
    // missing is how a cleanup turns into data loss.
    const exp = Number(child.val() && child.val().expires_at);
    if (Number.isFinite(exp) && exp <= now) updates[child.key] = null;
    return false;
  });

  const deleted = Object.keys(updates).length;
  if (deleted) await db.ref("search_overview_cache").update(updates);
  return { scanned, deleted, batch: CACHE_GC_BATCH };
}

/**
 * The hourly rate buckets, which expire by simply being yesterday's.
 *
 * Kept in the same sweep because they have the same shape of problem — a node
 * that only ever grows — and because a second scheduler for two dozen small
 * deletes is more moving parts than the job deserves.
 */
/**
 * How long an answer row lives.
 *
 * 90 days, matching the search analytics table in Firestore that owns the
 * other half of the same record. The two halves are joined by `cacheKey`, and
 * a join whose halves expire on different clocks is a record that quietly
 * becomes half-readable: the question redacted and gone, our answer to it
 * still here, referenced by an id that now points at nothing. Whatever the
 * privacy page promises about one of them has to be true of both.
 */
const ARCHIVE_RETENTION_DAYS = 90;

/**
 * How far past the cutoff each sweep reaches. The job runs daily, so one day
 * would normally do; 30 means a month of the scheduler being off (or of this
 * function failing) still heals itself on the next successful run.
 */
const ARCHIVE_GC_WINDOW_DAYS = 30;

/**
 * Delete day nodes older than the retention — WITHOUT READING ANYTHING.
 *
 * The archive is keyed by Bangkok day, so the paths to remove can be computed
 * from the clock instead of listed. That matters here specifically: RTDB
 * bills by bytes downloaded, and the obvious implementation (read the root,
 * look at the keys) would pull every archived answer down every night just to
 * learn their names — the archive would cost more to tidy than to keep.
 * A multi-path update of nulls removes what exists and no-ops on the rest.
 *
 * Left deliberately outside the window: nothing sweeps days older than
 * retention + window. If this job is ever off for longer than that, those
 * days need one manual pass — the alternative is a listing read, which is the
 * cost this design exists to avoid.
 */
async function runArchiveGc(db, now = Date.now()) {
  const updates = {};
  for (let age = ARCHIVE_RETENTION_DAYS; age < ARCHIVE_RETENTION_DAYS + ARCHIVE_GC_WINDOW_DAYS; age++) {
    updates[bangkokYmd(now - age * 86400000)] = null;
  }
  const days = Object.keys(updates).sort();
  await db.ref(ARCHIVE_ROOT).update(updates);
  return { oldest: days[0], newest: days[days.length - 1], days: days.length };
}

async function runRateBucketGc(db) {
  const keepFrom = bangkokHourBucket(Date.now() - 48 * 3600000);
  const snap = await db.ref("overview_rate").once("value");
  const updates = {};
  snap.forEach((child) => {
    if (String(child.key) < keepFrom) updates[child.key] = null;
    return false;
  });
  const deleted = Object.keys(updates).length;
  if (deleted) await db.ref("overview_rate").update(updates);
  return { deleted };
}

/**
 * One Anthropic text call, the way this file has always made it — raw fetch,
 * no SDK, its own timeout. Shared by the v1 writer, the v2 extractor and the
 * v2 writer so there is exactly one place the request shape lives.
 */
async function callAnthropicText({ apiKey, model, system, user, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!apiRes.ok) {
      const detail = await apiRes.text();
      const err = new Error(`Anthropic ${apiRes.status}: ${detail.slice(0, 300)}`);
      err.status = apiRes.status;
      throw err;
    }
    const data = await apiRes.json();
    return {
      text: (data.content || [])
        .filter((b) => b && b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim(),
      // The response's own token count, passed up so the caller can mirror it
      // into the daily ledger's by_origin dimension (recordAiUsage) — cost
      // per channel from REAL tokens, not an estimate.
      usage: data.usage || {},
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The store-facts half of the V2 CACHE KEY.
 *
 * V2's key is query + ingredients, and the ingredients never carry the branch
 * list or the live promotions — stage 2 loads those here, AFTER the cache
 * lookup. Without this hash a branch edit could not bust a cached v2 answer
 * that quotes the old branch. So the RTDB-backed topic blocks are rendered
 * (through the same 60s memo stage 2 reads, so a hit costs no extra reads
 * beyond that window) and hashed into the key. FAQ topics are code-static —
 * a deploy changes them, and a deploy restarts the instance — so they are
 * deliberately not part of the hash.
 */
const V2_FACT_VERSION_TOPICS = ["branches", "contact", "promotions", "delivery"];
async function v2FactsVersion(db) {
  const blocks = [];
  for (const t of V2_FACT_VERSION_TOPICS) {
    blocks.push((await factsFor(db, t)).join("\n"));
  }
  return crypto.createHash("sha256").update(blocks.join("\n\n")).digest("hex").slice(0, 16);
}

/**
 * POST { query, context, topics? } -> { summary, detail } | { skipped: reason }
 * POST { query, v2: true, ingredients } -> same shape, via the two-call
 *   pipeline in search-overview-v2.js (stage 1 reads the raw query against
 *   the ingredient lists, code assembles the context, stage 3 writes).
 *
 * Always 200 with a body the caller can read. A search page must never fail
 * because the optional paragraph above the results could not be written, so
 * every refusal is a named reason rather than a status code the caller has to
 * guess at — and the website renders nothing at all when one comes back.
 */
function registerSearchOverview({ dispatchOpsAlert }) {
  const customerSearchOverview = onRequest(
    // 40s, not 30: a v2 miss makes two model calls back to back (8s + 20s
    // ceilings) and the platform must not kill the writer mid-sentence.
    { region: REGION, cors: false, timeoutSeconds: 40 },
    async (req, res) => {
      const tag = "searchOverview";
      if (req.method !== "POST") {
        res.status(405).json({ skipped: "method_not_allowed" });
        return;
      }

      // FAIL CLOSED, same rule as migrateOldJobs: an unset secret disables the
      // endpoint rather than opening it.
      const expected = process.env.SEARCH_OVERVIEW_KEY || "";
      if (!expected) {
        console.error(`[${tag}] refused: SEARCH_OVERVIEW_KEY is not configured`);
        res.status(503).json({ skipped: "not_configured" });
        return;
      }
      const given = String(req.get("x-search-overview-key") || "");
      if (given !== expected) {
        res.status(403).json({ skipped: "forbidden" });
        return;
      }

      const body = req.body || {};
      const query = String(body.query || "").trim().slice(0, 200);
      // The catalog half is capped here; the store-facts half has its own cap
      // and is appended below, so the two cannot squeeze each other out.
      const catalogContext = String(body.context || "").trim().slice(0, MAX_CONTEXT_CHARS);
      const topics = sanitizeTopics(body.topics);
      // Absent on an older website deployment, and that is a supported state:
      // the limit is simply inert until the caller identifies itself.
      const clientKey = sanitizeClientKey(body.clientKey);
      // The v2 pipeline is opted into per request, never by a server flag:
      // the website decides which pipeline a search uses (its env flag), and
      // a v1 payload must keep working unchanged through the whole rollout.
      const isV2 = body.v2 === true;
      // Which language EDITION of the site the visitor is on (/en vs the Thai
      // default). Absent on an older website deployment, and that is a
      // supported state: no value means Thai, which is the behaviour that
      // shipped before this field existed.
      const pageLang = body.lang === "en" ? "en" : "th";
      const ingredients = isV2 ? sanitizeIngredients(body.ingredients) : null;
      if (!query || (isV2 ? !ingredients : !catalogContext)) {
        res.status(400).json({ skipped: "empty_request" });
        return;
      }

      const db = getDatabase();

      // The same gate the chat widget answers to, read from the same node.
      // "The assistant is off" and "the assistant is broken" both mean there
      // is no AI on this site right now, and a summary written by the thing
      // we just told everyone is unavailable would be a strange exception.
      // From here on the caller is authenticated and has sent a real question,
      // so every outcome is archived. The refusals ABOVE this point
      // (method_not_allowed / not_configured / forbidden / empty_request) are
      // deliberately not: they never reached the decision, and writing a row
      // for `forbidden` would hand an unauthenticated caller a way to make us
      // write to the database.
      const gateYmd = bangkokYmd();

      let pub = {};
      try {
        pub = (await db.ref("settings/chat_widget/public").once("value")).val() || {};
      } catch (e) {
        console.error(`[${tag}] settings read failed:`, e);
        archiveGateSkip(db, tag, gateYmd, "settings_unavailable");
        res.json({ skipped: "settings_unavailable" });
        return;
      }
      if (pub.enabled !== true || pub.ai_suspended === true) {
        const reason = pub.ai_suspended === true ? "suspended" : "disabled";
        archiveGateSkip(db, tag, gateYmd, reason);
        res.json({ skipped: reason });
        return;
      }

      // Its own key first, so overview spend can be billed apart from the
      // chat's — falling back to the shared key keeps today's single-key
      // setup working unchanged until OVERVIEW_API_KEY is actually set.
      const apiKey = process.env.OVERVIEW_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        archiveGateSkip(db, tag, gateYmd, "no_api_key");
        res.json({ skipped: "no_api_key" });
        return;
      }

      // FACTS FIRST, THEN THE KEY. The store facts are part of what the answer
      // is written from, so they belong inside the hash: a branch edit or an
      // expiring campaign has to move the key with it, exactly as a price
      // change already does. Hashing the catalog half alone would serve a
      // paragraph naming a branch that closed this morning.
      //
      // The cost of that ordering is that a cache HIT still pays these reads,
      // which is what the per-instance memo above is for.
      //
      // V2 keys on the INGREDIENTS instead of a finished context — the
      // context does not exist until stage 2, and a hit must cost zero model
      // calls — plus v2FactsVersion for the store-facts half. Same property,
      // computed from the halves that exist before any money is spent.
      // Decided once, from the customer's own text plus the edition they are
      // on, and used by whichever writer runs.
      //
      // IT MUST BE IN THE KEY. The same query on /en and on the Thai site is
      // now two different answers; sharing one cache entry would serve
      // whichever language arrived first to everyone for the next hour — a
      // wrong-language answer that no amount of retrying could shake off,
      // which is worse than the bug this whole change is fixing.
      const answerLang = answerLanguage(query, pageLang);
      if (answerLang !== "th") console.log(`[${tag}] answering in ${answerLang}`);

      let context = "";
      let key;
      if (isV2) {
        key = v2CacheKey(query, ingredients, await v2FactsVersion(db), answerLang);
      } else {
        const facts = topics.length ? await buildServiceFacts(db, topics) : "";
        context = catalogContext + facts;
        key = cacheKeyFor(query, context, answerLang);
      }

      // CACHE BEFORE CAP, deliberately. The daily ceiling exists to bound
      // spending, and a cache hit spends nothing — counting it would let
      // popular questions exhaust a budget they are not consuming.
      const cacheRef = db.ref(`search_overview_cache/${key}`);
      try {
        const hit = (await cacheRef.once("value")).val();
        if (hit && Number(hit.expires_at) > Date.now() && hit.summary) {
          archiveWrite(db, tag, `${ARCHIVE_ROOT}/${bangkokYmd()}/${key}`, (ref) =>
            ref.transaction((cur) => buildArchiveHitRow(cur, Date.now()))
          );
          res.json({
            summary: hit.summary,
            detail: hit.detail || "",
            // Legacy single-pointer rows pass through as-is until they expire
            // (TTL 1h) — the new frontend ignores key_point: no highlight, no
            // error. New rows carry key_points/primary_model_id instead.
            ...(hit.key_point ? { key_point: String(hit.key_point) } : {}),
            ...(Array.isArray(hit.key_points) && hit.key_points.length
              ? { key_points: hit.key_points.map((k) => String(k)) }
              : {}),
            ...(hit.primary_model_id ? { primary_model_id: String(hit.primary_model_id) } : {}),
            // Absent on v1 rows and on any answer the gate refused — the
            // frontend renders the range exactly as it does today.
            ...(hit.quote ? { quote: hit.quote } : {}),
            cached: true,
            cacheKey: key,
          });
          return;
        }
      } catch (e) {
        // A cache that cannot be read is a cache miss, never an error: the
        // customer's paragraph must not depend on this lookup succeeding.
        console.warn(`[${tag}] cache read failed:`, e);
      }

      const ymd = bangkokYmd();

      // SECOND BRAKE, BEFORE THE FIRST IS TOUCHED. Checked after the cache
      // (a hit spends nothing) and before the daily counter, so a throttled
      // client does not consume a slot out of the site-wide ceiling on its
      // way to being refused.
      //
      // The refusal is a `skipped`, exactly like "disabled" and
      // "cap_reached": the website turns every skipped reason into the same
      // null and falls back to what it can render itself. A reader behind a
      // shared address — a shop, a campus — loses the AI paragraph for the
      // rest of the hour and loses nothing else.
      const clientLimit =
        Number(process.env.OVERVIEW_CLIENT_HOURLY_LIMIT) ||
        Number(pub.hourly_overview_client_limit) ||
        DEFAULT_CLIENT_HOURLY_LIMIT;
      if (await clientOverBudget(db, tag, clientKey, clientLimit)) {
        archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
          ref.update(buildArchiveSkipRow("rate_limited", Date.now()))
        );
        res.json({ skipped: "rate_limited", cacheKey: key });
        return;
      }

      const cap = Number(pub.daily_overview_cap) || DEFAULT_DAILY_OVERVIEW_CAP;
      const capTx = await db
        .ref(`chat_ai_usage/${ymd}/overview_calls`)
        .transaction((cur) => (Number(cur) || 0) + 1);
      if ((Number(capTx.snapshot.val()) || 0) > cap) {
        console.warn(`[${tag}] daily overview cap reached (${cap})`);
        archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
          ref.update(buildArchiveSkipRow("cap_reached", Date.now()))
        );
        res.json({ skipped: "cap_reached", cacheKey: key });
        return;
      }

      const assistantName = String(pub.assistant_name || "มาติน");
      const overviewModel = process.env.OVERVIEW_MODEL || DEFAULT_OVERVIEW_MODEL;
      const extractModel = process.env.OVERVIEW_EXTRACT_MODEL || DEFAULT_OVERVIEW_MODEL;
      let extractMs = 0;
      let answerTopics = topics;
      // v2 only: the primary_model_id legend rides in the USER MESSAGE, never
      // inside `context` — the excise gate whitelists every digit run in the
      // context, and catalog ids can contain digits. Empty on v1, so the v1
      // user message stays byte-identical.
      let v2Legend = "";
      /** The single figure stage 2 computed, when its gate allowed one. Null
       *  on v1, and on every v2 answer that has to stay a range. */
      let quote = null;
      // Measured around each Anthropic call alone. Wrapping the cache read and
      // the facts load into it would report a number nobody can act on: those
      // are our own database, and the question the archive answers is whether
      // the MODEL is slow.
      let startedAt = Date.now();
      try {
        if (isV2) {
          // ── Stage 1: the model reads the raw query against the id lists ──
          const exStart = Date.now();
          const ex = await callAnthropicText({
            apiKey,
            model: extractModel,
            system: buildExtractSystemPrompt(),
            user: buildExtractUser(query, ingredients),
            maxTokens: EXTRACT_MAX_TOKENS,
            timeoutMs: EXTRACT_TIMEOUT_MS,
          });
          recordAiUsage(db, { origin: "search", model: extractModel, usage: ex.usage });
          extractMs = Date.now() - exStart;
          const parsedExtraction = parseExtraction(ex.text, ingredients);
          // Applied here, once, so the answerability gate, the context and
          // the primary-model legend below all read the same extraction —
          // see recoverMatchedModels for the case it exists to catch.
          const extraction = recoverMatchedModels(ingredients, parsedExtraction);
          if (!extraction) {
            console.warn(`[${tag}] v2 extract unparseable for "${query}"`);
            archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
              ref.update(buildArchiveSkipRow("extract_unparseable", Date.now()))
            );
            res.json({ skipped: "extract_unparseable", cacheKey: key });
            return;
          }
          // Ids outside the lists are already gone — parseExtraction dropped
          // them — but the drop is logged, because a model that keeps
          // inventing ids is a prompt problem someone needs to see.
          // Loud on purpose: a recovery means stage 1 could not name a device
          // the page was already showing, which is a prompt/extraction problem
          // someone has to see even though the customer got a correct answer.
          if (extraction.recovered) {
            console.warn(
              `[${tag}] v2 extract missed a matched model, recovered ${extraction.models.length} from the matcher for "${query}"`
            );
          }
          const d = extraction.dropped;
          if (d.models || d.conditions || d.topics) {
            console.warn(
              `[${tag}] v2 extract dropped out-of-list ids: models=${d.models} conditions=${d.conditions} topics=${d.topics} for "${query}"`
            );
          }
          // One line per miss saying what stage 1 actually decided — ids and
          // counts only. Without it, "the answer had no figure" cannot be told
          // apart from "stage 1 picked nothing" in production (the exact
          // ambiguity the first preview pass ran into).
          console.log(
            `[${tag}] v2 extract: models=${extraction.models.join("|") || "-"} ` +
              `conditions=${extraction.conditions.length} topics=${extraction.topics.join("|") || "-"} ` +
              `intent=${extraction.intent} family=${extraction.family || "-"} ` +
              `unknowns=${extraction.unknownModels.length} confidence=${extraction.confidence}`
          );
          if (!hasAnythingToWrite(ingredients, extraction)) {
            archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
              ref.update(buildArchiveSkipRow("nothing_to_write", Date.now()))
            );
            res.json({ skipped: "nothing_to_write", cacheKey: key });
            return;
          }
          // ── Stage 2: code pulls and computes — zero AI ──
          const serviceFacts = extraction.topics.length
            ? await buildServiceFacts(db, extraction.topics)
            : "";
          const built = buildV2Context({ query, ingredients, extraction, serviceFacts });
          if (built.droppedSections.length) {
            console.warn(
              `[${tag}] v2 context over budget, dropped sections: ${built.droppedSections.join(",")}`
            );
          }
          context = built.context;
          answerTopics = extraction.topics;
          quote = built.quote || null;
          v2Legend = primaryModelLegend(ingredients, extraction);
          if (quote) {
            console.log(
              `[${tag}] v2 quote: ${quote.model_name} ${quote.variant} net=${quote.net_price} ` +
                `assumed=${quote.assumed_groups.length} for "${query}"`
            );
          }
        }
        // ── Stage 3 (v2) / the only stage (v1): the writer ──
        // V2 writes under the three-layer prompt (truth / intelligence /
        // verdict); v1 keeps its 13-rule prompt untouched for the whole
        // parallel run — the A/B comparison is only honest if the old side
        // stays exactly what production serves today.
        startedAt = Date.now();
        const gen = await callAnthropicText({
          apiKey,
          model: overviewModel,
          system: isV2
            ? buildV2SystemPrompt(assistantName, answerLang)
            : buildOverviewSystemPrompt(assistantName, answerLang),
          user: `ข้อมูลจากระบบ:\n${context}${v2Legend ? `\n\n${v2Legend}` : ""}\n\nเขียนคำตอบสำหรับคำค้น: ${query}`,
          // V2 answers carry a verdict and its reasons and are simply longer —
          // probe round 1 lost 3/10 replies to the 700 cap mid-`detail`.
          maxTokens: isV2 ? V2_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
          timeoutMs: OVERVIEW_TIMEOUT_MS,
        });
        recordAiUsage(db, { origin: "search", model: overviewModel, usage: gen.usage });
        const text = gen.text;
        // V2 parses tolerantly (fences, a truncated detail with a complete
        // summary); v1 keeps its strict parser — it is the baseline.
        let parsed = isV2 ? parseOverviewV2(text, ingredients) : parseOverview(text);
        if (!parsed) {
          console.warn(`[${tag}] unparseable reply for "${query}"`);
          archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
            ref.update(buildArchiveSkipRow("unparseable", Date.now()))
          );
          res.json({ skipped: "unparseable", cacheKey: key });
          return;
        }
        const salvaged = isV2 && parsed.salvaged === true;
        if (salvaged) console.warn(`[${tag}] v2 reply salvaged (truncated/fenced) for "${query}"`);
        let excised = 0;
        let keyPoints = [];
        let keyPointsDropped = 0;
        let primaryModelId = null;
        if (isV2) {
          // The last gate: a sentence quoting a number the context cannot
          // vouch for is cut before the answer is served, cached or archived.
          // Probe round 1 caught a correct-but-forbidden subtraction (21,120)
          // — the prompt now bans arithmetic harder, and this makes the ban
          // structural rather than behavioural.
          // Two gates, one after the other, both structural: numbers the
          // context cannot vouch for, then advice about channels we do not
          // run. Rule 7 forbids the second in words and production produced
          // it anyway the same evening — a prompt makes a behaviour rarer,
          // never impossible.
          const verified = dropOffLimitsAdvice(exciseUnverifiedNumbers(parsed, context));
          if (!verified) {
            console.warn(`[${tag}] v2 reply fully excised (unverified numbers) for "${query}"`);
            archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
              ref.update(buildArchiveSkipRow("unverified_numbers", Date.now()))
            );
            res.json({ skipped: "unverified_numbers", cacheKey: key });
            return;
          }
          excised = verified.excised;
          if (excised > 0) {
            console.warn(`[${tag}] v2 excised ${excised} sentence(s) with out-of-context numbers for "${query}"`);
          }
          // Key points survive only verbatim, and only against the text
          // actually being served — see admittedKeyPoints. primary_model_id
          // was already validated against the ingredient ids at parse time.
          const proposedKeyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints.length : 0;
          keyPoints = admittedKeyPoints(parsed.keyPoints, verified);
          // Everything the writer proposed and did not get: phrases it wrote
          // differently in the prose, duplicates, and anything past the cap.
          // One number, because the rejected TEXT is the one thing on this
          // path that is not already stored (see buildArchiveAnswerRow).
          keyPointsDropped = Math.max(0, proposedKeyPoints - keyPoints.length);
          primaryModelId = parsed.primaryModelId;
          parsed = { summary: verified.summary, detail: verified.detail };
        }
        // Best-effort, and after the answer is in hand: a failed write costs
        // us the next call, while a failed response costs the customer their
        // answer. Only good answers are stored — an unparseable reply above
        // returned already, so a bad turn is never cached into the window.
        cacheRef
          .set(
            buildCacheRow({
              summary: parsed.summary,
              detail: parsed.detail,
              keyPoints,
              primaryModelId,
              quote,
              now: Date.now(),
            })
          )
          .catch((e) => console.warn(`[${tag}] cache write failed:`, e));
        archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
          ref.update(
            buildArchiveAnswerRow({
              model: overviewModel,
              latencyMs: Date.now() - startedAt,
              inputChars: context.length,
              summary: parsed.summary,
              detail: parsed.detail,
              topics: answerTopics,
              ts: Date.now(),
              ...(isV2
                ? { v2: true, extractModel, extractMs, salvaged, excised, keyPoints, keyPointsDropped }
                : {}),
            })
          )
        );
        res.json({
          ...parsed,
          ...(keyPoints.length ? { key_points: keyPoints } : {}),
          ...(primaryModelId ? { primary_model_id: primaryModelId } : {}),
          // Computed by code in stage 2, never by the writer — the paragraph
          // and the card are two renderings of ONE arithmetic.
          ...(quote ? { quote } : {}),
          cacheKey: key,
        });
      } catch (err) {
        console.error(`[${tag}] failed for "${query}":`, err);
        // Credit gone or key revoked: take the whole assistant down, exactly
        // as the chat responder would. The two callers share a wallet, so a
        // wall one of them hits is a wall the other is about to hit too.
        if (isPermanentAiFailure(err)) {
          await suspendAssistant(db, err, tag, dispatchOpsAlert);
        }
        // A timeout is an abort, and it is the failure most worth telling
        // apart from the rest when reading this back later.
        archiveWrite(db, tag, `${ARCHIVE_ROOT}/${ymd}/${key}`, (ref) =>
          ref.update(
            buildArchiveSkipRow(err && err.name === "AbortError" ? "timeout" : "error", Date.now())
          )
        );
        res.json({ skipped: "error", cacheKey: key });
      }
    }
  );

  /**
   * One sweep a day, and it says what it did.
   *
   * The counts are the point: "deleted 0 of 0 scanned" every night means the
   * cache is not growing, and a scanned count that keeps rising while deleted
   * stays small is the index missing. Neither is visible without the line.
   */
  const pruneSearchOverviewCache = onSchedule(
    { schedule: "0 4 * * *", timeZone: "Asia/Bangkok", region: REGION },
    async () => {
      const tag = "searchOverviewGc";
      const db = getDatabase();
      try {
        const cache = await runCacheGc(db, tag);
        const rate = await runRateBucketGc(db);
        // Folded into the sweep that already runs rather than given its own
        // schedule: another scheduled function is another Cloud Run service
        // to deploy, watch and pay for, for one multi-path delete a day.
        const archive = await runArchiveGc(db);
        console.log(
          `[${tag}] cache scanned=${cache.scanned} deleted=${cache.deleted} ` +
            `(batch ${cache.batch}) · rate buckets deleted=${rate.deleted} · ` +
            `archive swept ${archive.days} day(s) ${archive.oldest}-${archive.newest} ` +
            `(retention ${ARCHIVE_RETENTION_DAYS}d)`
        );
      } catch (e) {
        // A failed sweep is tomorrow's slightly larger sweep, never an
        // incident: nothing downstream depends on it having run.
        console.error(`[${tag}] sweep failed:`, e);
      }
    }
  );

  return { customerSearchOverview, pruneSearchOverviewCache };
}

module.exports = {
  registerSearchOverview,
  __test: {
    parseOverview,
    buildCacheRow,
    buildArchiveAnswerRow,
    buildArchiveSkipRow,
    buildArchiveHitRow,
    archiveWrite,
    archiveGateSkip,
    ARCHIVE_ROOT,
    buildOverviewSystemPrompt,
    sanitizeTopics,
    renderTopic,
    buildServiceFacts,
    factsMemo,
    SERVICE_FACTS_MAX_CHARS,
    MAX_TOPICS,
    sanitizeClientKey,
    bangkokHourBucket,
    clientOverBudget,
    runCacheGc,
    runRateBucketGc,
    runArchiveGc,
    ARCHIVE_RETENTION_DAYS,
    ARCHIVE_GC_WINDOW_DAYS,
    CACHE_GC_BATCH,
    DEFAULT_CLIENT_HOURLY_LIMIT,
    v2FactsVersion,
    V2_FACT_VERSION_TOPICS,
  },
};
