// ด่านของด่าน — workflow ที่เป็น "ด่าน" ห้ามกรอง pull_request ด้วย base branch
//
// `on: pull_request: branches: [main]` กรองตาม **base** ของ PR ไม่ใช่ head
// PR ที่ตั้ง base เป็น branch อื่น (stacked PR ซึ่งเป็นรูปปกติของงานที่ต้องเรียง
// engine ก่อน client) จึงไม่มี run ถูกสร้างเลย และหน้า PR ขึ้นว่างเปล่า ซึ่ง
// อ่านผ่านๆ แล้วเหมือน "ยังไม่ถึงคิว" ไม่ใช่ "ไม่มีด่าน"
//
// เคสจริง 3 ก.ย. 2569: #661 (ขยาย from-list ของ status engine) merge เข้า main
// ไปโดยไม่มี workflow ไหนรันบนมันเลยสักตัว
//
// เทสนี้เองก็รันใน ci.yml — มันจึงกัน *การถอยหลัง* บน PR ที่ base เป็น main ได้
// แต่กันตัวเองไม่ได้ถ้ามีคนใส่ตัวกรองกลับพร้อมกับตั้ง base เป็น branch อื่น
// นั่นเป็นข้อจำกัดที่แก้ที่ไฟล์ YAML ไม่ได้ ต้องแก้ที่ branch protection
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

/**
 * workflow ที่ผลของมันคือคำตอบว่า "PR นี้ merge ได้ไหม"
 *
 * ไม่รวม firebase-hosting-preview.yml โดยตั้งใจ — มัน deploy preview channel
 * ไม่ใช่ด่าน การข้าม preview บน stacked PR เป็นเรื่องที่ยอมรับได้ (และประหยัด
 * channel ด้วย) ถ้าวันหนึ่งมันกลายเป็นด่าน ให้ย้ายชื่อมาไว้ในลิสต์นี้
 */
const GATE_WORKFLOWS = ["ci.yml", "sync-status-enum.yml"];

/** ดึงบล็อกย่อยของคีย์ `key` ที่ระดับ indent 2 ออกมาจากบล็อก `on:` */
function pullRequestBlock(yaml) {
  const lines = yaml.split("\n");
  const onAt = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.notEqual(onAt, -1, "หา `on:` ไม่เจอ");

  // บล็อก on: = บรรทัดที่ย่อหน้าหรือว่าง จนถึงบรรทัดที่ไม่ย่อหน้าตัวถัดไป
  let end = onAt + 1;
  while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]))) end++;
  const block = lines.slice(onAt + 1, end);

  const prAt = block.findIndex((l) => /^ {2}pull_request:\s*$/.test(l));
  if (prAt === -1) return null;

  const nested = [];
  for (let i = prAt + 1; i < block.length; i++) {
    if (/^ {2}\S/.test(block[i])) break; // คีย์ event ตัวถัดไป
    if (block[i].trim() !== "") nested.push(block[i]);
  }
  return nested;
}

for (const file of GATE_WORKFLOWS) {
  const yaml = readFileSync(path.join(root, ".github/workflows", file), "utf8");

  check(`${file}: มี trigger pull_request จริง`, () => {
    assert.notEqual(pullRequestBlock(yaml), null, "ไม่มี `pull_request:` — ด่านนี้ไม่รันบน PR เลย");
  });

  check(`${file}: pull_request ไม่กรองด้วย branches`, () => {
    const nested = pullRequestBlock(yaml) || [];
    const filter = nested.find((l) => /^\s+branches(-ignore)?:/.test(l));
    assert.equal(
      filter,
      undefined,
      `เจอตัวกรอง base branch: "${(filter || "").trim()}" — stacked PR จะไม่มีด่านรันเลย`
    );
  });
}

check("ci.yml มี workflow_dispatch ไว้กดมือ", () => {
  // ทางออกฉุกเฉินตอน event ไม่ยิงให้ — ตอนเจอปัญหานี้ครั้งแรกไม่มีปุ่มนี้ จึง
  // ไม่มีทางรันด่านบน branch นั้นได้เลยนอกจาก push ใหม่
  const yaml = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(yaml, /^ {2}workflow_dispatch:\s*$/m);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
