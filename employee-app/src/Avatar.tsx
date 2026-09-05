import { initialsOf } from './avatarText';

/** รูปโปรไฟล์พนักงาน — มีเจ้าของที่เดียวเพราะมีคนวาดหลายที่ และเคสที่พลาดง่าย
 *  คือ **ไม่มีรูป** ซึ่งเป็นค่าปกติของระบบนี้ */
export default function Avatar({ name, photoUrl, size = 44 }: {
  name: string; photoUrl?: string | null; size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.34) };
  if (photoUrl) return <img className="avatar" style={style} src={photoUrl} alt="" />;
  return <div className="avatar" style={style} aria-hidden="true">{initialsOf(name)}</div>;
}
