import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Receipt, Upload } from 'lucide-react';
import { call, errorText, type FileListRes, type FilePayload } from '../api';
import { openPayload } from '../download';
import { thaiDate } from '../geo';
import type { Screen } from '../nav';

const sizeText = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const dayOf = (ms: number | null) => (ms ? thaiDate(new Date(ms).toISOString().slice(0, 10)) : '');

/** นามสกุลย่อสำหรับป้ายหน้าแถว — จากชนิดไฟล์จริง ไม่ใช่จากชื่อไฟล์ที่ผู้ใช้ตั้ง */
const badgeOf = (ct: string | null) => {
  if (!ct) return 'ไฟล์';
  if (ct.includes('pdf')) return 'PDF';
  if (ct.includes('png')) return 'PNG';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'JPG';
  if (ct.includes('webp')) return 'WEBP';
  if (ct.includes('heic') || ct.includes('heif')) return 'HEIC';
  return 'ไฟล์';
};

/**
 * แฟ้มเอกสารของฉัน (ดีไซน์ 07)
 *
 * **สองแหล่งที่คนละเจ้าของ อยู่คนละกลุ่มบนจอ** — ไฟล์ที่เราอัปโหลด
 * (`employee_files`) กับเอกสารที่ฝ่ายบุคคลออกให้ (`hr_documents`) ยุบเป็นลิสต์
 * เดียวไม่ได้ เพราะเปิดคนละทางและอย่างหลังลบไม่ได้
 *
 * **ยังไม่มีปุ่ม "ขอเอกสารจาก HR" ของต้นฉบับ** — ระบบยังไม่มีเส้นทางรับคำขอ
 * ปุ่มที่กดแล้วไม่มีใครได้รับคือคำสัญญาปลอม (ตอนนี้ขอผ่านหัวหน้า/ฝ่ายบุคคล
 * ตามช่องทางเดิม)
 */
export default function Documents({ onGo }: { onGo: (s: Screen) => void }) {
  const [data, setData] = useState<FileListRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('other');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try { setData(await call<FileListRes>('employeeFileList')); }
    catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openFile = async (id: string) => {
    setBusy(true); setMsg(null);
    try { openPayload(await call<FilePayload>('employeeFileDownload', { fileId: id })); }
    catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setBusy(false); }
  };

  const upload = async (f: File) => {
    setBusy(true); setMsg(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        // ตัดหัว `data:...;base64,` ออก — server รับเฉพาะตัว base64 ล้วน
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        r.readAsDataURL(f);
      });
      await call('employeeFileUpload', {
        kind, filename: f.name, contentType: f.type, base64,
      });
      setMsg({ tone: 'ok', text: 'อัปโหลดแล้ว ฝ่ายบุคคลจะเห็นไฟล์นี้ในแฟ้มของคุณ' });
      await load();
    } catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  if (!data) return <div className="card center"><Loader2 size={20} className="spin" /></div>;

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      <div className="section"><h2>เอกสารที่ฝ่ายบุคคลออกให้</h2>
        {data.documents.length === 0 ? (
          <div className="card"><div className="muted">ยังไม่มีเอกสารที่ออกให้</div></div>
        ) : (
          <div className="list">
            {data.documents.map((d) => (
              <div className="row" key={d.id}>
                <span className="fbadge">เอกสาร</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{d.type_label}</b>
                  <div className="muted">
                    {d.number || '—'}{d.issued_at ? ` · ${dayOf(d.issued_at)}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* เอกสารพวกนี้ยังเปิดจากแอปไม่ได้ — ตัวสร้าง PDF อยู่ฝั่งฝ่ายบุคคล
            และยังไม่มี callable ที่ให้เจ้าตัวสั่งพิมพ์ซ้ำเอง บอกตรงๆ ดีกว่า
            ใส่ปุ่มที่กดแล้ว error */}
        {data.documents.length > 0 && (
          <div className="muted" style={{ marginTop: 8, padding: '0 2px' }}>
            ขอไฟล์ฉบับเต็มได้ที่ฝ่ายบุคคล — แอปแสดงเลขที่และวันที่ออกไว้ให้อ้างอิง
          </div>
        )}
      </div>

      <div className="section">
        <h2 style={{ justifyContent: 'space-between' }}>
          <span>ไฟล์ในแฟ้มของฉัน</span>
          <button className="opt" style={{ padding: '4px 12px', fontSize: 12 }}
            onClick={() => onGo('payslip')}>
            <Receipt size={12} /> สลิปเงินเดือน
          </button>
        </h2>
        {data.files.length === 0 ? (
          <div className="card"><div className="muted">ยังไม่มีไฟล์ในแฟ้ม</div></div>
        ) : (
          <div className="list">
            {data.files.map((f) => (
              <button className="row tap" key={f.id} disabled={busy} onClick={() => void openFile(f.id)}>
                <span className="fbadge">{badgeOf(f.content_type)}</span>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{f.kind_label}</b>
                  <div className="muted">
                    {sizeText(f.size)}{f.uploaded_at ? ` · ${dayOf(f.uploaded_at)}` : ''}
                    {f.by_me ? ' · คุณอัปโหลดเอง' : ''}
                  </div>
                </div>
                <FileText size={16} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="section"><h2>อัปโหลดไฟล์</h2>
        <div className="card">
          <label htmlFor="upkind">ชนิดเอกสาร</label>
          <div className="chips">
            {data.upload_kinds.map((k) => (
              <button type="button" key={k.id} className="opt" aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>
          <input
            id="upkind"
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <button className="btn ghost" disabled={busy} style={{ marginTop: 12 }}
            onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} เลือกไฟล์
          </button>
          <div className="muted" style={{ marginTop: 10 }}>
            รับ PDF และรูปภาพ ไม่เกิน 5 MB — สัญญาจ้างที่ลงนามแล้วต้องให้ฝ่ายบุคคล
            เป็นผู้เพิ่ม เพราะเป็นฉบับที่ใช้ยันกันตอนมีข้อพิพาท
          </div>
        </div>
      </div>
    </>
  );
}
