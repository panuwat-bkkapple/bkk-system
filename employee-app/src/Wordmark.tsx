import { APP_NAME } from './appName';

/** ชื่อแอปบนจอ — ครึ่งหลังทาสีต่างจากครึ่งแรกตามต้นฉบับ
 *  รวมไว้ที่เดียวเพื่อให้เปลี่ยนสีตามพื้น (เข้ม/สว่าง) ได้โดยไม่ต้องก๊อปสตริง */
export default function Wordmark({ className = '' }: { className?: string }) {
  const cut = 3; // "get" | "mobie"
  return (
    <span className={`wordmark ${className}`.trim()}>
      {APP_NAME.slice(0, cut)}<span>{APP_NAME.slice(cut)}</span>
    </span>
  );
}
