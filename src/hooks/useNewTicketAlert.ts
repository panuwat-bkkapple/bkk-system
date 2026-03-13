import { useEffect, useRef, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../api/firebase';

interface NewTicketInfo {
  id: string;
  model: string;
  price: number;
  status: string;
  cust_name: string;
  receive_method: string;
  created_at: number;
}

interface UseNewTicketAlertOptions {
  onNewTicket?: (ticket: NewTicketInfo) => void;
  enabled?: boolean;
}

/**
 * Hook สำหรับตรวจจับ ticket ใหม่แบบ real-time
 * - เล่นเสียงแจ้งเตือน
 * - แสดง Browser Notification
 * - เรียก callback เพื่อแสดง toast
 */
export const useNewTicketAlert = ({ onNewTicket, enabled = true }: UseNewTicketAlertOptions) => {
  const knownJobIds = useRef<Set<string>>(new Set());
  const isInitialLoad = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // สร้าง notification sound ด้วย Web Audio API (ไม่ต้องพึ่ง file ภายนอก)
  const playNotificationSound = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;

      const ctx = new AudioContext();

      // เสียงแจ้งเตือน 2 tone (เหมือน LINE notification)
      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      playTone(880, now, 0.15);        // A5
      playTone(1108.73, now + 0.15, 0.15); // C#6
      playTone(1318.51, now + 0.3, 0.25);  // E6
    } catch {
      // Audio not supported
    }
  }, []);

  // แสดง Browser Notification
  const showBrowserNotification = useCallback((ticket: NewTicketInfo) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const isB2B = ticket.status === 'New B2B Lead';
    const title = isB2B ? '📦 New B2B Ticket!' : '📱 Ticket ใหม่เข้ามา!';
    const price = ticket.price ? `฿${Number(ticket.price).toLocaleString()}` : '';
    const body = `${ticket.model} ${price}${ticket.cust_name ? ` - ${ticket.cust_name}` : ''}${ticket.receive_method ? ` (${ticket.receive_method})` : ''}`;

    const notif = new Notification(title, {
      body,
      icon: '/vite.svg',
      badge: '/vite.svg',
      tag: `ticket-${ticket.id}`,
      requireInteraction: true,
    });

    notif.onclick = () => {
      window.focus();
      window.location.href = '/tickets';
      notif.close();
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const jobsRef = ref(db, 'jobs');
    const unsub = onValue(jobsRef, (snap) => {
      if (!snap.exists()) return;

      const data = snap.val();
      const currentIds = new Set(Object.keys(data));

      if (isInitialLoad.current) {
        // โหลดครั้งแรก → เก็บ ID ที่มีอยู่แล้วไว้ ไม่แจ้งเตือน
        knownJobIds.current = currentIds;
        isInitialLoad.current = false;
        return;
      }

      // หา ID ใหม่ที่ไม่เคยเห็น
      const newIds = [...currentIds].filter(id => !knownJobIds.current.has(id));

      for (const id of newIds) {
        const job = data[id];
        // เฉพาะ ticket ที่เป็น New Lead หรือ New B2B Lead
        if (job && (job.status === 'New Lead' || job.status === 'New B2B Lead')) {
          const ticketInfo: NewTicketInfo = {
            id,
            model: job.model || 'ไม่ระบุรุ่น',
            price: job.price || 0,
            status: job.status,
            cust_name: job.cust_name || '',
            receive_method: job.receive_method || '',
            created_at: job.created_at || Date.now(),
          };

          // 1. เล่นเสียง
          playNotificationSound();

          // 2. Browser Notification (สำหรับเมื่อ tab อื่นอยู่)
          showBrowserNotification(ticketInfo);

          // 3. Callback สำหรับ Toast (in-app)
          onNewTicket?.(ticketInfo);
        }
      }

      // อัปเดต known IDs
      knownJobIds.current = currentIds;
    });

    return () => unsub();
  }, [enabled, onNewTicket, playNotificationSound, showBrowserNotification]);
};
