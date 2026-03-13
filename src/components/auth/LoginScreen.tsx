// src/components/auth/LoginScreen.tsx
import React, { useState, useEffect } from 'react';
import { auth, db } from '../../api/firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, get, push, set } from 'firebase/database';
import { Lock, LogIn, KeyRound, User, ChevronLeft, LogOut, ShieldCheck } from 'lucide-react';

export const LoginScreen = ({ onLogin }: { onLogin: (staff: any) => void }) => {
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // --- 🛡️ Step 1: Master Login State (Firebase) ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // --- 🧑‍💼 Step 2: Staff PIN Login State ---
  const [staffList, setStaffList] = useState<any[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [fetchingStaff, setFetchingStaff] = useState(false);

  // 🌟 เช็คสถานะ Master Login ตอนเปิดหน้าเว็บ
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        // ถ้ามีกุญแจ Master แล้ว -> ดึงรายชื่อพนักงานมาโชว์ได้เลย!
        setFetchingStaff(true);
        try {
          const snap = await get(ref(db, 'staff'));
          if (snap.exists()) {
            const arr = Object.keys(snap.val()).map(k => ({ id: k, ...snap.val()[k] }));
            setStaffList(arr.filter(s => s.status === 'ACTIVE'));
          } else {
            // Database is empty - bootstrap first user as CEO and auto-login
            const staffName = user.displayName || user.email?.split('@')[0] || 'Admin';
            const newStaffRef = push(ref(db, 'staff'));
            const newStaff = {
              name: staffName,
              email: user.email,
              role: 'CEO',
              status: 'ACTIVE',
              pin: '0000',
              createdAt: new Date().toISOString(),
            };
            await set(newStaffRef, newStaff);
            onLogin({ id: newStaffRef.key, ...newStaff });
          }
        } catch (err) {
          console.error("Fetch staff error:", err);
        } finally {
          setFetchingStaff(false);
        }
      }
      setIsCheckingAuth(false); // 🌟 พระเอกอยู่ตรงนี้! สั่งหยุดวงล้อ Loading ไม่ว่าจะสำเร็จหรือพัง
    });
    return () => unsub();
  }, []);

  // 🌟 ฟังก์ชันล็อกอิน Master
  const handleMasterLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // พอสำเร็จ useEffect ข้างบนจะทำงานอัตโนมัติ
    } catch (err) {
      setAuthError('อีเมลหรือรหัสผ่านระบบไม่ถูกต้อง');
      setAuthLoading(false);
    }
  };

  // 🌟 ฟังก์ชันล็อกอินพนักงานด้วย PIN (ตรวจสอบกับ database โดยตรง)
  const handlePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    try {
      // ดึง PIN จาก database ใหม่ทุกครั้ง ป้องกันการแก้ไข client-side
      const snap = await get(ref(db, `staff/${selectedStaff.id}/pin`));
      const dbPin = snap.exists() ? String(snap.val()) : null;

      if (dbPin && pin === dbPin) {
        // ส่งข้อมูลพนักงาน (ไม่รวม PIN) เข้าสู่ระบบ
        const { pin: _pin, ...safeStaff } = selectedStaff;
        onLogin(safeStaff);
      } else {
        setPinError('รหัส PIN 4 หลักไม่ถูกต้อง');
        setPin('');
      }
    } catch (err) {
      setPinError('เกิดข้อผิดพลาดในการตรวจสอบ กรุณาลองใหม่');
      setPin('');
    }
  };

  const handleMasterLogout = () => {
    signOut(auth);
    setSelectedStaff(null);
  };

  // ==========================================
  // 🎨 ส่วนแสดงผล (Render UI)
  // ==========================================

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex flex-col items-center justify-center text-slate-400 font-bold">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
        <p>Loading Secure System...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 overflow-hidden relative">
        
        {/* ----------------------------------------------------- */}
        {/* 🛡️ หน้าจอที่ 1: Master Login (สำหรับเปิดกุญแจระบบ) */}
        {/* ----------------------------------------------------- */}
        {!firebaseUser && (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center mb-8">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600 shadow-inner">
                <Lock size={32} />
              </div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">Master System Login</h1>
              <p className="text-slate-500 text-sm mt-1 font-bold">เข้าสู่ระบบหลังบ้านด้วยบัญชีผู้ดูแล</p>
            </div>

            <form onSubmit={handleMasterLogin} className="space-y-5">
              {authError && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-xl text-center font-bold">{authError}</div>}
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="admin@bkkapple.com" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="••••••••" />
              </div>
              <button type="submit" disabled={authLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 uppercase text-sm">
                {authLoading ? 'กำลังตรวจสอบ...' : <><LogIn size={18} /> ปลดล็อกระบบ</>}
              </button>
            </form>
          </div>
        )}


        {/* ----------------------------------------------------- */}
        {/* 🧑‍💼 หน้าจอที่ 2: เลือกพนักงานและใส่ PIN */}
        {/* ----------------------------------------------------- */}
        {firebaseUser && (
          <div className="animate-in fade-in slide-in-from-right-4">
            
            {/* Header ของหน้าเลือกพนักงาน */}
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest">
                <ShieldCheck size={14} /> Master Unlocked
              </div>
              <button onClick={handleMasterLogout} className="text-xs font-bold text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                <LogOut size={12}/> สลับบัญชีหลัก
              </button>
            </div>

            {/* 2.1 โหมดเลือกชื่อพนักงาน */}
            {!selectedStaff ? (
              <>
                <div className="text-center mb-6">
                  <h1 className="text-xl font-black text-slate-800">เลือกบัญชีพนักงาน</h1>
                  <p className="text-slate-500 text-xs mt-1 font-bold">กรุณาระบุตัวตนก่อนเข้าใช้งาน POS</p>
                </div>
                
                {fetchingStaff ? (
                  <div className="py-10 text-center text-slate-400 font-bold animate-pulse">กำลังโหลดรายชื่อ...</div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {staffList.map((staff) => (
                      <button 
                        key={staff.id} 
                        onClick={() => setSelectedStaff(staff)}
                        className="w-full flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all text-left group"
                      >
                        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black text-lg group-hover:scale-110 transition-transform">
                          {staff.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="font-black text-slate-800">{staff.name}</div>
                          <div className="text-xs font-bold text-slate-400">{staff.role} • {staff.branch}</div>
                        </div>
                        <ChevronLeft size={18} className="text-slate-300 rotate-180 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : 

            /* 2.2 โหมดใส่ PIN 4 หลัก */
            (
              <div className="animate-in fade-in slide-in-from-right-4">
                 <button onClick={() => { setSelectedStaff(null); setPin(''); setPinError(''); }} className="text-slate-400 hover:text-blue-600 flex items-center gap-1 text-sm font-bold mb-4">
                   <ChevronLeft size={16} /> กลับไปเลือกชื่อ
                 </button>

                 <div className="text-center mb-8">
                    <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black text-3xl mx-auto mb-4 shadow-inner">
                      {selectedStaff.name.charAt(0)}
                    </div>
                    <h1 className="text-2xl font-black text-slate-800">{selectedStaff.name}</h1>
                    <p className="text-slate-500 text-sm mt-1 font-bold uppercase">{selectedStaff.role}</p>
                 </div>

                 <form onSubmit={handlePinLogin} className="space-y-6">
                    {pinError && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-xl text-center font-bold">{pinError}</div>}
                    <div>
                      <label className="block text-xs font-black text-slate-500 mb-2 uppercase tracking-widest text-center">กรอกรหัส PIN 4 หลัก</label>
                      <input 
                        type="password" 
                        maxLength={4}
                        pattern="\d{4}"
                        autoFocus
                        value={pin} 
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} 
                        required 
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 font-mono text-3xl font-black tracking-[1em] text-center focus:border-blue-500 focus:bg-blue-50/30 outline-none transition-all" 
                        placeholder="••••" 
                      />
                    </div>
                    <button type="submit" className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-xl transition shadow-lg shadow-slate-900/20 uppercase text-sm flex justify-center items-center gap-2">
                       <KeyRound size={18} /> เข้าสู่ระบบ
                    </button>
                 </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};