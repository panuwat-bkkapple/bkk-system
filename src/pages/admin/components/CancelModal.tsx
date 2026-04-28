import React, { useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import type { CancelCategory } from '../../../types/job-statuses';

/**
 * Cancel options shown in the admin's CancelModal. Same shape as the
 * rider's RIDER_REJECT_OPTIONS — each entry maps a Thai label to a
 * canonical CancelCategory so cancellations are filterable for analytics.
 * `requireDetail` makes the free-text textarea mandatory when the category
 * is too broad to stand alone.
 */
const ADMIN_CANCEL_OPTIONS: Array<{
  label: string;
  category: CancelCategory;
  requireDetail?: boolean;
}> = [
  { label: 'ติดต่อลูกค้าไม่ได้ / ไม่มาตามนัด', category: 'customer_no_show' },
  { label: 'ลูกค้าเปลี่ยนใจยกเลิกเอง', category: 'customer_changed_mind' },
  { label: 'ตกลงราคาใหม่ไม่ได้ (ปฏิเสธราคา)', category: 'price_disagreement' },
  { label: 'สภาพเครื่องไม่อยู่ในเกณฑ์ / ติดล็อค iCloud', category: 'hidden_damage', requireDetail: true },
  { label: 'เครื่องไม่ตรงใบสั่ง', category: 'device_mismatch', requireDetail: true },
  { label: 'สงสัยฉ้อโกง', category: 'fraud_suspected', requireDetail: true },
  { label: 'อื่น ๆ', category: 'other', requireDetail: true },
];

interface CancelModalProps {
  isOpen: boolean;
  onClose: () => void;
  // (category, detail) — the modal enforces detail when requireDetail is set
  // before invoking this callback.
  onConfirm: (category: CancelCategory, detail: string) => void;
}

export const CancelModal: React.FC<CancelModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [detail, setDetail] = useState('');

  if (!isOpen) return null;

  const selectedOption = selectedIdx !== null ? ADMIN_CANCEL_OPTIONS[selectedIdx] : null;
  const detailRequired = !!selectedOption?.requireDetail;
  const detailMissing = detailRequired && !detail.trim();
  const canSubmit = !!selectedOption && !detailMissing;

  const handleClose = () => {
    setSelectedIdx(null);
    setDetail('');
    onClose();
  };

  const handleConfirm = () => {
    if (!selectedOption || detailMissing) return;
    onConfirm(selectedOption.category, detail.trim());
    setSelectedIdx(null);
    setDetail('');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100000] flex items-center justify-center animate-in fade-in">
      <div className="bg-white p-8 rounded-[2rem] shadow-2xl w-[440px] animate-in zoom-in-95">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-base font-black text-slate-800 uppercase flex items-center gap-2">
            <AlertOctagon className="text-red-500" /> ระบุเหตุผลการยกเลิก
          </h3>
        </div>

        <div className="space-y-2 mb-5 max-h-72 overflow-y-auto pr-1">
          {ADMIN_CANCEL_OPTIONS.map((option, idx) => (
            <button
              key={`${option.category}-${idx}`}
              onClick={() => setSelectedIdx(idx)}
              className={`w-full text-left p-3.5 rounded-xl text-xs font-bold transition-all border ${
                selectedIdx === idx
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : 'bg-slate-50 border-slate-200 hover:border-red-400 hover:bg-red-50 text-slate-700'
              }`}
            >
              {option.label}
              {option.requireDetail && (
                <span className="ml-2 text-[9px] font-black text-red-500 uppercase tracking-wider">ต้องระบุเพิ่ม</span>
              )}
            </button>
          ))}
        </div>

        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">
          รายละเอียดเพิ่มเติม{detailRequired ? <span className="text-red-500"> *</span> : <span className="text-slate-400 normal-case font-bold"> (ถ้ามี)</span>}
        </label>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={detailRequired ? 'ระบุปัญหาที่พบ — จำเป็นสำหรับหมวดนี้' : 'อธิบายเพิ่มเติมถ้ามี'}
          className={`w-full p-3 border rounded-xl text-xs mb-6 focus:outline-none focus:ring-2 transition-all ${
            detailMissing
              ? 'border-red-300 focus:ring-red-300 bg-red-50/50'
              : 'border-slate-200 focus:ring-slate-300'
          }`}
        />

        <div className="flex gap-2">
          <button
            onClick={handleClose}
            className="flex-1 py-3 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-xl text-xs font-black uppercase tracking-widest"
          >
            ปิดหน้าต่าง
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
          >
            ยืนยันยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
};
