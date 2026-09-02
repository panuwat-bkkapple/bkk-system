// Who is acting — the bridge between a Firebase auth token and the engine.
//
// WHY THIS EXISTS
// status-engine.js decides transitions from `{ job, event, actor }` where
// `actor` is one of its seven ACTOR values. It is pure and deliberately knows
// nothing about Firebase. Something has to turn `request.auth` into that
// value, and until now nothing did: the closest thing is lookupStaffByAuth,
// which returns the raw /staff or /riders record with a role in the BUSINESS
// vocabulary (CEO / MANAGER / STAFF / FINANCE / RIDER). Those are two
// different vocabularies and nothing mapped between them.
//
// This file is that map, plus the identity snapshot that every transition has
// to record. It is the whole "actor contract": callers of the engine get the
// actor value from here and nowhere else, so the mapping exists once.
//
// HOW IT MEETS THE WRITER
// applyTransition (status-apply.js) takes `{ actor, by }` and writes both onto
// the status_history row. `actor` is what this file's `actor` field is for;
// `by` is what `identity` is for. Its own header says the actor "must come
// from verified auth on the server — lookupStaffByAuth for admins, the rider's
// own uid for riders", which is this function, written out longhand.
//
// Note that applyTransition defaults `by` to the actor role when a caller
// omits it, so a history row can end up claiming "admin_staff" did something.
// That default should tighten when P2 wires the first real writer and every
// caller has an identity to pass; until then, pass identity explicitly.
//
// IT REPORTS, IT DOES NOT DENY
// resolveActor never throws and never refuses. It answers "who is this, and
// what is their standing right now" and lets the caller decide what to do
// about it. That split is deliberate:
//
//   - The engine's role gate is per-event (§5 of the v2 spec). Baking a
//     blanket denial in here would put a second, coarser gate in front of it
//     that the transition table cannot see.
//   - Two existing callers use the resolved record ONLY to label an audit
//     line (syncJobFromSickw's qc_log, recordSickwUsage). A resolver that
//     denied would turn those into `"Unknown"` — an audit trail that stops
//     naming people exactly when someone acts who should not have. Reporting
//     standing keeps the name and lets the gate live where the gate belongs.
//
// WHY identity IS A SNAPSHOT AND NOT A POINTER
// The apply half of the engine appends `status_history` entries that live as
// long as the job does. If `by` were just an id, every historical row would
// dereference to nothing the day that person changes role or leaves. The
// survey behind this work (2026-09-01-employee-lifecycle-survey.md, Q8) found
// ONE person already stamped onto jobs in four incompatible shapes; v2 would
// multiply that by every transition, forever. So identity carries the name and
// role as they were AT THE TIME, and `uid` as the one key that means the same
// thing in both tables.

const { ACTOR } = require("./status-engine");
const { lookupStaffByAuth } = require("./sickw-core");

/**
 * Can this person act right now?
 *
 * Separate from `actor`, which says what KIND of person they are. A suspended
 * rider is still a rider; the difference is standing, and conflating the two
 * is what made the rider hole hard to see (rules blocked them while every
 * callable still accepted them).
 */
const STANDING = {
  ACTIVE: "active",
  PENDING: "pending", // signed up, never approved — a real person, not yet cleared
  BLOCKED: "blocked", // rejected, suspended, or a value we do not recognise
};

/**
 * Business role → engine actor. The ONLY place these two vocabularies meet.
 *
 * CEO and MANAGER both map to admin_manager because that is the pair every
 * existing elevated gate already uses (SICKW override, dealer lot unseal,
 * rider status changes). Deprecated CASHIER/QC are absent on purpose: no route
 * recognises them either (see UserRole in src/types/domain.ts), so they
 * resolve to no actor at all rather than being quietly treated as STAFF.
 */
// HR **ไม่มีอยู่ในตารางนี้โดยตั้งใจ ห้ามเติม** (ก.ย. 2569 — docs/hr-system-design.md
// ข้อ 7.1). resolveActor คืน null ให้ role ที่ไม่ได้ map ซึ่งแปลว่าฝ่ายบุคคล
// ถูกปฏิเสธที่ requireActiveWorker (สามเอนด์พอยต์ SICKW ที่จ่ายเงินจริงต่อการ
// เรียกหนึ่งครั้ง) และที่ applyTransition (เปลี่ยนสถานะงาน) — สองอย่างที่ HR
// ไม่มีเหตุให้แตะ **การเห็นว่า "ขาดไป" แล้วเติมให้ครบตาราง คือการเปิดทั้งสอง
// อย่างให้คนที่ไม่ได้ขอ** callable ของ HR gate ด้วย allowlist ของตัวเองใน hr.js
const ROLE_TO_ACTOR = {
  CEO: ACTOR.ADMIN_MANAGER,
  MANAGER: ACTOR.ADMIN_MANAGER,
  STAFF: ACTOR.ADMIN_STAFF,
  FINANCE: ACTOR.FINANCE,
  RIDER: ACTOR.RIDER,
};

/**
 * A rider's approval state, tolerating records written before the field
 * existed. Self-registration (bkk-rider-app Register.tsx) still writes only
 * `status: 'Pending'`, so the fallback is not dead code.
 *
 * Lives here rather than in rider-accounts.js because standing is part of the
 * actor contract; rider-accounts is one of its consumers and re-exports it so
 * its existing call sites did not have to move.
 *
 * MIRROR: normalizeRider in src/pages/fleet/RiderManagement.tsx derives the
 * same thing for the admin table. Change one, change both — a rider the UI
 * calls Active while the server calls them Pending is the shape of bug this
 * whole area keeps producing.
 */
function effectiveApprovalStatus(rider) {
  if (rider.approval_status) return String(rider.approval_status);
  const status = String(rider.status || "");
  if (["Online", "Offline", "Busy"].includes(status)) return "Active";
  return status || "Pending";
}

/**
 * Anything not explicitly Active or Pending is BLOCKED — including values this
 * code has never seen. Fails closed: a rider status invented later blocks
 * until somebody maps it, rather than silently authorising.
 */
function riderStanding(rider) {
  const state = effectiveApprovalStatus(rider);
  if (state === "Active") return STANDING.ACTIVE;
  if (state === "Pending") return STANDING.PENDING;
  return STANDING.BLOCKED;
}

/**
 * Resolve the caller into an actor, their standing, and the identity snapshot
 * to stamp on whatever they do.
 *
 * Returns null when the caller is not a person this system knows: no auth, an
 * anonymous customer (they have no record anywhere), a deleted account, or a
 * staff record carrying a role that is no longer issued. Null is NOT the same
 * as "customer" — the customer-facing API knows its callers are customers
 * because of which endpoint they reached, and passes ACTOR.CUSTOMER itself.
 * Deciding that here would mean treating every unknown caller as a customer.
 *
 * Staff standing is ACTIVE by construction: lookupStaffByAuth only returns
 * staff whose status is ACTIVE (or blank), so a suspended employee resolves to
 * null here — the three-layer suspension in staff-accounts.js has already
 * disabled their Auth user and removed /admins by then anyway.
 *
 * @returns {Promise<null | {actor: string, standing: string, identity: {
 *   source: 'staff'|'rider', actor_id: string, uid: string,
 *   name: string|null, role: string }}>}
 */
async function resolveActor(db, auth) {
  if (!auth || !auth.uid) return null;

  const record = await lookupStaffByAuth(db, auth);
  if (!record) return null;

  const role = String(record.role || "").toUpperCase();
  const actor = ROLE_TO_ACTOR[role];
  if (!actor) return null;

  const isRider = actor === ACTOR.RIDER;

  return {
    actor,
    standing: isRider ? riderStanding(record) : STANDING.ACTIVE,
    identity: {
      // Which table actor_id points into. /staff is keyed by push id and
      // /riders by Firebase uid, so the id alone is ambiguous — this is the
      // field that makes a history row dereferenceable later.
      source: isRider ? "rider" : "staff",
      actor_id: record.id || auth.uid,
      uid: auth.uid,
      name: record.name || record.email || null,
      role,
    },
  };
}

module.exports = {
  STANDING,
  ROLE_TO_ACTOR,
  effectiveApprovalStatus,
  riderStanding,
  resolveActor,
};
