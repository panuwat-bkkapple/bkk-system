// ขอบเขตของ role HR — เทสตัวนี้มีไว้กันการเพิ่ม role ที่ 5 แล้วเปิดทั้งแอด
// มินให้ฝ่ายบุคคลโดยไม่ได้ตั้งใจ (route 28 เส้นทางในแอปนี้ไม่มี guard เลย
// ค่าเริ่มต้นจึงเป็น "ล็อกอินแล้วเข้าได้")
import { describe, it, expect } from 'vitest';
import { hrScopeRedirect, isPathInHrScope, isHrRole, HR_HOME } from './hrScope';

describe('hrScope', () => {
  it('HR ที่อยู่นอกขอบเขตถูกพากลับหน้าทะเบียน', () => {
    expect(hrScopeRedirect('HR', '/tickets')).toBe(HR_HOME);
    expect(hrScopeRedirect('HR', '/crm')).toBe(HR_HOME);
    expect(hrScopeRedirect('HR', '/finance')).toBe(HR_HOME);
    expect(hrScopeRedirect('HR', '/')).toBe(HR_HOME);
  });

  it('HR ที่อยู่ในขอบเขตไม่ถูกพาไปไหน', () => {
    expect(hrScopeRedirect('HR', '/employees')).toBeNull();
    expect(hrScopeRedirect('HR', '/employees/abc123')).toBeNull();
  });

  it('role อื่นไม่ถูกแตะเลย — ฟังก์ชันนี้ไม่ใช่ที่รวมกติกาสิทธิ์ของทั้งระบบ', () => {
    for (const role of ['CEO', 'MANAGER', 'STAFF', 'FINANCE', undefined, '']) {
      expect(hrScopeRedirect(role, '/tickets')).toBeNull();
      expect(hrScopeRedirect(role, '/employees')).toBeNull();
    }
  });

  it('prefix ต้องตรงที่ขอบ segment ไม่ใช่ startsWith เปล่าๆ', () => {
    // รูคลาสสิกของ prefix matching: หน้าใหม่ที่ขึ้นต้นเหมือนกันแต่คนละเรื่อง
    expect(isPathInHrScope('/employees-payroll-secret')).toBe(false);
    expect(isPathInHrScope('/employeesX')).toBe(false);
    expect(isPathInHrScope('/employees')).toBe(true);
    expect(isPathInHrScope('/employees/1')).toBe(true);
  });

  it('เทียบ role แบบไม่สนตัวพิมพ์ (staff record เก่าเขียนไม่เหมือนกัน)', () => {
    expect(isHrRole('hr')).toBe(true);
    expect(isHrRole('Hr')).toBe(true);
    expect(isHrRole('HRM')).toBe(false);
  });

  it('หน้าตั้งค่าไม่อยู่ในขอบเขต — settingsNav ไม่มี entry ไหนให้สิทธิ์ HR', () => {
    expect(isPathInHrScope('/settings')).toBe(false);
  });
});
