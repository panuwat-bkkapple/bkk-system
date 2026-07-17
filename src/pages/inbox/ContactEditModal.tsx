import { useState } from 'react';
import { ref, update, get } from 'firebase/database';
import { db } from '../../api/firebase';
import { X, User } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

// ---------------------------------------------------------------------------
// ContactEditModal — แอดมินแก้ข้อมูลติดต่อ "ระดับบทสนทนา" (inbox/{convoId})
// ใช้สำหรับติดต่อกลับ / convert เป็น ticket เท่านั้น — ไม่แตะออเดอร์จริง
// (cust_address บนออเดอร์ผูกกับหมุดไรเดอร์ ต้องแก้ที่หน้ารายละเอียดงาน)
// ---------------------------------------------------------------------------

interface Props {
  convoId: string;
  initial: {
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    customer_address?: string;
  };
  onClose: () => void;
}

// Resolve an existing CRM contact id from phone/email via crm_contact_index.
// Read-only (admin) — never creates; new contacts are minted server-side by the
// order/chat triggers. Key derivation MUST mirror functions/crm.js.
async function resolveContactId(rawPhone: string, rawEmail: string): Promise<string | null> {
  const normPhone = (raw: string) => {
    let p = (raw || '').replace(/[\s\-().]/g, '');
    if (p.startsWith('+66')) p = '0' + p.slice(3);
    else if (p.startsWith('66') && p.length >= 11) p = '0' + p.slice(2);
    return p;
  };
  const p = normPhone(rawPhone);
  const pk = /^\d{6,}$/.test(p) ? p : '';
  const e = (rawEmail || '').trim().toLowerCase();
  const ek = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e.replace(/[.#$[\]/]/g, ',') : '';
  try {
    if (pk) {
      const s = await get(ref(db, `crm_contact_index/phone/${pk}`));
      if (s.exists()) return s.val() as string;
    }
    if (ek) {
      const s = await get(ref(db, `crm_contact_index/email/${ek}`));
      if (s.exists()) return s.val() as string;
    }
  } catch { /* index not readable / offline — leave unlinked */ }
  return null;
}

export default function ContactEditModal({ convoId, initial, onClose }: Props) {
  const toast = useToast();
  const [name, setName] = useState(initial.customer_name || '');
  const [phone, setPhone] = useState(initial.customer_phone || '');
  const [email, setEmail] = useState(initial.customer_email || '');
  const [address, setAddress] = useState(initial.customer_address || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        customer_name: name.trim() || null,
        customer_email: email.trim() || null,
        customer_address: address.trim() || null,
      };
      const cleanPhone = phone.replace(/[^\d+]/g, '').trim();
      // เบอร์ที่แอดมินกรอก = ผ่านการตรวจโดยเจ้าหน้าที่ (ต่างจาก 'chat' ที่ยังไม่ยืนยัน)
      if (cleanPhone) {
        updates.customer_phone = cleanPhone;
        updates.phone_source = 'admin';
      } else {
        updates.customer_phone = null;
      }
      // Re-link the CRM contact from the (possibly corrected) phone/email —
      // read-only lookup against crm_contact_index. Keys MUST match
      // functions/crm.js (phoneKey/emailKey). A wrong-contact entry is cleared;
      // if the new phone has no contact yet, the pointer clears and the panel
      // falls back to the account's own orders until the next order links one.
      updates.crm_customer_id = (await resolveContactId(phone, email)) as string | null;
      await update(ref(db, `inbox/${convoId}`), updates);
      toast.success('บันทึกข้อมูลติดต่อแล้ว');
      onClose();
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:w-[440px] sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <User size={18} className="text-blue-600" />
          <h3 className="font-black text-sm text-slate-800 flex-1">แก้ข้อมูลติดต่อลูกค้า</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="text-[11px] font-black text-slate-400 uppercase">ชื่อลูกค้า</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น คุณเกม"
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-black text-slate-400 uppercase">เบอร์โทรศัพท์</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="เช่น 0812345678"
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-black text-slate-400 uppercase">อีเมล</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              placeholder="เช่น name@email.com"
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-black text-slate-400 uppercase">ที่อยู่ (สำหรับติดต่อ)</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              placeholder="ที่อยู่ติดต่อกลับ"
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500 resize-none"
            />
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
              ที่อยู่นี้เป็นข้อมูลติดต่อของแชทเท่านั้น ไม่ใช่จุดรับเครื่องของไรเดอร์ —
              ถ้าจะตั้ง/แก้จุดรับเครื่องต้องทำที่หน้ารายละเอียดงาน (มีปักหมุด)
            </p>
          </div>
        </div>

        <div className="border-t border-slate-100 p-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-full bg-blue-600 text-white text-sm font-bold disabled:bg-slate-200 disabled:text-slate-400 hover:bg-blue-700 transition-colors"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
