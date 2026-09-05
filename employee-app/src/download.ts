/**
 * เปิดไฟล์ที่ callable ส่งกลับมาเป็น base64
 *
 * **แปลงเป็น blob แล้วเปิด ไม่ใช่ `data:` URL ยาวๆ** — iOS Safari ปฏิเสธ
 * `data:` URL ที่ยาวเกินและปฏิเสธการนำทางไป data: จากการกดปุ่ม ส่วน blob: ใช้ได้
 * ทั้งสองฝั่ง และเราคุมการคืนหน่วยความจำเองได้
 *
 * **ไม่มีที่ไหนได้ URL ของ Storage โดยตรง** — ไฟล์ทั้งหมดมาผ่าน callable ที่
 * ตรวจสิทธิ์แล้ว จึงไม่มีลิงก์ที่หลุดออกไปแล้วยังเปิดได้
 */
export function openPayload(p: { filename: string; content_type: string; base64: string }): void {
  const bin = atob(p.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: p.content_type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = p.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ปล่อยช้าหน่อย — บางเบราว์เซอร์ยังอ่าน blob อยู่ตอน click กลับมา
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
