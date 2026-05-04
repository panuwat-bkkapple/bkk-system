// Normalize raw job data from RTDB so consumers can rely on shape.
//
// Background: RTDB stores arrays as objects keyed by stringified
// integers. If anything ever writes a non-integer key into an array
// path (multi-path update with a string key, or a manual Firebase
// Console edit), the whole field becomes an object map with mixed
// keys — but consumer code calls .some() / .map() / spread assuming
// Array, and crashes on read.
//
// We hit this with PR #149's first cut of the Store-in KYC + Inspect
// modals: they wrote `qc_logs/${stringKey}` via multi-path update,
// turning qc_logs into a map. The submit handlers were fixed to
// prepend-and-replace the whole array (PR #151), but any tickets
// already corrupted by that earlier write keep crashing every page
// that reads them.
//
// This helper recovers from that — call it at the boundary where you
// load a job from RTDB and the rest of your code can stay simple.

export function normalizeQcLogs(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
}

/** Normalize the array-shaped fields on a raw job snapshot in one call. */
export function normalizeJob<T extends { qc_logs?: unknown }>(raw: T): T & { qc_logs: unknown[] } {
  return { ...raw, qc_logs: normalizeQcLogs(raw.qc_logs) };
}
