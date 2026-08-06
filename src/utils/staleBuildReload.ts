// กู้ตัวเองเมื่อ chunk ของ build เก่าหายไปหลัง deploy
//
// อาการ: แท็บที่เปิดค้างไว้ถือ index.html ของ build เก่า ซึ่งอ้างถึงไฟล์ใน
// /assets/ ตามชื่อที่มี hash. พอ deploy ใหม่ Firebase Hosting เปลี่ยนชื่อไฟล์
// แล้วลบของเก่าทิ้ง — พอผู้ใช้กดเข้าหน้าที่เป็น lazy route เบราว์เซอร์ไปขอ
// ไฟล์ที่ไม่มีอยู่แล้วได้ 404 กลับมา แล้ว dynamic import ก็ reject
//
// ทางแก้เดียวที่ได้ผลคือโหลดหน้าใหม่ให้ได้ index.html ฉบับล่าสุด — การ
// re-render ไม่ช่วยเพราะมันไปเรียกไฟล์เดิมที่ตายแล้วซ้ำ
//
// **กัน loop เป็นเรื่องสำคัญ** ถ้าโหลดใหม่แล้วยังพัง แปลว่าไม่ใช่เรื่อง deploy
// (เช่นไฟล์นั้นหายไปจริงๆ หรือเน็ตพัง) การ reload ต่อไปเรื่อยๆ จะกลายเป็น
// หน้าจอกะพริบที่ผู้ใช้ทำอะไรไม่ได้เลย — แย่กว่าการเห็น error เสียอีก

const RELOAD_KEY = 'stale_build_reloaded_at';
const RELOAD_COOLDOWN_MS = 60_000;

/** error นี้คือ "โค้ดหน้าเว็บเก่ากว่าที่ server มี" ใช่หรือไม่ */
export function isStaleChunkError(error: unknown): boolean {
  const msg = String((error as Error)?.message || error || '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Loading chunk \S+ failed/i.test(msg)
  );
}

/**
 * โหลดหน้าใหม่ถ้ายังไม่ได้ทำไปเมื่อกี้ — คืน true เมื่อสั่ง reload แล้ว
 * (ผู้เรียกจะได้รู้ว่าไม่ต้องโชว์ error ให้เห็นแวบหนึ่งก่อนหน้าจะรีเฟรช)
 */
export function reloadForStaleBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage ใช้ไม่ได้ (โหมดส่วนตัวบางเบราว์เซอร์) — ยอมเสี่ยง
    // reload รอบเดียวดีกว่าปล่อยให้ผู้ใช้ค้างอยู่กับหน้าที่กดอะไรไม่ได้
  }
  window.location.reload();
  return true;
}

/**
 * ดัก event ที่ Vite ยิงเมื่อโหลด chunk ไม่สำเร็จ — จับได้ก่อนที่ error จะ
 * ไปโผล่เป็นหน้าจอแดง จึงกู้คืนได้เงียบๆ โดยผู้ใช้แทบไม่รู้ตัว
 */
export function installStaleBuildRecovery() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    console.warn('[staleBuild] chunk preload failed — reloading for the current build');
    reloadForStaleBuild();
  });
}
