// src/hooks/useNow.ts
//
// "ตอนนี้กี่โมง" สำหรับ render — เรียก Date.now() ตรงๆ ระหว่าง render ไม่ได้
// (react-hooks/purity) และ setState ใน effect ก็ถูก lint ห้ามเช่นกัน จึงให้เวลา
// เป็น external store ที่เดินเองนาทีละครั้ง: ป้าย "N นาทีที่แล้ว" บนจอจะขยับตาม
// โดยไม่ต้องรีเฟรช และ component ที่ใช้ไม่ต้องรู้ว่าเวลามาจากไหน
//
// timer เริ่มเมื่อมีคน subscribe คนแรกและหยุดเมื่อคนสุดท้ายออก — ไม่ทิ้ง interval
// ค้างไว้ในเทส/ตอนไม่มีใครดู
import { useSyncExternalStore } from 'react';

const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let nowValue = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    nowValue = Date.now();
    timer = setInterval(() => {
      nowValue = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getNow = () => nowValue;

/** เวลาปัจจุบัน (ms) ที่อัปเดตนาทีละครั้งขณะมีคนใช้ — ใช้แทน Date.now() ใน render */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}
