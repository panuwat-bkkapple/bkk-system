import { describe, it, expect } from 'vitest';
import { ASSESSMENT_EN_SEED, fillEnFields } from './assessmentEnSeed';
import type { ConditionSetGroup } from './conditionSets';

const makeGroups = (): ConditionSetGroup[] => [
  {
    id: 'g1',
    title: 'สภาพหน้าจอ',
    description: 'เปิดเครื่องได้ ใช้งานได้ตามปกติ',
    options: [
      { id: 'o1', label: 'ปกติ', description: 'สวยมาก ไม่มีรอย', deduct: 0 },
      { id: 'o2', label: 'จอแตก/ร้าว', pct: 30 },
    ],
  },
  {
    id: 'g2',
    title: 'หัวข้อที่ไม่มีในตาราง',
    options: [{ id: 'o3', label: 'ตัวเลือกแปลกๆ ไม่มีคำแปล' }],
  },
];

describe('fillEnFields', () => {
  it('fills empty *_en fields from the seed table and counts them', () => {
    const groups = makeGroups();
    const { groups: next, filled } = fillEnFields(groups);
    expect(next[0].title_en).toBe('Screen condition');
    expect(next[0].description_en).toBe('Turns on and works normally');
    expect(next[0].options?.[0].label_en).toBe('Normal');
    expect(next[0].options?.[0].description_en).toBe('Excellent, no marks');
    expect(next[0].options?.[1].label_en).toBe('Cracked/Broken screen');
    expect(filled).toBe(5);
  });

  it('never overwrites an existing non-empty *_en value', () => {
    const groups = makeGroups();
    groups[0].title_en = 'My Custom Title';
    groups[0].options![0].label_en = 'OK (custom)';
    const { groups: next, filled } = fillEnFields(groups);
    expect(next[0].title_en).toBe('My Custom Title');
    expect(next[0].options?.[0].label_en).toBe('OK (custom)');
    // description_en (group) + option0 description_en + option1 label_en
    expect(filled).toBe(3);
  });

  it('treats whitespace-only *_en as empty and fills it', () => {
    const groups = makeGroups();
    groups[0].title_en = '   ';
    const { groups: next } = fillEnFields(groups);
    expect(next[0].title_en).toBe('Screen condition');
  });

  it('leaves unknown Thai strings untouched (no *_en added)', () => {
    const { groups: next } = fillEnFields(makeGroups());
    expect(next[1].title_en).toBeUndefined();
    expect(next[1].options?.[0].label_en).toBeUndefined();
  });

  it('matches on trimmed Thai values', () => {
    const groups: ConditionSetGroup[] = [
      { id: 'g', title: '  แบตเตอรี่  ', options: [{ id: 'o', label: ' ครบกล่อง ' }] },
    ];
    const { groups: next, filled } = fillEnFields(groups);
    expect(next[0].title_en).toBe('Battery');
    expect(next[0].options?.[0].label_en).toBe('Complete in box');
    expect(filled).toBe(2);
  });

  it('is pure — the input groups are not mutated', () => {
    const groups = makeGroups();
    const snapshot = JSON.parse(JSON.stringify(groups));
    fillEnFields(groups);
    expect(groups).toEqual(snapshot);
  });

  it('returns filled=0 when everything is already translated or unknown', () => {
    const groups: ConditionSetGroup[] = [
      { id: 'g', title: 'หัวข้อที่ไม่มีในตาราง', title_en: '', options: [] },
    ];
    // title_en '' + unknown Thai -> nothing fillable
    const { filled } = fillEnFields(groups);
    expect(filled).toBe(0);
  });

  it('seed table excludes variant-picker keys', () => {
    for (const k of ['Storage (ความจุ)', 'สี', 'ความจุ', 'ขนาด']) {
      expect(ASSESSMENT_EN_SEED[k]).toBeUndefined();
    }
  });
});
