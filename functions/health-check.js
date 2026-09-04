// =============================================================================
// System Health Check — ตรวจสถานะ service/API ภายนอกทุกตัวที่ระบบพึ่งพา
// แล้วเขียนผลลง RTDB `system_health/` ให้หน้า /system-health (admin) อ่าน
//
// เกิดจากเคสจริง: หน้า checkout ลูกค้าค้าง "กำลังคำนวณ..." ค่าไรเดอร์
// เพราะข้อมูลสาขา (settings/branches) ใช้ไม่ได้ — ไม่มีใครรู้จนลูกค้าแจ้ง.
// ระบบนี้ตรวจทั้ง config ภายใน (probe `checkout_config`) และ API ภายนอก
// (Routes/Geocoding/SickW/Resend/Telegram/Thailand Post/Anthropic) รวมถึง
// ยิง end-to-end ไปที่ `quotePickupServiceability` (functions ของ repo
// bkk-frontend-next) เหมือนลูกค้า/แอป iOS ใช้จริง
//
// กติกาที่ยึดตาม CLAUDE.md:
//   - ชื่อ function unique ระดับ project: `systemHealthCheck` (scheduler),
//     `adminSystemHealthRun` (callable) — ไม่ชนกับ codebase อื่น
//   - push แจ้งเหตุผ่าน dispatchAdminPush (inject จาก index.js) ซึ่งถูก gate
//     ด้วย settings/notifications อยู่แล้ว — data.type `system_health_alert`
//     ต้อง map เป็นหมวด system_alert ใน functions/notification-settings.js
//   - RTDB cost: อ่าน/เขียนเฉพาะ node เล็ก (`system_health`, `settings/*`)
//     ไม่แตะ /jobs. read rule ของ `system_health` (admin เท่านั้น) อยู่ที่
//     bkk-frontend-next/database.rules.json — deploy จาก repo นั้น
//   - env key ไม่ตั้ง = status `skip` (ไม่นับเป็น fail) ตาม convention
//     "ไม่ตั้ง key = ระบบข้ามเงียบๆ ไม่ crash" ของ email/telegram
//
// ค่าใช้จ่าย probe: Routes 2 element + Geocoding 2 call + quote 1 element
// ต่อรอบ (คีย์ server 1 + คีย์เบราว์เซอร์ 1 อย่างละตัว), scheduler รายชั่วโมง
// ≈ 1.5k calls/เดือน/SKU — อยู่ใน free tier (Essentials 10k/เดือน/SKU) สบายๆ.
// อย่าลด interval ต่ำกว่านี้โดยไม่คิดโควตา
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const { browserKeyVerdict } = require("./health-check-browser-key");
const { riderStanding, STANDING } = require("./actor");
const { summarizeRiderPushCoverage } = require("./rider-push-coverage");
const { ssoRegistrationState, SSO_REGISTER_DAYS } = require("./hr-compliance");

const REGION = "asia-southeast1";
const HEALTH_PATH = "system_health";
const RUN_ROLES = ["CEO", "MANAGER"];

// จุดอ้างอิงกลางกรุงเทพ (อนุสาวรีย์ชัยฯ / สยาม) ใช้เป็น input มาตรฐานของ
// probe ระยะทาง — พิกัดคงที่เพื่อให้ latency/ผลลัพธ์เทียบกันข้ามรอบได้
const PROBE_ORIGIN = { lat: 13.7649, lng: 100.5383 };
const PROBE_DEST = { lat: 13.7462, lng: 100.5347 };

// SickW balance ต่ำกว่านี้ = warn (หน่วย USD ตามที่ API คืน)
const SICKW_BALANCE_WARN_USD = 10;

// callable ของ repo bkk-frontend-next (project เดียวกัน region เดียวกัน) —
// ยิงตามโปรโตคอล callable ปกติ (POST {data}) แบบเดียวกับที่ landing ของ
// dealer ยิง dealerRegister. override ได้ด้วย env สำหรับกรณีย้าย region
const CUSTOMER_QUOTE_URL =
  process.env.HEALTH_CUSTOMER_QUOTE_URL ||
  "https://asia-southeast1-bkk-apple-tradein.cloudfunctions.net/quotePickupServiceability";

// Referer ที่แนบไปกับ probe `browser_maps_key` — คีย์ฝั่งเบราว์เซอร์ถูกล็อก
// HTTP referrer ไว้กับโดเมนเว็บลูกค้า ยิงจาก Cloud Function เปล่าๆ จะโดน
// ปฏิเสธเสมอไม่ว่าคีย์จะดีหรือพัง จึงต้องแนบ origin ของเว็บไปเหมือนที่
// เบราว์เซอร์ทำ. ค่า default มาจาก CUSTOMER_TRACKING_BASE_URL (ตั้งอยู่แล้ว)
// override ได้ด้วย HEALTH_BROWSER_REFERER ถ้าคีย์ล็อกไว้กับโดเมนอื่น
function refererFromEnv() {
  const explicit = process.env.HEALTH_BROWSER_REFERER;
  if (explicit) return explicit;
  try {
    const u = new URL(process.env.CUSTOMER_TRACKING_BASE_URL || "");
    return `${u.origin}/`;
  } catch {
    return "https://www.bkkapple.com/";
  }
}
const BROWSER_PROBE_REFERER = refererFromEnv();

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** fetch พร้อม timeout — probe ห้ามแขวนทั้งรอบเพราะ service เดียวหน่วง */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** ห่อ probe หนึ่งตัว: จับเวลา + แปลง exception เป็น status fail เสมอ */
/** ยิง probe หนึ่งครั้ง — แปลง exception เป็น status fail เสมอ */
async function attemptProbe(def) {
  const startedAt = Date.now();
  try {
    const result = await def.run();
    return {
      id: def.id,
      label: def.label,
      status: result.status,
      message: result.message || "",
      meta: result.meta || null,
      latency_ms: Date.now() - startedAt,
    };
  } catch (e) {
    const isTimeout = e && e.name === "AbortError";
    return {
      id: def.id,
      label: def.label,
      status: "fail",
      message: isTimeout ? "timeout (เกิน 10 วินาที)" : String((e && e.message) || e).slice(0, 300),
      meta: null,
      latency_ms: Date.now() - startedAt,
    };
  }
}

/**
 * ห่อ probe: ถ้าครั้งแรก fail ให้ลองซ้ำอีกครั้งก่อนตัดสิน
 *
 * เน็ตจาก Cloud Function ไป API ภายนอกกระตุกเป็นเรื่องปกติ และการปลุกทั้งทีม
 * เพราะ timeout ครั้งเดียวคือทางลัดไปสู่ปัญหาที่แย่กว่าเดิม — พอเตือนหมาป่าบ่อย
 * คนจะเลิกอ่าน แล้วตอนพังจริงจะไม่มีใครสนใจ (เคสจริง 5 ส.ค. 2026: Telegram
 * probe timeout แล้วแจ้งเตือน ทั้งที่ข้อความแจ้งเตือนนั้นส่งผ่าน Telegram
 * สำเร็จในวินาทีถัดมา = ใช้งานได้ปกติมาตลอด)
 *
 * ลองซ้ำในรอบเดียวกันแทนการรอรอบหน้า เพราะของที่พังจริงต้องเตือนทันที
 * ไม่ใช่รออีกชั่วโมง — เสียเวลาเพิ่มแค่ตอนที่มีอะไรผิดปกติจริงเท่านั้น
 */
async function runProbe(def) {
  const first = await attemptProbe(def);
  if (first.status !== "fail") return first;

  await new Promise((r) => setTimeout(r, 2000));
  const second = await attemptProbe(def);
  if (second.status !== "fail") {
    console.log(`[health-check] ${def.id}: ครั้งแรกล้มเหลว (${first.message}) แต่ลองซ้ำแล้วผ่าน — ถือว่าปกติ`);
    return { ...second, message: `${second.message} (ครั้งแรกไม่ผ่าน ลองซ้ำแล้วปกติ)` };
  }
  return second;
}

// ─── Probes ──────────────────────────────────────────────────────────────────

function buildProbes(db) {
  return [
    {
      id: "rtdb",
      label: "Firebase Realtime Database",
      run: async () => {
        const probeRef = db.ref(`${HEALTH_PATH}/probe`);
        const stamp = Date.now();
        await probeRef.set(stamp);
        const snap = await probeRef.once("value");
        if (snap.val() !== stamp) {
          return { status: "fail", message: "เขียนแล้วอ่านกลับไม่ตรง" };
        }
        return { status: "ok", message: "อ่าน/เขียนปกติ" };
      },
    },

    {
      id: "checkout_config",
      label: "ข้อมูลสาขา + โซนค่าส่ง (checkout ลูกค้า)",
      // ตัวจับบั๊ก "กำลังคำนวณ..." โดยตรง: เว็บลูกค้าคิดค่าไรเดอร์จาก
      // ระยะทางถึงสาขา active ที่ใกล้สุด — ถ้าไม่มีสาขา active หรือพิกัด
      // สาขาไม่ใช่ตัวเลข ฝั่งเว็บจะไม่มีจุดตั้งต้นให้คิดระยะทางและค้าง
      // สถานะคำนวณตลอดกาล (bkk-frontend-next useDeliveryManager)
      run: async () => {
        const [branchesSnap, pricingSnap] = await Promise.all([
          db.ref("settings/branches").once("value"),
          db.ref("settings/store/delivery_pricing").once("value"),
        ]);
        const branches = branchesSnap.val() || {};
        const entries = Object.entries(branches);
        const active = entries.filter(([, b]) => b && b.isActive);
        if (active.length === 0) {
          return {
            status: "fail",
            message: `ไม่มีสาขา active เลย (ทั้งหมด ${entries.length} สาขา) — เว็บลูกค้าคำนวณค่าไรเดอร์ไม่ได้`,
          };
        }
        const badCoords = active
          .filter(([, b]) => !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng)))
          .map(([id, b]) => (b && b.name) || id);
        if (badCoords.length > 0) {
          return {
            status: badCoords.length === active.length ? "fail" : "warn",
            message: `สาขาพิกัดไม่ถูกต้อง: ${badCoords.join(", ")} — แก้ได้ที่ /admin/branches`,
          };
        }
        const pricing = pricingSnap.val();
        const zones = pricing && Array.isArray(pricing.zones) ? pricing.zones : null;
        if (pricing && zones && zones.length === 0) {
          return { status: "fail", message: "delivery_pricing มี zones ว่าง — ทุกจังหวัดจะกลายเป็นนอกเขตบริการ" };
        }
        return {
          status: "ok",
          message: `สาขา active ${active.length} สาขา พิกัดครบ, โซนค่าส่ง ${zones ? zones.length : "default"} โซน`,
        };
      },
    },

    {
      id: "routes_api",
      label: "Google Routes API (ระยะทางคิดค่าไรเดอร์)",
      // API เดียวกับ computeRiderFee (repo นี้) และ drivingDistanceKm
      // (repo bkk-frontend-next) — คีย์ตายทั้งคู่จะเห็นที่นี่ก่อนงานพัง
      run: async () => {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey) return { status: "skip", message: "GOOGLE_MAPS_API_KEY ไม่ได้ตั้ง" };
        const res = await fetchWithTimeout(
          "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,condition",
            },
            body: JSON.stringify({
              origins: [{ waypoint: { location: { latLng: { latitude: PROBE_ORIGIN.lat, longitude: PROBE_ORIGIN.lng } } } }],
              destinations: [{ waypoint: { location: { latLng: { latitude: PROBE_DEST.lat, longitude: PROBE_DEST.lng } } } }],
              travelMode: "DRIVE",
            }),
          }
        );
        if (!res.ok) {
          return { status: "fail", message: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
        }
        const data = await res.json();
        const el = Array.isArray(data) ? data[0] : null;
        if (!el || el.condition !== "ROUTE_EXISTS" || !(el.distanceMeters > 0)) {
          return { status: "fail", message: `ตอบกลับไม่มีเส้นทาง: ${JSON.stringify(data).slice(0, 200)}` };
        }
        return { status: "ok", message: `เส้นทางทดสอบ ${(el.distanceMeters / 1000).toFixed(1)} กม.` };
      },
    },

    {
      id: "geocoding_api",
      label: "Google Geocoding API (แปลงพิกัด↔ที่อยู่)",
      run: async () => {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey) return { status: "skip", message: "GOOGLE_MAPS_API_KEY ไม่ได้ตั้ง" };
        const url =
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${PROBE_ORIGIN.lat},${PROBE_ORIGIN.lng}` +
          `&language=th&region=th&key=${encodeURIComponent(apiKey)}`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) return { status: "fail", message: `HTTP ${res.status}` };
        const data = await res.json();
        if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
          return { status: "fail", message: `status=${data.status} ${String(data.error_message || "").slice(0, 150)}` };
        }
        return { status: "ok", message: "reverse geocode ปกติ" };
      },
    },

    {
      id: "customer_quote",
      label: "ประเมินค่าเข้ารับฝั่งลูกค้า (end-to-end)",
      // ยิง quotePickupServiceability (functions ของ bkk-frontend-next) ด้วย
      // พิกัดกลางกรุงเทพ + hint ชื่อจังหวัด — ต้องได้ in_service + pickup_fee
      // ครอบคลุม: functions ฝั่งลูกค้า deploy อยู่, zone config, ตาราง
      // จังหวัด, และ (เมื่อคีย์ Maps ฝั่งนั้นทำงาน) ระยะทางขับจริง
      run: async () => {
        const res = await fetchWithTimeout(
          CUSTOMER_QUOTE_URL,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: { lat: PROBE_ORIGIN.lat, lng: PROBE_ORIGIN.lng, province_name: "กรุงเทพมหานคร" },
            }),
          },
          15000
        );
        if (!res.ok) {
          return { status: "fail", message: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
        }
        const body = await res.json();
        const q = body && body.result;
        if (!q) return { status: "fail", message: "ไม่มี result ในคำตอบ callable" };
        if (!q.in_service || !(q.pickup_fee > 0 || q.pickup_fee === 0)) {
          return {
            status: "fail",
            message: `พิกัดกลางกรุงเทพไม่ serviceable: in_service=${q.in_service} fee=${q.pickup_fee}`,
            meta: q,
          };
        }
        // ระยะทางเส้นตรง = คีย์ Maps ฝั่ง frontend functions ไม่ทำงาน —
        // ระบบยังตอบได้แต่แม่นน้อยลง จึงเป็น warn ไม่ใช่ fail
        if (!q.distance_is_driving) {
          return {
            status: "warn",
            message: `ตอบได้ (ค่าบริการ ฿${q.pickup_fee}) แต่ใช้ระยะเส้นตรง — เช็ค GOOGLE_MAPS_API_KEY ของ bkk-frontend-next`,
            meta: { distance_km: q.distance_km },
          };
        }
        return {
          status: "ok",
          message: `กรุงเทพ serviceable, ค่าบริการ ฿${q.pickup_fee} (${q.distance_km} กม. ขับจริง)`,
        };
      },
    },

    {
      id: "browser_maps_key",
      label: "คีย์ Maps ฝั่งเบราว์เซอร์ (checkout ลูกค้าจริง)",
      // ปิดช่องที่ `customer_quote` มองไม่เห็น: probe นั้นส่งชื่อจังหวัดไปเป็น
      // hint เอง จึงไม่เคยผ่านขั้น "เบราว์เซอร์ reverse geocode หาจังหวัด" ซึ่ง
      // เป็นขั้นที่ไม่มี fallback และล้มจริงตอน billing ค้าง (4 ก.ย. 2569) ส่วน
      // `geocoding_api`/`routes_api` ใช้คีย์ server คนละใบกับที่เบราว์เซอร์ถือ.
      // ตัวนี้ยิง Geocoding + Routes ด้วย "คีย์เบราว์เซอร์ + Referer ของเว็บ"
      // ให้เหมือนที่ useDeliveryManager/thaiPostal.ts ทำจริง แล้วให้
      // browserKeyVerdict (pure, มีเทส) ตัดสิน — geocode ล้ม = fail เพราะ
      // ลูกค้าเลือกวิธีรับเครื่องไม่ได้, Routes ล้มอย่างเดียว = warn เพราะมี
      // haversine รองรับ
      run: async () => {
        const key = process.env.GOOGLE_MAPS_BROWSER_KEY;
        if (!key) {
          return {
            status: "skip",
            message: "GOOGLE_MAPS_BROWSER_KEY ไม่ได้ตั้ง (ค่าเดียวกับ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY บน Vercel)",
          };
        }
        const referer = { Referer: BROWSER_PROBE_REFERER };
        const [geoRes, routesRes] = await Promise.all([
          fetchWithTimeout(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${PROBE_ORIGIN.lat},${PROBE_ORIGIN.lng}` +
              `&language=th&region=th&key=${encodeURIComponent(key)}`,
            { headers: referer }
          ),
          fetchWithTimeout("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
            method: "POST",
            headers: {
              ...referer,
              "Content-Type": "application/json",
              "X-Goog-Api-Key": key,
              "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,condition",
            },
            body: JSON.stringify({
              origins: [{ waypoint: { location: { latLng: { latitude: PROBE_ORIGIN.lat, longitude: PROBE_ORIGIN.lng } } } }],
              destinations: [{ waypoint: { location: { latLng: { latitude: PROBE_DEST.lat, longitude: PROBE_DEST.lng } } } }],
              travelMode: "DRIVE",
            }),
          }),
        ]);
        return browserKeyVerdict({
          geocode: { httpStatus: geoRes.status, body: await safeJson(geoRes) },
          routes: { httpStatus: routesRes.status, body: await safeJson(routesRes) },
        });
      },
    },

    {
      id: "sickw",
      label: "SickW API (ตรวจ IMEI/Serial)",
      run: async () => {
        const apiKey = process.env.SICKW_API_KEY;
        if (!apiKey) return { status: "skip", message: "SICKW_API_KEY ไม่ได้ตั้ง" };
        // action=balance ฟรี ไม่กินเครดิต (แบบเดียวกับ getSickwBalance)
        const res = await fetchWithTimeout(
          `https://sickw.com/api.php?action=balance&key=${encodeURIComponent(apiKey)}`
        );
        const text = (await res.text()).trim();
        let balance = Number(text);
        if (!Number.isFinite(balance)) {
          try {
            const parsed = JSON.parse(text);
            balance = Number(parsed.balance || parsed.result);
          } catch {
            return { status: "fail", message: `ตอบกลับไม่เข้าใจ: ${text.slice(0, 120)}` };
          }
        }
        if (!Number.isFinite(balance)) {
          return { status: "fail", message: `ตอบกลับไม่เข้าใจ: ${text.slice(0, 120)}` };
        }
        if (balance < SICKW_BALANCE_WARN_USD) {
          return { status: "warn", message: `เครดิตเหลือ $${balance.toFixed(2)} — ใกล้หมด เติมก่อนตรวจเครื่องไม่ได้`, meta: { balance } };
        }
        return { status: "ok", message: `เครดิตเหลือ $${balance.toFixed(2)}`, meta: { balance } };
      },
    },

    {
      id: "resend",
      label: "Resend (อีเมลลูกค้า/เอกสาร)",
      run: async () => {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return { status: "skip", message: "RESEND_API_KEY ไม่ได้ตั้ง" };
        const res = await fetchWithTimeout("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.status === 401 || res.status === 403) {
          return { status: "fail", message: `API key ใช้ไม่ได้ (HTTP ${res.status})` };
        }
        if (!res.ok) return { status: "fail", message: `HTTP ${res.status}` };
        const data = await res.json();
        const domains = Array.isArray(data && data.data) ? data.data : [];
        const unverified = domains.filter((d) => d.status !== "verified").map((d) => d.name);
        if (domains.length === 0) {
          return { status: "warn", message: "key ใช้ได้ แต่ยังไม่มีโดเมนใน Resend — อีเมลจะเข้า spam/ถูก reject" };
        }
        if (unverified.length > 0) {
          return { status: "warn", message: `โดเมนยังไม่ verify: ${unverified.join(", ")}` };
        }
        return { status: "ok", message: `โดเมน verify ครบ ${domains.length} โดเมน` };
      },
    },

    {
      id: "telegram",
      label: "Telegram Bot (แจ้งเตือนทีม)",
      run: async () => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token || !process.env.TELEGRAM_CHAT_ID) {
          return { status: "skip", message: "TELEGRAM_BOT_TOKEN/CHAT_ID ไม่ได้ตั้ง" };
        }
        // getMe ฟรี ไม่ส่งข้อความจริง — แค่พิสูจน์ว่า token ยังใช้ได้
        const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok !== true) {
          return { status: "fail", message: `HTTP ${res.status} — token อาจถูก revoke` };
        }
        return { status: "ok", message: `bot @${(data.result && data.result.username) || "?"} ปกติ` };
      },
    },

    {
      id: "thailand_post",
      label: "Thailand Post (ติดตามพัสดุ Mail-in)",
      run: async () => {
        const apiKey = process.env.THAILAND_POST_API_KEY;
        if (!apiKey) return { status: "skip", message: "THAILAND_POST_API_KEY ไม่ได้ตั้ง" };
        // ขอ token อย่างเดียว (ฟรี) — เส้นทางเดียวกับ fetchThaiPostTracking
        const res = await fetchWithTimeout(
          "https://trackapi.thailandpost.co.th/post/security/getToken?grant_type=client_credentials",
          { method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" } }
        );
        if (!res.ok) return { status: "fail", message: `getToken HTTP ${res.status} — key อาจหมดอายุ` };
        const data = await res.json().catch(() => null);
        if (!data || !data.token) return { status: "fail", message: "getToken ไม่คืน token" };
        return { status: "ok", message: "ขอ token สำเร็จ" };
      },
    },

    {
      id: "order_reconciliation",
      label: "กระทบยอดคำสั่งขาย (กดยืนยัน vs ออเดอร์จริง)",
      // ตัวเดียวในชุดนี้ที่ไม่ได้ตรวจ "ของข้างนอกยังใช้ได้ไหม" แต่ตรวจว่า
      // **ลูกค้าที่ตั้งใจขายได้ขายจริงหรือเปล่า** — คนที่กดปุ่มยืนยันแล้ว
      // ต้องจบที่ปลายทางใดปลายทางหนึ่งเสมอ: ได้ออเดอร์ / เห็นข้อความว่า
      // ฟอร์มไม่ครบ / เห็น error. ถ้าไม่มีอะไรตามมาเลย = ลูกค้ากดแล้วระบบ
      // เงียบ ซึ่งฝั่ง server มองไม่เห็นเลยเพราะไม่มี request ส่งมาถึง
      //
      // ก่อนมีตัวนี้ ตัวเลขนั้นดูได้ที่หน้า analytics อย่างเดียว = ต้องมีคน
      // เปิดไปดูเอง ถ้าไม่มีใครเปิด 3 วัน ออเดอร์ที่หายก็นอนอยู่เฉยๆ
      //
      // หน้าต่างเวลาเป็นแบบหน่วง (3 ชม.ที่แล้ว → 30 นาทีที่แล้ว) เพราะคนที่
      // เพิ่งกดเมื่อกี้อาจยังทำรายการอยู่ ไม่ใช่หายไป. ยิง query ตาม index
      // `timestamp` ไม่กวาดทั้ง node (กฎ RTDB cost)
      //
      // **หน้าต่างของ "การกด" กับ "ปลายทาง" ไม่เท่ากันโดยตั้งใจ**: การกดนับ
      // เฉพาะ [from, to] แต่ปลายทางรับถึง now — ไม่งั้นคนที่กดจ่อขอบ `to`
      // แล้วสำเร็จอีก 3 วินาทีถัดมา (ซึ่งเลย `to` ไปแล้ว) จะถูกนับว่าเงียบ
      // ทั้งที่ได้ออเดอร์เรียบร้อย = เตือนหมาป่าจากเส้นแบ่งเวลาล้วนๆ
      run: async () => {
        const now = Date.now();
        const from = now - 3 * 60 * 60 * 1000;
        const to = now - 30 * 60 * 1000;

        const snap = await db
          .ref("assessment_events")
          .orderByChild("timestamp")
          .startAt(from)
          .once("value");

        const attempt = new Set();
        const resolved = new Set();
        snap.forEach((c) => {
          const e = c.val();
          if (!e || !e.uid) return;
          if (e.event === "checkout_submit_attempt") {
            if (e.timestamp <= to) attempt.add(e.uid);
          } else if (
            e.event === "order_completed" ||
            e.event === "checkout_submit_blocked" ||
            e.event === "checkout_submit_error"
          ) {
            resolved.add(e.uid);
          }
        });

        if (attempt.size === 0) {
          return { status: "ok", message: "ไม่มีการกดยืนยันในช่วง 3 ชม.ที่ผ่านมา" };
        }

        let silent = [...attempt].filter((uid) => !resolved.has(uid));

        // ปลายทางทั้งสามตัวถูกเขียนโดย "เบราว์เซอร์ลูกค้า" — ถ้าออเดอร์ถูก
        // สร้างสำเร็จฝั่ง server แต่แท็บถูกปิดก่อน event จะไปถึง เราจะเห็นเป็น
        // เงียบทั้งที่ของอยู่ในระบบแล้ว. ก่อนจะเตือนจึงถาม **ความจริงฝั่ง
        // server** ก่อนเสมอ: มีงานของ uid นี้เกิดในหน้าต่างเดียวกันไหม
        // (query ตาม index `uid` ของ /jobs — ไม่กวาดทั้ง node) และยิงเฉพาะ
        // uid ที่ยังน่าสงสัยซึ่งปกติมีศูนย์ถึงหยิบมือ จำกัดเพดานกันเคสผิดปกติ
        const MAX_JOB_LOOKUPS = 20;
        let lostEvent = 0;
        if (silent.length > 0 && silent.length <= MAX_JOB_LOOKUPS) {
          const checks = await Promise.all(
            silent.map(async (uid) => {
              try {
                const jobs = await db
                  .ref("jobs")
                  .orderByChild("uid")
                  .equalTo(uid)
                  .once("value");
                let landed = false;
                jobs.forEach((j) => {
                  const created = j.val() && j.val().created_at;
                  if (typeof created === "number" && created >= from) landed = true;
                });
                return { uid, landed };
              } catch (err) {
                // อ่านไม่ได้ = ไม่ยืนยันว่าปลอดภัย ให้คงสถานะน่าสงสัยไว้
                console.error("order_reconciliation job lookup failed", err);
                return { uid, landed: false };
              }
            }),
          );
          lostEvent = checks.filter((c) => c.landed).length;
          silent = checks.filter((c) => !c.landed).map((c) => c.uid);
        }

        if (silent.length === 0) {
          return {
            status: "ok",
            message:
              `กดยืนยัน ${attempt.size} คน ได้ออเดอร์ครบทุกคน` +
              (lostEvent > 0 ? ` (${lostEvent} คนออเดอร์เข้าแต่ event ตกหล่น)` : ""),
            meta: { attempts: attempt.size, lost_event: lostEvent },
          };
        }
        // ไม่ใส่เบอร์/ชื่อลูกค้าลงข้อความแจ้งเตือนโดยตั้งใจ (PDPA) — ให้ไปดู
        // รายละเอียดที่หน้า Session Monitor ซึ่ง gate ด้วยสิทธิ์แอดมินอยู่แล้ว
        return {
          status: "fail",
          message:
            `มี ${silent.length} คนกดยืนยันแล้วไม่มีออเดอร์เกิดขึ้นจริง ` +
            `(จากทั้งหมด ${attempt.size} คน) — ดูรายชื่อ+เบอร์ติดต่อกลับที่หน้า ` +
            "Session Monitor ของเว็บลูกค้า (/admin/sessions) กรองสถานะ \"กดยืนยันแล้วเงียบ\"",
          meta: { attempts: attempt.size, silent: silent.length, lost_event: lostEvent },
        };
      },
    },

    {
      id: "rider_push_tokens",
      label: "Rider push — ไรเดอร์ที่อนุมัติแล้วยังรับ push ได้ไหม",
      // ตัวจับ "ไรเดอร์ที่อนุมัติแล้วแต่ push ไปไม่ถึงเลย" — ความพังที่เงียบเพราะ
      // ไม่มี request ไหนล้ม: pushToRider/sendToRider ตัด token ที่ FCM ปฏิเสธ
      // ทิ้งทันทีโดยไม่บันทึกที่ไหน และ token ต่ออายุได้เฉพาะตอนไรเดอร์เปิดแอป
      // งานนานๆ ที = ไม่มีเหตุให้เปิดแอป = token ตาย = ไม่มี push = ไม่มีเหตุให้เปิดแอป
      // (bkk-rider-app/docs/reports/2026-09-03-rider-push-delivery-survey.md ข้อ E/H)
      //
      // ถามผลลัพธ์ ไม่ถาม config: มี token ที่เขียนไว้ไม่เกิน 7 วันไหม (เกณฑ์เดียวกับ
      // การ์ดในแอปไรเดอร์). อ่าน /riders ทั้งโหนดได้เพราะมีไม่กี่แถว (ไม่ใช่ /jobs)
      //
      // warn ไม่ใช่ fail — ไรเดอร์ที่ไม่มี token อาจแค่ยังไม่เปิดแอปหลังติดตั้งใหม่
      // ให้โผล่บนหน้า /system-health พร้อมชื่อ ไม่ต้อง push/Telegram ทุกชั่วโมง
      run: async () => {
        const snap = await db.ref("riders").once("value");
        if (!snap.exists()) return { status: "ok", message: "ยังไม่มีไรเดอร์ในระบบ" };
        const approved = [];
        snap.forEach((child) => {
          const rider = child.val() || {};
          if (riderStanding(rider) !== STANDING.ACTIVE) return;
          approved.push({ id: child.key, name: rider.name, rider });
        });
        if (approved.length === 0) return { status: "ok", message: "ไม่มีไรเดอร์ที่อนุมัติแล้ว" };
        const c = summarizeRiderPushCoverage(approved, Date.now());
        const meta = { total: c.total, ok: c.ok, stale: c.stale, none: c.none };
        if (c.none.length > 0) {
          return {
            status: "warn",
            message:
              `${c.none.length}/${c.total} คน ไม่มี token — push ไปไม่ถึง: ${c.none.join(", ")}` +
              (c.stale.length ? ` · ไม่ได้ต่ออายุเกิน 7 วัน: ${c.stale.join(", ")}` : "") +
              " (ให้ไรเดอร์เปิดแอป → โปรไฟล์ → ลองใหม่)",
            meta,
          };
        }
        if (c.stale.length > 0) {
          return {
            status: "warn",
            message: `${c.stale.length}/${c.total} คน ไม่ได้ต่ออายุ token เกิน 7 วัน: ${c.stale.join(", ")} — อาจตายแล้วโดยไม่รู้จนกว่าจะส่งจริง`,
            meta,
          };
        }
        return { status: "ok", message: `รับ push ได้ครบ ${c.ok}/${c.total} คน`, meta };
      },
    },
    {
      id: "search_analytics_ttl",
      label: "Search Analytics — อายุข้อมูลตาม retention",
      // ตัวจับ "TTL policy หายไป" ซึ่งเป็นความพังที่เงียบที่สุดในระบบนี้
      //
      // ตาราง search_events (Firestore, เว็บลูกค้าเขียน) ต้องหายเองใน 90 วัน
      // ตามที่เขียนไว้ในนโยบายความเป็นส่วนตัวและ RoPA. **แต่ตัวลบไม่ได้อยู่ใน
      // โค้ดของ repo ไหนเลย** — โค้ดแค่ประทับฟิลด์ `expires_at` ส่วนตัวที่ลบ
      // จริงคือ TTL policy ที่ตั้งใน Google Cloud ต่อ collection. ถ้าไม่ได้ตั้ง
      // (หรือถูกลบทีหลัง) ทุก write ยังสำเร็จ ไม่มี error ไม่มีอะไรเตือน
      // แถวก็แค่ไม่หายไปไหน แล้วกลายเป็นทะเบียนคำค้นถาวรที่ไม่มีใครตั้งใจสร้าง
      // และขัดกับสิ่งที่เราประกาศกับลูกค้าไว้ — ซึ่งเป็นปัญหา PDPA ไม่ใช่
      // ปัญหาพื้นที่เก็บข้อมูล
      //
      // วิธีตรวจคือถามคำถามที่ตรงกับผลลัพธ์ที่ต้องการจริงๆ: เอกสารที่เก่าที่สุด
      // อายุเท่าไหร่ ถ้ามันเกินเพดาน แปลว่าไม่มีอะไรมาลบมันอยู่ — ตรวจผลลัพธ์
      // ไม่ใช่ตรวจว่า config ถูกตั้งไว้ไหม เพราะ config ที่ตั้งไว้แต่ไม่ทำงาน
      // ก็ยังอ่านว่าตั้งแล้วอยู่ดี
      run: async () => {
        let store;
        try {
          store = require("firebase-admin/firestore").getFirestore();
        } catch (e) {
          return { status: "skip", message: "ยังไม่ได้เปิดใช้ Firestore" };
        }
        let snap;
        try {
          snap = await store.collection("search_events").orderBy("at", "asc").limit(1).get();
        } catch (e) {
          // ยังไม่ได้สร้าง database / ยังไม่มี index / ไม่มีสิทธิ์ — ทั้งหมด
          // แปลว่า "ยังวัดไม่ได้" ไม่ใช่ "พัง" ตาม convention env-not-set
          return { status: "skip", message: `อ่าน Firestore ไม่ได้: ${e.message}` };
        }
        if (snap.empty) {
          return { status: "ok", message: "ยังไม่มีข้อมูล (ฟีเจอร์อาจยังปิดอยู่)" };
        }
        const oldestAt = Number(snap.docs[0].get("at")) || 0;
        if (!oldestAt) return { status: "skip", message: "เอกสารเก่าสุดไม่มีฟิลด์ at" };
        const ageDays = Math.floor((Date.now() - oldestAt) / 86400000);
        // เผื่อ 7 วัน: TTL ของ Firestore เป็น best-effort ลบภายใน 24 ชม.
        // หลังหมดอายุ "โดยทั่วไป" ไม่ใช่ตรงเป๊ะ — เตือนตั้งแต่ช้าไปวันเดียว
        // คือเตือนหมาป่า ซึ่งเป็นบทเรียนเดียวกับ probe ที่ retry ก่อนตัดสิน
        const RETENTION_DAYS = 90;
        const GRACE_DAYS = 7;
        if (ageDays > RETENTION_DAYS + GRACE_DAYS) {
          return {
            status: "fail",
            message:
              `เอกสารเก่าสุดอายุ ${ageDays} วัน เกินเพดาน ${RETENTION_DAYS} วัน — ` +
              "TTL policy น่าจะไม่ได้ตั้งหรือถูกลบ (gcloud firestore fields ttls update " +
              "expires_at --collection-group=search_events --enable-ttl)",
          };
        }
        return { status: "ok", message: `เอกสารเก่าสุดอายุ ${ageDays} วัน (เพดาน ${RETENTION_DAYS})` };
      },
    },

    {
      id: "sso_registration",
      label: "ขึ้นทะเบียนประกันสังคมพนักงานใหม่",
      // **ตัวจับกำหนดที่ไม่มีใครนั่งนับให้** — ม.34 พ.ร.บ.ประกันสังคม กำหนดให้
      // นายจ้างยื่นขึ้นทะเบียนผู้ประกันตนภายใน 30 วันนับแต่วันที่ลูกจ้างเข้าทำงาน
      // เลยกำหนดแล้วมีเบี้ยปรับ และไม่มีอะไรในระบบส่งเสียงเลย: รอบจ่ายเงินเดือน
      // หักเงินสมทบได้ตามปกติทั้งที่ยังไม่ขึ้นทะเบียน = เงินถูกหักจากลูกจ้างไว้
      // แต่เขายังไม่มีสิทธิ์ใช้
      //
      // ตระกูลเดียวกับ `search_analytics_ttl`: ตรวจ **ผลลัพธ์** (มีใครเลย
      // กำหนดไหม) ไม่ใช่ตรวจว่ามีใครตั้งเตือนไว้หรือยัง
      //
      // **ไม่ใส่ชื่อคนลงข้อความแจ้งเตือน** — ใช้รหัสพนักงานแทน (กฎเดียวกับ
      // `order_reconciliation` ที่ไม่ใส่ชื่อ/เบอร์ลูกค้า) รายละเอียดดูที่หน้า
      // ทะเบียนพนักงานซึ่ง gate สิทธิ์ไว้แล้ว
      run: async () => {
        const [empSnap, privSnap] = await Promise.all([
          db.ref("employees").once("value"),
          db.ref("employees_private").once("value"),
        ]);
        const employees = empSnap.val() || {};
        const privs = privSnap.val() || {};
        if (!Object.keys(employees).length) {
          return { status: "skip", message: "ยังไม่มีพนักงานในทะเบียน" };
        }

        const now = Date.now();
        const overdue = [];
        const dueSoon = [];
        const unknown = [];
        for (const [id, e] of Object.entries(employees)) {
          const st = ssoRegistrationState({ employee: { id, ...(e || {}) }, priv: privs[id] || {}, now });
          const code = (e && e.employee_code) || id;
          if (st.state === "overdue") overdue.push(`${code} (เกิน ${Math.abs(st.daysLeft)} วัน)`);
          else if (st.state === "due_soon") dueSoon.push(`${code} (เหลือ ${st.daysLeft} วัน)`);
          else if (st.state === "unknown") unknown.push(code);
        }

        const brief = (list) => list.slice(0, 5).join(" · ") + (list.length > 5 ? ` และอีก ${list.length - 5} คน` : "");
        if (overdue.length) {
          return {
            status: "fail",
            message: `เลยกำหนดยื่น สปส.1-03 (${SSO_REGISTER_DAYS} วัน) แล้ว ${overdue.length} คน: ${brief(overdue)}`,
            meta: { overdue: overdue.length, due_soon: dueSoon.length, unknown: unknown.length },
          };
        }
        if (dueSoon.length || unknown.length) {
          const parts = [];
          if (dueSoon.length) parts.push(`ใกล้ครบกำหนด ${dueSoon.length} คน: ${brief(dueSoon)}`);
          // ไม่มีวันเริ่มงาน = คำนวณกำหนดไม่ได้ **ไม่ใช่ว่าไม่มีปัญหา** — คนคนนั้น
          // อาจเข้าทำงานมาแล้วครึ่งปี การเงียบให้เขาคือการเดาไปทางที่สบายกว่า
          if (unknown.length) parts.push(`ไม่มีวันเริ่มงานให้คำนวณกำหนด ${unknown.length} คน: ${brief(unknown)}`);
          return {
            status: "warn",
            message: parts.join(" · "),
            meta: { overdue: 0, due_soon: dueSoon.length, unknown: unknown.length },
          };
        }
        return { status: "ok", message: "ทุกคนขึ้นทะเบียนแล้ว หรือยังอยู่ในกำหนด" };
      },
    },

    {
      id: "anthropic",
      label: "Anthropic API (Chat AI)",
      run: async () => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return { status: "skip", message: "ANTHROPIC_API_KEY ไม่ได้ตั้ง" };
        // list models ฟรี ไม่กิน token — พิสูจน์ key + connectivity
        const res = await fetchWithTimeout("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        });
        if (res.status === 401) return { status: "fail", message: "API key ใช้ไม่ได้ (401)" };
        if (!res.ok) return { status: "fail", message: `HTTP ${res.status}` };
        return { status: "ok", message: "key ใช้ได้" };
      },
    },
  ];
}

// ─── Run + persist + alert ───────────────────────────────────────────────────

const STATUS_RANK = { ok: 0, skip: 0, warn: 1, fail: 2 };

/**
 * รัน probe ทุกตัวพร้อมกัน เขียนผลลง system_health และแจ้งเตือนเมื่อ
 * สถานะ "เปลี่ยน" เป็น fail (หรือหายจาก fail → ok) เท่านั้น — รันซ้ำ
 * ตอนยังพังอยู่จะไม่สแปมซ้ำทุกชั่วโมง
 */
async function runAllChecks(db, { dispatchAdminPush, dispatchTelegram }, ranBy) {
  const [prevSnap, togglesSnap] = await Promise.all([
    db.ref(`${HEALTH_PATH}/services`).once("value"),
    // สวิตช์เปิด/ปิดการตรวจรายตัว (ตั้งจากหน้า /system-health) — อยู่ใต้
    // `settings` จึงใช้ rule เดิม (read auth / write admin) ไม่ต้อง deploy
    // rules. fail-open ตามธรรมเนียม: มีแต่ `enabled === false` ชัดๆ เท่านั้น
    // ที่ปิด ใช้ mute service ที่รู้อยู่แล้วว่าพังเพราะรอฝั่งภายนอกแก้
    // (เช่น Thailand Post รอ activate บัญชี) ไม่ให้ค้างแดง/สแปมแจ้งเตือน
    db.ref("settings/health_checks").once("value"),
  ]);
  const prev = prevSnap.val() || {};
  const toggles = togglesSnap.val() || {};

  const results = await Promise.all(
    buildProbes(db).map((def) =>
      toggles[def.id] && toggles[def.id].enabled === false
        ? Promise.resolve({
            id: def.id,
            label: def.label,
            status: "skip",
            message: "ปิดการตรวจไว้ (เปิดได้จากหน้า System Health)",
            meta: null,
            latency_ms: 0,
          })
        : runProbe(def)
    )
  );
  const now = Date.now();

  const services = {};
  const newlyFailed = [];
  const recovered = [];
  for (const r of results) {
    const before = prev[r.id];
    const prevStatus = before && before.status;
    services[r.id] = {
      label: r.label,
      status: r.status,
      message: r.message,
      latency_ms: r.latency_ms,
      meta: r.meta,
      checked_at: now,
      last_ok_at: r.status === "ok" ? now : (before && before.last_ok_at) || null,
      last_status_change_at:
        prevStatus === r.status ? (before && before.last_status_change_at) || now : now,
    };
    if (r.status === "fail" && prevStatus && prevStatus !== "fail") newlyFailed.push(r);
    // "หายพัง" ต้องหมายถึงตรวจแล้วผ่านจริง (ok/warn) — การกดปิดการตรวจ
    // (fail → skip) ไม่ใช่การหาย อย่าส่ง Telegram บอกว่ากลับมาปกติ
    if ((r.status === "ok" || r.status === "warn") && prevStatus === "fail") recovered.push(r);
  }

  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {}
  );
  const overall = results.reduce(
    (worst, r) => (STATUS_RANK[r.status] > STATUS_RANK[worst] ? r.status : worst),
    "ok"
  );

  await db.ref(HEALTH_PATH).update({
    services,
    summary: {
      overall,
      ok: counts.ok || 0,
      warn: counts.warn || 0,
      fail: counts.fail || 0,
      skip: counts.skip || 0,
      checked_at: now,
      ran_by: ranBy,
    },
  });

  if (newlyFailed.length > 0) {
    const names = newlyFailed.map((r) => r.label).join(", ");
    const detail = newlyFailed.map((r) => `• ${r.label}: ${r.message}`).join("\n");
    try {
      await dispatchAdminPush(
        {
          notification: {
            title: `Service มีปัญหา: ${names}`,
            body: newlyFailed[0].message.slice(0, 180),
          },
          data: { type: "system_health_alert", url: "/system-health" },
        },
        "health-check"
      );
    } catch (e) {
      console.error("[health-check] push failed:", e && e.message);
    }
    try {
      await dispatchTelegram(`⚠️ System Health: ${names} ล้มเหลว\n${detail}`, "health-check");
    } catch (e) {
      console.error("[health-check] telegram failed:", e && e.message);
    }
  }
  if (recovered.length > 0) {
    const names = recovered.map((r) => r.label).join(", ");
    try {
      await dispatchTelegram(`✅ System Health: ${names} กลับมาปกติแล้ว`, "health-check");
    } catch (e) {
      console.error("[health-check] telegram failed:", e && e.message);
    }
  }

  console.log(
    `[health-check] ${ranBy}: overall=${overall} ok=${counts.ok || 0} warn=${counts.warn || 0} fail=${counts.fail || 0} skip=${counts.skip || 0}`
  );
  return { overall, results };
}

// ─── Registration (pattern เดียวกับ registerDealerPortal) ───────────────────

function registerHealthCheck({ dispatchAdminPush, dispatchTelegram }) {
  const deps = { dispatchAdminPush, dispatchTelegram };

  const systemHealthCheck = onSchedule(
    {
      // นาที 21 กันชนกับ scheduler อื่นที่เกาะต้นชั่วโมง
      schedule: "21 * * * *",
      timeZone: "Asia/Bangkok",
      region: REGION,
      timeoutSeconds: 120,
    },
    async () => {
      await runAllChecks(getDatabase(), deps, "scheduler");
    }
  );

  const adminSystemHealthRun = onCall(
    { region: REGION, timeoutSeconds: 120 },
    async (request) => {
      if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
      const db = getDatabase();
      const staff = (await lookupStaffByAuth(db, request.auth)) || {};
      const role = String(staff.role || "").toUpperCase();
      if (!RUN_ROLES.includes(role)) {
        throw new HttpsError("permission-denied", `เฉพาะ ${RUN_ROLES.join("/")} เท่านั้น`);
      }
      const { overall, results } = await runAllChecks(db, deps, staff.name || staff.id || "manual");
      return { overall, results };
    }
  );

  return { systemHealthCheck, adminSystemHealthRun };
}

module.exports = { registerHealthCheck };
