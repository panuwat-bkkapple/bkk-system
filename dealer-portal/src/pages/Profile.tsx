// โปรไฟล์ + ตั้งค่า:
//   - ข้อมูลนิติบุคคล (อ่านอย่างเดียว — ผูกเอกสารภาษี)
//   - ข้อมูลผู้ติดต่อร้าน (เจ้าของร้านแก้ได้)
//   - ทีมงานของร้าน (OWNER: จัดการทุก role / MANAGER: จัดการ STAFF) — สร้างบัญชี
//     สมาชิก, ระงับ, รีเซ็ตรหัส, ลบ — รหัสผ่านโชว์ครั้งเดียวหลังสร้าง/รีเซ็ต
//   - เปลี่ยนรหัสผ่านของตัวเอง (ทุกคน)
import { useCallback, useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import {
  Building2, UserRound, KeyRound, Save, Users, Plus, X, Copy, ShieldOff, Shield, Trash2, RotateCcw,
} from 'lucide-react';
import { auth } from '../firebase';
import { useDealerSession } from '../hooks/useDealerSession';
import {
  updateContact, listMembers, createMember, setMemberStatus, resetMemberPassword, deleteMember,
} from '../api';
import { MEMBER_ROLE_LABEL, type DealerMemberRole, type TeamMember } from '../types';

const genPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export const Profile = () => {
  const { dealer, memberRole, memberName, logout } = useDealerSession();
  const canManageTeam = memberRole === 'OWNER' || memberRole === 'MANAGER';
  const isOwner = memberRole === 'OWNER';

  const [contact, setContact] = useState({
    contact_name: dealer?.contact_name || '',
    phone: dealer?.phone || '',
    line_id: dealer?.line_id || '',
  });
  const [contactMsg, setContactMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [contactBusy, setContactBusy] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // ── ทีมงาน ──
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [maxMembers, setMaxMembers] = useState(10);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamMsg, setTeamMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', member_role: 'STAFF' as DealerMemberRole, password: genPassword() });
  // รหัสที่เพิ่งออก — โชว์ครั้งเดียว
  const [issued, setIssued] = useState<{ name: string; email: string; password: string } | null>(null);

  const loadTeam = useCallback(async () => {
    if (!canManageTeam) return;
    try {
      const res = await listMembers();
      setMembers(res.members);
      setMaxMembers(res.max);
    } catch {
      /* เงียบ — section จะโชว์ว่างเปล่า */
    }
  }, [canManageTeam]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  if (!dealer) return null;

  const runTeam = async (fn: () => Promise<void>) => {
    if (teamBusy) return;
    setTeamBusy(true);
    setTeamMsg(null);
    try {
      await fn();
      await loadTeam();
    } catch (err: unknown) {
      setTeamMsg({ kind: 'err', text: (err as Error)?.message || 'ทำรายการไม่สำเร็จ' });
    } finally {
      setTeamBusy(false);
    }
  };

  const handleAddMember = () =>
    runTeam(async () => {
      if (!addForm.name.trim() || !addForm.email.trim()) throw new Error('กรอกชื่อและอีเมลให้ครบ');
      await createMember(addForm);
      setIssued({ name: addForm.name, email: addForm.email, password: addForm.password });
      setShowAdd(false);
      setAddForm({ name: '', email: '', member_role: 'STAFF', password: genPassword() });
      setTeamMsg({ kind: 'ok', text: 'เพิ่มสมาชิกแล้ว' });
    });

  const canTouch = (m: TeamMember) => (isOwner ? true : m.member_role === 'STAFF');

  const saveContact = async () => {
    if (contactBusy) return;
    setContactBusy(true);
    setContactMsg(null);
    try {
      await updateContact(contact);
      setContactMsg({ kind: 'ok', text: 'บันทึกข้อมูลผู้ติดต่อแล้ว' });
    } catch (err: unknown) {
      setContactMsg({ kind: 'err', text: (err as Error)?.message || 'บันทึกไม่สำเร็จ' });
    } finally {
      setContactBusy(false);
    }
  };

  const changePassword = async () => {
    if (pwBusy) return;
    setPwMsg(null);
    if (pw.next.length < 8) { setPwMsg({ kind: 'err', text: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' }); return; }
    if (pw.next !== pw.confirm) { setPwMsg({ kind: 'err', text: 'ยืนยันรหัสผ่านใหม่ไม่ตรงกัน' }); return; }
    const user = auth.currentUser;
    if (!user || !user.email) return;
    setPwBusy(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw.current));
      await updatePassword(user, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ kind: 'ok', text: 'เปลี่ยนรหัสผ่านแล้ว' });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      setPwMsg({
        kind: 'err',
        text: code.includes('wrong-password') || code.includes('invalid-credential')
          ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
          : 'เปลี่ยนรหัสผ่านไม่สำเร็จ — ลองใหม่อีกครั้ง',
      });
    } finally {
      setPwBusy(false);
    }
  };

  const companyRows: [string, string | null | undefined][] = [
    ['ชื่อบริษัท / ร้าน', dealer.company_name],
    ['เลขผู้เสียภาษี', dealer.tax_id],
    ['ที่อยู่ (ใช้ออกใบกำกับภาษี)', dealer.address],
    ['ระดับดีลเลอร์', `Tier ${dealer.tier}`],
  ];

  return (
    <div>
      <h1 className="h1">โปรไฟล์ & ตั้งค่า</h1>
      <div className="sub">
        คุณ login ในฐานะ <b>{memberName || '-'}</b> · {MEMBER_ROLE_LABEL[memberRole]}
      </div>

      {/* ข้อมูลนิติบุคคล */}
      <div className="card">
        <div className="sec-title" style={{ margin: '0 0 4px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-start' }}>
          <Building2 size={14} /> ข้อมูลบริษัท (ใช้ในเอกสารภาษี)
        </div>
        {companyRows.map(([k, v]) => (
          <div key={k} className="row" style={{ padding: '9px 0', borderBottom: '1px solid #f2f4f7' }}>
            <span className="tiny muted bold">{k}</span>
            <span className="small bold" style={{ textAlign: 'right', maxWidth: '60%' }}>{v || '-'}</span>
          </div>
        ))}
        <div className="notice mt12">
          ข้อมูลชุดนี้ผูกกับใบเสนอราคาและใบกำกับภาษี — ต้องการแก้ไข กรุณาติดต่อเจ้าหน้าที่ GETMOBIE
        </div>
      </div>

      {/* ทีมงานของร้าน */}
      {canManageTeam && (
        <div className="card">
          <div className="row">
            <div className="sec-title" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Users size={14} /> ทีมงานของร้าน ({members.length}/{maxMembers})
            </div>
            <button className="btn small" onClick={() => setShowAdd(true)} disabled={members.length >= maxMembers}>
              <Plus size={13} /> เพิ่มสมาชิก
            </button>
          </div>
          <div className="tiny muted bold mt8">
            {isOwner
              ? 'เจ้าของร้านเพิ่มได้ทุกตำแหน่ง · ผู้จัดการเพิ่ม/จัดการได้เฉพาะพนักงาน'
              : 'คุณเป็นผู้จัดการ — เพิ่ม/จัดการได้เฉพาะพนักงาน (STAFF)'}
          </div>

          {members.length === 0 && (
            <div className="notice mt12">ยังไม่มีสมาชิก — เพิ่มทีมงานเพื่อให้ช่วยดูล็อต เสนอราคา และแนบสลิปได้ โดยแยกบัญชีของใครของมัน</div>
          )}

          {members.map((m) => (
            <div key={m.uid} className="row" style={{ padding: '11px 0', borderBottom: '1px solid #f2f4f7' }}>
              <div>
                <div className="bold small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {m.name || '-'}
                  <span className={`pill ${m.member_role === 'OWNER' ? 'green' : m.member_role === 'MANAGER' ? 'blue' : ''}`} style={{ padding: '2px 8px', fontSize: 10 }}>
                    {MEMBER_ROLE_LABEL[m.member_role]}
                  </span>
                  {m.status === 'SUSPENDED' && <span className="pill red" style={{ padding: '2px 8px', fontSize: 10 }}>ระงับ</span>}
                </div>
                <div className="tiny muted bold">{m.email}</div>
              </div>
              {canTouch(m) && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn ghost small" style={{ padding: 8 }} title="รีเซ็ตรหัสผ่าน" disabled={teamBusy}
                    onClick={() => {
                      const password = genPassword();
                      if (!confirm(`ออกรหัสผ่านใหม่ให้ ${m.name}?`)) return;
                      void runTeam(async () => {
                        await resetMemberPassword(m.uid, password);
                        setIssued({ name: m.name || '', email: m.email || '', password });
                      });
                    }}>
                    <RotateCcw size={14} />
                  </button>
                  <button className="btn ghost small" style={{ padding: 8 }} title={m.status === 'ACTIVE' ? 'ระงับ' : 'เปิดใช้'} disabled={teamBusy}
                    onClick={() => {
                      const suspend = m.status === 'ACTIVE';
                      if (!confirm(suspend ? `ระงับบัญชี ${m.name}? (จะถูกเตะออกจากระบบทันที)` : `เปิดใช้บัญชี ${m.name}?`)) return;
                      void runTeam(async () => { await setMemberStatus(m.uid, suspend ? 'SUSPENDED' : 'ACTIVE'); });
                    }}>
                    {m.status === 'ACTIVE' ? <ShieldOff size={14} /> : <Shield size={14} />}
                  </button>
                  <button className="btn ghost small" style={{ padding: 8, color: 'var(--danger)' }} title="ลบ" disabled={teamBusy}
                    onClick={() => {
                      if (!confirm(`ลบบัญชี ${m.name} ถาวร?`)) return;
                      void runTeam(async () => { await deleteMember(m.uid); });
                    }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {teamMsg && <div className={teamMsg.kind === 'ok' ? 'success' : 'error'}>{teamMsg.text}</div>}
        </div>
      )}

      {/* ผู้ติดต่อร้าน — เจ้าของร้านเท่านั้น */}
      {isOwner && (
        <div className="card">
          <div className="sec-title" style={{ margin: '0 0 4px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-start' }}>
            <UserRound size={14} /> ข้อมูลผู้ติดต่อร้าน
          </div>
          <div className="field">
            <label>ชื่อผู้ติดต่อ</label>
            <input value={contact.contact_name} onChange={(e) => setContact({ ...contact, contact_name: e.target.value })} />
          </div>
          <div className="field">
            <label>เบอร์โทร</label>
            <input value={contact.phone} inputMode="tel" onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>LINE ID</label>
            <input value={contact.line_id} onChange={(e) => setContact({ ...contact, line_id: e.target.value })} />
          </div>
          <button className="btn" style={{ marginTop: 14 }} disabled={contactBusy} onClick={() => void saveContact()}>
            <Save size={15} /> {contactBusy ? 'กำลังบันทึก...' : 'บันทึกข้อมูลผู้ติดต่อ'}
          </button>
          {contactMsg && <div className={contactMsg.kind === 'ok' ? 'success' : 'error'}>{contactMsg.text}</div>}
        </div>
      )}

      {/* เปลี่ยนรหัสผ่านตัวเอง */}
      <div className="card">
        <div className="sec-title" style={{ margin: '0 0 4px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-start' }}>
          <KeyRound size={14} /> เปลี่ยนรหัสผ่านของฉัน
        </div>
        <div className="field">
          <label>รหัสผ่านปัจจุบัน</label>
          <input type="password" value={pw.current} autoComplete="current-password" onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </div>
        <div className="field">
          <label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>
          <input type="password" value={pw.next} autoComplete="new-password" onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </div>
        <div className="field">
          <label>ยืนยันรหัสผ่านใหม่</label>
          <input type="password" value={pw.confirm} autoComplete="new-password" onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </div>
        <button className="btn" style={{ marginTop: 14 }} disabled={pwBusy || !pw.current || !pw.next} onClick={() => void changePassword()}>
          {pwBusy ? 'กำลังเปลี่ยน...' : 'เปลี่ยนรหัสผ่าน'}
        </button>
        {pwMsg && <div className={pwMsg.kind === 'ok' ? 'success' : 'error'}>{pwMsg.text}</div>}
      </div>

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => void logout()}>ออกจากระบบ</button>

      {/* โมดอลเพิ่มสมาชิก */}
      {showAdd && (
        <div className="sheet-backdrop" onClick={() => setShowAdd(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="row">
              <div className="black" style={{ fontSize: 17 }}>เพิ่มสมาชิกทีม</div>
              <button className="btn ghost small" style={{ padding: 7 }} onClick={() => setShowAdd(false)}><X size={16} /></button>
            </div>
            <div className="field">
              <label>ชื่อ</label>
              <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label>อีเมล (ใช้ login)</label>
              <input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            </div>
            <div className="field">
              <label>ตำแหน่ง</label>
              <select value={addForm.member_role} onChange={(e) => setAddForm({ ...addForm, member_role: e.target.value as DealerMemberRole })}>
                <option value="STAFF">พนักงาน (STAFF) — ดูล็อต เสนอราคา แนบสลิป</option>
                {isOwner && <option value="MANAGER">ผู้จัดการ (MANAGER) — เพิ่มจัดการพนักงานได้</option>}
                {isOwner && <option value="OWNER">เจ้าของร้าน (OWNER) — สิทธิ์เต็มทุกอย่าง</option>}
              </select>
            </div>
            <div className="field">
              <label>รหัสผ่านชั่วคราว (ระบบสุ่มให้ — ส่งต่อสมาชิก)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={addForm.password} className="mono" onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} />
                <button className="btn ghost small" onClick={() => setAddForm({ ...addForm, password: genPassword() })}>สุ่มใหม่</button>
              </div>
            </div>
            <button className="btn accent" style={{ marginTop: 16 }} disabled={teamBusy} onClick={() => void handleAddMember()}>
              {teamBusy ? 'กำลังสร้าง...' : 'สร้างบัญชีสมาชิก'}
            </button>
            {teamMsg?.kind === 'err' && <div className="error">{teamMsg.text}</div>}
          </div>
        </div>
      )}

      {/* รหัสผ่านที่เพิ่งออก — โชว์ครั้งเดียว */}
      {issued && (
        <div className="sheet-backdrop" onClick={() => setIssued(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="black" style={{ fontSize: 17 }}>ข้อมูลเข้าระบบของ {issued.name}</div>
            <div className="tiny bold mt8" style={{ color: 'var(--warn)' }}>แสดงครั้งเดียว — คัดลอกส่งให้สมาชิกทันที</div>
            <div className="notice mt12 mono" style={{ fontSize: 13, lineHeight: 2 }}>
              URL: https://app.getmobie.com<br />
              Email: {issued.email}<br />
              Password: <b>{issued.password}</b>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={() => {
                void navigator.clipboard.writeText(`Dealer Portal: https://app.getmobie.com\nEmail: ${issued.email}\nPassword: ${issued.password}`);
              }}>
                <Copy size={14} /> คัดลอก
              </button>
              <button className="btn ghost" onClick={() => setIssued(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
