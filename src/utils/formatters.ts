// src/utils/formatters.ts

// ฟังก์ชันแปลงตัวเลขเป็นเงินบาท (มีลูกน้ำและ ฿)
export const formatCurrency = (amount: number | string): string => {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(value)) return '฿0';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
  }).format(value);
};

// ฟังก์ชันแปลงวันที่
export const formatDate = (timestamp: number | string): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// ฟังก์ชันสร้างเลข Ref No.
export const generateRefNo = (prefix: 'JOB' | 'PAY' | 'TXN' = 'TXN'): string => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomStr = Math.floor(1000 + Math.random() * 9000).toString();
  return `${prefix}-${dateStr}-${randomStr}`;
};