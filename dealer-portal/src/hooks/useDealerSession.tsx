// Session ดีลเลอร์รองรับ team members:
//   - login ด้วยบัญชีหลักของร้าน (dealers/{uid}) → role OWNER โดยอัตโนมัติ
//   - login ด้วยบัญชีสมาชิก (dealer_members/{uid} → company_id) → อ่านโปรไฟล์ร้าน
//     ผ่าน dealers/{company_id} (rules อนุญาตสมาชิกของร้าน)
// เฝ้าสถานะ realtime ทั้งสองชั้น: สมาชิกถูกระงับ/ร้านถูกระงับ = เตะออกทันที
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { auth, db } from '../firebase';
import type { DealerMemberRole, DealerProfile } from '../types';

interface SessionState {
  loading: boolean;
  user: User | null;
  dealer: DealerProfile | null;
  /** id ของร้าน (= uid บัญชีหลัก) — key ของซอง/ออเดอร์ทั้งหมด */
  companyId: string | null;
  /** role ของคน login: บัญชีหลัก = OWNER */
  memberRole: DealerMemberRole;
  /** ชื่อคนที่ login (สมาชิก) หรือชื่อผู้ติดต่อร้าน (บัญชีหลัก) */
  memberName: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  loading: true,
  user: null,
  dealer: null,
  companyId: null,
  memberRole: 'OWNER',
  memberName: null,
  login: async () => {},
  logout: async () => {},
});

export const useDealerSession = () => useContext(SessionContext);

type Membership =
  | { kind: 'unknown' }
  | { kind: 'root' } // ไม่มี membership record → บัญชีหลักของร้าน
  | { kind: 'member'; companyId: string; role: DealerMemberRole; name: string | null };

export const DealerSessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<Membership>({ kind: 'unknown' });
  const [dealer, setDealer] = useState<DealerProfile | null>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setMembership({ kind: 'unknown' });
      if (!u) {
        setDealer(null);
        setLoading(false);
      }
    });
    return unsubAuth;
  }, []);

  // ชั้นที่ 1: ใครคือคนนี้ — สมาชิกทีม หรือบัญชีหลักของร้าน
  useEffect(() => {
    if (!user) return;
    const unsub = onValue(
      ref(db, `dealer_members/${user.uid}`),
      (snap) => {
        const m = snap.val();
        if (!m) {
          setMembership({ kind: 'root' });
          return;
        }
        if (String(m.status || '').toUpperCase() !== 'ACTIVE' || !m.company_id) {
          // สมาชิกถูกระงับ → ออกทันที
          setMembership({ kind: 'unknown' });
          setDealer(null);
          setLoading(false);
          void signOut(auth);
          return;
        }
        setMembership({
          kind: 'member',
          companyId: String(m.company_id),
          role: (String(m.member_role || 'STAFF').toUpperCase() as DealerMemberRole) || 'STAFF',
          name: m.name || null,
        });
      },
      () => {
        setMembership({ kind: 'root' });
      }
    );
    return unsub;
  }, [user]);

  // ชั้นที่ 2: โปรไฟล์ร้าน (ตาม companyId ที่ resolve ได้)
  const companyId =
    membership.kind === 'member' ? membership.companyId : membership.kind === 'root' ? user?.uid || null : null;

  useEffect(() => {
    if (!user || !companyId) return;
    const unsub = onValue(
      ref(db, `dealers/${companyId}`),
      (snap) => {
        const profile = snap.val() as DealerProfile | null;
        if (!profile || profile.status !== 'ACTIVE') {
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
  }, [user, companyId]);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const memberRole: DealerMemberRole = membership.kind === 'member' ? membership.role : 'OWNER';
  const memberName =
    membership.kind === 'member' ? membership.name : dealer?.contact_name || dealer?.company_name || null;

  return (
    <SessionContext.Provider value={{ loading, user, dealer, companyId, memberRole, memberName, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
};
