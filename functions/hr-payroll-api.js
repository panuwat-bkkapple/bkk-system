// =============================================================================
// รอบจ่ายเงินเดือน — callable (เฟส P5 ของ docs/hr-system-design.md)
//
// ตัดรอบวันที่ 20 จ่ายวันที่ 25 (เจ้าของงานตัดสิน ก.ย. 2569) → งวดของเดือน
// กันยายนคือ 21 ส.ค. ถึง 20 ก.ย. จ่าย 25 ก.ย. ค่าทั้งสองอยู่ที่ `settings/hr`
// ไม่ได้ฝังในโค้ด
//
// **สามกฎที่ไฟล์นี้ถือไว้:**
//
//   1. **รอบหนึ่งงวดมีใบเดียว** — `payroll_runs/{2569-09}` คีย์ด้วยงวดตรงๆ
//      ไม่ใช่ push id การกดสร้างซ้ำจึงเป็นการ "คำนวณใหม่" ไม่ใช่ "สร้างใบที่สอง"
//      สองใบของงวดเดียวกันคือทางที่จ่ายเงินซ้ำ
//   2. **อนุมัติแล้วแก้ไม่ได้ และค่าที่ใช้คำนวณถูกแช่ไว้กับรอบ** — เหมือนใบกำกับ
//      ภาษีที่ออกแล้วแก้ไม่ได้ ถ้าผิดต้องออกรอบปรับปรุง ไม่ใช่แก้ของเดิม
//      (ถ้าอัตราภาษีเปลี่ยนพรุ่งนี้ สลิปที่ส่งไปแล้วต้องยังอธิบายตัวเองได้)
//   3. **รอบที่ยังกรอกไม่ครบอนุมัติไม่ได้** — ลูกจ้างรายวันที่ยังไม่กรอกจำนวนวัน
//      หรือคนที่ยังไม่ได้ตั้งเงินเดือน จะทำให้ยอดผิดแบบเงียบๆ การบล็อกไว้
//      แพงกว่าการรอหนึ่งวัน แต่ถูกกว่าการเรียกเงินคืน
//
// การคำนวณใหม่ **เก็บสิ่งที่ HR กรอกเองไว้เสมอ** (จำนวนวัน รายการเพิ่ม/หัก
// หมายเหตุ) มิฉะนั้นการกดรีเฟรชจะลบงานที่เพิ่งทำไปทั้งหมด
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES, EX_EMPLOYEE_STATUSES, employeeActorFields } = require("./hr-core");
const {
  resolvePayrollConfig, periodBounds, payDateOf, periodsInYear,
  buildPayrollItem, summarizeRun,
} = require("./hr-payroll");

const REGION = "asia-southeast1";

const RUN_STATUSES = ["draft", "approved", "paid"];

// งวดใช้ปีพุทธศักราชให้ตรงกับที่คนไทยเรียกและตรงกับรหัสพนักงาน
const periodKey = (buddhistYear, month) => `${buddhistYear}-${String(month).padStart(2, "0")}`;

function parsePeriod(data) {
  const year = Math.round(Number(data.year));
  const month = Math.round(Number(data.month));
  if (!Number.isFinite(year) || year < 2500 || year > 2700) {
    throw new HttpsError("invalid-argument", "ปีต้องเป็นพุทธศักราช เช่น 2569");
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new HttpsError("invalid-argument", "เดือนต้องอยู่ระหว่าง 1-12");
  }
  return { year, month, gregorian: year - 543, key: periodKey(year, month) };
}

async function loadHrSettings(db) {
  const snap = await db.ref("settings/hr").once("value");
  return resolvePayrollConfig(snap.val() || {});
}

// พนักงานที่เข้ารอบ: ยังไม่พ้นสภาพ ณ วันสิ้นงวด และไม่ใช่ฟรีแลนซ์
//
// คนที่พ้นสภาพ **กลางงวด** ยังต้องได้เงินของวันที่ทำจริง จึงตัดที่ "พ้นสภาพ
// ก่อนงวดเริ่ม" ไม่ใช่ "สถานะวันนี้ไม่ใช่ active" — เกณฑ์หลังจะทำให้คนที่
// ลาออกวันที่ 5 ไม่ได้เงิน 4 วันแรกของงวด
function eligibleForPeriod(emp, period) {
  if (!emp) return false;
  if (String(emp.employment_type || "").toLowerCase() === "freelance") return false;
  const left = EX_EMPLOYEE_STATUSES.includes(String(emp.status || "").toLowerCase());
  if (left) {
    const at = Number(emp.terminated_at || 0);
    if (!at || at < period.from) return false;
  }
  const hired = Number(emp.hired_at || 0);
  if (hired && hired > period.to) return false;
  return true;
}

// สิ่งที่ HR กรอกเองและต้องรอดจากการคำนวณใหม่
const carryInput = (existing) => ({
  days_worked: existing && existing.days_worked != null ? existing.days_worked : null,
  extra_earnings: (existing && existing.manual_earnings) || [],
  extra_deductions: (existing && existing.manual_deductions) || [],
  // ยอดภาษีที่พิมพ์ทับต้องรอดจากการคำนวณรอบใหม่ ไม่งั้นการกดรีเฟรชจะย้อนกลับไป
  // ใช้เลขที่ระบบคิด โดยไม่มีอะไรบอกว่าของที่คนแก้ไว้หายไป
  wht_override: (existing && existing.wht_override) || null,
  note: (existing && existing.note) || "",
});

function registerHrPayroll() {
  // -------------------------------------------------------------------------
  // adminHrPayrollList — รายการรอบทั้งหมด (ล่าสุดก่อน)
  // -------------------------------------------------------------------------
  const adminHrPayrollList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const snap = await db.ref("payroll_runs").limitToLast(36).once("value");
    const items = [];
    snap.forEach((c) => { items.push({ id: c.key, ...c.val() }); return false; });
    items.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return { items };
  });

  // -------------------------------------------------------------------------
  // adminHrPayrollGet — รอบเดียวพร้อมรายบรรทัด
  // -------------------------------------------------------------------------
  const adminHrPayrollGet = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const key = String((request.data || {}).period || "");
    if (!/^\d{4}-\d{2}$/.test(key)) throw new HttpsError("invalid-argument", "งวดไม่ถูกต้อง");
    const [runSnap, itemSnap] = await Promise.all([
      db.ref(`payroll_runs/${key}`).once("value"),
      db.ref(`payroll_items/${key}`).once("value"),
    ]);
    if (!runSnap.exists()) throw new HttpsError("not-found", "ยังไม่มีรอบของงวดนี้");
    const items = [];
    itemSnap.forEach((c) => { items.push({ id: c.key, ...c.val() }); return false; });
    items.sort((a, b) => String(a.employee_code || "").localeCompare(String(b.employee_code || "")));

    // รายการปรับเพิ่ม/ปรับลดที่ใช้ประจำ — ส่งค่า **ปัจจุบัน** ไม่ใช่ที่แช่ไว้กับรอบ
    // เพราะมันเป็นแค่ตัวช่วยกรอกของหน้าจอ ไม่ใช่ตัวเลขที่คิดเงิน (ตัวที่คิดเงิน
    // คือค่าที่ถูกบันทึกลงบรรทัดไปแล้ว) เพิ่มรายการใหม่ในตั้งค่าแล้วต้องใช้กับ
    // รอบที่ค้างอยู่ได้ทันที
    const cfg = await loadHrSettings(db);
    return { run: { id: key, ...runSnap.val() }, items, presets: cfg.adjustment_presets };
  });

  // -------------------------------------------------------------------------
  // adminHrPayrollDraft — สร้าง/คำนวณรอบใหม่จากทะเบียนพนักงานปัจจุบัน
  // -------------------------------------------------------------------------
  const adminHrPayrollDraft = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const p = parsePeriod(request.data || {});

    const existingRun = (await db.ref(`payroll_runs/${p.key}`).once("value")).val();
    if (existingRun && existingRun.status && existingRun.status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        "รอบนี้อนุมัติไปแล้ว แก้ไม่ได้ — ถ้าตัวเลขผิดต้องออกรอบปรับปรุง"
      );
    }

    const config = await loadHrSettings(db);
    const bounds = periodBounds(p.gregorian, p.month, config.payroll.cutoff_day);
    const payDate = payDateOf(p.gregorian, p.month, config.payroll.pay_day);

    const [empSnap, privSnap, prevItemsSnap] = await Promise.all([
      db.ref("employees").once("value"),
      db.ref("employees_private").once("value"),
      db.ref(`payroll_items/${p.key}`).once("value"),
    ]);
    const employees = empSnap.val() || {};
    const privates = privSnap.val() || {};
    const prevItems = prevItemsSnap.val() || {};

    const items = {};
    for (const [id, emp] of Object.entries(employees)) {
      if (!eligibleForPeriod(emp, bounds)) continue;
      const period = {
        ...bounds,
        periods: periodsInYear(p.gregorian, p.month, emp.hired_at),
      };
      const input = carryInput(prevItems[id]);
      const item = buildPayrollItem({
        employee: { id, ...emp },
        priv: privates[id] || {},
        config, period, input,
      });
      if (item.skipped) continue;
      items[id] = {
        ...item,
        manual_earnings: input.extra_earnings,
        manual_deductions: input.extra_deductions,
      };
    }

    const list = Object.values(items);
    const totals = summarizeRun(list);
    const at = Date.now();
    const run = {
      period: p.key,
      period_from: bounds.from,
      period_to: bounds.to,
      pay_date: payDate,
      status: "draft",
      totals,
      // ค่าที่ใช้คำนวณรอบนี้ — แช่ไว้ตั้งแต่ draft เพื่อให้ตัวเลขบนจออธิบายได้
      // ด้วยสิ่งที่อยู่ในใบเดียวกัน ไม่ต้องไปเดาว่าตอนนั้น settings เป็นอะไร
      config,
      drafted_at: at,
      ...employeeActorFields(callerStaffId, staffMap, request.auth),
    };

    await db.ref(`payroll_items/${p.key}`).set(items);
    await db.ref(`payroll_runs/${p.key}`).set(run);

    console.log(`[hr-payroll] draft ${p.key} headcount=${totals.headcount} incomplete=${totals.incomplete}`);
    return { run: { id: p.key, ...run }, count: list.length };
  });

  // -------------------------------------------------------------------------
  // adminHrPayrollSetItem — HR กรอกจำนวนวัน / รายการเพิ่ม-หัก แล้วคิดบรรทัดใหม่
  // -------------------------------------------------------------------------
  const adminHrPayrollSetItem = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const caller = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const key = String(data.period || "");
    const employeeId = String(data.employeeId || "");
    if (!/^\d{4}-\d{2}$/.test(key) || !employeeId) {
      throw new HttpsError("invalid-argument", "ต้องระบุงวดและพนักงาน");
    }

    const runSnap = await db.ref(`payroll_runs/${key}`).once("value");
    if (!runSnap.exists()) throw new HttpsError("not-found", "ยังไม่มีรอบของงวดนี้");
    const run = runSnap.val();
    if (run.status !== "draft") {
      throw new HttpsError("failed-precondition", "รอบนี้อนุมัติไปแล้ว แก้ไม่ได้");
    }
    const { callerStaffId, staffMap } = caller;

    const [empSnap, privSnap] = await Promise.all([
      db.ref(`employees/${employeeId}`).once("value"),
      db.ref(`employees_private/${employeeId}`).once("value"),
    ]);
    if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงาน");
    const emp = empSnap.val();

    const clean = (arr) => (Array.isArray(arr) ? arr.slice(0, 20) : []).map((r) => ({
      label: String((r && r.label) || "").slice(0, 80),
      amount: Number((r && r.amount) || 0),
      taxable: !(r && r.taxable === false),
      sso_wage: Boolean(r && r.sso_wage),
      occasional: Boolean(r && r.occasional),
    })).filter((r) => r.label && Number.isFinite(r.amount));

    // การพิมพ์ทับยอดภาษีต้องมีเหตุผลเสมอ — ตัวเลขภาษีที่ถูกแก้ด้วยมือโดยไม่มี
    // คำอธิบาย คือสิ่งแรกที่ผู้ตรวจถามและไม่มีใครตอบได้ ผู้แก้มาจาก auth token
    // ไม่ใช่จาก client (ชื่อที่ client ส่งมาเองก็ปลอมได้เท่ากับ audit ที่ไม่มี)
    let whtOverride = null;
    const rawOv = data.wht_override;
    if (rawOv && rawOv.amount !== null && rawOv.amount !== undefined && rawOv.amount !== "") {
      const amount = Number(rawOv.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new HttpsError("invalid-argument", "ยอดภาษีที่กรอกเองต้องเป็นจำนวนที่ไม่ติดลบ");
      }
      const reason = String(rawOv.reason || "").trim().slice(0, 300);
      if (!reason) {
        throw new HttpsError("invalid-argument", "การแก้ยอดภาษีด้วยมือต้องระบุเหตุผล");
      }
      const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
      whtOverride = {
        amount, reason,
        by_name: actor.by_name, by_staff_id: actor.by_staff_id, at: Date.now(),
      };
    }

    const input = {
      days_worked: data.days_worked === "" || data.days_worked == null ? null : Number(data.days_worked),
      extra_earnings: clean(data.extra_earnings),
      extra_deductions: clean(data.extra_deductions),
      note: String(data.note || "").slice(0, 300),
      wht_override: whtOverride,
    };
    if (input.days_worked != null && (!Number.isFinite(input.days_worked) || input.days_worked < 0 || input.days_worked > 31)) {
      throw new HttpsError("invalid-argument", "จำนวนวันต้องอยู่ระหว่าง 0-31");
    }

    // ใช้ config ที่แช่ไว้กับรอบ ไม่ใช่ settings ปัจจุบัน — ไม่งั้นการแก้บรรทัด
    // เดียวจะทำให้บรรทัดนั้นคิดด้วยอัตราคนละชุดกับบรรทัดอื่นในรอบเดียวกัน
    const config = run.config || await loadHrSettings(db);
    const bounds = { from: run.period_from, to: run.period_to };
    const gregorian = Number(String(key).slice(0, 4)) - 543;
    const month = Number(String(key).slice(5, 7));
    const item = buildPayrollItem({
      employee: { id: employeeId, ...emp },
      priv: privSnap.val() || {},
      config,
      period: { ...bounds, periods: periodsInYear(gregorian, month, emp.hired_at) },
      input,
    });

    await db.ref(`payroll_items/${key}/${employeeId}`).set({
      ...item,
      manual_earnings: input.extra_earnings,
      manual_deductions: input.extra_deductions,
    });

    const allSnap = await db.ref(`payroll_items/${key}`).once("value");
    const totals = summarizeRun(Object.values(allSnap.val() || {}));
    await db.ref(`payroll_runs/${key}/totals`).set(totals);

    return { item, totals };
  });

  // -------------------------------------------------------------------------
  // adminHrPayrollApprove — ล็อกรอบ
  // -------------------------------------------------------------------------
  const adminHrPayrollApprove = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const key = String((request.data || {}).period || "");
    if (!/^\d{4}-\d{2}$/.test(key)) throw new HttpsError("invalid-argument", "งวดไม่ถูกต้อง");

    const runSnap = await db.ref(`payroll_runs/${key}`).once("value");
    if (!runSnap.exists()) throw new HttpsError("not-found", "ยังไม่มีรอบของงวดนี้");
    const run = runSnap.val();
    if (run.status !== "draft") throw new HttpsError("failed-precondition", "รอบนี้อนุมัติไปแล้ว");

    const itemsSnap = await db.ref(`payroll_items/${key}`).once("value");
    const items = Object.values(itemsSnap.val() || {});
    if (!items.length) throw new HttpsError("failed-precondition", "รอบนี้ไม่มีพนักงานสักคน");

    // ด่านที่สำคัญที่สุดของไฟล์นี้ — ดู doc comment ข้อ 3
    const blocked = items.filter((i) => i && i.incomplete);
    if (blocked.length) {
      throw new HttpsError(
        "failed-precondition",
        `ยังมี ${blocked.length} คนที่กรอกไม่ครบ: ${blocked.slice(0, 3).map((i) => `${i.name || i.employee_id} (${i.incomplete})`).join(" · ")}`
      );
    }

    const at = Date.now();
    const totals = summarizeRun(items);
    await db.ref(`payroll_runs/${key}`).update({
      status: "approved",
      totals,
      approved_at: at,
      ...Object.fromEntries(
        Object.entries(employeeActorFields(callerStaffId, staffMap, request.auth))
          .map(([k, v]) => [k.replace(/^by_/, "approved_by_"), v])
      ),
    });
    console.log(`[hr-payroll] approved ${key} headcount=${totals.headcount} net=${totals.net}`);
    return { ok: true, totals };
  });

  // -------------------------------------------------------------------------
  // adminHrPayrollMarkPaid — ประทับว่าโอนแล้ว
  //
  // ระบบไม่ได้โอนเงินเอง (ยังโอนมือ) ปุ่มนี้จึงบันทึกข้อเท็จจริงว่าโอนแล้ว
  // ไม่ใช่สั่งให้โอน — ข้อความบนปุ่มต้องไม่ทำให้เข้าใจผิดเป็นอย่างอื่น
  // -------------------------------------------------------------------------
  const adminHrPayrollMarkPaid = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const key = String(data.period || "");
    if (!/^\d{4}-\d{2}$/.test(key)) throw new HttpsError("invalid-argument", "งวดไม่ถูกต้อง");

    const runSnap = await db.ref(`payroll_runs/${key}`).once("value");
    if (!runSnap.exists()) throw new HttpsError("not-found", "ยังไม่มีรอบของงวดนี้");
    const run = runSnap.val();
    if (run.status !== "approved") {
      throw new HttpsError("failed-precondition", "ต้องอนุมัติรอบก่อนจึงจะบันทึกว่าจ่ายแล้วได้");
    }

    const at = Date.now();
    await db.ref(`payroll_runs/${key}`).update({
      status: "paid",
      paid_at: at,
      paid_note: String(data.note || "").slice(0, 300) || null,
      ...Object.fromEntries(
        Object.entries(employeeActorFields(callerStaffId, staffMap, request.auth))
          .map(([k, v]) => [k.replace(/^by_/, "paid_by_"), v])
      ),
    });
    console.log(`[hr-payroll] marked paid ${key}`);
    return { ok: true };
  });

  return {
    adminHrPayrollList,
    adminHrPayrollGet,
    adminHrPayrollDraft,
    adminHrPayrollSetItem,
    adminHrPayrollApprove,
    adminHrPayrollMarkPaid,
  };
}

module.exports = { registerHrPayroll, RUN_STATUSES, periodKey, eligibleForPeriod };
