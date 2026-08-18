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
const { getDatabase } = require("firebase-admin/database");
const { isPermanentAiFailure, suspendAssistant } = require("./chat-ai");
const {
  searchFaq,
  loadBranches,
  loadPromotions,
  loadStoreProfile,
  loadDeliveryZones,
} = require("./service-facts");

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
function cacheKeyFor(query, context) {
  return crypto
    .createHash("sha256")
    .update(`${query}\n\n${context}`)
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

function bangkokYmd() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}`;
}

/**
 * What the generator may and may not do.
 *
 * The rules are negative on purpose. A model that knows the going rate for a
 * MacBook Pro M1 from the open internet will volunteer it, and a number we did
 * not set is a number we will be held to at the door.
 */
function buildOverviewSystemPrompt(assistantName) {
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
    "8. ถ้าจะพูดถึง 'ช่วงราคารวม' ของหลายรุ่น ให้ใช้ตัวเลขจากบรรทัด 'ช่วงราคารับซื้อของทุกรุ่นที่ตรงกับคำค้นนี้' เท่านั้น ห้ามคำนวณช่วงรวมเองจากรายการรุ่นด้านล่าง เพราะรายการนั้นอาจแสดงไม่ครบทุกรุ่น",
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
    "- ภาษาไทย สุภาพ กระชับ ลงท้ายด้วยครับ",
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

/**
 * POST { query, context, topics? } -> { summary, detail } | { skipped: reason }
 *
 * Always 200 with a body the caller can read. A search page must never fail
 * because the optional paragraph above the results could not be written, so
 * every refusal is a named reason rather than a status code the caller has to
 * guess at — and the website renders nothing at all when one comes back.
 */
function registerSearchOverview({ dispatchOpsAlert }) {
  const customerSearchOverview = onRequest(
    { region: REGION, cors: false, timeoutSeconds: 30 },
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
      if (!query || !catalogContext) {
        res.status(400).json({ skipped: "empty_request" });
        return;
      }

      const db = getDatabase();

      // The same gate the chat widget answers to, read from the same node.
      // "The assistant is off" and "the assistant is broken" both mean there
      // is no AI on this site right now, and a summary written by the thing
      // we just told everyone is unavailable would be a strange exception.
      let pub = {};
      try {
        pub = (await db.ref("settings/chat_widget/public").once("value")).val() || {};
      } catch (e) {
        console.error(`[${tag}] settings read failed:`, e);
        res.json({ skipped: "settings_unavailable" });
        return;
      }
      if (pub.enabled !== true || pub.ai_suspended === true) {
        res.json({ skipped: pub.ai_suspended === true ? "suspended" : "disabled" });
        return;
      }

      // Its own key first, so overview spend can be billed apart from the
      // chat's — falling back to the shared key keeps today's single-key
      // setup working unchanged until OVERVIEW_API_KEY is actually set.
      const apiKey = process.env.OVERVIEW_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
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
      const facts = topics.length ? await buildServiceFacts(db, topics) : "";
      const context = catalogContext + facts;

      // CACHE BEFORE CAP, deliberately. The daily ceiling exists to bound
      // spending, and a cache hit spends nothing — counting it would let
      // popular questions exhaust a budget they are not consuming.
      const key = cacheKeyFor(query, context);
      const cacheRef = db.ref(`search_overview_cache/${key}`);
      try {
        const hit = (await cacheRef.once("value")).val();
        if (hit && Number(hit.expires_at) > Date.now() && hit.summary) {
          res.json({ summary: hit.summary, detail: hit.detail || "", cached: true });
          return;
        }
      } catch (e) {
        // A cache that cannot be read is a cache miss, never an error: the
        // customer's paragraph must not depend on this lookup succeeding.
        console.warn(`[${tag}] cache read failed:`, e);
      }

      const ymd = bangkokYmd();
      const cap = Number(pub.daily_overview_cap) || DEFAULT_DAILY_OVERVIEW_CAP;
      const capTx = await db
        .ref(`chat_ai_usage/${ymd}/overview_calls`)
        .transaction((cur) => (Number(cur) || 0) + 1);
      if ((Number(capTx.snapshot.val()) || 0) > cap) {
        console.warn(`[${tag}] daily overview cap reached (${cap})`);
        res.json({ skipped: "cap_reached" });
        return;
      }

      const assistantName = String(pub.assistant_name || "มาติน");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OVERVIEW_TIMEOUT_MS);
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
            model: process.env.OVERVIEW_MODEL || DEFAULT_OVERVIEW_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: buildOverviewSystemPrompt(assistantName),
            messages: [
              {
                role: "user",
                content: `ข้อมูลจากระบบ:\n${context}\n\nเขียนคำตอบสำหรับคำค้น: ${query}`,
              },
            ],
          }),
        });
        if (!apiRes.ok) {
          const detail = await apiRes.text();
          const err = new Error(`Anthropic ${apiRes.status}: ${detail.slice(0, 300)}`);
          err.status = apiRes.status;
          throw err;
        }
        const data = await apiRes.json();
        const text = (data.content || [])
          .filter((b) => b && b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const parsed = parseOverview(text);
        if (!parsed) {
          console.warn(`[${tag}] unparseable reply for "${query}"`);
          res.json({ skipped: "unparseable" });
          return;
        }
        // Best-effort, and after the answer is in hand: a failed write costs
        // us the next call, while a failed response costs the customer their
        // answer. Only good answers are stored — an unparseable reply above
        // returned already, so a bad turn is never cached into the window.
        cacheRef
          .set({
            summary: parsed.summary,
            detail: parsed.detail || "",
            query: query.slice(0, 200),
            created_at: Date.now(),
            expires_at: Date.now() + OVERVIEW_CACHE_TTL_SECONDS * 1000,
          })
          .catch((e) => console.warn(`[${tag}] cache write failed:`, e));
        res.json(parsed);
      } catch (err) {
        console.error(`[${tag}] failed for "${query}":`, err);
        // Credit gone or key revoked: take the whole assistant down, exactly
        // as the chat responder would. The two callers share a wallet, so a
        // wall one of them hits is a wall the other is about to hit too.
        if (isPermanentAiFailure(err)) {
          await suspendAssistant(db, err, tag, dispatchOpsAlert);
        }
        res.json({ skipped: "error" });
      } finally {
        clearTimeout(timer);
      }
    }
  );

  return { customerSearchOverview };
}

module.exports = {
  registerSearchOverview,
  __test: {
    parseOverview,
    buildOverviewSystemPrompt,
    sanitizeTopics,
    renderTopic,
    buildServiceFacts,
    factsMemo,
    SERVICE_FACTS_MAX_CHARS,
    MAX_TOPICS,
  },
};
