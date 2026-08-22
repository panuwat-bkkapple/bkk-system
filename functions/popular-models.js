// =============================================================================
// "รุ่นที่คนขายมากที่สุด" จากยอดขายจริง — เขียน settings/sell/popular_models
//
// ป้ายบน overlay ค้นหาของ /sell (เว็บลูกค้า) อ่านลิสต์ id จาก
// `settings/sell/popular_models` และถ้าไม่มี/ไม่ครบจะ fallback เป็น
// "รุ่นใหม่สุดต่อหมวด" (pickPopularModels ใน bkk-frontend-next/app/utils/sellSuggest.ts)
// ซึ่งไม่ใช่ยอดขายจริง — ตัวนี้คือท่อที่ทำให้ป้ายพูดความจริง: สรุปจำนวนเครื่อง
// ต่อรุ่นจากงานใน /jobs ช่วง LOOKBACK_DAYS แล้วเขียนลิสต์เรียงตามยอดลงไป
//
// กติกาที่ตั้งใจ:
// - query ตาม index `created_at` (มีใน database.rules.json ของ bkk-frontend-next
//   อยู่แล้ว) ไม่กวาด /jobs ทั้ง node — ดึงเฉพาะหน้าต่าง 30 วัน (กฎค่า RTDB)
// - รันวันละครั้ง 04:45 เวลาไทย — cadence เดียวกับกลุ่ม batch ตอนเช้ามืด
//   (archive 03:00, cache GC 04:00) งบ download ต่อรอบ ~ขนาดงาน 30 วัน ซึ่ง
//   เล็กกว่าที่ autoFlagRiders (อ่านทุกงาน ทุกวัน) ใช้อยู่แล้ว
// - งานลูกค้า (validateAndCreateOrder) นับจาก devices[].model_id ตรงๆ
//   งานที่แอดมินสร้าง (CreateTicketModal/InstantSellModal) มีแต่ชื่อรุ่นใน
//   `model` — resolve กลับเป็น id ด้วย longest-prefix match กับชื่อใน /models
//   (ชื่องานอาจพ่วง variant ต่อท้าย เช่น "iPhone 15 Pro 256GB")
// - ข้าม type ลูก/ไม่ใช่การขาย: Accessory (แตกจากงานแม่), B2B-Unpacked
//   (เครื่องลูกของ lot — งานแม่ B2B นับแล้ว), Withdrawal และข้ามงาน Cancelled
// - `settings/sell/popular_models_manual === true` = แอดมินล็อกลิสต์เอง →
//   scheduler ไม่แตะ (ลบ flag เมื่อไหร่กลับมา auto รอบถัดไป)
// - ฝั่งอ่านกรอง id ที่ paused/accessory/หายจาก catalog ทิ้งและเติม fallback
//   ให้เองอยู่แล้ว จึงเขียนเผื่อถึง WRITE_LIMIT ไม่ใช่แค่ 5 ที่จอโชว์
// =============================================================================

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { logger } = require("firebase-functions");
const { lookupStaffByAuth } = require("./sickw-core");

const LOOKBACK_DAYS = 30;
const WRITE_LIMIT = 10;
const EXCLUDED_TYPES = new Set(["Accessory", "B2B-Unpacked", "Withdrawal"]);
const ADMIN_ROLES = ["CEO", "MANAGER"];

const normName = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// job.model อาจเป็นชื่อรุ่นเพียวๆ หรือชื่อรุ่น + variant ต่อท้าย — จับคู่แบบ
// "ชื่อ catalog เป็น prefix ที่จบตรงขอบคำ" และให้ชื่อยาวสุดชนะ กัน "iPhone 15"
// ไปเคลมงานของ "iPhone 15 Pro"
function resolveNameToId(jobModelNorm, catalogSorted) {
  for (const c of catalogSorted) {
    if (!c.norm) continue;
    if (
      jobModelNorm === c.norm ||
      (jobModelNorm.startsWith(c.norm) && jobModelNorm[c.norm.length] === " ")
    ) {
      return c.id;
    }
  }
  return null;
}

// นับจำนวนเครื่องต่อรุ่นจากลิสต์งาน (pure — เทสที่ test/popular-models.test.mjs)
// คืน { counts: Map<model_id, n>, nameCounts: Map<ชื่อ normalize, n>, jobsCounted }
function collectCounts(jobs, cutoff) {
  const counts = new Map();
  const nameCounts = new Map();
  let jobsCounted = 0;

  for (const job of jobs) {
    if (!job) continue;
    if (EXCLUDED_TYPES.has(job.type)) continue;
    if (job.status === "Cancelled") continue;
    // ใน RTDB ค่า string เรียงหลังตัวเลขทั้งหมด — startAt(number) จึงลาก
    // แถว created_at ที่เป็น string ติดมาด้วย กรองซ้ำฝั่งโค้ดให้ชัวร์
    const created = Number(job.created_at);
    if (!Number.isFinite(created) || created < cutoff) continue;

    const devices = Array.isArray(job.devices) ? job.devices.filter(Boolean) : [];
    let counted = false;
    if (devices.length) {
      for (const d of devices) {
        const id = typeof d.model_id === "string" && d.model_id ? d.model_id : null;
        if (id) {
          counts.set(id, (counts.get(id) || 0) + 1);
          counted = true;
        } else if (d.model || d.model_name) {
          const n = normName(d.model || d.model_name);
          if (n) {
            nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
            counted = true;
          }
        }
      }
    }
    if (!counted && job.model) {
      const n = normName(job.model);
      if (n) {
        nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
        counted = true;
      }
    }
    if (counted) jobsCounted++;
  }
  return { counts, nameCounts, jobsCounted };
}

// รวม nameCounts เข้า counts ด้วย catalog แล้วเรียงตามยอด (pure)
function rankCounts(counts, nameCounts, catalog, limit) {
  const merged = new Map(counts);
  if (nameCounts.size > 0 && Array.isArray(catalog)) {
    const sorted = [...catalog].sort((a, b) => b.norm.length - a.norm.length);
    for (const [n, c] of nameCounts) {
      const id = resolveNameToId(n, sorted);
      if (id) merged.set(id, (merged.get(id) || 0) + c);
    }
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

async function runPopularModelsRefresh() {
  const db = getDatabase();

  const manualSnap = await db.ref("settings/sell/popular_models_manual").once("value");
  if (manualSnap.val() === true) {
    logger.info("[popularModels] skipped: popular_models_manual is set");
    return { skipped: "manual" };
  }

  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const snap = await db.ref("jobs").orderByChild("created_at").startAt(cutoff).once("value");

  const jobs = [];
  snap.forEach((child) => {
    jobs.push(child.val());
  });
  const { counts, nameCounts, jobsCounted } = collectCounts(jobs, cutoff);

  // โหลด catalog เฉพาะเมื่อมีงานที่ต้อง resolve ชื่อ → id เท่านั้น
  let catalog = null;
  if (nameCounts.size > 0) {
    const modelsSnap = await db.ref("models").once("value");
    catalog = [];
    modelsSnap.forEach((m) => {
      const v = m.val() || {};
      catalog.push({ id: m.key, norm: normName(v.name) });
    });
  }

  const ranked = rankCounts(counts, nameCounts, catalog, WRITE_LIMIT);

  if (ranked.length === 0) {
    // ไม่มีข้อมูลพอ = ไม่เขียนทับ (ปล่อยค่าที่มี/fallback ฝั่งเว็บทำงานต่อ)
    logger.info(`[popularModels] skipped: no sales data in ${LOOKBACK_DAYS}d window`);
    return { skipped: "no_data", jobs_counted: jobsCounted };
  }

  await db.ref("settings/sell").update({
    popular_models: ranked,
    popular_models_meta: {
      source: "auto_sales",
      window_days: LOOKBACK_DAYS,
      jobs_counted: jobsCounted,
      refreshed_at: Date.now(),
    },
  });
  logger.info(
    `[popularModels] refreshed: ${ranked.length} models from ${jobsCounted} jobs (${LOOKBACK_DAYS}d window)`
  );
  return { written: ranked.length, jobs_counted: jobsCounted, popular_models: ranked };
}

function registerPopularModels() {
  // ชื่อ unique ระดับ project ตามกฎ {region}/{name}
  const refreshPopularSellModels = onSchedule(
    { schedule: "45 4 * * *", timeZone: "Asia/Bangkok", region: "asia-southeast1" },
    async () => {
      try {
        await runPopularModelsRefresh();
      } catch (e) {
        // พังเงียบไม่ได้ แต่ก็ไม่ throw ให้ retry รัว — รอบพรุ่งนี้มาใหม่
        logger.error("[popularModels] refresh failed", e);
      }
    }
  );

  // ปุ่มรันทันทีสำหรับแอดมิน (ไม่ต้องรอ 04:45) — gate CEO/MANAGER แบบเดียวกับ
  // callable ตัวอื่น. คืนผลสรุปให้เห็นเลยว่าลิสต์ที่ได้คืออะไร
  const adminRefreshPopularModels = onCall(
    { region: "asia-southeast1" },
    async (request) => {
      const db = getDatabase();
      const staff = (await lookupStaffByAuth(db, request.auth)) || {};
      const role = String(staff.role || "").toUpperCase();
      if (!ADMIN_ROLES.includes(role)) {
        throw new HttpsError("permission-denied", `เฉพาะ ${ADMIN_ROLES.join("/")} เท่านั้น`);
      }
      try {
        return await runPopularModelsRefresh();
      } catch (e) {
        logger.error("[popularModels] manual refresh failed", e);
        throw new HttpsError("internal", "สรุปยอดขายไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
    }
  );

  return { refreshPopularSellModels, adminRefreshPopularModels };
}

module.exports = {
  registerPopularModels,
  runPopularModelsRefresh,
  // สำหรับ offline test
  collectCounts,
  rankCounts,
  resolveNameToId,
  normName,
};
