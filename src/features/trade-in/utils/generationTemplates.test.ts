import { describe, it, expect } from 'vitest';
import {
  classifyIphoneGeneration,
  buildGenerationGroups,
  buildFunctionalScreeningGroups,
  applyGenerationToGroups,
  planGenerationApply,
  ipadBoxDeducts,
  iphoneBoxDeducts,
  macBareDeviceDeduct,
} from './generationTemplates';

describe('classifyIphoneGeneration', () => {
  const cases: [string, string | null][] = [
    ['iPhone 17', 'latest'],
    ['iPhone 17 Air', 'latest'],
    ['iPhone 17 Pro Max', 'latest'],
    ['iPhone 17e', 'latest'],
    ['iPhone 16 Pro Max', 'recent'],
    ['iPhone 16', 'recent'],
    ['iPhone 15 Pro', 'mid'],
    ['iPhone 14 Plus', 'mid'],
    ['iPhone 13 mini', 'old'],
    ['iPhone 12', 'old'],
    ['iPhone 11 Pro Max', 'old'],
    ['iPhone SE (2022)', 'old'],
    ['iPhone XS Max', 'old'],
    ['iPhone X', 'old'],
    ['iPhone 8 Plus', 'old'],
    ['iPad Pro 11" (ชิป M4, 2024)', 'ipad_new'],
    ['iPad Pro 13" (ชิป M5, 2025)', 'ipad_new'],
    ['iPad Air 13" (ชิป M3, 2025)', 'ipad_new'],
    ['iPad mini รุ่นที่ 7 (ชิป A17 Pro)', 'ipad_new'],
    ['iPad Generation 11', 'ipad_new'],
    ['iPad Generation 10', 'ipad_old'],
    ['iPad Pro 12.9" (ชิป M2, 2022)', 'ipad_old'],
    ['iPad Pro 11" (2020)', 'ipad_old'],
    ['iPad Air (2013)', 'ipad_old'],
    ['iPad mini 6 (2021)', 'ipad_old'],
    ['MacBook Air 13" (Intel, 2020)', 'mac_intel'],
    ['MacBook Pro 13" (2019)', 'mac_intel'],
    ['MacBook Air M1 (2020)', 'mac_mid'],
    ['MacBook Air M2 (2022)', 'mac_mid'],
    ['MacBook Pro 14" M3 (2023)', 'mac_new'],
    ['MacBook Pro 16" M4 Pro', 'mac_new'],
    ['MacBook Air (2021)', 'mac_mid'],
    ['iMac 24" M3 (2023)', 'mac_imac'],
    ['Mac mini M4 (2024)', 'mac_desktop'],
    ['Mac Studio M2 Max', 'mac_desktop'],
    ['Mac Pro (2023)', 'mac_desktop'],
    ['Apple Watch Series 10', null],
    ['Apple Pencil Pro', null],
  ];
  it('reads the chip from variant processor attributes when the name has none', () => {
    expect(classifyIphoneGeneration({
      name: 'MacBook Pro 14"',
      variants: [{ attributes: { processor: 'Apple M4 Pro' } }],
    })).toBe('mac_new');
    expect(classifyIphoneGeneration({
      name: 'MacBook Pro 13"',
      variants: [{ attributes: { processor: 'Intel Core i5' } }],
    })).toBe('mac_intel');
  });
  for (const [name, tier] of cases) {
    it(`${name} -> ${tier}`, () => {
      expect(classifyIphoneGeneration({ name })).toBe(tier);
    });
  }
});

describe('buildGenerationGroups', () => {
  it('materializes screen + body + battery + warranty + region groups with baked EN labels', () => {
    const groups = buildGenerationGroups('latest');
    expect(groups.map((g: any) => g.title)).toEqual(['สุขภาพแบตเตอรี่', 'สภาพจอภาพและกระจก', 'สภาพตัวเครื่องและฝาหลัง', 'ประกัน', 'ประเทศที่ซื้อ', 'ประวัติการซ่อม', 'อุปกรณ์เสริมที่นำมาด้วย']);
    for (const g of groups) {
      expect(g.title_en, `title_en of ${g.title}`).toBeTruthy();
      for (const o of g.options) expect(o.label_en, `label_en of ${o.label}`).toBeTruthy();
    }
  });
  it('ids are deterministic so re-builds are byte-identical (idempotency)', () => {
    expect(JSON.stringify(buildGenerationGroups('recent'))).toBe(JSON.stringify(buildGenerationGroups('recent')));
  });
  it('cosmetic percentages tier inversely with model age (cheaper device, higher pct)', () => {
    const screenLight = (tier: any) =>
      buildGenerationGroups(tier).find((g: any) => g.title === 'สภาพจอภาพและกระจก')!.options[1].pct;
    expect(screenLight('latest')).toBe(3);
    expect(screenLight('recent')).toBe(4);
    expect(screenLight('mid')).toBe(6);
    expect(screenLight('old')).toBe(10);
  });
  it('cracked-but-working screens deduct heavily per generation, never reject', () => {
    const cracked = (tier: any) =>
      buildGenerationGroups(tier)
        .find((g: any) => g.title === 'สภาพจอภาพและกระจก')!
        .options.find((o: any) => o.label === 'จอแตก/ร้าว');
    // Anchored to real Apple TH repair pricing (iPhone 17 screen = ฿12,499 on a
    // ~฿22,000 device) + competitor benchmarks — see PR #436.
    expect(cracked('latest').pct).toBe(55);
    expect(cracked('recent').pct).toBe(60);
    expect(cracked('mid').pct).toBe(65);
    expect(cracked('old').pct).toBe(70);
    expect(cracked('ipad_new').pct).toBe(60);
    expect(cracked('ipad_old').pct).toBe(70);
    for (const tier of ['latest', 'recent', 'mid', 'old', 'ipad_new', 'ipad_old']) {
      expect(cracked(tier).failBehavior, tier).toBe('deduct');
    }
  });
  it('worn-battery deduct follows the price-band policy (<20k -> 20%, 20-30k -> 15%)', () => {
    const worstBattery = (tier: any) => {
      const opts = buildGenerationGroups(tier).find((g: any) => g.title === 'สุขภาพแบตเตอรี่')!.options;
      return opts[opts.length - 1].pct;
    };
    expect(worstBattery('old')).toBe(20);
    expect(worstBattery('mid')).toBe(15);
    expect(worstBattery('recent')).toBe(15);
  });
  it('battery renders as a screening topic (kind functional, deduct bands coloured honestly)', () => {
    for (const tier of ['latest', 'recent', 'mid', 'old', 'ipad_new', 'ipad_old']) {
      const g = buildGenerationGroups(tier as any).find((x: any) => x.title === 'สุขภาพแบตเตอรี่')!;
      expect(g.kind, tier).toBe('functional');
      // Every deducting band carries failBehavior 'deduct'; none reject.
      for (const o of g.options) {
        if (o.pct > 0) expect(o.failBehavior, `${tier}:${o.label}`).toBe('deduct');
        expect(o.failBehavior, `${tier}:${o.label}`).not.toBe('reject');
      }
    }
  });
  it('recent tier warranty never deducts; latest tier does', () => {
    const warranty = (tier: 'latest' | 'recent') =>
      buildGenerationGroups(tier).find((g: any) => g.title === 'ประกัน')!.options;
    expect(warranty('recent').every((o: any) => !(o.pct > 0) && !(o.deduct > 0))).toBe(true);
    expect(warranty('latest').some((o: any) => o.pct > 0)).toBe(true);
  });
});

const makeSet = () => ({
  id: 'set1',
  name: 'iPhone 15',
  groups: [
    { id: 'g1', title: 'เปิดเครื่อง / ใช้งานทั่วไป', kind: 'functional', options: [{ id: 'o1', label: 'ปกติ', deduct: 0 }] },
    { id: 'g2', title: 'แบตเตอรี่', kind: 'functional', options: [{ id: 'o2', label: 'ปกติ', deduct: 0 }, { id: 'o3', label: 'แบตเตอรี่เสื่อม', failBehavior: 'reject' }] },
    { id: 'g3', title: 'สภาพหน้าจอ', options: [{ id: 'o4', label: 'สวยมาก ไม่มีรอย', deduct: 0 }] },
    { id: 'g4', title: 'สถานะการรับประกัน (Warranty)', options: [{ id: 'o5', label: 'มีประกัน', deduct: 0 }] },
    { id: 'g5', title: 'รหัสโมเดล (Model Identifier)', options: [{ id: 'o6', label: 'ศูนย์ไทย (ZP/A)', deduct: 0 }] },
    { id: 'g6', title: 'อุปกรณ์เสริมที่นำมาด้วย', options: [{ id: 'o7', label: 'ครบกล่อง', deduct: 0 }] },
  ],
});

const IPHONE_SCREENING_TITLES = [
  'เปิดเครื่อง / ใช้งานทั่วไป',
  'การแสดงผล + ทัชสกรีน',
  'กล้องหน้า / กล้องหลัง',
  'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)',
  'ลำโพง / ไมโครโฟน',
];

describe('buildFunctionalScreeningGroups', () => {
  it('materializes the standard screening minus battery, with baked EN labels', () => {
    const groups = buildFunctionalScreeningGroups('mid');
    expect(groups.map((g: any) => g.title)).toEqual(IPHONE_SCREENING_TITLES);
    for (const g of groups) {
      expect(g.kind).toBe('functional');
      expect(g.title_en, `title_en of ${g.title}`).toBeTruthy();
      expect(g.description, `description of ${g.title}`).toBeTruthy();
      for (const o of g.options) {
        expect(o.label_en, `label_en of ${o.label}`).toBeTruthy();
        expect(o.description, `description of ${o.label}`).toBeTruthy();
      }
    }
  });
  it('cracked-but-working glass counts as ปกติ (points customers at the cosmetic topic)', () => {
    const display = buildFunctionalScreeningGroups('latest').find((g: any) => g.title === 'การแสดงผล + ทัชสกรีน')!;
    expect(display.options[0].description).toContain('แม้กระจกจะมีรอยหรือแตก');
  });
  it('ipad tiers use the ipad screening template', () => {
    const titles = buildFunctionalScreeningGroups('ipad_old').map((g: any) => g.title);
    expect(titles).toContain('Wi-Fi / Bluetooth / สัญญาณ');
    expect(titles).not.toContain('แบตเตอรี่');
  });
});

describe('applyGenerationToGroups', () => {
  it('normalizes screening + replaces every standard topic in place', () => {
    const { groups, removedTitles } = applyGenerationToGroups(makeSet().groups, 'mid');
    expect(removedTitles).toEqual(['เปิดเครื่อง / ใช้งานทั่วไป', 'แบตเตอรี่', 'สภาพหน้าจอ', 'สถานะการรับประกัน (Warranty)', 'รหัสโมเดล (Model Identifier)', 'อุปกรณ์เสริมที่นำมาด้วย']);
    expect(groups.map((g: any) => g.title)).toEqual([
      ...IPHONE_SCREENING_TITLES,
      'สุขภาพแบตเตอรี่', 'สภาพจอภาพและกระจก',
      'สภาพตัวเครื่องและฝาหลัง', 'ประกัน', 'ประเทศที่ซื้อ', 'ประวัติการซ่อม',
      'อุปกรณ์เสริมที่นำมาด้วย',
    ]);
  });
  it('keeps custom topics untouched in place', () => {
    const withCustom = [
      ...makeSet().groups,
      { id: 'g9', title: 'สภาพเลนส์กล้องพิเศษ', options: [{ id: 'o9', label: 'ปกติ', deduct: 0 }] },
    ];
    const { groups } = applyGenerationToGroups(withCustom, 'mid');
    expect(groups[groups.length - 1].id).toBe('g9');
  });
  it('the old functional battery screen is folded into the single pricing battery group', () => {
    const { groups } = applyGenerationToGroups(makeSet().groups, 'mid');
    expect(groups.filter((g: any) => /แบต/.test(g.title))).toHaveLength(1);
  });
  it('a repair-history group mis-tagged kind functional is replaced, never dropped', () => {
    const withRepair = [
      ...makeSet().groups,
      { id: 'g7', title: 'ประวัติการซ่อม', kind: 'functional', options: [{ id: 'o8', label: 'ไม่เคยซ่อม', deduct: 0 }] },
    ];
    const { groups } = applyGenerationToGroups(withRepair, 'mid');
    expect(groups.filter((g: any) => g.title === 'ประวัติการซ่อม')).toHaveLength(1);
    // The canonical replacement keeps the reject option for non-genuine repairs.
    const repair = groups.find((g: any) => g.title === 'ประวัติการซ่อม')!;
    expect(repair.options.some((o: any) => o.failBehavior === 'reject')).toBe(true);
  });
  it('a box group mis-tagged kind functional is replaced by the canonical box topic, never dropped', () => {
    const withBox = makeSet().groups.map((g: any) =>
      g.id === 'g6' ? { ...g, kind: 'functional' } : g);
    const { groups } = applyGenerationToGroups(withBox, 'mid');
    const boxes = groups.filter((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].options.map((o: any) => o.label)).toContain('ครบกล่อง (เครื่อง+สาย+กล่อง)');
  });
  it('prepends screening and appends deduction groups when the set had neither', () => {
    const bare = [{ id: 'g1', title: 'กันรอยติดมาให้', options: [] }];
    const { groups } = applyGenerationToGroups(bare, 'old');
    expect(groups.map((g: any) => g.title)).toEqual([
      ...IPHONE_SCREENING_TITLES,
      'กันรอยติดมาให้',
      'สุขภาพแบตเตอรี่', 'สภาพจอภาพและกระจก', 'สภาพตัวเครื่องและฝาหลัง', 'ประกัน', 'ประเทศที่ซื้อ', 'ประวัติการซ่อม', 'อุปกรณ์เสริมที่นำมาด้วย',
    ]);
  });
});

describe('ipadBoxDeducts (นโยบายค่าหักกล่องราย line ของ iPad)', () => {
  const cases: [string, { missingBox: number; bareDevice: number } | null][] = [
    ['iPad Air 4 (2020)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad Air 5 (ชิป M1, 2022)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad Air 11" (ชิป M2, 2024)', { missingBox: 1000, bareDevice: 1500 }],
    ['iPad Air 13" (ชิป M3, 2025)', { missingBox: 1000, bareDevice: 1500 }],
    [' iPad Air 11" (ชิป M4, 2026)', { missingBox: 1000, bareDevice: 1500 }],
    ['iPad Pro 11" (ชิป M1, 2021)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad Pro 12.9" (ชิป M2, 2022)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad Pro 13" (ชิป M4, 2024)', { missingBox: 1000, bareDevice: 1500 }],
    ['iPad Pro 11" (ชิป M5, 2025)', { missingBox: 1000, bareDevice: 1500 }],
    ['iPad Generation 10', { missingBox: 500, bareDevice: 800 }],
    ['iPad Generation 11', { missingBox: 500, bareDevice: 1000 }],
    // นอกตาราง -> กันไว้ที่ 500/1,000 (นโยบายเจ้าของร้าน: ห้ามปล่อย 0)
    ['iPad Air 3 (2019)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad Air (2013)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad Pro 12.9" (2020)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad mini รุ่นที่ 7 (ชิป A17 Pro)', { missingBox: 500, bareDevice: 1000 }],
    ['iPad Generation 9', { missingBox: 500, bareDevice: 1000 }],
    ['iPhone 15 Pro', null],
  ];
  for (const [name, expected] of cases) {
    it(`${name.trim()} -> ${expected ? `${expected.missingBox}/${expected.bareDevice}` : 'default 0'}`, () => {
      expect(ipadBoxDeducts(name)).toEqual(expected);
    });
  }
  it('applyGenerationToGroups overlays the box deducts for a policy model', () => {
    const { groups } = applyGenerationToGroups([], 'ipad_new', 'iPad Pro 13" (ชิป M4, 2024)');
    const box = groups.find((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย')!;
    const byLabel = (re: RegExp) => box.options.find((o: any) => re.test(o.label))!;
    expect(byLabel(/^ครบกล่อง/).deduct).toBe(0);
    expect(byLabel(/^ขาดกล่อง/).deduct).toBe(1000);
    expect(byLabel(/^เครื่องเปล่า/).deduct).toBe(1500);
  });
  it('unlisted iPads get the 500/1000 floor and stay idempotent', () => {
    const { groups } = applyGenerationToGroups([], 'ipad_old', 'iPad mini 5 (2019)');
    const box = groups.find((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย')!;
    expect(box.options.find((o: any) => /^ขาดกล่อง/.test(o.label))!.deduct).toBe(500);
    expect(box.options.find((o: any) => /^เครื่องเปล่า/.test(o.label))!.deduct).toBe(1000);
    const again = applyGenerationToGroups(groups, 'ipad_old', 'iPad mini 5 (2019)');
    expect(JSON.stringify(again.groups)).toBe(JSON.stringify(groups));
  });
});

describe('iphoneBoxDeducts (นโยบายค่าหักกล่องของ iPhone)', () => {
  const cases: [string, { missingBox: number; bareDevice: number } | null][] = [
    ['iPhone 17 Pro Max', { missingBox: 500, bareDevice: 1000 }],
    ['iPhone 17e', { missingBox: 500, bareDevice: 1000 }],
    ['iPhone 16 Pro', { missingBox: 500, bareDevice: 800 }],
    ['iPhone 15', { missingBox: 500, bareDevice: 800 }],
    ['iPhone 14 Pro Max', { missingBox: 300, bareDevice: 500 }],
    ['iPhone 13 mini', { missingBox: 300, bareDevice: 500 }],
    ['iPhone SE (2022)', { missingBox: 300, bareDevice: 500 }],
    ['iPhone XS Max', { missingBox: 300, bareDevice: 500 }],
    ['iPhone 8 Plus', { missingBox: 300, bareDevice: 500 }],
    ['iPad Air 4 (2020)', null],
    ['MacBook Air M2 (2022)', null],
  ];
  for (const [name, expected] of cases) {
    it(`${name} -> ${expected ? `${expected.missingBox}/${expected.bareDevice}` : 'ไม่ใช่ iPhone'}`, () => {
      expect(iphoneBoxDeducts(name)).toEqual(expected);
    });
  }
  it('applyGenerationToGroups overlays iPhone box deducts and stays idempotent', () => {
    const { groups } = applyGenerationToGroups([], 'latest', 'iPhone 17 Pro Max');
    const box = groups.find((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย')!;
    expect(box.options.find((o: any) => /^ครบกล่อง/.test(o.label))!.deduct).toBe(0);
    expect(box.options.find((o: any) => /^ขาดกล่อง/.test(o.label))!.deduct).toBe(500);
    expect(box.options.find((o: any) => /^เครื่องเปล่า/.test(o.label))!.deduct).toBe(1000);
    const mid = applyGenerationToGroups([], 'mid', 'iPhone 14 Plus');
    const midBox = mid.groups.find((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย')!;
    expect(midBox.options.find((o: any) => /^ขาดกล่อง/.test(o.label))!.deduct).toBe(300);
    expect(midBox.options.find((o: any) => /^เครื่องเปล่า/.test(o.label))!.deduct).toBe(500);
    const again = applyGenerationToGroups(groups, 'latest', 'iPhone 17 Pro Max');
    expect(JSON.stringify(again.groups)).toBe(JSON.stringify(groups));
  });
});

describe('Mac tiers', () => {
  it('mac_new carries battery/screen/body/warranty/keyboard-region/repair/box in order', () => {
    const groups = buildGenerationGroups('mac_new');
    expect(groups.map((g: any) => g.title)).toEqual([
      'สุขภาพแบตเตอรี่', 'สภาพจอภาพและกระจก', 'สภาพตัวเครื่อง (บอดี้)', 'ประกัน',
      'ประเทศที่ซื้อ + คีย์บอร์ด', 'ประวัติการซ่อม', 'อุปกรณ์เสริมที่นำมาด้วย',
    ]);
    for (const g of groups) {
      expect(g.title_en, `title_en of ${g.title}`).toBeTruthy();
      for (const o of g.options) expect(o.label_en, `label_en of ${o.label}`).toBeTruthy();
    }
  });
  it('cracked MacBook screens deduct 50/60/70 by tier, never reject', () => {
    const cracked = (tier: any) => buildGenerationGroups(tier)
      .find((g: any) => g.title === 'สภาพจอภาพและกระจก')!.options.find((o: any) => o.label === 'จอแตก/ร้าว')!;
    expect(cracked('mac_new').pct).toBe(50);
    expect(cracked('mac_mid').pct).toBe(60);
    expect(cracked('mac_intel').pct).toBe(70);
    expect(cracked('mac_new').failBehavior).toBe('deduct');
  });
  it('mac_imac has no battery topic; mac_desktop has neither battery nor screen', () => {
    const imacTitles = buildGenerationGroups('mac_imac').map((g: any) => g.title);
    expect(imacTitles.some((t: string) => /แบต/.test(t))).toBe(false);
    expect(imacTitles).toContain('สภาพจอภาพและกระจก');
    const deskTitles = buildGenerationGroups('mac_desktop').map((g: any) => g.title);
    expect(deskTitles.some((t: string) => /แบต/.test(t))).toBe(false);
    expect(deskTitles.some((t: string) => /จอ/.test(t))).toBe(false);
  });
  it('bare-device MacBooks deduct 3% for the missing power adapter', () => {
    const box = buildGenerationGroups('mac_mid').find((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย')!;
    expect(box.options.find((o: any) => /เครื่องเปล่า/.test(o.label))!.pct).toBe(3);
  });
  it('MacBook functional screening comes from the mac template minus battery', () => {
    const titles = buildFunctionalScreeningGroups('mac_new').map((g: any) => g.title);
    expect(titles).toEqual(['เปิดเครื่อง / ชาร์จไฟ', 'หน้าจอแสดงผล', 'คีย์บอร์ด + แทร็คแพด', 'พอร์ต + Wi-Fi / Bluetooth']);
    expect(buildFunctionalScreeningGroups('mac_desktop').map((g: any) => g.title))
      .toEqual(['เปิดเครื่อง / การทำงานพื้นฐาน', 'พอร์ต + Wi-Fi / Bluetooth']);
    expect(buildFunctionalScreeningGroups('mac_imac').map((g: any) => g.title))
      .toEqual(['เปิดเครื่อง / การทำงานพื้นฐาน', 'หน้าจอแสดงผล', 'พอร์ต + Wi-Fi / Bluetooth']);
  });
  it('bare-device deduct is baked in baht with a 1,000 floor (3% of median price, rounded up to 100)', () => {
    // Cheap Intel MacBook: 3% ของ 10,000 = 300 -> floor ดันขึ้น 1,000
    const cheap = { name: 'MacBook Pro 13" (2019)', variants: [{ usedPrice: 10000 }] };
    expect(macBareDeviceDeduct(cheap)).toBe(1000);
    // Expensive M4 Pro: 3% ของ 60,000 = 1,800 -> ใช้ตาม % (เกิน floor)
    const pricey = { name: 'MacBook Pro 16" M4 Pro', variants: [{ usedPrice: 60000 }] };
    expect(macBareDeviceDeduct(pricey)).toBe(1800);
    // ไม่มีราคา -> floor 1,000
    expect(macBareDeviceDeduct({ name: 'MacBook Air M2 (2022)' })).toBe(1000);
    const { groups } = applyGenerationToGroups([], 'mac_intel', cheap);
    const box = groups.find((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย')!;
    const bare = box.options.find((o: any) => /^เครื่องเปล่า/.test(o.label))!;
    expect(bare.deduct).toBe(1000);
    expect(bare.pct).toBeUndefined();
    const again = applyGenerationToGroups(groups, 'mac_intel', cheap);
    expect(JSON.stringify(again.groups)).toBe(JSON.stringify(groups));
  });
  it('missing-box deducts a flat 1,000 on every Mac, cheap or expensive', () => {
    for (const [tier, model] of [
      ['mac_intel', { name: 'MacBook Pro 13" (2019)', variants: [{ usedPrice: 10000 }] }],
      ['mac_new', { name: 'MacBook Pro 16" M4 Max', variants: [{ usedPrice: 70000 }] }],
      ['mac_imac', { name: 'iMac 24" M3 (2023)', variants: [{ usedPrice: 30000 }] }],
      ['mac_desktop', { name: 'Mac mini M4 (2024)', variants: [{ usedPrice: 18000 }] }],
    ] as const) {
      const { groups } = applyGenerationToGroups([], tier as any, model);
      const box = groups.find((g: any) => g.title === 'อุปกรณ์เสริมที่นำมาด้วย')!;
      const missing = box.options.find((o: any) => /^ขาดกล่อง/.test(o.label))!;
      expect(missing.deduct, model.name).toBe(1000);
      expect(missing.pct, model.name).toBeUndefined();
      expect(box.options.find((o: any) => /^ครบกล่อง/.test(o.label))!.deduct, model.name).toBe(0);
    }
  });
  it('the keyboard-region group replaces an old ประเทศที่ซื้อ topic and is never treated as screening', () => {
    const old = [
      { id: 'g1', title: 'ประเทศที่ซื้อ', kind: 'cosmetic', options: [{ id: 'o1', label: 'ศูนย์ไทย', deduct: 0 }] },
      { id: 'g2', title: 'คีย์บอร์ด + แทร็คแพด', kind: 'functional', options: [{ id: 'o2', label: 'ปกติ', deduct: 0 }] },
    ];
    const { groups } = applyGenerationToGroups(old, 'mac_mid');
    const regions = groups.filter((g: any) => /ประเทศ/.test(g.title));
    expect(regions).toHaveLength(1);
    expect(regions[0].title).toBe('ประเทศที่ซื้อ + คีย์บอร์ด');
    expect(groups.filter((g: any) => g.title === 'คีย์บอร์ด + แทร็คแพด')).toHaveLength(1);
  });
});

describe('planGenerationApply', () => {
  const perModelSet = makeSet();
  const sharedSet = { id: 'shared', name: 'รวม', groups: makeSet().groups };
  const models = [
    { id: 'm15', name: 'iPhone 15', conditionSetId: 'set1' },
    { id: 'm16a', name: 'iPhone 16', conditionSetId: 'shared' },
    { id: 'm16b', name: 'iPhone 16 Pro', conditionSetId: 'shared' },
    { id: 'mx', name: 'iPhone X' }, // no set
    { id: 'ipad', name: 'iPad Air 4 (2020)', conditionSetId: 'setIpad' },
    { id: 'mac', name: 'MacBook Air 13" (ชิป M1, 2020)', conditionSetId: 'setMac' },
    { id: 'watch', name: 'Apple Watch Series 10', conditionSetId: 'setWatch' },
  ];
  const ipadSet = { id: 'setIpad', name: 'iPad Air 4', groups: makeSet().groups };
  const macSet = { id: 'setMac', name: 'MacBook Air M1', groups: makeSet().groups };

  it('plans per-model iPhone/iPad/Mac sets; shared/out-of-scope/missing are reported', () => {
    const plan = planGenerationApply(models, [perModelSet, sharedSet, ipadSet, macSet]);
    expect(plan.actions.map((a) => a.modelId)).toEqual(['m15', 'ipad', 'mac']);
    expect(plan.actions[0].tier).toBe('mid');
    expect(plan.actions[1].tier).toBe('ipad_old');
    expect(plan.actions[2].tier).toBe('mac_mid');
    expect(plan.tierCounts.mid).toBe(1);
    expect(plan.tierCounts.ipad_old).toBe(1);
    expect(plan.tierCounts.mac_mid).toBe(1);
    expect(plan.sharedSkipped.map((s) => s.modelId)).toEqual(['m16a', 'm16b']);
    expect(plan.missing.map((s) => s.modelId)).toEqual(['mx']);
    expect(plan.outOfScope).toBe(1); // the Apple Watch
  });

  it('is idempotent: after applying, re-planning reports alreadyApplied', () => {
    const plan = planGenerationApply(models, [perModelSet, sharedSet]);
    const applied = { ...perModelSet, groups: plan.actions[0].groups };
    const replan = planGenerationApply(models, [applied, sharedSet]);
    expect(replan.actions).toHaveLength(0);
    expect(replan.alreadyApplied).toBe(1);
  });

  it('never mutates the source sets', () => {
    const before = JSON.stringify(perModelSet.groups);
    planGenerationApply(models, [perModelSet, sharedSet]);
    expect(JSON.stringify(perModelSet.groups)).toBe(before);
  });
});
