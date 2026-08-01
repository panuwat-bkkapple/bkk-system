// โปรไฟล์ + ตั้งค่า: ข้อมูลนิติบุคคล (อ่านอย่างเดียว — ผูกเอกสารภาษี),
// ข้อมูลผู้ติดต่อ (แก้เองได้ผ่าน callable), เปลี่ยนรหัสผ่าน (ต้องยืนยันรหัสเดิม)
import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { Building2, UserRound, KeyRound, Save } from 'lucide-react';
import { auth } from '../firebase';
import { useDealerSession } from '../hooks/useDealerSession';
import { updateContact } from '../api';

export const Profile = () => {
  const { dealer, logout } = useDealerSession();
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

  if (!dealer) return null;

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
    if (pw.next.length < 8) {
      setPwMsg({ kind: 'err', text: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ kind: 'err', text: 'ยืนยันรหัสผ่านใหม่ไม่ตรงกัน' });
      return;
    }
    const user = auth.currentUser;
    if (!user || !user.email) return;
    setPwBusy(true);
    try {
      // Firebase บังคับ recent login ก่อนเปลี่ยนรหัส — reauth ด้วยรหัสเดิม
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw.current));
      await updatePassword(user, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ kind: 'ok', text: 'เปลี่ยนรหัสผ่านแล้ว — ใช้รหัสใหม่ในการเข้าสู่ระบบครั้งถัดไป' });
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
    ['อีเมล (บัญชีเข้าระบบ)', dealer.email],
    ['ระดับดีลเลอร์', `Tier ${dealer.tier}`],
  ];

  return (
    <div>
      <h1 className="h1">โปรไฟล์ & ตั้งค่า</h1>
      <div className="sub">ข้อมูลบริษัท ผู้ติดต่อ และความปลอดภัยบัญชี</div>

      {/* ข้อมูลนิติบุคคล — อ่านอย่างเดียว */}
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

      {/* ผู้ติดต่อ — แก้เองได้ */}
      <div className="card">
        <div className="sec-title" style={{ margin: '0 0 4px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-start' }}>
          <UserRound size={14} /> ข้อมูลผู้ติดต่อ
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

      {/* เปลี่ยนรหัสผ่าน */}
      <div className="card">
        <div className="sec-title" style={{ margin: '0 0 4px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-start' }}>
          <KeyRound size={14} /> เปลี่ยนรหัสผ่าน
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
    </div>
  );
};
