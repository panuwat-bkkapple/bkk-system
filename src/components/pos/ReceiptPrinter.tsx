// src/components/pos/ReceiptPrinter.tsx
import React, { useEffect } from 'react';
import { Printer, X } from 'lucide-react';

interface ReceiptPrinterProps {
  data: any;
  onClose: () => void;
}

export const ReceiptPrinter = ({ data, onClose }: ReceiptPrinterProps) => {
  // สั่งเปิดหน้าต่าง Print ของ Browser อัตโนมัติเมื่อเปิด Component นี้
  useEffect(() => {
    // หน่วงเวลาเล็กน้อยให้ Render หน้าเว็บเสร็จก่อนสั่งปริ้นท์
    const timer = setTimeout(() => {
      window.print();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  if (!data) return null;

  return (
    <>
      {/* 🛑 สไตล์เฉพาะสำหรับการปริ้นท์ (ซ่อนทุกอย่างยกเว้นใบเสร็จ) */}
      <style>
        {`
          @media print {
            body * { visibility: hidden; }
            #receipt-printable-area, #receipt-printable-area * { visibility: visible; }
            #receipt-printable-area { 
              position: absolute; 
              left: 0; 
              top: 0; 
              width: 80mm; /* ขนาดกระดาษ Thermal 80mm */
              padding: 0; 
              margin: 0;
            }
            .no-print { display: none !important; }
          }
        `}
      </style>

      {/* 🖥️ UI สำหรับ Preview บนหน้าจอ */}
      <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm no-print">
        
        {/* ปุ่ม Action ด้านบน */}
        <div className="absolute top-6 right-6 flex gap-4">
           <button onClick={() => window.print()} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black uppercase flex items-center gap-2 hover:bg-blue-500 shadow-lg">
              <Printer size={20}/> พิมพ์ใบเสร็จ (Print)
           </button>
           <button onClick={onClose} className="bg-white/10 text-white p-3 rounded-2xl hover:bg-white/20 transition-colors">
              <X size={24}/>
           </button>
        </div>

        {/* 🖨️ พื้นที่ใบเสร็จของจริง (กว้าง 80mm ประมาณ 302px) */}
        <div id="receipt-printable-area" className="bg-white text-black p-4 w-[80mm] min-h-[100mm] font-sans text-xs mx-auto shadow-2xl">
          
          {/* Header ร้าน */}
          <div className="text-center mb-4">
             <h2 className="text-xl font-black uppercase tracking-widest mb-1">BKK APPLE PRO</h2>
             <p className="text-[10px]">ศูนย์จำหน่ายและรับซื้อสินค้า Apple</p>
             <p className="text-[10px]">โทร: 08X-XXX-XXXX</p>
             <p className="text-[10px]">Tax ID: 0123456789012</p>
          </div>

          <div className="border-t-2 border-dashed border-black/30 my-3"></div>

          {/* ข้อมูลบิล */}
          <div className="mb-3 text-[10px]">
             <div className="flex justify-between mb-1">
                <span>Receipt No:</span>
                <span className="font-bold">{data.receipt_no}</span>
             </div>
             <div className="flex justify-between mb-1">
                <span>Date:</span>
                <span>{new Date(data.sold_at).toLocaleString('th-TH')}</span>
             </div>
             <div className="flex justify-between mb-1">
                <span>Cashier:</span>
                <span>{data.cashier || 'Admin'}</span>
             </div>
             <div className="flex justify-between">
                <span>Customer:</span>
                <span className="font-bold">{data.customer_name || 'ลูกค้าทั่วไป'}</span>
             </div>
             {data.customer_phone && (
                <div className="flex justify-between text-[9px]">
                   <span>Tel:</span>
                   <span>{data.customer_phone}</span>
                </div>
             )}
          </div>

          <div className="border-t-2 border-dashed border-black/30 my-3"></div>

          {/* รายการสินค้า */}
          <table className="w-full text-left mb-3">
             <thead>
                <tr className="text-[10px] border-b border-black/20">
                   <th className="pb-1 w-8">Qty</th>
                   <th className="pb-1">Item</th>
                   <th className="pb-1 text-right">Total</th>
                </tr>
             </thead>
             <tbody className="text-[10px]">
                {data.items?.map((item: any, idx: number) => (
                   <React.Fragment key={idx}>
                      <tr>
                         <td className="py-1.5 align-top">{item.qty}x</td>
                         <td className="py-1.5 font-bold">{item.name}</td>
                         <td className="py-1.5 text-right font-bold">{(item.price * item.qty).toLocaleString()}</td>
                      </tr>
                      {/* โชว์ IMEI/SN ใต้ชื่อสินค้าถ้ามี */}
                      {(item.imei || item.code) && (
                         <tr>
                            <td></td>
                            <td colSpan={2} className="pb-1 text-[9px] text-gray-500 font-mono">
                               S/N: {item.imei || item.code}
                            </td>
                         </tr>
                      )}
                   </React.Fragment>
                ))}
             </tbody>
          </table>

          <div className="border-t-2 border-dashed border-black/30 my-3"></div>

          {/* สรุปยอด */}
          <div className="text-[10px] space-y-1 mb-4">
             <div className="flex justify-between font-bold text-sm mt-2">
                <span>GRAND TOTAL:</span>
                <span>฿{(data.grand_total || 0).toLocaleString()}</span>
             </div>
             <div className="flex justify-between">
                <span>Payment Method:</span>
                <span>{data.payment_method || 'CASH'}</span>
             </div>
          </div>

          <div className="border-t-2 border-dashed border-black/30 my-3"></div>

          {/* เงื่อนไขรับประกัน (Warranty Terms) */}
          <div className="text-center text-[9px] space-y-1 text-gray-800">
             <p className="font-bold text-[10px]">*** เงื่อนไขการรับประกัน ***</p>
             <p>1. สินค้ามือสองรับประกันร้าน 30 วัน</p>
             <p>2. สินค้าใหม่รับประกันศูนย์ตามกำหนด</p>
             <p>3. ไม่รับประกันกรณีตกน้ำ, จอแตก, หรือมีรอยกระแทก</p>
             <p>4. กรุณาเก็บใบเสร็จนี้ไว้เป็นหลักฐาน</p>
             <br/>
             <p className="font-bold mt-2">THANK YOU FOR YOUR BUSINESS</p>
             <p>Powered by BKK System</p>
          </div>

          {/* เว้นพื้นที่ว่างด้านล่างเผื่อเครื่องปริ้นท์ตัดกระดาษ */}
          <div className="h-8"></div>

        </div>
      </div>
    </>
  );
};