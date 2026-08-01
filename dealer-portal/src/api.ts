// ทุก write ของ portal ผ่าน callable เท่านั้น (rules ปิด client write สนิท)
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { DealerOrderSummary, LotSummary, MyBid, MyLotOrder } from './types';

const call = async <T>(name: string, data?: Record<string, unknown>): Promise<T> => {
  const fn = httpsCallable(functions, name);
  return (await fn(data || {})).data as T;
};

export const listLots = () => call<{ lots: LotSummary[] }>('dealerListLots');

export const getMyBid = (lotId: string) =>
  call<{ bid: MyBid | null; result: 'won' | 'lost' | null; order: MyLotOrder | null }>(
    'dealerGetMyBid',
    { lotId }
  );

export const placeBid = (payload: {
  lotId: string;
  type: 'whole_lot' | 'per_item';
  amount_total?: number;
  item_bids?: Record<string, number>;
  note?: string;
}) => call<{ ok: boolean; bid_no: string; bid_count: number | null }>('dealerPlaceBid', payload);

export const listOrders = () => call<{ orders: DealerOrderSummary[] }>('dealerListOrders');

export const submitPaymentSlip = (orderId: string, slipUrl: string) =>
  call<{ ok: boolean }>('dealerSubmitPaymentSlip', { orderId, slip_url: slipUrl });

export const updateContact = (payload: { contact_name?: string; phone?: string; line_id?: string }) =>
  call<{ ok: boolean }>('dealerUpdateContact', payload);

// ── Team members ──
import type { DealerMemberRole, TeamMember } from './types';

export const listMembers = () => call<{ members: TeamMember[]; max: number }>('dealerListMembers');

export const createMember = (payload: {
  name: string;
  email: string;
  password: string;
  member_role: DealerMemberRole;
}) => call<{ ok: boolean; uid: string }>('dealerMemberCreate', payload);

export const setMemberStatus = (uid: string, status: 'ACTIVE' | 'SUSPENDED') =>
  call<{ ok: boolean }>('dealerMemberSetStatus', { uid, status });

export const resetMemberPassword = (uid: string, password: string) =>
  call<{ ok: boolean }>('dealerMemberResetPassword', { uid, password });

export const deleteMember = (uid: string) => call<{ ok: boolean }>('dealerMemberDelete', { uid });
