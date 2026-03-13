import { ref, push } from 'firebase/database';
import { db } from '../api/firebase'; // เช็ค Path ให้ถูกต้อง

export const sendNotification = async (title: string, message: string, type: 'info' | 'success' | 'warning' = 'info') => {
  try {
    const notiRef = ref(db, 'notifications');
    await push(notiRef, {
      title,
      message,
      type,
      read: false,
      timestamp: Date.now()
    });
  } catch (error) {
    // silently handled
  }
};