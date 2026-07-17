// ---------------------------------------------------------------------------
// Offline unit test for the CRM Contact identity helpers (functions/crm.js).
// Pure functions only — no Firebase. resolveCustomer() (DB-touching) is covered
// by integration when it is wired in Phase 2.
//
//   node functions/test/crm.test.mjs
//
// Also cross-checks that crm.normalizePhone stays byte-identical to the copy in
// chat-ai.js — a mismatch would split one person into two contacts (the index
// keys would diverge). Phase 2 collapses them into a single source.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { normalizePhone, phoneKey, emailKey } = require("../crm.js");
const { __test } = require("../chat-ai.js");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// --- normalizePhone ---
check("strips spaces/dashes/parens", normalizePhone("099-454 22.07") === "0994542207");
check("+66 -> 0", normalizePhone("+66994542207") === "0994542207");
check("66xxxxxxxxx -> 0", normalizePhone("66994542207") === "0994542207");
check("plain local kept", normalizePhone("0994542207") === "0994542207");
check("empty -> ''", normalizePhone("") === "" && normalizePhone(null) === "");

// --- MUST match chat-ai.js exactly (data-contract guard) ---
for (const raw of ["099-454 2207", "+66994542207", "66994542207", "0812345678", "", "0-2-000-0000"]) {
  check(
    `normalizePhone matches chat-ai for "${raw}"`,
    normalizePhone(raw) === __test.normalizePhone(raw)
  );
}

// --- phoneKey ---
check("phoneKey normalizes + keeps digits", phoneKey("+66 99 454 2207") === "0994542207");
check("phoneKey rejects too-short", phoneKey("123") === "");
check("phoneKey rejects junk", phoneKey("abc") === "");

// --- emailKey ---
check("emailKey lowercases", emailKey("Nareeratpae1985@Gmail.com") === "nareeratpae1985@gmail,com");
check("emailKey encodes dots (RTDB-safe)", !emailKey("a.b@x.co").includes("."));
check("emailKey rejects non-email", emailKey("not-an-email") === "" && emailKey("") === "");
check("emailKey trims", emailKey("  a@b.co  ") === "a@b,co");

console.log(`\n${failures === 0 ? "all passed" : failures + " failed"}`);
process.exit(failures ? 1 : 0);
