import React from 'react';
import { FileCheck2, FileText, Landmark, Calendar } from 'lucide-react';

interface DocumentVaultProps {
  poNumber: string;
  invoiceNumber: string;
  taxInvoiceNumber: string;
  paymentDueDate: string;
  onPoNumberChange: (val: string) => void;
  onInvoiceNumberChange: (val: string) => void;
  onTaxInvoiceNumberChange: (val: string) => void;
  onPaymentDueDateChange: (val: string) => void;
  onSaveDate: (field: string, val: string) => void;
  isCancelled: boolean;
}

export const DocumentVault = ({
  poNumber, invoiceNumber, taxInvoiceNumber, paymentDueDate,
  onPoNumberChange, onInvoiceNumberChange, onTaxInvoiceNumberChange,
  onPaymentDueDateChange, onSaveDate, isCancelled
}: DocumentVaultProps) => {
  return (
    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
      <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-4">
        <FileCheck2 className="text-indigo-500" size={20}/> 5. Document Vault (คลังเอกสาร)
      </h3>

      {/* DUE DATE: Payment Due Date */}
      <div className="flex items-center gap-3 mb-2 bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm w-fit">
         <Calendar size={18} className="text-slate-500"/>
         <label className="text-xs font-black text-slate-700 uppercase tracking-widest">Payment Due Date (กำหนดชำระเงิน):</label>
         <input type="date" value={paymentDueDate} disabled={isCancelled}
           onChange={e => { onPaymentDueDateChange(e.target.value); onSaveDate('payment_due_date', e.target.value); }}
           className="bg-white border border-slate-200 text-slate-900 font-bold px-3 py-1.5 rounded-lg outline-none focus:border-slate-500"
         />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className={`p-6 rounded-2xl border flex flex-col gap-4 ${poNumber ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${poNumber ? 'bg-indigo-100 text-indigo-600' : 'bg-white shadow-sm text-slate-400'}`}><FileText size={20} /></div>
            <div className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Our P.O. Number <span className="text-red-500">*</span></div>
          </div>
          <input type="text" placeholder="ระบุเลขที่ใบสั่งซื้อ (Purchase Order)" value={poNumber} onChange={e => onPoNumberChange(e.target.value)} disabled={isCancelled} className="w-full p-4 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 outline-none font-black text-sm shadow-sm" />
        </div>

        <div className={`p-6 rounded-2xl border flex flex-col gap-4 ${invoiceNumber && taxInvoiceNumber ? 'bg-emerald-50/50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-3">
             <div className={`p-2.5 rounded-xl ${invoiceNumber && taxInvoiceNumber ? 'bg-emerald-100 text-emerald-600' : 'bg-white shadow-sm text-slate-400'}`}><Landmark size={20} /></div>
             <div className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Client Billing Docs <span className="text-red-500">*</span></div>
          </div>
          <div className="flex gap-3">
            <input type="text" placeholder="Invoice No." value={invoiceNumber} onChange={e => onInvoiceNumberChange(e.target.value)} disabled={isCancelled} className="w-full p-4 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none font-black text-xs shadow-sm" />
            <input type="text" placeholder="Tax Inv. No." value={taxInvoiceNumber} onChange={e => onTaxInvoiceNumberChange(e.target.value)} disabled={isCancelled} className="w-full p-4 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none font-black text-xs shadow-sm" />
          </div>
        </div>
      </div>
    </div>
  );
};
