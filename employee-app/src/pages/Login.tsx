import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { LogIn, Loader2 } from 'lucide-react';
import { auth } from '../firebase';

// เข้าสู่ระบบด้วยบัญชีเดียวกับที่ฝ่ายบุคคลออกให้ตอนเริ่มงาน
// **แอปนี้ไม่มีทางสมัครเอง** — บัญชีเกิดจากการจ้างเท่านั้น (ดู adminStaffCreate)
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="gate">
      <div style={{ maxWidth: 380, width: '100%', margin: '0 auto' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.18em', opacity: 0.7, fontWeight: 800 }}>BKK APPLE</div>
        <h2>แอปพนักงาน</h2>
        <p>ลงเวลาเข้า-ออกงาน ขอลา และขอเปลี่ยนกะ</p>

        <form onSubmit={submit}>
          <label htmlFor="em">อีเมล</label>
          <input id="em" type="email" autoComplete="username" inputMode="email"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="pw">รหัสผ่าน</label>
          <input id="pw" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16 }}>
            {busy ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />} เข้าสู่ระบบ
          </button>
        </form>

        <p style={{ marginTop: 18, fontSize: 12.5 }}>
          ยังไม่มีบัญชี หรือลืมรหัสผ่าน ติดต่อฝ่ายบุคคล — แอปนี้สมัครเองไม่ได้
        </p>
      </div>
    </div>
  );
}
