// src/utils/firebaseRetry.ts
// Retry utility สำหรับ Firebase operations ที่อาจล้มเหลวจาก network

/**
 * Retry wrapper สำหรับ Firebase write operations
 * ลองใหม่สูงสุด 3 ครั้ง ด้วย exponential backoff (1s, 2s, 4s)
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // ไม่ retry ถ้าเป็น permission error (จะไม่หายเอง)
      if (error?.code === 'PERMISSION_DENIED') throw error;

      // ครั้งสุดท้ายแล้ว ไม่ต้อง wait
      if (attempt === maxRetries) break;

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
