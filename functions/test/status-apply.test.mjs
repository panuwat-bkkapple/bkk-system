// applyTransition — offline suite with an in-memory stand-in for an RTDB ref.
//
// The fake implements the one property of ref.transaction() the design leans
// on: when the node changes underneath, the callback is REPLAYED against the
// new value. Every guarantee in status-apply.js depends on that replay, so a
// test that only ever ran the callback once would prove nothing about the case
// this module exists for — two people acting on the same job at the same time.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { applyTransition, MAX_HISTORY } = require(path.join(root, "functions/status-apply.js"));
const { ACTOR, CUSTODY, SIDE_EFFECT_OWNER, TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));

let failures = 0;
function check(name, fn) {
  return fn()
    .then(() => console.log(`  ok   ${name}`))
    .catch((err) => {
      failures++;
      console.error(`  FAIL ${name}\n       ${err.message}`);
    });
}

/**
 * @param initial   the stored job
 * @param mutateOnce optional: called before the FIRST commit attempt lands, to
 *                   simulate someone else writing the row in between. The
 *                   value it returns becomes the stored job and the callback
 *                   is replayed against it, exactly as RTDB does.
 */
function fakeDb(initial, { mutateOnce = null, maxAttempts = 25 } = {}) {
  let stored = initial === null ? null : { ...initial };
  let pendingMutation = mutateOnce;
  const state = { attempts: 0, commits: 0 };
  return {
    state,
    get stored() {
      return stored;
    },
    ref(pathname) {
      assert.match(pathname, /^jobs\//, `unexpected path: ${pathname}`);
      return {
        async transaction(fn) {
          for (let i = 0; i < maxAttempts; i++) {
            state.attempts++;
            const proposed = fn(stored === null ? null : { ...stored });
            if (proposed === undefined) return { committed: false, snapshot: { val: () => stored } };
            if (pendingMutation) {
              // Somebody else won this round.
              stored = pendingMutation(stored === null ? null : { ...stored });
              pendingMutation = null;
              continue; // replay
            }
            state.commits++;
            stored = proposed;
            return { committed: true, snapshot: { val: () => stored } };
          }
          return { committed: false, snapshot: { val: () => stored } };
        },
      };
    },
  };
}

const job = (over = {}) => ({ status: "New Lead", receive_method: "Pickup", ...over });
const clock = () => 1_700_000_000_000;

console.log("status-apply");

const tests = [
  check("writes the decision: status, custody, version, history", async () => {
    const db = fakeDb(job({ status: "Rider Accepted" }));
    const out = await applyTransition({
      db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER, by: "rider:r1", now: clock,
    });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.status, "Rider En Route");
    assert.equal(db.stored.status_version, 1);
    assert.equal(db.stored.updated_at, clock());
    assert.equal(db.stored.status_history.length, 1);
    assert.deepEqual(db.stored.status_history[0], {
      from: "Rider Accepted", to: "Rider En Route", event: "rider_departed",
      actor: "rider", by: "rider:r1", at: clock(),
    });
  }),

  check("the transition is mirrored into qc_logs, newest first", async () => {
    // qc_logs คือไทม์ไลน์ที่แอดมินเปิดดูจริง (Traceability สร้างจากมันตรงๆ)
    // ส่วน status_history ยังไม่มีหน้าไหนใน bkk-system อ่านเลยสักหน้า —
    // ไม่มิเรอร์ = ทุกขั้นของไรเดอร์หายจากจอที่คนใช้ตอบคำถาม "งานนี้เกิดอะไรขึ้น"
    const db = fakeDb(job({
      status: "Rider Accepted",
      qc_logs: [{ action: "Rider Accepted", by: "Rider: เก่า", timestamp: 1, details: "ของเดิม" }],
    }));
    const out = await applyTransition({
      db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER,
      by: "rider:r1", byName: "สมชาย", reason: "ไรเดอร์กำลังเดินทางไปหาลูกค้า", now: clock,
    });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.qc_logs.length, 2);
    assert.deepEqual(db.stored.qc_logs[0], {
      action: "Rider En Route",
      by: "สมชาย",
      timestamp: clock(),
      details: "ไรเดอร์กำลังเดินทางไปหาลูกค้า",
    });
    // แถวเดิมต้องอยู่ครบ ไม่ใช่ถูกเขียนทับ
    assert.equal(db.stored.qc_logs[1].details, "ของเดิม");
  }),

  check("qc_logs mirror works on a job that has none yet", async () => {
    const db = fakeDb(job({ status: "Rider Accepted" }));
    const out = await applyTransition({
      db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER, by: "rider:r1", now: clock,
    });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.qc_logs.length, 1);
    // ไม่มี byName ให้ตกกลับไปที่ by — ไม่ใช่ undefined ซึ่ง RTDB ปฏิเสธทั้ง write
    assert.equal(db.stored.qc_logs[0].by, "rider:r1");
    // ไม่มี reason ให้บรรยายการเปลี่ยนเอง แถวว่างเปล่าอ่านแล้วไม่ได้อะไร
    assert.match(db.stored.qc_logs[0].details, /Rider Accepted -> Rider En Route/);
  }),

  check("a refused event writes no qc_logs entry either", async () => {
    const db = fakeDb(job({ status: "New Lead", qc_logs: [] }));
    const out = await applyTransition({
      db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER, by: "rider:r1", now: clock,
    });
    assert.equal(out.ok, false);
    assert.equal(db.stored.qc_logs.length, 0);
  }),

  check("a caller cannot send qc_logs in the patch", async () => {
    // ถ้ายอมให้ส่งมา แถวที่ engine เขียนจะถูกทับหรือซ้ำ แล้วแต่ลำดับ merge
    const db = fakeDb(job({ status: "Rider Accepted" }));
    const out = await applyTransition({
      db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER,
      patch: { qc_logs: [{ action: "ของปลอม" }] }, now: clock,
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, "patch_conflict");
  }),

  check("an illegal event writes nothing at all", async () => {
    const db = fakeDb(job({ status: "New Lead" }));
    const out = await applyTransition({ db, jobId: "J1", event: "payment_confirmed", actor: ACTOR.FINANCE, now: clock });
    assert.equal(out.ok, false);
    assert.equal(out.code, "illegal_from");
    assert.deepEqual(db.stored, job({ status: "New Lead" }), "row must be untouched");
    // Not merely "unchanged": no write may reach the node. Committing the
    // current value back would fire every onValueWritten trigger on jobs/,
    // which is a status-change notification for a status that did not change.
    assert.equal(db.state.commits, 0, "an illegal event must abort, not commit a no-op");
  }),

  // The reason this module runs inside a transaction rather than read-then-write.
  check("a job that moved underneath is re-decided, not overwritten", async () => {
    // Admin cancels while the rider is tapping "arrived".
    const db = fakeDb(job({ status: "Rider En Route" }), {
      mutateOnce: (row) => ({ ...row, status: "Cancelled", cancelled_at: 1, cancel_category: "customer_no_show", cancelled_by: "staff:1" }),
    });
    const out = await applyTransition({ db, jobId: "J1", event: "rider_arrived", actor: ACTOR.RIDER, now: clock });
    assert.equal(out.ok, false, "must not commit onto a cancelled job");
    assert.equal(out.code, "illegal_from");
    assert.equal(db.stored.status, "Cancelled");
    assert.ok(db.state.attempts >= 2, "the callback must have been replayed");
  }),

  check("a legal event still commits after a harmless concurrent write", async () => {
    const db = fakeDb(job({ status: "Rider En Route" }), {
      mutateOnce: (row) => ({ ...row, cust_phone: "0800000000" }),
    });
    const out = await applyTransition({ db, jobId: "J1", event: "rider_arrived", actor: ACTOR.RIDER, now: clock });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.status, "Rider Arrived");
    assert.equal(db.stored.cust_phone, "0800000000", "the other write must survive");
    assert.ok(db.state.attempts >= 2);
  }),

  // The callback sets `missing` when the row is absent. RTDB replays it if the
  // node changes, so a job created between attempts must clear that flag —
  // otherwise a commit that succeeded is reported as job_not_found.
  check("a row that appears between attempts is not reported missing", async () => {
    const db = fakeDb(null, { mutateOnce: () => job({ status: "New Lead" }) });
    const out = await applyTransition({ db, jobId: "J1", event: "case_claimed", actor: ACTOR.ADMIN_STAFF, now: clock });
    assert.equal(out.ok, true, `expected a commit after the replay, got ${out.code}`);
    assert.equal(db.stored.status, "Following Up");
  }),

  check("version increments from whatever the row already carries", async () => {
    const db = fakeDb(job({ status: "Rider Accepted", status_version: 7 }));
    await applyTransition({ db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER, now: clock });
    assert.equal(db.stored.status_version, 8);
  }),

  // "send an event" must not become "set any status you like".
  check("a patch cannot smuggle engine-owned fields", async () => {
    const db = fakeDb(job({ status: "New Lead" }));
    for (const field of ["status", "custody", "status_version", "paid_at", "status_history"]) {
      const out = await applyTransition({
        db, jobId: "J1", event: "case_claimed", actor: ACTOR.ADMIN_STAFF,
        patch: { [field]: "whatever" }, now: clock,
      });
      assert.equal(out.ok, false, `${field} should be refused`);
      assert.equal(out.code, "patch_conflict");
    }
    assert.equal(db.stored.status, "New Lead");
  }),

  // The rider-app cancel bug: cancel_at arrives WITH the event, so the rule
  // that requires it has to see the patch before deciding, not after.
  check("the patch is visible to the rules, not merged after them", async () => {
    const db = fakeDb(job({ status: "Rider Arrived" }));
    const without = await applyTransition({ db, jobId: "J1", event: "cancelled", actor: ACTOR.RIDER, now: clock });
    assert.equal(without.code, "missing_field");

    const withTaxonomy = await applyTransition({
      db, jobId: "J1", event: "cancelled", actor: ACTOR.RIDER, now: clock,
      patch: { cancel_category: "price_disagreement", cancelled_by: "customer", cancelled_at: clock() },
    });
    assert.equal(withTaxonomy.ok, true, withTaxonomy.message);
    assert.equal(db.stored.status, "Cancelled");
    assert.equal(db.stored.cancel_category, "price_disagreement");
  }),

  check("paid_at is written once and never moved by a later event", async () => {
    const db = fakeDb(job({ status: "Payout Processing" }));
    await applyTransition({ db, jobId: "J1", event: "payment_confirmed", actor: ACTOR.FINANCE, now: clock });
    assert.equal(db.stored.paid_at, clock());
    assert.equal(db.stored.status, "Waiting For Handover");

    const later = () => clock() + 999;
    await applyTransition({ db, jobId: "J1", event: "payment_handover_done", actor: ACTOR.RIDER, now: later });
    assert.equal(db.stored.paid_at, clock(), "paid_at must not move");
    assert.equal(db.stored.custody, CUSTODY.RIDER);
  }),

  // Reaching the write-once guard needs a STAMPING event on a row that already
  // has the timestamp — production has those: onAdminJobStatusNotify has been
  // auto-stamping paid_at on entry to the Paid family, so a job can arrive at
  // the finance step already carrying one. Testing this through a non-stamping
  // event proves nothing, because the guard is never asked.
  check("a stamping event leaves an existing paid_at alone", async () => {
    const stampedEarlier = 1_600_000_000_000;
    const db = fakeDb(job({ status: "Payout Processing", paid_at: stampedEarlier }));
    const out = await applyTransition({ db, jobId: "J1", event: "payment_confirmed", actor: ACTOR.FINANCE, now: clock });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.status, "Waiting For Handover");
    assert.equal(db.stored.paid_at, stampedEarlier, "the earlier stamp must survive");
  }),

  check("การทิ้งงานประทับ withdrawn_* ไม่ใช่ cancel_*", async () => {
    // แอดมินต้องรู้ว่าไรเดอร์ทิ้งงาน (ปุ่ม Re-broadcast + แบนเนอร์) โดยที่งาน
    // ไม่ถือ cancelled_at ค้างไว้ทั้งที่ยังวิ่งอยู่
    const db = fakeDb(job({ status: "Rider En Route", rider_id: "r1" }));
    const out = await applyTransition({
      db, jobId: "J1", event: "rider_withdrew", actor: ACTOR.RIDER, by: "rider:r1", now: clock,
    });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.status, "Following Up");
    assert.equal(db.stored.withdrawn_at, clock());
    assert.equal(db.stored.withdrawn_by, "rider:r1");
    assert.equal(db.stored.rider_id, null);
    // ห้ามแตะฟิลด์ยกเลิกเลย
    assert.equal(db.stored.cancelled_at, undefined);
    assert.equal(db.stored.cancel_category, undefined);
  }),

  check("ทิ้งงานซ้ำเขียนทับเวลาเดิม ต่างจาก paid_at", async () => {
    // ทิ้ง -> แอดมิน re-broadcast -> คนใหม่รับ -> ทิ้งอีก: แอดมินต้องเห็น
    // ครั้งล่าสุด ไม่ใช่ครั้งแรก (เงินตรงกันข้าม ประทับครั้งเดียวห้ามขยับ)
    const db = fakeDb(job({
      status: "Rider Arrived", rider_id: "r2",
      withdrawn_at: 1_600_000_000_000, withdrawn_by: "rider:r1",
    }));
    const out = await applyTransition({
      db, jobId: "J1", event: "rider_withdrew", actor: ACTOR.RIDER, by: "rider:r2", now: clock,
    });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.withdrawn_at, clock());
    assert.equal(db.stored.withdrawn_by, "rider:r2");
  }),

  check("clears wipe the field the rule names", async () => {
    const db = fakeDb(job({ status: "Rider En Route", rider_id: "r1" }));
    const out = await applyTransition({ db, jobId: "J1", event: "rider_withdrew", actor: ACTOR.RIDER, now: clock });
    assert.equal(out.ok, true, out.message);
    assert.equal(db.stored.status, "Following Up");
    assert.equal(db.stored.rider_id, null);
    assert.equal(db.stored.custody, CUSTODY.CUSTOMER);
  }),

  check("a missing job is reported, not created", async () => {
    const db = fakeDb(null);
    const out = await applyTransition({ db, jobId: "ghost", event: "case_claimed", actor: ACTOR.ADMIN_STAFF, now: clock });
    assert.equal(out.ok, false);
    assert.equal(out.code, "job_not_found");
    assert.equal(db.stored, null);
  }),

  check("history is bounded and keeps the most recent entries", async () => {
    const old = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => ({ from: "x", to: "y", at: i }));
    const db = fakeDb(job({ status: "Rider Accepted", status_history: old }));
    await applyTransition({ db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER, now: clock });
    assert.equal(db.stored.status_history.length, MAX_HISTORY);
    assert.equal(db.stored.status_history.at(-1).to, "Rider En Route");
  }),

  check("history stored as a push-keyed object is read, not clobbered", async () => {
    const db = fakeDb(job({ status: "Rider Accepted", status_history: { k1: { from: "a", to: "Rider Accepted", at: 1 } } }));
    await applyTransition({ db, jobId: "J1", event: "rider_departed", actor: ACTOR.RIDER, now: clock });
    assert.equal(db.stored.status_history.length, 2);
    assert.equal(db.stored.status_history[0].to, "Rider Accepted");
  }),

  // Cross-check: the registry and the table must not drift apart.
  check("every named side effect is owned by a real event, exactly once", async () => {
    const owners = Object.values(SIDE_EFFECT_OWNER);
    for (const [effect, event] of Object.entries(SIDE_EFFECT_OWNER)) {
      assert.ok(TRANSITIONS[event], `${effect} names an event that does not exist: ${event}`);
    }
    assert.equal(new Set(owners).size, owners.length, "two effects claim the same event");
    // The money stamp is the one the table itself also encodes — they must agree.
    const stamping = Object.entries(TRANSITIONS).filter(([, r]) => r.stampsPaid).map(([k]) => k);
    assert.deepEqual(stamping, [SIDE_EFFECT_OWNER.paid_at_stamped]);
  }),
];

await Promise.all(tests);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
