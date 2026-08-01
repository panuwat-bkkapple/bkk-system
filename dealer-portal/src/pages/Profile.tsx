import { useDealerSession } from '../hooks/useDealerSession';

export const Profile = () => {
  const { dealer, logout } = useDealerSession();
  if (!dealer) return null;

  const rows: [string, string | null | undefined][] = [
    ['ชื่อบริษัท / ร้าน', dealer.company_name],
    ['เลขผู้เสียภาษี', dealer.tax_id],
    ['ที่อยู่ (ใช้ออกใบกำกับภาษี)', dealer.address],
    ['ผู้ติดต่อ', dealer.contact_name],
    ['เบอร์โทร', dealer.phone],
    ['อีเมล', dealer.email],
    ['ระดับ (Tier)', dealer.tier],
  ];

  return (
    <div>
      <h1 className="h1">โปรไฟล์</h1>
      <div className="sub">ข้อมูลบริษัทที่ใช้ออกใบเสนอราคาและใบกำกับภาษี</div>
      <div className="card">
        {rows.map(([k, v]) => (
          <div key={k} className="row" style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span className="tiny muted bold">{k}</span>
            <span className="small bold" style={{ textAlign: 'right', maxWidth: '60%' }}>{v || '-'}</span>
          </div>
        ))}
      </div>
      <div className="notice mt12">
        ต้องการแก้ไขข้อมูลบริษัท/เลขผู้เสียภาษี กรุณาติดต่อเจ้าหน้าที่ BKK APPLE
        (ข้อมูลชุดนี้ผูกกับเอกสารภาษี จึงแก้เองไม่ได้)
      </div>
      <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => void logout()}>ออกจากระบบ</button>
    </div>
  );
};
