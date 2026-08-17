// =============================================================================
// Search Analytics — ตัวอ่านของหน้า /analytics/search
//
// ทำไมต้องเป็น callable ไม่ใช่ให้หน้าเว็บอ่าน Firestore ตรงๆ:
// `firestore.rules` (อยู่ที่ bkk-frontend-next) ปฏิเสธทุก path เพราะแอปนี้
// เช็คสิทธิ์พนักงานจาก `/admins/{uid}` ซึ่งอยู่ใน **RTDB** และกฎ Firestore
// อ่าน RTDB ไม่ได้ — จะ gate ตรงๆ ต้องมีสำเนาตารางพนักงานตัวที่สองใน
// Firestore ซึ่งแย่กว่าการมี callable ตัวเดียวที่ใช้ `lookupStaffByAuth`
// เหมือนทุก admin function ที่มีอยู่แล้ว
//
// การ join สองชั้น (ตั้งใจให้ต่างกัน):
//   คลิก      — แม่นยำ ผูกด้วย sid ที่ /search รู้ตอนกดจริง
//   ดีลจริง   — join ด้วย uid + หน้าต่างเวลา เพราะการร้อย sid ผ่าน
//                /sell → /cart → /checkout → validateAndCreateOrder แปลว่า
//                ต้องแก้เส้นทางสร้างออเดอร์ซึ่งเป็นโค้ดที่พังไม่ได้ที่สุดใน
//                ระบบ เพื่อความแม่นที่ทราฟฟิกระดับนี้ยังไม่ต้องการ
//
// ต้นทุนต่อการเปิดหน้า: อ่าน Firestore ตามจำนวนแถวในช่วง (วัดจริง ส.ค. 2026
// = ~40 การค้นหา/วัน → 30 วัน ≈ 1,200 reads ≈ 0.03 บาท) + RTDB query ตาม
// index `uid` เฉพาะ uid ที่มีการค้นหาจริงในช่วงนั้น **ห้ามกวาด /jobs ทั้ง
// node** (กฎค่า RTDB ใน CLAUDE.md)
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");

const REGION = "asia-southeast1";
const READ_ROLES = ["CEO", "MANAGER"];

// เพดานแถวต่อการเรียกหนึ่งครั้ง — กันหน้าเดียวลากทั้งตารางลงมาเมื่อทราฟฟิก
// โตขึ้น. ถ้าชนเพดานจะบอกใน payload ไม่ใช่ตัดเงียบ (กฎ no silent caps)
const MAX_EVENTS = 5000;
const MAX_OUTCOMES = 5000;
// uid ที่จะไปถาม /jobs ต่อ — งานที่เกิดจากการค้นหาเป็นส่วนน้อยของ uid ทั้งหมด
// อยู่แล้ว และแต่ละตัวเป็น indexed query หนึ่งครั้ง
const MAX_UID_LOOKUPS = 300;

const dayKey = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** นับแบบเรียงจากมากไปน้อย คืน array ของ [key, count] */
function topOf(counter, limit) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function emptyBucket() {
  return { searches: 0, questions: 0, no_results: 0, generated: 0, clicks: 0, orders: 0 };
}

async function loadSearchAnalytics(db, days) {
  let store;
  try {
    store = require("firebase-admin/firestore").getFirestore();
  } catch (e) {
    return { enabled: false, reason: "ยังไม่ได้เปิดใช้ Firestore" };
  }

  const since = Date.now() - days * 86400000;
  const sinceDay = dayKey(since);

  let eventsSnap;
  let outcomesSnap;
  try {
    [eventsSnap, outcomesSnap] = await Promise.all([
      store
        .collection("search_events")
        .where("day", ">=", sinceDay)
        .orderBy("day", "asc")
        .limit(MAX_EVENTS)
        .get(),
      store
        .collection("search_outcomes")
        .where("day", ">=", sinceDay)
        .orderBy("day", "asc")
        .limit(MAX_OUTCOMES)
        .get(),
    ]);
  } catch (e) {
    // ยังไม่ได้สร้าง database / index ยังไม่ deploy / ยังไม่มีข้อมูล — ทั้งหมด
    // แปลว่า "ยังอ่านไม่ได้" ไม่ใช่ "พัง" หน้าเว็บจะขึ้นข้อความบอกวิธีเปิด
    return { enabled: false, reason: e.message || String(e) };
  }

  const events = eventsSnap.docs.map((d) => d.data());
  const outcomes = outcomesSnap.docs.map((d) => d.data());

  // ── ก้อนรวม ────────────────────────────────────────────────────────────
  const byDay = {};
  const byChannel = {};
  const byEntryChannel = {};
  const queries = {};
  const zeroQueries = {};
  const modelHits = {};
  const topicCounts = {};
  const uids = new Set();
  let questions = 0;
  let noResults = 0;
  let generated = 0;
  let cached = 0;
  let refined = 0;
  let rescued = 0; // refinement ที่หาเองไม่เจอ = คนที่รอดจากหน้าเปล่า
  let redactedCount = 0;
  let unverified = 0;
  const unverifiedSamples = [];
  const overviewSamples = [];

  for (const e of events) {
    const day = e.day || dayKey(Number(e.at) || Date.now());
    (byDay[day] = byDay[day] || emptyBucket()).searches += 1;

    if (e.question) { questions += 1; byDay[day].questions += 1; }
    if (!e.has_results) { noResults += 1; byDay[day].no_results += 1; }
    if (e.generated) { generated += 1; byDay[day].generated += 1; }
    if (e.overview && e.overview.cached) cached += 1;
    if (e.refined) refined += 1;
    if (e.alone_hits === 0) rescued += 1;
    if (e.redacted) redactedCount += 1;
    if (e.uid) uids.add(e.uid);

    const ch = e.channel || "direct";
    byChannel[ch] = (byChannel[ch] || 0) + 1;
    if (e.entry_channel) {
      byEntryChannel[e.entry_channel] = (byEntryChannel[e.entry_channel] || 0) + 1;
    }

    const q = e.q_norm || e.q || "";
    if (q) {
      queries[q] = (queries[q] || 0) + 1;
      if (!e.has_results) zeroQueries[q] = (zeroQueries[q] || 0) + 1;
    }

    for (const id of e.result?.model_ids || []) {
      modelHits[id] = (modelHits[id] || 0) + 1;
    }
    for (const t of e.overview?.topics || []) {
      topicCounts[t] = (topicCounts[t] || 0) + 1;
    }

    const unv = e.overview?.unverified || [];
    if (unv.length) {
      unverified += unv.length;
      if (unverifiedSamples.length < 20) {
        unverifiedSamples.push({ q: e.q, numbers: unv, at: e.at });
      }
    }

    // ตัวอย่างคำตอบที่ AI เขียนจริง — ชั้นที่ log เดิมไม่เคยมี และเป็นตัวเดียว
    // ที่ทำให้ "generated=true" ตรวจสอบได้แทนที่จะเป็นแค่จริง
    if (e.overview?.summary && overviewSamples.length < 30) {
      overviewSamples.push({
        q: e.q,
        summary: e.overview.summary,
        cached: !!e.overview.cached,
        at: e.at,
      });
    }
  }

  // ── คลิก ───────────────────────────────────────────────────────────────
  const clicksByKind = {};
  const clickedSids = new Set();
  for (const o of outcomes) {
    clicksByKind[o.kind] = (clicksByKind[o.kind] || 0) + 1;
    clickedSids.add(o.sid);
    const day = o.day || dayKey(Number(o.at) || Date.now());
    (byDay[day] = byDay[day] || emptyBucket()).clicks += 1;
    if (o.uid) uids.add(o.uid);
  }

  // ── ดีลจริง: join ด้วย uid ตาม index (ห้ามกวาด /jobs) ───────────────────
  const uidList = [...uids].slice(0, MAX_UID_LOOKUPS);
  const ordersByUid = {};
  await Promise.all(
    uidList.map(async (uid) => {
      try {
        const snap = await db.ref("jobs").orderByChild("uid").equalTo(uid).once("value");
        const jobs = snap.val() || {};
        const rows = Object.entries(jobs)
          .map(([id, j]) => ({ id, created_at: Number(j?.created_at) || 0, net: Number(j?.net_payout) || 0 }))
          .filter((j) => j.created_at >= since);
        if (rows.length) ordersByUid[uid] = rows;
      } catch (e) {
        /* uid เดียวที่อ่านไม่ได้ ไม่ควรทำให้ทั้งหน้าพัง */
      }
    })
  );

  // conversion: การค้นหาที่ตามด้วยออเดอร์ของ uid เดียวกัน "หลังจากนั้น"
  // ภายใน 24 ชม. — หน้าต่างสั้นพอที่จะไม่ยกความดีให้การค้นหาเมื่อสัปดาห์ก่อน
  const ATTRIBUTION_MS = 24 * 3600000;
  let searchesWithOrder = 0;
  let questionSearchesWithOrder = 0;
  let questionSearches = 0;
  const orderedSids = new Set();
  for (const e of events) {
    if (e.question) questionSearches += 1;
    if (!e.uid) continue;
    const rows = ordersByUid[e.uid];
    if (!rows) continue;
    const at = Number(e.at) || 0;
    const hit = rows.some((r) => r.created_at >= at && r.created_at - at <= ATTRIBUTION_MS);
    if (hit) {
      searchesWithOrder += 1;
      orderedSids.add(e.sid);
      if (e.question) questionSearchesWithOrder += 1;
      const day = e.day || dayKey(at);
      (byDay[day] = byDay[day] || emptyBucket()).orders += 1;
    }
  }

  const withUid = events.filter((e) => e.uid).length;

  return {
    enabled: true,
    range_days: days,
    generated_at: Date.now(),
    truncated: {
      events: events.length >= MAX_EVENTS,
      outcomes: outcomes.length >= MAX_OUTCOMES,
      uid_lookups: uids.size > MAX_UID_LOOKUPS,
    },
    totals: {
      searches: events.length,
      questions,
      no_results: noResults,
      generated,
      cached,
      refined,
      rescued,
      redacted: redactedCount,
      unverified,
      clicks: outcomes.length,
      searches_with_click: clickedSids.size,
      with_uid: withUid,
      searches_with_order: searchesWithOrder,
      question_searches: questionSearches,
      question_searches_with_order: questionSearchesWithOrder,
    },
    by_day: Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, ...v })),
    by_channel: topOf(byChannel, 12),
    by_entry_channel: topOf(byEntryChannel, 12),
    clicks_by_kind: topOf(clicksByKind, 12),
    top_queries: topOf(queries, 40),
    zero_result_queries: topOf(zeroQueries, 40),
    top_models: topOf(modelHits, 20),
    topics: topOf(topicCounts, 12),
    unverified_samples: unverifiedSamples,
    overview_samples: overviewSamples,
  };
}

function registerSearchAnalytics() {
  const adminSearchAnalytics = onCall(
    { region: REGION, timeoutSeconds: 120, memory: "512MiB" },
    async (request) => {
      if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
      const db = getDatabase();
      const staff = (await lookupStaffByAuth(db, request.auth)) || {};
      const role = String(staff.role || "").toUpperCase();
      // CEO/MANAGER เท่านั้น — เป็นส่วนหนึ่งของการชั่งน้ำหนักตาม PDPA ที่บันทึก
      // ไว้ใน RoPA Activity 11 ไม่ใช่แค่การจัดเมนู
      if (!READ_ROLES.includes(role)) {
        throw new HttpsError("permission-denied", `เฉพาะ ${READ_ROLES.join("/")} เท่านั้น`);
      }
      const days = Math.min(90, Math.max(1, Number(request.data?.days) || 30));
      return loadSearchAnalytics(db, days);
    }
  );

  return { adminSearchAnalytics };
}

module.exports = { registerSearchAnalytics };
