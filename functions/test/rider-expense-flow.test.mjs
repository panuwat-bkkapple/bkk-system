// ---------------------------------------------------------------------------
// เส้นทางใบเบิกค่าใช้จ่ายไรเดอร์ — ด่านของตาราง transition
//
//   node functions/test/rider-expense-flow.test.mjs
//
// สิ่งที่ตารางนี้ถือไว้ และพังแล้วเงียบทุกข้อ:
//
//   เงินขยับผิดขั้น       = คนที่ตรวจว่า "วิ่งงานจริงไหม" กลายเป็นคนสั่งจ่ายเงิน
//   ข้ามขั้นบัญชีได้      = จ่ายโดยไม่มีใครตรวจเอกสาร ซึ่งเป็นเหตุผลที่แยกขั้น
//   ออกจากสถานะปลายทาง   = จ่ายซ้ำ / ปลุกใบที่ปฏิเสธไปแล้ว
//   ตีกลับผิดฝ่าย         = บัญชีตีกลับใบที่หัวหน้ายังไม่ได้แตะ
//
// ผล injection (วัดจริงทุกข้อ):
//
//   1. ให้ ops_approve มี movesMoney: true          → แดง 2 (assert ตอนโหลด + เทสเงิน)
//   2. เพิ่ม 'approved' เข้า from ของ pay           → แดง 1 (ข้ามขั้นบัญชี)
//   3. ถอด TERMINAL ออกจาก resolveTransition        → แดง 2 (paid/rejected เดินต่อได้)
//   4. ให้ gateForStatus คืน OPS ทุกสถานะ           → แดง 2 (ตีกลับผิดฝ่าย)
//   5. เปลี่ยน to ของ finance_approve เป็น 'paid'   → แดง 1
//   6. ลบ assert "เงินขยับที่ pay ที่เดียว"          → **เขียว** — เพราะเทสข้อเงิน
//      จับได้อยู่แล้วโดยไม่ต้องพึ่ง assert ตอนโหลด. เก็บ assert ไว้เพราะมันจับ
//      *ตอนโหลดไฟล์* ซึ่งดังกว่าและถึงคนที่เพิ่ม action ใหม่โดยไม่ได้รันเทส
//      — บันทึกไว้ตรงๆ ว่าไม่มีเทสคุ้ม แทนที่จะแต่งเคสให้ดูเหมือนมี
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const flow = require(join(here, "..", "rider-expense-flow.js"));
const { EXPENSE_STATUS: S, GATE, TRANSITIONS, resolveTransition } = flow;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

// --- เส้นทางปกติ เดินครบทุกขั้นตามที่เจ้าของงานกำหนด ----------------------
{
  const a = resolveTransition("ops_approve", S.SUBMITTED);
  check("submitted + ops_approve → approved", a.ok && a.to === S.APPROVED);
  check("ขั้นแรกเป็นของ ops", a.gate === GATE.OPS);
  check("ขั้นแรกไม่แตะเงิน", a.movesMoney === false);

  const b = resolveTransition("finance_approve", S.APPROVED);
  check("approved + finance_approve → finance_approved", b.ok && b.to === S.FINANCE_APPROVED);
  check("ขั้นบัญชีเป็นของ finance", b.gate === GATE.FINANCE);
  check("การตั้งเบิกยังไม่แตะเงิน", b.movesMoney === false);

  const c = resolveTransition("pay", S.FINANCE_APPROVED);
  check("finance_approved + pay → paid", c.ok && c.to === S.PAID);
  check("การจ่ายเป็นของ finance", c.gate === GATE.FINANCE);
  check("เงินขยับที่ pay", c.movesMoney === true);
}

// --- เงินขยับที่เดียว: ข้อที่แพงที่สุดถ้าหลุด -----------------------------
{
  const movers = Object.entries(TRANSITIONS)
    .filter(([, t]) => t.movesMoney)
    .map(([n]) => n);
  check("มี action เดียวที่ขยับเงิน และคือ pay", movers.length === 1 && movers[0] === "pay");

  // ไล่ทุกคู่ (action × สถานะ) — ไม่มีทางไหนขยับเงินได้นอกจากคู่เดียว
  const all = [];
  for (const action of Object.keys(TRANSITIONS)) {
    for (const st of Object.values(S)) {
      const r = resolveTransition(action, st);
      if (r.ok && r.movesMoney) all.push(`${st}+${action}`);
    }
  }
  check(
    "ทั้งตาราง มีทางเดียวที่เงินขยับ = finance_approved+pay",
    all.length === 1 && all[0] === `${S.FINANCE_APPROVED}+pay`
  );
}

// --- ข้ามขั้นไม่ได้ --------------------------------------------------------
{
  const skip = resolveTransition("pay", S.APPROVED);
  check("จ่ายข้ามขั้นบัญชีไม่ได้", !skip.ok && skip.code === "wrong_status");

  const skip2 = resolveTransition("pay", S.SUBMITTED);
  check("จ่ายตั้งแต่ยังไม่มีใครอนุมัติไม่ได้", !skip2.ok && skip2.code === "wrong_status");

  const skip3 = resolveTransition("finance_approve", S.SUBMITTED);
  check("บัญชีอนุมัติก่อนหัวหน้าไม่ได้", !skip3.ok && skip3.code === "wrong_status");

  const back = resolveTransition("ops_approve", S.APPROVED);
  check("อนุมัติซ้ำขั้นเดิมไม่ได้", !back.ok && back.code === "wrong_status");
}

// --- สถานะปลายทางออกไม่ได้ = กันจ่ายซ้ำ -----------------------------------
{
  for (const action of Object.keys(TRANSITIONS)) {
    const r = resolveTransition(action, S.PAID);
    check(`paid + ${action} ถูกปฏิเสธ`, !r.ok && r.code === "terminal");
  }
  const r = resolveTransition("ops_approve", S.REJECTED);
  check("rejected ปลุกกลับมาไม่ได้", !r.ok && r.code === "terminal");
}

// --- ตีกลับ / ปฏิเสธ เป็นของฝ่ายที่ถือใบอยู่ตอนนั้น ------------------------
{
  const s = resolveTransition("send_back", S.SUBMITTED);
  check("ตีกลับตอน submitted เป็นของ ops", s.ok && s.gate === GATE.OPS);
  check("ตีกลับต้องมีเหตุผล", s.needsReason === true);
  check("ตีกลับไป needs_info ไม่ใช่ submitted", s.to === S.NEEDS_INFO);

  const f = resolveTransition("send_back", S.APPROVED);
  check("ตีกลับตอน approved เป็นของบัญชี", f.ok && f.gate === GATE.FINANCE);

  const f2 = resolveTransition("reject", S.FINANCE_APPROVED);
  check("ปฏิเสธตอนตั้งเบิกแล้วเป็นของบัญชี", f2.ok && f2.gate === GATE.FINANCE);
  check("ปฏิเสธต้องมีเหตุผล", f2.needsReason === true);

  const n = resolveTransition("ops_approve", S.NEEDS_INFO);
  check("ใบที่ตีกลับแล้วต้องให้ไรเดอร์ส่งใหม่ ไม่ใช่อนุมัติต่อ",
    !n.ok && n.code === "wrong_status");
}

// --- คำสั่งที่ไม่รู้จัก ----------------------------------------------------
{
  const r = resolveTransition("approve", S.SUBMITTED);
  check("คำสั่งเก่า 'approve' ไม่ผ่านตารางใหม่", !r.ok && r.code === "unknown_action");
}

// --- ทุก transition ต้องระบุ gate ได้เสมอ ---------------------------------
{
  let missing = 0;
  for (const action of Object.keys(TRANSITIONS)) {
    for (const st of TRANSITIONS[action].from) {
      const r = resolveTransition(action, st);
      if (r.ok && r.gate !== GATE.OPS && r.gate !== GATE.FINANCE) missing += 1;
    }
  }
  check("ทุกคู่ที่เดินได้ ระบุประตูได้เสมอ", missing === 0);
}

console.log(failures === 0 ? "\nOK" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
