/**
 * ราวกันตกของการสลับกะกับเพื่อน
 *
 * **สองข้อที่พังเงียบที่สุดของฟีเจอร์นี้ และเป็นเหตุผลที่ไฟล์นี้มีอยู่:**
 *  1. หัวหน้าอนุมัติได้ก่อนเพื่อนตอบรับ = เปลี่ยนกะของคนอื่นลับหลังเขา
 *  2. อนุมัติแล้วเขียนตารางเวรฝั่งเดียว = วันนั้นมีสองคนอยู่กะเดียวกันและอีกกะ
 *     ไม่มีใคร **โดยไม่มีใครเห็นจนถึงวันงาน**
 * ทั้งคู่ไม่ทำให้อะไรพัง ไม่มี error ไม่มีเทสแดง — ตระกูลเดียวกับ `status_history`
 *
 * ตาราง injection (วัดจริง 5 ก.ย. 2569 — ตัวเลขคือจำนวนข้อที่แดง):
 *   ให้ employeeShiftSwapCreate ตั้ง status เป็น "pending" ทันที      -> แดง 1
 *   ให้ supervisorDecide เขียนตารางเวรเฉพาะฝั่งผู้ขอ                  -> แดง 1
 *   ถอดการตรวจ swap_with_employee_id ใน employeeShiftSwapRespond      -> แดง 1
 *   ถอดการล้างตัวชี้ shift_swap_inbox ตอนตอบ                          -> แดง 1
 *   ให้ supervisorLeaveAttachment ข้ามการตรวจว่าไฟล์แนบกับใบนั้น       -> แดง 1
 *   ให้ employeeShiftChangeList ไล่อ่าน shift_requests ของทุกคน       -> แดง 1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "hr-employee-portal.js"), "utf8");

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
};

/** body ของ callable ตัวหนึ่ง — ตัดที่ callable ตัวถัดไป ไม่ใช่หน้าต่างคงที่ */
function bodyOf(name) {
  const marks = [...src.matchAll(/const (\w+) = onCall\(/g)];
  const i = marks.findIndex((m) => m[1] === name);
  assert.ok(i >= 0, `ไม่พบ callable ${name}`);
  const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
  return src.slice(marks[i].index, end);
}

test("คำขอสลับเริ่มที่ awaiting_peer ไม่ใช่ pending", () => {
  const b = bodyOf("employeeShiftSwapCreate");
  assert.ok(/status:\s*"awaiting_peer"/.test(b),
    "ใบที่เข้ากล่องหัวหน้าทันที = หัวหน้าอนุมัติได้ก่อนเพื่อนรู้ตัว");
  assert.ok(!/status:\s*"pending"/.test(b), "ห้ามตั้ง pending ตั้งแต่ตอนสร้าง");
});

test("มีแต่คนที่ถูกระบุในใบเท่านั้นที่ตอบได้ และตัวชี้ถูกล้างเมื่อตอบ", () => {
  const b = bodyOf("employeeShiftSwapRespond");
  assert.ok(/swap_with_employee_id.*!==\s*employeeId/s.test(b),
    "ต้องตรวจว่าผู้ตอบคือคนที่ใบระบุไว้ — ตรวจจากใบ ไม่ใช่จากพารามิเตอร์");
  assert.ok(/shift_swap_inbox\/\$\{employeeId\}\/\$\{requestId\}`\)\.remove\(\)/.test(b),
    "ตอบแล้วต้องออกจากกล่อง 'รอฉันตอบ' ไม่ว่าตอบว่าอะไร");
  assert.ok(/status !== "awaiting_peer"/.test(b), "ใบที่ตอบไปแล้วต้องตอบซ้ำไม่ได้");
});

test("อนุมัติคำขอสลับ เขียนตารางเวรสองฝั่งในคำสั่งเดียว", () => {
  const b = bodyOf("supervisorDecide");
  const swapBranch = b.slice(b.indexOf("kind === \"shift\" && status === \"approved\""));
  assert.ok(swapBranch.includes("swap_with_employee_id"),
    "ขาสลับไม่ถูกอ่านตอนอนุมัติ = เขียนฝั่งเดียว");
  // ต้องมีทั้งสอง path อยู่ใน update() ก้อนเดียว
  assert.ok(/shift_roster\/\$\{targetId\}\/\$\{cur\.date\}/.test(swapBranch));
  assert.ok(/shift_roster\/\$\{peerId\}\/\$\{cur\.date\}/.test(swapBranch),
    "ไม่ได้เขียนฝั่งเพื่อน — วันนั้นจะมีสองคนอยู่กะเดียวกันโดยไม่มีใครเห็น");
  const upd = swapBranch.slice(swapBranch.indexOf("db.ref().update("));
  assert.ok(upd.indexOf("peerId") > 0 && upd.indexOf("targetId") > 0,
    "สองฝั่งต้องอยู่ใน update() ก้อนเดียว (atomic) ไม่ใช่เขียนทีละคำสั่ง");
});

test("หัวหน้าเปิดไฟล์แนบได้เฉพาะไฟล์ที่แนบกับใบลานั้นจริง", () => {
  const b = bodyOf("supervisorLeaveAttachment");
  assert.ok(/supervisor_id, 80\) !== supervisorId/.test(b), "ไม่ได้ตรวจว่าเป็นลูกน้องตรง");
  assert.ok(/attachments \|\| \[\]\)\.some/.test(b),
    "ไม่ได้ตรวจว่าไฟล์ถูกแนบกับใบนี้ — กลายเป็นประตูอ่านสำเนาบัตรของลูกน้องทุกคน");
});

test("กล่อง 'รอฉันตอบ' อ่านผ่านตัวชี้ ไม่ไล่อ่านคำขอของทุกคน", () => {
  const b = bodyOf("employeeShiftChangeList");
  assert.ok(/shift_swap_inbox\/\$\{employeeId\}/.test(b),
    "ต้องอ่านผ่านตัวชี้ในกล่องของตัวเอง (กฎค่า RTDB ห้ามกวาดโหนด)");
  assert.ok(!/db\.ref\("shift_requests"\)/.test(b) && !/db\.ref\(`shift_requests`\)/.test(b),
    "ห้ามอ่านโหนด shift_requests ทั้งก้อน");
});

test("ตัวชี้ถูกเขียนตอนสร้างคำขอ ไม่งั้นกล่องของเพื่อนจะว่างตลอด", () => {
  const b = bodyOf("employeeShiftSwapCreate");
  assert.ok(/shift_swap_inbox\/\$\{peerId\}/.test(b),
    "ไม่ได้เขียนตัวชี้ — เพื่อนจะไม่มีทางเห็นคำขอเลย");
});

console.log(`hr-shift-swap: ผ่าน ${passed} ข้อ`);
