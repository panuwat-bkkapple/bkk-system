// ---------------------------------------------------------------------------
// อีเมล + ใบสำคัญรับเงินต้องใส่เลขลำดับเครื่องเมื่อมีมากกว่าหนึ่งเครื่อง
//
//   node functions/test/device-lines-numbered.test.mjs
//
// ที่มา: สองเครื่องเหมือนกันบนออเดอร์เดียว (ปุ่ม "เพิ่มเครื่องแบบเดียวกัน")
// พิมพ์ออกมาเป็นสองบรรทัดที่เหมือนกันทุกตัวอักษร ลูกค้าดูเอกสารแล้วบอกไม่ได้
// ว่ามันคือสองเครื่องหรือบรรทัดเดียวที่พิมพ์ซ้ำ. ออเดอร์เครื่องเดียวห้ามมี "#1"
//
// ผล injection — วัดจริง 5 ก.ย. 2569:
//   email.js ไม่ใส่ prefix                → แดง 1
//   voucher-pdf.js ไม่ใส่ prefix          → แดง 1
//   ใส่ prefix แม้มีเครื่องเดียว (email)  → แดง 1
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const email = require("../email.js");
const voucher = require("../voucher-pdf.js");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { failures++; console.log(`FAIL  ${label}`); }
};

const twins = { devices: [
  { model: "iPhone 17 256GB", price: 25000 },
  { model: "iPhone 17 256GB", price: 25000 },
] };
const single = { devices: [{ model: "iPhone 17 256GB", price: 25000 }] };

for (const [name, mod] of [["email.js", email], ["voucher-pdf.js", voucher]]) {
  const rows = mod.deviceLines(twins);
  check(`${name}: สองเครื่องเหมือนกัน → #1 / #2`,
    rows.length === 2 && rows[0].name === "#1 iPhone 17 256GB" && rows[1].name === "#2 iPhone 17 256GB");
  check(`${name}: ราคาไม่เปลี่ยน`, rows[0].price === 25000 && rows[1].price === 25000);
  check(`${name}: เครื่องเดียวไม่มีเลขนำหน้า`, mod.deviceLines(single)[0].name === "iPhone 17 256GB");
}
check("email.js: offer_request ยังไม่โชว์ราคา", email.deviceLines({ devices: [{ model: "A", offer_request: true, price: 0 }, { model: "B", price: 1 }] })[0].price === null);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
