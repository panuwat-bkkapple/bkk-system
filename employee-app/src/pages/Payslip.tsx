import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Download, Loader2 } from 'lucide-react';
import { call, errorText, type FilePayload, type PayslipBrief, type PayslipFull } from '../api';
import { openPayload } from '../download';

const THAI_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const periodTitle = (p: string) =>
  `${THAI_MONTH[Number(p.slice(5, 7)) - 1]} ${Number(p.slice(0, 4)) + 543}`;

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const payDateText = (ms: number | null) => {
  if (!ms) return null;
  const d = new Date(ms);
  return `${d.getDate()} ${THAI_MONTH[d.getMonth()]} ${d.getFullYear() + 543}`;
};

/**
 * สลิปเงินเดือน (ดีไซน์ 06)
 *
 * **เห็นเฉพาะรอบที่อนุมัติแล้ว** — server กรองให้ (ดู `VISIBLE_RUN_STATUSES`)
 * รอบร่างยังถูกแก้ตัวเลขได้ ถ้าโชว์ก่อน พนักงานจะจำเลขที่ยังไม่ใช่เลขจริง
 *
 * **ยอดสุทธิมาจากฟิลด์ของตัวเอง ไม่ได้บวกจากรายการข้างล่าง** — รายการรายได้กับ
 * รายการหักเป็นสิ่งที่ HR กรอก ส่วน `net` คำนวณโดยตัวคิดเงินเดือน การบวกเองบน
 * หน้าจอคือสูตรชุดที่สองที่วันหนึ่งจะไม่ตรงกัน (กฎเดียวกับช่วงราคารวมของ
 * AI Overview)
 */
export default function Payslip() {
  const [rows, setRows] = useState<PayslipBrief[] | null>(null);
  const [open, setOpen] = useState<PayslipFull | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await call<{ periods: PayslipBrief[] }>('employeePayslipList');
      setRows(res.periods);
      if (res.periods[0]) void openOne(res.periods[0].period);
    } catch (e) { setErr(errorText(e)); setRows([]); }
  }, []);

  const openOne = async (period: string) => {
    setBusy(true); setErr(null);
    try { setOpen(await call<PayslipFull>('employeePayslipGet', { period })); }
    catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    if (!open) return;
    setBusy(true); setErr(null);
    try {
      openPayload(await call<FilePayload>('employeePayslipPdf', { period: open.period }));
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  };

  if (!rows) return <div className="card center"><Loader2 size={20} className="spin" /></div>;

  if (rows.length === 0) {
    return (
      <div className="card">
        {err && <div className="note bad">{err}</div>}
        <div className="muted">
          ยังไม่มีสลิปเงินเดือนที่อนุมัติแล้ว — สลิปจะขึ้นที่นี่หลังฝ่ายบุคคล
          ปิดรอบจ่ายของเดือนนั้น
        </div>
      </div>
    );
  }

  return (
    <>
      {err && <div className="note bad">{err}</div>}

      {open && (
        <div className="section">
          <h2 style={{ justifyContent: 'space-between' }}>
            <span>รอบจ่าย {periodTitle(open.period)}</span>
            <button className="opt" style={{ padding: '4px 12px', fontSize: 12 }}
              disabled={busy} onClick={() => void download()}>
              <Download size={12} /> ดาวน์โหลด
            </button>
          </h2>

          <div className="card">
            <div className="center" style={{ paddingBottom: 4 }}>
              <div className="muted">ยอดรับสุทธิ</div>
              <div className="big">{baht(open.net)} ฿</div>
              <div className="muted">
                {open.pay_method === 'cash' ? 'รับเป็นเงินสด' : `โอนเข้าบัญชี ${open.bank_masked || '—'}`}
                {payDateText(open.pay_date) ? ` · ${payDateText(open.pay_date)}` : ''}
              </div>
            </div>

            <div className="grid2" style={{ marginTop: 14 }}>
              <div className="tile">
                <div className="muted" style={{ fontSize: 11.5 }}>รายได้รวม</div>
                <div className="num" style={{ fontSize: 18, marginTop: 4 }}>{baht(open.gross)}</div>
              </div>
              <div className="tile">
                <div className="muted" style={{ fontSize: 11.5 }}>หักรวม</div>
                <div className="num neg" style={{ fontSize: 18, marginTop: 4 }}>
                  -{baht(Math.round((open.gross - open.net) * 100) / 100)}
                </div>
              </div>
            </div>
          </div>

          {open.earnings.length > 0 && (
            <>
              <h2 style={{ marginTop: 18 }}>รายได้</h2>
              <div className="card">
                {open.earnings.map((e, i) => (
                  <div className="kv" key={`${e.label}-${i}`}>
                    <span className="k">{e.label}</span>
                    <span className="v num">{baht(e.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {open.deductions.length > 0 && (
            <>
              <h2 style={{ marginTop: 18 }}>รายการหัก</h2>
              <div className="card">
                {open.deductions.map((e, i) => (
                  <div className="kv" key={`${e.label}-${i}`}>
                    <span className="k">{e.label}</span>
                    <span className="v num neg">-{baht(e.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {rows.length > 1 && (
        <div className="section"><h2>รอบก่อนหน้า</h2>
          <div className="list">
            {rows.filter((r) => r.period !== open?.period).map((r) => (
              <button className="row tap" key={r.period} onClick={() => void openOne(r.period)}>
                <div className="top">
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{periodTitle(r.period)}</b>
                  <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                    {baht(r.net)} <ChevronRight size={14} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
