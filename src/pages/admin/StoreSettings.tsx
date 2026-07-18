import { useState, useEffect } from 'react';
import { ref, get, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { Store, Save, Phone, Clock, Globe, MessageCircle, Mail } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

// =============================================================================
// ข้อมูลร้าน (ค่ากลาง) — settings/store_profile
//
// THE single standard for the store's public identity: central phone, LINE,
// email, standard opening hours, website. Consumers:
//   - chat AI (functions/chat-ai.js): answers "เบอร์ร้าน/เปิดกี่โมง" from this
//     block first, and the standard hours override the chat-widget hours in
//     every canned message (fixes the 08:00 vs 10:00 contradiction where the
//     widget setting and branch rows disagreed).
//   - get_branches tool: returns this as `central` alongside per-branch rows.
// Per-branch details (address/map/branch hours) stay in จัดการสาขา — this page
// is the ค่ามาตรฐาน those details hang off of.
// =============================================================================

interface StoreProfile {
  phone: string;
  line_id: string;
  email: string;
  hours_start: string;
  hours_end: string;
  website: string;
}

const DEFAULTS: StoreProfile = {
  phone: '',
  line_id: '',
  email: '',
  hours_start: '10:00',
  hours_end: '20:00',
  website: 'https://bkkapple.com',
};

export default function StoreSettings() {
  const toast = useToast();
  const [profile, setProfile] = useState<StoreProfile>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get(ref(db, 'settings/store_profile'))
      .then((snap) => {
        if (snap.exists()) {
          const v = snap.val() || {};
          setProfile({
            phone: v.phone || '',
            line_id: v.line_id || '',
            email: v.email || '',
            hours_start: v.hours_start || DEFAULTS.hours_start,
            hours_end: v.hours_end || DEFAULTS.hours_end,
            website: v.website || DEFAULTS.website,
          });
        }
      })
      .catch(() => toast.error('โหลดข้อมูลร้านไม่สำเร็จ'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await update(ref(db, 'settings/store_profile'), {
        phone: profile.phone.trim(),
        line_id: profile.line_id.trim(),
        email: profile.email.trim(),
        hours_start: profile.hours_start,
        hours_end: profile.hours_end,
        website: profile.website.trim(),
        updated_at: Date.now(),
      });
      toast.success('บันทึกค่ากลางของร้านแล้ว — AI ใช้ทันทีข้อความถัดไป');
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    icon: React.ReactNode,
    key: keyof StoreProfile,
    placeholder: string,
    hint?: string,
  ) => (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        {icon} {label}
      </label>
      <input
        type="text"
        value={profile[key]}
        onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
      />
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );

  if (loading) return <div className="p-10 text-center text-gray-400 font-bold animate-pulse">กำลังโหลด...</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-100 rounded-xl">
          <Store size={24} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800">ข้อมูลร้าน (ค่ากลาง)</h1>
          <p className="text-xs text-slate-400 font-bold">
            ค่ามาตรฐานหนึ่งเดียวของร้าน — AI แชท / ข้อความระบบ ยึดจากหน้านี้ก่อนเสมอ
            (รายละเอียดต่อสาขาแก้ที่ "จัดการสาขา" เหมือนเดิม)
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Phone size={16} className="text-blue-600" /> ช่องทางติดต่อกลาง
        </h2>
        {field('เบอร์โทรกลาง', <Phone size={12} />, 'phone', 'เช่น 083-495-6556', 'เบอร์เดียวที่ AI ให้ลูกค้าเมื่อขอ "เบอร์ติดต่อร้าน"')}
        {field('LINE ID', <MessageCircle size={12} />, 'line_id', 'เช่น @bkkapple')}
        {field('อีเมล', <Mail size={12} />, 'email', 'เช่น contact@bkkapple.com')}
        {field('เว็บไซต์', <Globe size={12} />, 'website', 'https://bkkapple.com')}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Clock size={16} className="text-amber-500" /> เวลาทำการมาตรฐาน
        </h2>
        <p className="text-xs text-slate-400 -mt-2">
          ใช้เป็นเวลาทำการหลักในทุกข้อความของ AI (รวมข้อความ "เจ้าหน้าที่จะติดต่อกลับในเวลาทำการ")
          — ตั้งที่นี่ที่เดียว เลิกขัดกับข้อมูลสาขา. สาขาที่เวลาไม่ตรงค่ามาตรฐาน (เช่น ภูเก็ต) ตั้งเวลาเฉพาะที่หน้าจัดการสาขาได้
        </p>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">เปิด</label>
            <input
              type="time"
              value={profile.hours_start}
              onChange={(e) => setProfile((p) => ({ ...p, hours_start: e.target.value }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">ปิด</label>
            <input
              type="time"
              value={profile.hours_end}
              onChange={(e) => setProfile((p) => ({ ...p, hours_end: e.target.value }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-md shadow-blue-200 flex items-center justify-center gap-2"
      >
        <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกค่ากลางของร้าน'}
      </button>
    </div>
  );
}
