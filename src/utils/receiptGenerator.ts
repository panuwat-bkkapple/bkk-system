// src/utils/receiptGenerator.ts
import { formatCurrency, formatDate } from './formatters';

export const printReceipt = (job: any) => {
  // 1. สร้างหน้าต่างใหม่สำหรับพิมพ์
  const printWindow = window.open('', '_blank');
  if (!printWindow) return alert("Please allow pop-ups for printing");

  // 2. ออกแบบหน้าตาใบเสร็จ (HTML + CSS)
  const htmlContent = `
    <html>
      <head>
        <title>Receipt - ${job.ref_no}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;700&display=swap');
          body { font-family: 'Sarabun', sans-serif; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
          .logo { font-size: 24px; font-weight: bold; color: #0071E3; margin-bottom: 5px; }
          .sub-header { font-size: 14px; color: #666; }
          
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
          .box { background: #f9f9f9; padding: 20px; border-radius: 8px; border: 1px solid #eee; }
          .label { font-size: 12px; color: #888; margin-bottom: 4px; uppercase; letter-spacing: 0.5px; }
          .value { font-size: 16px; font-weight: bold; }

          .table-container { margin-bottom: 40px; }
          table { width: 100%; border-collapse: collapse; }
          th { text-align: left; padding: 12px; background: #eee; font-size: 14px; }
          td { padding: 12px; border-bottom: 1px solid #eee; }
          .total-row td { border-top: 2px solid #333; font-size: 18px; font-weight: bold; padding-top: 20px; }

          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 80px; }
          .sign-box { text-align: center; }
          .line { border-bottom: 1px solid #ccc; height: 1px; width: 80%; margin: 0 auto 10px auto; }
          .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #aaa; }
          
          /* ซ่อนปุ่มเวลาสั่งปริ้น */
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">BKK Apple Trade-In</div>
          <div class="sub-header">ใบรับมอบเครื่อง / Trade-In Receipt</div>
          <div style="margin-top: 10px; font-size: 12px;">เลขที่เอกสาร: ${job.ref_no || '-'} | วันที่: ${formatDate(Date.now())}</div>
        </div>

        <div class="info-grid">
          <div class="box">
            <div class="label">ผู้ขาย (Customer)</div>
            <div class="value">${job.customer}</div>
            <div style="margin-top: 5px; font-size: 14px;">โทร: ${job.phone}</div>
          </div>
          <div class="box">
            <div class="label">ผู้รับเครื่อง (Receiver)</div>
            <div class="value">BKK System (Admin)</div>
            <div style="margin-top: 5px; font-size: 14px;">Method: ${job.method}</div>
          </div>
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>รายการ (Description)</th>
                <th style="text-align: right;">มูลค่า (Amount)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div style="font-weight: bold;">${job.model}</div>
                  <div style="font-size: 11px; color: #666; font-family: monospace;">IMEI/SN: ${job.imei || '-'}</div>
                  <div style="font-size: 12px; color: #666;">สภาพตามตกลง / Trade-In Device</div>
                </td>
                <td style="text-align: right;">${formatCurrency(job.price)}</td>
              </tr>
              <tr class="total-row">
                <td>ยอดสุทธิ (Total)</td>
                <td style="text-align: right; color: #0071E3;">${formatCurrency(job.price)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="signatures">
          <div class="sign-box">
            <div class="line"></div>
            <div>ลงชื่อผู้ขาย (Seller Signature)</div>
          </div>
          <div class="sign-box">
            <div class="line"></div>
            <div>ลงชื่อเจ้าหน้าที่ (Staff Signature)</div>
          </div>
        </div>

        <div class="footer">
          ขอบคุณที่ใช้บริการ BKK Apple Trade-In<br>
          เอกสารนี้ถูกสร้างโดยระบบอัตโนมัติ
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
    </html>
  `;

  // 3. เขียนข้อมูลลงหน้าต่างใหม่
  printWindow.document.write(htmlContent);
  printWindow.document.close();
};