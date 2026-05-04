// src/hooks/useDatabase.ts
import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../api/firebase';
import { normalizeQcLogs } from '../utils/jobNormalizer';

export const useDatabase = (path: string) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // รีเซ็ตสถานะทุกครั้งที่มีการเปลี่ยน path
    setLoading(true);
    setError(null);

    const dbRef = ref(db, path);

    // For the `jobs` path, qc_logs is supposed to be an array. RTDB
    // returns it as an object map if any string key ever ended up in
    // there (multi-path update mistake, manual console edit, etc.) —
    // and consumers that call .some / .map on it then crash. Normalize
    // once here so every caller of useDatabase('jobs') gets a stable
    // shape without each having to re-check.
    const isJobsPath = path === 'jobs';

    // onValue รับ Parameter 3 ตัว: (Reference, SuccessCallback, ErrorCallback)
    const unsubscribe = onValue(
      dbRef,
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Object.entries(val).map(([id, itemData]: [string, any]) => {
            const base = { id, ...itemData };
            if (isJobsPath && itemData && 'qc_logs' in itemData) {
              return { ...base, qc_logs: normalizeQcLogs(itemData.qc_logs) };
            }
            return base;
          });
          setData(list);
        } else {
          setData([]);
        }
        setLoading(false);
      },
      (err) => {
        // 🌟 ดักจับ Error ตรงนี้! ถ้าโดน Rules บล็อก มันจะเด้งมาหาฟังก์ชันนี้ครับ
        setError(err.message);
        setLoading(false); // 🛑 สั่งหยุดหมุนโหลดดิ้งทันที!
      }
    );

    return () => unsubscribe();
  }, [path]);

  return { data, loading, error };
};