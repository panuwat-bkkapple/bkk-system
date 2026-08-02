// เข้าสู่ระบบ — โครงตามจอ Stitch login.html: hero navy + grid pattern ด้านบน
// การ์ดขาวซ้อนเกย, ช่องกรอกมีไอคอน, ปุ่ม navy. จงใจไม่มี "ลืมรหัสผ่าน/จดจำฉัน"
// เพราะระบบไม่มี self-service reset — บัญชีออก/รีเซ็ตโดยเจ้าหน้าที่เท่านั้น
import { useState } from 'react';
import { ShieldCheck, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useDealerSession } from '../hooks/useDealerSession';

export const Login = () => {
  const { login } = useDealerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      // ถ้าบัญชีไม่ใช่ดีลเลอร์ ACTIVE — useDealerSession จะ sign out เอง
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      setError(
        code === 'auth/user-disabled'
          ? 'บัญชีถูกระงับ — กรุณาติดต่อเจ้าหน้าที่'
          : 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <ShieldCheck size={44} strokeWidth={1.7} style={{ opacity: 0.95 }} />
        <div className="t">
          GETMOBIE{' '}
          <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 800, letterSpacing: 2.5, border: '1px solid rgba(39,174,96,0.45)', borderRadius: 6, padding: '2px 7px', verticalAlign: 'middle' }}>
            DEALER
          </span>
        </div>
        <div className="s">Secure Dealer Access</div>
      </div>

      <div className="login-main">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="bold" style={{ fontFamily: 'var(--font-head)', fontSize: 19 }}>ลงชื่อเข้าใช้</div>
          <p className="small muted" style={{ marginTop: 5 }}>
            กรอกข้อมูลบัญชีดีลเลอร์ที่ได้รับจากเจ้าหน้าที่
          </p>
          <div className="field">
            <label>อีเมล</label>
            <div className="input-ic">
              <Mail size={16} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dealer@example.com"
                autoComplete="username"
                required
              />
            </div>
          </div>
          <div className="field">
            <label>รหัสผ่าน</label>
            <div className="input-ic">
              <Lock size={16} />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className="eye" tabIndex={-1} onClick={() => setShowPw((v) => !v)} title={showPw ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn" style={{ marginTop: 18, width: '100%' }} disabled={busy}>
            {busy ? 'กำลังเข้าสู่ระบบ...' : (<>เข้าสู่ระบบ <ArrowRight size={15} /></>)}
          </button>
        </form>
      </div>

      <div className="login-foot">
        <ShieldCheck size={20} style={{ opacity: 0.6 }} />
        <div style={{ marginTop: 6 }}>
          บัญชีดีลเลอร์ออกให้โดยเจ้าหน้าที่เท่านั้น — ลืมรหัสผ่านหรือต้องการความช่วยเหลือ กรุณาติดต่อเจ้าหน้าที่ GETMOBIE
        </div>
      </div>
    </div>
  );
};
