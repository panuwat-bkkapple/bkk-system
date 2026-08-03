// โปรไฟล์ + ตั้งค่า — โครงตามภาษา Core Ledger (Stitch):
//   hero navy = บัตรประจำตัวดีลเลอร์ (บริษัท + tier badge โทนโลหะ + ผู้ใช้ที่ login)
//   ส่วนเนื้อหาเป็นการ์ดหมวดหัวแถบฟ้า (rsec) เรียง 2 คอลัมน์บน desktop:
//   - ข้อมูลนิติบุคคล (อ่านอย่างเดียว — ผูกเอกสารภาษี)
//   - ทีมงานของร้าน (OWNER: จัดการทุก role / MANAGER: จัดการ STAFF)
//   - ข้อมูลผู้ติดต่อร้าน (เจ้าของร้านแก้ได้) / เปลี่ยนรหัสผ่านตัวเอง
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import {
  Building2, UserRound, KeyRound, Save, Users, Plus, X, Copy, ShieldOff, Shield, Trash2, RotateCcw,
  LifeBuoy, BadgeCheck, ChevronRight, ShieldQuestion,
} from 'lucide-react';
import { auth } from '../firebase';
import { useDealerSession } from '../hooks/useDealerSession';
import {
  updateContact, listMembers, createMember, setMemberStatus, resetMemberPassword, deleteMember,
} from '../api';
import { MEMBER_ROLE_LABEL, TIER_COLOR, TIER_LABEL, type DealerMemberRole, type TeamMember } from '../types';

const genPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export const Profile = () => {
  const navigate = useNavigate();
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
  ];

  return (
    <div>
      <h1 className="h1">โปรไฟล์ & ตั้งค่า</h1>

      {/* บัตรประจำตัวดีลเลอร์ — hero navy + tier badge โลหะ */}
      <div className="hero-card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="label-caps" style={{ color: 'rgba(255,255,255,0.55)' }}>Dealer Account</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 800, marginTop: 5, lineHeight: 1.35 }}>
              {dealer.company_name}
            </div>
          </div>
          <span className="tier-badge" style={{ background: TIER_COLOR[dealer.tier] || 'var(--brand)' }}>
            {TIER_LABEL[dealer.tier] || `Tier ${dealer.tier}`}
          </span>
        </div>
        <div className="row mt12" style={{ justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
          <span className="glass-chip">{memberName || '-'}</span>
          <span className="glass-chip">{MEMBER_ROLE_LABEL[memberRole]}</span>
        </div>
      </div>

      <div className="grid2">
        {/* ข้อมูลนิติบุคคล */}
        <div className="rsec">
          <div className="rsec-head"><Building2 size={16} /> ข้อมูลบริษัท (ใช้ในเอกสารภาษี)</div>
          {companyRows.map(([k, v]) => (
            <div key={k} className="rrow" style={{ alignItems: 'flex-start' }}>
              <span className="nm" style={{ flexShrink: 0, color: 'var(--muted)' }}>{k}</span>
              <span className="small bold" style={{ textAlign: 'right' }}>{v || '-'}</span>
            </div>
          ))}
          <div className="body">
            <div className="notice">
              ข้อมูลชุดนี้ผูกกับใบเสนอราคาและใบกำกับภาษี — ต้องการแก้ไข กรุณาติดต่อเจ้าหน้าที่ GETMOBIE
            </div>
          </div>
        </div>

        {/* ทีมงานของร้าน */}
        {canManageTeam && (
          <div className="rsec">
            <div className="rsec-head">
              <Users size={16} /> ทีมงานของร้าน
              <span className="cnt2">{members.length}/{maxMembers}</span>
            </div>
            <div className="body" style={{ paddingBottom: 0 }}>
              <div className="row">
                <span className="tiny muted bold">
                  {isOwner
                    ? 'เจ้าของร้านเพิ่มได้ทุกตำแหน่ง · ผู้จัดการจัดการได้เฉพาะพนักงาน'
                    : 'คุณเป็นผู้จัดการ — เพิ่ม/จัดการได้เฉพาะพนักงาน (STAFF)'}
                </span>
                <button className="btn small" onClick={() => setShowAdd(true)} disabled={members.length >= maxMembers}>
                  <Plus size={13} /> เพิ่ม
                </button>
              </div>
              {members.length === 0 && (
                <div className="notice mt12">
                  ยังไม่มีสมาชิก — เพิ่มทีมงานเพื่อให้ช่วยดูล็อต เสนอราคา และแนบสลิปได้ โดยแยกบัญชีของใครของมัน
                </div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              {members.map((m) => (
                <div key={m.uid} className="rrow">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span className="avatar">{(m.name || '?').charAt(0).toUpperCase()}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="bold small" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {m.name || '-'}
                        <span className={`pill ${m.member_role === 'OWNER' ? 'green' : m.member_role === 'MANAGER' ? 'blue' : ''}`} style={{ padding: '2px 8px', fontSize: 10 }}>
                          {MEMBER_ROLE_LABEL[m.member_role]}
                        </span>
                        {m.status === 'SUSPENDED' && <span className="pill red" style={{ padding: '2px 8px', fontSize: 10 }}>ระงับ</span>}
                      </div>
                      <div className="tiny muted bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
                    </div>
                  </div>
                  {canTouch(m) && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
            </div>
            {teamMsg && <div className="body" style={{ paddingTop: 0 }}><div className={teamMsg.kind === 'ok' ? 'success' : 'error'} style={{ marginTop: 8 }}>{teamMsg.text}</div></div>}
          </div>
        )}

        {/* ผู้ติดต่อร้าน — เจ้าของร้านเท่านั้น */}
        {isOwner && (
          <div className="rsec">
            <div className="rsec-head"><UserRound size={16} /> ข้อมูลผู้ติดต่อร้าน</div>
            <div className="body">
              <div className="field" style={{ marginTop: 4 }}>
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
          </div>
        )}

        {/* เปลี่ยนรหัสผ่านตัวเอง */}
        <div className="rsec">
          <div className="rsec-head"><KeyRound size={16} /> เปลี่ยนรหัสผ่านของฉัน</div>
          <div className="body">
            <div className="field" style={{ marginTop: 4 }}>
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
        </div>
      </div>

      {/* ทางเข้า Claims/Help/เกณฑ์เกรดสำหรับมือถือ (sidenav มีเฉพาะ desktop) */}
      <div className="card mini-row" style={{ cursor: 'pointer', alignItems: 'center' }} onClick={() => navigate('/claims')}>
        <span className="mr-ic" style={{ background: 'rgba(217,119,6,0.12)', color: 'var(--warn)' }}><ShieldQuestion size={18} /></span>
        <div style={{ flex: 1 }}>
          <div className="bold small">เคลม & เครดิต</div>
          <div className="tiny muted bold" style={{ marginTop: 2 }}>สถานะคำขอเคลม · เครดิตคงเหลือของร้าน</div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
      </div>
      <div className="card mini-row" style={{ cursor: 'pointer', alignItems: 'center' }} onClick={() => navigate('/help')}>
        <span className="mr-ic" style={{ background: 'rgba(26,43,60,0.08)', color: 'var(--brand-deep)' }}><LifeBuoy size={18} /></span>
        <div style={{ flex: 1 }}>
          <div className="bold small">ช่วยเหลือ & คำถามที่พบบ่อย</div>
          <div className="tiny muted bold" style={{ marginTop: 2 }}>ช่องทางติดต่อเจ้าหน้าที่ · วิธีใช้งานระบบ</div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
      </div>
      <div className="card mini-row" style={{ cursor: 'pointer', alignItems: 'center' }} onClick={() => navigate('/grading')}>
        <span className="mr-ic" style={{ background: 'rgba(39,174,96,0.12)', color: 'var(--accent-deep)' }}><BadgeCheck size={18} /></span>
        <div className="bold small" style={{ flex: 1 }}>เกณฑ์การเกรดสภาพเครื่อง</div>
        <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
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
