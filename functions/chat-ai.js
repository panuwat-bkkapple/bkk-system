// =============================================================================
// AI-first customer chat responder for the website chat widget.
//
// Data contract (shared with bkk-frontend-next ChatWidget + InboxPage console):
//   inbox/{uid}                 — conversation, keyed by customer Firebase uid
//     status: "ai" | "waiting_human" | "human" | "resolved"
//     name, customer_phone, phone_source ("chat"|"account"), source_url,
//     lastMessage, lastMessageAt, unreadCount (admin side, server-written),
//     customer_unread (customer side, server-incremented / customer resets 0),
//     assigned_staff_id, assigned_staff_name, escalation {reason,summary,at},
//     ai_typing, ai_state { processed/{msgId}, cap_notice_at, rate_limited_at }
//   inbox/{uid}/messages/{msgId}
//     sender, senderName?, senderRole: "customer"|"ai"|"admin"|"system",
//     kind: "text"|"system", text, timestamp, read
//
// The customer client can ONLY create its own messages and reset
// customer_unread (see bkk-frontend-next/database.rules.json). Everything
// else here runs with the Admin SDK.
//
// LLM calls use the Claude API via global fetch (Node 22) with an
// AbortController timeout — same no-new-dependency pattern as
// dispatchTelegram / SickW / Resend. Configured via ANTHROPIC_API_KEY
// (GitHub Secrets -> functions/.env). Missing key = manual mode: messages
// are denormalized + pushed to admins, no AI reply, nothing crashes.
//
// Master gate: settings/chat_widget/public.enabled !== true -> completely
// inert (same convention as settings/accounting order_emails_enabled).
//
// Function name is project-unique on purpose ({region}/{name} collision rule
// in CLAUDE.md) — do NOT rename to something generic like onInboxMessage.
// =============================================================================

const { onValueCreated } = require("firebase-functions/v2/database");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  SICKW_ENDPOINT,
  SICKW_CACHE_TTL_MS,
  SICKW_CATALOG_CACHE_KEY,
  recordSickwUsage,
  summarizeSickwFlags,
  parseSickwResult,
} = require("./sickw-core");
const { getDatabase, ServerValue } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { resolveCustomer } = require("./crm");

const REGION = "asia-southeast1";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5";
// Hybrid routing: turns that involve money/policy/appraisal/cancellation go to
// the stronger model (far less guessing); trivial small-talk stays on Haiku.
const STRONG_MODEL = "claude-sonnet-5";
// Verifier = independent 2nd-pass gate that vets the drafted reply before it is
// sent, catching dangerous hallucinations the main model may still produce.
const VERIFIER_MODEL = "claude-sonnet-5";
const DEFAULT_DAILY_CALL_CAP = 1500;
const LLM_TIMEOUT_MS = 45000;
const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 30;
const RATE_LIMIT_COUNT = 15; // customer messages per minute before AI stops replying

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

function normalizePhone(raw) {
  if (!raw) return "";
  let p = String(raw).replace(/[\s\-().]/g, "");
  if (p.startsWith("+66")) p = "0" + p.slice(3);
  else if (p.startsWith("66") && p.length >= 11) p = "0" + p.slice(2);
  return p;
}

function bangkokNowParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  return {
    ymd: `${get("year")}${get("month")}${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function parseHM(s, fallbackMinutes) {
  if (!s || !/^\d{1,2}:\d{2}$/.test(String(s))) return fallbackMinutes;
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + m;
}

function isBusinessHours(pub) {
  const { minutes } = bangkokNowParts();
  const start = parseHM(pub.hours_start, 10 * 60);
  const end = parseHM(pub.hours_end, 19 * 60);
  return minutes >= start && minutes < end;
}

// ---------------------------------------------------------------------------
// Pricing resolver — MIRROR of src/utils/pricingResolver.ts (and the other
// cross-repo copies; see CLAUDE.md invariant #8). Precedence per option:
// pct (% of base) > deduct (flat baht) > legacy t1/t2/t3 tier buckets.
// Change the formula there -> change it here too.
// ---------------------------------------------------------------------------

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

// Parse a battery option label into a % range so a stated battery health can be
// bucketed deterministically instead of leaving it to the model — which kept
// rounding UP to a better bracket (79% -> "81-85%", 70% -> "90% ขึ้นไป"),
// inflating the quote. Labels seen: "90% ขึ้นไป", "85-89%", "80-84%",
// "แบตต่ำกว่า 80% (Service)".
function batteryOptionRange(label) {
  const s = String(label || "");
  const nums = (s.match(/\d+/g) || []).map(Number);
  if (nums.length === 0) return null;
  if (/ขึ้นไป|มากกว่า|>=|ขึ้น/.test(s)) return { min: nums[0], max: Infinity };
  if (/ต่ำกว่า|น้อยกว่า|below|under|</i.test(s)) return { min: 0, max: nums[0] - 1 };
  if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
  return { min: nums[0], max: nums[0] };
}

// The option id whose battery range contains pct, or null if none/invalid.
function pickBatteryOptionId(options, pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return null;
  for (const o of options || []) {
    if (!o || o.id == null) continue;
    const r = batteryOptionRange(o.label || o.name);
    if (r && p >= r.min && p <= r.max) return o.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// พื้นที่บริการ Pickup + โปรโมชั่น — mirror จาก bkk-frontend-next
//   - zone pricing: functions/src/deliveryZones.ts (สูตรเดียวกับ validateAndCreateOrder
//     และ recomputeCustomerPickupFee: หาโซนจากจังหวัด, ระยะ = haversine x 1.3
//     จากสาขา active ที่ใกล้สุด)
//   - จังหวัด: functions/src/provinces.ts (kongvut canonical ids)
//   - โปรฯ ค่าไรเดอร์: riderFeePromoEligible / riderFeePromoDiscount ใน index.ts
// แก้กติกาโซน/โปรฯ ที่ repo นั้นต้องมาแก้ mirror นี้ด้วย
// ---------------------------------------------------------------------------

const STORE_LOCATION = { lat: 13.8481527, lng: 100.6123554 };

const TH_PROVINCES = [
  [1, "กรุงเทพมหานคร"], [2, "สมุทรปราการ"], [3, "นนทบุรี"], [4, "ปทุมธานี"],
  [5, "พระนครศรีอยุธยา"], [6, "อ่างทอง"], [7, "ลพบุรี"], [8, "สิงห์บุรี"],
  [9, "ชัยนาท"], [10, "สระบุรี"], [11, "ชลบุรี"], [12, "ระยอง"],
  [13, "จันทบุรี"], [14, "ตราด"], [15, "ฉะเชิงเทรา"], [16, "ปราจีนบุรี"],
  [17, "นครนายก"], [18, "สระแก้ว"], [19, "นครราชสีมา"], [20, "บุรีรัมย์"],
  [21, "สุรินทร์"], [22, "ศรีสะเกษ"], [23, "อุบลราชธานี"], [24, "ยโสธร"],
  [25, "ชัยภูมิ"], [26, "อำนาจเจริญ"], [27, "หนองบัวลำภู"], [28, "ขอนแก่น"],
  [29, "อุดรธานี"], [30, "เลย"], [31, "หนองคาย"], [32, "มหาสารคาม"],
  [33, "ร้อยเอ็ด"], [34, "กาฬสินธุ์"], [35, "สกลนคร"], [36, "นครพนม"],
  [37, "มุกดาหาร"], [38, "เชียงใหม่"], [39, "ลำพูน"], [40, "ลำปาง"],
  [41, "อุตรดิตถ์"], [42, "แพร่"], [43, "น่าน"], [44, "พะเยา"],
  [45, "เชียงราย"], [46, "แม่ฮ่องสอน"], [47, "นครสวรรค์"], [48, "อุทัยธานี"],
  [49, "กำแพงเพชร"], [50, "ตาก"], [51, "สุโขทัย"], [52, "พิษณุโลก"],
  [53, "พิจิตร"], [54, "เพชรบูรณ์"], [55, "ราชบุรี"], [56, "กาญจนบุรี"],
  [57, "สุพรรณบุรี"], [58, "นครปฐม"], [59, "สมุทรสาคร"], [60, "สมุทรสงคราม"],
  [61, "เพชรบุรี"], [62, "ประจวบคีรีขันธ์"], [63, "นครศรีธรรมราช"], [64, "กระบี่"],
  [65, "พังงา"], [66, "ภูเก็ต"], [67, "สุราษฎร์ธานี"], [68, "ระนอง"],
  [69, "ชุมพร"], [70, "สงขลา"], [71, "สตูล"], [72, "ตรัง"],
  [73, "พัทลุง"], [74, "ปัตตานี"], [75, "ยะลา"], [76, "นราธิวาส"],
  [77, "บึงกาฬ"],
];

function provinceIdFromName(name) {
  if (!name) return null;
  const norm = (s) => String(s).replace(/จังหวัด/g, "").replace(/\s+/g, "").trim().toLowerCase();
  const n = norm(name);
  if (!n) return null;
  if (n === "กทม" || n === "กทม.") return 1;
  for (const [id, th] of TH_PROVINCES) if (norm(th) === n) return id;
  for (const [id, th] of TH_PROVINCES) {
    const t = norm(th);
    if (t && (n.includes(t) || t.includes(n))) return id;
  }
  return null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const DEFAULT_DELIVERY_ZONES = [
  {
    id: "metro",
    name: "กรุงเทพและปริมณฑล",
    provinceIds: [1, 2, 3, 4, 58, 59],
    pricing: { type: "distance", baseFare: 50, freeRadius: 5, perKmRate: 10, maxFee: 300 },
    etaText: "1-2 ชั่วโมง",
  },
  {
    id: "eastern",
    name: "ชลบุรี / พัทยา / ฉะเชิงเทรา",
    provinceIds: [11, 15],
    pricing: { type: "flat", flatFee: 500 },
    etaText: "2-3 ชั่วโมง",
  },
];

function deliveryZonesFrom(raw) {
  if (raw && typeof raw === "object" && Array.isArray(raw.zones)) return raw.zones;
  if (raw && typeof raw === "object" && (raw.baseFare != null || raw.perKmRate != null)) {
    return [
      {
        ...DEFAULT_DELIVERY_ZONES[0],
        pricing: {
          type: "distance",
          baseFare: typeof raw.baseFare === "number" ? raw.baseFare : 50,
          freeRadius: typeof raw.freeRadius === "number" ? raw.freeRadius : 5,
          perKmRate: typeof raw.perKmRate === "number" ? raw.perKmRate : 10,
          maxFee: typeof raw.maxFee === "number" ? raw.maxFee : 300,
        },
      },
      DEFAULT_DELIVERY_ZONES[1],
    ];
  }
  return DEFAULT_DELIVERY_ZONES;
}

function zoneFeeOf(zone, distanceKm) {
  const p = zone && zone.pricing;
  if (!p) return null;
  if (p.type === "flat") return Number(p.flatFee) || 0;
  if (distanceKm <= 0) return 0;
  const chargeable = Math.max(0, distanceKm - (Number(p.freeRadius) || 0));
  let fee = Math.round((Number(p.baseFare) || 0) + chargeable * (Number(p.perKmRate) || 0));
  const maxFee = Number(p.maxFee) || 0;
  if (maxFee > 0 && fee > maxFee) fee = maxFee;
  return fee;
}

function toEpochMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e11 ? v : v * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function promoWindowOpen(item, now) {
  const start = toEpochMs(item.start_date);
  let end = toEpochMs(item.end_date);
  // end_date แบบ date-only ("2026-07-31") ให้เผื่อถึงสิ้นวัน
  if (end != null && typeof item.end_date === "string" && !/[T ]/.test(item.end_date)) {
    end += 86399999;
  }
  if (start != null && now < start) return false;
  if (end != null && now > end) return false;
  return true;
}

function quotaFull(item) {
  return !!(item.total_limit && (item.used_count || 0) >= item.total_limit);
}

// Pick the single best public coupon a device qualifies for, to surface on the
// quote card BEFORE the customer asks. DISPLAY ONLY — the real money is still
// applied + revalidated by checkout auto-select and validateAndCreateOrder
// (bkk-frontend-next). This mirrors the eligibility rules in
// bkk-frontend-next/app/utils/couponEligibility.ts — keep the two in sync.
// Fail-closed on anything we can't guarantee for an anonymous chat visitor:
//   - system masters (REVIEW_REWARD) never advertised
//   - new_customer_only skipped (we can't verify "new" here → would mismatch
//     checkout and disappoint), same for type 'service' (no payout bump)
//   - model-restricted but applicable_models empty → not eligible
// tradeValue = the card's preliminary estimated_price (single-item subtotal).
async function pickBestCouponForModel(db, modelId, tradeValue) {
  if (!modelId || !(Number(tradeValue) > 0)) return null;
  try {
    const snap = await db.ref("coupons").once("value");
    const cs = snap.val() || {};
    const now = Date.now();
    let best = null;
    for (const key of Object.keys(cs)) {
      const c = cs[key];
      if (!c || c.system === true) continue;
      if (c.is_active === false) continue;
      if (c.new_customer_only === true) continue;
      if (!promoWindowOpen(c, now)) continue;
      if (quotaFull(c)) continue;
      const applicable = Array.isArray(c.applicable_models) ? c.applicable_models : [];
      const excluded = Array.isArray(c.excluded_models) ? c.excluded_models : [];
      if (excluded.includes(modelId)) continue; // exclude wins
      const restricted = c.is_model_restricted === true || applicable.length > 0;
      if (restricted) {
        if (applicable.length === 0) continue;          // restricted but empty → fail closed
        if (!applicable.includes(modelId)) continue;    // not this model
      }
      if (Number(tradeValue) < Number(c.min_trade_value || 0)) continue;
      const type = c.type || "fixed";
      let val = 0;
      if (type === "percentage") {
        val = Math.floor(Number(tradeValue) * (Number(c.value || 0) / 100));
        const cap = Number(c.max_discount || 0);
        if (cap > 0) val = Math.min(val, cap);
      } else if (type === "fixed") {
        val = Number(c.value || 0);
      } else {
        continue; // 'service' or unknown → no payout bump to show on the card
      }
      if (!(val > 0)) continue;
      if (!best || val > best.computed_value) {
        best = {
          code: c.code || key,
          name: c.name || c.title || "",
          type,
          value: Number(c.value || 0),
          computed_value: val,
          end_date: c.end_date || null,
        };
      }
    }
    return best;
  } catch {
    return null; // best-effort — a card with no coupon still works
  }
}

async function geocodeThaiArea(text) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { error: "maps_api_key_missing" };
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", String(text));
    url.searchParams.set("components", "country:TH");
    url.searchParams.set("language", "th");
    url.searchParams.set("key", apiKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { error: `geocode_http_${res.status}` };
    const data = await res.json();
    if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
      return { error: "not_found" };
    }
    const r = data.results[0];
    const comp = (r.address_components || []).find(
      (c) => (c.types || []).includes("administrative_area_level_1")
    );
    const loc = r.geometry && r.geometry.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      return { error: "not_found" };
    }
    return {
      lat: loc.lat,
      lng: loc.lng,
      province_name: comp ? comp.long_name : null,
      formatted: r.formatted_address || "",
    };
  } catch {
    return { error: "geocode_failed" };
  }
}

// ---------------------------------------------------------------------------
// FAQ — mirror จาก bkk-frontend-next/app/faq/faqData.ts (มาสเตอร์ 50 ข้อ 5 หมวด)
// AI อ่านเป็น knowledge แล้ว "สรุปตอบเป็นภาษาคน" ไม่ใช่แปะให้ลูกค้าอ่าน
// แก้ FAQ ที่ faqData.ts ต้อง sync ที่นี่ด้วย
// ---------------------------------------------------------------------------
const FAQ = [
  { c: "การรับซื้อ", q: "รับซื้ออุปกรณ์อะไรบ้าง", a: "รับซื้ออุปกรณ์ Apple ทุกประเภท: iPhone (iPhone 7 ขึ้นไป), iPad ทุกรุ่น, MacBook (Air/Pro), iMac, Mac mini, Apple Watch, AirPods และอุปกรณ์เสริม ราคาอิงตลาดจริงอัปเดตทุกวัน" },
  { c: "การรับซื้อ", q: "ขั้นตอนการขายเป็นอย่างไร", a: "1) เลือกรุ่นบนเว็บ 2) ระบุสภาพเครื่องตามจริงเพื่อประเมินราคา 3) เลือกวิธีส่งมอบ (Rider รับถึงบ้าน / มาที่สาขา / ส่งพัสดุ Mail-in) 4) ทีมงานตรวจเช็คแล้วโอนเงินทันที" },
  { c: "การรับซื้อ", q: "ราคาประเมินบนเว็บเป็นราคาสุดท้ายไหม", a: "เป็นราคาสูงสุดโดยประมาณ ราคาสุดท้ายขึ้นกับผลตรวจสภาพจริง ถ้าสภาพตรงที่ระบุจะได้ราคาตามประเมิน ถ้ามีตำหนิเพิ่มราคาอาจปรับลดลง" },
  { c: "การรับซื้อ", q: "รับซื้อเครื่องจอแตก เครื่องเสีย มีปัญหาไหม", a: "รับซื้อทุกสภาพ ทั้งจอแตก แบตเสื่อม ลำโพงเสีย Face ID ใช้ไม่ได้ เครื่องค้าง ราคาปรับตามสภาพความเสียหาย เลือกสภาพตามจริงตอนประเมิน" },
  { c: "การรับซื้อ", q: "ต้องเตรียมเอกสารอะไร", a: "การขายทั่วไปไม่ต้องใช้เอกสาร แต่ควร Sign Out Apple ID/iCloud + ปิด Find My iPhone มีกล่อง/ใบเสร็จช่วยเพิ่มมูลค่าเล็กน้อย ขายในนามนิติบุคคลอาจต้องใช้เอกสารเพิ่ม" },
  { c: "การรับซื้อ", q: "ต้องลบข้อมูลก่อนขายไหม", a: "ไม่จำเป็น ทีมงาน Factory Reset ให้หลังตรวจเช็คเสร็จ แต่แนะนำสำรองข้อมูลสำคัญไว้ก่อน และออกจาก iCloud เพื่อความรวดเร็ว" },
  { c: "การรับซื้อ", q: "รับซื้อเครื่องผ่อนอยู่ได้ไหม", a: "ไม่รับซื้อเครื่องที่ยังผ่อนไม่หมด ติดล็อก MDM หรือติดล็อก iCloud/Activation Lock เนื่องจากมีข้อจำกัดในการใช้งานและด้านกรรมสิทธิ์ ถ้าผ่อนครบหรือปลดล็อกเรียบร้อยแล้วค่อยนำมาประเมินราคาได้" },
  { c: "การรับซื้อ", q: "รับซื้อเครื่องติด iCloud หรือ Activation Lock ไหม", a: "ไม่รับซื้อเครื่องที่ติดล็อก iCloud/Activation Lock หรือยัง Sign out Apple ID ไม่ได้ ในทุกกรณี (ไม่มีการรับแล้วหักราคาหรือรับไปปลดล็อกเอง) ลูกค้าต้องปลดล็อก/Sign out iCloud ให้เรียบร้อยก่อน ถึงจะนำเครื่องมาประเมินราคาได้" },
  { c: "การรับซื้อ", q: "ต้องมีกล่อง อุปกรณ์ ใบเสร็จไหม", a: "ไม่จำเป็น รับซื้อตัวเครื่องเปล่าได้ แต่ถ้ามีกล่องครบ อุปกรณ์ครบ หรือใบเสร็จ/ใบรับประกัน อาจได้ราคาดีขึ้นเล็กน้อย" },
  { c: "การรับซื้อ", q: "มีบริการรับซื้อถึงบ้านไหม", a: "มี กรุงเทพฯ+ปริมณฑลมี Rider รับถึงหน้าบ้าน ต่างจังหวัดใช้ส่งพัสดุ Mail-in ได้ (ค่าส่งทางร้านออกให้)" },
  { c: "การรับซื้อ", q: "ตรวจสภาพเครื่องอย่างไร", a: "ตรวจทั้งภายนอก-ใน: หน้าจอ ตัวเครื่อง ฟังก์ชัน (Face ID/Touch ID/ลำโพง/กล้อง/แบต) สถานะ iCloud Lock และ Battery Health ใช้เวลา 5-10 นาที" },
  { c: "การยกเลิก", q: "ยกเลิกการขายได้ไหม", a: "ได้ ยกเลิกได้ตลอดก่อนกดยืนยันรับเงิน ถ้ายังไม่ส่งมอบเครื่องยกเลิกผ่านระบบได้ทันที" },
  { c: "การยกเลิก", q: "ยกเลิกหลังส่งเครื่องแล้วได้ไหม", a: "ถ้าส่งมาแล้วแต่ยังไม่กดยืนยันรับเงิน แจ้งยกเลิกได้ (ติดต่อทีมงาน) ร้านส่งเครื่องคืนให้ฟรีภายใน 7 วัน" },
  { c: "การยกเลิก", q: "ยกเลิกหลังรับเงินแล้วได้ไหม", a: "หลังกดยืนยันรับเงินและโอนแล้วถือว่าซื้อขายสมบูรณ์ ยกเลิกไม่ได้ กรุณาตรวจสอบราคาและเงื่อนไขให้ดีก่อนยืนยัน" },
  { c: "การยกเลิก", q: "ยกเลิกมีค่าใช้จ่ายไหม", a: "ไม่มีค่าใช้จ่ายในการยกเลิก กรณีส่งเครื่องมาแล้ว ค่าจัดส่งคืนทางร้านรับผิดชอบทั้งหมด" },
  { c: "การยกเลิก", q: "ราคาจริงต่ำกว่าประเมิน ยกเลิกได้ไหม", a: "ได้ ถ้าราคาหลังตรวจต่ำกว่าที่ประเมิน มีสิทธิ์ไม่รับราคาใหม่และยกเลิกได้ทันที ไม่มีค่าใช้จ่าย ร้านส่งเครื่องคืนให้" },
  { c: "การยกเลิก", q: "ได้เครื่องคืนกี่วัน", a: "กรณีส่งเครื่องมาแล้ว หลังแจ้งยกเลิกส่งคืนภายใน 1-3 วันทำการ ผ่าน Kerry/Flash พร้อมเลขพัสดุติดตาม" },
  { c: "การยกเลิก", q: "ยกเลิกนัด Rider ได้ไหม", a: "ได้ ยกเลิกก่อนเวลานัดอย่างน้อย 1 ชั่วโมง ถ้ายกเลิกหลัง Rider ออกเดินทางแล้วอาจมีค่าเดินทางเล็กน้อย" },
  { c: "การยกเลิก", q: "ยกเลิกแล้วคูปองหายไหม", a: "ถ้าใช้คูปอง/โปรในคำสั่งขาย เมื่อยกเลิกคูปองจะคืนกลับอัตโนมัติ ใช้ครั้งถัดไปได้ภายในวันหมดอายุ" },
  { c: "ค่าบริการ", q: "คิดค่าบริการรับซื้อไหม", a: "ไม่คิดค่าบริการใดๆ ราคาที่แจ้งเป็นราคาสุทธิที่ได้รับ ไม่มีค่าธรรมเนียมแอบแฝง ไม่มีค่าตรวจสภาพ ไม่มีค่าดำเนินการ" },
  { c: "ค่าบริการ", q: "มีค่าจัดส่งไหม", a: "Rider รับถึงบ้าน (กทม.+ปริมณฑล) ไม่มีค่าจัดส่ง ส่งพัสดุ Mail-in ต่างจังหวัดร้านออกค่าส่งให้" },
  { c: "ค่าบริการ", q: "ชำระเงินช่องทางไหน", a: "โอนเข้าบัญชีธนาคารโดยตรง รองรับทุกธนาคารและพร้อมเพย์ หรือรับเงินสดที่สาขา" },
  { c: "ค่าบริการ", q: "ได้เงินเร็วแค่ไหน", a: "มาสาขา: ภายใน 15 นาที | Rider: โอนภายใน 5 นาทีหลังตรวจเสร็จ | Mail-in: โอนภายในวันที่ร้านได้รับเครื่อง (อาจช้าเล็กน้อยตามเวลาธนาคาร)" },
  { c: "ค่าบริการ", q: "ใช้คูปอง/โปรอย่างไร", a: "กรอกรหัสคูปองตอนยืนยันคำสั่งขาย ส่วนลดจะเพิ่มเป็นราคารับซื้อที่สูงขึ้น เช่นคูปอง +200 บาท = ราคาเพิ่ม 200 จากราคาประเมิน" },
  { c: "ค่าบริการ", q: "โอนเงินไม่สำเร็จทำไง", a: "ตรวจเลขบัญชีให้ถูก ถ้าถูกแล้วเงินไม่เข้า ติดต่อทีมงาน LINE @bkkapple ตรวจสอบและโอนซ้ำภายใน 24 ชั่วโมง" },
  { c: "ค่าบริการ", q: "ขอใบเสร็จได้ไหม", a: "ระบบส่งสลิปโอนอัตโนมัติทางอีเมล/LINE ถ้าต้องการใบเสร็จรับเงินอย่างเป็นทางการแจ้งทีมงานได้ ออกให้ภายใน 3 วันทำการ" },
  { c: "ค่าบริการ", q: "ราคาอัปเดตบ่อยแค่ไหน", a: "ราคารับซื้ออัปเดตทุกวัน อิงราคาตลาดจริงในและต่างประเทศ อาจเปลี่ยนตามตลาด โดยเฉพาะช่วง Apple เปิดตัวรุ่นใหม่" },
  { c: "ค่าบริการ", q: "ขายหลายเครื่องมีโปรไหม", a: "มี ขายตั้งแต่ 2 เครื่องขึ้นไปครั้งเดียวได้โบนัสเพิ่ม องค์กร/บริษัทขายจำนวนมากติดต่อทีม Corporate ที่หน้า /corporate เพื่อราคาพิเศษ" },
  { c: "PDPA", q: "เก็บข้อมูลส่วนบุคคลอะไรบ้าง", a: "เก็บเฉพาะที่จำเป็น: ชื่อ-นามสกุล เบอร์โทร อีเมล ที่อยู่จัดส่ง เลขบัญชี และข้อมูลอุปกรณ์ (รุ่น IMEI) ตาม PDPA" },
  { c: "PDPA", q: "ข้อมูลถูกนำไปใช้อย่างไร", a: "ใช้เพื่อ: รับซื้อ+โอนเงิน, ติดต่อเรื่องคำสั่งขาย, ออกเอกสารบัญชี, ปรับปรุงบริการ (ถ้ายินยอม) ไม่ขาย/เปิดเผยให้บุคคลภายนอกโดยไม่ได้รับอนุญาต" },
  { c: "PDPA", q: "ขอลบข้อมูลส่วนบุคคลได้ไหม", a: "ได้ ตาม PDPA ติดต่อ DPO ที่ dpo@bkkapple.com ดำเนินการภายใน 30 วัน ยกเว้นข้อมูลที่จำเป็นทางกฎหมาย (เอกสารบัญชี) อาจลบไม่ได้" },
  { c: "PDPA", q: "ข้อมูลในเครื่องที่ขายจัดการอย่างไร", a: "หลังรับซื้อ ทีมงาน Factory Reset ลบข้อมูลทั้งหมดกู้คืนไม่ได้ แนะนำสำรองข้อมูลและ Sign Out Apple ID ก่อน" },
  { c: "PDPA", q: "ถอนความยินยอมได้ไหม", a: "ได้ตลอดเวลา ผ่านหน้าตั้งค่าบัญชีหรืออีเมล dpo@bkkapple.com ไม่กระทบธุรกรรมที่เกิดก่อนหน้า" },
  { c: "PDPA", q: "DPO ติดต่ออย่างไร", a: "เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO) ติดต่อ dpo@bkkapple.com ตอบกลับภายใน 7 วันทำการ" },
  { c: "PDPA", q: "เก็บข้อมูลนานเท่าไร", a: "ข้อมูลธุรกรรมเก็บตามกฎหมาย (บัญชี 5 ปี) จากนั้นลบหรือทำให้ระบุตัวตนไม่ได้ ข้อมูลการตลาดเก็บจนกว่าจะถอนความยินยอม" },
  { c: "PDPA", q: "สิทธิ์ตาม PDPA มีอะไรบ้าง", a: "เข้าถึง แก้ไข ลบ ระงับการใช้ คัดค้าน โอนย้ายข้อมูล และถอนความยินยอม ใช้สิทธิ์ผ่าน dpo@bkkapple.com" },
  { c: "ทั่วไป", q: "ต้องสมัครสมาชิกก่อนไหม", a: "เช็คราคาได้เลยไม่ต้องสมัคร แต่ถ้าจะทำรายการขายต้องสมัคร/ล็อกอินก่อน เพื่อเก็บประวัติและรับแจ้งเตือนสถานะ สมัครง่ายผ่านเบอร์โทรหรือ LINE" },
  { c: "ทั่วไป", q: "ติดตามสถานะคำสั่งขายอย่างไร", a: "ล็อกอินบนเว็บแล้วไปหน้า 'คำสั่งขายของฉัน' เห็นสถานะ Real-time และมีแจ้งเตือนผ่าน LINE/อีเมลทุกครั้งที่สถานะเปลี่ยน" },
  { c: "ทั่วไป", q: "น่าเชื่อถือไหม ปลอดภัยไหม", a: "จดทะเบียนถูกกฎหมาย ดำเนินกิจการมาหลายปี มีหน้าร้านชัดเจน รีวิว 5 ดาวจากลูกค้ากว่า 300+ รีวิวบน Google Maps" },
  { c: "ทั่วไป", q: "มีบริการลูกค้าองค์กร Corporate ไหม", a: "มี สำหรับองค์กรที่ขายอุปกรณ์จำนวนมาก (เปลี่ยนเครื่องพนักงาน โรงเรียน สถาบัน) ได้ราคาพิเศษ ดูที่หน้า /corporate" },
];

function normFaq(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}

function searchFaq(query) {
  const q = normFaq(query);
  if (!q) return FAQ.slice(0, 8).map((f) => ({ q: f.q, a: f.a }));
  const tokens = String(query).toLowerCase().split(/\s+/).filter((t) => t && t.length >= 2);
  const scored = FAQ.map((f) => {
    const hay = normFaq(f.c + f.q + f.a);
    let hits = 0;
    for (const t of tokens) if (hay.includes(t.replace(/\s+/g, ""))) hits++;
    if (hay.includes(q)) hits += 2;
    return { f, hits };
  })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 6)
    .map((x) => ({ q: x.f.q, a: x.f.a }));
  return scored;
}

// ---------------------------------------------------------------------------
// Models catalogue cache (public data, reused across warm invocations)
// ---------------------------------------------------------------------------

let modelsCache = { at: 0, list: [] };
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

// Pure model matcher (extracted so it can be unit-tested offline).
// list items only need { brand, name, category }.
// Product families — a match must stay inside the family the customer named.
// Real lost-trust bug: "MacBook Pro M5 Max" tokenized to "m 5"; the bare "m"
// substring-hit "mini" and "5" hit the generation, so the top match became
// "iPad mini 5 (2019)" (delisted) and the reply declared the WRONG model
// งดรับซื้อ — twice, ignoring the customer's correction. Thai spellings included.
const FAMILY_PATTERNS = [
  ["iphone", /iphone|ไอโฟน/],
  ["ipad", /ipad|ไอแพด/],
  ["macbook", /macbook|แมคบุ|แม็คบุ/],
  ["imac", /imac/],
  ["watch", /watch|วอทช|วอช/],
  ["airpods", /airpods|แอร์พอด/],
  ["galaxy", /galaxy|กาแลคซี|กาแล็กซี/],
];
function familiesOf(text) {
  const t = String(text || "").toLowerCase();
  return FAMILY_PATTERNS.filter(([, re]) => re.test(t)).map(([k]) => k);
}
// True when both sides clearly name a family and they don't overlap —
// "MacBook ..." must never resolve to an iPad, whatever the token overlap.
function familyMismatch(query, modelName) {
  const qf = familiesOf(query);
  if (qf.length === 0) return false;
  const nf = familiesOf(modelName);
  if (nf.length === 0) return false;
  return !qf.some((f) => nf.includes(f));
}

// Sub-lines within a family — Air / mini / SE are different PRODUCTS, not
// variants. Real lost-lead bug: "iPad Air 6" (catalog name carries the chip,
// not the number) version-matched "iPad mini (รุ่นที่ 6)" instead, and the
// reply declared iPad Air 6 not in the system — while the /sell page quoted
// it at 8,000. When the customer names a sub-line the candidate must carry
// the SAME sub-line. Word-boundary regexes: "airpods" must not read as "air"
// (Thai spelling แอร์พอด excluded explicitly), "series" must not read as "se".
const SUBLINE_PATTERNS = [
  ["air", /\bair\b|แอร์(?!พอด)/],
  ["mini", /\bmini\b|มินิ/],
  ["se", /\bse\b|เอสอี/],
];
function sublineMismatch(query, modelName) {
  const q = String(query || "").toLowerCase();
  const n = String(modelName || "").toLowerCase();
  return SUBLINE_PATTERNS.some(([, re]) => re.test(q) && !re.test(n));
}

// Customers name recent iPads by GENERATION ("iPad Air 6") but the catalog
// names them by screen size + chip ('iPad Air 11" (ชิป M2, 2024)') — the
// generation number is nowhere in the name, so the strict version-token match
// can never find them. Static Apple facts: Air 6th gen = M2 (2024),
// 7th = M3 (2025), 8th = M4 (2026). Returns the extra generation token a
// model's name has earned, or null.
const IPAD_AIR_GEN_BY_CHIP = [
  ["6", /m\s?2\b/],
  ["7", /m\s?3\b/],
  ["8", /m\s?4\b/],
];
function ipadAirGenToken(nameLower) {
  if (!/ipad/.test(nameLower) || !/\bair\b/.test(nameLower)) return null;
  const hit = IPAD_AIR_GEN_BY_CHIP.find(([, re]) => re.test(nameLower));
  return hit ? hit[0] : null;
}

// When the customer used a generation name that only resolves via the chip
// alias, tell the LLM the mapping explicitly — otherwise it sees 'iPad Air
// 11" (ชิป M2, 2024)' come back for "iPad Air 6" and hedges ("ไม่พบรุ่นนี้")
// instead of explaining they are the same device.
// Single-result guard note. Real bug: search returned exactly ONE model
// (iPad Air 5 — one screen size, variants only Wi-Fi/Cellular x storage) and
// the LLM still offered "มีให้เลือก 2 ขนาด 10.9 กับ 12.9 นิ้ว" from its own
// memory — 12.9" is an iPad Pro size. When there is one match, enumerate the
// REAL choice axes so the model has nothing to invent.
function singleResultVariantNote(model) {
  if (!model) return null;
  const variantNames = (model.variants || []).map((v) => String(v.name || "")).filter(Boolean);
  const options = variantNames.length ? ` ตัวเลือกที่มีจริงทั้งหมดคือ: ${variantNames.join(", ")}` : "";
  return `ผลค้นหามีรุ่นเดียว: ${model.name} — รุ่นนี้ไม่มีรุ่นย่อย/ขนาดจอให้เลือกนอกเหนือจากนี้${options} — ห้ามเสนอขนาดจอหรือตัวเลือกอื่นจากความจำ (กฎข้อ 2.2) ถามลูกค้าเฉพาะสิ่งที่ต้องใช้เลือกจากรายการนี้`;
}

function ipadAirGenAliasNote(query) {
  const q = String(query || "").toLowerCase();
  const m = q.match(/(?:ipad|ไอแพด)\s*(?:air|แอร์)\s*(?:gen\s*|รุ่น(?:ที่)?\s*)?([678])\b/);
  if (!m) return null;
  const chip = { 6: "M2, 2024", 7: "M3, 2025", 8: "M4, 2026" }[m[1]];
  return `ลูกค้าเรียก "iPad Air ${m[1]}" = ชื่อในระบบคือ iPad Air 11"/13" (ชิป ${chip}) — เป็นรุ่นเดียวกัน อย่าบอกว่าไม่พบรุ่น ให้เดินขั้นตอนตามปกติ และถามลูกค้าว่าเป็นจอ 11 นิ้วหรือ 13 นิ้ว`;
}

function rankModels(list, rawQuery) {
  const q = String(rawQuery || "")
    .toLowerCase()
    .trim()
    .replace(/promax/g, "pro max")
    .replace(/([a-z฀-๿])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z฀-๿])/g, "$1 $2");
  if (!q) return [];
  // Single latin letters (the "m" left over from splitting chip names like
  // M5) carry no signal and substring-match everything — drop them.
  const tokens = q
    .split(/\s+/)
    .filter((t) => t && t !== "gb" && t !== "tb" && !(t.length === 1 && /[a-z]/.test(t)));
  // Model-generation numbers live in 3..20 (iPhone 13, Watch Series 10, iPad 9).
  // Storage sizes (32..1024) are >20 and 1TB/2TB map to 1/2 (<3), so this cleanly
  // separates generation from storage. A candidate must contain EVERY version
  // token — otherwise "Apple Watch Series 5" falsely matches "Series 10/11" on
  // 3 of 4 tokens for a model we do not carry.
  const versionTokens = tokens.filter((t) => {
    const n = Number(t);
    return Number.isInteger(n) && n >= 3 && n <= 20;
  });
  // "apple" matches every product; a brand+number-only hit is not a real match
  // (e.g. "Apple Watch Series 5" must not surface "iPad Air 5"). Require at
  // least one meaningful (non-brand, non-version) token to hit.
  const GENERIC = new Set(["apple"]);
  const meaningfulTokens = tokens.filter((t) => !GENERIC.has(t) && !versionTokens.includes(t));
  return list
    .map((m) => {
      const hay = `${m.brand} ${m.name} ${m.category}`.toLowerCase();
      // Strip punctuation so 13" / (Intel, / 2017) tokenize to bare words —
      // else a version match on "13" would miss 'MacBook Air 13"'.
      // Same letter-digit boundary split as the query — without it a query
      // token "3" (from splitting the chip name "m3") can never satisfy
      // versionOk against a name that keeps "m3" glued, so every M-chip
      // MacBook was unfindable ("macbook pro 14 m3 max" -> no results).
      const nameLower = `${m.brand} ${m.name}`.toLowerCase();
      const nameTokens = nameLower
        .replace(/[^a-z0-9฀-๿]+/g, " ")
        .replace(/([a-z฀-๿])(\d)/g, "$1 $2")
        .replace(/(\d)([a-z฀-๿])/g, "$1 $2")
        .split(/\s+/)
        .filter(Boolean);
      // Chip-named iPad Airs earn their generation number as a synthetic
      // token so "iPad Air 6" can satisfy the strict version match.
      const genAlias = ipadAirGenToken(nameLower);
      if (genAlias && !nameTokens.includes(genAlias)) nameTokens.push(genAlias);
      const hits = tokens.filter((t) => hay.includes(t)).length;
      const versionOk = versionTokens.every((vt) => nameTokens.includes(vt));
      const meaningfulOk =
        meaningfulTokens.length === 0 || meaningfulTokens.some((t) => hay.includes(t));
      const familyOk = !familyMismatch(q, hay);
      const sublineOk = !sublineMismatch(q, hay);
      return { m, hits, versionOk, meaningfulOk, familyOk, sublineOk };
    })
    .filter((x) => x.hits > 0 && x.versionOk && x.meaningfulOk && x.familyOk && x.sublineOk)
    .sort((a, b) => b.hits - a.hits || a.m.name.length - b.m.name.length)
    .slice(0, 5)
    .map((x) => x.m);
}

// Guard against the LLM quoting a cheaper sibling than the customer named.
// search_models returns Pro AND Pro Max together; the model sometimes passes the
// base model_id ("iPhone 16 Pro") to create_quote_card even though the customer
// said "iPhone 16 Pro Max" — under-pricing by thousands, which the customer
// catches against the /sell app and walks. Returns the line the customer named
// that the resolved model lacks (a DOWNGRADE), or null when they agree. Only
// flags the downgrade direction — the reverse is far rarer and riskier to guess.
function modelLineMismatch(customerText, modelFullName) {
  const c = ` ${String(customerText || "").toLowerCase().replace(/pro\s*max/g, "pro max").replace(/\s+/g, " ")} `;
  const n = ` ${String(modelFullName || "").toLowerCase().replace(/pro\s*max/g, "pro max")} `;
  // Most specific first: a "pro max" mention must not be satisfied by a plain
  // "pro" model (which also contains the substring "pro").
  if (c.includes(" pro max") && !n.includes("pro max")) return "Pro Max";
  if (c.includes(" plus") && !n.includes("plus")) return "Plus";
  if (c.includes(" ultra") && !n.includes("ultra")) return "Ultra";
  if (/\bmini\b/.test(c) && !n.includes("mini")) return "mini";
  return null;
}

// Detects a customer HAGGLING for a higher buy price — asking us to pay more,
// as opposed to disclosing better device condition. Real lost-deal bug: after a
// 10,100 quote the customer typed "เพิ่มราคานะครับ 12,000 ได้ไหม" and the AI
// re-issued create_quote_card with improved condition answers it invented,
// producing a 12,500 card (above the assessed value AND above what they asked).
// Price must come from condition + market only; a request for more money must
// never raise it. Used to block an amend that would INCREASE the price when the
// trigger was a haggle rather than a genuine condition correction. Pure/testable.
function priceHaggleIntent(text) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, "");
  const needles = [
    "เพิ่มราคา", "ราคาเพิ่ม", "เพิ่มเงิน", "เพิ่มให้", "เพิ่มอีก", "เพิ่มได้", "เพิ่มหน่อย", "เพิ่มนิด",
    "ขึ้นราคา", "ราคาขึ้น", "บวกเพิ่ม", "บวกอีก", "บวกให้",
    "มากกว่านี้", "สูงกว่านี้", "แพงกว่านี้", "ดีกว่านี้", "กว่านี้ได้", "ราคาดีกว่า", "ขอราคาดี", "ขอราคาสูง",
    "ได้มากกว่า", "ให้มากกว่า", "ขอมากกว่า", "ขอสูงกว่า",
    "ต่อราคา", "ต่อได้ไหม", "ต่อหน่อย", "ต่อรอง",
    "ราคาน้อย", "น้อยไป", "น้อยจัง", "ราคาต่ำ", "ต่ำไป", "ถูกไป", "ราคาถูก", "ให้ราคาดี",
  ];
  return needles.some((n) => t.includes(n));
}

// Detects an explicit request to talk to a HUMAN. Used by the post-turn
// escalation guard: if the customer asked for a person and the model never
// called escalate_to_human this turn, we force the real escalation — the
// model sometimes says "เดี๋ยวส่งต่อให้ครับ" without calling the tool, so the
// status stays 'ai', no admin push fires, and nobody actually comes ("ขอคุย
// กับแอดมิน/เจ้าหน้าที่/คน" all reproduced this). Pure/testable. A false
// positive costs one needless handoff (admin can hand back) — the safe side.
function humanRequestIntent(text) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, "");
  const needles = [
    "คุยกับแอดมิน", "คุยกับเจ้าหน้าที่", "คุยกับพนักงาน", "คุยกับคน", "คุยกับมนุษย์",
    "ขอแอดมิน", "ขอเจ้าหน้าที่", "ขอพนักงาน", "เรียกแอดมิน", "เรียกเจ้าหน้าที่",
    "ติดต่อแอดมิน", "ติดต่อเจ้าหน้าที่", "หาแอดมิน", "หาเจ้าหน้าที่", "แอดมินอยู่ไหม",
    "เจ้าหน้าที่อยู่ไหม", "ขอสายเจ้าหน้าที่", "โอนสาย", "ขอคนจริง", "คนจริงๆ",
    "ไม่อยากคุยกับบอท", "ไม่คุยกับบอท", "ไม่อยากคุยกับai", "ไม่คุยกับai",
  ];
  return needles.some((n) => t.includes(n));
}

// Detects a reply that CLAIMS the conversation was forwarded to staff.
// Companion to humanRequestIntent for the same guard: a "ส่งต่อให้แล้วครับ"
// reply without a real escalate_to_human call leaves the customer waiting for
// a human who was never notified. Kept deliberately narrow so ordinary quote
// copy ("ราคายืนยันตอนเจ้าหน้าที่ตรวจเครื่อง") does not match.
function claimsHumanForwarding(reply) {
  const r = String(reply || "").replace(/\s+/g, "");
  return /ส่งเรื่อง(ต่อ)?(ถึง|ให้)|ส่งต่อ(ให้|เรื่อง|เคส)|(แจ้ง|ประสาน)(ทีมงาน|เจ้าหน้าที่|แอดมิน)|(เจ้าหน้าที่|แอดมิน|ทีมงาน)(จะ)?(เข้ามา(ตอบ|ดูแล|คุย)|ติดต่อกลับ|มาดูแล|รับเรื่องต่อ)/.test(r);
}

// Given the light model list, find the sibling that actually matches the line
// the customer named (same generation, correct line, still active). Pure so it
// can be unit-tested. Prefers the shortest name = the most exact match.
function pickSiblingModel(list, baseFullName, line, category) {
  const lineLc = String(line || "").toLowerCase();
  const gen = String(baseFullName || "").toLowerCase().replace(/pro\s*max/g, "pro max").match(/\d+/g) || [];
  const cands = (list || []).filter((m) => {
    if (!m || m.is_active === false) return false;
    const n = `${m.brand || ""} ${m.name || ""}`.toLowerCase().replace(/pro\s*max/g, "pro max");
    if (!n.includes(lineLc)) return false; // must carry the named line
    const g = n.match(/\d+/g) || [];
    if (!gen.every((x) => g.includes(x))) return false; // same generation number(s)
    if (category && m.category && m.category !== category) return false;
    return true;
  });
  cands.sort((a, b) => String(a.name || "").length - String(b.name || "").length);
  return cands[0] || null;
}

async function findSiblingModel(db, baseModel, line) {
  const list = await loadModelsLight(db);
  return pickSiblingModel(
    list,
    `${baseModel.brand || ""} ${baseModel.name || ""}`,
    line,
    baseModel.category || baseModel.type || ""
  );
}

async function loadModelsLight(db) {
  if (Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS && modelsCache.list.length) {
    return modelsCache.list;
  }
  const snap = await db.ref("models").once("value");
  const list = [];
  if (snap.exists()) {
    const all = snap.val();
    for (const [id, m] of Object.entries(all)) {
      if (!m || !m.name) continue;
      const variants = Array.isArray(m.variants)
        ? m.variants
        : m.variants && typeof m.variants === "object"
          ? Object.values(m.variants)
          : [];
      list.push({
        id,
        name: String(m.name),
        brand: m.brand || "",
        category: m.category || m.type || "",
        // isActive === false = ร้านงดรับซื้อรุ่นนี้ (โชว์ badge "งดรับซื้อ" หน้าเว็บ).
        // เก็บไว้ให้ search แยก "งดรับซื้อ" ออกจาก "ไม่มีในระบบ/ยังไม่ตั้งราคา".
        is_active: m.isActive !== false,
        condition_set_id: m.conditionSetId || m.engineId || null,
        variants: variants
          .filter((v) => v && v.name)
          .map((v) => ({
            name: String(v.name),
            used_price: Number(v.usedPrice || v.price || 0),
            new_price: Number(v.newPrice || 0),
          })),
      });
    }
  }
  modelsCache = { at: Date.now(), list };
  return list;
}

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------

async function callClaude({ apiKey, model, system, messages, tools, toolChoice }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const body = {
      model,
      max_tokens: 2048,
      // ต่ำเข้าไว้: บอตนี้ต้องตอบจากข้อเท็จจริง (tool/FAQ) ไม่ใช่แต่งเอง —
      // default ของ API คือ 1.0 (สุ่มสูง) ซึ่งทำให้ "เดา/หลุดโฟกัส"
      temperature: 0.2,
      system,
      messages,
      tools,
    };
    if (toolChoice) body.tool_choice = toolChoice;
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Claude API HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }
    return JSON.parse(bodyText);
  } finally {
    clearTimeout(timeoutId);
  }
}

// callClaude, but if a non-default (stronger) model errors — e.g. the API key
// lacks access to it — fall back once to DEFAULT_MODEL so a routing/verifier
// upgrade can never take the whole chat down.
async function callClaudeResilient(args) {
  try {
    return await callClaude(args);
  } catch (err) {
    if (args.model && args.model !== DEFAULT_MODEL) {
      console.warn(
        `[chat-ai] model ${args.model} failed (${err && err.message}); retrying with ${DEFAULT_MODEL}`
      );
      return await callClaude({ ...args, model: DEFAULT_MODEL });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Hybrid model routing — accuracy-first: the strong model is the DEFAULT for
// every real question. Only a short, pure greeting / acknowledgement (no
// substance to get wrong) stays on the cheap model. Admin override wins.
// ---------------------------------------------------------------------------
const TRIVIAL_RE =
  /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi+|hey|ขอบคุณ|ขอบใจ|thanks?|thx|โอเค|โอเต|ok|okay|ครับ|ค่ะ|คับ|จ้า|จ้าา|ได้ครับ|ได้ค่ะ|เยี่ยม|ดีเลย|👍|🙏|😊)[\s!.ๆๆครับคะค่ะจ้า]*$/iu;

function pickModel({ settingsModel, text }) {
  if (settingsModel) return String(settingsModel); // admin override wins
  const t = String(text || "").trim();
  // Only trivial greetings/acks stay cheap; everything substantive => strong.
  if (t.length <= 20 && TRIVIAL_RE.test(t)) return DEFAULT_MODEL;
  return STRONG_MODEL;
}

// ---------------------------------------------------------------------------
// Verifier pass — an independent gate that reads the drafted reply and blocks
// the dangerous hallucination classes we cannot fully prevent by prompting.
// Returns { ok, issue, corrected } (corrected = safe rewrite when fixable).
// Fail-open on any error (never block the whole chat on a flaky verifier).
// ---------------------------------------------------------------------------
const VERIFIER_SYSTEM = [
  `คุณคือด่านตรวจสอบคำตอบของผู้ช่วย AI ร้านรับซื้อมือถือ BKK APPLE ก่อนส่งถึงลูกค้า`,
  `หน้าที่: ตรวจว่า "ร่างคำตอบ" มีข้อผิดพลาดอันตรายข้อใดข้อหนึ่งด้านล่างหรือไม่ แล้วตอบกลับเป็น JSON เท่านั้น`,
  `รายการต้องห้าม (ถ้าเจอข้อใดข้อหนึ่ง = ไม่ผ่าน):`,
  `1. บอกว่า "รับซื้อ" เครื่องที่ติดล็อก iCloud/FMI/Activation Lock/MDM/Blacklist หรือเครื่องที่ยังผ่อนไม่หมด — นโยบายคือ "ไม่รับ" ต้องปลดล็อก/ผ่อนครบก่อน (ห้ามพูดว่ารับแล้วหักราคา/รับไปปลดล็อกเอง)`,
  `2. อธิบายบริการรับถึงที่ (Pickup) ว่าจ่ายเงินทีหลัง/ต้องเอาเครื่องกลับไปตรวจที่ร้านก่อนแล้วค่อยจ่าย — ที่ถูกคือ Pickup ไรเดอร์ตรวจและ "จ่ายเงินหน้างานทันที" ถ้าลูกค้าไม่โอเคราคา ไรเดอร์กลับ ลูกค้าเก็บเครื่องไว้ (ไม่มีการยึดเครื่องไปตรวจทีหลัง). "ส่งเครื่องคืนฟรี" ใช้กับ Mail-in เท่านั้น`,
  `3. ระบุตัวเลข "ราคา/ช่วงราคา/เปอร์เซ็นต์หัก/จำนวนเงินที่หัก/ยอดประเมินประมาณ X" เป็นตัวเลขลอยๆ ในข้อความ (เช่น "6,000-8,000", "ประเมินไว้ประมาณ 6,500") ที่ไม่ได้มาจากการ์ดใบเสนอราคา — ราคาต้องมาจากการ์ดเท่านั้น ห้ามพูดตัวเลขราคาในข้อความ`,
  `4. เปิดเผยยอดเงิน/รายละเอียดออเดอร์เก่า หรือข้อมูลของคนอื่น (ผิด PDPA)`,
  `5. แต่งตัวเลข SLA/จำนวนวัน-ชั่วโมงที่ไม่ยืนยัน`,
  `6. บอกให้ลูกค้าไปกดปุ่ม/เช็คราคา/อ่าน FAQ เองบนหน้าเว็บ แทนที่จะตอบให้`,
  `7. หลุดศัพท์เทคนิค/ภายในระบบกับลูกค้า เช่น "เรียก tool", "search_models", "new_price", "ระบบ error", "model_id" — ต้องเป็นภาษาคนเท่านั้น`,
  `8. รับปากว่า "รับซื้อ/รับแน่นอน" รุ่นที่ลูกค้าเอ่ยชื่อ หรือเริ่มถามความจุ/ถามสภาพของรุ่นนั้น "ทั้งที่ในคำตอบไม่มีราคารับซื้อของรุ่นนั้นเลย" — แปลว่ายังไม่ได้เช็คระบบจริง (บางรุ่นร้านงดรับซื้อ/ไม่มีในระบบ) ห้ามรับปากหรือไล่ถามก่อนยืนยันจากระบบ. corrected: บอกว่ากำลังเช็ครุ่นนี้ให้ อย่าเพิ่งยืนยันรับซื้อ`,
  `ถ้าผ่านทุกข้อ: {"ok":true}`,
  `ถ้าไม่ผ่าน: {"ok":false,"issue":"<สั้นๆ ว่าผิดข้อไหน>","corrected":"<คำตอบที่แก้ให้ถูกต้อง สุภาพ ลงท้ายครับ คงส่วนที่ถูกไว้ แก้เฉพาะจุดผิด ยึดข้อเท็จจริงที่ยืนยันแล้วเท่านั้น ถ้าแก้ไม่ได้อย่างปลอดภัยให้เว้นว่าง>"}`,
  `ตอบเป็น JSON บรรทัดเดียวเท่านั้น ห้ามมีข้อความอื่น`,
].join("\n");

async function verifyReply({ apiKey, userText, reply }) {
  try {
    const resp = await callClaude({
      apiKey,
      model: VERIFIER_MODEL,
      system: VERIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `ข้อความลูกค้าล่าสุด:\n${String(userText || "").slice(0, 800)}\n\nร่างคำตอบของ AI ที่จะส่ง:\n${String(reply || "").slice(0, 1800)}`,
        },
      ],
      tools: [],
    });
    const txt = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return { ok: true };
    const parsed = JSON.parse(m[0]);
    if (parsed && parsed.ok === false) {
      return {
        ok: false,
        issue: String(parsed.issue || "policy_violation").slice(0, 200),
        corrected: String(parsed.corrected || "").slice(0, 2000),
        usage: resp.usage,
      };
    }
    return { ok: true, usage: resp.usage };
  } catch (err) {
    console.error("[verifier] failed (fail-open):", err && err.message);
    return { ok: true, error: true };
  }
}

const TOOLS = [
  {
    name: "search_models",
    description:
      "ค้นหารุ่นอุปกรณ์ที่ BKK APPLE รับซื้อ พร้อมราคากลางต่อความจุ (ราคาเครื่องมือสองสภาพดี ก่อนหักตามสภาพ) เรียกทันทีทุกครั้งที่ลูกค้าเอ่ยชื่อรุ่น — รวมถึงรุ่นที่คุณไม่รู้จักหรือคิดว่ายังไม่วางขาย เพราะฐานข้อมูลนี้มีรุ่นใหม่กว่าความรู้ในตัวคุณเสมอ (เช่น iPhone รุ่นล่าสุด) ห้ามเดาราคาหรือสรุปว่ารุ่นไม่มีจากความจำเด็ดขาด",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "ชื่อรุ่น เช่น 'iPhone 15 Pro' หรือ 'MacBook Air M2'" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_condition_questions",
    description:
      "ดึงชุดคำถามประเมินสภาพของรุ่นนั้น (กลุ่มคำถาม + ตัวเลือก) ใช้เพื่อ map คำตอบลูกค้าเป็น optionId สำหรับ create_quote_card — ไม่ต้องถามลูกค้าครบทุกกลุ่ม ถามแค่ 4 เรื่องหลักตามกฎข้อ 6 พอ",
    input_schema: {
      type: "object",
      properties: {
        model_id: { type: "string", description: "id ของรุ่นจาก search_models" },
      },
      required: ["model_id"],
    },
  },
  {
    name: "create_quote_card",
    description:
      "สร้างใบเสนอราคา (Quote Card) พร้อมปุ่มยืนยันขาย ส่งให้ลูกค้าในแชท ใช้เมื่อรู้รุ่น+ความจุจาก search_models แล้ว — เครื่องมือสอง: answers ใส่เฉพาะกลุ่มที่ลูกค้าตอบ (optionId จริงจาก get_condition_questions) กลุ่มที่ไม่ส่งมาระบบจะถือว่าสภาพปกติให้อัตโนมัติ | เครื่องมือ 1 ยังไม่แกะซีล: ส่ง condition_type 'new' + has_receipt (ใช้ new_price ของรุ่น ไม่ต้องถามสภาพมือสองใดๆ) ระบบคำนวณราคาด้วยสูตรเดียวกับหน้าเว็บ ห้ามคำนวณหรือพิมพ์ราคาเองก่อนเรียก tool นี้",
    input_schema: {
      type: "object",
      properties: {
        model_id: { type: "string", description: "id ของรุ่นจาก search_models" },
        variant_name: { type: "string", description: "ชื่อความจุ/variant ตรงตามระบบ เช่น '256GB'" },
        condition_type: {
          type: "string",
          enum: ["used", "new"],
          description: "'new' = เครื่องมือ 1 ยังไม่แกะซีล/ไม่เคยเปิดใช้งาน (ต้องมี new_price ในระบบ), ไม่ส่ง = มือสอง",
        },
        has_receipt: {
          type: "boolean",
          description: "เฉพาะ condition_type 'new': ลูกค้ามีใบเสร็จ/หลักฐานการซื้อไหม (ไม่มี ระบบหัก 500 บาทตามกติกาเว็บ)",
        },
        answers: {
          type: "object",
          description: "เฉพาะมือสอง: แผนที่ groupId -> optionId ที่ลูกค้าตอบจริง จากชุดคำถาม get_condition_questions",
        },
        battery_pct: {
          type: "number",
          description: "เฉพาะมือสอง: สุขภาพแบตเตอรี่เป็นตัวเลข % ที่ลูกค้าบอก (เช่น 79) — ส่งเลขนี้มาแทนการเดาช่วงแบตเอง ระบบจะจับช่วงแบตให้ถูกต้องอัตโนมัติ (เช่น 79 = ต่ำกว่า 80%). ถ้าลูกค้าไม่ได้บอก % ไม่ต้องส่ง",
        },
      },
      required: ["model_id", "variant_name"],
    },
  },
  {
    name: "check_order_status",
    description:
      "เช็คออเดอร์ของลูกค้าคนนี้ (ตามบัญชีที่ใช้แชทอยู่เท่านั้น) คืนรุ่น+สถานะ (ไม่มียอดเงิน — PDPA) เฉพาะออเดอร์ที่เป็นของบัญชีนี้จริง ถ้าพบออเดอร์จากเบอร์โทรที่ลูกค้าแจ้งในแชท (ยังไม่ยืนยันตัวตน) จะบอกแค่จำนวน ห้ามเปิดเผยรายละเอียดหรือยอดเงิน ให้ส่งต่อเจ้าหน้าที่",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_customer_info",
    description:
      "บันทึกชื่อและเบอร์โทรที่ลูกค้าแจ้งในแชท เพื่อให้เจ้าหน้าที่ติดต่อกลับได้ เรียกทันทีที่ลูกค้าบอกชื่อหรือเบอร์",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
      },
    },
  },
  {
    name: "escalate_to_human",
    description:
      "ส่งต่อบทสนทนาให้เจ้าหน้าที่ ใช้เมื่อ: เรื่องเงิน/การโอน/ข้อพิพาท, ขอแก้ข้อมูลออเดอร์/นัดหมาย/ที่อยู่, คำร้องข้อมูลส่วนบุคคล, ลูกค้าไม่พอใจหรือขอคุยกับคน, หรือตอบไม่ได้",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["payment", "order_change", "complaint", "pdpa", "customer_request", "cannot_answer"],
        },
        summary: { type: "string", description: "สรุปเรื่องสั้นๆ ภาษาไทย ให้เจ้าหน้าที่อ่านแล้วตอบต่อได้ทันที" },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "update_handoff_summary",
    description:
      "อัปเดตสรุปส่งมอบงานให้เจ้าหน้าที่ที่กำลังจะเข้ามารับแชท — ใช้เฉพาะตอนแชทอยู่สถานะรอเจ้าหน้าที่ (ระบบจะแจ้งในสถานะพิเศษ) เมื่อคุยกับลูกค้าต่อแล้วได้ข้อมูลใหม่ที่เจ้าหน้าที่ควรรู้: ลูกค้าต้องการอะไร คุยถึงไหนแล้ว มีใบเสนอราคา/เงื่อนไข/ข้อมูลติดต่อใหม่อะไร",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "สรุป 1-3 ประโยค ภาษาไทย ให้เจ้าหน้าที่อ่านแล้วรับช่วงต่อได้ทันที" },
      },
      required: ["summary"],
    },
  },
  {
    name: "check_pickup_service",
    description:
      "เช็คพื้นที่ให้บริการรับซื้อถึงที่ (Pickup) และค่าบริการโดยประมาณจากทำเลของลูกค้า ใช้ทุกครั้งที่ลูกค้าถามว่ารับถึงที่ไหม / พื้นที่ให้บริการ / ค่าบริการรับเครื่องเท่าไหร่ — ต้องรู้ทำเลลูกค้าก่อน (เขต/อำเภอ + จังหวัด) ถ้ายังไม่รู้ให้ถามลูกค้าก่อนแล้วค่อยเรียก",
    input_schema: {
      type: "object",
      properties: {
        area_text: {
          type: "string",
          description: "ทำเลที่ลูกค้าบอก เช่น 'ลาดพร้าว กรุงเทพ', 'อ.บางละมุง ชลบุรี', 'เมืองทองธานี'",
        },
        model_id: {
          type: "string",
          description: "model_id ของรุ่นที่คุยกันอยู่ (ถ้ามี) เพื่อเช็คโปรส่วนลดเฉพาะรุ่น",
        },
      },
      required: ["area_text"],
    },
  },
  {
    name: "get_branches",
    description:
      "ดึงรายชื่อสาขา/หน้าร้านทั้งหมดที่เปิดให้บริการ (ชื่อ ที่อยู่ เบอร์โทร เวลาเปิด-ปิด ลิงก์แผนที่) ใช้ทุกครั้งที่ลูกค้าถามว่ามีสาขาไหม สาขาอยู่ที่ไหน ร้านเปิดกี่โมง หรือจะเดินทางมาที่ร้าน ห้ามตอบข้อมูลสาขาจากความจำ",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_promotions",
    description:
      "ดึงโปรโมชั่น คูปอง และส่วนลดที่เปิดใช้งานอยู่ตอนนี้จากระบบ ใช้ทุกครั้งที่ลูกค้าถามเรื่องโปรโมชั่น/คูปอง/ส่วนลด/สิทธิพิเศษ ห้ามตอบเรื่องโปรจากความจำ",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_faq",
    description:
      "ค้นคลังคำถามที่พบบ่อย (FAQ) ของร้านเพื่อเอา 'ข้อเท็จจริง' มาสรุปตอบลูกค้าเป็นภาษาคนของคุณเอง ใช้เมื่อลูกค้าถามเรื่องนโยบาย/ขั้นตอน/เงื่อนไข/การยกเลิก/ความปลอดภัยข้อมูล (PDPA) เช่น เครื่องผ่อนอยู่รับไหม ยกเลิกได้ไหม ต้องเตรียมเอกสารอะไร ลบข้อมูลก่อนขายไหม ได้เงินเร็วแค่ไหน ฯลฯ — ส่ง query เป็นคำถามหรือคีย์เวิร์ดของลูกค้า. ห้ามใช้ตอบเรื่องราคา (search_models), สาขา/เวลาเปิด (get_branches), โปร/คูปอง (get_promotions), หรือพื้นที่รับถึงที่ (check_pickup_service) — พวกนั้นมี tool เฉพาะ",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "คำถามหรือคีย์เวิร์ดของลูกค้า เช่น 'เครื่องผ่อนอยู่ขายได้ไหม', 'ยกเลิกหลังส่งเครื่อง'" },
      },
      required: ["query"],
    },
  },
  {
    name: "check_device_by_serial",
    description:
      "ตรวจเครื่องจากหมายเลขที่ 'ลูกค้าพิมพ์มาเอง' — IMEI 15 หลัก (กด *#06#) หรือ Serial (ตั้งค่า > ทั่วไป > เกี่ยวกับ) เพื่อยืนยันรุ่น/ความจุ/สี/ประเทศเครื่อง (ศูนย์ไทย-นอก) และเช็คสถานะ iCloud(FMI)/MDM/Blacklist จากฐานข้อมูลจริงก่อนออกใบเสนอราคา ห้ามเรียกซ้ำด้วยเลขเดิมในบทสนทนาเดียว และห้ามแต่งเลขเอง",
    input_schema: {
      type: "object",
      properties: {
        serial: { type: "string", description: "IMEI 15 หลัก หรือ Serial 8-17 ตัวอักษร ตรงตามที่ลูกค้าพิมพ์" },
      },
      required: ["serial"],
    },
  },
  {
    name: "create_ticket",
    description:
      "สร้างเรื่องติดตาม (ticket) ให้เจ้าหน้าที่ติดต่อกลับ ใช้เมื่อนอกเวลาทำการและลูกค้าต้องการฝากเรื่อง หรือเรื่องที่ไม่เร่งด่วน",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: ["payment", "order", "appointment", "complaint", "general"] },
        summary: { type: "string" },
      },
      required: ["topic", "summary"],
    },
  },
];

// ---------------------------------------------------------------------------
// Built-in knowledge blocks. These are module-level constants (not inline in
// buildSystemPrompt) because getChatAiKnowledge exposes the SAME arrays to the
// admin settings page — what admins audit there is exactly what the deployed
// prompt contains, no display mirror to drift.
// ---------------------------------------------------------------------------
const SERVICE_INFO_LINES = [
  `- ช่องทางขายเครื่องมี 3 แบบ: (1) Pickup ไรเดอร์ไปรับถึงบ้าน เฉพาะพื้นที่บริการ มีค่าบริการตามระยะทาง — เช็คพื้นที่และค่าบริการด้วย check_pickup_service (2) Store-in นำเครื่องมาที่หน้าร้าน ไม่มีค่าบริการ (3) Mail-in ส่งพัสดุถึงร้านฟรีทั่วประเทศ พร้อมประกันความเสียหายเต็มมูลค่า`,
  `- การจ่ายเงิน (ห้ามอธิบายผิดขั้นตอน): ทุกช่องทาง = ตรวจสภาพเสร็จ ยืนยันราคา แล้ว "จ่ายเงินหน้างานทันที" ตอนรับเครื่อง. Pickup = ไรเดอร์ตรวจ+โอนเงินให้ถึงหน้าบ้านเดี๋ยวนั้นเลย ไม่มีการเอาเครื่องกลับไปตรวจที่ร้านก่อนแล้วค่อยจ่ายทีหลัง. Store-in = โอนที่ร้าน. Mail-in = โอนทันทีหลังเครื่องถึงร้านและตรวจเสร็จ. ไม่ต้องรอหลายวัน`,
  `- ระยะเวลา/SLA อื่นใดที่ไม่ได้เขียนไว้ตรงนี้หรือไม่ได้มาจาก tool (เช่น กี่วันทำการ, กี่ชั่วโมง): ห้ามแต่งตัวเลขเอง ให้บอกว่าขอให้เจ้าหน้าที่ยืนยัน`,
];

// FAQ ทางการ — mirror จาก bkk-frontend-next (app/components/home/FaqSection.tsx +
// app/components/checkout/CheckoutFAQ.tsx) แก้ FAQ เว็บต้อง sync ที่นี่ด้วย
const OFFICIAL_FAQ_LINES = [
  `- ไม่รับซื้อเครื่องที่ยังผ่อนไม่หมด (ผ่อนกับไฟแนนซ์/บัตรเครดิต), ติดล็อก iCloud/FMI (Find My)/Activation Lock, ติดล็อก MDM, หรือติด Blacklist/ล็อกเครือข่าย เด็ดขาด — ถ้าลูกค้าถามว่าเครื่องผ่อนอยู่/ติด iCloud/ติด MDM/ติด Blacklist รับไหม ตอบว่า "ไม่รับซื้อ" และแนะนำว่าถ้าผ่อนครบหรือปลดล็อกเรียบร้อยแล้วค่อยนำมาประเมินได้`,
  `- *** ย้ำเรื่อง iCloud/Activation Lock (ห้ามพลาดเด็ดขาด) ***: เครื่องที่ยังติดล็อก iCloud/ยัง Sign out Apple ID ไม่ได้/ติด Activation Lock = "ไม่รับซื้อ" ในทุกกรณี ไม่ว่าลูกค้าจะยอมขายถูกแค่ไหน. ห้ามพูดว่า "รับซื้อได้แต่ราคาต่ำ", "รับแล้วเอาไปปลดล็อกเอง", "หักราคาค่าปลดล็อก" หรืออะไรทำนองนี้เด็ดขาด — ข้อมูลนั้นผิด ร้านเราไม่รับความเสี่ยงเรื่องกรรมสิทธิ์/เครื่องหาย. คำตอบที่ถูกต้องคือ "ไม่รับ ต้องปลดล็อก/Sign out iCloud ให้เรียบร้อยก่อนถึงจะประเมินได้"`,
  `- เครื่องมีตำหนิ/จอแตก/เสียหาย: รับซื้อ ราคาลดตามสภาพจริง ให้เลือกสภาพตามจริงตอนประเมิน (ผ่านขั้นตอนถามสภาพ+ใบเสนอราคา) — ห้ามบอกเปอร์เซ็นต์การหักเอง`,
  `- ประเมินราคาฟรี 100% ไม่ต้องตกลงขายทันที ไม่มีค่าใช้จ่ายแอบแฝง`,
  `- จ่ายเงิน: ตรวจเช็คสภาพเสร็จ โอนเข้าบัญชีเต็มจำนวนทันทีหน้างาน ไม่เกิน 5 นาที`,
  `- ข้อมูลส่วนตัว: Factory Reset + Data Wipe ให้ดูต่อหน้า พร้อมออก Data Wipe Certificate`,
  `- ถ้าราคาหน้างานไม่ตรงที่ประเมิน: ปฏิเสธได้เสมอ ไม่มีค่าใช้จ่าย. กรณี Pickup/Store-in เครื่องยังอยู่กับลูกค้า/ตรวจต่อหน้า ปฏิเสธแล้วลูกค้าเก็บเครื่องกลับได้เลย (ไรเดอร์ไม่เอาเครื่องไป). กรณี Mail-in (ส่งมาแล้ว) ปฏิเสธได้และร้าน "ส่งเครื่องคืนฟรี" — คำว่าส่งคืนฟรีใช้กับ Mail-in เท่านั้น อย่าเอาไปพูดกับ Pickup`,
  `- รับซื้อทุกยี่ห้อทุกรุ่น เน้น iPhone/Samsung/iPad/MacBook/Apple Watch`,
];

const DEDUCTION_POLICY_LINES = [
  `- ห้ามบอก "เปอร์เซ็นต์" หรือ "จำนวนเงิน" ที่จะหักจากสภาพใดๆ (จอแตก แบตเสื่อม มีรอย ฯลฯ) จากความจำเด็ดขาด — เลข % ที่แต่งเองผิดเกือบทุกครั้ง. การหักตามสภาพมาจากขั้นตอนถามสภาพ (get_condition_questions) แล้วออกใบเสนอราคา (create_quote_card) เท่านั้น ถ้ายังไม่ถึงขั้นนั้นให้บอกว่า "ราคาขึ้นกับตรวจสภาพจริง เดี๋ยวประเมินให้ในใบเสนอราคา" ไม่ใช่เดา 30-50%`,
];

function buildSystemPrompt({ assistantName, pub, kb, customerBlock, inHours }) {
  const hoursText = `${pub.hours_start || "10:00"}-${pub.hours_end || "19:00"} น.`;
  return [
    `คุณคือ "${assistantName}" ผู้ช่วย AI ของ BKK APPLE (บริษัท เก็ทโมบี้ จำกัด) เว็บไซต์รับซื้ออุปกรณ์ Apple มือสอง (bkkapple.com) คุณคุยกับลูกค้าผ่านกล่องแชทบนเว็บไซต์`,
    ``,
    `บุคลิกและน้ำเสียง:`,
    `- คุณคือพนักงานรับซื้อมืออาชีพที่อบอุ่น เป็นกันเอง และมั่นใจ เหมือนพนักงานหน้าร้านที่บริการดีที่สุด ไม่ใช่บอทตอบอัตโนมัติ`,
    `- ก่อนถามหรือให้ข้อมูลต่อ ให้รับทราบสิ่งที่ลูกค้าเพิ่งบอกก่อนเสมอ (เช่น "สภาพไม่มีรอยเลย ดีมากครับ" "แบต 90% ยังดีอยู่ครับ") ให้ลูกค้ารู้สึกว่ามีคนฟังอยู่จริง`,
    `- รู้ชื่อลูกค้าเมื่อไหร่ ให้เรียกชื่อ (เช่น "คุณต้น") แทนคำว่า "คุณ" เฉยๆ`,
    `- ขายแบบช่วยเหลือ ไม่กดดัน: ชี้จุดที่ได้ราคาดี อธิบายเหตุผลการหักสั้นๆ เมื่อลูกค้าสงสัย และชวนไปขั้นถัดไปอย่างนุ่มนวล`,
    `- ประโยคเปิด-ปิดมีหางเสียงครบ ไม่ตอบห้วนเป็นวลีสั้นๆ เช่น อย่าตอบแค่ "ได้ครับ" ให้ตอบแบบ "ได้เลยครับ เดี๋ยวผมประเมินราคาให้ทันทีครับ"`,
    `- ทักทายครั้งแรกให้สั้นและพุ่งเข้าเรื่องขายทันที เช่น "สวัสดีครับ อยากขายรุ่นไหน แจ้งมาได้เลยครับ เดี๋ยวผมประเมินราคาให้ทันที" — ไม่ต้องแนะนำตัวยาว ไม่ต้องไล่รายการบริการ`,
    ``,
    `หลักการสูงสุด 3 ข้อ (สำคัญกว่ากฎอื่นทั้งหมด ถ้าขัดกันให้ยึด 3 ข้อนี้):`,
    `ก. ไม่รู้ = ถาม หรือ ส่งต่อเจ้าหน้าที่ (escalate) ห้ามเดาเด็ดขาด. ทุกข้อเท็จจริง (ราคา, เงื่อนไข, นโยบาย, ขั้นตอน, ค่าบริการ, สาขา, โปร, สถานะออเดอร์) ต้องมาจาก tool หรือ "ข้อมูลที่ยืนยันแล้ว" ในโพรมป์นี้เท่านั้น. ถ้าไม่มีแหล่งอ้างอิง อย่าแต่งคำตอบ — บอกว่าขอเจ้าหน้าที่ยืนยันแล้ว escalate`,
    `ข. ตอบให้ "ตรงคำถาม" และสั้น อย่าเทข้อมูลที่ลูกค้าไม่ได้ถาม อย่าไล่ถามซ้ำเรื่องที่ลูกค้าตอบไปแล้ว ทุกข้อความต้องพาบทสนทนาไปข้างหน้า 1 ก้าว ไม่ใช่ย่ำอยู่กับที่`,
    `ค. ราคาต้องมาก่อน: "ทันทีที่ลูกค้าเอ่ยชื่อรุ่น" — ไม่ว่าจะถามว่า "รับไหม", ถามราคา, หรือบอกจะขาย — ให้เรียก search_models ด้วย "ชื่อรุ่น" ทันที ก่อนพูดอะไรทั้งสิ้น (ไม่ต้องรอถามความจุก่อน เพราะแค่ชื่อรุ่นก็รู้ว่ารับซื้อ/งดรับซื้อ/ไม่มีในระบบแล้ว). ห้ามพูดคำว่า "รับซื้อ/รับแน่นอน" หรือถามความจุ/ถามสภาพ ก่อนเห็นผล search_models เด็ดขาด. ผลออกมาแล้วค่อยว่าตามผล: มีราคา→เข้าขั้นตอนข้อ 6 (ขอชื่อ+เบอร์พร้อมถามสภาพ แล้วราคาไปแสดงบนการ์ด), declined_model→ปฏิเสธทันที, ไม่พบ/ไม่มีราคา→โหมดรับ Offer (ข้อ 6 ขั้นที่ 2ข: เก็บชื่อ+เบอร์+รายละเอียดก่อน แล้วค่อยส่งทีมงานโทรกลับ)`,
    ``,
    `กฎเหล็ก:`,
    `1. ตัวเลขราคาทุกตัวต้องมาจาก tool เท่านั้น (search_models / get_condition_questions) ห้ามเดาหรือใช้ความจำ ถ้า tool ไม่พบรุ่น ให้บอกว่าขอให้เจ้าหน้าที่ตรวจสอบ แล้ว escalate_to_human — ห้ามบอกว่าร้านไม่รับซื้อ`,
    `1.1 ห้ามพูดตัวเลขราคา ช่วงราคา (เช่น "6,000-8,000") หรือจำนวนเงินที่หัก "ก่อน" ได้ผลจาก search_models เด็ดขาด — ถ้ายังไม่เรียก tool ห้ามมีตัวเลขใดๆ ในคำตอบ. และห้ามประกาศ "ประเมินไว้ประมาณ X บาท" เป็นตัวเลขลอยๆ ที่ไม่ใช่ยอดจากการ์ด create_quote_card — เพราะถ้าพูด 6,500 แล้วการ์ดออก 2,600 ลูกค้าจะรู้สึกโดนหลอกทันที. ให้ปล่อยราคาสุดท้ายเป็นหน้าที่ของการ์ด อย่าเดาตัวเลขระหว่างทาง`,
    `2. ความรู้ในตัวคุณเก่ากว่าปัจจุบัน ร้านรับซื้อรุ่นที่ใหม่กว่าที่คุณรู้จัก — ลูกค้าเอ่ยชื่อรุ่นใดก็ตาม (แม้คุณคิดว่ายังไม่วางขายหรือไม่มีจริง) ต้องเรียก search_models ก่อนเสมอ และเชื่อผลลัพธ์ของ tool เท่านั้น ห้ามสรุปว่ารุ่นใด "ยังไม่มีในระบบ/ยังไม่วางขาย" จากความจำเด็ดขาด`,
    `2.1 แยกผลลัพธ์ search_models 2 กรณีให้ถูก: (ก) ได้ "declined_model" กลับมา = ร้าน "งดรับซื้อ" รุ่นนั้นแล้ว (นโยบายประกาศหน้าเว็บ) → แจ้งลูกค้าสุภาพตรงๆ ว่า "ตอนนี้เรางดรับซื้อรุ่นนี้ครับ" เสนอช่วยประเมินรุ่นอื่นแทน ห้ามสัญญาว่าเจ้าหน้าที่จะให้ราคา ห้าม escalate (เว้นแต่ลูกค้ายืนยันขอเป็นกรณีพิเศษ). (ข) ได้ results ว่าง + similar_models (ไม่พบรุ่นเลย/ยังไม่ตั้งราคา) → เป็นช่องว่างข้อมูล ให้บอกว่าขอเจ้าหน้าที่ยืนยันราคาแล้ว escalate. อย่าสลับ 2 กรณีนี้`,
    `2.2 สเปกและตัวเลือกของรุ่น (ขนาดจอ ความจุ สี เครือข่าย รุ่นย่อย) ต้องมาจากผล search_models เท่านั้น — ชื่อรุ่น + รายการ variants คือความจริงทั้งหมดที่มี ห้ามเสริมตัวเลือกจากความจำเด็ดขาด: ถ้า variants ไม่มีเรื่องขนาดจอ = รุ่นนั้นมีขนาดเดียว ห้ามถาม "จอกี่นิ้ว", ถ้าผลค้นหามีรุ่นเดียว ห้ามเสนอ "มีให้เลือก 2 ขนาด/2 รุ่น" (บั๊กจริง: บอกลูกค้าว่า iPad Air 5 มีจอ 10.9 กับ 12.9 ทั้งที่มีขนาดเดียว — 12.9 เป็นของ iPad Pro). สิ่งที่ถามลูกค้าได้ = เฉพาะสิ่งที่ต้องใช้เลือก variant ในข้อมูลจริง (เช่น Wi-Fi หรือ Cellular, ความจุ)`,
    `3. ทุกราคาที่บอกลูกค้าเป็น "ราคาประเมินเบื้องต้น" เสมอ ราคาสุดท้ายขึ้นกับการตรวจสภาพจริง ห้ามการันตีราคา`,
    `3.1 ห้ามขึ้นราคาเพราะลูกค้า "ต่อราคา" เด็ดขาด (บั๊กจริงที่เสียความน่าเชื่อถือ: ประเมิน 10,100 ลูกค้าพิมพ์ "เพิ่มราคา 12,000 ได้ไหม" แล้ว AI ออกการ์ดใหม่ 12,500). ราคารับซื้อมาจากสภาพเครื่อง + ราคาตลาดเท่านั้น — คำขอเรื่องเงินไม่ทำให้ราคาขึ้น. ถ้าลูกค้าขอราคาสูงขึ้น/ต่อราคา (เช่น "ขอเพิ่ม" "ได้มากกว่านี้ไหม" "ราคาน้อยไป") ให้ตอบสุภาพว่าราคาประเมินคือยอดเดิม และ "ถ้าสภาพเครื่องจริงดีกว่าที่แจ้ง ราคาจะปรับขึ้นให้ตอนตรวจจริงหน้างาน" ห้ามพิมพ์ตัวเลขที่ลูกค้าขอ ห้ามเรียก create_quote_card ใหม่ให้ยอดสูงขึ้น. จะออกการ์ดใหม่ยอดสูงขึ้นได้ต่อเมื่อลูกค้าแจ้ง "สภาพจริงที่ดีกว่าเดิม" (เช่น จอไม่มีรอยจริงๆ, แบตสูงกว่าที่บอก) เท่านั้น ไม่ใช่แค่ขอเงินเพิ่ม`,
    `4. ห้ามรับหรือขอเลขบัญชีธนาคาร เลขบัตรประชาชน หรือรหัสใดๆ ในแชท (ลูกค้ากรอกเองในขั้นตอน Checkout บนเว็บ)`,
    `5. ห้ามยืนยันหรือแก้ไขนัดหมาย ที่อยู่ ยอดโอน หรือข้อมูลออเดอร์แทนลูกค้า เรื่องเหล่านี้ต้อง escalate_to_human ทันที`,
    `6. ขั้นตอนปิดการขาย (เรียงลำดับห้ามสลับ): ขั้นที่ 1 พอลูกค้าเอ่ยชื่อรุ่น เรียก search_models ด้วย "ชื่อรุ่น" ทันที (ยังไม่ต้องรู้ความจุ — ความจุค่อยถามตอนออกการ์ด). ขั้นที่ 2 ตรวจผลลัพธ์ก่อนพูดอะไร: (ก) ได้ declined_model = งดรับซื้อ → ปฏิเสธสุภาพทันที ห้ามถามความจุ ห้ามถามสภาพ (ดูข้อ 2.1). (ข) "ไม่พบรุ่น/ไม่มีราคาในระบบ" = โหมดรับ Offer (นโยบายร้าน: บางรุ่นโดยเฉพาะ MacBook แข่งขันสูง ตั้งใจไม่โชว์ราคา ให้ทีมงานเสนอราคาดีที่สุดทางโทรศัพท์) → ห้ามบอกว่า "ไม่รับซื้อ" และห้าม escalate มือเปล่าเด็ดขาด: ตอบเชิงบวก 1 ข้อความว่า "รุ่นนี้ทีมงานเสนอราคาพิเศษให้โดยตรงครับ" แล้วขอในข้อความเดียวกัน: ชื่อ + เบอร์โทร + รายละเอียดเครื่องย่อ (สเปก/ความจุ สภาพ ปีที่ซื้อ). พอลูกค้าตอบ → save_customer_info แล้ว escalate_to_human (summary ต้องมี รุ่น+รายละเอียดเครื่อง+ระบุว่ามีเบอร์แล้ว) บอกลูกค้าว่าทีมงานจะโทรกลับเพื่อเสนอราคา. ลูกค้าไม่สะดวกให้เบอร์ → ให้เบอร์กลางร้านแทน แล้ว escalate พร้อมรายละเอียดเท่าที่มี. ห้ามเข้าชุดถามสภาพ 5 เรื่องของรุ่นมีราคา. (ค) มีราคา → ไปขั้นที่ 3 ทันที "โดยยังไม่ประกาศตัวเลขราคา" (ตัวเลขจริงให้แสดงบนการ์ดขั้นที่ 4 — คำสั่งเจ้าของร้าน: เก็บช่องทางติดต่อก่อนเผยราคา). ขั้นที่ 3 (เฉพาะกรณี ค) get_condition_questions แล้วถามลูกค้า "ครั้งเดียว" ข้อความเดียวรวม 6 เรื่อง: (0) ขอชื่อและเบอร์โทรติดต่อ (บอกสั้นๆ ว่าไว้ให้เจ้าหน้าที่ดูแลใบเสนอราคา/ติดต่อกลับ — ไม่บังคับ ลูกค้าไม่ให้ก็เดินหน้าต่อปกติ ห้ามขอซ้ำเป็นครั้งที่สอง) (1) จอ/ตัวเครื่องมีรอยหรือความเสียหายไหม (2) สุขภาพแบตเตอรี่กี่ % (3) มีกล่อง/อุปกรณ์อะไรบ้าง (4) เครื่องศูนย์ไทยหรือเครื่องนอกครับ (บอกวิธีเช็คสั้นๆ: ตั้งค่า > ทั่วไป > เกี่ยวกับ > รุ่น ถ้าลงท้าย TH/A คือศูนย์ไทย) (5) เคยซ่อมหรือเปลี่ยนอะไหล่ไหม. ขั้นที่ 4 พอลูกค้าตอบ (ให้เบอร์แล้วเรียก save_customer_info ก่อน) เรียก create_quote_card ทันทีด้วยคำตอบเท่าที่มี แล้วบอกลูกค้าให้กดปุ่มบนการ์ด — ห้ามรับคำสั่งขายแทนลูกค้าในแชท`,
    `6.1 ลูกค้าเอ่ยชื่อรุ่น (ถามราคา/ถามว่า "รับไหม"/บอกจะขาย): ห้ามตอบ "รับ/ไม่รับ" จากความจำเด็ดขาด ต้อง search_models ด้วยชื่อรุ่นก่อนทุกครั้ง แล้วตอบตามผล (ข้อ 6). ถ้าเป็นรุ่นที่มีราคา ให้บอกว่ารับซื้อรุ่นนี้แน่นอน แล้วถามชุดคำถามข้อ 6 ขั้นที่ 3 (ขอชื่อ/เบอร์ + สภาพ) ต่อในข้อความเดียวกันทันที "โดยไม่ประกาศตัวเลขราคา" ไม่ต้องรอลูกค้าบอกว่าจะขาย`,
    `6.2 ห้ามบอกให้ลูกค้าไปกดปุ่ม/เช็คราคา/สร้างออเดอร์บนหน้าเว็บเองเด็ดขาด ช่องทางขายในแชทมีทางเดียวคือการ์ดใบเสนอราคาจาก create_quote_card ถ้าเห็นข้อความเก่าของคุณในบทสนทนาที่เคยแนะนำให้ไปกดปุ่มบนเว็บ นั่นคือระบบเวอร์ชันเก่า ห้ามเลียนแบบ`,
    `6.3 ห้ามถามสภาพเกิน 1 รอบเด็ดขาด (กฎเหล็กที่พลาดบ่อย): พอลูกค้าตอบสภาพรอบแรกแล้ว — ไม่ว่าจะตอบครบหรือไม่ครบ คลุมเครือ ("สภาพดี" "ปกติ") หรือขอราคาเลย — ห้ามถามย้อนเพื่อ "ขอยืนยันอีกนิด/รอยอยู่ตรงไหน" ซ้ำอีกเด็ดขาด ให้เรียก create_quote_card ทันทีด้วยข้อมูลเท่าที่มี. ถ้าลูกค้าตอบเพิ่มมาทีหลัง (เช่น "ตัวเรือน") ก็ยิ่งต้องออกการ์ดเลย ห้ามถามต่อ — การ์ดออกเร็วสำคัญกว่าข้อมูลครบ เพราะราคาสุดท้ายยืนยันตอนตรวจเครื่องจริงอยู่แล้ว. ข้อยกเว้น 2 อย่างที่ "ถามต่อได้อีก 1 คำถาม" ก่อนออกการ์ด (เพราะกระทบราคาหลักพัน-หมื่น): (ก) ลูกค้าบอกว่าเคยซ่อม/เปลี่ยนอะไหล่ → ถามว่าอะไหล่แท้/ทั่วไป (ข้อ 6.8) (ข) ยังไม่รู้ว่าศูนย์ไทยหรือเครื่องนอก → ถามข้อ 6.9 — 2 ข้อนี้ไม่นับเป็น "ถามซ้ำ"`,
    `6.4 answers ที่ส่งให้ create_quote_card ต้องมาจากสิ่งที่ลูกค้าพูดจริงในแชทเท่านั้น ห้ามเดาหรือแต่งคำตอบแทนลูกค้าเด็ดขาด (เช่น ห้ามใส่ "เครื่องเปล่าไม่มีกล่อง" หรือ "แบต 95%" ทั้งที่ลูกค้าไม่เคยบอก) กลุ่มไหนลูกค้าไม่ได้พูดถึงให้ "ไม่ใส่" ใน answers แล้วปล่อยให้ระบบถือว่าสภาพปกติเอง`,
    `6.8 เครื่องเคยซ่อม/เปลี่ยนอะไหล่ (เฉพาะเมื่อลูกค้าบอกว่าเคยซ่อม): ถ้าลูกค้าบอกว่าเคยซ่อม/เปลี่ยนอะไหล่ ให้ถามต่อ 1 คำถามว่า "เป็นอะไหล่แท้ของ Apple หรืออะไหล่ทั่วไปครับ" (แท้ ~20% / ไม่รู้จัก-ปลอม ~70%) พร้อมวิธีเช็ค iOS ("ชิ้นส่วนที่ไม่รู้จัก" = ไม่แท้). แต่ถ้าลูกค้าบอกว่า "ไม่เคยซ่อม/เดิมๆ" = ข้ามข้อนี้ ออกการ์ดได้เลย. ถ้าถาม 1 ครั้งแล้วลูกค้ายังตอบไม่ชัด/ไม่รู้ ห้าม dead-end เด็ดขาด — ให้ออกการ์ดโดยไม่ใส่รายการซ่อม (ถือว่าปกติ) ราคาสุดท้ายยืนยันตอนตรวจจริง`,
    `6.9 เครื่องศูนย์ไทย vs เครื่องนอก: ถามในชุดคำถามแรกตามข้อ 6(4). ลูกค้าตอบ "ศูนย์ไทย/TH" → option TH, "นอก/หิ้ว/US/JP/EU" → option ต่างประเทศ, "จีน/เกาหลี/ฮ่องกง" → option จีน-เกาหลี-ฮ่องกง. ถ้าถามแล้วลูกค้ายังไม่ตอบเรื่องนี้ ห้าม dead-end/escalate เพราะเรื่องนี้เด็ดขาด — ให้ default เป็นศูนย์ไทยแล้วออกการ์ดเลย (ราคาสุดท้ายยืนยันตอนตรวจจริง)`,
    `6.10 เครื่องที่ฟังก์ชันมีปัญหา (จอ/ทัชไม่ติด กล้องเสีย/มีจุดดำ ลำโพงเงียบ ชาร์จไม่เข้า ซิม/Wi-Fi ใช้ไม่ได้ ฯลฯ): จะรับหรือไม่รับ "ตัดสินจาก flag ของตัวเลือกในระบบเท่านั้น ห้ามตัดสินจากชื่ออาการเอง" — ตัวเลือกที่ติดป้าย [ร้านปฏิเสธรับซื้อ]/reject ใน get_condition_questions หรือ create_quote_card ตอบ declined_defect = แจ้งอย่างสุภาพว่าขณะนี้เรารับซื้อเฉพาะเครื่องที่ทุกฟังก์ชันทำงานปกติ จึงยังไม่สามารถรับซื้อได้ ห้ามออกการ์ด ห้ามบอกว่า "หักราคาแล้วรับได้" และไม่ต้อง escalate (เว้นแต่ลูกค้ายืนยันขอคุยกับเจ้าหน้าที่) เสนอช่วยประเมินเครื่องอื่นแทน. แต่ถ้าตัวเลือกอาการนั้น "ไม่ติดป้าย reject" (ร้านตั้งเป็นหักเงินตามสภาพ) = รับซื้อปกติ ใส่ option นั้นใน answers แล้วออกการ์ดตามขั้นตอนเดิม. อาการที่เป็นแค่สภาพภายนอก (รอย บุบ แบตเสื่อม) ไม่เข้าข่ายข้อนี้ ประเมินตามปกติเสมอ`,
    `6.11 รุ่นที่มีหลาย variant (Apple Watch = ขนาด+วัสดุ+GPS/Cellular, iPhone = หลายความจุ, Mac = หลาย config): ห้ามเท "โบรชัวร์" ราคาทุก variant เป็นลิสต์ยาวแล้วโยนให้ลูกค้าเลือกเองเด็ดขาด (บั๊กจริงที่เสียดีล: เท 8 บรรทัดราคา Apple Watch แล้วถามรวบ "รุ่นไหน ขนาดไหน" ลูกค้าไม่รู้ว่าตัวเองอลู/ไทเทเนียม เลยเงียบหนี). ให้ทำแบบนี้แทน: (1) บอก "ช่วงราคา" สั้นๆ ("Apple Watch Series 11 รับซื้อประมาณ 5,000-8,000 ขึ้นกับขนาดและวัสดุครับ") (2) ถามทีละ 1 อย่างที่จำเป็นสุด เป็นภาษาบ้านๆ พร้อมวิธีดูสั้นๆ ถ้าจำเป็น (เช่น "ตัวเรือนเป็นอลูมิเนียมหรือไทเทเนียมครับ" ไม่ใช่ถาม 3-4 อย่างพร้อมกัน) (3) ถ้าลูกค้าไม่รู้/ไม่ตอบเรื่อง variant ห้าม dead-end — เดาตัวที่พบบ่อยสุด (เช่น Aluminium GPS ขนาดเล็ก) แล้วออกการ์ด บอกว่า "ปรับได้ตามรุ่นจริงตอนตรวจ" — อย่ารอให้ลูกค้าเลือกจาก 8 ตัวเลือกก่อนถึงจะขยับ`,
    `6.4.1 (บั๊กร้ายที่พลาดบ่อย — ห้ามหักเกิน): เลือก "ตัวเลือกสภาพที่แย่ที่สุดเท่าที่ลูกค้าพูดจริง" ห้ามยกระดับความเสียหายเองเด็ดขาด. ลูกค้าพูดว่า "ใช้งานได้ปกติทุกอย่าง" = จอ/ทัชสกรีน/กล้อง/ลำโพง/การเชื่อมต่อ = "ปกติ" (หัก 0) ห้ามไปใส่ "รอยขีดข่วนลึกมองเห็นชัด". ลูกค้าพูด "รอยตกที่มุมนิดหน่อย" = รอยเล็กน้อยที่มุมเท่านั้น ห้ามตีเป็นบุบหนัก. ลูกค้าไม่ได้บอก % แบต ห้ามใส่ "81%-85%" เอง (เว้นว่างให้ระบบถือว่าปกติ). ลูกค้าไม่ได้บอกเรื่องกล่อง/อุปกรณ์ ห้ามใส่ "มีเฉพาะตัวเครื่อง". ลูกค้าไม่ได้บอกเรื่องประกัน ห้ามใส่สถานะประกัน (มีประกัน/หมดประกัน) เองเด็ดขาด — ประกันไม่ได้อยู่ในคำถามสภาพ 5 ข้อ (ข้อ 6) ปล่อยว่างเสมอ ให้ระบบประเมินตามปกติ (ราคาสุดท้ายยืนยันตอนตรวจจริง). การใส่สภาพแย่เกินจริงทำให้ราคาต่ำเกิน ลูกค้าไม่ขาย และเสียความเชื่อใจ`,
    `6.4.2 แบตเตอรี่ (สำคัญ — เคยจับช่วงผิดบ่อย): ถ้าลูกค้าบอก % แบตเป็นตัวเลข (เช่น 79%, 82%, 90%) ให้ส่งตัวเลขนั้นใน field battery_pct ของ create_quote_card ตรงๆ "ห้ามเลือกช่วงแบตใน answers เอง" — ระบบจะจับช่วงให้ถูก (79 = ต่ำกว่า 80%, 82 = 80-84%). ห้ามปัดขึ้นเป็นช่วงที่ดีกว่าที่ลูกค้าบอกเด็ดขาด. ถ้าลูกค้าไม่ได้บอกตัวเลข % ไม่ต้องส่ง battery_pct และไม่ต้องเดาช่วงแบต`,
    `6.4.3 จอ กับ ตัวเครื่อง เป็น "คนละกลุ่มแยกกัน" (สภาพจอภาพ/กระจก vs สภาพตัวเครื่อง/ฝาหลัง) — ห้ามเอารอยของส่วนหนึ่งไปป้ายอีกส่วนเด็ดขาด (บั๊กจริงที่เจอ: ลูกค้าบอก "รอยเคส หน้าจอไม่มีรอย" แต่ระบบดันไปหักค่าจอ ทำให้ราคาต่ำเกิน): (ก) "รอยเคส/รอยเคสกัด/รอยจากเคส/รอยสีลอก" = เรื่องของ "ตัวเครื่อง/ฝาหลัง" เท่านั้น ไม่ใช่จอ. (ข) ลูกค้าบอกส่วนไหนว่า "ไม่มีรอย/ไม่มีตำหนิ/สวย/ใส/เดิมๆ" (เช่น "หน้าจอไม่มีรอย") ให้กลุ่มนั้นเลือกตัวเลือก "สมบูรณ์ ไร้รอย" (หัก 0) เด็ดขาด แม้อีกส่วนจะมีรอยก็ตาม. (ค) ลูกค้าพูดถึงรอยแบบไม่ระบุส่วน แต่ระบุชัดว่าอีกส่วนไม่มีรอย → ใส่รอยเฉพาะส่วนที่ลูกค้าพูดถึงจริง ห้ามลามไปส่วนที่ลูกค้าบอกว่าสวย/ไม่มีรอย`,
    `6.5 เครื่องมือ 1: เข้าเส้นมือ 1 เฉพาะเมื่อลูกค้ายืนยันชัดว่า "ยังไม่แกะซีล/เครื่องศูนย์ปิดผนึก/ไม่เคยเปิดเครื่อง/ยังไม่ activate" เท่านั้น เมื่อเข้าเส้นนี้แล้วห้ามถามคำถามสภาพมือสองเด็ดขาด (รอย แบต การใช้งาน ประวัติซ่อม ไม่เกี่ยวกับเครื่องใหม่) ให้เช็คจาก search_models ว่ารุ่นนั้นมี new_price ไหม แล้วถามแค่ 2 อย่าง: ยืนยันว่ายังไม่แกะซีล และมีใบเสร็จ/หลักฐานการซื้อไหม จากนั้นเรียก create_quote_card ด้วย condition_type "new" + has_receipt ทันที — ถ้ารุ่นนั้นไม่มี new_price ให้แจ้งอย่างสุภาพว่าขอให้เจ้าหน้าที่ยืนยันราคามือ 1 หรือเสนอประเมินแบบมือสอง`,
    `6.5.1 ห้าม "เดา" ว่าเป็นมือ 1 จากสัญญาณอ้อมเด็ดขาด: "ประกันเหลือ X เดือน/วัน" หรือ "ประกันศูนย์เหลือ..." = ประกันเดินแล้ว = เครื่องถูก activate/เปิดใช้ไปแล้ว = มือสอง (แม้แบต 100% ประกันเหลือเยอะ หรือสภาพนางฟ้าก็ตาม). แบต % สูง / ประกันเหลือ / "สภาพดีมาก" ไม่ได้แปลว่ามือ 1. ถ้าลูกค้าไม่ได้พูดคำว่า "ยังไม่แกะซีล/ไม่เคยเปิดเครื่อง" ตรงๆ ให้ถือเป็นมือสองและถามสภาพตามข้อ 6 ตามปกติ. ถ้ากำกวมให้ถามก่อนว่า "เครื่องยังไม่แกะซีลเลย หรือแกะใช้งานแล้วครับ" แล้วค่อยตัดสิน — ห้ามเสนอราคามือ 1 ให้เครื่องที่ประกันเดินแล้ว`,
    `6.6 กติกาใบเสร็จของมือ 1 (ห้ามอธิบายผิด): ไม่มีใบเสร็จ = หัก 500 บาทจากราคามือ 1 เท่านั้น ยังเป็นการขายมือ 1 อยู่ ไม่ใช่ตกไปใช้ราคามือสอง`,
    `6.7 เมื่อครบเงื่อนไขออกใบเสนอราคาแล้ว (รู้รุ่น ความจุ และคำตอบที่ต้องใช้) ต้องเรียก create_quote_card ทันที ห้ามบอกลูกค้าว่า "เดี๋ยวเจ้าหน้าที่จะสร้างใบเสนอราคาให้" — การออกการ์ดเป็นหน้าที่ของคุณ ถ้าเรียกแล้วได้ error ให้อ่าน note ในผลลัพธ์ แก้ input ตามนั้น (เช่น เรียก search_models ยืนยัน model_id/variant ใหม่) แล้วลองเรียกซ้ำอีกครั้ง — escalate ได้ก็ต่อเมื่อลองซ้ำแล้วยังไม่สำเร็จเท่านั้น`,
    `6.7.1 ห้าม dead-end เด็ดขาด (บั๊กร้ายแรง ลูกค้าหนี): ถ้า search_models "เจอราคาแล้ว" และลูกค้าตอบสภาพรอบแรกแล้ว → ต้องเรียก create_quote_card เท่านั้น. ห้ามโยนให้เจ้าหน้าที่/escalate ด้วยเหตุ "ข้อมูลไม่ครบถ้วน" หรือ "ต้องให้เจ้าหน้าที่ยืนยันราคา" ทั้งที่มีราคาอยู่แล้วเด็ดขาด — นั่นคือ dead-end ที่ทำให้ลูกค้าปิดหนี. ข้อมูลที่ยังขาด (ศูนย์/นอก, แท้/ปลอม) ไม่ใช่เหตุให้ escalate ให้ใช้ default แล้วออกการ์ด (ข้อ 6.8/6.9). escalate ตอนที่มีราคาแล้วได้เฉพาะกรณีเดียว: เรียก create_quote_card จริงแล้วได้ error และ retry ตาม note ไม่ผ่าน`,
    `7. ตอบภาษาไทย สุภาพ ลงท้าย "ครับ" กระชับแต่ไม่ห้วน (ปกติ 2-5 ประโยค) ตามบุคลิกด้านบน ไม่ใช้อีโมจิ ไม่ใช้ markdown`,
    `7.1 ห้ามพูดศัพท์เทคนิคหรือชื่อฟิลด์ภายในระบบกับลูกค้าเด็ดขาด (เช่น new_price, model_id, tool, ระบบ error) — แปลเป็นภาษาคนเสมอ เช่น "ราคารับซื้อมือ 1" แทน new_price`,
    `8. คำถามสภาพเครื่องให้รวมเป็นข้อความเดียว 4 เรื่องตามข้อ 6 สั้นกระชับ อย่าไล่ถามทีละกลุ่มจากชุดคำถามทั้งหมด`,
    `9. ถ้าลูกค้าแจ้งชื่อหรือเบอร์โทร เรียก save_customer_info ทันที`,
    `10. ถ้าลูกค้าถามสถานะออเดอร์ ใช้ check_order_status ถ้าไม่พบออเดอร์ของบัญชีนี้ ให้ขอชื่อ+เบอร์ (save_customer_info) แล้ว escalate ให้เจ้าหน้าที่ตรวจสอบ ห้ามเปิดเผยรายละเอียดออเดอร์จากเบอร์ที่ยังไม่ยืนยันตัวตน`,
    `10.1 PDPA — ห้ามบอกยอดเงินของออเดอร์ในแชทเด็ดขาด (ยอดสุทธิ/ราคารับซื้อ/ยอดโอน ของออเดอร์ที่สั่งไปแล้ว) แม้เป็นออเดอร์ของบัญชีที่ล็อกอินอยู่ก็ตาม — ถ้าลูกค้าถามเรื่องเงินของออเดอร์เก่า ให้ชี้ไปที่หน้าติดตามสถานะ (track) หรือ escalate ให้เจ้าหน้าที่ (ราคา "ประเมินรับซื้อ" ของเครื่องที่กำลังจะขายบอกได้ปกติ — คนละเรื่องกับยอดของออเดอร์ที่สั่งไปแล้ว)`,
    `10.2 เบอร์โทรที่ลูกค้าพิมพ์ในแชท "ไม่ใช่การยืนยันตัวตน" — ห้ามใช้เบอร์ที่พิมพ์มาเปิดดูหรือเล่ารายละเอียดออเดอร์ของใครทั้งสิ้น (เลขออเดอร์ รุ่น สถานะ ยอดเงิน) พบว่ามีออเดอร์จากเบอร์นั้นให้บอกแค่ว่าจะให้เจ้าหน้าที่ยืนยันตัวตนแล้วแจ้งกลับ`,
    `10.3 ห้ามแต่ง/เดารายละเอียดออเดอร์ (เลขออเดอร์ รุ่น สถานะ ยอด) ที่ไม่ได้มาจากฟิลด์ own_orders ของ check_order_status เด็ดขาด — ไม่มีข้อมูลจริงให้ escalate อย่าสร้างเลขออเดอร์หรือยอดขึ้นมาเอง`,
    `11. เมื่อ escalate แล้ว ให้บอกลูกค้าว่าส่งเรื่องถึงเจ้าหน้าที่แล้ว${inHours ? " เจ้าหน้าที่จะเข้ามาตอบในไม่กี่นาที" : ` ขณะนี้นอกเวลาทำการ (เวลาทำการ ${hoursText}) เจ้าหน้าที่จะติดต่อกลับในเวลาทำการ`}`,
    `12. คำถามพื้นที่บริการ/รับถึงที่/ค่าบริการรับเครื่อง: ห้ามตอบจากความจำ ให้ถามก่อนว่าลูกค้าอยู่แถวไหน (เขต/อำเภอ + จังหวัด) แล้วเรียก check_pickup_service เพื่อตอบจากข้อมูลจริง แจ้งเป็นค่าประมาณเสมอ ยอดจริงระบบคำนวณตอนลูกค้าปักหมุดที่หน้า Checkout`,
    `12.1 ถ้าลูกค้าถามเจาะจงเรื่อง "รับถึงที่/รับถึงบ้าน" (Pickup) ให้ตอบตรงประเด็นก่อน: "มีครับ เรามีไรเดอร์ไปรับถึงบ้านเลย" แล้วถามทำเลต่อทันทีเพื่อเช็คพื้นที่/ค่าบริการ — ห้ามเปิดด้วยเมนูลิสต์ 3 แบบ (Pickup/Store-in/Mail-in) เพราะลูกค้าถามแค่ Pickup อยากได้คำตอบตรงๆ ไม่ใช่โบรชัวร์. จะพ่วงทางเลือกอื่นได้แค่ "หรือถ้าสะดวกมาที่ร้าน/ส่งพัสดุก็ได้ครับ" สั้นๆ 1 บรรทัดตอนท้ายเท่านั้น. เอาลิสต์ครบ 3 แบบมาตอบเฉพาะตอนลูกค้าถามกว้างๆ ว่า "มีวิธีส่ง/ขายยังไงบ้าง"`,
    `13. คำถามโปรโมชั่น/คูปอง/ส่วนลด: เรียก get_promotions ทุกครั้ง ตอบเฉพาะรายการที่เปิดอยู่จริงพร้อมเงื่อนไขและวันหมดเขต ถ้าไม่มีให้บอกตรงๆ อย่างสุภาพว่าช่วงนี้ยังไม่มี ห้ามแต่งโปรโมชั่นเอง`,
    `13.1 คำถามเรื่องสาขา/ที่ตั้งร้าน/เวลาเปิด-ปิด/จะมาที่ร้าน: เรียก get_branches ทุกครั้ง ห้ามตอบข้อมูลสาขาจากความจำ. ตอบ "เท่าที่ถาม": ถามหาสาขา/ที่ตั้ง → ตอบสาขาที่เกี่ยวข้องพร้อมลิงก์แผนที่, ถามกว้างๆ ว่ามีสาขาไหนบ้าง → ลิสต์ชื่อสาขาสั้นๆ ไม่ต้องแปะลิงก์แผนที่ทุกอัน`,
    `13.1.1 ลูกค้าพิมพ์ "ขอเบอร์ติดต่อ/ขอเบอร์ร้าน/ติดต่อร้านยังไง/ขอช่องทางติดต่อ" = ขอช่องทางติดต่อ "ของร้าน" เสมอ (บั๊กจริง: AI เคยสวนกลับไปขอเบอร์ลูกค้าแทน) → เรียก get_branches แล้วตอบสั้นๆ แค่ เบอร์กลาง + เวลาทำการ 1-2 บรรทัด ห้ามเทรายชื่อสาขา+ลิงก์แผนที่ทั้งหมด (ให้เฉพาะเมื่อลูกค้าถามหาสาขา/ที่ตั้ง). การขอชื่อ/เบอร์ของลูกค้า (ข้อ 6 ขั้นที่ 3) ทำเฉพาะตอนกำลังจะออกใบเสนอราคาเท่านั้น`,
    `13.2 คำถามเรื่องนโยบาย/ขั้นตอน/เงื่อนไข/การยกเลิก/ความปลอดภัยข้อมูล (PDPA) เช่น เครื่องผ่อนอยู่รับไหม ยกเลิกได้ไหม ต้องเตรียมเอกสารอะไร ต้องลบข้อมูลก่อนขายไหม ประเมินฟรีไหม ได้เงินเร็วแค่ไหน: เรียก get_faq ก่อนแล้ว "สรุปตอบเป็นภาษาคนของคุณเอง" สั้นๆ ตรงคำถาม — ห้ามแปะรายการ FAQ ทั้งชุดให้ลูกค้าอ่าน และห้ามบอกให้ลูกค้าไปเปิดหน้า FAQ เอง (ลูกค้าถามมาในแชทเพราะอยากได้คำตอบเลย). ถ้า get_faq ไม่มีคำตอบที่ตรง ห้ามเดา ให้บอกว่าขอเจ้าหน้าที่ยืนยันแล้วเสนอ escalate`,
    `14. นโยบาย/ขั้นตอน/บริการใดที่ไม่มีใน tool, ข้อมูลบริการด้านล่าง หรือข้อมูลนโยบายร้าน: ห้ามแต่งเอง ให้บอกว่าขอให้เจ้าหน้าที่ยืนยัน แล้วเสนอส่งเรื่องต่อเจ้าหน้าที่`,
    ``,
    `ข้อมูลบริการ (ยืนยันแล้ว ใช้ตอบได้):`,
    ...SERVICE_INFO_LINES,
    ``,
    `FAQ ทางการ (ตอบตามนี้เป๊ะ ห้ามขัด):`,
    ...OFFICIAL_FAQ_LINES,
    ``,
    `กฎเหล็กเรื่องการหักราคา (สำคัญมาก):`,
    ...DEDUCTION_POLICY_LINES,
    ``,
    `สถานะตอนนี้: ${inHours ? "อยู่ในเวลาทำการ" : "นอกเวลาทำการ"} (เวลาทำการ ${hoursText})`,
    ``,
    customerBlock,
    kb ? `\nข้อมูลนโยบายร้าน (แอดมินตั้งเพิ่ม — ถ้าขัดกับ FAQ ด้านบน ให้ยึดอันนี้เป็นหลัก):\n${kb}` : ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Push helpers
// ---------------------------------------------------------------------------

function buildInboxPushMessage(convoId, title, body) {
  const collapseKey = `inbox-${convoId}`.slice(0, 60);
  return {
    data: { type: "inbox_chat", convoId, title, body: body.slice(0, 300) },
    android: {
      priority: "high",
      collapseKey,
      notification: { channelId: "chat_messages", priority: "high", defaultSound: true },
    },
    apns: {
      headers: {
        "apns-collapse-id": collapseKey,
        "apns-priority": "10",
        "apns-push-type": "alert",
      },
      payload: { aps: { "mutable-content": 1, sound: "default" } },
    },
    webpush: { headers: { Urgency: "high", TTL: "86400" } },
  };
}

// Targets one staff member's devices (admin_fcm_tokens/{staffId}), falling
// back to the broadcast helper when they have no live tokens — same shape as
// dispatchAmendmentPush in index.js. No token pruning here; the broadcast
// path owns the dead-token policy.
async function pushToStaffOrBroadcast(db, dispatchAdminPush, staffId, message, tag) {
  if (staffId) {
    try {
      const snap = await db.ref(`admin_fcm_tokens/${staffId}`).once("value");
      const tokens = [];
      if (snap.exists()) {
        snap.forEach((t) => {
          const d = t.val();
          if (d && d.token) tokens.push(d.token);
        });
      }
      if (tokens.length > 0) {
        const result = await getMessaging().sendEachForMulticast({ ...message, tokens });
        if (result.successCount > 0) {
          console.log(`[${tag}] pushed to staff ${staffId}: ${result.successCount}/${tokens.length}`);
          return;
        }
      }
    } catch (err) {
      console.error(`[${tag}] staff push failed, falling back to broadcast:`, err);
    }
  }
  await dispatchAdminPush(message, tag);
}

// ---------------------------------------------------------------------------
// Message writers
// ---------------------------------------------------------------------------

// วิดเจ็ตลูกค้าแสดงข้อความเป็น plain text — ถ้าโมเดลเผลอใส่ markdown
// (**หนา**, *เอียง*, `code`, # หัวข้อ) ลูกค้าจะเห็นเครื่องหมายดิบๆ จึงลอกทิ้ง
function stripMarkdown(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, "$1$2")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,4}\s+/gm, "");
}

async function writeAiMessage(db, convoId, assistantName, rawText) {
  const text = stripMarkdown(rawText);
  const now = Date.now();
  await db.ref(`inbox/${convoId}/messages`).push({
    sender: "ai",
    senderName: assistantName,
    senderRole: "ai",
    kind: "text",
    text,
    timestamp: now,
    read: false,
  });
  await db.ref(`inbox/${convoId}`).update({
    lastMessage: text.slice(0, 200),
    lastMessageAt: now,
    customer_unread: ServerValue.increment(1),
  });
}

async function writeSystemMessage(db, convoId, text) {
  const now = Date.now();
  await db.ref(`inbox/${convoId}/messages`).push({
    sender: "system",
    senderRole: "system",
    kind: "system",
    text,
    timestamp: now,
    read: true,
  });
}

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

function makeToolExecutor({ db, convoId, convo, pub, dispatchAdminPush, tag, state, assistantName, customerText, lastCustomerText }) {
  return async function executeTool(name, input) {
    switch (name) {
      case "search_models": {
        const list = await loadModelsLight(db);
        const scored = rankModels(list, input.query);
        if (scored.length === 0) {
          // Never let the model conclude "we don't buy this" from an empty
          // search — hand it the nearby catalogue names to retry with, or
          // escalate.
          // Pick the first meaningful word (skip the brand "apple", which matches
          // everything) to list the right family, e.g. "watch" -> the Watch lineup.
          const words = String(input.query || "")
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => /[a-z฀-๿]/.test(t) && t !== "apple");
          const familyWord = words[0];
          const family = familyWord
            ? list
                .filter((m) => `${m.brand} ${m.name}`.toLowerCase().includes(familyWord))
                .slice(0, 40)
                .map((m) => m.name)
            : [];
          return {
            results: [],
            similar_models_in_catalog: family,
            note: "ไม่พบรุ่นที่ตรงพอดี — ถ้าใน similar_models_in_catalog มีรุ่นที่ลูกค้าน่าจะหมายถึง ให้เรียก search_models ใหม่ด้วยชื่อเต็มจากรายชื่อนั้น ถ้าไม่มีจริงๆ ห้ามบอกว่าร้านไม่รับซื้อ ให้เข้าโหมดรับ Offer ตามกฎข้อ 6 ขั้นที่ 2(ข): บอกว่าทีมงานเสนอราคาพิเศษให้โดยตรง ขอชื่อ+เบอร์+รายละเอียดเครื่องก่อน (save_customer_info เมื่อได้เบอร์) แล้วค่อย escalate_to_human พร้อมข้อมูลครบให้ทีมโทรกลับ — ห้าม escalate มือเปล่า",
          };
        }
        // If the best match is a model we have deliberately delisted
        // (isActive === false, shown as "งดรับซื้อ" on the website), decline
        // politely — do NOT promise a staff quote or escalate. This is a known,
        // announced policy, not a config gap.
        if (scored[0].is_active === false) {
          return {
            results: [],
            declined_model: scored[0].name,
            note: `ร้าน "งดรับซื้อ" รุ่น ${scored[0].name} แล้ว (เป็นนโยบายที่ประกาศบนหน้าเว็บ badge "งดรับซื้อ") — แจ้งลูกค้าสุภาพตรงๆ ว่าตอนนี้เรางดรับซื้อรุ่นนี้ ยังไม่เปิดรับ. ห้ามสัญญาว่าเจ้าหน้าที่จะให้ราคา และไม่ต้อง escalate. เสนอช่วยประเมินรุ่นอื่นแทนได้. escalate เฉพาะเมื่อลูกค้ายืนยันจริงจังว่าอยากให้ตรวจสอบเป็นกรณีพิเศษเท่านั้น`,
          };
        }
        const buyable = scored.filter((m) => m.is_active !== false);
        // Remember the ids of what was just found. Cross-turn history is
        // text-only, so BEFORE the first card exists (no last_quote yet) a
        // later "ออกการ์ดสิ" turn has no model_id in context — the exact gap
        // behind the "iPhone 17 ตอบครบแล้วโดน escalate" dead-end. The handler
        // injects this back into the system prompt every turn.
        try {
          await db.ref(`inbox/${convoId}/ai_state/last_search`).set({
            at: Date.now(),
            results: buyable.slice(0, 3).map((m) => ({
              model_id: m.id,
              name: m.name,
              variants: (m.variants || []).map((v) => ({
                name: v.name,
                used_price: Number(v.used_price) || 0,
                new_price: Number(v.new_price) || 0,
              })),
            })),
          });
        } catch (err) {
          console.warn(`[chatAi] ${convoId} last_search save failed:`, err && err.message);
        }
        // Deliberately unpriced models (owner's call — competitive segments
        // like MacBook run on phone-negotiated Offers, not list prices).
        const topUnpriced =
          buyable.length > 0 &&
          !(buyable[0].variants || []).some(
            (v) => Number(v.used_price) > 0 || Number(v.usedPrice) > 0 || Number(v.new_price) > 0 || Number(v.newPrice) > 0
          );
        const aliasNote = ipadAirGenAliasNote(input.query);
        const singleNote = buyable.length === 1 ? singleResultVariantNote(buyable[0]) : null;
        const baseNote = topUnpriced
          ? "รุ่นนี้มีในระบบแต่ 'ตั้งใจไม่ตั้งราคา' (กลุ่มรับ Offer — ทีมงานเสนอราคาดีที่สุดทางโทรศัพท์) → เข้าโหมดรับ Offer ตามกฎข้อ 6 ขั้นที่ 2(ข): ตอบเชิงบวก ขอชื่อ+เบอร์+รายละเอียดเครื่อง (save_customer_info เมื่อได้เบอร์) แล้ว escalate_to_human พร้อมข้อมูลครบ — ห้ามบอกว่าไม่รับซื้อ ห้าม escalate มือเปล่า ห้ามออกการ์ด"
          : "used_price คือราคากลางเครื่องสภาพดี ก่อนหักตามสภาพจริง แจ้งลูกค้าเป็นราคาประเมินเบื้องต้นเสมอ";
        return {
          // Never surface a delisted model as buyable alongside active ones.
          results: buyable,
          ...(topUnpriced ? { offer_mode: true } : {}),
          note: [aliasNote, singleNote, baseNote].filter(Boolean).join(" | "),
        };
      }

      case "get_condition_questions": {
        const modelId = String(input.model_id || "");
        const modelSnap = await db.ref(`models/${modelId}`).once("value");
        if (!modelSnap.exists()) return { error: "model_not_found" };
        const model = modelSnap.val();
        const setId = model.conditionSetId || model.engineId;
        if (!setId) return { error: "no_condition_set", note: "รุ่นนี้ยังไม่มีชุดคำถามประเมิน ให้ส่งต่อเจ้าหน้าที่" };
        const setSnap = await db.ref(`settings/condition_sets/${setId}`).once("value");
        if (!setSnap.exists()) return { error: "no_condition_set" };
        return { model_id: modelId, groups: conditionGroupsOf(setSnap.val()) };
      }

      case "check_device_by_serial": {
        // Chat-facing SickW lookup. Fully config-driven from the back office
        // (settings/chat_widget/sickw): master toggle, service, login gate,
        // per-user + global daily caps. Every guard fails SOFT with a note
        // telling the model to continue the normal question flow — a closed
        // toggle or exhausted quota must never dead-end the conversation.
        const cfg = (await db.ref("settings/chat_widget/sickw").once("value")).val() || {};
        if (cfg.enabled !== true) {
          return {
            error: "device_check_disabled",
            note: "ระบบตรวจด้วยหมายเลขเครื่องปิดอยู่ — ประเมินตามคำตอบของลูกค้าตามปกติ ห้ามบอกว่าระบบขัดข้อง และอย่าชวนส่ง IMEI อีก",
          };
        }
        const cleanSerial = String(input.serial || "").trim().toUpperCase().replace(/[\s-]/g, "");
        if (!/^[A-Z0-9]{8,17}$/.test(cleanSerial)) {
          return {
            error: "invalid_serial",
            note: "รูปแบบหมายเลขไม่ถูกต้อง — ขอลูกค้ากด *#06# แล้วส่ง IMEI 15 หลัก หรือ Serial จาก ตั้งค่า > ทั่วไป > เกี่ยวกับ",
          };
        }
        if (cfg.require_login !== false) {
          // ลูกค้า login แล้วเท่านั้น (มีโปรไฟล์ users/{uid}) — คุมต้นทุนเครดิต + ได้ lead
          const uSnap = await db.ref(`users/${convoId}`).once("value");
          if (!uSnap.exists()) {
            return {
              error: "login_required",
              note: "การตรวจด้วยหมายเลขเครื่องใช้ได้เฉพาะลูกค้าที่เข้าสู่ระบบ — แจ้งอย่างสุภาพให้เข้าสู่ระบบก่อน ระหว่างนี้ประเมินตามคำตอบตามปกติ",
            };
          }
        }
        const { ymd: sickwYmd } = bangkokNowParts();
        const perUserCap = Number(cfg.per_user_daily) || 2;
        const perUserTx = await db
          .ref(`chat_ai_usage/${sickwYmd}/sickw_by_uid/${convoId}`)
          .transaction((c) => (Number(c) || 0) + 1);
        if ((Number(perUserTx.snapshot.val()) || 0) > perUserCap) {
          return {
            error: "user_daily_limit",
            note: "ลูกค้าคนนี้ใช้สิทธิ์ตรวจครบโควตาวันนี้แล้ว — แจ้งสุภาพ แล้วประเมินตามคำตอบตามปกติ",
          };
        }
        let svcId = String(cfg.service_id || "").trim();
        if (!svcId) {
          const q = await db.ref("settings/sickw/quote_lookup_service").once("value");
          svcId = String(q.val() || "").trim();
        }
        const sickwKey = process.env.SICKW_API_KEY;
        if (!svcId || !sickwKey) {
          return {
            error: "not_configured",
            note: "ยังตั้งค่าบริการตรวจไม่ครบ — ประเมินตามคำตอบตามปกติ ห้ามบอกว่าระบบเสีย",
          };
        }
        // Cache path ร่วมกับ checkDeviceWithSickw/lookupDeviceForQuote — เครดิต
        // เดียวใช้ได้ทั้งแชท เว็บ และแอดมิน ภายใน 24 ชม.
        const devCacheRef = db.ref(`device_checks/${cleanSerial}/svc_${svcId}`);
        let devStatus = "unknown";
        let devParsed = {};
        let devCacheHit = false;
        const devCacheSnap = await devCacheRef.once("value");
        if (devCacheSnap.exists()) {
          const c = devCacheSnap.val();
          if (c.checked_at && Date.now() - c.checked_at < SICKW_CACHE_TTL_MS) {
            devCacheHit = true;
            devStatus = String(c.status || "unknown");
            devParsed = parseSickwResult(c.raw || "").parsed;
          }
        }
        if (!devCacheHit) {
          const dailyCap = Number(cfg.daily_cap) || 50;
          const totalTx = await db
            .ref(`chat_ai_usage/${sickwYmd}/sickw_calls`)
            .transaction((c) => (Number(c) || 0) + 1);
          if ((Number(totalTx.snapshot.val()) || 0) > dailyCap) {
            return {
              error: "daily_cap_reached",
              note: "โควตาตรวจรวมของวันนี้เต็มแล้ว — ประเมินตามคำตอบตามปกติ ห้ามบอกว่าระบบเสีย",
            };
          }
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 25000);
          try {
            const url = `${SICKW_ENDPOINT}?format=JSON&key=${encodeURIComponent(sickwKey)}&imei=${encodeURIComponent(cleanSerial)}&service=${encodeURIComponent(svcId)}`;
            const resp = await fetch(url, { method: "GET", signal: ctrl.signal });
            const text = await resp.text();
            const json = JSON.parse(text);
            devStatus = String(json.status || "unknown").toLowerCase();
            const rawResult = typeof json.result === "string" ? json.result : JSON.stringify(json.result || json);
            const reparsed = parseSickwResult(rawResult);
            devParsed = reparsed.parsed;
            try {
              await devCacheRef.set({
                checked_at: Date.now(),
                checked_by_uid: convoId,
                service_id: svcId,
                imei: cleanSerial,
                status: devStatus,
                raw: rawResult,
                parsed: reparsed.parsed,
                fields: reparsed.fields,
              });
            } catch { /* cache best-effort */ }
          } catch (err) {
            console.error(`[chatAi] ${convoId} sickw lookup failed:`, err && err.message);
            return {
              error: "lookup_failed",
              note: "ตรวจไม่สำเร็จชั่วคราว — แจ้งลูกค้าสุภาพว่าให้เจ้าหน้าที่ช่วยเช็คภายหลังได้ แล้วประเมินตามคำตอบไปก่อน",
            };
          } finally {
            clearTimeout(tid);
          }
          let creditUsed = 0;
          if (devStatus === "success") {
            try {
              const cat = (await db.ref(SICKW_CATALOG_CACHE_KEY).once("value")).val();
              const f = ((cat && cat.services) || []).find((s) => String(s.service) === svcId);
              if (f) creditUsed = Number(f.price || 0);
            } catch { /* pricing best-effort */ }
          }
          await recordSickwUsage(db, {
            uid: convoId, authToken: null, imei: cleanSerial, serviceIds: [svcId],
            jobId: null, cached: [false], creditUsed, status: devStatus, source: "chat_ai",
          });
        } else {
          await recordSickwUsage(db, {
            uid: convoId, authToken: null, imei: cleanSerial, serviceIds: [svcId],
            jobId: null, cached: [true], creditUsed: 0, status: devStatus, source: "chat_ai",
          });
        }
        if (devStatus !== "success") {
          return {
            error: "device_not_found",
            status: devStatus,
            note: "ฐานข้อมูลไม่พบเครื่องนี้ — ขอให้ลูกค้าตรวจเลขอีกครั้ง ถ้ายังไม่พบให้ประเมินตามคำตอบตามปกติ",
          };
        }
        const devFlags = summarizeSickwFlags(devParsed);
        const devLocked =
          devFlags.fmi === "flagged" || devFlags.mdm === "flagged" || devFlags.blacklist === "flagged";
        const deviceSummary = {
          at: Date.now(),
          imei: cleanSerial,
          service_id: svcId,
          model: devParsed.model || "",
          model_number: devParsed.modelNumber || "",
          capacity: devParsed.capacity || "",
          color: devParsed.color || "",
          country: devParsed.country || "",
          flags: devFlags,
          locked: devLocked,
        };
        try {
          await db.ref(`inbox/${convoId}/ai_state/last_device_check`).set(deviceSummary);
        } catch { /* best-effort */ }
        return {
          ok: true,
          device: {
            model: deviceSummary.model,
            model_number: deviceSummary.model_number,
            capacity: deviceSummary.capacity,
            color: deviceSummary.color,
            country: deviceSummary.country,
          },
          flags: devFlags,
          locked: devLocked,
          note: devLocked
            ? "ผลตรวจพบเครื่องติดล็อก/สถานะไม่ปกติ (ค่า flagged) = ร้านไม่รับซื้อ — แจ้งลูกค้าอย่างสุภาพว่าติดอะไรและต้องปลดอย่างไร (เช่น Sign out iCloud/ปิด Find My ให้เรียบร้อยก่อนจึงประเมินได้) ห้ามออกการ์ด ห้ามบอกว่า 'หักราคาแล้วรับได้'"
            : "ยืนยันรุ่นจากเครื่องจริงแล้ว — ใช้ model+capacity นี้เรียก search_models แล้วเดินขั้นตอนออกการ์ดตามปกติ; country/model_number ใช้เลือกตัวเลือกกลุ่มรหัสโมเดล (ศูนย์ไทย/US-EU-JP/CN-KR-HK) ใน answers ได้เลยไม่ต้องถามลูกค้า; บอกลูกค้าเฉพาะ รุ่น ความจุ สี และผลล็อกผ่าน/ไม่ผ่าน — ห้ามเล่ารายละเอียดอื่น (ประกัน/ผู้ให้บริการ/วันซื้อ)",
        };
      }

      case "create_quote_card": {
        let modelId = String(input.model_id || "");
        const wantVariant = String(input.variant_name || "").trim();
        let answers = input.answers && typeof input.answers === "object" ? input.answers : {};
        let modelSnap = await db.ref(`models/${modelId}`).once("value");
        if (!modelSnap.exists()) return { error: "model_not_found", note: "เรียก search_models เพื่อหา model_id ที่ถูกต้องก่อน" };
        let model = modelSnap.val();
        // Model-line guard + AUTO-CORRECT: if the customer named a more specific
        // line (Pro Max / Plus / Ultra / mini) than the resolved model, don't
        // just reject — the LLM re-picks the same wrong id and dead-ends to a
        // human (real test: "16 Pro Max" -> quote failed -> escalate). Find the
        // correct sibling ourselves and quote THAT, so the deal completes.
        const lineMiss = modelLineMismatch(customerText, `${model.brand || ""} ${model.name || ""}`);
        if (lineMiss) {
          const sibling = await findSiblingModel(db, model, lineMiss);
          if (sibling && sibling.id !== modelId) {
            console.warn(`[chatAi] ${convoId} model-line auto-correct: "${model.name}" -> "${sibling.name}" (customer said ${lineMiss})`);
            modelId = sibling.id;
            modelSnap = await db.ref(`models/${modelId}`).once("value");
            if (!modelSnap.exists()) return { error: "model_not_found", note: "เรียก search_models เพื่อหา model_id ที่ถูกต้องก่อน" };
            model = modelSnap.val();
          } else {
            return {
              error: "model_line_mismatch",
              note: `ลูกค้าระบุรุ่น "${lineMiss}" แต่ model_id ที่ส่งมาชี้ไปที่ "${model.name}" ซึ่งเป็นคนละรุ่น — เรียก search_models ด้วยชื่อรุ่นเต็มตามที่ลูกค้าบอก แล้วใช้ model_id ที่ตรงรุ่น "${lineMiss}" ก่อนออกการ์ด`,
            };
          }
        }
        const variantsRaw = Array.isArray(model.variants)
          ? model.variants
          : Object.values(model.variants || {});
        const variant = variantsRaw.find(
          (v) => v && String(v.name || "").trim().toLowerCase() === wantVariant.toLowerCase()
        );
        if (!variant) {
          return {
            error: "variant_not_found",
            available_variants: variantsRaw.map((v) => v && v.name).filter(Boolean),
          };
        }
        const isNewDevice = String(input.condition_type || "") === "new";
        // Amend mode — when a card for the SAME model+variant already exists in
        // this conversation, incoming answers are a PATCH merged over the stored
        // ones. This is the deterministic fix for the "เพิ่งเจอกล่อง → การ์ดลดเหลือ
        // 15,000" bug: the model rebuilt the whole answer set and invented a
        // body-dent the customer never mentioned. With the merge, untouched
        // groups always keep the customer's original answers.
        let prevQuote = null;
        if (!isNewDevice) {
          try {
            const lqSnap = await db.ref(`inbox/${convoId}/ai_state/last_quote`).once("value");
            const lq = lqSnap.val();
            if (
              lq &&
              lq.model_id === modelId &&
              String(lq.variant_name || "").trim().toLowerCase() ===
                String(variant.name || wantVariant).trim().toLowerCase() &&
              (lq.condition_type || "used") === "used" &&
              lq.answers &&
              typeof lq.answers === "object"
            ) {
              prevQuote = lq;
              answers = { ...lq.answers, ...answers };
            }
          } catch { /* merge is best-effort; a fresh quote still works */ }
        }
        // CONTACT GATE (คำสั่งเจ้าของร้าน: เก็บช่องทางติดต่อก่อนเผยราคา) — the
        // FIRST card of a conversation must be preceded by one polite ask for
        // name+phone. Deterministic because the model skipped the ask entirely
        // (card issued, panel showed "ยังไม่มีเบอร์" — lead unreachable if they
        // close the tab). One ask only, never a hostage: once the flag is set
        // the next call ALWAYS passes, so a customer who declines still gets
        // their quote. Amends (prevQuote) are never gated.
        if (!prevQuote && !convo.customer_phone && !state.savedPhone) {
          // Holds for the WHOLE turn: the first version only errored once and
          // set the flag, so an eager model just re-called in the same agentic
          // loop and the card shipped without the ask ever reaching the
          // customer (real test: "iPhone 15 รับซื้อเท่าไหร่" -> instant card,
          // no contact, no condition questions). Now every retry this turn is
          // refused; the NEXT customer turn passes unconditionally.
          const gateNote =
            "ยังออกการ์ดตอนนี้ไม่ได้ — ต้องถามลูกค้าก่อน 1 ข้อความ (ห้ามเรียก create_quote_card ซ้ำในเทิร์นนี้ จะถูกปฏิเสธทุกครั้ง): ตอบเป็นข้อความถามชุดเดียวตามกฎข้อ 6 ขั้นที่ 3 = ขอชื่อ+เบอร์ติดต่อ (ไม่บังคับ) พร้อมคำถามสภาพ 5 เรื่อง. เทิร์นถัดไปพอลูกค้าตอบ (ให้เบอร์ → save_customer_info ก่อน) เรียก create_quote_card ได้เลย ระบบจะให้ผ่านแม้ลูกค้าไม่ให้เบอร์";
          if (state.contactGatePromptedThisTurn) {
            return { error: "contact_required_first", note: gateNote };
          }
          const askedRef = db.ref(`inbox/${convoId}/ai_state/contact_prompted_at`);
          const askedSnap = await askedRef.once("value");
          if (!askedSnap.exists()) {
            await askedRef.set(Date.now());
            state.contactGatePromptedThisTurn = true;
            return { error: "contact_required_first", note: gateNote };
          }
        }
        const basePrice = isNewDevice
          ? Number(variant.newPrice || 0)
          : Number(variant.usedPrice || variant.price || 0);
        if (!basePrice) {
          return isNewDevice
            ? {
                error: "new_price_not_available",
                note: "รุ่น/ความจุนี้ยังไม่มีราคารับซื้อมือ 1 ในระบบ แจ้งลูกค้าอย่างสุภาพว่ารับประเมินเป็นมือสองได้ หรือส่งเรื่องให้เจ้าหน้าที่ยืนยันราคามือ 1",
              }
            : {
                error: "no_price_for_variant",
                note: "รุ่น/ความจุนี้อยู่ในกลุ่มรับ Offer (ตั้งใจไม่ตั้งราคา) — เข้าโหมดรับ Offer ตามกฎข้อ 6 ขั้นที่ 2(ข): ขอชื่อ+เบอร์+รายละเอียดเครื่องก่อน แล้ว escalate_to_human พร้อมข้อมูลครบให้ทีมโทรกลับเสนอราคา ห้าม escalate มือเปล่า",
              };
        }
        const assumedGroups = [];
        const lines = [];
        const customerConditions = [];
        const rawConditions = {};
        let totalDeduct = 0;
        let hasReceipt = null;
        if (isNewDevice) {
          // มือ 1 ยังไม่แกะซีล — mirror handleNewDeviceCheckout (SellPageClient):
          // เงื่อนไขคงที่ 5 ข้อ รายการหักเดียวคือไม่มีใบเสร็จ -500
          hasReceipt = input.has_receipt === true;
          const proofDeduct = hasReceipt ? 0 : 500;
          totalDeduct = proofDeduct;
          const newConds = [
            { id: "sealed_box", title: "สภาพกล่อง", value: "ซีลไม่ฉีก / ยังไม่แกะกล่อง", deduct: 0 },
            { id: "never_activated", title: "การเปิดใช้งาน", value: "ไม่เคยเปิดเครื่องหรือ Activate", deduct: 0 },
            { id: "full_accessories", title: "อุปกรณ์ในกล่อง", value: "อุปกรณ์ครบกล่อง ไม่มีชิ้นส่วนสูญหาย", deduct: 0 },
            { id: "no_damage", title: "สภาพภายนอก", value: "ไม่มีรอยบุบ รอยขีดข่วน หรือตำหนิใดๆ", deduct: 0 },
            {
              id: "purchase_proof",
              title: "หลักฐานการซื้อ",
              value: hasReceipt
                ? "มีใบเสร็จหรือหลักฐานการซื้อจากร้านค้าที่ได้รับอนุญาต"
                : "ไม่มีหลักฐานการซื้อ",
              deduct: proofDeduct,
            },
          ];
          for (const c of newConds) {
            lines.push({ title: c.title, label: c.value, amount: c.deduct });
            customerConditions.push({ id: c.id, title: c.title, value: c.value, deductAmount: c.deduct, isNegative: c.deduct > 0 });
          }
        } else {
          const setId = model.conditionSetId || model.engineId;
          const setSnap = setId ? await db.ref(`settings/condition_sets/${setId}`).once("value") : null;
          const set = setSnap && setSnap.exists() ? setSnap.val() : null;
          if (!set) return { error: "no_condition_set", note: "รุ่นนี้ไม่มีชุดคำถามประเมิน ให้ escalate_to_human" };
          const qGroups = (Array.isArray(set.groups) ? set.groups : Object.values(set.groups || {})).filter(
            (g) => g && g.id
          );
          // Mirror of the website assessment flow (AssessmentFlow.tsx):
          // failBehavior 'reject' on an answered option ALWAYS blocks the sale;
          // legacy defect:true blocks unless the shop-wide accept-defective
          // toggle is on (missing key = off, fail closed — same as the web).
          let acceptDefective = false;
          try {
            const adSnap = await db.ref("settings/store/accept_defective_devices").once("value");
            acceptDefective = adSnap.val() === true;
          } catch { /* fail closed */ }
          // Deterministic battery bucketing: when the customer stated a %,
          // pick the battery option from the number, overriding whatever the
          // model guessed (it kept choosing a higher/better bracket).
          const batteryPct = Number(input.battery_pct);
          if (Number.isFinite(batteryPct)) {
            const bg = qGroups.find((g) => /แบต|battery/i.test(g.title || g.name || ""));
            if (bg) {
              const bgOptions = (Array.isArray(bg.options) ? bg.options : Object.values(bg.options || {})).filter(
                (o) => o && o.id != null
              );
              const pickedId = pickBatteryOptionId(bgOptions, batteryPct);
              if (pickedId != null) answers = { ...answers, [bg.id]: pickedId };
            }
          }
          for (const group of qGroups) {
            const options = (Array.isArray(group.options) ? group.options : Object.values(group.options || {})).filter(
              (o) => o && o.id != null
            );
            if (options.length === 0) continue;
            const optId = answers[group.id];
            let opt = optId != null ? options.find((o) => o.id === optId) : null;
            let assumed = false;
            if (opt && (opt.failBehavior === "reject" || (opt.defect === true && !acceptDefective))) {
              // The customer's own answer means "we do not buy this device" —
              // never issue a full-price card for it (the 0-baht tiers on these
              // options are placeholders, not free passes).
              return {
                declined_defect: true,
                group_title: group.title || group.name || group.id,
                option_label: opt.label || opt.name || "",
                note:
                  "เงื่อนไขนี้ร้านไม่รับซื้อ (เหมือนหน้าเว็บประเมิน) — แจ้งลูกค้าอย่างสุภาพว่า ขณะนี้เรารับซื้อเฉพาะเครื่องที่ทุกฟังก์ชันทำงานปกติ จึงยังไม่สามารถรับซื้อเครื่องที่มีปัญหานี้ได้ ห้ามออกการ์ด ห้ามเสนอราคาอื่น และไม่ต้อง escalate (เว้นแต่ลูกค้าขอคุยกับเจ้าหน้าที่) เสนอช่วยประเมินเครื่องอื่นแทนได้",
              };
            }
            if (!opt) {
              // กลุ่มที่ลูกค้าไม่ได้ตอบ = ถือว่าสภาพปกติ (ตัวเลือกที่หักน้อยที่สุด) —
              // ห้าม default ไปตกตัวเลือกที่เป็น reject/defect เด็ดขาด
              const pickable = options.filter(
                (o) => o.failBehavior !== "reject" && o.defect !== true
              );
              const pool = pickable.length > 0 ? pickable : options;
              opt = pool.reduce((best, o) =>
                resolveOptionDeduction(o, basePrice, model.liquidityFactor) <
                resolveOptionDeduction(best, basePrice, model.liquidityFactor)
                  ? o
                  : best
              );
              assumed = true;
              assumedGroups.push(group.title || group.name || group.id);
            }
            const amount = resolveOptionDeduction(opt, basePrice, model.liquidityFactor);
            totalDeduct += amount;
            const title = group.title || group.name || "";
            const label = opt.label || opt.name || "";
            rawConditions[group.id] = opt.id;
            lines.push(assumed ? { title, label, amount, assumed: true } : { title, label, amount });
            customerConditions.push({ id: group.id, title, value: label, deductAmount: amount, isNegative: amount > 0 });
          }
        }
        const estimated = Math.max(0, basePrice - totalDeduct);
        // HAGGLE GUARD: a re-quote for the same device may only go DOWN (the
        // customer disclosed a defect) or stay — never UP because they asked
        // for more. The first quote already assumes best-case for every group
        // the customer didn't answer, so an increase means the AI improved the
        // conditions without new info. Block it when this turn's message is a
        // price haggle (not a condition correction), and make the AI hold the
        // assessed price. Real lost-deal: 10,100 -> "12,000 ได้ไหม" -> 12,500.
        if (
          prevQuote &&
          estimated > (Number(prevQuote.estimated_price) || 0) &&
          priceHaggleIntent(lastCustomerText)
        ) {
          const prevEst = Number(prevQuote.estimated_price) || 0;
          console.warn(
            `[chatAi] ${convoId} haggle up-quote blocked: prev=${prevEst} attempted=${estimated} msg="${String(lastCustomerText || "").slice(0, 80)}"`
          );
          return {
            error: "price_increase_by_haggle_blocked",
            previous_estimate: prevEst,
            note:
              `ลูกค้ากำลัง "ต่อขอราคาสูงขึ้น" ไม่ใช่แจ้งว่าสภาพเครื่องดีขึ้นจริง — ห้ามออกใบเสนอราคาที่สูงกว่าเดิม และห้ามพิมพ์ตัวเลขที่ลูกค้าขอ. ` +
              `ราคารับซื้อคำนวณจากสภาพเครื่อง + ราคาตลาดวันนี้เท่านั้น ปรับขึ้นตามคำขอไม่ได้. อธิบายสุภาพว่าราคาประเมินอยู่ที่ ${prevEst.toLocaleString("th-TH")} บาท (ยอดเดิม) ` +
              `และถ้าสภาพเครื่องจริงดีกว่าที่แจ้ง ราคาจะถูกปรับขึ้นให้ตอนเจ้าหน้าที่ตรวจเครื่องจริงหน้างาน. ถ้าลูกค้าแจ้ง "สภาพจริง" ที่ดีกว่าเดิม (เช่น จอไม่มีรอย แบตสูงกว่าที่บอก) ให้ออกการ์ดใหม่ตามสภาพนั้นได้ แต่ห้ามปรับขึ้นเพราะการต่อราคาเปล่าๆ`,
          };
        }
        // Proactively surface the best coupon this model qualifies for so the
        // customer sees the boosted number IN CHAT (checkout auto-applies the
        // same class of coupon anyway — this is display only, not pricing).
        const eligibleCoupon = await pickBestCouponForModel(db, modelId, estimated);
        const nowQ = Date.now();
        const quoteRef = db.ref("chat_quotes").push();
        const capacity = String(
          (variant.attributes && (variant.attributes.storage || variant.attributes.capacity)) ||
            variant.name ||
            wantVariant
        );
        const payload = {
          quote_id: quoteRef.key,
          model_id: modelId,
          model_name: model.name || "",
          variant_name: String(variant.name || wantVariant),
          capacity,
          base_price: basePrice,
          estimated_price: estimated,
          lines,
          raw_conditions: rawConditions,
          customer_conditions: customerConditions,
          image_url: variant.imageUrl || model.imageUrl || null,
          rules: model.rules != null ? model.rules : null,
          pickup_eligible: model.pickup !== false,
          max_pickup_distance_km: Number(model.maxPickupDistanceKm) || 0,
          is_new_device: isNewDevice,
          has_receipt: hasReceipt,
          eligible_coupon: eligibleCoupon || null,
          created_at: nowQ,
          expires_at: nowQ + 48 * 60 * 60 * 1000,
        };
        // แนบผลตรวจ SickW ล่าสุดของแชทนี้ (ถ้ายังสดภายใน 24 ชม.) ไปกับใบเสนอราคา
        // — เจ้าหน้าที่/ไรเดอร์เห็นผลตรวจตั้งแต่ก่อนรับงาน ไม่ต้องเช็คซ้ำ
        let deviceCheck = null;
        try {
          const dcSnap = await db.ref(`inbox/${convoId}/ai_state/last_device_check`).once("value");
          const dc = dcSnap.val();
          if (dc && dc.at && Date.now() - dc.at < 24 * 60 * 60 * 1000) deviceCheck = dc;
        } catch { /* best-effort */ }
        await quoteRef.set({
          uid: convoId,
          status: "offered",
          ...payload,
          ...(deviceCheck ? { device_check: deviceCheck } : {}),
        });
        // Remember the ids behind this card. Claude history across turns is
        // text-only (buildClaudeHistory), so without this the model has no way
        // to know model_id/variant/answers on a later turn ("ไม่มีกล่องด้วย") —
        // it would have to guess and create_quote_card would fail.
        try {
          await db.ref(`inbox/${convoId}/ai_state/last_quote`).set({
            model_id: modelId,
            model_name: model.name || "",
            variant_name: String(variant.name || wantVariant),
            condition_type: isNewDevice ? "new" : "used",
            has_receipt: hasReceipt,
            answers,
            estimated_price: estimated,
            at: nowQ,
          });
        } catch (err) {
          console.warn(`[chatAi] ${convoId} last_quote save failed:`, err && err.message);
        }
        console.log(
          `[chatAi] ${convoId} quote created ${quoteRef.key} ${payload.model_name} ${payload.variant_name} new=${isNewDevice} est=${estimated}`
        );
        const summary = `ใบเสนอราคา ${payload.model_name} ${payload.variant_name}${isNewDevice ? " (มือ 1 ยังไม่แกะซีล)" : ""}: ${estimated.toLocaleString("th-TH")} บาท (ราคาประเมินเบื้องต้น)`;
        await db.ref(`inbox/${convoId}/messages`).push({
          sender: "ai",
          senderName: assistantName || "BKK APPLE Assistant",
          senderRole: "ai",
          kind: "card_quote",
          text: summary,
          payload,
          timestamp: nowQ,
          read: false,
        });
        await db.ref(`inbox/${convoId}`).update({
          lastMessage: summary.slice(0, 200),
          lastMessageAt: nowQ,
          customer_unread: ServerValue.increment(1),
        });
        return {
          ok: true,
          estimated_price: estimated,
          assumed_groups: assumedGroups,
          ...(prevQuote
            ? {
                amended_from_previous: true,
                previous_estimate: Number(prevQuote.estimated_price) || 0,
              }
            : {}),
          ...(eligibleCoupon
            ? {
                eligible_coupon: {
                  name: eligibleCoupon.name,
                  value: eligibleCoupon.computed_value,
                },
              }
            : {}),
          note:
            "ส่งการ์ดใบเสนอราคาให้ลูกค้าแล้ว ตอบสั้นๆ ชวนให้กดปุ่มบนการ์ดเพื่อยืนยันขายและกรอกข้อมูลด้วยตัวเอง ไม่ต้องพิมพ์รายละเอียดราคาซ้ำ" +
            (eligibleCoupon
              ? ` (รุ่นนี้มีโปรโมชั่น "${eligibleCoupon.name}" เพิ่มให้อีก ${Number(eligibleCoupon.computed_value).toLocaleString("th-TH")} บาท แสดงบนการ์ดแล้ว — บอกลูกค้าสั้นๆ อย่างน่าสนใจว่ารุ่นนี้ได้โปรฯ พิเศษเพิ่มด้วย ห้ามแต่งมูลค่า/ชื่อโปรฯ เอง ใช้ตามนี้เท่านั้น)`
              : "") +
            (prevQuote
              ? ` (ใบนี้อัปเดตจากใบเดิมยอด ${Number(prevQuote.estimated_price || 0).toLocaleString("th-TH")} บาท — บอกทิศทางยอดตามจริง: สูงขึ้น/ลดลง/เท่าเดิม ห้ามบอกสวนทางกับตัวเลข)`
              : "") +
            (assumedGroups.length > 0
              ? " (ส่วนที่ไม่ได้ถามระบบประเมินตามสภาพปกติแล้ว บอกลูกค้าสั้นๆ ว่าถ้าสภาพจริงต่างจากนี้ราคาปรับตามการตรวจจริง)"
              : ""),
        };
      }

      case "check_pickup_service": {
        const geo = await geocodeThaiArea(input.area_text || "");
        if (geo.error) {
          return {
            error: geo.error,
            note: "หาตำแหน่งจากข้อความไม่ได้ ขอให้ลูกค้าระบุพื้นที่ชัดขึ้น (เขต/อำเภอ + จังหวัด) ถ้ายังไม่ได้อีกให้ escalate ให้เจ้าหน้าที่",
          };
        }
        const provinceId = provinceIdFromName(geo.province_name);
        const [pricingSnap, branchesSnap, promosSnap] = await Promise.all([
          db.ref("settings/store/delivery_pricing").once("value"),
          db.ref("settings/branches").once("value"),
          db.ref("rider_fee_promotions").once("value"),
        ]);
        const zones = deliveryZonesFrom(pricingSnap.val());
        const zone = provinceId
          ? zones.find((z) => Array.isArray(z.provinceIds) && z.provinceIds.includes(provinceId)) || null
          : null;

        // สาขา active ที่ใกล้ลูกค้าที่สุด (fallback = ที่ตั้งร้านหลัก)
        let origin = STORE_LOCATION;
        let branchName = null;
        const branches = branchesSnap.val() || {};
        let bestD = Infinity;
        for (const key of Object.keys(branches)) {
          const b = branches[key];
          if (!b || b.isActive === false || typeof b.lat !== "number" || typeof b.lng !== "number") continue;
          const d = haversineKm(geo.lat, geo.lng, b.lat, b.lng);
          if (d < bestD) {
            bestD = d;
            origin = { lat: b.lat, lng: b.lng };
            branchName = b.name || key;
          }
        }

        if (!zone) {
          return {
            serviceable: false,
            province: geo.province_name || null,
            area: geo.formatted,
            nearest_branch: branchName,
            alternatives:
              "Mail-in ส่งพัสดุถึงร้านฟรีทั่วประเทศ (มีประกันความเสียหายเต็มมูลค่า) หรือ Store-in นำเครื่องมาที่หน้าร้าน",
            note: "พื้นที่นี้ยังไม่อยู่ในเขตบริการไรเดอร์ไปรับถึงที่ แนะนำช่องทางอื่นให้ลูกค้าอย่างนุ่มนวล",
          };
        }

        const distKm = haversineKm(geo.lat, geo.lng, origin.lat, origin.lng) * 1.3;
        const fee = zoneFeeOf(zone, distKm);

        // โปรส่วนลดค่าไรเดอร์ (mirror riderFeePromoEligible/riderFeePromoDiscount)
        const nowP = Date.now();
        const modelIds = input.model_id ? [String(input.model_id)] : [];
        let promo = null;
        const promos = promosSnap.val() || {};
        for (const pid of Object.keys(promos)) {
          const p = promos[pid];
          if (!p || p.is_active === false || !promoWindowOpen(p, nowP) || quotaFull(p)) continue;
          const provs = Array.isArray(p.applicable_provinces)
            ? p.applicable_provinces.map(Number).filter(Number.isFinite)
            : [];
          if ((p.is_province_restricted === true || provs.length > 0) && provs.length === 0) continue;
          if (provs.length > 0 && (provinceId == null || !provs.includes(Number(provinceId)))) continue;
          const applicable = Array.isArray(p.applicable_models) ? p.applicable_models : [];
          const excluded = Array.isArray(p.excluded_models) ? p.excluded_models : [];
          if ((p.is_model_restricted === true || applicable.length > 0) && applicable.length === 0) continue;
          if (applicable.length > 0 && !modelIds.some((m) => applicable.includes(m))) continue;
          if (excluded.length > 0 && modelIds.some((m) => excluded.includes(m))) continue;
          let raw;
          if (p.discount_type === "waive") raw = fee;
          else if (p.discount_type === "percentage") {
            raw = fee * (Number(p.value || 0) / 100);
            if (p.max_discount > 0) raw = Math.min(raw, p.max_discount);
          } else {
            raw = Number(p.value || 0);
            if (p.max_discount > 0) raw = Math.min(raw, p.max_discount);
          }
          const discount = Math.max(0, Math.min(fee, Math.floor(raw)));
          if (discount > 0 && (!promo || discount > promo.discount)) {
            promo = { name: p.name || p.code || "", discount };
          }
        }
        const effective = Math.max(0, fee - (promo ? promo.discount : 0));
        return {
          serviceable: true,
          zone: zone.name || zone.id,
          province: geo.province_name || null,
          area: geo.formatted,
          distance_km_approx: Math.round(distKm * 10) / 10,
          pickup_fee_approx: fee,
          promo_applied: promo,
          effective_fee_approx: effective,
          free_pickup: effective === 0,
          eta: zone.etaText || null,
          nearest_branch: branchName,
          note: "ค่าบริการเป็นค่าประมาณจากทำเลที่ลูกค้าบอก ยอดจริงระบบคำนวณตอนลูกค้าปักหมุดที่หน้า Checkout — แจ้งลูกค้าด้วยคำว่า 'ประมาณ' เสมอ ห้ามการันตีตัวเลข",
        };
      }

      case "get_branches": {
        // Central profile rides along so the model never has to stitch a
        // "main number / standard hours" out of per-branch rows (the source
        // of the 08:00 vs 10:00 contradiction).
        let central = null;
        try {
          const spSnap = await db.ref("settings/store_profile").once("value");
          const sp = spSnap.exists() ? spSnap.val() || {} : {};
          if (sp.phone || sp.line_id || sp.hours_start) {
            central = {
              phone: sp.phone || null,
              line_id: sp.line_id || null,
              email: sp.email || null,
              standard_hours: sp.hours_start && sp.hours_end ? `${sp.hours_start}-${sp.hours_end} น.` : null,
            };
          }
        } catch { /* best-effort */ }
        const snap = await db.ref("settings/branches").once("value");
        const list = [];
        const all = snap.val() || {};
        for (const key of Object.keys(all)) {
          const b = all[key];
          if (!b || b.isActive === false) continue;
          const fmtHour = (h) =>
            Number.isFinite(Number(h)) ? `${String(Number(h)).padStart(2, "0")}:00` : null;
          const open = fmtHour(b.openHour);
          const close = fmtHour(b.closeHour);
          list.push({
            name: b.name || key,
            address: b.address || null,
            phone: b.phone || null,
            open_hours: open && close ? `${open} - ${close} น.` : null,
            open_today: b.isOpen === false ? false : true,
            map_link:
              typeof b.lat === "number" && typeof b.lng === "number"
                ? `https://www.google.com/maps?q=${b.lat},${b.lng}`
                : null,
            map_info: b.mapInfo || null,
          });
        }
        return list.length > 0
          ? {
              ...(central ? { central } : {}),
              branches: list,
              note:
                "ตอบเฉพาะข้อมูลนี้ ถ้าลูกค้าจะเดินทางมา แนบ map_link ให้ด้วย (พิมพ์ลิงก์ตรงๆ ได้ ไม่ต้องใช้ markdown)" +
                (central ? " — เบอร์กลาง/เวลามาตรฐานใช้จาก central; ข้อมูลรายสาขาใช้เฉพาะตอนพูดถึงสาขานั้น" : ""),
            }
          : {
              ...(central ? { central } : {}),
              branches: [],
              note: central
                ? "ยังไม่มีข้อมูลรายสาขา แต่ตอบช่องทางติดต่อกลางจาก central ได้เลย"
                : "ยังไม่มีข้อมูลสาขาในระบบ ให้บอกลูกค้าว่าขอให้เจ้าหน้าที่ยืนยันที่ตั้งร้าน แล้วเสนอ escalate",
            };
      }

      case "get_promotions": {
        const nowG = Date.now();
        const [couponsSnap, promosSnap] = await Promise.all([
          db.ref("coupons").once("value"),
          db.ref("rider_fee_promotions").once("value"),
        ]);
        const coupons = [];
        const cs = couponsSnap.val() || {};
        for (const key of Object.keys(cs)) {
          const c = cs[key];
          // system master (เช่น REVIEW_REWARD) ห้ามโฆษณาเป็นคูปองแจก
          if (!c || c.system === true) continue;
          if (c.is_active === false || !promoWindowOpen(c, nowG) || quotaFull(c)) continue;
          coupons.push({
            code: c.code || key,
            name: c.name || c.title || "",
            type: c.type || "fixed",
            value: Number(c.value || 0),
            min_trade_value: Number(c.min_trade_value || 0) || undefined,
            model_restricted:
              c.is_model_restricted === true ||
              (Array.isArray(c.applicable_models) && c.applicable_models.length > 0) ||
              undefined,
            end_date: c.end_date || null,
          });
        }
        const riderPromos = [];
        const ps = promosSnap.val() || {};
        for (const key of Object.keys(ps)) {
          const p = ps[key];
          if (!p || p.is_active === false || !promoWindowOpen(p, nowG) || quotaFull(p)) continue;
          riderPromos.push({
            name: p.name || p.code || key,
            discount_type: p.discount_type || "fixed",
            value: Number(p.value || 0),
            max_discount: Number(p.max_discount || 0) || undefined,
            province_restricted:
              p.is_province_restricted === true ||
              (Array.isArray(p.applicable_provinces) && p.applicable_provinces.length > 0) ||
              undefined,
            model_restricted:
              p.is_model_restricted === true ||
              (Array.isArray(p.applicable_models) && p.applicable_models.length > 0) ||
              undefined,
            end_date: p.end_date || null,
          });
        }
        return {
          coupons,
          pickup_fee_promotions: riderPromos,
          note:
            coupons.length || riderPromos.length
              ? "ตอบเฉพาะรายการเหล่านี้พร้อมเงื่อนไขและวันหมดเขต ห้ามแต่งโปรเพิ่มเอง (pickup_fee_promotions คือส่วนลดค่าบริการรับถึงที่)"
              : "ตอนนี้ไม่มีโปรโมชั่นหรือคูปองที่เปิดอยู่ บอกลูกค้าตรงๆ อย่างสุภาพ ห้ามแต่งโปรเอง",
        };
      }

      case "get_faq": {
        const results = searchFaq(input.query || "");
        return {
          faqs: results,
          note:
            results.length > 0
              ? "อ่านข้อเท็จจริงในนี้แล้ว 'สรุปตอบเป็นภาษาคนของคุณเอง' สั้นๆ ตรงคำถามลูกค้า — ห้ามแปะรายการ FAQ ทั้งชุด ห้ามบอกให้ลูกค้าไปอ่านหน้า FAQ เอง. เรื่องเวลาเปิด/เบอร์/สาขาใช้ get_branches, โปร/คูปองใช้ get_promotions, พื้นที่รับถึงที่ใช้ check_pickup_service, ราคาใช้ search_models"
              : "ไม่พบข้อมูลที่ตรงในคลัง FAQ — ห้ามเดาคำตอบเอง ให้บอกลูกค้าว่าขอให้เจ้าหน้าที่ยืนยัน แล้วเสนอ escalate",
        };
      }

      case "check_order_status": {
        const jobsSnap = await db
          .ref("jobs")
          .orderByChild("uid")
          .equalTo(convoId)
          .limitToLast(5)
          .once("value");
        const own = [];
        if (jobsSnap.exists()) {
          jobsSnap.forEach((j) => {
            const job = j.val() || {};
            // PDPA: ห้ามคืนยอดเงิน (net_payout/price) ให้แชทเด็ดขาด — การเงินเป็น
            // ข้อมูลอ่อนไหว ลูกค้าดูยอดได้ที่หน้า track ที่มีการยืนยันตัวตนเอง
            own.push({
              ref_no: job.ref_no || j.key,
              model: job.model || "",
              status: job.status || "",
            });
          });
        }
        if (own.length > 0) {
          return {
            own_orders: own.reverse(),
            note:
              "นี่คือออเดอร์ของบัญชีที่ลูกค้าล็อกอินอยู่ตอนนี้ บอกได้แค่รุ่นและสถานะกว้างๆ ห้ามบอกยอดเงิน/ราคา/ยอดสุทธิของออเดอร์ในแชทเด็ดขาด (PDPA) ถ้าลูกค้าถามเรื่องเงินหรือรายละเอียดลึก ให้ชี้ไปที่หน้าติดตามสถานะ (track) หรือ escalate ให้เจ้าหน้าที่",
          };
        }

        const claimedPhone = normalizePhone(convo.customer_phone || state.savedPhone);
        if (claimedPhone) {
          const byPhoneSnap = await db
            .ref("jobs")
            .orderByChild("cust_phone")
            .equalTo(claimedPhone)
            .limitToLast(5)
            .once("value");
          const count = byPhoneSnap.exists() ? Object.keys(byPhoneSnap.val()).length : 0;
          return {
            own_orders: [],
            found_by_claimed_phone: count,
            note:
              count > 0
                ? "พบออเดอร์จากเบอร์ที่ลูกค้าแจ้ง แต่เบอร์นี้ยังไม่ยืนยันตัวตน ห้ามเปิดเผยรายละเอียด ให้ escalate_to_human (reason: customer_request) เพื่อให้เจ้าหน้าที่ยืนยันตัวตนและแจ้งสถานะ"
                : "ไม่พบออเดอร์จากเบอร์นี้",
          };
        }
        return { own_orders: [], note: "ไม่พบออเดอร์ของบัญชีนี้ ให้ขอชื่อและเบอร์โทรที่ใช้ตอนสั่งขาย" };
      }

      case "save_customer_info": {
        const updates = {};
        const name = String(input.name || "").trim().slice(0, 120);
        const phone = normalizePhone(input.phone);
        if (name) updates.customer_name = name;
        if (phone) {
          updates.customer_phone = phone;
          updates.phone_source = "chat";
          state.savedPhone = phone;
        }
        if (Object.keys(updates).length === 0) return { saved: false };
        await db.ref(`inbox/${convoId}`).update(updates);
        // CRM: link this conversation to a Contact (phone/email — never uid).
        // Admin-side aggregation only; the AI still won't reveal a matched
        // record's orders to the customer unless verified (rule 10.2).
        if (phone) {
          try {
            const customerId = await resolveCustomer(db, { phone, name });
            if (customerId) await db.ref(`inbox/${convoId}/crm_customer_id`).set(customerId);
          } catch (e) {
            console.warn(`[chatAi] ${convoId} resolveCustomer failed:`, e && e.message);
          }
        }
        let matchedOrders = 0;
        if (phone) {
          const byPhoneSnap = await db
            .ref("jobs")
            .orderByChild("cust_phone")
            .equalTo(phone)
            .limitToLast(5)
            .once("value");
          matchedOrders = byPhoneSnap.exists() ? Object.keys(byPhoneSnap.val()).length : 0;
          if (matchedOrders > 0) {
            await db.ref(`inbox/${convoId}`).update({ matched_orders_count: matchedOrders });
          }
        }
        return { saved: true, matched_orders_by_phone: matchedOrders };
      }

      case "escalate_to_human": {
        // Already queued for a human (holding mode) — don't stack duplicate
        // system messages / pushes; the flag is set, staff were notified.
        if ((convo.status || "ai") === "waiting_human") {
          state.escalated = true;
          return {
            ok: true,
            already_waiting: true,
            note: "แชทนี้ส่งเรื่องถึงเจ้าหน้าที่อยู่แล้ว ไม่ต้องส่งซ้ำ — ดูแลลูกค้าต่อระหว่างรอตามกติกาสถานะพิเศษ",
          };
        }
        const inHours = isBusinessHours(pub);
        const summary = String(input.summary || "").slice(0, 500);
        const reason = String(input.reason || "cannot_answer");
        await db.ref(`inbox/${convoId}`).update({
          status: "waiting_human",
          escalation: { reason, summary, at: Date.now() },
        });
        // No callback number = a dead lead ("จะติดต่อกลับ" with nothing to
        // dial). Deterministic nudge whenever we escalate contact-less.
        const hasCallback = !!(convo.customer_phone || state.savedPhone);
        await writeSystemMessage(
          db,
          convoId,
          (inHours
            ? "ส่งเรื่องถึงเจ้าหน้าที่แล้ว เจ้าหน้าที่จะเข้ามาตอบในอีกสักครู่"
            : "ส่งเรื่องถึงเจ้าหน้าที่แล้ว เจ้าหน้าที่จะติดต่อกลับในเวลาทำการ") +
            (hasCallback ? "" : " — ฝากชื่อและเบอร์โทรไว้ตรงนี้ได้เลย เจ้าหน้าที่จะได้ติดต่อกลับสะดวกขึ้น")
        );
        const displayName = convo.customer_name || convo.name || "ลูกค้า";
        await dispatchAdminPush(
          buildInboxPushMessage(convoId, `ลูกค้าต้องการเจ้าหน้าที่: ${displayName}`, summary),
          tag
        );
        state.escalated = true;
        // Distinct from the already_waiting shortcut above: only a REAL
        // escalation performed this turn may be rolled back by the
        // declined-model guard — a pre-existing queue must survive it.
        state.escalatedThisTurn = true;
        return { ok: true, in_business_hours: inHours };
      }

      case "update_handoff_summary": {
        // Live handoff note for the staffer about to take the chat — only
        // meaningful in waiting mode; harmless (just overwrites) otherwise.
        const s = String(input.summary || "").trim().slice(0, 500);
        if (!s) return { error: "empty_summary" };
        await db.ref(`inbox/${convoId}/escalation`).update({
          live_summary: s,
          live_summary_at: Date.now(),
        });
        return { ok: true };
      }

      case "create_ticket": {
        const refNo = `TK-${Date.now().toString(36).toUpperCase()}`;
        await db.ref("support_tickets").push({
          ref_no: refNo,
          uid: convoId,
          customer_name: convo.customer_name || convo.name || "",
          customer_phone: convo.customer_phone || state.savedPhone || "",
          phone_source: convo.phone_source || "",
          topic: String(input.topic || "general"),
          summary: String(input.summary || "").slice(0, 500),
          conversation_id: convoId,
          status: "open",
          created_by: "ai",
          created_at: Date.now(),
        });
        await writeSystemMessage(db, convoId, `สร้างเรื่องติดตาม ${refNo} แล้ว เจ้าหน้าที่จะติดต่อกลับ`);
        return { ok: true, ref_no: refNo };
      }

      default:
        return { error: `unknown_tool:${name}` };
    }
  };
}

// ---------------------------------------------------------------------------
// History -> Claude messages
// ---------------------------------------------------------------------------

// Question groups + option ids of a condition set, in prompt/tool shape.
// Single mapper shared by get_condition_questions AND the last-quote system
// block, so the ids the model sees are always the same either way.
function conditionGroupsOf(set) {
  const groupsRaw = Array.isArray(set.groups) ? set.groups : Object.values(set.groups || {});
  return groupsRaw
    .filter((g) => g && (g.title || g.name))
    .slice(0, 12)
    .map((g) => ({
      id: g.id,
      title: g.title || g.name,
      options: (Array.isArray(g.options) ? g.options : Object.values(g.options || {}))
        .filter((o) => o && (o.label || o.name))
        .slice(0, 12)
        .map((o) => ({
          id: o.id,
          label: o.label || o.name,
          // Explicit per-option "won't buy" flag (Condition Sets Engine sets
          // failBehavior 'reject' on e.g. "กล้องมีปัญหา") — surfaced so the
          // model knows this answer means decline, not a 0-baht deduction.
          ...(o.failBehavior === "reject" ? { reject: true } : {}),
        })),
    }));
}

// For a delisted (declined_model) device the reply must be a clean decline
// with NO model suggestions. The model tends to either defer to staff (a
// dead-end) or list other iPhones from memory as "sellable" — some of which
// are ALSO งดรับซื้อ (e.g. it declined iPhone 7 Plus then suggested iPhone 8 /
// X, both isActive:false). Since the model can't reliably tell which models
// are active, we normalise to a deterministic decline that just invites the
// customer to name a model. The ONLY reply we keep as-is is one that already
// makes a concrete price/quote offer for another model — a mixed
// "iPhone 6 งดรับ / iPhone 15 รับ ราคา..." answer we must not clobber.
function shouldOverrideDeclinedReply(finalText) {
  const t = String(finalText || "");
  if (/ราคาประเมิน|ราคารับซื้อ|\d[\d,]{2,}\s*บาท|ออกใบเสนอราคา/.test(t)) return false;
  return true;
}

// System-prompt block enabling the IMEI/serial device check in chat. Only
// appended when the back-office toggle (settings/chat_widget/sickw.enabled)
// is on, so a disabled integration never even tempts the model to offer it.
// Admin-authored knowledge graph (settings/chat_kb) — the "answer web" the
// owner edits visually on the bkk-system /chat-kb canvas (React Flow). Nodes
// are answer categories; each CUSTOM node holds Q&A items that are official
// store answers (they outrank the built-in FAQ on conflict, same as the free-
// text kb). LIVE nodes only mirror data the AI already reads via tools
// (coupons/prices/branches) — no items, skipped here. Node hierarchy comes
// from the drawn edges: a child category renders as "หมวดแม่ › หมวดลูก".
// Pure so the offline test harness can cover it without Firebase.
function buildKbGraphBlock(kbGraph) {
  if (!kbGraph || typeof kbGraph !== "object") return "";
  const nodes = kbGraph.nodes && typeof kbGraph.nodes === "object" ? kbGraph.nodes : {};
  const edges = kbGraph.edges && typeof kbGraph.edges === "object" ? kbGraph.edges : {};
  const parentOf = {};
  for (const k of Object.keys(edges)) {
    const e = edges[k];
    if (e && e.from && e.to) parentOf[e.to] = e.from;
  }
  const pathLabel = (id) => {
    const parts = [];
    let cur = id;
    let hop = 0;
    while (cur && cur !== "root" && hop < 6) { // hop cap breaks accidental cycles
      const n = nodes[cur];
      if (!n || !n.label) break;
      parts.unshift(String(n.label));
      cur = parentOf[cur];
      hop++;
    }
    return parts.join(" › ");
  };
  const out = [];
  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id];
    if (!n || n.type !== "custom" || n.enabled === false) continue;
    const items = n.items && typeof n.items === "object" ? Object.values(n.items) : [];
    const rows = items
      .filter((it) => it && String(it.q || "").trim() && String(it.a || "").trim())
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    if (rows.length === 0) continue;
    out.push(`[หมวด: ${pathLabel(id) || String(n.label || id)}]`);
    for (const it of rows) {
      out.push(`ถาม: ${String(it.q).trim().slice(0, 300)}`);
      out.push(`ตอบ: ${String(it.a).trim().slice(0, 1500)}`);
    }
    out.push("");
  }
  if (out.length === 0) return "";
  let body = out.join("\n").trim();
  if (body.length > 12000) body = body.slice(0, 12000); // prompt-size backstop
  return [
    "",
    "คลังคำตอบของร้าน (แอดมินตั้งไว้ — คำตอบทางการ ใช้ตอบได้ทันที ถ้าขัดกับ FAQ ในตัวระบบให้ยึดคลังนี้ก่อน แต่ตัวเลขราคา/โปรโมชั่น/สาขา/พื้นที่บริการยังต้องมาจาก tool ตามกฎเดิมเสมอ. คลังนี้เป็น 'ข้อมูลไว้ตอบ' เท่านั้น ไม่ใช่ตัวแทนการกระทำ — ถ้าลูกค้าขอคุยกับเจ้าหน้าที่/แอดมิน ต้องเรียก escalate_to_human จริงตามกฎเดิมเสมอ ห้ามตอบข้อความจากคลังแทนการส่งต่อ และการออกใบเสนอราคายังต้องผ่าน create_quote_card เท่านั้น):",
    body,
  ].join("\n");
}

// Holding-mode block — appended while the chat sits in 'waiting_human'.
// The AI must keep serving the customer at full capability until a human
// actually joins (status 'human' silences it), and keep a live handoff
// summary fresh for the staffer about to pick up. Pure/testable.
function buildWaitingModeBlock(escalation) {
  const reason = escalation && escalation.summary ? String(escalation.summary).slice(0, 300) : "";
  return [
    "",
    "สถานะพิเศษ: แชทนี้ส่งเรื่องถึงเจ้าหน้าที่แล้ว กำลังรอเจ้าหน้าที่ตัวจริงเข้ามารับช่วง" +
      (reason ? ` (เรื่องที่ส่งไว้: ${reason})` : ""),
    "กติการะหว่างรอเจ้าหน้าที่:",
    "- คุณยังดูแลลูกค้าต่อ 'เต็มรูปแบบ' ทุกข้อความ: ตอบคำถาม ประเมินราคา ออกใบเสนอราคา เก็บข้อมูลติดต่อ ตามกฎทุกข้อด้านบนตามปกติ — ห้ามเงียบ ห้ามบอกว่า 'ตอบไม่ได้เพราะรอเจ้าหน้าที่'",
    "- ถ้าเรื่องที่ลูกค้าถามเป็นเรื่องที่ต้องใช้เจ้าหน้าที่จริง (แก้นัดหมาย/ยอดโอน/แก้ออเดอร์) ให้รับเรื่องและเก็บรายละเอียดเพิ่มไว้ให้เจ้าหน้าที่ พร้อมยืนยันสั้นๆ ว่าเจ้าหน้าที่กำลังเข้ามาดูแล",
    "- ไม่ต้องเรียก escalate_to_human ซ้ำ (เรื่องถึงเจ้าหน้าที่แล้ว) และไม่ต้องย้ำทุกข้อความว่า 'เจ้าหน้าที่กำลังมา' — บอกเฉพาะเมื่อลูกค้าถามถึงหรือเปลี่ยนเรื่องสำคัญ",
    "- เมื่อได้ข้อมูลใหม่ที่เจ้าหน้าที่ควรรู้ก่อนเข้ามารับ (ลูกค้าต้องการอะไร คุยถึงไหน มีใบเสนอราคา/เงื่อนไขอะไรใหม่) ให้เรียก update_handoff_summary ด้วยสรุปสั้นๆ 1-3 ประโยค เพื่อให้เจ้าหน้าที่รับช่วงต่อได้ทันที",
  ].join("\n");
}

// Central store profile block — the owner's standard values from
// settings/store_profile (/store-settings page). These are THE answers for
// "เบอร์ร้าน/ติดต่อยังไง/เปิดกี่โมง" — branch rows are per-location detail
// only. Pure/testable; empty profile renders nothing.
function buildStoreProfileBlock(profile) {
  if (!profile || typeof profile !== "object") return "";
  const lines = [];
  if (profile.phone) lines.push(`- เบอร์กลางของร้าน: ${profile.phone}`);
  if (profile.line_id) lines.push(`- LINE: ${profile.line_id}`);
  if (profile.email) lines.push(`- อีเมล: ${profile.email}`);
  if (profile.hours_start && profile.hours_end)
    lines.push(`- เวลาทำการมาตรฐาน: ${profile.hours_start}-${profile.hours_end} น. ทุกวัน`);
  if (profile.website) lines.push(`- เว็บไซต์: ${profile.website}`);
  if (lines.length === 0) return "";
  return [
    "",
    "ข้อมูลติดต่อกลางของร้าน (ค่ามาตรฐานที่เจ้าของร้านตั้งไว้ — ยืนยันแล้ว ใช้ตอบได้ทันที): ลูกค้าขอเบอร์/ช่องทางติดต่อ/เวลาทำการ ให้ตอบจากตรงนี้ก่อนเสมอ สั้นๆ 1-2 บรรทัด ไม่ต้องเรียก get_branches. ข้อมูลรายสาขา (ที่อยู่/แผนที่/เวลาเฉพาะสาขา) ค่อยใช้ get_branches เมื่อลูกค้าถามหาสาขา/ที่ตั้ง. ถ้าเวลาเฉพาะสาขาต่างจากเวลามาตรฐาน ให้ระบุว่าเป็นเวลาของสาขานั้น:",
    ...lines,
  ].join("\n");
}

function buildDeviceCheckBlock(enabled) {
  if (enabled !== true) return "";
  return [
    "",
    "ระบบตรวจเครื่องด้วยหมายเลข (เปิดใช้งาน):",
    "- ระหว่างเดินเรื่องประเมินราคา เชิญชวนลูกค้า 'สั้นๆ ครั้งเดียว ไม่บังคับ': กด *#06# แล้วส่ง IMEI 15 หลักมา ระบบจะยืนยันรุ่น/ความจุและเช็คสถานะเครื่องให้ทันที (แม่นยำกว่าและเร็วกว่า)",
    "- ได้เลขจากลูกค้าแล้วเรียก check_device_by_serial ทันที — ใช้เฉพาะเลขที่ลูกค้าพิมพ์มาเองเท่านั้น ห้ามแต่งเลขหรือเดาเลขเด็ดขาด",
    "- ผลตรวจ locked=true = ร้านไม่รับซื้อ แจ้งสุภาพว่าติดอะไร (เช่นต้อง Sign out iCloud ก่อน) ห้ามออกการ์ด",
    "- ผลตรวจปกติ: ใช้ model/capacity ยืนยันรุ่นแทนคำบอกของลูกค้า และใช้ country/model_number ตอบเรื่องศูนย์ไทย/เครื่องนอกใน answers โดยไม่ต้องถามข้อ (4) อีก",
    "- ถ้า tool คืน error ใดๆ ให้ทำตาม note ของ error นั้นและเดินเรื่องประเมินตามคำตอบลูกค้าตามปกติ ห้ามค้างรอ",
    "- ห้ามเล่ารายละเอียดผลตรวจอื่นให้ลูกค้า (ประกัน/ผู้ให้บริการ/วันซื้อ) — บอกได้แค่ รุ่น ความจุ สี และสถานะล็อกผ่าน/ไม่ผ่าน",
  ].join("\n");
}

// System-prompt block carrying the ids of the models found earlier in this
// conversation (ai_state/last_search). Before the first card exists there is
// no last_quote, and tool results do not survive across turns — without this
// block a later quote turn has no model_id and the model either re-searches
// (fine) or gives up and escalates (the "iPhone 17" dead-end).
function buildLastSearchBlock(lastSearch) {
  const results = lastSearch && Array.isArray(lastSearch.results) ? lastSearch.results : [];
  const rows = results.filter((r) => r && r.model_id && r.name);
  if (rows.length === 0) return "";
  return [
    "",
    "รุ่นที่ค้นพบแล้วในแชทนี้ (ข้อมูลภายใน ห้ามพูด id ให้ลูกค้าฟัง — ใช้ตอนเรียก get_condition_questions/create_quote_card ได้ทันที ไม่ต้อง search_models ซ้ำ):",
    ...rows.map(
      (r) =>
        `- model_id: ${r.model_id} = ${r.name} | ความจุ: ${(r.variants || [])
          .map((v) => `${v.name} (มือสอง ${Number(v.used_price || 0).toLocaleString("th-TH")}${Number(v.new_price) > 0 ? ` / มือ1 ${Number(v.new_price).toLocaleString("th-TH")}` : ""})`)
          .join(", ")}`,
    ),
    "กติกา: เมื่อลูกค้าตอบสภาพครบพอออกการ์ดแล้ว ห้าม escalate ด้วยเหตุ 'ไม่รู้รุ่น/ไม่รู้ id' เด็ดขาด — id อยู่ตรงนี้แล้ว ให้เรียก create_quote_card เลย (ขาดเรื่องศูนย์ไทย/นอก ให้ default ศูนย์ไทยตามข้อ 6.9)",
  ].join("\n");
}

// System-prompt block carrying the ids behind the last card issued in this
// conversation. Cross-turn history is text-only, so this is the ONLY way the
// model can know model_id/variant/answers when the customer amends conditions
// later ("ถ้ามีรอยนิดนึง", "ไม่มีกล่องด้วยครับ") — without it the model can only
// guess ids and create_quote_card fails.
function buildLastQuoteBlock(lastQuote, conditionGroups) {
  if (!lastQuote || !lastQuote.model_id || !lastQuote.variant_name) return "";
  const answers =
    lastQuote.answers && typeof lastQuote.answers === "object" ? lastQuote.answers : {};
  return [
    "",
    "ใบเสนอราคาล่าสุดที่ออกการ์ดจริงแล้วในแชทนี้ (ข้อมูลภายใน ห้ามพูด id ให้ลูกค้าฟัง):",
    `- model_id: ${lastQuote.model_id} (${lastQuote.model_name || ""})`,
    `- variant_name: ${lastQuote.variant_name}`,
    `- condition_type: ${lastQuote.condition_type || "used"}${lastQuote.condition_type === "new" ? ` (has_receipt: ${lastQuote.has_receipt === true})` : ""}`,
    `- answers ที่ลูกค้าตอบแล้ว: ${JSON.stringify(answers)}`,
    `- ยอดประเมินการ์ดล่าสุด: ${Number(lastQuote.estimated_price || 0).toLocaleString("th-TH")} บาท`,
    ...(Array.isArray(conditionGroups) && conditionGroups.length > 0
      ? [
          "ตัวเลือกสภาพทั้งหมดของรุ่นนี้ (group_id | option_id = ความหมาย) — ใช้เลือก option ตอนออกการ์ดใหม่ได้ทันที ไม่ต้องเรียก get_condition_questions ซ้ำ:",
          ...conditionGroups.map(
            (g) =>
              `- ${g.id} "${g.title}": ${(g.options || [])
                .map((o) => `${o.id}=${o.label}${o.reject ? " [ร้านปฏิเสธรับซื้อถ้าเลือกข้อนี้]" : ""}`)
                .join(" | ")}`,
          ),
        ]
      : []),
    "กติกาอัปเดตใบเสนอราคา: ถ้าลูกค้าเพิ่ม/แก้ข้อมูลสภาพหลังการ์ดออกแล้ว (เช่น มีกล่องเพิ่ม เพิ่มรอย แบตต่ำกว่าที่บอก) ห้ามตอบเลื่อนลอยว่า 'รอตรวจหน้างาน' เฉยๆ และห้ามถามซ้ำ — ให้เรียก create_quote_card ใหม่ทันทีด้วย model_id/variant_name ข้างบน โดยใน answers ใส่ 'เฉพาะกลุ่มที่ลูกค้าเพิ่งพูดถึงในข้อความล่าสุด' (ระบบจะรวมกับ answers เดิมข้างบนให้อัตโนมัติ กลุ่มที่ไม่ส่งมาจะคงคำตอบเดิมไว้) เช่น ลูกค้าบอก 'เจอกล่องแล้ว' = ส่งแค่กลุ่มอุปกรณ์เป็นตัวเลือกครบกล่อง กลุ่มเดียวจบ. ห้ามใส่กลุ่มที่ลูกค้าไม่ได้พูดถึงเด็ดขาด (ห้ามเดารอย/บุบ/สภาพใดๆ เพิ่มเอง — ใส่เกินคือบั๊กร้ายแรง ยอดจะผิดและลูกค้าจะไม่เชื่อถือ). ถามเพิ่มได้เฉพาะเมื่อคำพูดลูกค้าคลุมเครือจน map ไม่ได้จริงๆ (ถามสั้นๆ 1 คำถาม). การ์ดใหม่จะใช้แทนใบเดิมโดยอัตโนมัติ ผลลัพธ์จะบอก previous_estimate ไว้เทียบ — ตอบสั้นๆ บอกยอดใหม่และทิศทาง (ขึ้น/ลง/เท่าเดิม) ตามตัวเลขจริง แล้วชวนกดปุ่ม ไม่ต้องพิมพ์รายละเอียดการ์ดซ้ำ",
  ].join("\n");
}

function buildClaudeHistory(messageList) {
  const turns = [];
  for (const m of messageList) {
    if (!m || !m.text) continue;
    if (m.senderRole === "system" || m.kind === "system") continue;
    const role = m.senderRole === "customer" ? "user" : "assistant";
    const text = m.senderRole === "admin" ? `[เจ้าหน้าที่ ${m.senderName || ""}] ${m.text}` : m.text;
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content += `\n${text}`;
    } else {
      turns.push({ role, content: text });
    }
  }
  // Claude requires the first turn to be from the user.
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns.map((t) => ({ role: t.role, content: t.content }));
}

// ---------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------

function registerChatAi({ dispatchAdminPush }) {
  const chatWidgetAiReply = onValueCreated(
    {
      ref: "/inbox/{convoId}/messages/{msgId}",
      region: REGION,
      // Warm — customers are waiting on a live conversation (same rationale
      // as onChatMessageCreated). The LLM call dominates latency; a cold
      // start on top of it makes the first reply feel broken.
      minInstances: 1,
      timeoutSeconds: 120,
      memory: "512MiB",
    },
    async (event) => {
      const tag = "chatWidgetAiReply";
      const msg = event.data.val();
      if (!msg || msg.senderRole !== "customer") return;

      const { convoId, msgId } = event.params;
      const db = getDatabase();

      // Master gate — widget disabled means this whole system is inert.
      // preview_enabled = test mode: the widget is only visible to admins
      // using ?chat_preview=1, but this function must answer their messages.
      const settingsSnap = await db.ref("settings/chat_widget").once("value");
      const settings = settingsSnap.val() || {};
      const pub = settings.public || {};
      if (pub.enabled !== true && pub.preview_enabled !== true) return;

      // Central store profile (settings/store_profile — "ค่ากลางของร้าน",
      // edited at /store-settings). The STANDARD hours + contact channels live
      // here; scattered copies (chat-widget hours field, per-branch rows) are
      // fallbacks/details only. Real bug this fixes: the escalation message
      // quoted 08:00-20:00 (chat-widget setting) while branch data said
      // 10:00-20:00 — two sources of truth contradicting each other in one
      // conversation. Best-effort: a missing profile falls back cleanly.
      let storeProfile = {};
      try {
        const spSnap = await db.ref("settings/store_profile").once("value");
        if (spSnap.exists()) storeProfile = spSnap.val() || {};
      } catch { /* fall back to chat-widget hours */ }
      if (storeProfile.hours_start) pub.hours_start = storeProfile.hours_start;
      if (storeProfile.hours_end) pub.hours_end = storeProfile.hours_end;

      // Idempotency — RTDB triggers can retry; only the first claim proceeds.
      const guard = await db
        .ref(`inbox/${convoId}/ai_state/processed/${msgId}`)
        .transaction((cur) => (cur === null ? true : undefined));
      if (!guard.committed) return;

      const convoSnap = await db.ref(`inbox/${convoId}`).once("value");
      const convo = convoSnap.val() || {};
      const assistantName = pub.assistant_name || "BKK APPLE Assistant";
      const text = String(msg.text || "").slice(0, 2000);
      const now = Date.now();

      // Ensure conversation shell + denormalize for the admin console.
      const convoUpdates = {
        type: "customer",
        lastMessage: text.slice(0, 200),
        lastMessageAt: now,
        unreadCount: ServerValue.increment(1),
      };
      if (!convo.createdAt) convoUpdates.createdAt = now;
      if (!convo.status) convoUpdates.status = "ai";
      if (msg.client_context && msg.client_context.url) {
        convoUpdates.source_url = String(msg.client_context.url).slice(0, 300);
      }
      if (!convo.name) {
        try {
          const userSnap = await db.ref(`users/${convoId}`).once("value");
          const profile = userSnap.val() || {};
          convoUpdates.name = profile.name || `ลูกค้า #${convoId.slice(-4).toUpperCase()}`;
          if (profile.phone && !convo.customer_phone) {
            convoUpdates.customer_phone = normalizePhone(profile.phone);
            convoUpdates.phone_source = "account";
          }
        } catch {
          convoUpdates.name = `ลูกค้า #${convoId.slice(-4).toUpperCase()}`;
        }
      }
      await db.ref(`inbox/${convoId}`).update(convoUpdates);

      const status = convo.status || "ai";
      const customerLabel = convo.customer_name || convo.name || convoUpdates.name || "ลูกค้า";

      // Human is driving — never let the AI talk over them. Just alert the
      // assigned staff (fallback: everyone) and stop.
      if (status === "human") {
        await pushToStaffOrBroadcast(
          db,
          dispatchAdminPush,
          convo.assigned_staff_id,
          buildInboxPushMessage(convoId, `แชทลูกค้า: ${customerLabel}`, text),
          tag
        );
        return;
      }

      // Queued for a human — keep pinging (collapse key keeps it to one
      // visible notification per conversation), but DO NOT go silent.
      // Escalation = a flag calling staff in, not the AI resigning: until a
      // human actually takes the chat (status 'human'), the AI keeps caring
      // for the customer in holding mode. The old early-return left a dead
      // zone — the customer asked for an admin, then sent more messages into
      // silence and couldn't even get the AI back until staff released the
      // chat. Status stays waiting_human so the queue/badge/push persist.
      let waitingForHuman = false;
      if (status === "waiting_human") {
        await dispatchAdminPush(
          buildInboxPushMessage(convoId, `ลูกค้ารอเจ้าหน้าที่: ${customerLabel}`, text),
          tag
        );
        waitingForHuman = true;
      }

      // Closed conversation reopens under AI triage.
      if (status === "resolved") {
        await db.ref(`inbox/${convoId}`).update({ status: "ai" });
      }

      // Manual mode — no API key configured: behave like a plain inbox.
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        await dispatchAdminPush(
          buildInboxPushMessage(convoId, `แชทลูกค้า: ${customerLabel}`, text),
          tag
        );
        return;
      }

      // Recent history (also powers the flood check). Push keys sort
      // chronologically, so orderByKey needs no .indexOn.
      const historySnap = await db
        .ref(`inbox/${convoId}/messages`)
        .orderByKey()
        .limitToLast(HISTORY_LIMIT)
        .once("value");
      const history = [];
      historySnap.forEach((s) => {
        history.push({ id: s.key, ...s.val() });
      });

      // Flood guard — a runaway client (or abuse) stops getting AI replies;
      // messages still land in the console via the denormalization above.
      const recentCustomerCount = history.filter(
        (m) => m.senderRole === "customer" && Number(m.timestamp) > now - 60000
      ).length;
      if (recentCustomerCount > RATE_LIMIT_COUNT) {
        await db.ref(`inbox/${convoId}/ai_state`).update({ rate_limited_at: now });
        console.warn(`[${tag}] rate limited ${convoId}: ${recentCustomerCount} msgs/min`);
        return;
      }

      // Daily spend cap — atomic counter, Bangkok day boundary.
      const { ymd } = bangkokNowParts();
      const cap = Number(settings.daily_call_cap) || DEFAULT_DAILY_CALL_CAP;
      const capTx = await db
        .ref(`chat_ai_usage/${ymd}/calls`)
        .transaction((cur) => (Number(cur) || 0) + 1);
      const callsToday = Number(capTx.snapshot.val()) || 0;
      if (callsToday > cap) {
        const noticeAt = Number(convo.ai_state && convo.ai_state.cap_notice_at) || 0;
        if (now - noticeAt > 60 * 60 * 1000) {
          await db.ref(`inbox/${convoId}/ai_state`).update({ cap_notice_at: now });
          await writeAiMessage(
            db,
            convoId,
            assistantName,
            "ขออภัยครับ ระบบผู้ช่วยอัตโนมัติไม่พร้อมใช้งานชั่วคราว เจ้าหน้าที่จะเข้ามาตอบโดยเร็วที่สุดครับ"
          );
        }
        await dispatchAdminPush(
          buildInboxPushMessage(convoId, `AI ถึงเพดานรายวัน - แชทลูกค้า: ${customerLabel}`, text),
          tag
        );
        return;
      }

      // Awareness push — notify the chat app on every customer message even
      // though the AI answers, so staff can watch a live deal and jump in. Both
      // lost deals died silently while the AI handled them with no admin alert.
      // buildInboxPushMessage's per-conversation collapseKey keeps one chat to
      // one notification thread (rapid messages don't stack). Off-switch:
      // settings/chat_widget/notify_all_messages = false.
      // (Skipped in waiting mode — the "ลูกค้ารอเจ้าหน้าที่" ping above already
      // covered this message; two pushes per message would be noise.)
      if (!waitingForHuman && settings.notify_all_messages !== false) {
        await dispatchAdminPush(
          buildInboxPushMessage(convoId, `ลูกค้าทักแชท (AI ดูแล): ${customerLabel}`, text),
          tag
        );
      }

      // ---- AI turn ----
      await db.ref(`inbox/${convoId}`).update({ ai_typing: true });
      const state = { escalated: false, escalatedThisTurn: false, savedPhone: "", contactGatePromptedThisTurn: false };
      try {
        const inHours = isBusinessHours(pub);

        // Customer context block for the system prompt.
        let ordersLine = "ยังไม่พบออเดอร์ของบัญชีนี้";
        try {
          const jobsSnap = await db
            .ref("jobs")
            .orderByChild("uid")
            .equalTo(convoId)
            .limitToLast(3)
            .once("value");
          if (jobsSnap.exists()) {
            const lines = [];
            jobsSnap.forEach((j) => {
              const job = j.val() || {};
              lines.push(`- ${job.ref_no || j.key}: ${job.model || ""} สถานะ ${job.status || ""}`);
            });
            ordersLine = `ออเดอร์ของบัญชีนี้ (เปิดเผยกับลูกค้าได้):\n${lines.reverse().join("\n")}`;
          }
        } catch { /* jobs lookup is best-effort context */ }

        const customerBlock = [
          `ข้อมูลลูกค้าคนนี้:`,
          `- ชื่อที่ทราบ: ${convo.customer_name || convoUpdates.name || convo.name || "ยังไม่ทราบ"}`,
          `- เบอร์ที่ทราบ: ${convo.customer_phone || "ยังไม่ทราบ"}${convo.phone_source === "chat" ? " (ลูกค้าแจ้งในแชท ยังไม่ยืนยันตัวตน)" : ""}`,
          `- หน้าเว็บที่ลูกค้าเปิดแชท: ${(msg.client_context && msg.client_context.url) || convo.source_url || "-"}`,
          `- ${ordersLine}`,
        ].join("\n");

        const kb = String(settings.kb || "").slice(0, 8000);
        // Answer web (settings/chat_kb) — admin-curated Q&A graph, appended to
        // the prompt below. Best-effort: an unreadable graph must never stop
        // the reply.
        let kbGraphBlock = "";
        try {
          const kbgSnap = await db.ref("settings/chat_kb").once("value");
          if (kbgSnap.exists()) kbGraphBlock = buildKbGraphBlock(kbgSnap.val());
        } catch (err) {
          console.warn(`[${tag}] ${convoId} chat_kb load failed:`, err && err.message);
        }
        // The last-quote block also carries the model's full option-id catalog
        // so a follow-up like "มีกล่องครบนะ" can be re-quoted without the model
        // having to re-discover ids via tools (the step it skipped in the
        // "answers ชุดเดิม ยอดไม่ขยับ" bug). Best-effort — block still works
        // without the catalog.
        const lastQuote = convo.ai_state && convo.ai_state.last_quote;
        let lastQuoteGroups = null;
        if (lastQuote && lastQuote.model_id) {
          try {
            const mSnap = await db.ref(`models/${lastQuote.model_id}`).once("value");
            const m = mSnap.exists() ? mSnap.val() : null;
            const setId = m && (m.conditionSetId || m.engineId);
            if (setId) {
              const sSnap = await db.ref(`settings/condition_sets/${setId}`).once("value");
              if (sSnap.exists()) lastQuoteGroups = conditionGroupsOf(sSnap.val());
            }
          } catch (err) {
            console.warn(`[${tag}] ${convoId} last_quote groups fetch failed:`, err && err.message);
          }
        }
        const system =
          buildSystemPrompt({ assistantName, pub, kb, customerBlock, inHours }) +
          buildStoreProfileBlock(storeProfile) +
          kbGraphBlock +
          (waitingForHuman ? buildWaitingModeBlock(convo.escalation) : "") +
          buildDeviceCheckBlock(settings.sickw && settings.sickw.enabled) +
          buildLastSearchBlock(convo.ai_state && convo.ai_state.last_search) +
          buildLastQuoteBlock(lastQuote, lastQuoteGroups);
        const model = pickModel({
          settingsModel: settings.model || process.env.CHAT_AI_MODEL,
          text,
        });
        console.log(`[${tag}] ${convoId} model=${model}`);
        // All customer utterances this conversation — lets create_quote_card
        // verify the quoted model line (Pro Max vs Pro) against what was actually
        // said, since the triggering message alone ("256GB") won't carry it.
        const customerText = history
          .filter((m) => m.senderRole === "customer")
          .map((m) => String(m.text || ""))
          .join(" \n ");
        const executeTool = makeToolExecutor({ db, convoId, convo, pub, dispatchAdminPush, tag, state, assistantName, customerText, lastCustomerText: text });

        let messages = buildClaudeHistory(history);
        if (messages.length === 0) messages = [{ role: "user", content: text }];

        let finalText = "";
        // Text the model wrote alongside tool calls in earlier rounds — used
        // as the reply if the loop ends without a clean final text (tool-round
        // exhaustion, empty last response) instead of dead-ending to escalate.
        let lastRoundText = "";
        let totalIn = 0;
        let totalOut = 0;
        // True only when create_quote_card actually succeeded this turn — used to
        // catch the model "narrating" a quote (fake price + 'press the button on
        // the card') without a real card existing.
        let quoteOk = false;
        // Set when search_models reports a delisted model (isActive:false =
        // "งดรับซื้อ"). Used by the decline guard below to stop the model from
        // waffling ("ขอให้เจ้าหน้าที่ตรวจสอบราคา...") on a model we deliberately
        // don't buy — that read as a dead-end and left the chat stuck in AI.
        let declinedModel = null;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const resp = await callClaudeResilient({ apiKey, model, system, messages, tools: TOOLS });
          totalIn += (resp.usage && resp.usage.input_tokens) || 0;
          totalOut += (resp.usage && resp.usage.output_tokens) || 0;

          const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
          const textBlocks = (resp.content || []).filter((b) => b.type === "text");
          const roundText = textBlocks.map((b) => b.text).join("\n").trim();
          if (roundText) lastRoundText = roundText;
          console.log(
            `[${tag}] ${convoId} round=${round} stop=${resp.stop_reason} blocks=${(resp.content || [])
              .map((b) => b.type)
              .join(",") || "none"}`
          );

          if (resp.stop_reason === "tool_use" && toolUses.length > 0) {
            messages.push({ role: "assistant", content: resp.content });
            const results = [];
            for (const tu of toolUses) {
              console.log(
                `[${tag}] ${convoId} tool ${tu.name} input=${JSON.stringify(tu.input || {}).slice(0, 300)}`
              );
              let result;
              try {
                result = await executeTool(tu.name, tu.input || {});
              } catch (err) {
                console.error(`[${tag}] tool ${tu.name} failed:`, err);
                // เก็บ breadcrumb ให้แอดมิน/นักพัฒนาดูย้อนหลังได้จาก Firebase console
                await db
                  .ref(`inbox/${convoId}/ai_state/last_tool_error`)
                  .set({ tool: tu.name, message: String((err && err.message) || err).slice(0, 300), at: Date.now() })
                  .catch(() => {});
                result = {
                  error: "tool_failed",
                  detail: String((err && err.message) || err).slice(0, 200),
                  note: "เกิดข้อผิดพลาดชั่วคราว ลองเรียก tool เดิมซ้ำอีก 1 ครั้ง ถ้ายังพังค่อยแจ้งลูกค้าและ escalate",
                };
              }
              if (result && result.error) {
                console.log(`[${tag}] ${convoId} tool ${tu.name} error=${result.error}`);
              }
              if (tu.name === "create_quote_card" && result && result.ok === true) {
                quoteOk = true;
              }
              if (tu.name === "search_models" && result && result.declined_model) {
                declinedModel = result.declined_model;
              }
              results.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify(result).slice(0, 6000),
              });
            }
            messages.push({ role: "user", content: results });
            continue;
          }

          finalText = roundText;
          break;
        }

        // Loop ended without usable text — salvage in order: text written
        // alongside earlier tool calls, then one forced text-only turn.
        if (!finalText) finalText = lastRoundText;
        if (!finalText && !state.escalated) {
          console.warn(`[${tag}] ${convoId} empty final text — forcing a text-only turn`);
          try {
            const finalResp = await callClaudeResilient({
              apiKey,
              model,
              system,
              messages,
              tools: TOOLS,
              toolChoice: { type: "none" },
            });
            totalIn += (finalResp.usage && finalResp.usage.input_tokens) || 0;
            totalOut += (finalResp.usage && finalResp.usage.output_tokens) || 0;
            finalText = (finalResp.content || [])
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n")
              .trim();
          } catch (err) {
            console.error(`[${tag}] forced text-only turn failed:`, err);
          }
        }

        // Usage ledger (fire-and-forget accuracy is fine here).
        db.ref(`chat_ai_usage/${ymd}`).update({
          input_tokens: ServerValue.increment(totalIn),
          output_tokens: ServerValue.increment(totalOut),
        }).catch(() => {});

        if (!finalText) {
          finalText = state.escalated
            ? "ส่งเรื่องถึงเจ้าหน้าที่เรียบร้อยแล้วครับ"
            : "ขออภัยครับ ผมไม่แน่ใจในคำตอบ ขอส่งต่อให้เจ้าหน้าที่ดูแลต่อครับ";
          if (!state.escalated) {
            await executeTool("escalate_to_human", {
              reason: "cannot_answer",
              summary: `AI ตอบไม่ได้: "${text.slice(0, 120)}"`,
            });
          }
        }

        // Delisted-model decline guard: search_models flagged the model as
        // "งดรับซื้อ" (declined_model). Normalise the reply to a deterministic
        // decline — the model otherwise either defers to staff (a dead-end,
        // rule 2.1 says decline not escalate) or lists other iPhones from
        // memory as "sellable", some of which are ALSO งดรับซื้อ. The only
        // reply kept as-is is one already offering another model's price.
        if (declinedModel && finalText) {
          // Never send the SAME canned decline twice in a row. Real bug: the
          // fuzzy match declined the WRONG model ("MacBook Pro M5 Max" ->
          // "iPad mini 5"), the customer corrected it, and the guard replied
          // with the identical canned line again — a wall. If the previous AI
          // message already declined this exact model, the customer is
          // disputing it: hand to a human instead of repeating.
          const lastAi = [...history].reverse().find((m) => m.senderRole === "ai");
          const repeatedDecline =
            !!lastAi && String(lastAi.text || "").includes(`งดรับซื้อรุ่น ${declinedModel}`);
          if (repeatedDecline) {
            console.warn(`[${tag}] ${convoId} declined ${declinedModel} twice — customer disputing, escalating instead of repeating`);
            if (!state.escalated) {
              await executeTool("escalate_to_human", {
                reason: "cannot_answer",
                summary: `ระบบระบุว่างดรับซื้อ "${declinedModel}" แต่ลูกค้าแย้งว่าไม่ใช่รุ่นที่ต้องการขาย — ตรวจสอบรุ่นที่ลูกค้าหมายถึง: "${text.slice(0, 120)}"`,
              });
            }
            finalText =
              "ขออภัยในความสับสนครับ ผมส่งเรื่องให้เจ้าหน้าที่ช่วยตรวจสอบรุ่นของคุณโดยตรงแล้ว เดี๋ยวรีบแจ้งผลกลับครับ";
          } else if (shouldOverrideDeclinedReply(finalText)) {
            console.warn(`[${tag}] ${convoId} declined model ${declinedModel} — normalising to a deterministic decline`);
            finalText =
              `ต้องขออภัยด้วยครับ ตอนนี้ทางร้านงดรับซื้อรุ่น ${declinedModel} แล้วครับ ` +
              `หากมีรุ่นอื่นที่อยากขาย แจ้งชื่อรุ่นมาได้เลย เดี๋ยวผมประเมินราคาให้ทันทีครับ`;
            // If the model wrongly escalated a delisted model THIS turn, pull
            // the conversation back to AI so it isn't parked waiting for staff
            // on something we simply don't buy. escalatedThisTurn (not
            // escalated) so a pre-existing waiting_human queue — holding mode,
            // where escalate no-ops as already_waiting — is never cleared.
            if (state.escalatedThisTurn) {
              await db.ref(`inbox/${convoId}`).update({ status: "ai", escalation: null }).catch(() => {});
              state.escalated = false;
              state.escalatedThisTurn = false;
            }
          }
        }

        // Hallucinated-quote guard: the model announced a quote (a "press the
        // button on the card" line or a "ราคาประเมิน X บาท") but never actually
        // created one. Force create_quote_card once; if that still fails, hand
        // to a human — never send a made-up price / a card that does not exist.
        const announcedQuote =
          /กดปุ่ม[\s\S]{0,20}(การ์ด|ใบเสนอราคา)|(ราคาประเมิน|ราคารับซื้อ|ประเมินราคา)[\s\S]{0,25}\d[\d,]{2,}\s*บาท/.test(
            finalText,
          );
        if (finalText && !state.escalated && !quoteOk && announcedQuote) {
          console.warn(`[${tag}] ${convoId} narrated a quote with no card — forcing quote recovery`);
          try {
            // Recovery loop, not a one-shot forced call: the model may need
            // search_models / get_condition_questions first (cross-turn history
            // has no tool results, so ids can be unknown). tool_choice "any"
            // forbids text-only replies; loop until a card exists or 3 rounds.
            const recovery = [
              ...messages,
              {
                role: "user",
                content:
                  "[คำสั่งระบบ ไม่ใช่ลูกค้า] ข้อความล่าสุดของคุณอ้างถึงใบเสนอราคา/ราคาประเมิน แต่ยังไม่มีการ์ดจริงในเทิร์นนี้ ให้ออกการ์ดตอนนี้: เรียก create_quote_card ด้วย model_id/variant_name จากบริบท (ดูบล็อก 'ใบเสนอราคาล่าสุด' ใน system ถ้ามี) รวม answers เดิมกับเงื่อนไขที่ลูกค้าเพิ่งบอกเพิ่ม ถ้าไม่รู้ model_id ให้เรียก search_models ก่อน ถ้าไม่รู้ option id ของเงื่อนไขใหม่ให้เรียก get_condition_questions ก่อน ห้ามตอบข้อความอย่างเดียว",
              },
            ];
            for (let r = 0; r < 3 && !quoteOk && !state.escalated; r++) {
              const forced = await callClaudeResilient({
                apiKey, model, system, messages: recovery, tools: TOOLS,
                toolChoice: { type: "any" },
              });
              totalIn += (forced.usage && forced.usage.input_tokens) || 0;
              totalOut += (forced.usage && forced.usage.output_tokens) || 0;
              const uses = (forced.content || []).filter((b) => b.type === "tool_use");
              if (uses.length === 0) break;
              recovery.push({ role: "assistant", content: forced.content });
              const results = [];
              for (const tu of uses) {
                const result = await executeTool(tu.name, tu.input || {});
                if (result && result.error) {
                  console.log(`[${tag}] ${convoId} recovery tool ${tu.name} error=${result.error}`);
                }
                if (tu.name === "create_quote_card" && result && result.ok === true) {
                  quoteOk = true;
                }
                results.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: JSON.stringify(result).slice(0, 6000),
                });
              }
              recovery.push({ role: "user", content: results });
            }
            if (quoteOk) {
              finalText = "ออกใบเสนอราคาให้แล้วครับ กดปุ่มบนการ์ดเพื่อยืนยันการขายและกรอกข้อมูลได้เลยครับ";
            }
          } catch (err) {
            console.error(`[${tag}] quote recovery failed:`, err && err.message);
          }
          if (!quoteOk) {
            finalText = "ขออภัยครับ ผมกำลังจัดทำใบเสนอราคาให้ ขอเจ้าหน้าที่ช่วยยืนยันอีกครั้งแล้วรีบแจ้งกลับนะครับ";
            if (!state.escalated) {
              await executeTool("escalate_to_human", {
                reason: "quote_card_failed",
                summary: `AI พูดถึงใบเสนอราคาแต่สร้างการ์ดไม่สำเร็จ — ลูกค้า: "${text.slice(0, 120)}"`,
              });
            }
          }
        }

        // Escalation-promise guard: the customer explicitly asked for a human,
        // or the reply claims the chat was forwarded — but escalate_to_human
        // was never actually called this turn. Real bug: "ขอคุยกับแอดมิน" ->
        // "เดี๋ยวส่งต่อให้ครับ" -> status stays 'ai', no push, no Inbox queue,
        // nobody comes. Force the real escalation deterministically; the tool
        // writes the system confirmation + pushes admins itself.
        if (finalText && !state.escalated) {
          const wantsHuman = humanRequestIntent(text);
          const saidForwarded = claimsHumanForwarding(finalText);
          if (wantsHuman || saidForwarded) {
            console.warn(
              `[${tag}] ${convoId} escalation requested/promised but not executed (wantsHuman=${wantsHuman} saidForwarded=${saidForwarded}) — forcing escalate`
            );
            await executeTool("escalate_to_human", {
              reason: wantsHuman ? "customer_request" : "promised_forwarding",
              summary: wantsHuman
                ? `ลูกค้าขอคุยกับเจ้าหน้าที่: "${text.slice(0, 120)}"`
                : `AI บอกว่าส่งต่อแล้วแต่ยังไม่ได้ส่งจริง — ลูกค้า: "${text.slice(0, 120)}"`,
            });
          }
        }

        // Verifier gate — vet a genuine AI reply before it reaches the customer.
        // (Skip canned escalation replies; those are safe fixed strings.)
        if (finalText && !state.escalated) {
          const verdict = await verifyReply({ apiKey, userText: text, reply: finalText });
          if (verdict.usage) {
            db.ref(`chat_ai_usage/${ymd}`).update({
              input_tokens: ServerValue.increment(verdict.usage.input_tokens || 0),
              output_tokens: ServerValue.increment(verdict.usage.output_tokens || 0),
            }).catch(() => {});
          }
          if (verdict.ok === false) {
            console.warn(`[${tag}] ${convoId} verifier blocked: ${verdict.issue}`);
            await db
              .ref(`inbox/${convoId}/ai_state/last_verifier_block`)
              .set({ issue: verdict.issue, at: Date.now(), draft: finalText.slice(0, 500) })
              .catch(() => {});
            if (verdict.corrected && verdict.corrected.trim()) {
              finalText = verdict.corrected.trim();
            } else {
              // Cannot safely fix — hand to a human instead of sending a bad answer.
              finalText = "ขออภัยครับ ขอให้เจ้าหน้าที่ยืนยันข้อมูลส่วนนี้ให้ชัดเจนก่อน แล้วรีบแจ้งกลับนะครับ";
              if (!state.escalated) {
                await executeTool("escalate_to_human", {
                  reason: "verifier_block",
                  summary: `Verifier บล็อกคำตอบ AI (${verdict.issue}) — คำถามลูกค้า: "${text.slice(0, 120)}"`,
                });
              }
            }
          }
        }

        await writeAiMessage(db, convoId, assistantName, finalText.slice(0, 2000));
      } catch (err) {
        console.error(`[${tag}] AI turn failed:`, err);
        try {
          await writeAiMessage(
            db,
            convoId,
            assistantName,
            "ขออภัยครับ ระบบขัดข้องชั่วคราว ผมส่งเรื่องให้เจ้าหน้าที่ดูแลต่อแล้วครับ"
          );
          await db.ref(`inbox/${convoId}`).update({
            status: "waiting_human",
            escalation: { reason: "ai_error", summary: `ระบบ AI ขัดข้อง ข้อความล่าสุด: "${text.slice(0, 120)}"`, at: Date.now() },
          });
          await dispatchAdminPush(
            buildInboxPushMessage(convoId, `AI ขัดข้อง - แชทลูกค้า: ${customerLabel}`, text),
            tag
          );
        } catch (innerErr) {
          console.error(`[${tag}] fallback write failed:`, innerErr);
        }
      } finally {
        await db.ref(`inbox/${convoId}/ai_typing`).set(false).catch(() => {});
      }
    }
  );

  // Read-only knowledge audit for the admin chat-settings page. Returns the
  // SAME constants buildSystemPrompt uses — the page shows exactly what the
  // deployed AI already knows, so admins can spot what is missing and put
  // only the gaps into settings/chat_widget/kb. Name is project-unique
  // ({region}/{name} collision rule in CLAUDE.md).
  const getChatAiKnowledge = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ต้องล็อกอินก่อน");
    return {
      live_sources: [
        "ราคาและรุ่นสินค้า — ฐานข้อมูล models จริง (tool: search_models / create_quote_card) รวมสถานะงดรับซื้อ (isActive)",
        "ชุดคำถามประเมินสภาพ + ค่าหักตามสภาพ — settings/condition_sets (tool: get_condition_questions)",
        "พื้นที่บริการ Pickup + ค่าบริการไรเดอร์ + สาขาที่ใกล้ลูกค้า — settings/store + settings/branches + โปรค่าส่ง (tool: check_pickup_service)",
        "โปรโมชั่น/คูปองที่เปิดอยู่ — /coupons (tool: get_promotions)",
        "สาขา ที่อยู่ เวลาเปิด-ปิด — settings/branches (tool: get_branches)",
        "สถานะออเดอร์ของลูกค้าที่ล็อกอิน — jobs (tool: check_order_status, มีกฎ PDPA คุม)",
      ],
      service_info: SERVICE_INFO_LINES,
      official_faq: OFFICIAL_FAQ_LINES,
      deduction_policy: DEDUCTION_POLICY_LINES,
      faq: FAQ,
      models: {
        auto_strong: STRONG_MODEL,
        auto_trivial: DEFAULT_MODEL,
        verifier: VERIFIER_MODEL,
      },
    };
  });

  return { chatWidgetAiReply, getChatAiKnowledge };
}

// __test = internal surface for the regression harness (functions/test/).
// Not used by production code paths.
module.exports = {
  registerChatAi,
  __test: {
    buildSystemPrompt,
    buildLastQuoteBlock,
    buildLastSearchBlock,
    buildDeviceCheckBlock,
    buildKbGraphBlock,
    buildWaitingModeBlock,
    buildStoreProfileBlock,
    shouldOverrideDeclinedReply,
    batteryOptionRange,
    pickBatteryOptionId,
    modelLineMismatch,
    pickSiblingModel,
    priceHaggleIntent,
    humanRequestIntent,
    claimsHumanForwarding,
    normalizePhone,
    verifyReply,
    callClaude,
    pickModel,
    rankModels,
    sublineMismatch,
    ipadAirGenToken,
    ipadAirGenAliasNote,
    singleResultVariantNote,
    searchFaq,
    TOOLS,
    STRONG_MODEL,
    DEFAULT_MODEL,
    VERIFIER_MODEL,
  },
};
