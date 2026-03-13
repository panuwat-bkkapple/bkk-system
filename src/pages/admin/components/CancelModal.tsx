import React from 'react';
import { AlertOctagon } from 'lucide-react';

interface CancelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export const CancelModal: React.FC<CancelModalProps> = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100000] flex items-center justify-center animate-in fade-in">
      <div className="bg-white p-8 rounded-[2rem] shadow-2xl w-[400px] animate-in zoom-in-95">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-base font-black text-slate-800 uppercase flex items-center gap-2"><AlertOctagon className="text-red-500" /> ระบุเหตุผลการยกเลิก</h3>
        </div>
        <div className="space-y-3 mb-6">
          {[
            'ติดต่อลูกค้าไม่ได้ / ไม่มาตามนัด',
            'ลูกค้าเปลี่ยนใจยกเลิกเอง',
            'ตกลงราคาใหม่ไม่ได้ (ปฏิเสธราคา)',
            'สภาพเครื่องไม่อยู่ในเกณฑ์ / ติดล็อค iCloud'
          ].map(reason => (
            <button key={reason} onClick={() => onConfirm(reason)} className="w-full text-left p-4 bg-slate-50 border border-slate-200 hover:border-red-400 hover:bg-red-50 rounded-xl text-xs font-bold text-slate-700 transition-all">
              {reason}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="w-full py-3 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
          ปิดหน้าต่าง (กลับไปทำงานต่อ)
        </button>
      </div>
    </div>
  );
};
