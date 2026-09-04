// สถานะของคำขอ (ใบลา / เปลี่ยนกะ) — แยกออกจากไฟล์คอมโพเนนต์เพราะสองหน้าใช้
// ร่วมกัน และไฟล์ที่ export ทั้งคอมโพเนนต์และค่าคงที่ทำให้ fast refresh พัง
export const STATUS_LABEL: Record<string, string> = {
  pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิกแล้ว',
};

export const STATUS_TONE: Record<string, string> = {
  pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: 'grey',
};
