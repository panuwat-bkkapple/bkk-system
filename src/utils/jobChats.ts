// src/utils/jobChats.ts
//
// Job chat messages live at /job_chats/{jobId} — OUTSIDE the job row — so
// the conversation stops inflating every read of /jobs (lists, schedulers,
// other repos). Mirrored in bkk-rider-app/src/utils/jobChats.ts and read
// inline by bkk-frontend-next's RiderChatModal; keep the three in sync.
//
// Transition rules (until the move-chats migration has run and stale PWA
// clients have refreshed):
//   - READ both paths merged: legacy embedded jobs/{id}/chats + /job_chats
//   - WRITE to /job_chats; if rules for it aren't deployed yet the write is
//     denied — fall back to the legacy path so chat never goes down
//   - Unread badges read jobs/{id}/chat_flags (maintained by the
//     onJobChatMessageV2 / onChatMessageCreated cloud functions); the reader
//     clears its own flag when it opens the conversation
import { ref, onValue, push, update } from 'firebase/database';
import { db } from '../api/firebase';

export type ChatMap = Record<string, any>;

/** Subscribe to the merged (legacy + current) chat map for a job. */
export const subscribeJobChats = (
  jobId: string,
  cb: (chats: ChatMap) => void
) => {
  let legacy: ChatMap = {};
  let current: ChatMap = {};
  const emit = () => cb({ ...legacy, ...current });

  const unsubLegacy = onValue(
    ref(db, `jobs/${jobId}/chats`),
    (snap) => { legacy = snap.val() || {}; emit(); },
    () => emit()
  );
  const unsubCurrent = onValue(
    ref(db, `job_chats/${jobId}`),
    (snap) => { current = snap.val() || {}; emit(); },
    () => emit()
  );
  return () => { unsubLegacy(); unsubCurrent(); };
};

/** Send a message to the canonical path, legacy fallback if rules lag. */
export const sendJobChatMessage = async (jobId: string, message: ChatMap) => {
  try {
    await push(ref(db, `job_chats/${jobId}`), message);
  } catch {
    await push(ref(db, `jobs/${jobId}/chats`), message);
  }
};

/**
 * Mark every unread message from `sender` as read (on whichever path each
 * message lives) and clear the job's unread flag for that sender.
 */
export const markJobChatsRead = (
  jobId: string,
  chats: ChatMap,
  sender: string,
  legacyChats: ChatMap = {}
) => {
  for (const [key, msg] of Object.entries(chats)) {
    if (!msg || msg.sender !== sender || msg.read) continue;
    const path = legacyChats[key]
      ? `jobs/${jobId}/chats/${key}`
      : `job_chats/${jobId}/${key}`;
    update(ref(db, path), { read: true }).catch(() => {});
  }
  update(ref(db, `jobs/${jobId}/chat_flags`), {
    [`unread_from_${sender.toLowerCase()}`]: false,
  }).catch(() => {});
};

/** Badge helper: unread flag with legacy embedded-chats fallback. */
export const hasUnreadFrom = (job: any, sender: string): boolean => {
  if (job?.chat_flags?.[`unread_from_${sender.toLowerCase()}`]) return true;
  return !!(
    job?.chats &&
    Object.values(job.chats).some((c: any) => c.sender === sender && !c.read)
  );
};
