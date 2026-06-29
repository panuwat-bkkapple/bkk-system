import { useEffect } from 'react';

// iOS standalone PWA loses touch responsiveness after returning from a native
// sheet (photo/file picker, share sheet) OR after the WebView is resumed from
// background — taps silently stop registering until the app is relaunched
// (the "ปุ่มกดไม่ได้ ต้องปัดทิ้งเปิดใหม่" bug; reproducible by attaching a slip
// in the transfer modal, which opens the iOS photo picker).
//
// Forcing WebKit to rebuild its hit-test tree re-arms touch WITHOUT a reload,
// so open modals / attached files survive. Toggling body `pointer-events` for
// one frame targets hit-testing directly and — unlike a transform/scroll/
// display reflow — changes no layout and can't disturb the position:fixed
// overlays the app uses for modals.
export function kickIosTouch(): void {
  if (typeof document === 'undefined') return;
  const b = document.body;
  const prev = b.style.pointerEvents;
  b.style.pointerEvents = 'none';
  void b.offsetHeight; // flush the style change
  requestAnimationFrame(() => {
    b.style.pointerEvents = prev;
    void b.offsetHeight;
  });
}

const isStandalonePwa = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true);

// Mount once high in the tree (MobileLayout). Re-arms touch whenever the PWA
// regains focus / visibility — which is exactly when it returns from a native
// picker or from being backgrounded.
export function useIosPwaTouchRecovery(): void {
  useEffect(() => {
    if (!isStandalonePwa()) return;
    const onFocus = () => kickIosTouch();
    const onVisible = () => {
      if (document.visibilityState === 'visible') kickIosTouch();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
