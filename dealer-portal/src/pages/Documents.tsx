// คลังเอกสาร — โครงตามจอ Stitch documents-hub.html: filter chips
// (ทั้งหมด / ใบเสนอราคา / ใบกำกับภาษี) + ตัวกรองปี + การ์ดเอกสาร
// (ไอคอนตามชนิด, เลขเอกสาร mono, เลขอ้างอิงออเดอร์, วันที่, ยอด, ปุ่มดาวน์โหลด)
// ข้อมูลรวมมาจาก dealerListDocuments — ใบกำกับภาษีอยู่ /sales ดีลเลอร์อ่านตรงไม่ได้
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, ReceiptText, Download, RefreshCw, FolderOpen } from 'lucide-react';
import { listDocuments } from '../api';
import { fmtBaht, type DealerDocument } from '../types';

const TYPE_META: Record<DealerDocument['type'], { label: string; icon: React.ReactNode; bg: string; fg: string }> = {
  quotation: { label: 'ใบเสนอราคา', icon: <FileText size={20} />, bg: 'rgba(49,130,206,0.1)', fg: 'var(--info)' },
  tax_invoice: { label: 'ใบกำกับภาษี', icon: <ReceiptText size={20} />, bg: 'rgba(39,174,96,0.12)', fg: 'var(--accent-deep)' },
};

const fmtDate = (ms?: number | null): string =>
  ms ? new Date(ms).toLocaleDateString('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }) : '-';

const yearOf = (ms?: number | null): string =>
  ms ? String(new Date(ms + 7 * 60 * 60 * 1000).getUTCFullYear() + 543) : '-';

export const Documents = () => {
  const [docs, setDocs] = useState<DealerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeTab, setTypeTab] = useState<'all' | DealerDocument['type']>('all');
  const [year, setYear] = useState<'all' | string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listDocuments();
      setDocs(res.documents);
    } catch {
      setError('โหลดรายการเอกสารไม่สำเร็จ — ลองรีเฟรชอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ปี พ.ศ. ที่มีเอกสารจริง (ใหม่ → เก่า)
  const years = useMemo(() => {
    const s = new Set(docs.filter((d) => d.issued_at).map((d) => yearOf(d.issued_at)));
    return Array.from(s).sort((a, b) => Number(b) - Number(a));
  }, [docs]);

  const visible = docs.filter(
    (d) => (typeTab === 'all' || d.type === typeTab) && (year === 'all' || yearOf(d.issued_at) === year)
  );
  const countOf = (t: DealerDocument['type']) => docs.filter((d) => d.type === t).length;

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h1 className="h1">คลังเอกสาร</h1>
          <div className="sub">ใบเสนอราคาและใบกำกับภาษีของทุกดีลที่ผ่านมา — ดาวน์โหลดได้ตลอดเวลา</div>
        </div>
        <button className="btn ghost small" onClick={() => void load()}>
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>

      <div className="filter-tabs">
        <button className={`ftab ${typeTab === 'all' ? 'on' : ''}`} onClick={() => setTypeTab('all')}>
          ทั้งหมด <span className="cnt">{docs.length}</span>
        </button>
        <button className={`ftab ${typeTab === 'quotation' ? 'on' : ''}`} onClick={() => setTypeTab('quotation')}>
          ใบเสนอราคา <span className="cnt">{countOf('quotation')}</span>
        </button>
        <button className={`ftab ${typeTab === 'tax_invoice' ? 'on' : ''}`} onClick={() => setTypeTab('tax_invoice')}>
          ใบกำกับภาษี <span className="cnt">{countOf('tax_invoice')}</span>
        </button>
        {years.length > 1 && (
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={{
              marginLeft: 'auto', flexShrink: 0, border: '1px solid var(--line)', borderRadius: 999,
              padding: '7px 12px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)',
              background: '#fff', outline: 'none', fontFamily: 'var(--font-body)',
            }}
          >
            <option value="all">ทุกปี</option>
            {years.map((y) => (
              <option key={y} value={y}>ปี {y}</option>
            ))}
          </select>
        )}
      </div>

      {loading && (<><div className="skel" /><div className="skel" /></>)}
      {error && !loading && <div className="error mt12">{error}</div>}

      {!loading && !error && visible.length === 0 && (
        <div className="empty">
          <FolderOpen size={26} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>
            {docs.length === 0
              ? (<><b>ยังไม่มีเอกสาร</b><br />ใบเสนอราคาจะออกอัตโนมัติเมื่อคุณชนะประมูล และใบกำกับภาษีเมื่อยืนยันการชำระเงินแล้ว</>)
              : 'ไม่มีเอกสารตรงตามตัวกรองที่เลือก'}
          </div>
        </div>
      )}

      {!loading && visible.map((d) => {
        const meta = TYPE_META[d.type];
        return (
          <div key={`${d.type}-${d.number}`} className="card mini-row" style={{ alignItems: 'center' }}>
            <span className="mr-ic" style={{ background: meta.bg, color: meta.fg }}>{meta.icon}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="mono bold" style={{ fontSize: 14 }}>{d.number}</div>
              <div className="tiny muted bold" style={{ marginTop: 3 }}>
                {meta.label}
                {d.order_no ? ` · อ้างอิง ${d.order_no}` : ''} · {fmtDate(d.issued_at)}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="mono bold" style={{ fontSize: 14 }}>{fmtBaht(d.amount)}</div>
              {d.url ? (
                <a
                  className="btn ghost small"
                  style={{ marginTop: 6, padding: '6px 10px' }}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={13} /> PDF
                </a>
              ) : (
                <div className="tiny muted bold" style={{ marginTop: 8 }}>ไฟล์กำลังจัดเตรียม</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
