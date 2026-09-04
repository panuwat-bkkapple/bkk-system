// ---------------------------------------------------------------------------
// System Health probe `browser_maps_key` — verdict ต้องแยก "ล้มแบบไม่มี
// fallback" ออกจาก "ล้มแบบมี fallback"
//
//   node functions/test/health-browser-key.test.mjs
//
// ที่มา (4 ก.ย. 2569): billing ค้างชำระ ทำให้ checkout ลูกค้าเลือกวิธีรับ
// เครื่องไม่ได้ทั้งคืน probe `customer_quote` ไม่แดงเพราะมันส่งชื่อจังหวัดไป
// เป็น hint เอง ข้ามขั้น reverse geocode ที่ล้มจริง. probe ใหม่ยิงด้วยคีย์
// ฝั่งเบราว์เซอร์ + Referer แบบเดียวกับที่เว็บลูกค้าทำ แล้วให้ตัวตัดสินนี้
// (pure) แปลงคำตอบ Google เป็นสถานะ
//
// fixture มาจากรูปคำตอบจริงของ Google:
//   - Geocoding REST ตอบ 200 เสมอ แล้วบอกผลใน body.status (REQUEST_DENIED
//     ตอน billing/คีย์พัง, ZERO_RESULTS ตอนไม่มีที่อยู่)
//   - Routes ตอบ HTTP 403 พร้อม {error:{message}} ตอนคีย์/billing พัง
//
// Injection ที่ลองแล้ว (ถอดกฎทีละข้อในไฟล์ verdict แล้วรันเทสนี้):
//   - ให้ geocode ล้มเป็น warn แทน fail        → แดง 3
//   - ให้ Routes ล้มเป็น fail แทน warn         → แดง 1
//   - ถอด REFERER_UNSUPPORTED_RE (มองเป็นคีย์พัง) → แดง 2
//   - รับ body.status อะไรก็ได้เป็น ok         → แดง 2 (เคส 2, 6)
//     รอบแรก "เขียว": ร่างแรกเช็ค `status === "OK" && results.length > 0`
//     สองเงื่อนไขนี้กลบกันเองบนข้อมูลจริง (Google ตอบ OK ก็ต่อเมื่อมี results)
//     ถอด status ทิ้ง results.length ยังกันไว้ให้ จึงตัดเหลือ status ตัวเดียว
//     ตามกฎ "ด่านที่ไปไม่ถึง ให้ลบ" ไม่ใช่แต่ง fixture OK-แต่-results-ว่างที่
//     ไม่มีอยู่จริงมาให้ดูเหมือนมีด่าน
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const { browserKeyVerdict } = require(
  join(dirname(fileURLToPath(import.meta.url)), "..", "health-check-browser-key.js")
);

let failures = 0;
const check = (label, cond, extra = "") => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

const GEO_OK = {
  httpStatus: 200,
  body: { status: "OK", results: [{ formatted_address: "ราชเทวี กรุงเทพมหานคร" }] },
};
const GEO_BILLING = {
  httpStatus: 200,
  body: {
    status: "REQUEST_DENIED",
    results: [],
    error_message: "This API project is not authorized to use this API. Billing must be enabled.",
  },
};
const GEO_REFERER_UNSUPPORTED = {
  httpStatus: 200,
  body: {
    status: "REQUEST_DENIED",
    results: [],
    error_message: "API keys with referer restrictions cannot be used with this API.",
  },
};
const GEO_ZERO = { httpStatus: 200, body: { status: "ZERO_RESULTS", results: [] } };
const ROUTES_OK = {
  httpStatus: 200,
  body: [{ originIndex: 0, destinationIndex: 0, distanceMeters: 3120, condition: "ROUTE_EXISTS" }],
};
const ROUTES_DENIED = {
  httpStatus: 403,
  body: { error: { code: 403, message: "Requests to this API are blocked.", status: "PERMISSION_DENIED" } },
};

// 1. ทั้งสองทางปกติ
{
  const v = browserKeyVerdict({ geocode: GEO_OK, routes: ROUTES_OK });
  check("1 geocode+routes ok → ok", v.status === "ok", v.message);
  check("1 message บอกระยะทางทดสอบ", /3\.1 กม/.test(v.message), v.message);
}

// 2. billing ค้าง — ล้มทั้งคู่ ต้อง fail และบอกว่าลูกค้าเลือกวิธีรับเครื่องไม่ได้
{
  const v = browserKeyVerdict({ geocode: GEO_BILLING, routes: ROUTES_DENIED });
  check("2 billing → fail", v.status === "fail", v.status);
  check("2 message ชี้ผลกระทบลูกค้า", /เลือกวิธีรับเครื่องไม่ได้/.test(v.message), v.message);
  check("2 message มีเหตุจาก Google", /REQUEST_DENIED/.test(v.message), v.message);
}

// 3. Routes ล้มตัวเดียว — มี haversine รองรับ ต้อง warn ไม่ใช่ fail
{
  const v = browserKeyVerdict({ geocode: GEO_OK, routes: ROUTES_DENIED });
  check("3 routes ล้มอย่างเดียว → warn", v.status === "warn", v.status);
  check("3 message บอกว่าตกไปเส้นตรง", /เส้นตรง/.test(v.message), v.message);
}

// 4. Geocoding REST ไม่รับคีย์ referer ทั้งชนิด แต่ Routes ปกติ = probe พิสูจน์
//    ทางจังหวัดไม่ได้ ไม่ใช่คีย์พัง → skip (ไม่นับ fail ไม่ปลุกทีม)
{
  const v = browserKeyVerdict({ geocode: GEO_REFERER_UNSUPPORTED, routes: ROUTES_OK });
  check("4 referer unsupported + routes ok → skip", v.status === "skip", v.status);
  check("4 message บอกว่าพิสูจน์ไม่ได้", /พิสูจน์/.test(v.message), v.message);
}

// 5. referer unsupported และ Routes ก็ล้ม — Routes รับคีย์ referer แน่นอน
//    (เว็บลูกค้ายิงแบบนั้นบน production) ดังนั้นนี่คือคีย์พังจริง → fail
{
  const v = browserKeyVerdict({ geocode: GEO_REFERER_UNSUPPORTED, routes: ROUTES_DENIED });
  check("5 referer unsupported + routes ล้ม → fail", v.status === "fail", v.status);
}

// 6. geocode ตอบ 200 แต่ไม่มีผล (ZERO_RESULTS กลางกรุงเทพ = ผิดปกติ) → fail
{
  const v = browserKeyVerdict({ geocode: GEO_ZERO, routes: ROUTES_OK });
  check("6 ZERO_RESULTS กลางกรุงเทพ → fail", v.status === "fail", v.status);
}

// 7. geocode ไม่ใช่ 200 (เน็ต/5xx) → fail ไม่ throw
{
  const v = browserKeyVerdict({ geocode: { httpStatus: 503, body: null }, routes: ROUTES_OK });
  check("7 geocode HTTP 503 → fail", v.status === "fail", v.status);
  check("7 message มี HTTP 503", /HTTP 503/.test(v.message), v.message);
}

// 8. body พัง (JSON parse ไม่ได้ → null) ต้องไม่ throw
{
  let threw = false;
  try {
    browserKeyVerdict({ geocode: { httpStatus: 200, body: null }, routes: { httpStatus: 200, body: null } });
  } catch {
    threw = true;
  }
  check("8 body null ไม่ throw", !threw);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
