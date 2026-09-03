// =============================================================================
// สรุปภาษีเงินได้พนักงานรายปี — ตัวรวมยอดล้วน ไม่มี I/O (ข้อ 2 ของแผน HR)
//
// สองเอกสารที่ต้องออกท้ายปี และทั้งคู่ใช้ตัวเลขชุดเดียวกัน:
//
//   * **50 ทวิ** — หนังสือรับรองการหักภาษี ณ ที่จ่าย ที่ต้องออกให้ลูกจ้าง
//     แต่ละคน (ม.50 ทวิ) ลูกจ้าง ม.40(1) ได้ปีละหนึ่งฉบับสรุปทั้งปี ต่างจาก
//     ไรเดอร์ฟรีแลนซ์ที่ออกทุกครั้งที่หัก (ดู functions/rider-wht-issue.js)
//   * **ภ.ง.ด.1ก** — แบบสรุปรายปีที่ยื่นภายในเดือนกุมภาพันธ์ของปีถัดไป
//     รวมทุกคนไว้ในใบเดียว
//
// **ปีภาษีตัดที่ "วันจ่ายเงิน" ไม่ใช่ "งวดงาน"** — กฎหมายพูดถึงเงินได้ที่
// *จ่าย* ในปีนั้น. ตอนนี้ตัดรอบวันที่ 20 จ่ายวันที่ 25 ของเดือนเดียวกัน สองแกน
// จึงตรงกันพอดีและความต่างมองไม่เห็น แต่ `settings/hr` แก้วันจ่ายได้ ถ้าวันหนึ่ง
// ย้ายไปจ่ายต้นเดือนถัดไป งวดธันวาคมจะถูกจ่ายในเดือนมกราคมของปีถัดไป — ตัวที่
// ต้องขยับตามคือใบ 50 ทวิ ไม่ใช่ปฏิทินงาน. เขียนให้ถูกตั้งแต่ตอนที่ยังไม่ต่างกัน
// ถูกกว่ามาไล่แก้ตอนที่เอกสารออกไปแล้ว
//
// **นับเฉพาะรอบที่จ่ายแล้ว (`paid`)** — 50 ทวิ รับรอง "เงินที่จ่ายจริงและภาษี
// ที่หักไว้จริง" รอบที่อนุมัติแล้วแต่ยังไม่โอนคือหนี้ ไม่ใช่เงินได้ของลูกจ้าง
// รอบที่ค้างอยู่จึง**ถูกรายงานออกมาเป็นรายการ** ไม่ใช่ถูกกรองทิ้งเงียบๆ ตัวเลข
// ที่หายไปโดยไม่มีใครอธิบายได้คือตัวเลขที่ไม่มีใครกล้าใช้ยื่น
// =============================================================================

const BKK_OFFSET_MS = 7 * 3600 * 1000;

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round2 = (n) => Math.round((num(n, 0) + Number.EPSILON) * 100) / 100;

/** ปีคริสต์ศักราชตามเวลาไทยของ timestamp หนึ่ง */
function bangkokYear(ms) {
  return new Date(num(ms, 0) + BKK_OFFSET_MS).getUTCFullYear();
}

/**
 * ปีภาษีของรอบจ่าย — อิง `pay_date` เสมอ
 *
 * ตกกลับไปใช้ `period` ก็ต่อเมื่อรอบไม่มีวันจ่าย (ข้อมูลเก่า/เสีย) เพราะการ
 * คืน 1970 จาก timestamp ที่หายไปจะทำให้ทั้งรอบตกออกจากปีเงียบๆ
 */
function taxYearOfRun(run) {
  const paid = num(run && run.pay_date, 0);
  if (paid > 0) return bangkokYear(paid);
  const m = /^(\d{4})-\d{2}$/.exec(String((run && run.period) || ""));
  return m ? Number(m[1]) - 543 : null;
}

/**
 * รวมยอดทั้งปีต่อคน
 *
 * @param year        ปีคริสต์ศักราชของปีภาษี
 * @param runs        [{ id, ...payroll_runs/{id} }]
 * @param itemsByRun  { [runId]: [payroll_items] }
 */
function aggregateTaxYear({ year, runs, itemsByRun }) {
  const target = Math.round(num(year, 0));
  const all = (Array.isArray(runs) ? runs : []).filter(Boolean);
  const inYear = all.filter((r) => taxYearOfRun(r) === target);

  const counted = inYear.filter((r) => r.status === "paid");
  // รอบที่อยู่ในปีแต่ยังไม่จ่าย — ต้องโผล่บนหน้าจอ ไม่ใช่หายไปเฉยๆ
  const pending = inYear
    .filter((r) => r.status !== "paid")
    .map((r) => ({ id: r.id, status: r.status || null, pay_date: num(r.pay_date, 0) || null }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const byEmployee = new Map();
  for (const run of counted) {
    const items = (itemsByRun && itemsByRun[run.id]) || [];
    for (const it of Array.isArray(items) ? items : Object.values(items || {})) {
      if (!it || it.skipped) continue;
      const id = it.employee_id;
      if (!id) continue;
      const row = byEmployee.get(id) || {
        employee_id: id,
        employee_code: it.employee_code || null,
        name: it.name || null,
        gross: 0,
        wht: 0,
        sso_employee: 0,
        periods: 0,
        first_pay_date: null,
        last_pay_date: null,
        run_ids: [],
      };
      row.gross = round2(row.gross + num(it.gross, 0));
      row.wht = round2(row.wht + num(it.wht, 0));
      row.sso_employee = round2(row.sso_employee + num(it.sso_employee, 0));
      row.periods += 1;
      row.run_ids.push(run.id);
      // ชื่อกับรหัสใช้ของรอบล่าสุดเสมอ — คนเปลี่ยนนามสกุลกลางปีได้ และเอกสาร
      // ควรสะกดชื่อแบบที่เจ้าตัวใช้อยู่ตอนนี้
      const at = num(run.pay_date, 0);
      if (row.first_pay_date == null || at < row.first_pay_date) row.first_pay_date = at;
      if (row.last_pay_date == null || at >= row.last_pay_date) {
        row.last_pay_date = at;
        if (it.name) row.name = it.name;
        if (it.employee_code) row.employee_code = it.employee_code;
      }
      byEmployee.set(id, row);
    }
  }

  const rows = [...byEmployee.values()].sort((a, b) =>
    String(a.employee_code || "zz").localeCompare(String(b.employee_code || "zz")));

  const sum = (f) => round2(rows.reduce((s, r) => s + num(r[f], 0), 0));
  return {
    year,
    buddhist_year: target + 543,
    rows,
    totals: {
      headcount: rows.length,
      gross: sum("gross"),
      wht: sum("wht"),
      sso_employee: sum("sso_employee"),
    },
    runs_counted: counted.map((r) => r.id).sort(),
    runs_pending: pending,
  };
}

module.exports = { bangkokYear, taxYearOfRun, aggregateTaxYear, round2 };
