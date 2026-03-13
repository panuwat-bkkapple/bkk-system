// src/hooks/useDatabase.ts
import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../api/firebase';

export const useDatabase = (path: string) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // รีเซ็ตสถานะทุกครั้งที่มีการเปลี่ยน path
    setLoading(true);
    setError(null);
    
    const dbRef = ref(db, path);
    
    // onValue รับ Parameter 3 ตัว: (Reference, SuccessCallback, ErrorCallback)
    const unsubscribe = onValue(
      dbRef, 
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Object.entries(val).map(([id, itemData]: [string, any]) => ({
            id,
            ...itemData,
          }));
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