// อ่านตำแหน่งจากเครื่อง — ทุกการตัดสินว่า "ใช้ได้ไหม" อยู่ที่ `geo.ts` (ล้วน)
// ไฟล์นี้แค่ต่อสายกับเบราว์เซอร์
//
// ─── กติกาข้อเดียวที่สำคัญที่สุดของไฟล์นี้ (บทเรียน 5 ก.ย. 2569) ───────────
// **คำขอตำแหน่งครั้งแรกต้องมาจากการแตะของผู้ใช้** — iOS Safari (โดยเฉพาะตอน
// ติดตั้งเป็นแอปบนหน้าจอโฮม) จะ**ไม่ขึ้นกล่องถาม**ให้กับคำขอที่เกิดตอนหน้าโหลด
// และตอบ `PERMISSION_DENIED` ทันที ผลคือแอปขึ้นจอ "ต้องอนุญาตให้เข้าถึงตำแหน่ง"
// ทั้งที่ผู้ใช้ไม่เคยถูกถามเลยสักครั้ง — เกิดขึ้นจริงบนเครื่องเจ้าของงาน
//
// ดังนั้น: `watchPosition` เริ่มเองได้**เฉพาะเมื่อรู้แน่ว่าได้สิทธิ์แล้ว**
// (Permissions API ตอบ `granted`) นอกนั้นรอให้ผู้ใช้แตะปุ่มก่อนเสมอ
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoErrorCode, GeoFix } from '../geo';

interface State {
  supported: boolean;
  secureContext: boolean;
  permission: 'granted' | 'denied' | 'prompt' | null;
  fix: GeoFix | null;
  error: GeoErrorCode | null;
  asked: boolean;
}

const ERROR_CODE: Record<number, GeoErrorCode> = {
  1: 'denied',
  2: 'unavailable',
  3: 'timeout',
};

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // ไม่รับค่าจากแคชเลย — งานนี้ต้องการ "อยู่ตรงนี้ตอนนี้"
  maximumAge: 0,
  timeout: 20000,
};

export function useGeolocation() {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [state, setState] = useState<State>({
    supported,
    // `isSecureContext` เป็น false บน http — geolocation จะมีอยู่แต่ error เสมอ
    // ซึ่งอ่านออกยากมากถ้าไม่แยกเคสนี้ออกมาบอกตรงๆ
    secureContext: typeof window !== 'undefined' ? window.isSecureContext !== false : true,
    permission: null,
    fix: null,
    error: null,
    asked: false,
  });
  const watchId = useRef<number | null>(null);
  const [watching, setWatching] = useState(false);

  const onFix = useCallback((pos: GeolocationPosition) => {
    setState((p) => ({
      ...p,
      error: null,
      asked: true,
      fix: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
        // `pos.timestamp` คือเวลาที่ *เครื่อง* บอก ซึ่งอาจตั้งเองไว้ผิด — ใช้
        // `Date.now()` ของตอนรับค่าแทน เพราะที่เราต้องการรู้คือ "ค่านี้เพิ่ง
        // มาถึงเมื่อไหร่" ไม่ใช่ "เครื่องคิดว่าตอนนั้นกี่โมง"
        at: Date.now(),
      },
    }));
  }, []);

  const onFail = useCallback((err: GeolocationPositionError) => {
    setState((p) => ({ ...p, error: ERROR_CODE[err.code] || 'unavailable' }));
  }, []);

  // **`navigator.permissions` เป็น null ได้จริง** (บางเบราว์เซอร์ / บาง origin)
  // การเรียก `.query()` ตรงๆ ทำให้ทั้งหน้าพังเข้า error boundary ไม่ใช่แค่
  // ฟีเจอร์นี้พัง — เคสจริงที่เคยเจอในเว็บลูกค้า จึงต้องมี `?.` เสมอ
  //
  // Safari ไม่รองรับ `geolocation` ใน Permissions API เลย (query จะ reject)
  // = ค่านี้เป็น `null` ตลอดบน iOS ซึ่งแปลว่า **เส้นทางปกติของ iOS คือเส้นทาง
  // ที่ต้องแตะปุ่ม** ไม่ใช่เส้นทางพิเศษ
  useEffect(() => {
    let alive = true;
    navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (!alive) return;
        const apply = () => setState((p) => ({ ...p, permission: s.state as State['permission'] }));
        apply();
        s.onchange = apply;
      })
      .catch(() => { /* ไม่มี API = ไม่รู้สถานะ ซึ่งไม่ใช่การถูกปฏิเสธ */ });
    return () => { alive = false; };
  }, []);

  // เคยให้สิทธิ์ไว้แล้ว = เริ่มติดตามได้เองโดยไม่ต้องให้แตะซ้ำทุกครั้งที่เปิดแอป
  // (เส้นทางของ Android/เดสก์ท็อป ซึ่ง Permissions API ตอบได้จริง)
  useEffect(() => {
    if (state.permission === 'granted' && !watching) setWatching(true);
  }, [state.permission, watching]);

  useEffect(() => {
    if (!supported || !watching) return;
    watchId.current = navigator.geolocation.watchPosition(onFix, onFail, OPTIONS);
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [supported, watching, onFix, onFail]);

  /**
   * ขอตำแหน่ง — **ต้องเรียกจาก event ของการแตะเท่านั้น**
   *
   * เรียก `getCurrentPosition` ก่อน เพราะมันคือคำขอที่ iOS ยอมขึ้นกล่องถามให้
   * แล้วค่อยเปิด `watchPosition` ต่อเมื่อได้สิทธิ์แล้ว
   */
  const request = useCallback(() => {
    if (!supported) return;
    setState((p) => ({ ...p, error: null, asked: true }));
    navigator.geolocation.getCurrentPosition(
      (pos) => { onFix(pos); setWatching(true); },
      onFail,
      OPTIONS,
    );
  }, [supported, onFix, onFail]);

  return { ...state, request };
}
