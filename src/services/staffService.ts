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

  const data = snapshot.val();
  for (const [id, val] of Object.entries(data) as [string, any][]) {
    if (val.email === email && val.active !== false) {
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
