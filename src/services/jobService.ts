import { ref, get, update, onValue, type Unsubscribe } from 'firebase/database';
import { db } from '../api/firebase';

export function getJob(id: string) {
  return get(ref(db, `jobs/${id}`)).then((snapshot) => {
    if (!snapshot.exists()) return null;
    return { id: snapshot.key, ...snapshot.val() };
  });
}

export function subscribeToJob(
  id: string,
  callback: (job: Record<string, any> | null) => void
): Unsubscribe {
  const jobRef = ref(db, `jobs/${id}`);
  return onValue(jobRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }
    callback({ id: snapshot.key, ...snapshot.val() });
  });
}

export function updateJobStatus(
  jobId: string,
  status: string,
  qcLog?: Record<string, any>
) {
  const updates: Record<string, any> = {
    [`jobs/${jobId}/status`]: status,
    [`jobs/${jobId}/updatedAt`]: Date.now(),
  };

  if (qcLog) {
    const logKey = Date.now().toString();
    updates[`jobs/${jobId}/qcLogs/${logKey}`] = qcLog;
  }

  return update(ref(db), updates);
}

export function updateJobFields(jobId: string, fields: Record<string, any>) {
  return update(ref(db, `jobs/${jobId}`), {
    ...fields,
    updatedAt: Date.now(),
  });
}
