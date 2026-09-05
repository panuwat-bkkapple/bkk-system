import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, LogOut, Receipt, FolderClosed, CalendarDays } from 'lucide-react';
import { call, errorText, type ProfileRes } from '../api';
import { thaiDate } from '../geo';
import Avatar from '../Avatar';
import type { Screen } from '../nav';

const LINKS: { id: Screen; label: string; icon: typeof Receipt }[] = [
  { id: 'payslip', label: 'สลิปเงินเดือน', icon: Receipt },
  { id: 'documents', label: 'แฟ้มเอกสาร', icon: FolderClosed },
  { id: 'roster', label: 'ตารางกะของฉัน', icon: CalendarDays },
];

/**
 * ข้อมูลพนักงาน (ดีไซน์ 08)
 *
 * **สรุปเดือนนี้รายงานเฉพาะสิ่งที่ระบบวัดจริง** — ต้นฉบับมีช่อง "โอทีสะสม" แต่
 * ระบบลงเวลาไม่ได้เก็บโอทีเป็นของตัวเอง (โอทีเกิดที่รอบเงินเดือนในฐานะรายการ
 * รายได้ที่ฝ่ายบุคคลกรอก) การเอา `worked_min` มาเรียกว่าโอทีคือการประกาศตัวเลข
 * ที่ไม่มีใครรับรอง จึงเป็น "ชั่วโมงทำงาน" ตามที่วัดได้
 *
 * **ไม่มีลิงก์ "ข้อมูลติดต่อ & บัญชีธนาคาร" กับ "ตั้งค่าและความปลอดภัย"** —
 * ทั้งสองอย่างยังแก้จากแอปไม่ได้ (เลขบัญชีอยู่ในแฟ้มลับที่ฝ่ายบุคคลดูแล และ
 * การเปลี่ยนรหัสผ่านทำผ่านการรีเซ็ตของฝ่ายบุคคล) ปุ่มที่เปิดไปเจอหน้าว่าง
 * แย่กว่าการไม่มีปุ่ม
 */
export default function Profile({ onGo, onLogout }: {
  onGo: (s: Screen) => void;
  onLogout: () => void;
}) {
  const [me, setMe] = useState<ProfileRes | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // **คืนผล ไม่เซ็ต state เอง** — รูปเดียวกับ `resolveMe` ใน App.tsx: effect เป็น
  // คนเซ็ตใน `.then` จึงไม่มีการเซ็ต state แบบซิงโครนัสในตัว effect
  const load = useCallback(async (): Promise<{ me?: ProfileRes; err?: string }> => {
    try { return { me: await call<ProfileRes>('employeeProfile') }; }
    catch (e) { return { err: errorText(e) }; }
  }, []);

  useEffect(() => {
    let alive = true;
    void load().then((r) => {
      if (!alive) return;
      if (r.me) setMe(r.me); else setErr(r.err || null);
    });
    return () => { alive = false; };
  }, [load]);

  if (!me) {
    return (
      <div className="card center">
        {err ? <div className="note bad">{err}</div> : <Loader2 size={20} className="spin" />}
      </div>
    );
  }

  const hired = me.hired_at ? thaiDate(new Date(me.hired_at).toISOString().slice(0, 10)) : null;

  return (
    <>
      <div className="section">
        <div className="card center">
          <Avatar name={me.name || ''} photoUrl={me.photo_url} size={72} />
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 600 }}>{me.name || '—'}</div>
          <div className="muted">{me.position || 'ยังไม่ได้ระบุตำแหน่ง'}</div>
          <div className="muted num">{me.employee_code || '—'}</div>
        </div>
      </div>

      <div className="section"><h2>ข้อมูลการจ้าง</h2>
        <div className="card">
          <div className="kv"><span className="k">ฝ่าย</span><span className="v">{me.department || '—'}</span></div>
          <div className="kv"><span className="k">สาขา</span><span className="v">{me.branch || '—'}</span></div>
          <div className="kv">
            <span className="k">หัวหน้างาน</span>
            <span className="v">
              {me.supervisor?.name || 'ยังไม่ได้ตั้ง'}
              {me.supervisor?.position ? ` · ${me.supervisor.position}` : ''}
            </span>
          </div>
          <div className="kv"><span className="k">เริ่มงาน</span><span className="v">{hired || '—'}</span></div>
        </div>
        {!me.supervisor && (
          // ไม่มีหัวหน้า = ใบลาของเขาไม่มีใครกดอนุมัติจากแอปได้เลย ต้องรู้ตั้งแต่
          // ก่อนยื่น ไม่ใช่รู้ตอนใบค้างหลายวัน
          <div className="note warn" style={{ marginTop: 10 }}>
            ยังไม่ได้ตั้งหัวหน้างานในแฟ้มของคุณ — ใบลาและคำขอเปลี่ยนกะจะยังไม่มี
            ใครอนุมัติจากแอปได้ แจ้งฝ่ายบุคคลให้ตั้งก่อน
          </div>
        )}
      </div>

      <div className="section"><h2>สรุปเดือนนี้</h2>
        <div className="grid3">
          <div className="tile">
            <div className="muted" style={{ fontSize: 11.5 }}>วันทำงาน</div>
            <div className="btm">
              <div className="num" style={{ fontSize: 21, marginTop: 6 }}>{me.summary.worked_days}</div>
              <div className="muted" style={{ fontSize: 11 }}>วันที่ลงเวลา</div>
            </div>
          </div>
          <div className="tile">
            <div className="muted" style={{ fontSize: 11.5 }}>เข้าสาย</div>
            <div className="btm">
              <div className="num" style={{ fontSize: 21, marginTop: 6 }}>{me.summary.late_days}</div>
              <div className="muted" style={{ fontSize: 11 }}>ครั้ง</div>
            </div>
          </div>
          <div className="tile">
            <div className="muted" style={{ fontSize: 11.5 }}>ชั่วโมงทำงาน</div>
            <div className="btm">
              <div className="num" style={{ fontSize: 21, marginTop: 6 }}>{me.summary.worked_hours}</div>
              <div className="muted" style={{ fontSize: 11 }}>ชม.</div>
            </div>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 8, padding: '0 2px' }}>
          นับจากการลงเวลาของเดือนนี้เท่านั้น — ชั่วโมงทำงานไม่ใช่ชั่วโมงโอที
          โอทีคิดที่รอบจ่ายเงินเดือนโดยฝ่ายบุคคล
        </div>
      </div>

      <div className="section">
        <div className="list">
          {LINKS.map((l) => (
            <button className="row tap" key={l.id} onClick={() => onGo(l.id)}>
              <span className="mi sm"><l.icon size={16} strokeWidth={1.9} /></span>
              <span style={{ flex: 1, textAlign: 'left', fontWeight: 600, fontSize: 14 }}>{l.label}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
        <button className="btn ghost" style={{ marginTop: 14 }} onClick={onLogout}>
          <LogOut size={15} /> ออกจากระบบ
        </button>
      </div>
    </>
  );
}
