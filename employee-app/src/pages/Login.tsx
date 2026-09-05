import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { LogIn, Loader2, UserRound } from 'lucide-react';
import { auth } from '../firebase';
import GateShell from '../GateShell';
import Wordmark from '../Wordmark';

// เข้าสู่ระบบด้วยบัญชีเดียวกับที่ฝ่ายบุคคลออกให้ตอนเริ่มงาน
// **แอปนี้ไม่มีทางสมัครเอง** — บัญชีเกิดจากการจ้างเท่านั้น (ดู adminStaffCreate)
//
// ดีไซน์ต้นทางมีปุ่ม SSO บริษัท / Face ID / "จำฉันไว้ในเครื่องนี้" — **ไม่ได้ทำ**
// เพราะระบบยังไม่มีสามอย่างนั้นจริง ปุ่มที่กดแล้วไม่เกิดอะไรแย่กว่าไม่มีปุ่ม
export default function Login({ notice }: { notice?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch {
      // ไม่บอกว่า "ไม่พบอีเมลนี้" — การบอกว่าอีเมลไหนมีอยู่ในระบบคือการยืนยัน
      // รายชื่อพนักงานให้คนที่เดาสุ่ม
      setErr('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      setBusy(false);
    }
  };

  return (
    <GateShell
      icon={<UserRound size={22} strokeWidth={2} />}
      brand={<><Wordmark /> · แอปพนักงาน</>}
      title="เข้าสู่ระบบด้วยบัญชีพนักงาน"
      detail="ใช้อีเมลบริษัทที่ฝ่ายบุคคลออกให้ตอนเริ่มงาน"
      foot="ยังไม่มีบัญชี หรือลืมรหัสผ่าน ติดต่อฝ่ายบุคคล — แอปนี้สมัครเองไม่ได้"
    >
      {/* เหตุผลที่เพิ่งถูกเตะออก (เช่น บัญชีนี้ไม่ใช่บัญชีพนักงาน) — ต้องขึ้น
          ก่อนฟอร์ม ไม่งั้นคนจะกรอกซ้ำแล้วเจอผลเดิมโดยไม่รู้ว่าทำไม */}
      {notice && <div className="note warn">{notice}</div>}

      <form onSubmit={submit}>
        <label htmlFor="em">อีเมลบริษัท</label>
        <input id="em" type="email" autoComplete="username" inputMode="email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label htmlFor="pw">รหัสผ่าน</label>
        <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="button" className="opt" style={{ marginTop: 8 }}
          aria-pressed={show} onClick={() => setShow((v) => !v)}>
          {show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        </button>

        {err && <div className="note bad" style={{ marginTop: 14 }}>{err}</div>}

        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 18 }}>
          {busy ? <Loader2 size={17} className="spin" /> : <LogIn size={17} />} เข้าสู่ระบบ
        </button>
      </form>
    </GateShell>
  );
}
