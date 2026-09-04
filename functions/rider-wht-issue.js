// =============================================================================
// ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ให้ไรเดอร์ — ฝั่ง server
//
// trigger ที่ `transactions/{txId}` เมื่อมีรายการถอนที่หักภาษีไว้ (เขียนโดย
// หน้า Rider Withdrawals ตอน finance ยืนยันโอน) แล้ว:
//   1. จองเลขที่เอกสาร (transaction — เลขห้ามซ้ำและห้ามข้าม)
//   2. สร้าง PDF + เก็บที่ Storage
//   3. เขียนทะเบียน `wht_certificates/{id}` (ใช้ทำ ภ.ง.ด.3) และ reference บน
//      งานถอน `jobs/{id}/wht_certificate` ให้แอปไรเดอร์โหลดได้โดยไม่ต้องเพิ่ม
//      rule ใหม่ (ไรเดอร์อ่านงานของตัวเองได้อยู่แล้ว)
//   4. ส่งอีเมลแนบ PDF ให้ไรเดอร์
//
// ทำฝั่ง server ทั้งหมดเพราะเลขที่เอกสารต้องเดินต่อเนื่องแบบ atomic และ client
// เขียน `wht_certificates` ไม่ได้ (rule ปิด) — เอกสารภาษีที่ client สร้างเองได้
// แปลว่าใครก็ปลอมได้
//
// **ทำไมเป็น trigger ไม่ใช่เขียนตรงจากหน้าจอ:** การโอนเงินสำเร็จแล้วต้องออก
// เอกสารเสมอ แม้เบราว์เซอร์คนกดจะปิดไปก่อน — ผูกกับข้อมูลที่ลงแล้วจึงเชื่อถือ
// ได้กว่าผูกกับ session ของคนกด
// =============================================================================

const { onValueCreated } = require("firebase-functions/v2/database");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");
const { buildWhtCertificatePdf } = require("./voucher-pdf");
const { sendEmail, esc, shell, formatTHB, companyOf } = require("./email");

const REGION = "asia-southeast1";

/** ปี/เดือนเวลาไทย — งวดภาษีอิงเดือนตามปฏิทินไทย */
function bangkokYM(ms) {
  const d = new Date(ms + 7 * 3600 * 1000);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return { yyyy, mm, ym: `${yyyy}${mm}` };
}

/**
 * จองเลขหนังสือรับรอง — `WHT-YYYYMM-####` รีเซ็ตรายเดือนตามงวด ภ.ง.ด.3
 * ใช้ transaction เพื่อกันเลขซ้ำเมื่อมีการโอนพร้อมกันหลายรายการ
 */
async function allocateWhtNumber(db, ym) {
  const ref = db.ref(`settings/accounting/wht_seq_by_period/${ym}`);
  const txn = await ref.transaction((cur) => (cur || 0) + 1);
  const seq = txn.snapshot.val() || 1;
  return { number: `WHT-${ym}-${String(seq).padStart(4, "0")}`, seq };
}

async function archivePdf(storagePath, buffer) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const bucket = getStorage().bucket();
  await bucket.file(storagePath).save(buffer, {
    contentType: "application/pdf",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    storagePath,
  )}?alt=media&token=${token}`;
}

function buildRiderWhtEmail(rider, cert, company, to) {
  const co = companyOf({ _company: company });
  return {
    to,
    subject: `หนังสือรับรองการหักภาษี ณ ที่จ่าย ${cert.number}`,
    html: shell({
      heading: "หนังสือรับรองการหักภาษี ณ ที่จ่าย",
      intro:
        `${rider.name ? `คุณ${esc(rider.name)} ` : ""}${esc(co.legalName)} ได้จ่ายค่าตอบแทนให้คุณ ` +
        `และหักภาษี ณ ที่จ่ายนำส่งกรมสรรพากรตามกฎหมาย รายละเอียดตามเอกสารแนบ`,
      bodyHtml:
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f3;border-radius:10px;">
          <tr><td style="padding:16px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:4px 0;font-size:13px;color:#6b7280;">เลขที่หนังสือรับรอง</td>
                  <td style="padding:4px 0;font-size:13px;color:#111827;text-align:right;">${esc(cert.number)}</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#6b7280;">ยอดที่จ่าย</td>
                  <td style="padding:4px 0;font-size:13px;color:#111827;text-align:right;">${esc(formatTHB(cert.gross))}</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#6b7280;">หักภาษี ณ ที่จ่าย ${esc(cert.rate_percent)}%</td>
                  <td style="padding:4px 0;font-size:13px;color:#b91c1c;text-align:right;">−${esc(formatTHB(cert.wht))}</td></tr>
              <tr><td style="padding:8px 0 0;font-size:14px;color:#111827;font-weight:600;">ยอดที่โอนเข้าบัญชีคุณ</td>
                  <td style="padding:8px 0 0;font-size:16px;color:#059669;font-weight:700;text-align:right;">${esc(formatTHB(cert.net))}</td></tr>
            </table>
          </td></tr>
        </table>
        <p style="margin:16px 2px 0;font-size:12px;line-height:1.7;color:#6b7280;">
          เก็บเอกสารฉบับนี้ไว้ใช้เป็นเครดิตภาษีตอนยื่นภาษีเงินได้บุคคลธรรมดา
          และดาวน์โหลดซ้ำได้ในแอปไรเดอร์ที่รายการถอนเงินรายการนี้
        </p>`,
      footerNote: `${co.legalName} • เลขประจำตัวผู้เสียภาษี ${co.taxId}`,
    }),
  };
}

function registerRiderWhtIssue() {
  const onRiderWhtWithheld = onValueCreated(
    { ref: "/transactions/{txId}", region: REGION },
    async (event) => {
      try {
        const tx = event.data.val();
        if (!tx || tx.category !== "WITHDRAWAL") return;
        const wht = Number(tx.wht_amount) || 0;
        if (wht <= 0) return; // ไม่ได้หัก = ไม่ต้องออกเอกสาร

        const db = getDatabase();
        // ref_job_id ของ DEBIT ถอนเงิน = id ของแถวใน /withdrawals (ท่อถอนใหม่
        // เฟส 4 — แถวถอนไม่อยู่ใน /jobs อีกแล้ว) สำเนา cert จึงเก็บบนแถวนั้น
        // ให้ไรเดอร์เปิดดูได้ตาม read rule เจ้าของแถว
        const withdrawalId = tx.ref_job_id;
        if (!withdrawalId) {
          console.error("[riderWht] withdrawal transaction has no ref_job_id — cannot issue certificate");
          return;
        }

        // idempotent: ออกไปแล้วไม่ออกซ้ำ (retry ของ trigger เกิดได้)
        const existing = await db.ref(`withdrawals/${withdrawalId}/wht_certificate`).once("value");
        if (existing.exists()) return;

        const [riderSnap, acctSnap] = await Promise.all([
          db.ref(`riders/${tx.rider_id}`).once("value"),
          db.ref("settings/accounting").once("value"),
        ]);
        const riderRaw = riderSnap.val() || {};
        const acct = acctSnap.val() || {};
        const rider = {
          name: riderRaw.name || tx.rider_name || "",
          tax_id: (riderRaw.employment && riderRaw.employment.tax_id) || "",
          tax_address: (riderRaw.employment && riderRaw.employment.tax_address) || "",
          email: riderRaw.email || "",
        };

        const paidAt = Number(tx.timestamp) || Date.now();
        const { ym } = bangkokYM(paidAt);
        const { number } = await allocateWhtNumber(db, ym);

        // `gross` บนหนังสือรับรอง = **เงินได้ที่จ่าย** ซึ่งคือฐานภาษี (wht_base) ไม่ใช่
        // ยอดถอน — ยอดถอนมีเงินคืนค่าทดรองปนอยู่ซึ่งไม่ใช่เงินได้ (P4, 4 ก.ย. 2569)
        // แถวเก่าที่ไม่มี wht_base (ก่อน P4) = หักบนยอดเต็ม จึงใช้ amount ตามเดิม
        const withdrawal = Number(tx.amount) || 0;
        const base = tx.wht_base != null ? Number(tx.wht_base) : withdrawal;
        const cert = {
          number,
          period: ym,
          rider_id: tx.rider_id || null,
          rider_name: rider.name || null,
          rider_tax_id: rider.tax_id || null,
          gross: Number.isFinite(base) ? base : withdrawal,
          withdrawal_amount: withdrawal,
          exempt: Math.max(0, withdrawal - (Number.isFinite(base) ? base : withdrawal)),
          wht,
          net: Number(tx.net_paid) || withdrawal - wht,
          rate_percent: Number(tx.wht_rate_percent) || 3,
          paid_at: paidAt,
          // ชื่อฟิลด์เดิมคงไว้ (ทะเบียน wht_certificates มีคนอ่าน/รายงานแล้ว)
          // ค่าคือ id แถวใน /withdrawals ตามท่อถอนใหม่
          withdrawal_job_id: withdrawalId,
          status: "issued",
        };

        const certId = `WHT_${number.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        let url = null;
        let storagePath = null;
        try {
          const pdf = await buildWhtCertificatePdf({ rider, cert, company: acct.company });
          storagePath = `wht_certificates/${certId}.pdf`;
          url = await archivePdf(storagePath, pdf);

          // เอกสารพร้อมแล้วค่อยลงทะเบียน — ลงทะเบียนก่อนแล้วสร้างไม่ได้จะเหลือ
          // แถวที่ชี้ไปยังไฟล์ที่ไม่มีอยู่
          await db.ref(`wht_certificates/${certId}`).set({ ...cert, storage_path: storagePath, url });
          await db.ref(`withdrawals/${withdrawalId}/wht_certificate`).set({
            number, url, storage_path: storagePath, wht, net: cert.net,
            rate_percent: cert.rate_percent, issued_at: Date.now(),
          });

          if (rider.email) {
            try {
              const msg = buildRiderWhtEmail(rider, cert, acct.company, rider.email);
              msg.attachments = [{ filename: `${number}.pdf`, content: pdf.toString("base64") }];
              const res = await sendEmail(msg);
              console.log(`[riderWht] emailed ${number} to rider:`, JSON.stringify(res));
            } catch (e) {
              console.error(`[riderWht] email failed for ${number}:`, e?.message || e);
            }
          } else {
            console.warn(`[riderWht] rider ${tx.rider_id} has no email — ${number} available in-app only`);
          }
        } catch (e) {
          // เลขถูกจองไปแล้วแต่ไม่มีเอกสาร — ต้องอธิบายได้ตอนถูกตรวจ เช่นเดียว
          // กับใบกำกับภาษี ไม่ใช่ปล่อยให้เลขหายจากลำดับเงียบๆ
          console.error(`[riderWht] certificate build failed for ${number}:`, e?.message || e);
          await db.ref(`wht_certificates/${certId}`).set({
            ...cert,
            status: "void",
            void_reason: `สร้างเอกสารไม่สำเร็จ (${String((e && e.message) || e).slice(0, 120)}) — ต้องออกใหม่ด้วยมือ`,
          });
        }
      } catch (err) {
        console.error("[riderWht] onRiderWhtWithheld unhandled error:", err);
      }
    },
  );

  return { onRiderWhtWithheld };
}

module.exports = { registerRiderWhtIssue, allocateWhtNumber, bangkokYM, archivePdf };
