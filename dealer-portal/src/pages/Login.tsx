import { useState } from 'react';
import { useDealerSession } from '../hooks/useDealerSession';

export const Login = () => {
  const { login } = useDealerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="black" style={{ fontSize: 20 }}>GETMOBIE</div>
        <div className="sub" style={{ letterSpacing: 2, textTransform: 'uppercase' }}>Dealer Portal</div>
        <div className="tiny muted bold" style={{ marginTop: 2 }}>บริษัท เก็ทโมบี้ จำกัด</div>
        <p className="small muted mt12">
          เข้าสู่ระบบด้วยบัญชีดีลเลอร์ที่ได้รับจากเจ้าหน้าที่ เพื่อดูล็อตสินค้าและเสนอราคา
        </p>
        <div className="field">
          <label>อีเมล</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div className="field">
          <label>รหัสผ่าน</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn accent" style={{ marginTop: 18 }} disabled={busy}>
          {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  );
};
