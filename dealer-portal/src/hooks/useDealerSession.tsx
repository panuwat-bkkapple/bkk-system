// Session ดีลเลอร์: Firebase Auth (email/password ที่แอดมินออกให้) + เฝ้า
// dealers/{uid} แบบ realtime — ถูกระงับ (SUSPENDED) ปุ๊บ session ที่เปิดค้าง
// โดนเตะออกทันที (ชั้นที่ 3 ของการระงับ — ชั้น 1-2 คือ disable auth + revoke
// tokens ฝั่ง server) แบบเดียวกับ useStaffSession ของแอปแอดมิน
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { auth, db } from '../firebase';
import type { DealerProfile } from '../types';

interface SessionState {
  loading: boolean;
  user: User | null;
  dealer: DealerProfile | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  loading: true,
  user: null,
  dealer: null,
  login: async () => {},
  logout: async () => {},
});

export const useDealerSession = () => useContext(SessionContext);

export const DealerSessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [dealer, setDealer] = useState<DealerProfile | null>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setDealer(null);
        setLoading(false);
      }
    });
    return unsubAuth;
  }, []);

  useEffect(() => {
    if (!user) return;
    // rules: dealers/{uid} self-read เท่านั้น — บัญชีที่ไม่ใช่ดีลเลอร์อ่านไม่ได้/ว่าง
    const unsub = onValue(
      ref(db, `dealers/${user.uid}`),
      (snap) => {
        const profile = snap.val() as DealerProfile | null;
        if (!profile || profile.status !== 'ACTIVE') {
          // ไม่ใช่ดีลเลอร์ / ถูกระงับ → ออกจากระบบทันที
          setDealer(null);
          setLoading(false);
          void signOut(auth);
          return;
        }
        setDealer(profile);
        setLoading(false);
      },
      () => {
        setDealer(null);
        setLoading(false);
        void signOut(auth);
      }
    );
    return unsub;
  }, [user]);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <SessionContext.Provider value={{ loading, user, dealer, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
};
