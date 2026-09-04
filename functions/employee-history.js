// ประวัติพนักงาน — เรื่องของ *คน* ไม่ใช่รายการการแก้ฟิลด์
//
// ─── สิ่งที่หน้านี้ตอบ (และของเดิมตอบไม่ได้สักข้อ) ─────────────────────────
//   • ทำงานมานานแค่ไหนแล้ว
//   • เคยอยู่ตำแหน่งไหนบ้าง ตำแหน่งละนานเท่าไร
//   • เงินเดือนขึ้นมากี่ครั้ง **ครั้งละเท่าไร**
//   • ปีนี้ลาไปแล้วกี่วัน
//   • ออกเอกสารอะไรให้ไปแล้วบ้าง
//
// ของเดิมตอบได้อย่างเดียวว่า "มีคนกดแก้ไขเมื่อ 3 ก.ย." ซึ่งเป็นคำถามของ
// **audit log** ไม่ใช่ของประวัติ — และตอบได้ไม่ครบด้วยซ้ำ เพราะไม่เก็บค่า
//
// ─── ไม่มีโหนดที่สาม ─────────────────────────────────────────────────────
// ประวัติเป็นของ **คำนวณ** ไม่ใช่ของที่เก็บ: ข้อเท็จจริงปัจจุบันมาจากแถว
// `employees` · การเปลี่ยนแปลงย้อนหลังมาจาก `audit_log` · วันลาจาก
// `leave_requests` · เอกสารจาก `hr_documents` **ทั้งหมดมีอยู่แล้ว**
// การสร้างโหนด "ประวัติ" ขึ้นมาอีกอันคือสำเนาที่สามที่จะ drift จากสองอันแรก

"use strict";

const DAY = 86400000;

// `Number(null) === 0` และ 0 เป็น finite — เช็ค `Number.isFinite` อย่างเดียว
// จะเปลี่ยน "ไม่ได้เก็บค่าไว้" ให้กลายเป็น **เงินเดือน 0 บาท** บนหน้าประวัติ
// (กับดักตัวเดียวกับที่ CLAUDE.md จดไว้เรื่อง `pickBatteryOptionId` และที่เพิ่ง
// กัดอีกรอบใน `bangkokIsoDate`) — ต้องกัน null/undefined/'' แยกก่อนเสมอ
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * ระยะเวลางานเป็นข้อความไทย
 *
 * ช่องที่ FlowAccount มีแล้วเราไม่มี — และมันคือสิ่งแรกที่คนเปิดประวัติอยากรู้
 *
 * **ไม่มีวันเริ่มงาน = `null` ไม่ใช่ "0 วัน"** — คนที่ข้อมูลเราไม่ครบอาจทำงาน
 * มาสามปีแล้ว การเขียน "0 วัน" คือการรายงานสิ่งที่เราไม่รู้ว่าเป็นศูนย์
 * (กฎเดียวกับ `annualEligibility` ใน hr-leave.js)
 */
function tenure(hiredAt, { now, terminatedAt } = {}) {
  const start = num(hiredAt);
  if (!start || start <= 0) return null;
  const end = num(terminatedAt) || num(now) || Date.now();
  if (end < start) return null;
  const days = Math.floor((end - start) / DAY);
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - years * 365.25) / 30.44);
  return { days, years, months, ended: Boolean(num(terminatedAt)) };
}

function tenureText(t) {
  if (!t) return null;
  if (t.years <= 0 && t.months <= 0) return `${t.days} วัน`;
  if (t.years <= 0) return `${t.months} เดือน`;
  if (t.months <= 0) return `${t.years} ปี`;
  return `${t.years} ปี ${t.months} เดือน`;
}

/** แถว audit ที่แตะฟิลด์นั้น เรียงจากเก่าไปใหม่ */
function changesTo(auditRows, field) {
  return (Array.isArray(auditRows) ? auditRows : [])
    .filter((r) => Array.isArray(r && r.changes) && r.changes.some((c) => c && c.field === field))
    .map((r) => {
      const c = r.changes.find((x) => x && x.field === field);
      return {
        at: num(r.at) || 0,
        from: c.from,
        to: c.to,
        withheld: Boolean(c.withheld),
        by_name: r.actor_name || null,
        reason: r.reason || null,
      };
    })
    .sort((a, b) => a.at - b.at);
}

/**
 * ประวัติเงินเดือน พร้อม **จำนวนเงินจริง** และเปอร์เซ็นต์ที่ขึ้น
 *
 * นี่คือสิ่งที่บรรทัด "ปรับเงินเดือน" บนจอเดิมพูดไม่ได้ — มันเขียนแก้ตัวว่า
 * *"ระบบไม่ได้บันทึกจำนวนเงินไว้ในประวัติ"* แล้วชี้ให้ไปกดปุ่มแก้ไขเพื่อดู
 * **ค่าปัจจุบัน** ซึ่งไม่ใช่ประวัติ
 */
function salaryHistory(auditRows, { field = "base_salary" } = {}) {
  return changesTo(auditRows, field).map((c) => {
    const from = num(c.from);
    const to = num(c.to);
    const pct = from && to && from > 0 ? Math.round(((to - from) / from) * 1000) / 10 : null;
    return { at: c.at, from, to, pct, by_name: c.by_name, reason: c.reason, withheld: c.withheld };
  });
}

/**
 * ตำแหน่งที่เคยอยู่ พร้อมช่วงเวลาและจำนวนวัน
 *
 * ประกอบจาก "ตำแหน่งแรก" (ค่า `from` ของการเปลี่ยนครั้งแรก — หรือค่าปัจจุบัน
 * ถ้าไม่เคยเปลี่ยน) แล้วไล่ต่อกันไป ปิดท้ายด้วยตำแหน่งปัจจุบันที่ยังไม่จบ
 */
function positionHistory({ employee, auditRows, now }) {
  const emp = employee || {};
  const changes = changesTo(auditRows, "position");
  const at = num(emp.hired_at) || (changes[0] ? changes[0].at : null);
  const end = num(emp.terminated_at) || num(now) || Date.now();

  if (!changes.length) {
    if (!emp.position) return [];
    return [{ position: emp.position, from: at, to: null, days: at ? Math.floor((end - at) / DAY) : null, current: true }];
  }

  const rows = [];
  let cursor = at;
  let title = changes[0].from || emp.position || null;
  for (const c of changes) {
    rows.push({
      position: title,
      from: cursor,
      to: c.at,
      days: cursor ? Math.floor((c.at - cursor) / DAY) : null,
      current: false,
    });
    cursor = c.at;
    title = c.to;
  }
  rows.push({
    position: title,
    from: cursor,
    to: null,
    days: cursor ? Math.floor((end - cursor) / DAY) : null,
    current: true,
  });
  return rows.filter((r) => r.position);
}

/** ช่วงสถานะการจ้าง (ทดลองงาน → ทำงานอยู่ → พ้นสภาพ) */
function statusHistory({ employee, auditRows }) {
  const emp = employee || {};
  const changes = changesTo(auditRows, "status");
  const rows = changes.map((c) => ({ at: c.at, from: c.from, to: c.to, by_name: c.by_name }));
  if (num(emp.hired_at)) rows.unshift({ at: num(emp.hired_at), from: null, to: "hired", by_name: null });
  return rows;
}

/** สรุปวันลาของปีนั้น จาก `leave_requests` (ที่อนุมัติแล้วเท่านั้น) */
function leaveSummaryByYear(leaveRows) {
  const byYear = {};
  for (const r of Array.isArray(leaveRows) ? leaveRows : []) {
    if (!r || r.status !== "approved") continue;
    const y = String(r.from || "").slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    if (!byYear[y]) byYear[y] = { year: y, days: 0, paid_days: 0, unpaid_days: 0, by_type: {} };
    const b = byYear[y];
    b.days += Number(r.days) || 0;
    b.paid_days += Number(r.paid_days) || 0;
    b.unpaid_days += Number(r.unpaid_days) || 0;
    const t = String(r.type || "other");
    b.by_type[t] = (b.by_type[t] || 0) + (Number(r.days) || 0);
  }
  return Object.values(byYear).sort((a, b) => b.year.localeCompare(a.year));
}

/**
 * ประกอบประวัติทั้งหน้า
 *
 * `canSeePay` เป็นของผู้เรียก ไม่ใช่ของไฟล์นี้ — แต่ต้องส่งเข้ามาเพราะ
 * ประวัติเงินเดือนถูกตัดออกทั้งท่อนเมื่อไม่มีสิทธิ์ ไม่ใช่ซ่อนที่ UI
 * (ซ่อนที่ UI = ข้อมูลยังเดินทางไปถึงเบราว์เซอร์)
 */
function buildEmployeeHistory({ employee, auditRows, leaveRows, documents, now, canSeePay = true }) {
  const emp = employee || {};
  const t = tenure(emp.hired_at, { now, terminatedAt: emp.terminated_at });
  return {
    summary: {
      tenure_days: t ? t.days : null,
      tenure_text: tenureText(t),
      tenure_ended: t ? t.ended : false,
      position: emp.position || null,
      department: emp.department || null,
      status: emp.status || null,
      hired_at: num(emp.hired_at),
      terminated_at: num(emp.terminated_at),
    },
    positions: positionHistory({ employee: emp, auditRows, now }),
    statuses: statusHistory({ employee: emp, auditRows }),
    // ไม่มีสิทธิ์ดูเงินเดือน = ไม่ส่งท่อนนี้เลย (ไม่ใช่ส่งแล้วซ่อน)
    salary: canSeePay ? salaryHistory(auditRows) : null,
    leave_by_year: leaveSummaryByYear(leaveRows),
    documents: (Array.isArray(documents) ? documents : []).map((d) => ({
      id: d.id,
      type: d.type || null,
      number: d.number || null,
      issued_at: num(d.issued_at),
    })).sort((a, b) => (b.issued_at || 0) - (a.issued_at || 0)),
  };
}

module.exports = {
  tenure,
  tenureText,
  changesTo,
  salaryHistory,
  positionHistory,
  statusHistory,
  leaveSummaryByYear,
  buildEmployeeHistory,
};
