// src/components/auth/LoginScreen.tsx
//
// Per-employee login — สถาปัตยกรรมใหม่: พนักงานแต่ละคน login ด้วยบัญชี
// Firebase Auth ของตัวเอง (อีเมล + รหัสผ่านส่วนตัว) ขั้นตอนเดียว
// ไม่มีบัญชีมาสเตอร์ร่วม ไม่มีการเลือกชื่อ + PIN อีกต่อไป
//
// หลัง sign-in สำเร็จ ต้องผ่านการตรวจ 2 ชั้นก่อนเข้าระบบ:
//   1. อีเมลต้องตรงกับ staff record (role/สิทธิ์ผูกด้วยอีเมล — สร้างโดย CEO
//      ผ่านหน้า /staff ซึ่งเรียก cloud function adminStaffCreate)
//   2. record ต้อง ACTIVE — พนักงานที่ถูกพักงานจะถูกปฏิเสธ (ฝั่ง server ก็
//      บังคับอยู่แล้ว: auth ถูก disable + /admins ถูกถอน → อ่าน DB ไม่ได้)
import React, { useState } from 'react';
import { auth, db } from '../../api/firebase';
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { LogIn, Mail, Lock, Eye, EyeOff, ShieldCheck, UserX, AlertTriangle, CheckCircle2 } from 'lucide-react';

const normEmail = (e: string) => e.trim().toLowerCase();

// แปลง error จาก Firebase Auth เป็นข้อความที่คนอ่านรู้เรื่อง โดยไม่เผยว่า
// อีเมลไหนมีอยู่ในระบบ (กัน account enumeration)
const authErrorMessage = (code: string): { text: string; suspended?: boolean } => {
  switch (code) {
    case 'auth/user-disabled':
      return { text: 'บัญชีนี้ถูกพักการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', suspended: true };
    case 'auth/too-many-requests':
      return { text: 'พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' };
    case 'auth/network-request-failed':
      return { text: 'เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' };
    default:
      return { text: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
  }
};

export const LoginScreen = ({ onLogin }: { onLogin: (staff: any) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suspended, setSuspended] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setSuspended(false);
    setResetSent(false);

    try {
      const cred = await signInWithEmailAndPassword(auth, normEmail(email), password);

      // ผูก identity กับ staff record ด้วยอีเมล (แหล่งเดียวกับ cloud functions)
      let staffSnap;
      try {
        staffSnap = await get(ref(db, 'staff'));
      } catch {
        // อ่านไม่ได้ = ไม่มีสิทธิ์ใน database rules (ถูกถอนจาก /admins —
        // เคสพักงาน/ถูกถอนสิทธิ์ที่ auth ยัง login ผ่าน)
        await signOut(auth);
        setSuspended(true);
        setError('บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบ กรุณาติดต่อผู้ดูแลระบบ');
        return;
      }

      const authEmail = normEmail(cred.user.email || '');
      let matched: any = null;
      let matchedId: string | null = null;
      if (staffSnap.exists()) {
        const staffData = staffSnap.val();
        for (const [id, s] of Object.entries<any>(staffData)) {
          if (s && normEmail(String(s.email || '')) === authEmail) {
            matched = s;
            matchedId = id;
            break;
          }
        }
      }

      if (!matched) {
        await signOut(auth);
        setError('บัญชีนี้ยังไม่ได้ลงทะเบียนเป็นพนักงาน กรุณาติดต่อผู้ดูแลระบบ');
        return;
      }
      if (matched.status !== 'ACTIVE') {
        await signOut(auth);
        setSuspended(true);
        setError('บัญชีนี้ถูกพักการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
        return;
      }

      onLogin({
        id: matchedId,
        uid: cred.user.uid,
        name: matched.name || cred.user.displayName || authEmail.split('@')[0],
        email: authEmail,
        role: matched.role || 'STAFF',
        branch: matched.branch || '',
      });
    } catch (err: any) {
      const mapped = authErrorMessage(err?.code || '');
      setSuspended(!!mapped.suspended);
      setError(mapped.text);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const target = normEmail(email);
    if (!target) {
      setError('กรอกอีเมลก่อน แล้วกด "ลืมรหัสผ่าน" อีกครั้ง');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, target);
    } catch {
      // เงียบ — ไม่เผยว่าอีเมลไหนมี/ไม่มีในระบบ
    }
    setError('');
    setSuspended(false);
    setResetSent(true);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-slate-950 overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute -bottom-48 -right-32 w-[36rem] h-[36rem] rounded-full bg-indigo-500/15 blur-[140px]" />
        <div className="absolute top-1/3 left-1/2 w-72 h-72 rounded-full bg-sky-400/10 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-[26rem]">
        {/* Brand */}
        <div className="text-center mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-600/40 mb-4">
            <ShieldCheck size={30} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight uppercase">
            BKK <span className="text-blue-400">Apple</span> Admin
          </h1>
          <p className="text-slate-400 text-sm font-bold mt-1">ระบบหลังบ้าน — เข้าสู่ระบบด้วยบัญชีพนักงานของคุณ</p>
        </div>

        {/* Card */}
        <div className="bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-[1.75rem] p-8 shadow-2xl shadow-black/40 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <form onSubmit={handleLogin} className="space-y-5">

            {resetSent && (
              <div className="bg-emerald-500/10 border border-emerald-400/30 text-emerald-300 text-sm p-3.5 rounded-xl font-bold flex items-start gap-2">
                <CheckCircle2 size={17} className="shrink-0 mt-0.5" />
                <span>ถ้าอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว — เช็คกล่องจดหมาย (และ Junk)</span>
              </div>
            )}

            {error && (
              <div className={`text-sm p-3.5 rounded-xl font-bold flex items-start gap-2 border ${
                suspended
                  ? 'bg-amber-500/10 border-amber-400/30 text-amber-300'
                  : 'bg-red-500/10 border-red-400/30 text-red-300'
              }`}>
                {suspended ? <UserX size={17} className="shrink-0 mt-0.5" /> : <AlertTriangle size={17} className="shrink-0 mt-0.5" />}
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-black text-slate-400 mb-1.5 uppercase tracking-widest">อีเมลพนักงาน</label>
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/[0.06] border border-white/10 text-white font-bold placeholder:text-slate-500 placeholder:font-medium focus:border-blue-400/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                  placeholder="you@bkkapple.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-black text-slate-400 mb-1.5 uppercase tracking-widest">รหัสผ่าน</label>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full pl-11 pr-12 py-3.5 rounded-xl bg-white/[0.06] border border-white/10 text-white font-bold placeholder:text-slate-500 placeholder:font-medium focus:border-blue-400/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black py-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 uppercase text-sm tracking-wide"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  กำลังตรวจสอบ...
                </>
              ) : (
                <><LogIn size={17} /> เข้าสู่ระบบ</>
              )}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs font-bold text-slate-400 hover:text-blue-300 transition-colors"
              >
                ลืมรหัสผ่าน?
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-[11px] font-bold text-slate-600 mt-6">
          บัญชีพนักงานออกให้โดยผู้ดูแลระบบเท่านั้น — หากเข้าไม่ได้ กรุณาติดต่อ CEO/ผู้จัดการ
        </p>
      </div>
    </div>
  );
};
