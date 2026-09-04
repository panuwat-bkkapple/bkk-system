// terminal-statuses — offline suite. เขียนจากบั๊กจริง: TERMINAL_STATUSES ใน
// index.js มี "Returned" สะกดเก่าตัวเดียว → งานที่ engine เขียน 'Return Confirmed'
// ไม่ถูก archive และ onJobTerminalCancelAmendments ไม่ปิด amendment ให้
//
// INJECTION RESULTS (ทำทีละตัว วัดหลังรัน):
//   1. isTerminalStatus เทียบ raw === ไม่ normalize          -> แดง 3
//   2. ตัด RETURN_CONFIRMED ออกจาก TERMINAL_CANONICAL          -> แดง 4
//   3. queryStatusesFor (status-match.js) ไม่กาง alias        -> แดง 1 (alias ที่ query ไม่ครบ)
//      (เดิม query list เขียน "Returned" ไว้ตรงๆ — ย้ายไปกางจาก LEGACY_ALIAS แล้ว)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { TERMINAL_CANONICAL, TERMINAL_QUERY_STATUSES, isTerminalStatus } = require(
  path.join(root, "functions/terminal-statuses.js")
);
const { TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));
const { normalizeStatus } = require(path.join(root, "functions/status-vocab.generated.js"));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

// คีย์ LEGACY_ALIAS จากไฟล์ enum จริง (generated vocab ไม่ export ตารางนี้)
function legacyAliasKeys() {
  const ts = fs.readFileSync(path.join(root, "src/types/job-statuses.ts"), "utf8");
  const block = ts.match(/const LEGACY_ALIAS[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(block, "หา LEGACY_ALIAS ในไฟล์ enum ไม่เจอ");
  return block[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .map((l) => l.match(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_]+))\s*:/))
    .filter(Boolean)
    .map((m) => m[1] || m[2] || m[3]);
}

console.log("terminal-statuses");

check("Return Confirmed ทั้งสองสะกดคือจบงาน — ของ engine และแถวเก่า", () => {
  assert.equal(isTerminalStatus("Return Confirmed"), true);
  assert.equal(isTerminalStatus("Returned"), true);
});

check("ลิสต์เดิมทุกค่ายังจบงานเหมือนเดิม รวม Withdrawal Completed ที่ไม่อยู่ใน enum", () => {
  for (const s of ["Completed", "Sold", "Cancelled", "Closed (Lost)", "Returned", "Withdrawal Completed"]) {
    assert.equal(isTerminalStatus(s), true, s);
  }
});

check("สถานะกลางทางไม่ใช่จบงาน — รวมค่าว่างและค่าอ่านไม่ออก", () => {
  for (const s of ["Pending QC", "In Stock", "Ready To Sell", "Returning To Customer", "Paid", "Reserved", "", null, undefined]) {
    assert.equal(isTerminalStatus(s), false, JSON.stringify(s));
  }
});

check("ปลายทางของ return_delivered / finalized_lost / sold / cancelled ในตาราง engine ถูกจับ", () => {
  for (const event of ["return_delivered", "finalized_lost", "sold", "cancelled"]) {
    assert.equal(isTerminalStatus(TRANSITIONS[event].to), true, `${event} -> ${TRANSITIONS[event].to}`);
  }
});

check("query list ของ archive ครอบทุกสะกดที่ normalize มาลงเซ็ตนี้ — จากตาราง alias จริง", () => {
  // archive query ตาม index status ทีละค่า สะกดที่หายจาก list = แถวที่ไม่มีวันถูก
  // archive โดยไม่มี error. ตรวจจาก LEGACY_ALIAS ในไฟล์ enum ไม่ใช่จากความจำ
  const missing = legacyAliasKeys().filter(
    (legacy) => TERMINAL_CANONICAL.includes(normalizeStatus(legacy)) && !TERMINAL_QUERY_STATUSES.includes(legacy)
  );
  assert.deepEqual(missing, [], `alias ที่ archive มองไม่เห็น: ${missing.join(", ")}`);
  for (const c of TERMINAL_CANONICAL) assert.ok(TERMINAL_QUERY_STATUSES.includes(c), c);
  // และทุกค่าใน query list ต้องผ่าน isTerminalStatus — ไม่งั้น archive ดึงมาแล้ว trigger ไม่รู้จัก
  for (const s of TERMINAL_QUERY_STATUSES) assert.equal(isTerminalStatus(s), true, s);
});

if (failures > 0) {
  console.error(`\nterminal-statuses: ${failures} failing`);
  process.exit(1);
}
console.log("terminal-statuses: all passing");
