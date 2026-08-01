import { ref, get, onValue, type Unsubscribe } from 'firebase/database';
import { db } from '../api/firebase';

export function subscribeToStaff(
  callback: (staff: Record<string, any>[]) => void
): Unsubscribe {
  const staffRef = ref(db, 'staff');
  return onValue(staffRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
      return;
    }
    const data = snapshot.val();
    const list = Object.entries(data).map(([id, val]: [string, any]) => ({
      id,
      ...val,
    }));
    callback(list);
  });
}

export async function getStaffByEmail(email: string) {
  const snapshot = await get(ref(db, 'staff'));
  if (!snapshot.exists()) return null;

  const wanted = email.trim().toLowerCase();
  const data = snapshot.val();
  for (const [id, val] of Object.entries(data) as [string, any][]) {
    // staff records ใช้ status: ACTIVE/INACTIVE (ไม่ใช่ฟิลด์ active) —
    // record เก่าที่ไม่มี status ถือว่ายังใช้งานได้ เทียบอีเมลแบบ normalize
    // ให้เหมือน useStaffSession/lookupStaffByAuth
    const status = String(val.status || '').toUpperCase();
    const active = status === '' || status === 'ACTIVE';
    if (wanted && String(val.email || '').trim().toLowerCase() === wanted && active) {
      return { id, ...val };
    }
  }
  return null;
}

export async function verifyPin(staffId: string, pin: string) {
  const snapshot = await get(ref(db, `staff/${staffId}/pin`));
  if (!snapshot.exists()) return false;
  return snapshot.val() === pin;
}
