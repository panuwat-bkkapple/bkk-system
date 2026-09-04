// ---------------------------------------------------------------------------
// เบิกค่าใช้จ่ายไรเดอร์ — ด่านของ multi-path update ตอนจ่ายเงิน
//
//   node functions/test/rider-expenses.test.mjs
//
// การอนุมัติหนึ่งครั้งแตะสามโหนดพร้อมกัน (กระเป๋าไรเดอร์ / บัญชีบริษัท /
// สถานะรายการ) ซึ่งแปลว่ามีสามวิธีที่มันจะพังแบบครึ่งๆ:
//
//   เงินเข้ากระเป๋าแต่ไม่ลงบัญชี  = กำไรสูงเกินจริงทุกเดือนโดยไม่มีใครเห็น
//   ลงบัญชีแต่เงินไม่เข้ากระเป๋า  = ไรเดอร์ไม่ได้เงินที่เขาสำรองจ่ายไป
//   สถานะไม่เปลี่ยน               = อนุมัติซ้ำได้ = จ่ายสองรอบ
//
// และบทเรียนของ pin-dispute (1 ก.ย. 2569) เพิ่มข้อที่สี่: RTDB ปฏิเสธทั้ง
// update ถ้ามี path ใดเป็นบรรพบุรุษของอีก path ในก้อนเดียวกัน แล้วเด้งถึง
// แอดมินเป็นคำว่า "INTERNAL" เฉยๆ — จึงตรวจ **รูปของ update map** ด้วย
// ไม่ใช่แค่ค่าที่อยู่ในนั้น
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { buildPaymentUpdates, buildTransitionUpdates, authorizeExpenseAction } = require(
  join(here, "..", "rider-expenses.js")
);
const { financeActorVerdict } = require(join(here, "..", "finance-claims.js"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

/** คืนคู่ path ที่ซ้อนกัน (ว่าง = ปลอดภัย) */
function ancestorOverlaps(updates) {
  const keys = Object.keys(updates);
  const bad = [];
  for (const x of keys) for (const y of keys) {
    if (x !== y && y.startsWith(`${x}/`)) bad.push([x, y]);
  }
  return bad;
}

const ROW = {
  rider_id: "riderA",
  job_id: "OID-ABCDEFGH-384",
  category: "toll",
  amount_thb: 65,
  note: "ทางด่วนขาไปรับเครื่อง",
};
const ACTOR = { id: "staff1", name: "สมชาย" };
const NOW = 1_756_000_000_000;

const build = (over = {}) =>
  buildPaymentUpdates({
    id: "exp1",
    row: { ...ROW, ...(over.row || {}) },
    actor: ACTOR,
    txKey: "tx1",
    expenseKey: "ex1",
    now: NOW,
    taxable: over.taxable === true,
    from: "finance_approved",
    to: "paid",
    historyKey: "h1",
  });

// --- รูปของ update map -----------------------------------------------------

{
  const { updates } = build();
  check(
    "ไม่มี path ไหนเป็นบรรพบุรุษของอีก path (RTDB จะปฏิเสธทั้งก้อน)",
    ancestorOverlaps(updates).length === 0
  );
  check(
    "แตะครบสามโหนดในก้อนเดียว — ครึ่งๆ ไม่ได้",
    Object.keys(updates).some((k) => k.startsWith("rider_expenses/")) &&
      Object.keys(updates).some((k) => k.startsWith("transactions/")) &&
      Object.keys(updates).some((k) => k.startsWith("expenses/"))
  );
}

// --- แถวกระเป๋าไรเดอร์ ------------------------------------------------------

{
  const { updates } = build();
  const tx = updates["transactions/tx1"];
  check("เป็น CREDIT (เงินเข้า ไม่ใช่เงินออก)", tx.type === "CREDIT");
  check(
    "หมวด EXPENSE_REIMBURSEMENT ไม่ใช่ BONUS — โบนัสเป็นเงินได้ เงินคืนไม่ใช่",
    tx.category === "EXPENSE_REIMBURSEMENT"
  );
  check("ยอดตรงกับที่ยื่น", tx.amount === 65);
  check("ผูกกลับไปหางาน", tx.ref_job_id === ROW.job_id);
  check("ผูกกลับไปหารายการเบิก (ตามรอยสองทาง)", tx.rider_expense_id === "exp1");
  check(
    "มีฟิลด์ taxable เขียนลงแถวตรงๆ ไม่ปล่อยให้ไปอนุมานจากชื่อหมวดทีหลัง",
    Object.prototype.hasOwnProperty.call(tx, "taxable")
  );
  check("ค่าเริ่มต้นคือไม่ใช่เงินได้", tx.taxable === false);
}

{
  // คำตอบนักบัญชีออกมาอีกทางก็ต้องเขียนได้โดยไม่ต้องแก้โค้ด
  const { updates } = build({ taxable: true });
  check("ตั้ง taxable: true ได้จาก settings", updates["transactions/tx1"].taxable === true);
}

// --- แถวบัญชีบริษัท --------------------------------------------------------

{
  const { updates } = build();
  const ex = updates["expenses/ex1"];
  check("ลงหมวด TRANSPORT ที่ P&L อ่าน", ex.category === "TRANSPORT");
  check("ยอดเท่ากับที่จ่ายไรเดอร์ ไม่ใช่คนละเลข", ex.amount === 65);
  check(
    "มี source แยกแถวที่ระบบสร้างออกจากแถวที่แอดมินคีย์มือ (กันนับซ้ำ)",
    ex.source === "rider_expense"
  );
  check("ตามรอยกลับไปหารายการเบิกได้", ex.rider_expense_id === "exp1");
  check("มี created_at ให้ตัวรวมรายเดือนจัดงวดได้", ex.created_at === NOW);
}

// --- ขั้นที่ไม่ใช่การจ่าย ห้ามแตะเงินแม้แต่โหนดเดียว ------------------------
//
// ข้อนี้คือหัวใจของการแยกขั้น: ถ้ามันหลุด คนที่ตรวจว่า "วิ่งงานจริงไหม"
// จะกลายเป็นคนสั่งจ่ายเงินอีกครั้ง ซึ่งคือพฤติกรรมเดิมที่งานนี้มาแก้พอดี
{
  for (const action of ["ops_approve", "finance_approve", "send_back", "reject", "resubmit"]) {
    const updates = buildTransitionUpdates({
      id: "exp1",
      action,
      from: "submitted",
      to: "approved",
      actor: ACTOR,
      now: NOW,
      reason: "เอกสารไม่ครบ",
      historyKey: "h1",
    });
    const touched = Object.keys(updates);
    check(
      `${action} ไม่แตะกระเป๋าไรเดอร์และบัญชีบริษัท`,
      !touched.some((k) => k.startsWith("transactions/") || k.startsWith("expenses/"))
    );
  }
}

// --- ประวัติต่อขั้น: ฟิลด์เดี่ยวตอบ "ใครอนุมัติขั้นไหน" ไม่ได้เมื่อวนหลายรอบ --
{
  const updates = buildTransitionUpdates({
    id: "exp1",
    action: "finance_approve",
    from: "approved",
    to: "finance_approved",
    actor: ACTOR,
    now: NOW,
    reason: "",
    historyKey: "h9",
  });
  const h = updates["rider_expenses/exp1/history/h9"];
  check("มีแถวประวัติของขั้นนั้น", !!h);
  check("บันทึกทั้งต้นทางและปลายทาง ไม่ใช่แค่ปลายทาง",
    h.from === "approved" && h.to === "finance_approved");
  check("บันทึกว่าใครกด", h.by_staff_id === "staff1" && h.action === "finance_approve");
  check("ไม่มีเหตุผลก็ไม่ต้องมีคีย์ reason ค้าง",
    !Object.prototype.hasOwnProperty.call(h, "reason"));
  check("สถานะเดินไปปลายทางที่ตารางบอก",
    updates["rider_expenses/exp1/status"] === "finance_approved");
  check("ไม่มี path ไหนเป็นบรรพบุรุษของอีก path",
    ancestorOverlaps(updates).length === 0);
}

// --- เหตุผลของการปฏิเสธต้องไปถึงคนอ่านเดิมด้วย -----------------------------
{
  const rej = buildTransitionUpdates({
    id: "exp1", action: "reject", from: "approved", to: "rejected",
    actor: ACTOR, now: NOW, reason: "ไม่มีใบเสร็จ", historyKey: "h2",
  });
  check("เขียน review_reason (ชื่อใหม่ ใช้ได้ทุกขั้น)",
    rej["rider_expenses/exp1/review_reason"] === "ไม่มีใบเสร็จ");
  check("เขียน reject_reason คู่ไว้ให้จอที่ยังอ่านชื่อเดิม",
    rej["rider_expenses/exp1/reject_reason"] === "ไม่มีใบเสร็จ");

  const back = buildTransitionUpdates({
    id: "exp1", action: "send_back", from: "approved", to: "needs_info",
    actor: ACTOR, now: NOW, reason: "ขอใบเสร็จตัวจริง", historyKey: "h3",
  });
  check(
    "ตีกลับไม่เขียน reject_reason — ใบที่ยังไม่ตายต้องไม่อ่านเหมือนใบที่ถูกปฏิเสธ",
    !Object.prototype.hasOwnProperty.call(back, "rider_expenses/exp1/reject_reason")
  );
  check("แต่เหตุผลยังไปถึงไรเดอร์ทางฟิลด์กลาง",
    back["rider_expenses/exp1/review_reason"] === "ขอใบเสร็จตัวจริง");

  const ok = buildTransitionUpdates({
    id: "exp1", action: "ops_approve", from: "submitted", to: "approved",
    actor: ACTOR, now: NOW, reason: "", historyKey: "h4",
  });
  check(
    "ขั้นที่ไม่มีเหตุผล ล้างเหตุผลเก่าทิ้ง (null = ลบคีย์) ไม่ค้างข้อความรอบก่อน",
    ok["rider_expenses/exp1/review_reason"] === null
  );
}

// --- สถานะรายการ -----------------------------------------------------------

{
  const { updates } = build();
  check(
    "สถานะไปเป็น paid — ไม่งั้นอนุมัติซ้ำได้แล้วจ่ายสองรอบ",
    updates["rider_expenses/exp1/status"] === "paid"
  );
  check("บันทึกว่าใครกดจ่าย", updates["rider_expenses/exp1/reviewed_by_staff_id"] === "staff1");
  check("การจ่ายก็ทิ้งแถวประวัติเหมือนขั้นอื่น",
    updates["rider_expenses/exp1/history/h1"].action === "pay");
  check(
    "ชี้ไปที่แถว ledger กับแถวบัญชีที่เพิ่งสร้าง",
    updates["rider_expenses/exp1/paid_tx_id"] === "tx1" &&
      updates["rider_expenses/exp1/expense_doc_id"] === "ex1"
  );
}

// --- รายการที่ไม่ผูกงาน ----------------------------------------------------

{
  const { updates } = build({ row: { job_id: null } });
  const tx = updates["transactions/tx1"];
  check(
    "ไม่ผูกงาน = ไม่มี ref_job_id ค้างเป็น null (คีย์ null ทำให้ query by job พลาด)",
    !Object.prototype.hasOwnProperty.call(tx, "ref_job_id")
  );
  check(
    "คำอธิบายยังอ่านออกโดยไม่มีเลขงานห้อยท้าย",
    typeof tx.description === "string" && !tx.description.includes("#")
  );
}

// --- ยอดที่คืนออกมาต้องเท่ากับที่เขียนจริง --------------------------------

{
  const { amount, updates } = build({ row: { amount_thb: "120" } });
  check(
    "amount ที่คืนกับที่เขียนลง ledger เป็นตัวเลขตัวเดียวกัน (สตริงจากฟอร์มก็ต้องได้)",
    amount === 120 && updates["transactions/tx1"].amount === 120
  );
}

// --- ใครกดขั้นไหนได้ -------------------------------------------------------
//
// ส่วนนี้ผิดแล้ว**เงียบที่สุด**ในทั้งฟีเจอร์: ปล่อยผิดคนแล้วเงินออกโดยไม่มี error
// ที่ไหนเลย และไม่มีใครเห็นจนกว่าจะกระทบยอด
{
  const ops = (staff, needsCeo) =>
    authorizeExpenseAction({ gate: "ops", staff, token: {}, needsCeo });
  const fin = (staff, needsCeo, token) =>
    authorizeExpenseAction({ gate: "finance", staff, token: token || {}, needsCeo });

  check("หัวหน้า (MANAGER) ยืนยันงานที่วิ่งจริงได้", ops({ role: "MANAGER" }, false).ok);
  check("CEO ทำขั้นของ ops ได้", ops({ role: "CEO" }, false).ok);
  check("STAFF ทำขั้นของ ops ไม่ได้", !ops({ role: "STAFF" }, false).ok);
  check(
    "FINANCE ไม่ใช่คนตอบว่างานวิ่งจริงไหม — เขาไม่ได้อยู่หน้างาน",
    !ops({ role: "FINANCE" }, false).ok
  );
  check("ยอดใหญ่ไม่ได้ห้าม ops ยืนยันงาน (เพดานเป็นเรื่องของการจ่าย)",
    ops({ role: "MANAGER" }, true).ok);

  check("บัญชีทำขั้นบัญชีได้", fin({ role: "FINANCE" }, false).ok);
  check(
    "MANAGER ทำขั้นบัญชีไม่ได้ — นี่คือการแยกหน้าที่ที่ทั้งงานนี้มีไว้ทำ",
    !fin({ role: "MANAGER" }, false).ok
  );
  check("STAFF ที่ CEO เปิดสิทธิ์ให้ ทำขั้นบัญชีได้",
    fin({ role: "STAFF" }, false, { finance_disburse: true }).ok);
  check("ยอดเกินเพดาน บัญชีทำเองไม่ได้ ต้อง CEO", !fin({ role: "FINANCE" }, true).ok);
  check("ยอดเกินเพดาน CEO ทำได้", fin({ role: "CEO" }, true).ok);
  check(
    "เพดานบังคับที่ขั้นบัญชี ไม่ใช่แค่ปุ่มจ่าย (เอกสารออกตอนตั้งเบิก)",
    !fin({ role: "STAFF" }, true, { finance_disburse: true }).ok
  );

  check(
    "ประตูที่ไม่รู้จัก (สถานะใหม่ที่ลืมกำหนดสิทธิ์) = ปฏิเสธ ไม่ใช่ปล่อยผ่าน",
    !authorizeExpenseAction({ gate: null, staff: { role: "CEO" }, token: {}, needsCeo: false }).ok
  );
  check(
    "ทุกการปฏิเสธมีข้อความบอกเหตุผล ไม่ใช่ปุ่มที่กดแล้วเงียบ",
    typeof ops({ role: "STAFF" }, false).message === "string" &&
      ops({ role: "STAFF" }, false).message.length > 0
  );
}

// --- ประตูฝ่ายบัญชี ---------------------------------------------------------
//
// ตารางความจริงชุดนี้ **ซ้ำกับ `src/utils/financeGate.test.ts` โดยตั้งใจ** —
// `isFinanceActor` ฝั่ง TS เป็นมิเรอร์ของตัวนี้ (functions import TS ไม่ได้)
// เคสเดียวกันสองที่ = drift โผล่เป็นสีแดงข้างเดียว ไม่ใช่ความเงียบ
{
  const cases = [
    ["CEO ผ่านเสมอแม้ไม่มี claim", { role: "CEO" }, {}, true],
    ["FINANCE ผ่านด้วย role ที่ resolve ฝั่ง server", { role: "FINANCE" }, {}, true],
    ["ใครก็ตามที่มี claim ผ่าน", { role: "STAFF" }, { finance_disburse: true }, true],
    ["MANAGER ไม่ใช่ฝ่ายบัญชี", { role: "MANAGER" }, {}, false],
    ["STAFF ไม่ผ่าน", { role: "STAFF" }, {}, false],
    ["ไม่มี staff record ไม่ผ่าน", null, {}, false],
    ["claim ที่ไม่ใช่ true เป๊ะ ไม่นับ", { role: "STAFF" }, { finance_disburse: "true" }, false],
  ];
  for (const [label, staff, token, want] of cases) {
    check(label, financeActorVerdict(staff, token).allowed === want);
  }
  check(
    "ไม่มี token เลย (เรียกจากที่ไม่มี auth) ต้องไม่พัง",
    financeActorVerdict({ role: "STAFF" }, undefined).allowed === false
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
