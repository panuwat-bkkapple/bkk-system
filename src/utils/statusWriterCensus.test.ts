// สำมะโนการเขียน `jobs/{id}` ตรงจากไคลเอนต์ — ตัวเลขต้องลดลงเท่านั้น
//
// **ตัวนับรอบแรก (#657) นับผิด และนี่คือรอบแก้** ของเดิมมองหา `status:` ใน
// หน้าต่าง 25 บรรทัดหลังคำสั่ง update ซึ่งจับ `status` ของ object ที่ถูกเขียน
// เป็น **ค่า** มาด้วย (`customer_offer.status: 'accepted'`, adjustment ที่
// `status: 'pending'`) — B2CWorkspacePage จึงถูกรายงานว่ามี 17 จุดทั้งที่จริง
// มี 11 และเลข 53/51 ที่เขียนไว้ใน PR ก่อนหน้าก็เกินจริงตามกันไป
//
// รอบนี้เปลี่ยนไปนับสิ่งที่ **นับพลาดไม่ได้**: จำนวนคำสั่งเขียนโหนดงานทั้งหมด
// ไม่ว่า payload จะเป็นรูปไหน (object literal, ตัวแปรที่ประกอบไว้ก่อน,
// multi-path). ตัวนับที่พลาดไปข้างน้อยคือตัวนับที่ปล่อยตัวเขียนใหม่เข้ามาได้
// ซึ่งเป็นทิศที่อันตรายกว่าการนับเกิน
//
// สิ่งที่นับได้จึงกว้างกว่า "ตัวเขียนสถานะ" — มีทั้งการเขียน qc_logs เปล่าๆ
// ข้อมูลลูกค้า และคูปอง ซึ่งไม่ใช่ transition และไม่ต้องย้ายทั้งหมด **แต่ในฐานะ
// ราวกันตกมันตอบคำถามที่ถูกกว่า: "มีทางเขียนโหนดงานตรงเพิ่มขึ้นไหม"**
//
// แดงเพราะเพิ่มขึ้น = ไปแก้ที่ตัวเขียนใหม่ ให้เรียก runJobTransition
// แดงเพราะลดลง = ย้ายสำเร็จ ลดเลขข้างล่างพร้อมกับ PR นั้น
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 108 · ลดได้ ขึ้นไม่ได้ (113 ตอนเริ่ม P2-h)
 *
 * P3-d: 92 -> 88 — ระเบิดกล่อง B2B ย้ายไป callable `unpackB2BLot` ทั้งก้อน
 * (multi-path เดิมนับเป็น 4: สถานะงานแม่ + qc_logs + updated_at + งานลูก)
 * **นี่คือใบที่ทำให้ B2BManager เหลือศูนย์** ไม่มีการเขียน jobs/{id} ตรงเลย
 *
 * P3-c: 95 -> 92 — ย้ายสาย B2B ทั้งเส้น (B2BDispatchQueue 2 จุด, B2BManager
 * ฟอร์มบริษัท 1 จุด, และ `handleB2BUpdateStatus` ของ B2CWorkspacePage ที่ถูกลบ
 * ทิ้ง) **หักกลับ +1 เพราะ `jobActivityLog.ts` เป็นตัวเขียนตรงตัวใหม่** — มันคือ
 * การรวมจุดที่ "อยากได้แค่แถวใน qc_logs" มาไว้ที่เดียว ไม่ใช่การย้ายไป engine
 * (engine ไม่มี event ที่ปลายทางเท่าต้นทาง และไม่ควรมี) 4 - 1 = 3
 *
 * ปุ่มที่ยิง event แล้วแต่ **ไม่ทำให้ตัวเลขขยับ** เพราะเดิมเรียกผ่าน prop
 * `onUpdateStatus` ไม่ใช่ `update(ref(db, ...))` ตรง: ทั้ง 9 ปุ่มของ
 * `handleB2BAction` + ปุ่มยกเลิกสองใบ + ปุ่มโทรหาลูกค้า — **ตัวเลขที่ขยับน้อย
 * ไม่ได้แปลว่าย้ายไปน้อย** (ดูย่อหน้า P2-h ข้างล่าง กับดักเดียวกัน)
 *
 * P2-o: 96 -> 95 — ลบ `handleUpdateStatus` ของ MobileTicketDetail ทิ้งหลังย้าย
 * สองใบสุดท้ายครบ **นี่คือการย้ายจริง** ต่างจากสองบรรทัดล่างที่เป็นการลบโค้ดตาย
 * กับการรวมสำเนา
 * P2-n: 106 -> 96 มาจากการ **รวมสำเนาสองชุดมาที่เดียว** (payoutTransfer) ไม่ใช่
 * การย้ายไป engine — 10 บรรทัดเดิมยังเขียน jobs/{id} ตรงเหมือนเดิม แค่ยุบจาก
 * สองไฟล์เหลือไฟล์เดียว **อ่านรวมกับความคืบหน้าของการย้ายไม่ได้**
 * P2-l: 108 -> 106 (Inventory ย้าย 2 จุด) · P2-k: 112 -> 108 มาจากการ **ลบโค้ดตาย** 4 ฟังก์ชันใน TradeInDashboard ไม่ใช่
 * การย้าย writer — ตัวเลขลดเท่ากันแต่คนละเรื่อง อย่าอ่านรวมกับความคืบหน้าของ
 * การย้าย. **ตัวนับนี้นับ *ทุก* การเขียน `jobs/{id}` ตรง ไม่ใช่แค่ที่มี
 * `status:`** เพราะการเขียนโหนดนี้ตรงข้าม engine ไม่ว่าฟิลด์ไหนก็เลี่ยง
 * status_version ที่กันสองเครื่องเขียนทับกัน
 *
 * P2-i ย้ายผู้เรียก `handleUpdateStatus` ครบทั้ง 10 จุด แล้วลบตัวฟังก์ชันทิ้ง
 * ซึ่งเป็นตอนที่เลขขยับจริง — P2-h ย้ายไป 3 จุดแต่เลขไม่ขยับเพราะตัวเขียนตรง
 * คือฟังก์ชันตัวเดียวนั้น ไม่ใช่ผู้เรียก **ตัวเลขที่นิ่งไม่ใช่สัญญาณว่าไม่มี
 * ความคืบหน้า และไม่ใช่เหตุผลให้ไปลดเพดานเอาเอง**
 */
const MAX_DIRECT_JOB_WRITES = 77; // 88 -> 77: payoutTransfer.ts (10 path-form) ย้ายขึ้น server 4 ก.ย. 2569

const require = createRequire(import.meta.url);

const SRC = resolve(__dirname, '..');

/** คำสั่งเขียนโหนดงาน: `update|set|remove(ref(db, \`jobs/${...}\`)` */
const CALL_FORM = /(?:update|set|remove)\(ref\(db,\s*`jobs\/\$\{[^`]*`\)/g;
/** multi-path: `updates[\`jobs/${id}/...\`] = ...` */
const PATH_FORM = /\[`jobs\/\$\{[^`]*`\]\s*=/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) return [];
    return [full];
  });
}

function countDirectWrites(source: string): number {
  return (source.match(CALL_FORM) || []).length + (source.match(PATH_FORM) || []).length;
}

describe('สำมะโนการเขียนโหนดงานตรง', () => {
  const perFile = walk(SRC)
    .map((f) => [f.slice(SRC.length + 1), countDirectWrites(readFileSync(f, 'utf8'))] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = perFile.reduce((sum, [, n]) => sum + n, 0);

  it(`ไม่เกินเพดาน ${MAX_DIRECT_JOB_WRITES} จุด`, () => {
    expect(total, `เหลือ:\n${perFile.map(([f, n]) => `  ${n} ${f}`).join('\n')}`)
      .toBeLessThanOrEqual(MAX_DIRECT_JOB_WRITES);
  });

  it('เพดานไม่หลวมเกินจริง — ย้ายสำเร็จแล้วต้องลดเลขในไฟล์นี้ด้วย', () => {
    // เพดานที่ตั้งสูงกว่าความจริงมากคือเพดานที่รับตัวเขียนใหม่ได้เงียบๆ
    expect(total).toBeGreaterThan(MAX_DIRECT_JOB_WRITES - 3);
  });

  it('DispatcherPage ย้ายแล้ว ห้ามกลับมาเขียนตรง', () => {
    expect(perFile.find(([f]) => f.endsWith('DispatcherPage.tsx'))).toBeUndefined();
  });

  it('PricingSidebar ไม่เหลือ handleUpdateStatus เลย และยิง event 10 จุด', () => {
    // ด่านนี้เพิ่มเข้ามาเพราะ injection รอบก่อนเขียว: ย้อนปุ่มกลับไปเป็น
    // handleUpdateStatus แล้วไม่มีเทสไหนรู้สึกอะไรเลย — ด่านที่ไปไม่ถึง
    //
    // นับจำนวนผู้เรียก ไม่ใช่เช็คว่า "มี handleTransition อยู่ไหม" เพราะแบบหลัง
    // เขียวได้ทั้งที่ปุ่มถูกย้อนกลับไปแล้วทุกตัว
    const sidebar = readFileSync(
      resolve(SRC, 'pages/admin/components/PricingSidebar.tsx'), 'utf8',
    );
    expect(sidebar).not.toContain('handleUpdateStatus');
    expect((sidebar.match(/handleTransition\(JOB_EVENT\./g) || []).length).toBe(10);
  });

  it('จอจ่ายเงินสองจอเรียก confirmPayoutTransfer ตัวเดียว ไม่ประกอบก้อนเขียนเอง', () => {
    // เดิมสองไฟล์นี้ถือสำเนาคนละชุด เหมือนกัน 88% ตรงกันเป๊ะ 53 บรรทัด (P2-n รวมเป็น
    // buildPayoutUpdates) และ 4 ก.ย. 2569 ก้อนนั้นย้ายขึ้น server ทั้งก้อน
    // (functions/payout-transfer.js) — จอเหลือแค่อัปโหลดสลิปแล้วเรียก callable
    //
    // ด่านนี้จับ "ประกอบเอง" ไม่ใช่แค่ "เรียก callable ไหม" เพราะแบบหลังเขียวได้
    // ทั้งที่มีคนก๊อปก้อนเดิมกลับมาวางข้างๆ
    for (const f of [
      'pages/finance/components/TradeInPayouts.tsx',
      'pages/mobile/MobileFinancePage.tsx',
    ]) {
      const page = readFileSync(resolve(SRC, f), 'utf8');
      expect(page, f).toContain('confirmPayoutTransfer(');
      expect(page, f).toContain('expectedNetPayout: getNetPayout(');
      expect(page, `${f} ยังประกอบก้อนเขียนเอง`).not.toContain('/paid_at`]');
      expect(page, `${f} ยังเขียนแถว ledger เอง`).not.toContain("type: 'DEBIT'");
      expect(page, `${f} ยังเขียนโหนดงานตรง`).not.toContain('update(ref(db)');
      expect(page, `${f} ยังคิดยอดเอง`).not.toContain('const getNetPayout');
    }
  });

  it('payoutTransfer ย้ายไป engine แล้ว — writer ไคลเอนต์ตัวเก่าห้ามกลับมา', () => {
    // เคยเป็น "ยังไม่ย้าย และเหตุผลถูกจดไว้" (atomic update ก้อนเดียว) — เหตุผลนั้น
    // ถูกตอบด้วยการยกทั้งก้อนขึ้น Cloud Function (transition ก่อน ledger; ดูหัว
    // functions/payout-transfer.js) ไม่ใช่ด้วยการแยกครึ่งฝั่งไคลเอนต์
    expect(existsSync(resolve(SRC, 'utils/payoutTransfer.ts'))).toBe(false);
    const client = readFileSync(resolve(SRC, 'utils/confirmPayoutTransfer.ts'), 'utf8');
    expect(client).toContain("'confirmPayoutTransfer'");
    expect(client).not.toContain('update(ref(');
  });

  it('Inventory: ปุ่มขึ้นหน้าร้านกับขายแล้วยิง event เหลือฟอร์มแก้ราคาที่รอ enum', () => {
    // ปุ่มสองตัวนี้ตรงกับ from-list ของ engine เป๊ะอยู่แล้ว (pushed_to_pos รับ
    // เฉพาะ In Stock ซึ่งเป็นเงื่อนไขที่ปุ่ม render อยู่ · sold รับ Ready To Sell)
    // จึงย้ายได้โดยไม่ต้องแตะ engine เลย
    const page = readFileSync(resolve(SRC, 'pages/inventory/Inventory.tsx'), 'utf8');
    expect(page).toContain('JOB_EVENT.PUSHED_TO_POS');
    expect(page).toContain('JOB_EVENT.SOLD');
    // ฟอร์มแก้ราคายังเขียนตรง — ไม่ใช่เพราะ enum อีกแล้ว (P3-f ปิดข้อนั้นไป)
    // แต่เพราะช่องนั้นเป็น Manual Status Override ที่ให้เลือกปลายทางเอง
    // ดูเหตุผลเต็มในเทสถัดไป
    const writes = page.match(/update\(ref\(db, `jobs\/\$\{[^}]+\}`\)/g) || [];
    expect(writes.length).toBe(1);
  });

  it("'Reserved' อ่านออกแล้ว (P3-f) — สิ่งที่ยังค้างคือรูปของ dropdown ไม่ใช่ enum", () => {
    // ด่านนี้เคยตรึงว่า normalizeStatus('Reserved') === null และบอกว่า "แดงเมื่อไหร่
    // ให้กลับมาย้าย handleSavePricing" — มันแดงจริงตอนเพิ่ม RESERVED เข้า enum
    //
    // **แต่ enum ไม่ใช่สิ่งเดียวที่บล็อกอยู่** และการย้ายตอนนี้จะพลาดประเด็น:
    // ช่องนั้นชื่อ "Manual Status Override" ให้แอดมินกระโดดไปสถานะไหนก็ได้ใน
    // สามค่า ซึ่งเป็น **รูป "ไคลเอนต์เลือกปลายทางเอง"** ที่งานทั้งชุดนี้กำจัด
    // การย้ายมันโดยไม่ตัดสินใจก่อนว่าช่องนี้ควรมีอยู่ไหม = สร้าง event ที่รับ
    // ปลายทางจากไคลเอนต์ ซึ่งแย่กว่าปล่อยให้เขียนตรงแล้วนับไว้ในสำมะโน
    const vocab = require(resolve(__dirname, '../../functions/status-vocab.generated.js'));
    expect(vocab.normalizeStatus('Reserved')).toBe('Reserved');
    expect(vocab.getPhase('Reserved')).toBe('inventory');
  });

  it('TradeInDashboard: สี่ฟังก์ชันที่ไม่มีใครเรียกต้องไม่กลับมา', () => {
    // ทั้งสี่ตัวถูกลบใน P2-k เพราะ eslint ยืนยันว่า assigned but never used และ
    // ไม่ได้ส่งเป็น prop ไปไหน — ตัวจริงที่หน้าจอใช้เป็นชื่อเดียวกันในไฟล์อื่น
    //
    // ด่านนี้ไม่ใช่เรื่องความสะอาด: ทั้งสี่ตัวเขียน `jobs/{id}` ตรงและสามตัวเขียน
    // `status` เอง ถ้าใครก๊อปกลับมาเพราะเห็นว่า "เคยมี" มันจะเป็นทางเขียนที่ไม่
    // ผ่าน engine ที่ไม่มีปุ่มไหนเรียก และไม่มีใครสังเกต
    const page = readFileSync(resolve(SRC, 'features/trade-in/TradeInDashboard.tsx'), 'utf8');
    for (const gone of [
      'const handleUpdateStatus',
      'const handleReviseOffer',
      'const handleClaimTicket',
      'const handleSaveNotes',
    ]) {
      expect(page, gone).not.toContain(gone);
    }
  });

  it('TradeInDashboard: ตัวที่เหลือแตะแค่ is_read ไม่ใช่ status', () => {
    // handleRowClick ยังอยู่และถูกเรียกจริงจาก JSX สองที่ — มันเขียน `is_read`
    // ซึ่งเป็นธงของ UI ไม่ใช่สถานะงาน engine ไม่ได้เป็นเจ้าของฟิลด์นั้น
    const page = readFileSync(resolve(SRC, 'features/trade-in/TradeInDashboard.tsx'), 'utf8');
    const writes = page.match(/update\(ref\(db, `jobs\/\$\{[^}]+\}`\)/g) || [];
    expect(writes.length).toBe(1);
    expect(page).toContain('is_read: true');

    // `status:` ที่เหลือในไฟล์เป็น payload ของการ **สร้างงานใหม่** (instant-sell
    // และ B2B lead) ซึ่งไม่ใช่ transition — engine เปลี่ยนสถานะของงานที่มีอยู่
    // การตั้งสถานะเริ่มต้นตอนสร้างจึงอยู่นอกขอบเขตมันโดยนิยาม
    //
    // ที่ต้องไม่มีคือ `status:` ที่อยู่ใน object ของ update() ต่องานที่มีอยู่แล้ว
    const updateBlocks = page.match(/update\(ref\(db, `jobs\/\$\{[^}]+\}`\), \{[^}]*\}/g) || [];
    for (const block of updateBlocks) {
      expect(block, 'update() ต่องานที่มีอยู่ห้ามพา status: ไปเอง').not.toContain('status:');
    }
  });

  it('MobileTicketDetail: ตาราง quick actions ยิง event ครบทุกใบ ไม่เหลือ legacy', () => {
    // P2-o ปิดสองใบสุดท้าย — `legacyStatus` ถูกลบออกจาก type ไปด้วย ไคลเอนต์
    // จึงเลือกสถานะปลายทางเองไม่ได้อีกแม้จะอยากทำ
    const page = readFileSync(resolve(SRC, 'pages/mobile/MobileTicketDetail.tsx'), 'utf8');
    const moved = page.match(/event: JOB_EVENT\./g) || [];
    expect(moved.length).toBe(25);
    expect(page).not.toMatch(/legacyStatus: (?:JOB_STATUS\.|')/);
    expect(page).not.toContain('const handleUpdateStatus');
  });

  it('MobileTicketDetail: ด่านสิทธิ์จ่ายเงินรอดจากการลบ handleUpdateStatus', () => {
    // **ตัวนี้เกือบหลุด** — ด่าน `job_mark_paid` เคยอยู่ใน handleUpdateStatus
    // การลบฟังก์ชันนั้นทิ้งพาด่านไปด้วย และไม่มี error ให้ใครเห็น: engine กัน
    // actor ที่ไม่ใช่แอดมิน/finance ได้ก็จริง แต่ job_mark_paid เป็นด่านของ
    // *ร้าน* ที่บันทึก audit ทั้งตอนผ่านและตอนถูกปฏิเสธ ซึ่ง engine ไม่ทำแทน
    //
    // ตอนนี้ผูกกับ **event** ไม่ใช่ชื่อสถานะ (เดิมต้องจำสองสะกด 'Paid'/'PAID')
    const page = readFileSync(resolve(SRC, 'pages/mobile/MobileTicketDetail.tsx'), 'utf8');
    const handler = page.slice(page.indexOf('const handleTransition'), page.indexOf('const handleSaveTracking'));
    expect(handler).toContain("guard('job_mark_paid'");
    expect(handler).toContain('JOB_EVENT.ADMIN_MARKED_PAID');
  });

  it('MobileTicketDetail: ผลพลอยได้ตอนเข้าคลังผูกกับปลายทางที่ engine ตอบ', () => {
    // งานที่ขายพ่วงอุปกรณ์เสริมต้องแตกเป็น stock รายชิ้นตอนเข้าคลัง — เดิมผูกกับ
    // สถานะที่ไคลเอนต์เพิ่งเขียนเอง ถ้าย้ายมา event แล้วลืมต่อสายนี้ อุปกรณ์เสริม
    // จะไม่เข้าสต๊อกโดยไม่มี error อะไรเลย (เงียบแบบเดียวกับเคส qc_logs)
    const page = readFileSync(resolve(SRC, 'pages/mobile/MobileTicketDetail.tsx'), 'utf8');
    const handler = page.slice(page.indexOf('const handleTransition'), page.indexOf('const handleUpdateStatus'));
    expect(handler).toContain("res.to === 'In Stock'");
    expect(handler).toContain('unpackAccessoryItemsToStock');
  });

  it('B2CWorkspacePage ไม่มีตัวเขียนสถานะแบบไคลเอนต์เลือกปลายทางเหลืออยู่', () => {
    // ตัวฟังก์ชันถูกลบ ไม่ใช่แค่ไม่มีคนเรียก — ฟังก์ชันที่ยังอยู่คือฟังก์ชันที่
    // PR หน้าจะหยิบมาใช้เพราะมันสะดวกกว่าการหา event ที่ถูก
    const page = readFileSync(resolve(SRC, 'pages/admin/B2CWorkspacePage.tsx'), 'utf8');
    expect(page).not.toContain('const handleUpdateStatus');
  });

  it('ยังนับเจอกองใหญ่ — ตัวนับที่นับไม่เจออะไรเลยจะเขียวเสมอ', () => {
    const names = perFile.map(([f]) => f);
    expect(names.some((f) => f.endsWith('B2CWorkspacePage.tsx'))).toBe(true);
    expect(names.some((f) => f.endsWith('MobileTicketDetail.tsx'))).toBe(true);
    // รูป multi-path (`updates[...] = `) เคยถูกนับที่ payoutTransfer.ts — ไฟล์นั้น
    // ย้ายขึ้น server แล้ว (4 ก.ย. 2569) จึงไม่เหลือให้นับ; regex PATH_FORM ยังอยู่
    // เพื่อกันคนเขียนรูปนั้นกลับมา
    expect(names.some((f) => f.endsWith('payoutTransfer.ts'))).toBe(false);
  });
});
