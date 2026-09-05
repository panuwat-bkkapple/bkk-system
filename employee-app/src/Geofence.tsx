/**
 * รั้วพิกัดแบบวาดเอง — วงสาขา + จุดของเรา + วงความคลาดเคลื่อน
 *
 * **ทำไมไม่ใช่แผนที่จริง** — ดีไซน์ต้นทางวางกล่องที่เขียนว่า `MAP PLACEHOLDER ·
 * geofence 120 m` ไว้ตรงนี้ คำถามที่ภาพนี้ต้องตอบมีสองข้อเท่านั้น: *อยู่ในรั้ว
 * หรือยัง* กับ *ห่างอีกเท่าไร* ซึ่งวาดเองตอบได้ครบ ไม่ต้องโหลด Maps JS ทุกครั้ง
 * ที่เปิดแอป (คิดเงินต่อการโหลด และเป็นภาพที่ไม่เปลี่ยนคำตอบ) และไม่ต้องมีคีย์
 * ที่ล็อก referrer ไว้กับโดเมนอื่น
 *
 * **ทิศเป็นทิศจริง ระยะถูกบีบสเกล** — ถ้าวาดตามสัดส่วนจริง คนที่ห่าง 2 กม.
 * จะเห็นจุดของตัวเองอยู่นอกกรอบ (หรือวงสาขาเล็กจนมองไม่เห็น) จึงบีบด้วย
 * log แล้ว **พิมพ์ตัวเลขระยะจริงกำกับไว้เสมอ** — ภาพเป็นตัวช่วยอ่าน ไม่ใช่
 * แหล่งความจริง
 */
export default function Geofence({ distanceM, radiusM, accuracyM, bearingDeg, inRange }: {
  distanceM: number;
  radiusM: number;
  accuracyM: number;
  bearingDeg: number;
  inRange: boolean;
}) {
  const size = 168;
  const c = size / 2;
  const rFence = 52;

  // สเกลระยะ: ในรั้ว = ตามสัดส่วนจริง · นอกรั้ว = บีบด้วย log จนถึงขอบกรอบ
  const safeRadius = Math.max(1, radiusM);
  const ratio = distanceM / safeRadius;
  const rDot = ratio <= 1
    ? rFence * ratio
    : Math.min(c - 12, rFence + 22 * Math.log10(1 + (ratio - 1) * 9));

  const rad = ((bearingDeg - 90) * Math.PI) / 180;
  const x = c + rDot * Math.cos(rad);
  const y = c + rDot * Math.sin(rad);
  // วงความคลาดเคลื่อนใช้สเกลเดียวกับในรั้ว เพื่อให้เทียบกับวงสาขาได้ตรงๆ
  const rAcc = Math.max(4, Math.min(46, (accuracyM / safeRadius) * rFence));

  return (
    <div className="geofence">
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" aria-hidden="true">
        <circle cx={c} cy={c} r={rFence} className={inRange ? 'fence ok' : 'fence'} />
        <circle cx={c} cy={c} r={3.5} className="site" />
        <circle cx={x} cy={y} r={rAcc} className="acc" />
        <circle cx={x} cy={y} r={5} className={inRange ? 'me ok' : 'me'} />
      </svg>
      <div className="geolabel">
        <b>{inRange ? 'อยู่ในพื้นที่' : 'อยู่นอกพื้นที่'}</b>
        <span>ห่าง {Math.round(distanceM).toLocaleString('th-TH')} ม. · รั้ว {radiusM} ม.</span>
      </div>
    </div>
  );
}
