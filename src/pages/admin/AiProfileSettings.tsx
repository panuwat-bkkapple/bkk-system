import { useState, useEffect } from 'react';
import { ref, get, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { Bot, Save, Sparkles, SlidersHorizontal, FileText, Eye } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

// =============================================================================
// AI Profile — settings/chat_widget/ai_profile
//
// Persona layer for the customer chat AI, separate from the operational
// switches on /chat-settings. Read by the chatWidgetAiReply cloud function
// (buildPersonaBlock in functions/chat-ai.js) and appended to the STATIC
// system-prompt block, so it applies to every conversation identically and
// stays prompt-cache friendly. Style only: the function-side block explicitly
// forbids overriding the top principles / iron rules (prices, store data,
// safety) — this page can shape HOW the AI talks, never WHAT it may claim.
//
// assistant_name is the same field the widget shows to customers
// (settings/chat_widget/public/assistant_name) — editing it here and on
// /chat-settings writes the same node, no copy to drift.
// =============================================================================

interface AiProfileConfig {
  enabled: boolean;
  gender: '' | 'male' | 'female';
  character: string;
  tone: '' | 'formal' | 'friendly' | 'playful';
  reply_length: '' | 'brief' | 'detailed';
  use_emoji: boolean;
  custom_instructions: string;
}

const PROFILE_DEFAULTS: AiProfileConfig = {
  enabled: false,
  gender: '',
  character: '',
  tone: '',
  reply_length: '',
  use_emoji: false,
  custom_instructions: '',
};

const GENDER_OPTIONS: { value: AiProfileConfig['gender']; label: string; hint: string }[] = [
  { value: '', label: 'ตามระบบ (ครับ)', hint: 'ใช้หางเสียงมาตรฐานของระบบ' },
  { value: 'male', label: 'ผู้ชาย — ครับ/นะครับ', hint: 'ผู้ช่วยพูดหางเสียง "ครับ" ทุกข้อความ' },
  { value: 'female', label: 'ผู้หญิง — ค่ะ/นะคะ', hint: 'ผู้ช่วยพูดหางเสียง "ค่ะ" ทุกข้อความ' },
];

const TONE_OPTIONS: { value: AiProfileConfig['tone']; label: string; hint: string }[] = [
  { value: '', label: 'มาตรฐานระบบ', hint: 'อบอุ่น มืออาชีพ เป็นกันเอง (ค่าเริ่มต้นที่จูนไว้แล้ว)' },
  { value: 'formal', label: 'เป็นทางการ', hint: 'สุภาพเรียบร้อยแบบมืออาชีพตลอดบทสนทนา' },
  { value: 'friendly', label: 'เป็นกันเอง', hint: 'อบอุ่นสนิทใจขึ้นกว่ามาตรฐาน แต่ยังมืออาชีพ' },
  { value: 'playful', label: 'สดใสมีชีวิตชีวา', hint: 'มีสีสันเป็นมิตร เหมาะกับแคมเปญ/กลุ่มลูกค้าวัยรุ่น' },
];

const LENGTH_OPTIONS: { value: AiProfileConfig['reply_length']; label: string; hint: string }[] = [
  { value: '', label: 'มาตรฐานระบบ', hint: 'สั้นตรงคำถามตามกฎที่จูนไว้' },
  { value: 'brief', label: 'กระชับพิเศษ', hint: 'ตัดคำฟุ่มเฟือยให้มากที่สุดเท่าที่ยังสุภาพครบใจความ' },
  { value: 'detailed', label: 'ละเอียดขึ้น', hint: 'อธิบายเพิ่มเมื่อลูกค้าถามข้อมูล (ยังไม่เทข้อมูลที่ไม่ได้ถาม)' },
];

// Mirror of buildPersonaBlock (functions/chat-ai.js) for the read-only
// preview below — shows the exact lines that will be injected into the
// system prompt so admins see what the AI actually receives. Keep in sync.
function previewLines(p: AiProfileConfig): string[] {
  const lines: string[] = [];
  if (p.gender === 'male') lines.push('หางเสียง: ใช้ "ครับ/นะครับ" (ผู้ช่วยเป็นผู้ชาย)');
  else if (p.gender === 'female') lines.push('หางเสียง: ใช้ "ค่ะ/นะคะ" (ผู้ช่วยเป็นผู้หญิง)');
  if (p.character.trim()) lines.push(`คาแรกเตอร์: ${p.character.trim()}`);
  const tone = TONE_OPTIONS.find((o) => o.value === p.tone && o.value !== '');
  if (tone) lines.push(`โทนการคุย: ${tone.label} — ${tone.hint}`);
  const len = LENGTH_OPTIONS.find((o) => o.value === p.reply_length && o.value !== '');
  if (len) lines.push(`ความยาวคำตอบ: ${len.label} — ${len.hint}`);
  lines.push(
    p.use_emoji
      ? 'อีโมจิ: ใช้ได้เล็กน้อย (ไม่เกิน 1 ตัวต่อข้อความ ไม่ใช้ในเรื่องราคา/เงื่อนไข)'
      : 'อีโมจิ: ห้ามใช้อีโมจิทุกกรณี',
  );
  if (p.custom_instructions.trim()) lines.push(`ข้อกำหนดเพิ่มเติม: ${p.custom_instructions.trim()}`);
  return lines;
}

export default function AiProfileSettings() {
  const toast = useToast();
  const [profile, setProfile] = useState<AiProfileConfig>(PROFILE_DEFAULTS);
  const [assistantName, setAssistantName] = useState('BKK APPLE Assistant');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get(ref(db, 'settings/chat_widget'))
      .then((snap) => {
        if (!snap.exists()) return;
        const val = snap.val();
        if (val.public?.assistant_name) setAssistantName(val.public.assistant_name);
        const p = val.ai_profile || {};
        setProfile({
          enabled: p.enabled === true,
          gender: p.gender === 'male' || p.gender === 'female' ? p.gender : '',
          character: String(p.character || ''),
          tone: ['formal', 'friendly', 'playful'].includes(p.tone) ? p.tone : '',
          reply_length: ['brief', 'detailed'].includes(p.reply_length) ? p.reply_length : '',
          use_emoji: p.use_emoji === true,
          custom_instructions: String(p.custom_instructions || ''),
        });
      })
      .catch(() => toast.error('โหลดโปรไฟล์ไม่สำเร็จ'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await update(ref(db, 'settings/chat_widget'), {
        'public/assistant_name': assistantName.trim() || 'BKK APPLE Assistant',
        ai_profile: {
          enabled: profile.enabled,
          gender: profile.gender,
          character: profile.character.trim().slice(0, 1000),
          tone: profile.tone,
          reply_length: profile.reply_length,
          use_emoji: profile.use_emoji,
          custom_instructions: profile.custom_instructions.trim().slice(0, 2000),
          updated_at: Date.now(),
        },
      });
      toast.success('บันทึกโปรไฟล์ AI แล้ว');
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
          <Sparkles size={24} className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800">โปรไฟล์ AI (Persona)</h1>
          <p className="text-xs text-slate-400 font-bold">
            กำหนดตัวตน บุคลิก และสไตล์การคุยของผู้ช่วย AI หน้าเว็บ — ส่วนตั้งค่าการทำงาน/ความรู้อยู่ที่ "ตั้งค่า Chat Widget (AI)"
          </p>
        </div>
      </div>

      {/* Master gate */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between">
        <div>
          <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
            <Bot size={16} className="text-violet-600" /> ใช้โปรไฟล์ที่ปรับแต่ง
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-md">
            ปิดอยู่ = AI ใช้บุคลิกมาตรฐานของระบบ (ตั้งค่าในหน้านี้ล่วงหน้าได้อย่างปลอดภัย) —
            โปรไฟล์ปรับได้เฉพาะสไตล์การคุย ไม่มีผลกับกฎราคา/ข้อมูลร้าน/ความปลอดภัย
          </p>
        </div>
        <button
          onClick={() => setProfile((p) => ({ ...p, enabled: !p.enabled }))}
          className={`w-14 h-8 rounded-full transition-colors relative shrink-0 ${profile.enabled ? 'bg-violet-500' : 'bg-slate-300'}`}
          aria-label="เปิด/ปิดโปรไฟล์ AI"
        >
          <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${profile.enabled ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Bot size={16} className="text-violet-600" /> ตัวตนของผู้ช่วย
        </h2>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
            ชื่อผู้ช่วย (ลูกค้าเห็นในหน้าต่างแชท)
          </label>
          <input
            type="text"
            value={assistantName}
            onChange={(e) => setAssistantName(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            ฟิลด์เดียวกับหน้า "ตั้งค่า Chat Widget (AI)" — แก้ที่ไหนก็อัปเดตที่เดียวกัน
          </p>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">หางเสียง / เพศของผู้ช่วย</label>
          <div className="grid grid-cols-3 gap-2">
            {GENDER_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setProfile((p) => ({ ...p, gender: o.value }))}
                className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                  profile.gender === o.value
                    ? 'bg-violet-50 border-violet-400 text-violet-700'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {GENDER_OPTIONS.find((o) => o.value === profile.gender)?.hint}
          </p>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
            คาแรกเตอร์ (บทบาท/นิสัยของผู้ช่วย)
          </label>
          <textarea
            value={profile.character}
            onChange={(e) => setProfile((p) => ({ ...p, character: e.target.value }))}
            rows={3}
            maxLength={1000}
            placeholder={'ตัวอย่าง: พนักงานหญิงวัย 25 ชื่อเล่น "หวาน" ร่าเริง ใจเย็น รักงานบริการ เชี่ยวชาญสินค้า Apple เป็นพิเศษ'}
            className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500 resize-y"
          />
          <p className="text-[10px] text-slate-400 text-right">{profile.character.length.toLocaleString()} / 1,000</p>
        </div>
      </div>

      {/* Style */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-blue-600" /> สไตล์การคุย
        </h2>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">โทนการคุย</label>
            <select
              value={profile.tone}
              onChange={(e) => setProfile((p) => ({ ...p, tone: e.target.value as AiProfileConfig['tone'] }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
            >
              {TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">{TONE_OPTIONS.find((o) => o.value === profile.tone)?.hint}</p>
          </div>
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">ความยาวคำตอบ</label>
            <select
              value={profile.reply_length}
              onChange={(e) => setProfile((p) => ({ ...p, reply_length: e.target.value as AiProfileConfig['reply_length'] }))}
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
            >
              {LENGTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">{LENGTH_OPTIONS.find((o) => o.value === profile.reply_length)?.hint}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            <p className="text-sm font-bold text-slate-700">อนุญาตให้ใช้อีโมจิ</p>
            <p className="text-[11px] text-slate-400 max-w-md">
              เปิด = ใช้ได้เล็กน้อย (ไม่เกิน 1 ตัวต่อข้อความ และไม่ใช้ในเรื่องราคา/เงื่อนไข) — ปิด = ห้ามใช้เลย
            </p>
          </div>
          <button
            onClick={() => setProfile((p) => ({ ...p, use_emoji: !p.use_emoji }))}
            className={`w-14 h-8 rounded-full transition-colors relative shrink-0 ml-4 ${profile.use_emoji ? 'bg-emerald-500' : 'bg-slate-300'}`}
            aria-label="เปิด/ปิดอีโมจิ"
          >
            <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${profile.use_emoji ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </div>

      {/* Custom instructions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <FileText size={16} className="text-emerald-600" /> ข้อกำหนดเพิ่มเติม (Custom Instructions)
        </h2>
        <p className="text-xs text-slate-400">
          กติกาสไตล์การคุยเพิ่มเติมที่อยากให้ AI ยึด เช่น คำเรียกแทนตัวเอง วลีประจำร้าน สิ่งที่ห้ามพูด —
          ใช้ได้เฉพาะเรื่อง "วิธีพูด" เท่านั้น ระบบจะไม่ยอมให้ทับกฎราคา/ข้อมูลร้าน/ความปลอดภัย
          (ความรู้/นโยบายร้านให้ใส่ที่ช่อง Knowledge ในหน้า "ตั้งค่า Chat Widget (AI)" แทน)
        </p>
        <textarea
          value={profile.custom_instructions}
          onChange={(e) => setProfile((p) => ({ ...p, custom_instructions: e.target.value }))}
          rows={6}
          maxLength={2000}
          placeholder={'ตัวอย่าง:\n- แทนตัวเองว่า "หวาน" แทนคำว่า "เรา"\n- ปิดท้ายการออกใบเสนอราคาด้วยการชวนนัดรับเครื่องเสมอ\n- ห้ามใช้คำว่า "จ้า"'}
          className="w-full px-4 py-3 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500 resize-y font-mono"
        />
        <p className="text-[10px] text-slate-400 text-right">{profile.custom_instructions.length.toLocaleString()} / 2,000</p>
      </div>

      {/* Preview */}
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-3">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <Eye size={16} className="text-slate-500" /> สรุปโปรไฟล์ที่จะถูกส่งให้ AI
        </h2>
        {profile.enabled ? (
          <ul className="space-y-1.5">
            <li className="text-xs text-slate-600 leading-relaxed">
              • ชื่อผู้ช่วย: <span className="font-bold">{assistantName.trim() || 'BKK APPLE Assistant'}</span>
            </li>
            {previewLines(profile).map((l, i) => (
              <li key={i} className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">• {l}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">
            โปรไฟล์ปิดอยู่ — AI ใช้บุคลิกมาตรฐานของระบบ (ชื่อผู้ช่วย "{assistantName.trim() || 'BKK APPLE Assistant'}" ยังมีผลเสมอ)
          </p>
        )}
        <p className="text-[10px] text-slate-400">
          มีผลกับข้อความใหม่ทันทีหลังบันทึก ไม่ต้อง deploy — ทดสอบได้ผ่านโหมด Preview ของ Chat Widget
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3.5 bg-violet-600 text-white rounded-2xl font-black text-sm hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-md shadow-violet-200 flex items-center justify-center gap-2"
      >
        <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์ AI'}
      </button>
    </div>
  );
}
