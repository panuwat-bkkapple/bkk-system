import { useState, useEffect } from 'react';
import { ref, get, update } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../../api/firebase';
import { Bot, Save, MessageCircle, Clock, BookOpen, Gauge, Database } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

// =============================================================================
// Chat Widget settings — settings/chat_widget
//
//   public/   world-readable (rules: settings/chat_widget/public .read true)
//             — everything the customer-facing widget needs before auth:
//             enabled (master gate), assistant_name, welcome/offline copy,
//             business hours
//   kb        knowledge text injected into the AI system prompt
//   daily_call_cap, model
//             read only by the chatWidgetAiReply cloud function
//
// The master gate mirrors settings/accounting.order_emails_enabled: while
// enabled !== true the widget is hidden on the website AND the cloud
// function is fully inert, so this can be configured safely before launch.
// =============================================================================

interface ChatWidgetConfig {
  enabled: boolean;
  preview_enabled: boolean;
  assistant_name: string;
  welcome_message: string;
  offline_message: string;
  hours_start: string;
  hours_end: string;
  kb: string;
  daily_call_cap: number;
  model: string;
}

// Mirrors functions/chat-ai.js: empty model = hybrid routing (pickModel) —
// STRONG_MODEL (claude-sonnet-5) for every substantive question, DEFAULT_MODEL
// (claude-haiku-4-5) only for trivial greetings. A non-empty value here is an
// admin override applied to EVERY message. Keep the ids in sync with chat-ai.js.
const AI_MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  {
    value: '',
    label: 'อัตโนมัติ (แนะนำ) — Sonnet 5 + Haiku 4.5',
    hint: 'ระบบเลือกให้: คำถามจริงใช้ Sonnet 5 (แม่นยำ), ทักทายสั้นๆ ใช้ Haiku 4.5 (ประหยัด) และมี Sonnet 5 ตรวจทานคำตอบก่อนส่ง',
  },
  {
    value: 'claude-sonnet-5',
    label: 'Sonnet 5 ทุกข้อความ',
    hint: 'บังคับใช้ Sonnet 5 กับทุกข้อความ — แม่นยำสุด ค่าใช้จ่ายสูงกว่าอัตโนมัติเล็กน้อย',
  },
  {
    value: 'claude-haiku-4-5',
    label: 'Haiku 4.5 ทุกข้อความ',
    hint: 'บังคับใช้ Haiku 4.5 กับทุกข้อความ — ประหยัดสุด แต่ความแม่นยำต่ำกว่า ไม่แนะนำสำหรับการประเมินราคา',
  },
];

// Shape returned by the getChatAiKnowledge callable (functions/chat-ai.js) —
// the SAME constants the deployed system prompt is built from, fetched live so
// this page can never drift from what the AI actually knows.
interface BuiltinKnowledge {
  live_sources: string[];
  service_info: string[];
  official_faq: string[];
  deduction_policy: string[];
  faq: { c: string; q: string; a: string }[];
  models: { auto_strong: string; auto_trivial: string; verifier: string };
}
const DEFAULTS: ChatWidgetConfig = {
  enabled: false,
  preview_enabled: false,
  assistant_name: 'BKK APPLE Assistant',
  welcome_message: '',
  offline_message: '',
  hours_start: '10:00',
  hours_end: '19:00',
  kb: '',
  daily_call_cap: 1500,
  model: '',
};

export default function ChatWidgetSettings() {
  const toast = useToast();
  const [config, setConfig] = useState<ChatWidgetConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [builtin, setBuiltin] = useState<BuiltinKnowledge | null>(null);
  const [builtinError, setBuiltinError] = useState('');

  useEffect(() => {
    get(ref(db, 'settings/chat_widget'))
      .then((snap) => {
        if (snap.exists()) {
          const val = snap.val();
          const pub = val.public || {};
          setConfig({
            enabled: pub.enabled === true,
            preview_enabled: pub.preview_enabled === true,
            assistant_name: pub.assistant_name || DEFAULTS.assistant_name,
            welcome_message: pub.welcome_message || '',
            offline_message: pub.offline_message || '',
            hours_start: pub.hours_start || DEFAULTS.hours_start,
            hours_end: pub.hours_end || DEFAULTS.hours_end,
            kb: val.kb || '',
            daily_call_cap: Number(val.daily_call_cap) || DEFAULTS.daily_call_cap,
            model: val.model || '',
          });
        }
      })
      .catch(() => toast.error('โหลดการตั้งค่าไม่สำเร็จ'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Built-in knowledge audit — fetched from the deployed function so the page
  // always shows exactly what the live AI knows (not a copy that can drift).
  useEffect(() => {
    const fn = httpsCallable<Record<string, never>, BuiltinKnowledge>(
      getFunctions(app, 'asia-southeast1'),
      'getChatAiKnowledge',
    );
    fn({})
      .then((res) => setBuiltin(res.data))
      .catch(() => setBuiltinError('โหลดความรู้ในตัวระบบไม่สำเร็จ (function อาจยังไม่ deploy)'));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await update(ref(db, 'settings/chat_widget'), {
        public: {
          enabled: config.enabled,
          preview_enabled: config.preview_enabled,
          assistant_name: config.assistant_name.trim() || DEFAULTS.assistant_name,
          welcome_message: config.welcome_message.trim(),
          offline_message: config.offline_message.trim(),
          hours_start: config.hours_start,
          hours_end: config.hours_end,
        },
        kb: config.kb,
        daily_call_cap: Number(config.daily_call_cap) || DEFAULTS.daily_call_cap,
        model: config.model.trim() || null,
      });
      toast.success('บันทึกการตั้งค่าแล้ว');
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400 font-bold animate-pulse">กำลังโหลด...</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-violet-100 rounded-xl">
          <Bot size={24} className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800">ตั้งค่า Chat Widget (AI)</h1>
          <p className="text-xs text-slate-400 font-bold">
            แชทหน้าเว็บลูกค้า — AI ตอบก่อน ส่งต่อเจ้าหน้าที่เมื่อจำเป็น (จัดการแชทที่เมนู Inbox)
          </p>
        </div>
      </div>

      {/* Master gate */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between">
        <div>
          <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
            <MessageCircle size={16} className="text-blue-600" /> เปิดใช้งานแชทหน้าเว็บ
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            ปิดอยู่ = ลูกค้าไม่เห็นปุ่มแชทบนเว็บ และระบบ AI ไม่ทำงานทั้งหมด (ตั้งค่าอื่นล่วงหน้าได้อย่างปลอดภัย)
          </p>
        </div>
        <button
          onClick={() => setConfig((c) => ({ ...c, enabled: !c.enabled }))}
          className={`w-14 h-8 rounded-full transition-colors relative shrink-0 ${config.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
          aria-label="เปิด/ปิดแชท"
        >
          <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${config.enabled ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Preview / test mode */}
      <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 flex items-center justify-between">
        <div>
          <h2 className="font-black text-sm text-slate-800">โหมดทดสอบ (Preview)</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-md">
            เปิดแล้วลูกค้าทั่วไปยังไม่เห็นแชท — เห็นเฉพาะคนที่เปิดเว็บด้วยลิงก์{' '}
            <code className="bg-white px-1.5 py-0.5 rounded border border-amber-200 text-[11px]">bkkapple.com/?chat_preview=1</code>{' '}
            (AI ตอบจริง แจ้งเตือนเข้า Inbox จริง) ใช้ทดสอบก่อนเปิดใช้งานจริง แล้วปิดเมื่อทดสอบเสร็จ
          </p>
        </div>
        <button
          onClick={() => setConfig((c) => ({ ...c, preview_enabled: !c.preview_enabled }))}
          className={`w-14 h-8 rounded-full transition-colors relative shrink-0 ${config.preview_enabled ? 'bg-amber-500' : 'bg-slate-300'}`}
          aria-label="เปิด/ปิดโหมดทดสอบ"
        >
          <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${config.preview_enabled ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Persona + copy */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Bot size={16} className="text-violet-600" /> ผู้ช่วย AI
        </h2>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">ชื่อผู้ช่วย</label>
          <input
            type="text"
            value={config.assistant_name}
            onChange={(e) => setConfig((c) => ({ ...c, assistant_name: e.target.value }))}
            className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
            ข้อความต้อนรับ (เว้นว่าง = ใช้ข้อความมาตรฐาน)
          </label>
          <textarea
            value={config.welcome_message}
            onChange={(e) => setConfig((c) => ({ ...c, welcome_message: e.target.value }))}
            rows={2}
            className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>
      </div>

      {/* Business hours */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Clock size={16} className="text-amber-500" /> เวลาทำการของเจ้าหน้าที่ (AI ตอบ 24 ชม.)
        </h2>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">เริ่ม</label>
            <input
              type="time"
              value={config.hours_start}
              onChange={(e) => setConfig((c) => ({ ...c, hours_start: e.target.value }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">สิ้นสุด</label>
            <input
              type="time"
              value={config.hours_end}
              onChange={(e) => setConfig((c) => ({ ...c, hours_end: e.target.value }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
            ข้อความนอกเวลาทำการ (เว้นว่าง = ใช้ข้อความมาตรฐาน)
          </label>
          <textarea
            value={config.offline_message}
            onChange={(e) => setConfig((c) => ({ ...c, offline_message: e.target.value }))}
            rows={2}
            className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>
      </div>

      {/* Knowledge base */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <BookOpen size={16} className="text-emerald-600" /> ความรู้ประกอบคำตอบ (Knowledge)
        </h2>
        <p className="text-xs text-slate-400">
          ระบบมีความรู้ในตัวอยู่แล้ว (ดูกล่อง "ความรู้ในตัวระบบ" ด้านล่าง) — ช่องนี้มีไว้เติม
          "ส่วนที่ยังขาด" เท่านั้น เช่น โปรโมชั่นชั่วคราว ประกาศเฉพาะกิจ หรือนโยบายที่เพิ่งเปลี่ยน
          (สูงสุด 8,000 ตัวอักษร) สิ่งที่พิมพ์ที่นี่จะ "ทับ" FAQ ในตัวระบบเมื่อขัดกัน
          และถูกส่งให้ AI ทุกข้อความ — ว่างไว้ได้ถ้าไม่มีอะไรพิเศษ อย่าก๊อป FAQ หรือราคามาใส่ซ้ำ
        </p>
        <textarea
          value={config.kb}
          onChange={(e) => setConfig((c) => ({ ...c, kb: e.target.value }))}
          rows={10}
          maxLength={8000}
          placeholder={'ตัวอย่าง:\n- รับซื้ออุปกรณ์ Apple ทุกประเภท iPhone 7 ขึ้นไป\n- Rider รับถึงบ้านฟรีในกรุงเทพฯ และปริมณฑล ต่างจังหวัดส่งพัสดุ (ออกค่าส่งให้)\n- โอนเงินทันทีหลังตรวจสภาพเสร็จ ภายใน 5 นาที'}
          className="w-full px-4 py-3 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono"
        />
        <p className="text-[10px] text-slate-400 text-right">{config.kb.length.toLocaleString()} / 8,000</p>
      </div>

      {/* Built-in knowledge audit — read-only, fetched live from the deployed function */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Database size={16} className="text-emerald-600" /> ความรู้ในตัวระบบ (อ่านอย่างเดียว)
        </h2>
        <p className="text-xs text-slate-400">
          ดึงสดจากระบบ AI ที่ deploy อยู่จริง — ใช้ตรวจสอบว่า AI รู้อะไรแล้วบ้าง อะไรที่ยังขาดค่อยเติมในช่อง
          Knowledge ด้านบน (แก้เนื้อหาในนี้ = งานฝั่งพัฒนา เพราะบางส่วน mirror มาจาก FAQ หน้าเว็บ)
        </p>
        {builtinError && <p className="text-xs text-red-500">{builtinError}</p>}
        {!builtin && !builtinError && (
          <p className="text-xs text-slate-400 animate-pulse">กำลังโหลด...</p>
        )}
        {builtin && (
          <div className="space-y-2">
            <details className="group border border-slate-100 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100">
                ข้อมูลสดจากฐานข้อมูล (ดึงตอนตอบทุกครั้ง) — {builtin.live_sources.length} แหล่ง
              </summary>
              <ul className="px-4 py-3 space-y-1.5">
                {builtin.live_sources.map((s, i) => (
                  <li key={i} className="text-xs text-slate-600 leading-relaxed">• {s}</li>
                ))}
              </ul>
            </details>
            <details className="group border border-slate-100 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100">
                ข้อมูลบริการ (ฝังใน prompt) — {builtin.service_info.length} ข้อ
              </summary>
              <ul className="px-4 py-3 space-y-1.5">
                {builtin.service_info.map((s, i) => (
                  <li key={i} className="text-xs text-slate-600 leading-relaxed">{s}</li>
                ))}
              </ul>
            </details>
            <details className="group border border-slate-100 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100">
                FAQ ทางการที่ฝังใน prompt (AI ต้องตอบตามนี้) — {builtin.official_faq.length} ข้อ
              </summary>
              <ul className="px-4 py-3 space-y-1.5">
                {builtin.official_faq.map((s, i) => (
                  <li key={i} className="text-xs text-slate-600 leading-relaxed">{s}</li>
                ))}
              </ul>
            </details>
            <details className="group border border-slate-100 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100">
                FAQ ฉบับเต็ม (AI ค้นผ่าน get_faq แล้วสรุปตอบ) — {builtin.faq.length} ข้อ
              </summary>
              <div className="px-4 py-3 space-y-3">
                {[...new Set(builtin.faq.map((f) => f.c))].map((cat) => (
                  <div key={cat}>
                    <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1">{cat}</p>
                    <ul className="space-y-1.5">
                      {builtin.faq.filter((f) => f.c === cat).map((f, i) => (
                        <li key={i} className="text-xs leading-relaxed">
                          <span className="font-bold text-slate-700">{f.q}</span>
                          <span className="text-slate-500"> — {f.a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
            <details className="group border border-slate-100 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100">
                นโยบายการหักราคา + โมเดลที่ใช้จริง
              </summary>
              <div className="px-4 py-3 space-y-1.5">
                {builtin.deduction_policy.map((s, i) => (
                  <p key={i} className="text-xs text-slate-600 leading-relaxed">{s}</p>
                ))}
                <p className="text-xs text-slate-600 leading-relaxed pt-1">
                  • โหมดอัตโนมัติ: คำถามจริง = <span className="font-mono">{builtin.models.auto_strong}</span>,
                  ทักทายสั้นๆ = <span className="font-mono">{builtin.models.auto_trivial}</span>,
                  ตัวตรวจทานคำตอบ = <span className="font-mono">{builtin.models.verifier}</span>
                </p>
              </div>
            </details>
          </div>
        )}
      </div>

      {/* Limits */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Gauge size={16} className="text-red-500" /> ขีดจำกัดการใช้งาน AI
        </h2>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
              เพดานจำนวนครั้งเรียก AI ต่อวัน
            </label>
            <input
              type="number"
              min={0}
              value={config.daily_call_cap}
              onChange={(e) => setConfig((c) => ({ ...c, daily_call_cap: Number(e.target.value) }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] text-slate-400 mt-1">เกินเพดาน = AI หยุดตอบชั่วคราว แจ้งเตือนแอดมินให้ตอบเองแทน</p>
          </div>
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
              โมเดล AI
            </label>
            <select
              value={config.model}
              onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AI_MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {config.model && !AI_MODEL_OPTIONS.some((o) => o.value === config.model) && (
                <option value={config.model}>{config.model} (กำหนดเอง)</option>
              )}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              {AI_MODEL_OPTIONS.find((o) => o.value === config.model)?.hint ||
                'ค่าที่กำหนดเองจะถูกใช้กับทุกข้อความ'}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-md shadow-blue-200 flex items-center justify-center gap-2"
      >
        <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
      </button>
    </div>
  );
}
