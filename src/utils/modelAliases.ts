// ชื่อเรียกทั่วไปอัตโนมัติ — 1 รุ่นมี 3 ชื่อ: ชื่อทางการที่ Apple ประกาศ (name)
// + ชื่อที่คนทั่วไปเรียกภาษาไทย (alias_th) + ภาษาอังกฤษ (alias_en).
// generator นี้แปลงชื่อทางการเป็นชื่อเรียกด้วยกติกาคงที่ ใช้โดยปุ่ม
// "เติมชื่อเรียกอัตโนมัติ" ใน PriceEditor (เติมเฉพาะรุ่นที่ยังว่าง ไม่ทับของที่
// แอดมินแก้เอง) — คนอ่าน alias: chat-ai.js rankModels + ช่องค้นหาเว็บลูกค้า
// (hero + /sell) จับคู่แบบ substring จากทุกชื่อรวมกัน

// iPad Air ยุคใหม่ตั้งชื่อตามชิป แต่ลูกค้าเรียกตามเลขรุ่น (ข้อเท็จจริง Apple:
// M2=รุ่น 6, M3=รุ่น 7, M4=รุ่น 8) — mirror กับ IPAD_AIR_GEN_BY_CHIP ใน
// functions/chat-ai.js
const AIR_GEN: Record<string, string> = { M2: '6', M3: '7', M4: '8' };

const TH_WORDS: [string, string][] = [
  ['Apple Watch', 'แอปเปิ้ลวอทช์'],
  ['MacBook', 'แมคบุ๊ค'],
  ['Mac mini', 'แมคมินิ'],
  ['Mac Pro', 'แมคโปร'],
  ['iMac', 'ไอแมค'],
  ['iPhone', 'ไอโฟน'],
  ['iPad', 'ไอแพด'],
  ['Galaxy', 'กาแลคซี่'],
  ['Pro Max', 'โปรแม็กซ์'],
  ['Pro', 'โปร'],
  ['Max', 'แม็กซ์'],
  ['Plus', 'พลัส'],
  ['Ultra', 'อัลตร้า'],
  ['mini', 'มินิ'],
  ['Air', 'แอร์'],
  ['Series', 'ซีรีส์'],
  ['Generation', 'เจน'],
  ['Neo', 'นีโอ'],
  ['Touch Bar', 'ทัชบาร์'],
  ['Retina', 'เรติน่า'],
];
// คำไทยเขียนติดกันในจุดที่อังกฤษมีช่องว่าง
const TH_JOINS: [string, string][] = [
  ['ไอแพด แอร์', 'ไอแพดแอร์'], ['ไอแพด มินิ', 'ไอแพดมินิ'], ['ไอแพด โปร', 'ไอแพดโปร'],
  ['แมคบุ๊ค แอร์', 'แมคบุ๊คแอร์'], ['แมคบุ๊ค โปร', 'แมคบุ๊คโปร'], ['แมคบุ๊ค นีโอ', 'แมคบุ๊คนีโอ'],
  ['โปร แม็กซ์', 'โปรแม็กซ์'],
];

const dedupeParts = (s: string) =>
  Array.from(new Set(s.split(',').map((p) => p.trim()).filter(Boolean))).join(', ');

export function englishAlias(name: string): string {
  const s = String(name || '')
    .replace(/["()]/g, ' ')
    .replace(/ชิป/g, ' ')
    .replace(/รุ่นที่/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const extras: string[] = [];
  const airChip = /iPad Air/i.test(s) ? s.match(/\bM([234])\b/) : null;
  if (airChip && AIR_GEN['M' + airChip[1]]) extras.push(`iPad Air ${AIR_GEN['M' + airChip[1]]}`);
  const gen = String(name).match(/Generation\s+(\d+)/i);
  if (gen) extras.push(`iPad Gen ${gen[1]}`);
  const mini = String(name).match(/iPad mini.*?(\d+)/);
  if (mini) extras.push(`iPad mini ${mini[1]}`);
  return dedupeParts([s, ...extras].join(', '));
}

export function thaiAlias(name: string): string {
  let s = englishAlias(name);
  for (const [en, th] of TH_WORDS) s = s.split(en).join(th);
  for (const [a, b] of TH_JOINS) s = s.split(a).join(b);
  return dedupeParts(s.replace(/\s+/g, ' ').trim());
}

export function generateModelAliases(name: string): { alias_th: string; alias_en: string } {
  return { alias_th: thaiAlias(name), alias_en: englishAlias(name) };
}
