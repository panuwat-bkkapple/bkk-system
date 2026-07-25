// src/hooks/useDatabase.ts
//
// Shared keep-alive subscription per path. The old implementation attached
// one onValue per mounted component and detached it on unmount, so any
// navigation that dropped the last listener on a path (e.g. entering /pos
// or /dispatcher, which live outside the persistent layouts) forced the SDK
// to re-download the entire node from the server. RTDB bills by GB
// downloaded, and /jobs is the biggest node in the system, so every one of
// those re-downloads was real money.
//
// Now the first mount for a path attaches a single module-level listener
// that is never detached; every component subscribes to the in-memory store
// instead. The SDK keeps the node synced via deltas for the lifetime of the
// tab, so a full download happens once per app load, not per navigation.
import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../api/firebase';
import { normalizeQcLogs } from '../utils/jobNormalizer';

type Snapshot = { data: any[]; loading: boolean; error: string | null };
type Store = Snapshot & {
  subscribers: Set<(snap: Snapshot) => void>;
  attached: boolean;
};

const stores = new Map<string, Store>();

const getStore = (path: string): Store => {
  let store = stores.get(path);
  if (!store) {
    store = { data: [], loading: true, error: null, subscribers: new Set(), attached: false };
    stores.set(path, store);
  }
  return store;
};

const emit = (store: Store) => {
  const snap: Snapshot = { data: store.data, loading: store.loading, error: store.error };
  store.subscribers.forEach((fn) => fn(snap));
};

const attach = (path: string, store: Store) => {
  if (store.attached) return;
  store.attached = true;

  // For the `jobs` path, qc_logs is supposed to be an array. RTDB
  // returns it as an object map if any string key ever ended up in
  // there (multi-path update mistake, manual console edit, etc.) —
  // and consumers that call .some / .map on it then crash. Normalize
  // once here so every caller of useDatabase('jobs') gets a stable
  // shape without each having to re-check.
  const isJobsPath = path === 'jobs';

  onValue(
    ref(db, path),
    (snapshot) => {
      const val = snapshot.val();
      if (val) {
        store.data = Object.entries(val).map(([id, itemData]: [string, any]) => {
          const base = { id, ...itemData };
          if (isJobsPath && itemData && 'qc_logs' in itemData) {
            return { ...base, qc_logs: normalizeQcLogs(itemData.qc_logs) };
          }
          return base;
        });
      } else {
        store.data = [];
      }
      store.loading = false;
      store.error = null;
      emit(store);
    },
    (err) => {
      // Rules-denied reads (e.g. listener attached before login, or after
      // logout) cancel the server listener — mark detached so the next
      // mount retries instead of leaving the store dead forever.
      store.attached = false;
      store.error = err.message;
      store.loading = false;
      emit(store);
    }
  );
};

export const useDatabase = (path: string) => {
  const [snap, setSnap] = useState<Snapshot>(() => {
    const store = getStore(path);
    return { data: store.data, loading: store.loading, error: store.error };
  });

  useEffect(() => {
    const store = getStore(path);
    attach(path, store);
    const listener = (s: Snapshot) => setSnap(s);
    store.subscribers.add(listener);
    // Re-sync in case the store changed between render and this effect,
    // or the hook was re-run with a different path.
    listener({ data: store.data, loading: store.loading, error: store.error });
    return () => {
      store.subscribers.delete(listener);
    };
  }, [path]);

  return snap;
};
