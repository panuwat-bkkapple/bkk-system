// confirmPayoutTransfer — "ฝ่ายบัญชีโอนเงินให้ลูกค้าแล้ว" ย้ายจากไคลเอนต์ขึ้นมาที่นี่
//
// เดิม src/utils/payoutTransfer.ts (bkk-system) เขียน**สถานะ + แถว ledger** ใน
// multi-path update ก้อนเดียวจากเบราว์เซอร์ — writer สถานะตัวสุดท้ายที่ไม่ผ่าน
// engine และเป็นตัวเดียวที่ยังเขียนสะกดเก่า ('Waiting for Handover' /
// 'Payment Completed') ซึ่งเป็นต้นตอของครึ่งหนึ่งในรายงาน status-literal survey
//
// ทำไมแยกเป็นสอง write แทน update() ก้อนเดียว: RTDB transaction ครอบได้โหนดเดียว
// (jobs/{id}) — สถานะต้องผ่าน applyTransition (from-list, status_version,
// status_history, paid_at เขียนครั้งเดียว) ซึ่งเป็นธุรกรรมบน jobs/{id} ส่วน
// transactions/* อยู่คนละ sibling รวมในธุรกรรมเดียวไม่ได้
//
// ลำดับ: transition ก่อน ledger — ไม่ใช่ตามความสำคัญ แต่ตาม "ใครปฏิเสธได้":
//   transition → ledger : transition ถูกปฏิเสธได้ด้วยเหตุผลทางธุรกิจ (สถานะผิด /
//     จ่ายซ้ำ / ยอดเปลี่ยน / ไม่มีสิทธิ์) ถ้ามันไม่ผ่านก็ยังไม่มีอะไรถูกเขียน
//     ledger ล้มได้เฉพาะ infra → ได้ "งานจ่ายแล้วแต่ไม่มีแถวบัญชี" ซึ่งคือ orphan
//     ที่ Finance.tsx (ตัวนับ) และ TransactionRepair (ซ่อม) มีไว้จับ**อยู่แล้ว**
//     และตั้งแต่ #710 สองตัวนั้นอ่านสะกด canonical ที่ engine เขียนได้
//   ledger → transition : ledger ล้มไม่ได้ด้วยเหตุผลธุรกิจ แต่ transition ล้มได้ →
//     ได้ "แถวบัญชีของเงินที่ไม่ได้จ่าย" ซึ่งไม่มีตัวจับ
// ผลลัพธ์บอกไคลเอนต์ตรงๆ ว่า ledger ลงหรือไม่ (`ledgerWritten`) ไม่ throw หลัง
// สถานะเปลี่ยนแล้ว — error หลังเงินออกคือ toast ที่ทำให้แอดมินกดซ้ำ
//
// actor เป็น FINANCE ตามผลของ payoutGateVerdict ไม่ใช่ตาม role ดิบ: แถว
// payment_confirmed / b2b_payment_confirmed ใน engine ระบุ actors: [FINANCE]
// = "ต้องผ่านด่านจ่ายเงินออก" ซึ่ง CEO ผ่านเสมอ และ MANAGER/STAFF ผ่านตราบใดที่
// settings/finance_gate/enforce ยังปิด (ตรงกับหน้าจอวันนี้ทุกประการ)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const { applyTransition } = require("./status-apply");
const { ACTOR } = require("./status-engine");
const { CLAIM_KEY } = require("./finance-claims");
const { httpsErrorFor } = require("./status-transition-api");
const {
  isB2BPayout,
  netPayoutOf,
  buildLogisticsRevenueTx,
  buildPayoutDebitTx,
  buildPayoutPatch,
  payoutLogDetails,
  payoutGateVerdict,
  payoutGuard,
} = require("./payout-ledger");

const REGION = "asia-southeast1";
const FINANCE_ENFORCE_PATH = "settings/finance_gate/enforce";
/** เวลาโอนเป็นอนาคตได้ไม่เกินนี้ (นาฬิกาเครื่องเพี้ยน) — เท่ากับที่หน้าจอเช็ค */
const FUTURE_SLACK_MS = 60_000;

const EVENT_RETAIL = "payment_confirmed";
const EVENT_B2B = "b2b_payment_confirmed";

function text(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** ตรวจรูป input — คืน { ok:false, code:'invalid_input', message } หรือ { ok:true, value } */
function validatePayoutInput(data, now) {
  const d = data || {};
  const jobId = text(d.jobId);
  if (!jobId) return { ok: false, code: "invalid_input", message: "ต้องระบุ jobId" };
  const slipUrl = text(d.slipUrl);
  if (!/^https:\/\//.test(slipUrl)) return { ok: false, code: "invalid_input", message: "ต้องแนบสลิปการโอนเงิน" };
  const transferredAt = Number(d.transferredAt);
  if (!Number.isFinite(transferredAt) || transferredAt <= 0) {
    return { ok: false, code: "invalid_input", message: "วันเวลาที่โอนไม่ถูกต้อง" };
  }
  if (transferredAt > now + FUTURE_SLACK_MS) {
    return { ok: false, code: "invalid_input", message: "วันเวลาที่โอนเป็นอนาคต กรุณาตรวจสอบ" };
  }
  const bank = { name: text(d.bank && d.bank.name), account: text(d.bank && d.bank.account), holder: text(d.bank && d.bank.holder) };
  if (!bank.name || !bank.account || !bank.holder) {
    return { ok: false, code: "invalid_input", message: "กรุณาระบุข้อมูลบัญชีรับเงินให้ครบถ้วน" };
  }
  const expectedNetPayout = Number(d.expectedNetPayout);
  if (!Number.isFinite(expectedNetPayout) || expectedNetPayout < 0) {
    return { ok: false, code: "invalid_input", message: "ยอดโอนไม่ถูกต้อง" };
  }
  return { ok: true, value: { jobId, slipUrl, transferredAt, bank, expectedNetPayout } };
}

/**
 * แกนของ callable — แยกออกมาให้เทสออฟไลน์เรียกด้วย db ปลอมได้ (onCall เป็นแค่เปลือก)
 * คืนผลลัพธ์ ไม่ throw: { ok:false, code, message } หรือ { ok:true, ... }
 */
async function confirmPayoutTransferCore({ db, who, token, data, now = Date.now }) {
  const parsed = validatePayoutInput(data, now());
  if (!parsed.ok) return parsed;
  const { jobId, slipUrl, transferredAt, bank, expectedNetPayout } = parsed.value;

  const enforceSnap = await db.ref(FINANCE_ENFORCE_PATH).once("value");
  const verdict = payoutGateVerdict({
    role: who && who.role,
    hasClaim: Boolean(token && token[CLAIM_KEY] === true),
    enforce: enforceSnap.val() === true,
  });
  if (!verdict.allowed) {
    return {
      ok: false,
      code: "not_finance",
      message: "บัญชีนี้ไม่มีสิทธิ์จ่ายเงินออก — ให้ CEO เปิดสิทธิ์ให้ที่หน้าจัดการพนักงาน",
    };
  }

  const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
  const job = jobSnap.val();
  if (!job) return { ok: false, code: "job_not_found", message: `ไม่พบงาน ${jobId}` };

  const event = isB2BPayout(job) ? EVENT_B2B : EVENT_RETAIL;
  const byName = (who && (who.name || who.displayName)) || "Finance";
  const patch = buildPayoutPatch({ transferredAt, paidBy: byName, slipUrl, bank });

  // เลขที่ลง ledger มาจาก guard ในธุรกรรม ไม่ใช่จาก job ที่อ่านก่อนหน้า
  const seen = { net: null };
  const result = await applyTransition({
    db,
    jobId,
    event,
    actor: ACTOR.FINANCE,
    by: `${ACTOR.FINANCE}:${who.id}`,
    byName,
    // ข้อความไทม์ไลน์ใช้เลขที่คนกดเห็น — guard รับรองว่าเท่ากับเลขจริง (ปัดแล้ว)
    reason: payoutLogDetails({ netPayout: expectedNetPayout, bank, transferredAt }),
    patch,
    guard: payoutGuard({ expectedNetPayout, seen }),
    now,
  });
  if (!result.ok) return result;

  const netPayout = seen.net == null ? netPayoutOf(job) : seen.net;
  // `id` ไม่ได้อยู่ในตัวแถว (มันคือ key) — แถว ledger อ้าง ref_job_id จากตรงนี้
  const paidJob = { ...job, ...patch, id: jobId };
  const debitKey = db.ref("transactions").push().key;
  const revenueTx = buildLogisticsRevenueTx(paidJob, transferredAt);
  const creditKey = revenueTx ? db.ref("transactions").push().key : null;
  const updates = {
    [`transactions/${debitKey}`]: buildPayoutDebitTx({ job: paidJob, netPayout, transferredAt, slipUrl }),
  };
  if (revenueTx && creditKey) updates[`transactions/${creditKey}`] = revenueTx;

  let ledgerWritten = true;
  try {
    await db.ref().update(updates);
  } catch (err) {
    // สถานะเปลี่ยนไปแล้ว — ไม่ throw (ดูหัวไฟล์) แต่ต้องดังพอให้คนเห็นใน log
    // และตัวนับ orphan ของ Finance.tsx จะเห็นงานนี้ในรอบถัดไป
    ledgerWritten = false;
    console.error(`[confirmPayoutTransfer] ${jobId}: status moved to ${result.to} but ledger write failed:`, err);
  }

  return {
    ok: true,
    from: result.from,
    to: result.to,
    event,
    netPayout,
    debitKey,
    creditKey,
    ledgerWritten,
  };
}

exports.confirmPayoutTransfer = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");

  const db = getDatabase();
  // role มาจาก /staff ผ่าน token ที่ verify แล้ว ไม่ใช่จาก body
  const who = await lookupStaffByAuth(db, request.auth);
  if (!who || String(who.role || "").toUpperCase() === "RIDER") {
    throw new HttpsError("permission-denied", "บัญชีนี้ไม่มีสิทธิ์จ่ายเงินออก");
  }

  const result = await confirmPayoutTransferCore({
    db,
    who,
    token: request.auth.token,
    data: request.data,
  });

  if (!result.ok) {
    console.warn(`[confirmPayoutTransfer] ${(request.data || {}).jobId} by ${who.id} refused: ${result.code}`);
    throw httpsErrorFor(result);
  }

  console.log(
    `[confirmPayoutTransfer] ${(request.data || {}).jobId} ${result.from} → ${result.to} via ${result.event} by ${who.id} net=${result.netPayout} ledger=${result.ledgerWritten}`
  );
  return result;
});

exports.__test__ = { confirmPayoutTransferCore, validatePayoutInput, FINANCE_ENFORCE_PATH, EVENT_RETAIL, EVENT_B2B };
