// หน้าตั้งค่าอีเมล (/email-settings, CEO+FINANCE) — เปิด/ปิดและแก้ข้อความ
// อีเมลรายสถานะในที่เดียว. ก่อนมีหน้านี้ ถ้อยคำทุกฉบับอยู่ในโค้ด (`STATUS_COPY`
// ใน functions/email.js) แก้ทีต้อง deploy ที
//
// สิ่งที่หน้านี้เป็นเจ้าของ = `settings/email_templates/{key}` เท่านั้น:
// สวิตช์แยกฝั่งลูกค้า/แอดมิน + override ข้อความ 3 ช่อง. **master switch ของ
// ทั้งระบบยังอยู่ที่ /accounting-settings** (`order_emails_enabled`) — หน้านี้
// แค่โชว์สถานะและลิงก์ไป ห้ามเขียนทับ (กันสองหน้าแก้ฟิลด์เดียวกัน)
//
// รายการเทมเพลต + ตัวอย่างมาจาก callable `adminEmailTemplateList` ไม่ได้
// hardcode ไว้ที่นี่ — เพิ่มสถานะใหม่ใน STATUS_COPY แล้วหน้านี้ขึ้นให้เอง
// (กันการมี mirror ตัวที่ 3 ตามบทเรียนใน CLAUDE.md)

import { useEffect, useMemo, useState } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Link } from 'react-router-dom';
import {
  Mail, ChevronDown, ChevronRight, Eye, RotateCcw, Save, AlertTriangle,
  CheckCircle2, Lock, Loader2, Info, X, FileText,
} from 'lucide-react';
import { db, app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

interface Preview {
  subject: string;
  heading: string;
  intro: string;
  html: string;
  editable: boolean;
}

interface Attachment {
  filename: string;
  label: string;
  base64: string;
}

interface TemplateItem {
  key: string;
  status?: string;
  label: string;
  note?: string;
  locked?: boolean;
  customer: Preview | null;
  admin: Preview | null;
  /** เอกสาร PDF ที่แนบไปกับอีเมลสถานะนี้ (ตอนนี้มีเฉพาะ Paid) */
  attachments?: Attachment[];
}

interface Manifest {
  items: TemplateItem[];
  placeholders: string[];
  provider: { resend_key: boolean; email_from: boolean; admin_inbox: boolean };
}

interface Override {
  customer_enabled?: boolean;
  admin_enabled?: boolean;
  subject?: string;
  heading?: string;
  intro?: string;
}

const TEMPLATES_PATH = 'settings/email_templates';

/**
 * เปิด PDF ตัวอย่างในแท็บใหม่
 *
 * ใช้ blob แทน data: URI เพราะ Chrome บล็อกการเปิด data: URI ที่ top level
 * (กันฟิชชิ่ง) — เอกสารตัวอย่างจึงจะไม่เปิดเลยถ้าใช้ data:
 */
function openPdf(a: Attachment) {
  const bin = atob(a.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  window.open(url, '_blank', 'noopener');
  // ปล่อย object URL คืนหลังแท็บใหม่อ่านไปแล้ว
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function EmailSettings() {
  const toast = useToast();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [masterOn, setMasterOn] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Override>({});
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<{ title: string; html: string } | null>(null);

  useEffect(() => {
    const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminEmailTemplateList');
    fn()
      .then((r) => setManifest(r.data as Manifest))
      .catch((e: unknown) => setLoadErr((e as { message?: string })?.message || 'โหลดรายการอีเมลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const offTpl = onValue(ref(db, TEMPLATES_PATH), (s) =>
      setOverrides((s.val() as Record<string, Override>) || {}),
    );
    // master switch เป็นของ /accounting-settings — อ่านอย่างเดียวเพื่อเตือน
    const offAcct = onValue(ref(db, 'settings/accounting/order_emails_enabled'), (s) =>
      setMasterOn(s.val() === true),
    );
    return () => { offTpl(); offAcct(); };
  }, []);

  const providerWarning = useMemo(() => {
    const p = manifest?.provider;
    if (!p) return '';
    const missing = [
      !p.resend_key && 'RESEND_API_KEY',
      !p.email_from && 'EMAIL_FROM',
      !p.admin_inbox && 'ORDER_NOTIFY_EMAIL (อีเมลแจ้งทีม)',
    ].filter(Boolean);
    return missing.length ? missing.join(', ') : '';
  }, [manifest]);

  const openEditor = (item: TemplateItem) => {
    if (expanded === item.key) { setExpanded(null); return; }
    setExpanded(item.key);
    setDraft({ ...(overrides[item.key] || {}) });
  };

  const saveDraft = async (key: string) => {
    setSaving(true);
    try {
      // เขียนเฉพาะฟิลด์ที่มีค่า — ช่องที่ลบข้อความออกให้เป็น null เพื่อกลับไป
      // ใช้ข้อความเริ่มต้นจากโค้ด (ไม่ใช่เก็บสตริงว่างซึ่งจะกลายเป็นหัวข้อว่าง)
      const payload: Record<string, unknown> = {};
      (['subject', 'heading', 'intro'] as const).forEach((f) => {
        const v = (draft[f] || '').trim();
        payload[f] = v ? v : null;
      });
      (['customer_enabled', 'admin_enabled'] as const).forEach((f) => {
        if (draft[f] !== undefined) payload[f] = draft[f];
      });
      await update(ref(db, `${TEMPLATES_PATH}/${key}`), payload);
      toast.success('บันทึกแล้ว');
      setExpanded(null);
    } catch (e) {
      toast.error((e as { message?: string })?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (key: string, field: 'customer_enabled' | 'admin_enabled', next: boolean) => {
    try {
      await update(ref(db, `${TEMPLATES_PATH}/${key}`), { [field]: next });
    } catch (e) {
      toast.error((e as { message?: string })?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  };

  const resetTemplate = async (key: string) => {
    try {
      await update(ref(db, `${TEMPLATES_PATH}/${key}`), { subject: null, heading: null, intro: null });
      setDraft((d) => ({ ...d, subject: '', heading: '', intro: '' }));
      toast.success('กลับไปใช้ข้อความเริ่มต้นแล้ว');
    } catch (e) {
      toast.error((e as { message?: string })?.message || 'รีเซ็ตไม่สำเร็จ');
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-slate-500 font-bold text-sm">
        <Loader2 size={18} className="animate-spin" /> กำลังโหลดรายการอีเมล...
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="p-6">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-700 font-bold">
          {loadErr}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <Mail size={20} className="text-indigo-600" /> ตั้งค่าอีเมล
        </h1>
        <p className="text-xs font-bold text-slate-500 mt-1">
          เปิด-ปิดและแก้ข้อความอีเมลของแต่ละสถานะ ทั้งฉบับที่ส่งให้ลูกค้าและฉบับแจ้งทีม
        </p>
      </div>

      {masterOn === false && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs font-bold text-amber-800">
            ระบบอีเมลปิดอยู่ทั้งระบบ — ตั้งค่าในหน้านี้จะยังไม่มีผลจนกว่าจะเปิดสวิตช์หลัก
            <Link to="/accounting-settings" className="underline ml-1">ที่หน้าตั้งค่าระบบบัญชี</Link>
          </div>
        </div>
      )}

      {providerWarning && (
        <div className="mb-4 bg-slate-100 border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
          <Info size={18} className="text-slate-500 shrink-0 mt-0.5" />
          <div className="text-xs font-bold text-slate-600">
            ยังไม่ได้ตั้งค่า: <span className="font-mono">{providerWarning}</span> — ต่อให้เปิดสวิตช์ก็ยังไม่มีอีเมลออก
            (ตั้งใน GitHub Secrets แล้ว deploy functions)
          </div>
        </div>
      )}

      <div className="bg-sky-50 border border-sky-100 rounded-2xl p-4 mb-5 text-xs font-bold text-sky-800">
        เว้นช่องข้อความไว้ = ใช้ข้อความเริ่มต้นของระบบ ซึ่งปรับตามบริบทให้เอง
        (เช่น พูดคนละแบบระหว่างนัดรับถึงที่ / ส่งพัสดุ / เข้าสาขา) กรอกเมื่อไหร่จึงทับด้วยข้อความของคุณ
        <div className="mt-2 font-normal">
          ตัวแปรที่ใช้ได้:{' '}
          {(manifest?.placeholders || []).map((p) => (
            <code key={p} className="bg-white border border-sky-200 rounded px-1 mx-0.5">{`{${p}}`}</code>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {(manifest?.items || []).map((item) => {
          const ov = overrides[item.key] || {};
          const custOn = ov.customer_enabled !== false;
          const admOn = ov.admin_enabled !== false;
          const edited = Boolean(ov.subject || ov.heading || ov.intro);
          const open = expanded === item.key;
          const canEdit = !item.locked && (item.customer?.editable || item.admin?.editable);

          return (
            <div key={item.key} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="p-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-800">{item.label}</span>
                    {item.status && (
                      <code className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 rounded px-1">
                        {item.status}
                      </code>
                    )}
                    {item.locked && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-300 rounded-full px-2 py-0.5">
                        <Lock size={10} /> เอกสารบัญชี แก้ข้อความไม่ได้
                      </span>
                    )}
                    {edited && (
                      <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                        แก้ข้อความแล้ว
                      </span>
                    )}
                  </div>
                  {item.note && <p className="text-[11px] font-bold text-slate-400 mt-1">{item.note}</p>}

                  <div className="flex items-center gap-4 mt-3 flex-wrap">
                    {item.customer && (
                      <Switch label="ส่งให้ลูกค้า" on={custOn} onChange={(v) => toggle(item.key, 'customer_enabled', v)} />
                    )}
                    {item.admin && (
                      <Switch label="แจ้งทีม" on={admOn} onChange={(v) => toggle(item.key, 'admin_enabled', v)} />
                    )}
                    {item.customer && (
                      <button
                        onClick={() => setPreviewHtml({ title: `${item.label} — ฉบับลูกค้า`, html: item.customer!.html })}
                        className="inline-flex items-center gap-1 text-[11px] font-black text-slate-500 hover:text-indigo-600"
                      >
                        <Eye size={13} /> ดูตัวอย่างฉบับลูกค้า
                      </button>
                    )}
                    {item.admin && (
                      <button
                        onClick={() => setPreviewHtml({ title: `${item.label} — ฉบับแจ้งทีม`, html: item.admin!.html })}
                        className="inline-flex items-center gap-1 text-[11px] font-black text-slate-500 hover:text-indigo-600"
                      >
                        <Eye size={13} /> ฉบับแจ้งทีม
                      </button>
                    )}
                  </div>

                  {/* เอกสารที่แนบไปกับอีเมล — ไม่ได้อยู่ในตัวอีเมล จึงต้องแยก
                      ให้เห็น ไม่งั้นดูเหมือนระบบไม่ได้ออกใบกำกับภาษีให้ */}
                  {item.attachments && item.attachments.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                        เอกสารแนบไปกับอีเมลนี้
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {item.attachments.map((a) => (
                          <button
                            key={a.filename}
                            onClick={() => openPdf(a)}
                            className="inline-flex items-start gap-1.5 text-left text-[11px] font-bold text-slate-600 hover:text-indigo-600"
                          >
                            <FileText size={13} className="shrink-0 mt-0.5" />
                            <span>
                              <span className="font-black">{a.filename}</span>
                              <span className="block font-bold text-slate-400">{a.label}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {canEdit && (
                  <button
                    onClick={() => openEditor(item)}
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-black text-slate-600 hover:text-indigo-600"
                  >
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} แก้ข้อความ
                  </button>
                )}
              </div>

              {open && canEdit && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-4 space-y-3">
                  <Field
                    label="หัวเรื่อง (Subject)"
                    placeholder={item.customer?.subject || item.admin?.subject || ''}
                    value={draft.subject || ''}
                    onChange={(v) => setDraft((d) => ({ ...d, subject: v }))}
                  />
                  <Field
                    label="หัวข้อในอีเมล"
                    placeholder={item.customer?.heading || item.admin?.heading || ''}
                    value={draft.heading || ''}
                    onChange={(v) => setDraft((d) => ({ ...d, heading: v }))}
                  />
                  <Field
                    label="ข้อความเปิด"
                    multiline
                    placeholder={stripTags(item.customer?.intro || item.admin?.intro || '')}
                    value={draft.intro || ''}
                    onChange={(v) => setDraft((d) => ({ ...d, intro: v }))}
                  />
                  <p className="text-[11px] font-bold text-slate-400">
                    ข้อความที่กรอกจะใช้กับทั้งฉบับลูกค้าและฉบับแจ้งทีมของสถานะนี้
                    ส่วนการ์ดสรุปยอดเงินและปุ่มติดตามระบบใส่ให้เองเสมอ
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => saveDraft(item.key)}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-xs font-black rounded-xl px-4 py-2 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
                    </button>
                    <button
                      onClick={() => resetTemplate(item.key)}
                      className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-rose-600 px-3 py-2"
                    >
                      <RotateCcw size={14} /> กลับไปใช้ข้อความเริ่มต้น
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {previewHtml && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewHtml(null)}>
          {/* ต้องกำหนดความสูงจริง (h-) ไม่ใช่ max-h- มิฉะนั้น flex-1 ของ iframe
              ไม่มีพื้นที่ให้กระจาย → iframe หดเหลือความสูง default 150px แล้วอีเมล
              ถูกตัดครึ่ง */}
          <div className="bg-white rounded-2xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-800 truncate">{previewHtml.title}</p>
                <p className="text-[11px] font-bold text-slate-400">ตัวอย่างจากงานสมมติ ไม่ใช่ข้อมูลลูกค้าจริง</p>
              </div>
              <button onClick={() => setPreviewHtml(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            {/* sandbox ไม่ให้รันสคริปต์/นำทาง — เนื้อหามาจาก server ของเราเองก็จริง
                แต่ preview ไม่มีเหตุผลต้องมีสิทธิ์อะไรเลย */}
            <iframe
              title="email-preview"
              sandbox=""
              srcDoc={previewHtml.html}
              className="flex-1 w-full bg-white"
            />
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-[11px] font-bold text-slate-400">
        <CheckCircle2 size={13} />
        สถานะที่ไม่มีในรายการนี้ = ระบบไม่ส่งอีเมลอยู่แล้ว (เฟสภายในอย่างคลังสินค้า/โลจิสติกส์)
      </div>
    </div>
  );
}

/** ตัด tag ออกเพื่อโชว์เป็น placeholder ในช่องกรอก — ข้อความเริ่มต้นบางตัวมี <strong> */
function stripTags(html: string) {
  return html.replace(/<[^>]*>/g, '');
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="inline-flex items-center gap-2">
      <span className={`w-8 h-5 rounded-full relative transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      <span className={`text-[11px] font-black ${on ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
    </button>
  );
}

function Field({
  label, value, onChange, placeholder, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; multiline?: boolean;
}) {
  const shared = 'w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400';
  return (
    <div>
      <label className="block text-[11px] font-black text-slate-500 mb-1">{label}</label>
      {multiline ? (
        <textarea rows={3} className={shared} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={shared} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
