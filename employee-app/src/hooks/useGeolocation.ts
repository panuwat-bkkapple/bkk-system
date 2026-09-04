// อ่านตำแหน่งจากเครื่อง — ทุกการตัดสินว่า "ใช้ได้ไหม" อยู่ที่ `geo.ts` (ล้วน)
// ไฟล์นี้แค่ต่อสายกับเบราว์เซอร์
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoErrorCode, GeoFix } from '../geo';

interface State {
  supported: boolean;
  secureContext: boolean;
  permission: 'granted' | 'denied' | 'prompt' | null;
  fix: GeoFix | null;
  error: GeoErrorCode | null;
}

const ERROR_CODE: Record<number, GeoErrorCode> = {
  1: 'denied',
  2: 'unavailable',
  3: 'timeout',
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
  });
  const watchId = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  // **`navigator.permissions` เป็น null ได้จริง** (บางเบราว์เซอร์ / บาง origin)
  // การเรียก `.query()` ตรงๆ ทำให้ทั้งหน้าพังเข้า error boundary ไม่ใช่แค่
  // ฟีเจอร์นี้พัง — เคสจริงที่เคยเจอในเว็บลูกค้า จึงต้องมี `?.` เสมอ
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

  useEffect(() => {
    if (!supported) return;
    const ok = (pos: GeolocationPosition) => setState((p) => ({
      ...p,
      error: null,
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
    const fail = (err: GeolocationPositionError) => setState((p) => ({
      ...p,
      error: ERROR_CODE[err.code] || 'unavailable',
    }));

    watchId.current = navigator.geolocation.watchPosition(ok, fail, {
      enableHighAccuracy: true,
      // ไม่รับค่าจากแคชเลย — งานนี้ต้องการ "อยู่ตรงนี้ตอนนี้"
      maximumAge: 0,
      timeout: 20000,
    });
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [supported, tick]);

  const retry = useCallback(() => {
    setState((p) => ({ ...p, error: null }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, retry };
}
