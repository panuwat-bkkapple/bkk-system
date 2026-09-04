// ---------------------------------------------------------------------------
// เส้นทางของใบเบิกค่าใช้จ่ายไรเดอร์ — ตารางเดียว ไม่กระจายเป็น if
//
// เจ้าของงานกำหนดไว้ (4 ก.ย. 2569):
//
//   ไรเดอร์ตั้งเบิก → แอดมิน/หัวหน้าตรวจ กดอนุมัติ → ส่งเข้าฝ่ายบัญชี
//   → บัญชีกดอนุมัติ → บัญชีจ่ายเงิน → ออกเอกสาร
//
// **"บัญชีกดอนุมัติ" กับ "บัญชีจ่ายเงิน" ไม่ยุบเป็นปุ่มเดียว** แม้เป็นคนเดียวกันกด
// — *ตั้งเบิก* กับ *จ่าย* เป็นคนละการกระทำทางบัญชี และการมีสถานะ "ตั้งเบิกแล้ว
// แต่ยังไม่จ่าย" คือสิ่งเดียวที่ทำให้บัญชีรู้ว่าค้างจ่ายอยู่เท่าไร ถ้ายุบ ตัวเลข
// นั้นหายไปจากระบบโดยไม่มีที่อื่นเก็บแทน
//
// **เงินขยับที่ `pay` ที่เดียว** และบังคับด้วยโครงสร้าง ไม่ใช่ด้วยวินัย:
// `movesMoney` เป็น true ได้ตัวเดียวในตาราง และมีเทสตรึงข้อนี้ไว้ — ก่อนหน้านี้
// การกดอนุมัติครั้งเดียวเครดิตกระเป๋าทันที ซึ่งแปลว่าคนที่ตรวจว่า "วิ่งงานนั้น
// จริงไหม" เป็นคนสั่งจ่ายเงินไปด้วยในตัว
//
// **ทุก transition ต้องระบุ `gate`** — เพิ่มแถวใหม่โดยไม่ตัดสินว่าใครกดได้จะ
// throw ตั้งแต่ตอนโหลดไฟล์ (ดู assert ท้ายไฟล์) ไม่ใช่รอให้หลุดไป production
// แล้วค่อยรู้ว่ามีปุ่มที่ใครก็กดได้
// ---------------------------------------------------------------------------

const EXPENSE_STATUS = {
  SUBMITTED: "submitted",
  APPROVED: "approved",
  FINANCE_APPROVED: "finance_approved",
  PAID: "paid",
  NEEDS_INFO: "needs_info",
  REJECTED: "rejected",
};

/** สถานะปลายทาง — ไม่มี action ไหนออกจากตรงนี้ได้อีก */
const TERMINAL = [EXPENSE_STATUS.PAID, EXPENSE_STATUS.REJECTED];

/** ประตูสองบาน: `ops` = แอดมิน/หัวหน้าไรเดอร์ · `finance` = ฝ่ายบัญชี */
const GATE = { OPS: "ops", FINANCE: "finance" };

/**
 * ตารางเส้นทางทั้งหมด — ที่เดียว
 *
 * `send_back` มีได้จากทุกขั้นก่อนจ่าย และ **ตั้งใจให้กลับไป `needs_info` ไม่ใช่
 * `submitted`** เพราะสองอย่างนี้คนละความหมายกับไรเดอร์: `submitted` = ส่งแล้ว
 * รอเขา, `needs_info` = ต้องแก้อะไรบางอย่างก่อน ถ้ายุบเป็นสถานะเดียวไรเดอร์จะ
 * เห็นใบเด้งกลับมาโดยไม่รู้ว่าต้องทำอะไร
 */
const TRANSITIONS = {
  ops_approve: {
    from: [EXPENSE_STATUS.SUBMITTED],
    to: EXPENSE_STATUS.APPROVED,
    gate: GATE.OPS,
    movesMoney: false,
    needsReason: false,
  },
  finance_approve: {
    from: [EXPENSE_STATUS.APPROVED],
    to: EXPENSE_STATUS.FINANCE_APPROVED,
    gate: GATE.FINANCE,
    movesMoney: false,
    needsReason: false,
  },
  pay: {
    from: [EXPENSE_STATUS.FINANCE_APPROVED],
    to: EXPENSE_STATUS.PAID,
    gate: GATE.FINANCE,
    movesMoney: true,
    needsReason: false,
  },
  send_back: {
    from: [
      EXPENSE_STATUS.SUBMITTED,
      EXPENSE_STATUS.APPROVED,
      EXPENSE_STATUS.FINANCE_APPROVED,
    ],
    to: EXPENSE_STATUS.NEEDS_INFO,
    // ตีกลับได้ทั้งสองฝ่าย — บัญชีเจอเอกสารไม่ครบ หรือหัวหน้าเห็นว่ารูปไม่ชัด
    gate: null,
    movesMoney: false,
    needsReason: true,
  },
  reject: {
    from: [
      EXPENSE_STATUS.SUBMITTED,
      EXPENSE_STATUS.APPROVED,
      EXPENSE_STATUS.FINANCE_APPROVED,
    ],
    gate: null,
    to: EXPENSE_STATUS.REJECTED,
    movesMoney: false,
    needsReason: true,
  },
};

/**
 * ใครกดได้บ้างจากสถานะนี้ — ใช้ตัดสินว่า `send_back`/`reject` เป็นของฝ่ายไหน
 * (ทั้งสอง action มี `gate: null` เพราะกดได้ทั้งคู่ แต่ **ต้องเป็นฝ่ายที่ถือ
 * ใบอยู่ตอนนั้น** ไม่ใช่ใครก็ได้ — บัญชีตีกลับใบที่หัวหน้ายังไม่แตะไม่ได้)
 */
function gateForStatus(status) {
  if (status === EXPENSE_STATUS.SUBMITTED) return GATE.OPS;
  if (
    status === EXPENSE_STATUS.APPROVED ||
    status === EXPENSE_STATUS.FINANCE_APPROVED
  ) {
    return GATE.FINANCE;
  }
  return null;
}

/**
 * @returns {{ok: true, to, gate, movesMoney, needsReason}
 *          |{ok: false, code: 'unknown_action'|'terminal'|'wrong_status', message}}
 *
 * คืนเหตุผลที่มีชื่อ ไม่ใช่ throw — ตัว callable เป็นคนแปลงเป็น HttpsError
 * เพื่อให้เทสตารางได้โดยไม่ต้องมี firebase-functions
 */
function resolveTransition(action, currentStatus) {
  const t = TRANSITIONS[action];
  if (!t) {
    return { ok: false, code: "unknown_action", message: `ไม่รู้จักคำสั่ง ${action}` };
  }
  if (TERMINAL.includes(currentStatus)) {
    return {
      ok: false,
      code: "terminal",
      message: `รายการนี้จบแล้ว (${currentStatus})`,
    };
  }
  if (!t.from.includes(currentStatus)) {
    return {
      ok: false,
      code: "wrong_status",
      message: `ทำขั้นนี้ไม่ได้ตอนสถานะเป็น ${currentStatus}`,
    };
  }
  return {
    ok: true,
    to: t.to,
    gate: t.gate || gateForStatus(currentStatus),
    movesMoney: t.movesMoney === true,
    needsReason: t.needsReason === true,
  };
}

// --- ด่านตอนโหลดไฟล์ ------------------------------------------------------
// เพิ่ม action ใหม่แล้วลืมตัดสินสามข้อนี้ = ไฟล์โหลดไม่ขึ้น ซึ่งดังกว่าการ
// ปล่อยให้ default เงียบๆ พาไปถึง production
for (const [name, t] of Object.entries(TRANSITIONS)) {
  if (!Array.isArray(t.from) || t.from.length === 0) {
    throw new Error(`rider-expense-flow: ${name} ไม่ได้ระบุ from`);
  }
  if (!Object.values(EXPENSE_STATUS).includes(t.to)) {
    throw new Error(`rider-expense-flow: ${name} ปลายทาง ${t.to} ไม่อยู่ใน EXPENSE_STATUS`);
  }
  if (typeof t.movesMoney !== "boolean") {
    throw new Error(`rider-expense-flow: ${name} ไม่ได้ตัดสินว่าขยับเงินไหม`);
  }
  if (t.gate !== null && !Object.values(GATE).includes(t.gate)) {
    throw new Error(`rider-expense-flow: ${name} gate ไม่ถูกต้อง`);
  }
}

const moneyActions = Object.entries(TRANSITIONS).filter(([, t]) => t.movesMoney);
if (moneyActions.length !== 1 || moneyActions[0][0] !== "pay") {
  throw new Error(
    "rider-expense-flow: เงินต้องขยับที่ `pay` ที่เดียวเท่านั้น " +
      `(ตอนนี้: ${moneyActions.map(([n]) => n).join(", ") || "ไม่มีเลย"})`
  );
}

module.exports = {
  EXPENSE_STATUS,
  TERMINAL,
  GATE,
  TRANSITIONS,
  gateForStatus,
  resolveTransition,
};
