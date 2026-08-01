import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, get, push, set, onValue } from 'firebase/database';
import { auth, db } from '../api/firebase';

// =============================================================================
// Staff session — per-employee Firebase Auth accounts.
//
// สถาปัตยกรรมใหม่: identity = บัญชี Firebase Auth ส่วนตัวของพนักงานแต่ละคน
// role/สิทธิ์ resolve จาก staff record ที่อีเมลตรงกับ token (แหล่งเดียวกับ
// cloud functions lookupStaffByAuth). กติกาเข้ม:
//   - ไม่มี staff record ที่ ACTIVE ตรงกับอีเมล = ไม่ให้เข้า (sign out) —
//     ไม่มี fallback role STAFF แบบเดิมอีกแล้ว
//   - status ถูกเฝ้าแบบ realtime — CEO กดพักงานปุ๊บ session โดนเตะออกทันที
//     (ฝั่ง server ก็บังคับคู่กัน: auth disabled + /admins ถูกถอน)
//
// ใช้ร่วมกันระหว่างแอปแอดมิน (App.tsx) และแอปแชท (ChatApp) — one
// implementation, two entry points; never fork this logic per app.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StaffUser = any;

const normEmail = (e: unknown) => String(e || '').trim().toLowerCase();

export function useStaffSession() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<StaffUser>(() => {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !currentUser) {
        try {
          const staffSnap = await get(ref(db, 'staff'));
          const authEmail = normEmail(firebaseUser.email);

          if (!staffSnap.exists()) {
            // Database ว่างเปล่า (ติดตั้งใหม่) — bootstrap คนแรกเป็น CEO
            const staffName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Admin';
            const newStaffRef = push(ref(db, 'staff'));
            await set(newStaffRef, {
              name: staffName,
              email: authEmail,
              role: 'CEO',
              status: 'ACTIVE',
              uid: firebaseUser.uid,
              createdAt: new Date().toISOString(),
            });
            const bootUser = {
              uid: firebaseUser.uid,
              id: newStaffRef.key,
              name: staffName,
              email: firebaseUser.email || '',
              role: 'CEO',
            };
            sessionStorage.setItem('bkk_session', JSON.stringify(bootUser));
            setCurrentUser(bootUser);
            setLoading(false);
            return;
          }

          const staffData = staffSnap.val();
          const matchedEntry = Object.entries(staffData).find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ([, s]: [string, any]) =>
              authEmail !== '' && normEmail(s?.email) === authEmail
          );

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matched = matchedEntry ? (matchedEntry[1] as any) : null;
          if (!matched || matched.status !== 'ACTIVE') {
            // ไม่รู้จัก หรือถูกพักงาน — ไม่ให้ค้างอยู่ในระบบด้วย role default
            await signOut(auth).catch(() => {});
            sessionStorage.removeItem('bkk_session');
            setCurrentUser(null);
            setLoading(false);
            return;
          }

          const autoUser = {
            uid: firebaseUser.uid,
            id: matchedEntry![0],
            name: matched.name || firebaseUser.displayName || authEmail.split('@')[0],
            email: firebaseUser.email || '',
            role: matched.role || 'STAFF',
            branch: matched.branch || '',
          };
          sessionStorage.setItem('bkk_session', JSON.stringify(autoUser));
          setCurrentUser(autoUser);
        } catch {
          // อ่าน staff ไม่ได้ = ไม่มีสิทธิ์ตาม database rules (เช่น ถูกถอนจาก
          // /admins ตอนพักงาน) — เตะออกเช่นกัน
          await signOut(auth).catch(() => {});
          sessionStorage.removeItem('bkk_session');
          setCurrentUser(null);
        }
      }

      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime suspension guard — เฝ้า status ของ record ตัวเอง ถ้าถูกพักงาน/
  // ถูกลบระหว่างใช้งาน ให้หลุดจากระบบทันที ไม่ต้องรอ token หมดอายุ
  useEffect(() => {
    const staffId = currentUser?.id;
    if (!staffId) return;
    const unsub = onValue(
      ref(db, `staff/${staffId}/status`),
      (snap) => {
        const status = snap.exists() ? String(snap.val()).toUpperCase() : null;
        if (status !== 'ACTIVE') {
          signOut(auth).catch(() => {});
          sessionStorage.removeItem('bkk_session');
          setCurrentUser(null);
        }
      },
      () => {
        // permission denied = สิทธิ์ถูกถอน (ถูกพักงาน) — เตะออกเช่นกัน
        signOut(auth).catch(() => {});
        sessionStorage.removeItem('bkk_session');
        setCurrentUser(null);
      }
    );
    return () => unsub();
  }, [currentUser?.id]);

  const handleLogin = (staffUser: StaffUser) => {
    sessionStorage.setItem('bkk_session', JSON.stringify(staffUser));
    setCurrentUser(staffUser);
  };

  const handleLogout = () => {
    // logout จริง — เซ็นออกจาก Firebase Auth ด้วย ไม่ใช่แค่ล้าง session ใน
    // browser (แบบเดิมบัญชีมาสเตอร์ค้างอยู่ทำให้ "ออกจากระบบ" ไม่เคยออกจริง)
    signOut(auth).catch(() => {});
    sessionStorage.removeItem('bkk_session');
    setCurrentUser(null);
  };

  return { loading, currentUser, handleLogin, handleLogout };
}
