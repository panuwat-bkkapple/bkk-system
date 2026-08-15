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

const { onRequest } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { isPermanentAiFailure, suspendAssistant } = require("./chat-ai");

const REGION = "asia-southeast1";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Haiku on purpose. The job is "restate these numbers in a sentence", not
// reasoning — and this runs on a page a customer is waiting on, so latency is
// part of the answer.
const OVERVIEW_MODEL = "claude-haiku-4-5";
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
 * POST { query, context } -> { summary, detail } | { skipped: reason }
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
      const context = String(body.context || "").trim().slice(0, MAX_CONTEXT_CHARS);
      if (!query || !context) {
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

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.json({ skipped: "no_api_key" });
        return;
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
            model: process.env.CHAT_AI_MODEL || OVERVIEW_MODEL,
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

module.exports = { registerSearchOverview, __test: { parseOverview, buildOverviewSystemPrompt } };
