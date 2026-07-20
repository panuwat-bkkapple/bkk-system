import { describe, it, expect } from 'vitest';
import { ASSESSMENT_EN_SEED, fillEnFields, translateAssessmentText } from './assessmentEnSeed';
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

  it('fills compositional (non-exact) labels through the engine', () => {
    const groups: ConditionSetGroup[] = [
      {
        id: 'g',
        title: 'กล้องหน้า / เลนส์กล้อง',
        options: [{ id: 'o', label: 'สุขภาพแบต 65-75%' }],
      },
    ];
    const { groups: next, filled } = fillEnFields(groups);
    expect(next[0].title_en).toBe('Front camera / camera lens');
    expect(next[0].options?.[0].label_en).toBe('Battery health 65-75%');
    expect(filled).toBe(2);
  });
});

describe('translateAssessmentText', () => {
  it('resolves exact pairs from the expanded vocabulary', () => {
    expect(translateAssessmentText('เลนส์กล้องแตก')).toBe('Cracked camera lens');
    expect(translateAssessmentText('โดนน้ำ')).toBe('Liquid damage');
    expect(translateAssessmentText('เปิดไม่ติด')).toBe('Does not power on');
    expect(translateAssessmentText('สแกนใบหน้าหรือสแกนนิ้วไม่ได้')).toBe(
      'Non-working Face ID or fingerprint sensor',
    );
  });

  it('normalizes by trimming and collapsing internal whitespace', () => {
    expect(translateAssessmentText('  สุขภาพแบต   85-89%  ')).toBe('Battery health 85-89%');
    expect(translateAssessmentText('สภาพโดยรวมดี  ไม่มีรอยใช้งาน')).toBe(
      'Overall good cosmetic condition with no signs of use',
    );
  });

  it('handles battery-health patterns for arbitrary ranges', () => {
    expect(translateAssessmentText('สุขภาพแบต 65-75%')).toBe('Battery health 65-75%');
    expect(translateAssessmentText('สุขภาพแบต 95% ขึ้นไป')).toBe('Battery health 95% or above');
    expect(translateAssessmentText('แบตต่ำกว่า 70%')).toBe('Battery below 70%');
    expect(translateAssessmentText('แบตเตอรี่ 90% - 100%')).toBe('Battery 90% - 100%');
  });

  it('translates "head (inner)" parenthetical labels part-wise', () => {
    expect(translateAssessmentText('ทัชแพด (Force Touch)')).toBe('Trackpad (Force Touch)');
    expect(translateAssessmentText('การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)')).toBe(
      'Connectivity (SIM / Wi-Fi / Signal)',
    );
  });

  it('translates " / " and " + " separated labels part-wise', () => {
    expect(translateAssessmentText('ลำโพง / ไมค์ / ปุ่มกด')).toBe('Speaker / Mic / Buttons');
    expect(translateAssessmentText('กระจกหน้า + กระจกหลัง')).toBe('front glass + back glass');
  });

  it('fails closed — null unless the WHOLE string resolves, never mixed output', () => {
    expect(translateAssessmentText('ลำโพง / คำที่ไม่รู้จัก')).toBeNull();
    expect(translateAssessmentText('ข้อความไทยที่ไม่มีในตาราง')).toBeNull();
    expect(translateAssessmentText('')).toBeNull();
    expect(translateAssessmentText('   ')).toBeNull();
  });
});
