// unpackB2BLot — ปิดล็อต B2B แล้วกระจายเครื่องเข้าคิว QC รายเครื่อง
//
// WHY THIS MOVED TO THE SERVER
// This was the last B2B writer still choosing a status on the client, and it
// could not simply be pointed at transitionJob like the other eleven: it
// writes the parent's status AND creates one child job per graded device in a
// single multi-path update. Splitting that into "engine changes the parent,
// client creates the children" gives two writes that can half-succeed, and the
// bad half is unrecoverable from the UI — once the parent reads Completed the
// unpack button is gone, so devices we have already paid for would exist
// nowhere in the system.
//
// The fix is not to make the two writes atomic (RTDB cannot transact across
// siblings) but to make the first one REPEATABLE: children are created first
// and are keyed to the parent by `parent_b2b_id`, so a retry after a failed
// transition finds them and skips creation instead of duplicating them. The
// parent still moves through applyTransition, so it keeps the from-list check,
// the status_version lock and the audit trail.
//
// ORDER MATTERS AND IS THE OPPOSITE OF THE OBVIOUS ONE
//   children -> parent : a crash in between leaves devices in the QC queue on
//     a lot that still reads Paid. The unpack button is still on screen, the
//     admin presses it again, creation is skipped, the parent moves. Visible,
//     recoverable, no data invented.
//   parent -> children : a crash in between leaves a closed lot with no
//     devices and no button to finish the job. Invisible until someone counts
//     stock.
//
// REQUIRES `.indexOn: parent_b2b_id` AT /jobs (bkk-frontend-next
// database.rules.json). Without it the existence query still returns the right
// answer but RTDB downloads the whole /jobs node to do it — no error, just the
// bill. See the RTDB Cost Rules section in CLAUDE.md.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const { applyTransition } = require("./status-apply");
const { ACTOR, B2B_JOB_TYPES } = require("./status-engine");
const { JOB_STATUS, normalizeStatus } = require("./status-vocab.generated");

const REGION = "asia-southeast1";

// Child jobs are not corporate lots — they are single devices entering the
// retail inventory flow, which is why they carry the retail-side Pending QC.
const CHILD_TYPE = "B2B-Unpacked";
const CHILD_RECEIVE_METHOD = "Corporate Bulk";
const UNPACK_REASON =
  "ระเบิดกล่องและกระจายเครื่องเข้าคลังสำเร็จ (สิ้นสุดงานแอดมิน B2B)";

/**
 * Graded rows, minus the ones the auditor rejected.
 *
 * RTDB hands an array back as an object whenever the keys are not contiguous —
 * which happens as soon as anyone deletes a row from the middle of the list,
 * and the auditor tool has a delete button. Reading it as an array only is a
 * bug that waits for the first deletion.
 */
function validItemsOf(job) {
  const raw = (job && job.graded_items) || [];
  const rows = Array.isArray(raw) ? raw : Object.values(raw);
  return rows.filter((i) => i && i.grade !== "Reject");
}

function taxInvoiceOf(job) {
  return ((job && job.documents) || {}).tax_invoice_number || "";
}

/**
 * The child rows for one lot, as a multi-path payload. Pure — `keys` are the
 * push ids the caller reserved, so the test can pin the shape without a DB.
 */
function buildUnpackChildren({ job, jobId, keys, now }) {
  const items = validItemsOf(job);
  const updates = {};
  items.forEach((item, index) => {
    updates[`jobs/${keys[index]}`] = {
      ref_no: `${job.ref_no}-U${String(index + 1).padStart(3, "0")}`,
      type: CHILD_TYPE,
      model: item.model,
      price: item.price,
      pre_grade: item.grade,
      status: JOB_STATUS.PENDING_QC,
      receive_method: CHILD_RECEIVE_METHOD,
      cust_name: `[Corporate] ${String((job && job.cust_name) || "").split("(")[0]}`,
      imei: item.imei || "",
      serial: item.imei || "",
      created_at: now,
      updated_at: now,
      agent_name: job.agent_name || "Admin",
      parent_b2b_id: jobId,
      qc_logs: [
        {
          action: "Sent to QC Lab",
          details: `ระเบิดกล่องจากล็อต B2B (${job.ref_no}) รอกระบวนการ Test & Data Wipe`,
          timestamp: now,
          by: "System",
        },
      ],
    };
  });
  return updates;
}

/**
 * Everything that must be true before a single child row is written.
 * Pure, and separate from the callable so the refusals can be tested.
 *
 * Returns null when the lot may be unpacked, or { code, message }.
 */
function checkUnpackable(job) {
  if (!job) return { code: "not-found", message: "ไม่พบงานนี้" };
  if (!B2B_JOB_TYPES.includes(job.type)) {
    return { code: "failed-precondition", message: "งานนี้ไม่ใช่ล็อตรับซื้อเหมา" };
  }
  // The engine checks this again inside the transaction and is the authority.
  // It is checked HERE too because children are written first: without it, a
  // lot at the wrong status would get its devices created and then be refused.
  if (normalizeStatus(job.status) !== JOB_STATUS.PAID) {
    return { code: "failed-precondition", message: "ต้องรอให้บัญชีชำระเงินก่อนจึงจะรับเข้าคลังได้" };
  }
  if (!taxInvoiceOf(job)) {
    return { code: "failed-precondition", message: "ไม่สามารถรับเข้าคลังได้หากไม่มีเลขใบกำกับภาษี (Tax Invoice)" };
  }
  if (validItemsOf(job).length === 0) {
    return { code: "failed-precondition", message: "ไม่พบรายการเครื่องที่ประเมินไว้" };
  }
  return null;
}

exports.unpackB2BLot = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");

  const { jobId } = request.data || {};
  if (!jobId || typeof jobId !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ jobId");
  }

  const db = getDatabase();
  const who = await lookupStaffByAuth(db, request.auth);
  const role = String((who && who.role) || "").toUpperCase();
  if (!who || !["CEO", "MANAGER", "STAFF"].includes(role)) {
    throw new HttpsError("permission-denied", "บัญชีนี้ไม่มีสิทธิ์รับเครื่องเข้าคลัง");
  }
  const actor = role === "STAFF" ? ACTOR.ADMIN_STAFF : ACTOR.ADMIN_MANAGER;

  const snap = await db.ref(`jobs/${jobId}`).once("value");
  const job = snap.val();
  const blocked = checkUnpackable(job);
  if (blocked) throw new HttpsError(blocked.code, blocked.message);

  const items = validItemsOf(job);

  // Have we been here before? Indexed by parent_b2b_id — see the note at the
  // top about why this query is what makes the split safe.
  const existingSnap = await db
    .ref("jobs")
    .orderByChild("parent_b2b_id")
    .equalTo(jobId)
    .once("value");
  const existing = existingSnap.numChildren();

  if (existing > 0 && existing !== items.length) {
    // Children exist but not the set this lot describes. Do NOT guess: the
    // multi-path write is all-or-nothing so this cannot be a half-finished
    // run — it means graded_items changed after an earlier unpack, and either
    // creating the difference or ignoring it would be a decision about
    // devices, made by a retry loop.
    console.error(
      `[unpackB2BLot] ${jobId}: ${existing} child jobs exist but graded_items has ${items.length}`
    );
    throw new HttpsError(
      "failed-precondition",
      `ล็อตนี้มีงานลูกอยู่แล้ว ${existing} เครื่อง แต่รายการที่ประเมินไว้มี ${items.length} เครื่อง — แจ้งทีมพัฒนา`
    );
  }

  const now = Date.now();
  const recovered = existing > 0;

  if (!recovered) {
    const keys = items.map(() => db.ref("jobs").push().key);
    await db.ref().update(buildUnpackChildren({ job, jobId, keys, now }));
  }

  const result = await applyTransition({
    db,
    jobId,
    event: "b2b_unpacked_to_stock",
    actor,
    by: `${actor}:${who.id}`,
    byName: who.name || who.displayName || `${actor}:${who.id}`,
    reason: UNPACK_REASON,
    patch: { b2b_unpacked_at: now, b2b_child_count: items.length },
  });

  if (!result.ok) {
    // The children are already in the QC queue and the lot still reads Paid,
    // so the button stays on screen and pressing it again resumes from here.
    console.error(`[unpackB2BLot] ${jobId}: children ready but transition refused: ${result.code}`);
    throw new HttpsError("failed-precondition", result.message || result.code, {
      code: result.code,
      childrenCreated: !recovered,
    });
  }

  console.log(
    `[unpackB2BLot] ${jobId}: ${items.length} child jobs ${recovered ? "already existed" : "created"}, lot closed`
  );
  return { ok: true, children: items.length, recovered };
});

exports.validItemsOf = validItemsOf;
exports.buildUnpackChildren = buildUnpackChildren;
exports.checkUnpackable = checkUnpackable;
exports.UNPACK_REASON = UNPACK_REASON;
