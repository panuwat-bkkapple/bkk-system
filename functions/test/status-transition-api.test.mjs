// transitionJob — the parts worth testing offline: who a caller becomes, which
// refusal the client sees, and the ownership rule that the engine's table
// cannot express.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { __test__ } = require(path.join(root, "functions/status-transition-api.js"));
const { ACTOR, TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));
const { applyTransition } = require(path.join(root, "functions/status-apply.js"));
const { actorForRole, riderOwnershipGuard, CODE_TO_HTTPS } = __test__;

let failures = 0;
const results = [];
function check(name, fn) {
  results.push(
    Promise.resolve()
      .then(fn)
      .then(() => console.log(`  ok   ${name}`))
      .catch((err) => {
        failures++;
        console.error(`  FAIL ${name}\n       ${err.message}`);
      })
  );
}

console.log("status-transition-api");

check("staff roles map to the actors the engine gates on", () => {
  assert.equal(actorForRole("CEO"), ACTOR.ADMIN_MANAGER);
  assert.equal(actorForRole("MANAGER"), ACTOR.ADMIN_MANAGER);
  assert.equal(actorForRole("FINANCE"), ACTOR.FINANCE);
  assert.equal(actorForRole("STAFF"), ACTOR.ADMIN_STAFF);
  assert.equal(actorForRole("RIDER"), ACTOR.RIDER);
  assert.equal(actorForRole("staff"), ACTOR.ADMIN_STAFF, "case must not matter");
});

// domain.ts still carries these two, marked deprecated, and no route guard in
// the app recognises them. A record left on an old role must lose access, not
// quietly fall through to staff powers.
check("deprecated and unknown roles map to nothing", () => {
  for (const role of ["CASHIER", "QC", "", null, undefined, "ADMIN"]) {
    assert.equal(actorForRole(role), null, `${role} must not resolve`);
  }
});

check("the caller never becomes `system`", () => {
  // ACTOR.SYSTEM satisfies every rule in the table (schedulers and triggers).
  // Nothing a request can say may resolve to it.
  const reachable = Object.keys({ CEO: 1, MANAGER: 1, FINANCE: 1, STAFF: 1, RIDER: 1 }).map(actorForRole);
  assert.ok(!reachable.includes(ACTOR.SYSTEM));
});

check("every refusal the engine can produce has a client-facing status", () => {
  // Codes decideTransition and applyTransition can return, plus the guard's.
  const engineCodes = [
    "unknown_event", "unreadable_status", "illegal_from", "wrong_actor",
    "wrong_receive_method", "missing_field", "already_paid", "not_paid",
    "job_not_found", "patch_conflict", "write_contended", "not_job_owner",
  ];
  for (const code of engineCodes) {
    assert.ok(CODE_TO_HTTPS[code], `no HttpsError mapping for ${code}`);
  }
  // "you may not" and "try again" must not collapse into one bucket.
  assert.equal(CODE_TO_HTTPS.wrong_actor, "permission-denied");
  assert.equal(CODE_TO_HTTPS.not_job_owner, "permission-denied");
  assert.equal(CODE_TO_HTTPS.write_contended, "aborted");
  assert.notEqual(CODE_TO_HTTPS.illegal_from, CODE_TO_HTTPS.wrong_actor);
});

check("a rider may act on the job they hold, and no other", () => {
  const guard = riderOwnershipGuard("rider-1", "rider_departed");
  assert.equal(guard({ rider_id: "rider-1" }), null);
  assert.equal(guard({ rider_id: "rider-2" }).code, "not_job_owner");
  assert.equal(guard({}).code, "not_job_owner", "an unclaimed job is not theirs to drive");
});

// This is how a job becomes a rider's in the first place, so it is the one
// event where "nobody holds it" has to pass.
check("claiming an unheld job is allowed; stealing a held one is not", () => {
  const guard = riderOwnershipGuard("rider-1", "rider_accepted");
  assert.equal(guard({}), null);
  assert.equal(guard({ rider_id: null }), null);
  assert.equal(guard({ rider_id: "rider-2" }).code, "not_job_owner");
  assert.equal(guard({ rider_id: "rider-1" }), null, "re-accepting your own job is not an error");
});

check("only the claiming events get the unclaimed exemption", () => {
  for (const event of Object.keys(TRANSITIONS)) {
    if (event === "rider_accepted") continue;
    assert.equal(
      riderOwnershipGuard("rider-1", event)({}).code,
      "not_job_owner",
      `${event} must not be usable on an unclaimed job`
    );
  }
});

// The reason the guard is a hook inside applyTransition rather than a check
// before it: between a read and a write, a job can be reassigned.
check("ownership is judged against the row inside the transaction", async () => {
  let stored = { status: "Rider En Route", receive_method: "Pickup", rider_id: "rider-1" };
  let stolen = false;
  const db = {
    ref: () => ({
      async transaction(fn) {
        for (let i = 0; i < 5; i++) {
          const proposed = fn({ ...stored });
          if (proposed === undefined) return { committed: false, snapshot: { val: () => stored } };
          if (!stolen) {
            // Dispatcher reassigns the job between the read and the commit.
            stolen = true;
            stored = { ...stored, rider_id: "rider-2" };
            continue;
          }
          stored = proposed;
          return { committed: true, snapshot: { val: () => stored } };
        }
        return { committed: false, snapshot: { val: () => stored } };
      },
    }),
  };

  const out = await applyTransition({
    db, jobId: "J1", event: "rider_arrived", actor: ACTOR.RIDER,
    guard: riderOwnershipGuard("rider-1", "rider_arrived"),
    now: () => 1,
  });
  assert.equal(out.ok, false, "must not commit onto a job that was reassigned mid-flight");
  assert.equal(out.code, "not_job_owner");
  assert.equal(stored.status, "Rider En Route");
});

check("a guard that passes does not otherwise change the outcome", async () => {
  let stored = { status: "Rider En Route", receive_method: "Pickup", rider_id: "rider-1" };
  const db = {
    ref: () => ({
      async transaction(fn) {
        const proposed = fn({ ...stored });
        if (proposed === undefined) return { committed: false, snapshot: { val: () => stored } };
        stored = proposed;
        return { committed: true, snapshot: { val: () => stored } };
      },
    }),
  };
  const out = await applyTransition({
    db, jobId: "J1", event: "rider_arrived", actor: ACTOR.RIDER,
    guard: riderOwnershipGuard("rider-1", "rider_arrived"),
    now: () => 1,
  });
  assert.equal(out.ok, true, out.message);
  assert.equal(stored.status, "Rider Arrived");
});

await Promise.all(results);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
