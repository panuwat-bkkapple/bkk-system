'use client';

import { useEffect, useState } from 'react';
import { ref, onValue, update, set } from 'firebase/database';
import { Link } from 'react-router-dom';
import {
  Bell, Save, Loader2, CheckCircle2, Info, Mail, ExternalLink, Radio, ListChecks, Timer,
} from 'lucide-react';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { NotificationStatusCard } from '../mobile/components/NotificationStatusCard';
import {
  NOTIFICATION_SETTINGS_PATH,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  parseNotificationSettings,
  type NotificationSettings as NotificationSettingsShape,
} from '../../utils/notificationSettings';

// หน้ารวมการตั้งค่าแจ้งเตือนทั้งระบบ — ก่อนหน้านี้กระจายอยู่ 3 ที่ (การ์ดสถานะ
// push ในแอปมือถือ, สวิตช์อีเมลในหน้าตั้งค่าระบบบัญชี, strip ขออนุญาตในคอนโซล
// แชท) และอีก 2 ตัวตั้งได้จาก env เท่านั้น. หน้านี้เป็นเจ้าของ
// settings/notifications (สวิตช์ที่ cloud function อ่านจริง — ดู
// functions/notification-settings.js) และ "ชี้ทาง" ไปยังค่าที่เจ้าของอยู่หน้าอื่น
// แทนที่จะเขียนทับ เพื่อไม่ให้มีสองหน้าที่แก้ฟิลด์เดียวกัน

const DEFAULT_OVERDUE_MIN = 60;

const inputCls =
  'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all';

export default function NotificationSettings() {
  const toast = useToast();
  const [config, setConfig] = useState<NotificationSettingsShape>(() => parseNotificationSettings(null));
  const [overdueMin, setOverdueMin] = useState<number>(DEFAULT_OVERDUE_MIN);
  const [orderEmailsEnabled, setOrderEmailsEnabled] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const unsubs = [
      onValue(ref(db, NOTIFICATION_SETTINGS_PATH), (snap) => setConfig(parseNotificationSettings(snap.val()))),
      onValue(ref(db, 'settings/system/rider_overdue_min'), (snap) => {
        const v = Number(snap.val());
        setOverdueMin(v > 0 ? v : DEFAULT_OVERDUE_MIN);
      }),
      onValue(ref(db, 'settings/accounting/order_emails_enabled'), (snap) => setOrderEmailsEnabled(snap.val() === true)),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await update(ref(db, NOTIFICATION_SETTINGS_PATH), {
        channels: config.channels,
        events: config.events,
        updated_at: Date.now(),
      });
      await set(
        ref(db, 'settings/system/rider_overdue_min'),
        Number(overdueMin) > 0 ? Math.min(Number(overdueMin), 1440) : DEFAULT_OVERDUE_MIN,
      );
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);
      toast.success('บันทึกการตั้งค่าการแจ้งเตือนแล้ว');
    } catch {
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setIsSaving(false);
    }
  };

  const offCount =
    NOTIFICATION_CHANNELS.filter((c) => !config.channels[c.key]).length +
    NOTIFICATION_EVENTS.filter((e) => !config.events[e.key]).length;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
          <Bell size={22} />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800">การแจ้งเตือน (Notifications)</h1>
          <p className="text-xs font-bold text-slate-400">
            รวมทุกสวิตช์แจ้งเตือนของระบบไว้ที่เดียว — ช่องทาง เหตุการณ์ เกณฑ์เวลา และสถานะเครื่องของคุณ
          </p>
        </div>
      </div>

      {offCount > 0 ? (
        <div className="mb-5 p-3.5 rounded-xl bg-amber-50 border border-amber-100 flex gap-2">
          <Info size={15} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
            ตอนนี้ปิดการแจ้งเตือนไว้ {offCount} รายการ — ที่ปิดจะไม่ถูกส่งเลย (ไม่มีการเก็บย้อนหลังไปส่งทีหลัง)
          </p>
        </div>
      ) : null}

      {/* ---- ช่องทาง ---- */}
      <SectionCard
        icon={<Radio size={16} />}
        title="ช่องทางการแจ้งเตือน"
        subtitle="ปิดที่นี่ = ปิดทั้งช่องทาง ไม่ว่าเหตุการณ์ไหนก็ไม่ส่ง"
      >
        {NOTIFICATION_CHANNELS.map((c) => (
          <ToggleRow
            key={c.key}
            label={c.label}
            description={c.description}
            checked={config.channels[c.key]}
            onChange={(v) => setConfig((s) => ({ ...s, channels: { ...s.channels, [c.key]: v } }))}
          />
        ))}
      </SectionCard>

      {/* ---- เหตุการณ์ ---- */}
      <SectionCard
        icon={<ListChecks size={16} />}
        title="แจ้งเตือนตามเหตุการณ์"
        subtitle="เลือกว่าเรื่องไหนควรเด้ง — มีผลกับทุกช่องทางที่ยังเปิดอยู่"
      >
        {NOTIFICATION_EVENTS.map((e) => (
          <ToggleRow
            key={e.key}
            label={e.label}
            description={e.description}
            checked={config.events[e.key]}
            onChange={(v) => setConfig((s) => ({ ...s, events: { ...s.events, [e.key]: v } }))}
          />
        ))}
      </SectionCard>

      {/* ---- เกณฑ์เวลา ---- */}
      <SectionCard
        icon={<Timer size={16} />}
        title="เกณฑ์เวลาแจ้งเตือน"
        subtitle="ตัวเลขที่กำหนดว่า 'ช้าแค่ไหนถึงเตือน'"
      >
        <div className="p-5">
          <p className="text-sm font-black text-slate-800">งานค้างเกินกำหนด (นาที)</p>
          <p className="text-[11px] font-bold text-slate-400 mt-0.5 mb-3">
            เครื่องอยู่กับไรเดอร์นานเกินนี้ → เตือนแอดมินหนึ่งครั้งต่องาน · ค่าเริ่มต้น {DEFAULT_OVERDUE_MIN} นาที
          </p>
          <input
            type="number"
            min={5}
            max={1440}
            value={overdueMin || ''}
            placeholder={String(DEFAULT_OVERDUE_MIN)}
            onChange={(e) => setOverdueMin(Number(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
        <LinkRow
          to="/offer-settings"
          label="เตือน SLA ข้อเสนอลูกค้า + อายุข้อเสนอ"
          hint="ข้อเสนอค้างพิจารณากี่ชั่วโมงถึงเตือน CEO/MANAGER — ตั้งที่หน้า เสนอราคาเอง"
        />
        <LinkRow
          to="/global-settings"
          label="เกณฑ์ flag ไรเดอร์อัตโนมัติ"
          hint="ตัวเลขที่ทำให้ระบบเตือนว่าไรเดอร์คนนี้ผิดปกติ — ตั้งที่หน้า ตั้งค่าระบบส่วนกลาง"
        />
      </SectionCard>

      {/* ---- อีเมล ---- */}
      <SectionCard icon={<Mail size={16} />} title="อีเมลถึงลูกค้าและแอดมิน" subtitle="เจ้าของค่าอยู่ที่หน้าตั้งค่าระบบบัญชี">
        <div className="p-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black text-slate-800">ระบบส่งอีเมลอัตโนมัติ</p>
            <p className="text-[11px] font-bold text-slate-400 mt-0.5">
              สวิตช์นี้คุมทั้งอีเมล<span className="underline">และ</span>การออกใบกำกับภาษี/ใบสำคัญรับเงิน จึงแก้ได้ที่หน้าตั้งค่าระบบบัญชีที่เดียว
              เพื่อกันเผลอปิดเอกสารโดยไม่ตั้งใจ
            </p>
          </div>
          <span
            className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-black ${
              orderEmailsEnabled == null
                ? 'bg-slate-100 text-slate-400'
                : orderEmailsEnabled
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-500'
            }`}
          >
            {orderEmailsEnabled == null ? '...' : orderEmailsEnabled ? 'เปิดอยู่' : 'ปิดอยู่'}
          </span>
        </div>
        <LinkRow
          to="/accounting-settings"
          label="ไปที่ ระบบบัญชี & ใบกำกับภาษี"
          hint="เปิด/ปิดการส่งอีเมล และแก้ข้อมูลนิติบุคคลที่แสดงในเอกสาร"
        />
        <div className="p-5">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex gap-2">
            <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
              อีเมลกลางที่รับแจ้งออเดอร์ (<code className="font-mono">ORDER_NOTIFY_EMAIL</code>) และโทเคน Telegram
              ตั้งจาก GitHub Secrets เท่านั้น ไม่เปิดให้แก้จากหน้าเว็บ เพราะเป็นค่าลับที่ไม่ควรอยู่ในฐานข้อมูลที่แอดมินทุกคนอ่านได้
            </p>
          </div>
        </div>
      </SectionCard>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="mt-5 flex items-center gap-2 px-6 py-3.5 bg-slate-900 text-white rounded-xl font-black text-sm hover:bg-slate-800 disabled:opacity-50 transition-all"
      >
        {isSaving ? <Loader2 size={16} className="animate-spin" /> : showSuccess ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Save size={16} />}
        บันทึกการตั้งค่า
      </button>

      {/* ---- สถานะเครื่องนี้ ---- */}
      <div className="mt-8">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">เครื่องที่คุณใช้อยู่</p>
        <p className="text-[11px] font-bold text-slate-400 mb-3">
          สวิตช์ด้านบนคุมทั้งทีม ส่วนด้านล่างคือสถานะของเครื่องนี้เครื่องเดียว — ใช้ตรวจว่าทำไม &quot;คนอื่นได้แต่เราไม่ได้&quot;
        </p>
        <NotificationStatusCard className="rounded-2xl border border-slate-200 bg-white overflow-hidden" />
      </div>
    </div>
  );
}

const SectionCard = ({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) => (
  <div className="mb-5 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="px-5 py-4 border-b border-slate-100">
      <p className="text-sm font-black text-slate-800 flex items-center gap-2">
        <span className="text-slate-400">{icon}</span>
        {title}
      </p>
      <p className="text-[11px] font-bold text-slate-400 mt-0.5">{subtitle}</p>
    </div>
    <div className="divide-y divide-slate-100">{children}</div>
  </div>
);

const ToggleRow = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <label className="flex items-center justify-between gap-4 p-5 cursor-pointer">
    <div>
      <p className="text-sm font-black text-slate-800">{label}</p>
      <p className="text-[11px] font-bold text-slate-400 mt-0.5 leading-relaxed">{description}</p>
    </div>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-5 h-5 rounded text-rose-600 focus:ring-rose-500 shrink-0"
    />
  </label>
);

const LinkRow = ({ to, label, hint }: { to: string; label: string; hint: string }) => (
  <Link to={to} className="flex items-center justify-between gap-4 p-5 hover:bg-slate-50 transition">
    <div>
      <p className="text-sm font-black text-blue-700">{label}</p>
      <p className="text-[11px] font-bold text-slate-400 mt-0.5">{hint}</p>
    </div>
    <ExternalLink size={15} className="text-slate-300 shrink-0" />
  </Link>
);
