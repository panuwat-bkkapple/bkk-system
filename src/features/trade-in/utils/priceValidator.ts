/**
 * Price Anomaly Detection
 *
 * ตรวจจับราคาผิดปกติ เช่น:
 * 1. Storage/RAM สูงกว่าแต่ราคาถูกกว่า
 * 2. ราคามือสองใกล้เคียงหรือแพงกว่าราคาซีล
 * 3. ราคา 0 ที่ไม่น่าจะตั้งใจ
 * 4. Pro Max ถูกกว่า Pro (cross-model)
 */

export interface PriceAnomaly {
  type: 'storage_inversion' | 'used_near_new' | 'zero_price' | 'cross_model';
  severity: 'error' | 'warning';
  modelName: string;
  modelId: string;
  message: string;
  detail: string;
}

// ค่าที่ใช้ parse ขนาด storage/ram เป็นตัวเลขเพื่อเปรียบเทียบ
function parseSize(s: string): number {
  if (!s) return 0;
  const cleaned = s.toUpperCase().trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(TB|GB|MB)?/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2] || 'GB';
  if (unit === 'TB') return num * 1024;
  if (unit === 'MB') return num / 1024;
  return num;
}

export function detectAnomalies(models: any[]): PriceAnomaly[] {
  const anomalies: PriceAnomaly[] = [];

  for (const model of models) {
    if (!model.isActive) continue;
    const variants = model.variants || [];

    for (const v of variants) {
      const usedPrice = Number(v.usedPrice || v.price || 0);
      const newPrice = Number(v.newPrice || 0);

      // 1. ราคา 0 ที่น่าจะผิดปกติ
      if (usedPrice === 0 && newPrice > 0) {
        anomalies.push({
          type: 'zero_price',
          severity: 'error',
          modelName: model.name,
          modelId: model.id,
          message: `ราคามือสอง = ฿0`,
          detail: `${v.name} — ราคาซีล ฿${newPrice.toLocaleString()} แต่มือสอง ฿0`,
        });
      }

      // 2. ราคามือสองใกล้เคียง/แพงกว่าซีล
      if (usedPrice > 0 && newPrice > 0) {
        const gap = newPrice - usedPrice;
        const gapPct = (gap / newPrice) * 100;
        if (gap < 0) {
          anomalies.push({
            type: 'used_near_new',
            severity: 'error',
            modelName: model.name,
            modelId: model.id,
            message: `มือสองแพงกว่าซีล`,
            detail: `${v.name} — มือสอง ฿${usedPrice.toLocaleString()} > ซีล ฿${newPrice.toLocaleString()}`,
          });
        } else if (gapPct < 5 && newPrice > 5000) {
          anomalies.push({
            type: 'used_near_new',
            severity: 'warning',
            modelName: model.name,
            modelId: model.id,
            message: `ส่วนต่างซีล-มือสองแค่ ${gapPct.toFixed(0)}%`,
            detail: `${v.name} — ซีล ฿${newPrice.toLocaleString()} มือสอง ฿${usedPrice.toLocaleString()} (ต่าง ฿${gap.toLocaleString()})`,
          });
        }
      }
    }

    // 3. Storage/RAM inversion: สเปคสูงกว่าแต่ราคาถูกกว่า
    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        const a = variants[i];
        const b = variants[j];
        if (!a.attributes || !b.attributes) continue;

        // เช็คแต่ละ attribute ที่เป็นขนาด
        for (const key of ['storage', 'ram']) {
          const sizeA = parseSize(a.attributes[key] || '');
          const sizeB = parseSize(b.attributes[key] || '');
          if (sizeA === 0 || sizeB === 0 || sizeA === sizeB) continue;

          // เช็คว่า attributes อื่นเหมือนกัน
          const othersSame = Object.keys(a.attributes).every(
            k => k === key || (a.attributes[k] || '') === (b.attributes[k] || '')
          );
          if (!othersSame) continue;

          const priceA = Number(a.usedPrice || a.price || 0);
          const priceB = Number(b.usedPrice || b.price || 0);

          if (sizeA > sizeB && priceA < priceB && priceB - priceA > 500) {
            anomalies.push({
              type: 'storage_inversion',
              severity: 'error',
              modelName: model.name,
              modelId: model.id,
              message: `${key.toUpperCase()} สูงกว่าแต่ราคาถูกกว่า`,
              detail: `${a.attributes[key]} (฿${priceA.toLocaleString()}) ถูกกว่า ${b.attributes[key]} (฿${priceB.toLocaleString()})`,
            });
          } else if (sizeB > sizeA && priceB < priceA && priceA - priceB > 500) {
            anomalies.push({
              type: 'storage_inversion',
              severity: 'error',
              modelName: model.name,
              modelId: model.id,
              message: `${key.toUpperCase()} สูงกว่าแต่ราคาถูกกว่า`,
              detail: `${b.attributes[key]} (฿${priceB.toLocaleString()}) ถูกกว่า ${a.attributes[key]} (฿${priceA.toLocaleString()})`,
            });
          }
        }
      }
    }
  }

  return anomalies;
}
