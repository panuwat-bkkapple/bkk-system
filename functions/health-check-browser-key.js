// =============================================================================
// ตัดสินผล probe `browser_maps_key` (System Health) — pure, ไม่มี dependency
// เพื่อให้ functions/test/health-browser-key.test.mjs รันได้โดยไม่ต้องติดตั้ง
// firebase-admin (health-check.js require มันตอนโหลด)
//
// ทำไมต้องมี probe นี้ (บทเรียน 4 ก.ย. 2569 — billing ค้างชำระ):
//   checkout ของลูกค้าพึ่งคีย์ Maps "ฝั่งเบราว์เซอร์" (NEXT_PUBLIC_GOOGLE_MAPS_
//   API_KEY บน Vercel) สองทาง และผลของการล้มไม่เท่ากัน
//     1. reverse geocode → จังหวัด → โซนราคา  : ไม่มี fallback — จังหวัด null =
//        ลูกค้าเลือกวิธีรับเครื่องไม่ได้ กดยืนยันไม่ได้ (คือสิ่งที่เกิดจริง)
//     2. Routes API → ระยะทางขับจริง          : มี fallback เส้นตรง x1.3 อยู่แล้ว
//   probe เดิม `geocoding_api`/`routes_api` ใช้คีย์ฝั่ง server (GOOGLE_MAPS_
//   API_KEY) และ `customer_quote` ส่งชื่อจังหวัดไปเป็น hint เอง จึงข้ามข้อ 1
//   ไปทั้งก้อน — ถ้าวันหนึ่งคีย์เบราว์เซอร์พังตัวเดียว (referrer restriction
//   ผิด / API ถูกถอดออกจากคีย์ / โควตาต่อคีย์) จะไม่มีตัวไหนแดงเลย
//
// กติกาที่ verdict ถือไว้ (เทสในไฟล์เทสข้างต้น):
//   - geocode ล้ม        → fail  (ทาง 1 ไม่มี fallback)
//   - geocode ok, routes ล้ม → warn (ทาง 2 ตกไปเส้นตรง ระบบยังขายได้)
//   - Geocoding REST ปฏิเสธคีย์แบบ referer ทั้งชนิด ("referer restrictions
//     cannot be used") = probe พิสูจน์ทาง 1 จาก server ไม่ได้ ไม่ใช่คีย์พัง →
//     ตัดสินจาก Routes อย่างเดียว: ok → skip พร้อมบอกเหตุผล / ล้ม → fail
//     (Routes รับคีย์ referer แน่นอน — เว็บลูกค้ายิงแบบนั้นบน production อยู่)
// =============================================================================

const REFERER_UNSUPPORTED_RE = /referer restrictions cannot be used/i;

function describeGeocode(g) {
  if (!g || typeof g.httpStatus !== "number") {
    return { ok: false, unsupported: false, detail: "ไม่มีคำตอบ" };
  }
  if (g.httpStatus !== 200) {
    return { ok: false, unsupported: false, detail: `HTTP ${g.httpStatus}` };
  }
  const body = g.body || {};
  // ตัดสินจาก body.status ตัวเดียว — Geocoding ตอบ "OK" ก็ต่อเมื่อมี results
  // เสมอ (สัญญาของ API) การเช็ค results.length ซ้ำเป็นด่านที่กลบกันเองซึ่ง
  // injection พิสูจน์แล้วว่าถอด status ทิ้งเทสยังเขียว (ดูหัวไฟล์เทส)
  if (body.status === "OK") {
    return { ok: true, unsupported: false, detail: "reverse geocode ปกติ" };
  }
  const msg = String(body.error_message || "");
  return {
    ok: false,
    unsupported: REFERER_UNSUPPORTED_RE.test(msg),
    detail: `status=${body.status || "?"} ${msg}`.trim().slice(0, 160),
  };
}

function describeRoutes(r) {
  if (!r || typeof r.httpStatus !== "number") return { ok: false, detail: "ไม่มีคำตอบ" };
  if (r.httpStatus !== 200) {
    const msg = r.body && r.body.error && r.body.error.message;
    return {
      ok: false,
      detail: `HTTP ${r.httpStatus}${msg ? ` ${String(msg).slice(0, 120)}` : ""}`,
    };
  }
  const el = Array.isArray(r.body) ? r.body[0] : null;
  if (!el || el.condition !== "ROUTE_EXISTS" || !(el.distanceMeters > 0)) {
    return { ok: false, detail: "ตอบกลับไม่มีเส้นทาง" };
  }
  return { ok: true, detail: `เส้นทางทดสอบ ${(el.distanceMeters / 1000).toFixed(1)} กม.` };
}

/**
 * @param {{ geocode: {httpStatus:number, body:any}|null, routes: {httpStatus:number, body:any}|null }} input
 * @returns {{ status: "ok"|"warn"|"fail"|"skip", message: string }}
 */
function browserKeyVerdict({ geocode, routes }) {
  const g = describeGeocode(geocode);
  const r = describeRoutes(routes);

  if (g.ok && r.ok) {
    return { status: "ok", message: `${g.detail}, ${r.detail}` };
  }
  if (g.ok) {
    return {
      status: "warn",
      message:
        `reverse geocode ปกติ แต่ Routes ด้วยคีย์เบราว์เซอร์ล้ม: ${r.detail} — ` +
        "ค่าไรเดอร์ที่ลูกค้าเห็นตกไปใช้ระยะเส้นตรง ระบบยังขายได้",
    };
  }
  if (g.unsupported) {
    if (r.ok) {
      return {
        status: "skip",
        message:
          "Geocoding REST ไม่รับคีย์แบบ referer จึงพิสูจน์ทางจังหวัดจาก server ไม่ได้ " +
          `(Routes ด้วยคีย์นี้ปกติ: ${r.detail}) — ดูหัวข้อ System Health ใน CLAUDE.md`,
      };
    }
    return {
      status: "fail",
      message: `คีย์เบราว์เซอร์ใช้ไม่ได้ทั้งสองทาง: geocode ${g.detail} / Routes ${r.detail}`,
    };
  }
  return {
    status: "fail",
    message:
      `reverse geocode ด้วยคีย์เบราว์เซอร์ล้ม: ${g.detail} — ` +
      "ลูกค้าจะเลือกวิธีรับเครื่องไม่ได้ (จังหวัด resolve ไม่ได้ ไม่มี fallback)" +
      (r.ok ? "" : ` · Routes ก็ล้ม: ${r.detail}`),
  };
}

module.exports = { browserKeyVerdict, REFERER_UNSUPPORTED_RE };
