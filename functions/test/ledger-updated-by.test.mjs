// ---------------------------------------------------------------------------
// `price_ledger.updated_by` ต้องไม่เป็นอีเมลพนักงาน
//
//   node functions/test/ledger-updated-by.test.mjs
//
// ทำไมต้องมีเทสนี้ทั้งที่เป็นการแก้บรรทัดเดียว: `price_ledger` เป็นโหนดที่
// `.read: true` โดยตั้งใจ (ลูกค้าดูประวัติการเปลี่ยนราคาได้) ดังนั้นทุกฟิลด์
// ในนั้นคือของสาธารณะ — `curl .../price_ledger.json` ครั้งเดียวเคยได้ทะเบียน
// อีเมลทีมทั้งชุดโดยไม่ต้อง login
//
// เทสอ่าน SOURCE ของจุดเขียนทั้งสองที่โดยตรง แทนที่จะเทสฟังก์ชัน เพราะของที่
// ต้องกันคือ "มีคนเขียน auth.currentUser?.email ลง ledger อีกครั้ง" ซึ่งเป็น
// บรรทัดในไฟล์ ไม่ใช่ค่าที่ฟังก์ชันคืน — เทสที่เรียกฟังก์ชันจะไม่มีวันเห็น
// การแก้กลับแบบนั้น
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const WRITE_SITES = [
  "src/features/trade-in/PriceEditor.tsx",
  "src/features/trade-in/modals/BatchPriceAdjustModal.tsx",
];

for (const rel of WRITE_SITES) {
  const src = readFileSync(join(root, rel), "utf8");

  // บล็อกที่เขียน ledger จริง — ตัดมาดูเฉพาะรอบๆ updated_by
  const idx = src.indexOf("updated_by");
  check(`${rel}: เขียน updated_by จริง`, idx > -1);

  const assignsUid = /adminUser\s*=\s*auth\.currentUser\?\.uid/.test(src);
  const assignsEmail = /adminUser\s*=\s*auth\.currentUser\?\.email/.test(src);

  check(`${rel}: ใช้ uid`, assignsUid);
  check(`${rel}: ไม่ใช้อีเมล`, !assignsEmail);

  // fallback ต้องไม่ใช่ข้อความที่ดูเหมือนตัวตนคน
  check(
    `${rel}: fallback เป็น "admin" ไม่ใช่ชื่อคน`,
    /auth\.currentUser\?\.uid\s*\|\|\s*'admin'/.test(src)
  );

  // กันกว้างอีกชั้น: ต้องไม่มี `.email` โผล่ในบรรทัดเดียวกับ updated_by
  const line = src.split("\n").find((l) => l.includes("updated_by:"));
  check(`${rel}: บรรทัด updated_by ไม่มี .email`, !!line && !line.includes(".email"));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
