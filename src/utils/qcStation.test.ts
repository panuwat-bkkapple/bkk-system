// ด่านของแท็บ To Do บน /qc-station และ /mobile/qc
//
// เคสจริง 4 ก.ย. 2569 (OID-MTH3OCEC-820): status engine เขียน 'Sent To QC Lab'
// แต่หน้าสถานีกรองด้วย literal 'Sent to QC Lab' → To Do ขึ้น 0 ทั้งที่ Trace กับ
// workspace บอกว่าส่งเข้าแล็บแล้ว (docs/reports/2026-09-04-qc-station-todo-empty-survey.md)
//
// injection ที่ต้องแดง: เปลี่ยน isAwaitingQcLab กลับเป็น
// `job.status === 'Sent to QC Lab'` → เคสแรกแดง (ใบของ engine หาย)
import { describe, it, expect } from 'vitest';
import { JOB_STATUS } from '../types/job-statuses';
import { selectQcTodoList, isAwaitingQcLab, matchesQcStationSearch } from './qcStation';

describe('QC Lab To Do filter', () => {
   it('shows both the engine spelling and the legacy spelling of Sent To QC Lab', () => {
      const jobs = [
         { id: 'engine', status: JOB_STATUS.SENT_TO_QC_LAB, ref_no: 'OID-ENGINE' }, // 'Sent To QC Lab'
         { id: 'legacy', status: 'Sent to QC Lab', ref_no: 'OID-LEGACY' },
         { id: 'stock', status: JOB_STATUS.IN_STOCK, ref_no: 'OID-STOCK' },
         { id: 'pending', status: JOB_STATUS.PENDING_QC, ref_no: 'OID-PENDING' },
         { id: 'none', status: null, ref_no: 'OID-NONE' },
      ];
      expect(JOB_STATUS.SENT_TO_QC_LAB).not.toBe('Sent to QC Lab'); // the two spellings really differ
      expect(selectQcTodoList(jobs).map((j) => j.id)).toEqual(['engine', 'legacy']);
   });

   it('isAwaitingQcLab is false for unreadable or missing status', () => {
      expect(isAwaitingQcLab({ status: 'not a status' })).toBe(false);
      expect(isAwaitingQcLab(null)).toBe(false);
   });
});

describe('QC station search box', () => {
   const jobs = [
      { id: 'rider', ref_no: 'OID-MTH3OCEC-820', device_serial: 'HQ594LKGQL', model: 'iPhone 15' },
      { id: 'qc', ref_no: 'OID-OTHER-1', serial: 'ABCD1234EFG', model: 'iPad' },
   ];
   it('matches device_serial (rider-written) and serial (QC-written) case-insensitively, plus OID', () => {
      const find = (term: string) => jobs.filter((j) => matchesQcStationSearch(j, term)).map((j) => j.id);
      expect(find('hq594lkgql')).toEqual(['rider']);
      expect(find('abcd1234')).toEqual(['qc']);
      expect(find('oid-mth3ocec')).toEqual(['rider']);
      expect(find('')).toEqual(['rider', 'qc']);
   });
});
