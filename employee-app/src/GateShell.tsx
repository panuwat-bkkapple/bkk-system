import type { ReactNode } from 'react';

/** จอเต็มหน้าจอทุกใบของแอป (ล็อกอิน · สิทธิ์ตำแหน่ง · ถามตัวตนไม่สำเร็จ · กำลังโหลด)
 *
 * **มีเจ้าของที่เดียวโดยตั้งใจ** — สามจอนี้เคยเขียนเปลือกของตัวเองซ้ำกันคนละไฟล์
 * ซึ่งเป็นรูปเดียวกับที่ทำให้ช่องวันที่หลุดรอบสอง (แก้หน้าเดียว อีกหน้ายังพัง)
 * และเป็นเหตุผลที่ `AppHeader` ถูกแยกออกมา: ของที่ต้องวัดสีจริงต้อง SSR ได้
 * ไฟล์นี้จึงห้าม import Firebase ไม่ว่ากรณีใด
 */
export default function GateShell({ icon, brand, title, detail, children, foot }: {
  icon?: ReactNode;
  /** ชื่อแอปข้างโลโก้ — ใส่เฉพาะจอที่ยังไม่รู้ว่าใครใช้อยู่ (ล็อกอิน) */
  brand?: string;
  title: string;
  detail?: string;
  children?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="gate">
      <div className="inner">
        {icon || brand ? (
          <div className="brand">
            {icon ? <div className="mark">{icon}</div> : null}
            {brand ? <div className="name">{brand}</div> : null}
          </div>
        ) : null}
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
        {children}
        {foot ? <div className="foot">{foot}</div> : null}
      </div>
    </div>
  );
}
