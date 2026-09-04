// ใครล็อกอินอยู่ — บางมาก เพราะ "เป็นพนักงานคนไหน" เป็นคำตอบของ server
// (`requireEmployeeCaller`) ไม่ใช่ของหน้าเว็บ
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';

export function useEmployeeSession() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setReady(true);
  }), []);

  return { user, ready, logout: () => signOut(auth) };
}
