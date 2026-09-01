// hook เดียวที่หน้าจอทุกหน้าใช้ถามว่า "จ่ายเงินออกได้ไหม" + บันทึก audit
//
// คืน guard() ตัวเดียวแทนที่จะคืน boolean เปล่า เพราะทุกจุดที่เงินออกต้อง
// **บันทึกความพยายามเสมอ ทั้งที่ผ่านและถูกปฏิเสธ** — boolean เปล่าเปิดช่องให้
// call site ลืม log ครึ่งหนึ่ง แล้ว audit trail จะเห็นแค่ด้านที่สำเร็จ

import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, getIdTokenResult } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db, app } from '../api/firebase';
import { useAuth } from './useAuth';
import {
  evaluateFinanceGate,
  FINANCE_CLAIM_KEY,
  FINANCE_ENFORCE_PATH,
  FINANCE_ACTION_LABEL,
  type FinanceAction,
} from '../utils/financeGate';

type GuardInput = { refId?: string | null; amount?: number | null };

export function useFinanceGate() {
  const { currentUser } = useAuth();
  const [hasClaim, setHasClaim] = useState(false);
  const [enforce, setEnforce] = useState(false);

  // claim อ่านจาก ID token ที่ Firebase เซ็น — ไม่อ่านจาก sessionStorage
  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setHasClaim(false); return; }
      try {
        const token = await getIdTokenResult(user);
        setHasClaim(token.claims?.[FINANCE_CLAIM_KEY] === true);
      } catch {
        // อ่าน token ไม่ได้ = ถือว่าไม่มี claim (fail closed ฝั่ง claim) แต่ช่วง
        // dual-read ยังผ่านทาง legacy ได้อยู่ จึงไม่ทำให้ใครทำงานไม่ได้วันนี้
        setHasClaim(false);
      }
    });
  }, []);

  useEffect(() => {
    return onValue(
      ref(db, FINANCE_ENFORCE_PATH),
      (snap) => setEnforce(snap.val() === true),
      // อ่าน flag ไม่ได้ = ยังไม่บังคับ (ตรงกับ default ของช่วง dual-read)
      () => setEnforce(false),
    );
  }, []);

  const verdict = evaluateFinanceGate({ role: currentUser?.role, hasClaim, enforce });

  /**
   * เรียกก่อนทำ action เงินออกทุกครั้ง — คืน true เมื่อทำต่อได้
   * บันทึก audit ฝั่ง server เสมอ (fire-and-forget: การจ่ายเงินที่ถูกต้องต้อง
   * ไม่ล้มเพราะ log ไม่ผ่าน แต่การถูกปฏิเสธเราหยุดที่นี่อยู่แล้ว)
   */
  const guard = useCallback(
    (action: FinanceAction, input: GuardInput = {}) => {
      const v = evaluateFinanceGate({ role: currentUser?.role, hasClaim, enforce });
      try {
        const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminFinanceAudit');
        void fn({
          action,
          allowed: v.allowed,
          reason: v.reason,
          refId: input.refId ?? null,
          amount: input.amount ?? null,
        }).catch(() => {});
      } catch {
        // ignore — audit ไม่ใช่เงื่อนไขของการจ่ายเงิน
      }
      return v;
    },
    [currentUser?.role, hasClaim, enforce],
  );

  return {
    /** ใช้ซ่อน/ปิดปุ่มล่วงหน้า — การตัดสินจริงอยู่ที่ guard() ตอนกด */
    canDisburse: verdict.allowed,
    enforce,
    hasClaim,
    guard,
    actionLabel: FINANCE_ACTION_LABEL,
  };
}
