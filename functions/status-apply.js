// Job status transition engine — apply half.
//
// status-engine.js decides; this file is the only thing allowed to write the
// decision down. Splitting them is what makes the decision testable without a
// database and the write testable without inventing a status machine in the
// test.
//
// WHAT THIS GUARANTEES THAT TODAY'S WRITES DO NOT
//   1. The decision is made against the row as it is IN the transaction, not
//      against whatever a React tree or an HTTP handler read a moment earlier.
//      RTDB retries the callback when the node changed underneath, and the
//      retry re-decides from scratch, so a job that moved on between the read
//      and the write is rejected instead of overwritten.
//   2. status, custody, status_version, status_history, paid_at and
//      refunded_at are the engine's to write. Callers pass domain fields
//      (tracking_number, cancel_category, ...) and are refused if they try to
//      smuggle any of the engine's — otherwise "send an event" quietly becomes
//      "set any status you like" again, which is the thing being replaced.
//   3. Every transition leaves a from→to record. qc_logs, the closest thing we
//      have today, stores free text with no from/to pair, so no job's actual
//      path can be reconstructed — which is why the survey could not answer
//      "which transitions really happen" from production data.
//
// ACTOR TRUST
// `actor` is a role, and it must come from verified auth on the server —
// lookupStaffByAuth for admins, the rider's own uid for riders. Never from the
// request body: a client-supplied role is a client-chosen permission.
//
// Nothing calls this yet. The callable wrapper lands with the first writer that
// migrates (P2); shipping an unused public endpoint would add auth surface for
// no one.

const { decideTransition } = require("./status-engine");

// Fields only this module may write.
const ENGINE_OWNED = [
  "status",
  "custody",
  "status_version",
  "status_history",
  "paid_at",
  "refunded_at",
  // The engine appends the trail entry itself (see qcLogsOf below). A caller
  // that also sent qc_logs would either clobber that entry or duplicate it.
  "qc_logs",
];

// Keep the trail bounded. A job runs to roughly a dozen transitions, so this
// only ever trims a row that is looping — and a loop is exactly when the
// oldest entries stop being the interesting ones.
const MAX_HISTORY = 60;

// qc_logs is the trail the ADMIN UI actually reads — Traceability builds its
// timeline straight out of it, and PricingSidebar / QCStation append to it. Not
// mirroring into it was a live regression the moment the first rider writer
// moved here: status_history is written correctly, but nothing in bkk-system
// reads that field (it exists in domain.ts as a type and nowhere else), so
// every rider step vanished from the screen admins open to answer "what
// happened to this job".
//
// So the engine writes BOTH while the two formats overlap. status_history is
// the structured pair (from/to/event/actor) that v2 readers will use; qc_logs
// is the free-text line today's screens render. Drop this mirror only when the
// admin UI reads status_history — not before.
function qcLogsOf(job) {
  const raw = job && job.qc_logs;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function historyOf(job) {
  const raw = job && job.status_history;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

/**
 * Apply `event` to `jobs/{jobId}` inside a transaction.
 *
 * Returns { ok: true, from, to, custody, status_version } on success, or
 * { ok: false, code, message } — codes from decideTransition plus:
 *   job_not_found | patch_conflict | write_contended, plus whatever `guard`
 *   returns
 *
 * `patch` carries the domain fields the event needs (a tracking number, the
 * cancel taxonomy). It is merged BEFORE the decision is made, so rules like
 * "cancelling requires cancelled_at" see the values this event brings rather
 * than only what was already stored.
 *
 * `guard` is an optional caller check run INSIDE the transaction, for rules
 * about WHO may act on THIS row rather than about the state machine — "is this
 * the rider who holds the job". Returning { code, message } aborts. It has to
 * run in here rather than before the call: a check made against a row read a
 * moment earlier is a check against a job that may since have been reassigned.
 */
async function applyTransition({ db, jobId, event, actor, by, byName, reason, patch = {}, guard = null, now = Date.now }) {
  const conflicting = Object.keys(patch).filter((key) => ENGINE_OWNED.includes(key));
  if (conflicting.length > 0) {
    return {
      ok: false,
      code: "patch_conflict",
      message: `patch พยายามเขียนฟิลด์ของ engine: ${conflicting.join(", ")}`,
    };
  }

  let decision = null;
  let missing = false;

  const result = await db.ref(`jobs/${jobId}`).transaction((current) => {
    // Reset per attempt: RTDB replays this callback on contention, and a
    // decision carried over from the losing attempt would describe a row that
    // no longer exists.
    decision = null;
    missing = false;

    if (current === null) {
      missing = true;
      return current; // abort without writing
    }

    const proposed = { ...current, ...patch };

    const blocked = guard ? guard(current) : null;
    if (blocked) {
      decision = { ok: false, ...blocked };
      return; // undefined aborts the transaction
    }

    const outcome = decideTransition({ job: proposed, event, actor });
    if (!outcome.ok) {
      decision = outcome;
      return; // undefined aborts the transaction
    }

    const at = now();
    const version = Number(current.status_version) || 0;
    const next = {
      ...proposed,
      status: outcome.to,
      status_version: version + 1,
      updated_at: at,
      status_history: [
        ...historyOf(current),
        {
          from: outcome.from,
          to: outcome.to,
          event,
          actor,
          by: by || actor,
          at,
          ...(reason ? { reason } : {}),
        },
      ].slice(-MAX_HISTORY),
    };

    // Newest-first, matching what every existing writer of this node does —
    // Traceability sorts by timestamp itself, but PricingSidebar renders the
    // array order as given.
    next.qc_logs = [
      {
        action: outcome.to,
        by: byName || by || actor,
        timestamp: at,
        details: reason || `${outcome.from} -> ${outcome.to} (${event})`,
      },
      ...qcLogsOf(current),
    ];

    if (outcome.custody) next.custody = outcome.custody;
    // Write-once: a second payment event must not move the timestamp the
    // accounting side reads.
    if (outcome.stamps.paid && !next.paid_at) next.paid_at = at;
    if (outcome.stamps.refunded && !next.refunded_at) next.refunded_at = at;
    for (const field of outcome.clears) next[field] = null;

    decision = { ...outcome, status_version: next.status_version };
    return next;
  });

  if (missing) return { ok: false, code: "job_not_found", message: `ไม่พบงาน ${jobId}` };
  if (decision && !decision.ok) return decision;
  if (!result.committed) {
    // Aborted without a decision: RTDB gave up retrying under contention.
    return { ok: false, code: "write_contended", message: "งานถูกแก้พร้อมกัน ลองใหม่อีกครั้ง" };
  }

  return {
    ok: true,
    from: decision.from,
    to: decision.to,
    custody: decision.custody,
    status_version: decision.status_version,
  };
}

module.exports = { applyTransition, ENGINE_OWNED, MAX_HISTORY };
