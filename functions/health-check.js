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
// ค่าใช้จ่าย probe: Routes 1 element + Geocoding 1 call + quote 1 element
// ต่อรอบ, scheduler รายชั่วโมง ≈ 2.2k calls/เดือน — อยู่ใน free tier
// (Essentials 10k/เดือน/SKU) สบายๆ. อย่าลด interval ต่ำกว่านี้โดยไม่คิดโควตา
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");

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
async function runProbe(def) {
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
  const prevSnap = await db.ref(`${HEALTH_PATH}/services`).once("value");
  const prev = prevSnap.val() || {};

  const results = await Promise.all(buildProbes(db).map(runProbe));
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
    if (r.status !== "fail" && prevStatus === "fail") recovered.push(r);
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
