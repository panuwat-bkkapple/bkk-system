import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get, push, set } from 'firebase/database';
import { auth, db } from '../api/firebase';

// =============================================================================
// Staff session — the sessionStorage('bkk_session') + Firebase-auth auto-login
// flow extracted VERBATIM from App.tsx so the standalone chat app (chat.html →
// ChatApp) shares the exact same login semantics. One implementation, two
// entry points — never fork this logic per app.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StaffUser = any;

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
          let role = 'STAFF';
          let staffName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Admin';
          // staff push key — admin_fcm_tokens และ role-targeted push ฝั่ง
          // functions (staffIdsByRoles) ใช้ key นี้ ไม่ใช่ Firebase uid
          let staffId: string | null = null;
          const authEmail = (firebaseUser.email || '').trim().toLowerCase();

          if (staffSnap.exists()) {
            const staffData = staffSnap.val();
            const matchedEntry = Object.entries(staffData).find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ([, s]: [string, any]) =>
                String(s?.email || '').trim().toLowerCase() === authEmail &&
                authEmail !== '' &&
                s?.status === 'ACTIVE'
            );
            if (matchedEntry) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const matched = matchedEntry[1] as any;
              staffId = matchedEntry[0];
              role = matched.role || 'STAFF';
              staffName = matched.name || staffName;
            }
          } else {
            // Database is empty - bootstrap first user as CEO
            const newStaffRef = push(ref(db, 'staff'));
            await set(newStaffRef, {
              name: staffName,
              email: authEmail,
              role: 'CEO',
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
            });
            role = 'CEO';
            staffId = newStaffRef.key;
          }

          const autoUser = {
            uid: firebaseUser.uid,
            ...(staffId ? { id: staffId } : {}),
            name: staffName,
            email: firebaseUser.email || '',
            role,
          };
          sessionStorage.setItem('bkk_session', JSON.stringify(autoUser));
          setCurrentUser(autoUser);
        } catch {
          // Auto-login role fetch failed
        }
      }

      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (staffUser: StaffUser) => {
    sessionStorage.setItem('bkk_session', JSON.stringify(staffUser));
    setCurrentUser(staffUser);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('bkk_session');
    setCurrentUser(null);
  };

  return { loading, currentUser, handleLogin, handleLogout };
}
