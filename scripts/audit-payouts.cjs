#!/usr/bin/env node
/**
 * ตรวจยอดโอนของงาน Trade-in ว่าตรงกับที่ตกลงกับลูกค้าไหม (อ่านอย่างเดียว ไม่เขียน DB)
 *
 * วิธีรัน — จาก **โฟลเดอร์ราก repo bkk-system** (ไม่ใช่ ~ และไม่ใช่ functions/):
 *
 *   git pull                                  # ให้แน่ใจว่ามีสคริปต์นี้แล้ว
 *   node scripts/audit-payouts.cjs --paid --days=180 \
 *     --email you@example.com --password 'yourpassword'
 *
 * ไม่ต้องมี service account, ไม่ต้อง npm ci, ไม่ต้องตั้ง env อะไรเลย — ล็อกอินด้วย
 * บัญชีแอดมินตัวเดียวกับที่ใช้เข้าหน้าเว็บแอดมิน (แนวเดียวกับ
 * scripts/bulk-upload-mac-products.cjs) แล้วอ่านผ่าน RTDB REST API ตาม rules ปกติ
 *
 * ถ้าไม่อยากพิมพ์รหัสผ่านในคำสั่ง (จะติดอยู่ใน shell history) ให้ตั้ง env แทน:
 *   FIREBASE_AUTH_EMAIL=you@example.com FIREBASE_AUTH_PASSWORD='...' \
 *     node scripts/audit-payouts.cjs --paid --days=180
 *
 * โหมด:
 *   (ไม่ใส่อะไร)   ใบที่ "รอโอน" อยู่ตอนนี้ — ตรวจก่อนกดโอน
 *   --paid         ใบที่ "โอนไปแล้ว" ย้อนหลัง (ค่าเริ่มต้น 90 วัน, ปรับด้วย --days=N)
 *   --csv          พิมพ์เป็น CSV เอาไปเปิด Excel
 *   --all          แสดงทุกใบ ไม่ใช่เฉพาะใบที่เพี้ยน
 *
 * ทำไมต้องมี: `final_price`/`price` คือ **ราคาเครื่อง (ฐาน)** ส่วนยอดที่โอนจริงถูก
 * คิดสดทุกครั้งจาก
 *     net = max(0, final_price − ค่าบริการรับเครื่องสุทธิ + คูปอง + adjustments)
 * (TradeInPayouts.getNetPayout + recomputeCustomerPickupFee). ถ้ามี path ไหนเขียน
 * `final_price` เป็น "ยอดสุทธิ" (บั๊กเดิมของ Revised Offer) หรืออัปเดตราคาโดยไม่
 * sync `net_payout` → ยอดที่ลูกค้ากดยอมรับ ≠ ยอดที่โอนจริง
 *
 * โหมด --paid เทียบ **ยอดใน transaction DEBIT ที่โอนไปจริง** กับ **ยอดที่ตกลงกับ
 * ลูกค้า** (revised_price / net_payout) จึงจับเคสจ่ายเกิน/ขาดได้ แม้ตอนโอน finance
 * กับ DB จะ "ตรงกันเอง" ก็ตาม
 *
 * หมายเหตุค่า RTDB: ใช้ query ตาม index เสมอ (`jobs` ตาม status, `transactions`
 * ตาม timestamp) ไม่ดึงทั้ง node ตามกฎใน CLAUDE.md
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// โหลด .env จากราก repo (แนวเดียวกับ scripts/bulk-upload-mac-products.cjs)
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}
loadEnv();

const DB_URL = (
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app'
).replace(/\/$/, '');
const API_KEY = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '';

function request(url, method, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      timeout: 60000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function signIn(email, password) {
  if (!API_KEY) {
    throw new Error('ไม่พบ VITE_FIREBASE_API_KEY — รันจากรากโฟลเดอร์ repo ที่มีไฟล์ .env หรือ export FIREBASE_API_KEY เอง');
  }
  const res = await request(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    'POST',
    { email, password, returnSecureToken: true },
  );
  if (res.status !== 200) {
    throw new Error(`ล็อกอินไม่สำเร็จ: ${res.data?.error?.message || JSON.stringify(res.data)}`);
  }
  return res.data.idToken;
}

/** GET RTDB ตาม path + query (query ต้องมี index รองรับเสมอ) */
async function dbGet(dbPath, token, query) {
  const qs = Object.entries(query || {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  qs.push(`auth=${token}`);
  const res = await request(`${DB_URL}${dbPath}.json?${qs.join('&')}`, 'GET');
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`อ่าน ${dbPath} ไม่สำเร็จ (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

// เหมือน pendingPayouts ใน src/pages/finance/components/TradeInPayouts.tsx
const PENDING_STATUSES = [
  'Payout Processing',
  'Pending Finance Approval',
  'Waiting for Finance',
  'Price Accepted',
];
const PAYOUT_CATEGORIES = new Set(['TRADE_IN_PAYOUT', 'B2B_PURCHASE']);
const DONE = new Set([
  'paid', 'payment completed', 'sent to qc lab', 'in stock',
  'cancelled', 'closed (lost)', 'returned',
]);

const baht = (n) => `฿${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const round = (n) => Math.round(Number(n) || 0);

function sumAppliedAdjustments(job) {
  const raw = job && job.adjustments;
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return list.reduce((sum, a) => {
    if (!a || a.status !== 'applied') return sum;
    const amt = Number(a.amount);
    return Number.isFinite(amt) ? sum + amt : sum;
  }, 0);
}

function moneyParts(job) {
  const base = Number(job.final_price || job.price || 0);
  const isPickup = job.receive_method === 'Pickup';
  const grossFee = isPickup ? Number(job.pickup_fee || 0) : 0;
  const discount = isPickup ? Number(job.rider_fee_discount || 0) : 0;
  const fee = Math.max(0, grossFee - discount);
  const coupon = Number((job.applied_coupon && (job.applied_coupon.actual_value || job.applied_coupon.value)) || 0);
  const adj = sumAppliedAdjustments(job);
  return { base, fee, coupon, adj, formula: Math.max(0, base - fee + coupon + adj) };
}

/** ยอดที่ตกลง/แจ้งลูกค้าไว้ — หน้า track โชว์ net_payout, การเจรจาเก็บที่ revised_price */
function agreedWithCustomer(job) {
  const revised = Number(job.revised_price || job.negotiated_price || 0);
  if (revised > 0) return revised;
  const net = Number(job.net_payout || 0);
  return net > 0 ? net : null;
}

function readLogs(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
}

function wasRevised(job) {
  return Number(job.revised_price || job.negotiated_price || 0) > 0
    || readLogs(job.qc_logs).some((l) => l && (l.action === 'Revised Offer' || l.action === 'Deal Closed (Negotiated)'));
}

/** ลายเซ็นบั๊กเดิม: final_price ถูกเขียนเป็นยอดสุทธิ แทนที่จะเป็นราคาเครื่อง */
function looksLikeNetWrittenAsBase(job, m) {
  const agreed = agreedWithCustomer(job);
  if (agreed == null) return false;
  if (!wasRevised(job)) return false;
  if (m.fee === 0 && m.coupon === 0 && m.adj === 0) return false; // ไม่มีอะไรให้เพี้ยน
  return round(m.base) === round(agreed);
}

function diagnosePending(job) {
  const flags = [];
  const m = moneyParts(job);
  const agreed = agreedWithCustomer(job);

  if (agreed != null && round(agreed) !== round(m.formula)) {
    flags.push({
      code: 'NET_MISMATCH',
      detail: `ลูกค้าเห็น ${baht(agreed)} แต่ระบบจะโอน ${baht(m.formula)} (ต่าง ${baht(m.formula - agreed)})`,
    });
  }
  if (looksLikeNetWrittenAsBase(job, m)) {
    flags.push({
      code: 'FINAL_PRICE_IS_NET',
      detail: `เคยปรับราคาผ่าน Revised Offer และ final_price (${baht(m.base)}) เท่ากับยอดสุทธิ — ที่ถูกควรเป็นราคาเครื่อง ${baht(agreedWithCustomer(job) + m.fee - m.coupon - m.adj)}`,
    });
  }
  const devices = Array.isArray(job.devices) ? job.devices : [];
  if (devices.length > 0) {
    const devSum = devices.reduce((s, d) => s + Number((d && (d.price || d.estimated_price)) || 0), 0);
    const acc = (Array.isArray(job.accessory_items) ? job.accessory_items : [])
      .reduce((s, a) => s + Number((a && a.price) || 0), 0);
    if (devSum + acc > 0 && round(devSum + acc) !== round(m.base)) {
      flags.push({
        code: 'DEVICE_SUM_MISMATCH',
        detail: `ผลรวมราคาใน devices[]+อุปกรณ์เสริม (${baht(devSum + acc)}) ไม่ตรงกับ final_price/price (${baht(m.base)})`,
      });
    }
  }
  if (m.base <= 0) flags.push({ code: 'NO_BASE_PRICE', detail: 'ไม่มี final_price/price — ยอดโอนจะเป็น 0' });

  return { flags, m, agreed, amount: m.formula };
}

function diagnosePaid(job, debit) {
  const flags = [];
  const m = moneyParts(job);
  const agreed = agreedWithCustomer(job);
  const paid = Number(debit.amount || 0);

  if (agreed != null && round(paid) !== round(agreed)) {
    const diff = paid - agreed;
    flags.push({
      code: diff > 0 ? 'PAID_ABOVE_AGREED' : 'PAID_BELOW_AGREED',
      detail: `โอนจริง ${baht(paid)} แต่ยอดที่ตกลงกับลูกค้าคือ ${baht(agreed)} (${diff > 0 ? 'เกิน' : 'ขาด'} ${baht(Math.abs(diff))})`,
    });
  }
  if (round(paid) !== round(m.formula)) {
    flags.push({
      code: 'PAID_VS_RECORD',
      detail: `โอนจริง ${baht(paid)} แต่คิดจากข้อมูลในใบงานตอนนี้ได้ ${baht(m.formula)} — อาจมีการแก้ราคาหลังโอน`,
    });
  }
  if (looksLikeNetWrittenAsBase(job, m)) {
    flags.push({
      code: 'FINAL_PRICE_IS_NET',
      detail: `เคยปรับราคาผ่าน Revised Offer และ final_price (${baht(m.base)}) เท่ากับยอดสุทธิ — ยอดโอนถูกบวกคูปอง/หักค่าบริการซ้ำ`,
    });
  }
  return { flags, m, agreed, amount: paid };
}

async function fetchByStatus(token, status) {
  const val = await dbGet('/jobs', token, { orderBy: '"status"', equalTo: JSON.stringify(status) });
  return Object.entries(val || {}).map(([id, job]) => ({ id, ...job }));
}

async function collectPending(token) {
  const batches = await Promise.all(PENDING_STATUSES.map((s) => fetchByStatus(token, s)));
  const seen = new Set();
  const out = [];
  for (const batch of batches) {
    for (const job of batch) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      const s = String(job.status || '').trim().toLowerCase();
      if (DONE.has(s) || job.slip_url || job.payment_slip) continue;
      out.push({ job, ...diagnosePending(job) });
    }
  }
  return out.sort((a, b) => (b.job.updated_at || 0) - (a.job.updated_at || 0));
}

async function collectPaid(token, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = await dbGet('/transactions', token, { orderBy: '"timestamp"', startAt: String(cutoff) });
  const txs = Object.values(all || {}).filter(
    (t) => t && t.type === 'DEBIT' && PAYOUT_CATEGORIES.has(t.category) && t.ref_job_id,
  );
  const out = [];
  for (const tx of txs) {
    const job = await dbGet(`/jobs/${tx.ref_job_id}`, token, {});
    if (!job) {
      out.push({
        job: { id: tx.ref_job_id, ref_no: tx.ref_job_id, cust_name: '-' },
        flags: [{ code: 'JOB_MISSING', detail: 'ไม่พบใบงาน (อาจถูก archive) — ตรวจที่ jobs_archived เอง' }],
        m: { base: 0, fee: 0, coupon: 0, adj: 0, formula: 0 }, agreed: null, amount: Number(tx.amount || 0),
      });
      continue;
    }
    out.push({ job: { id: tx.ref_job_id, ...job }, ...diagnosePaid(job, tx), paidAt: tx.timestamp });
  }
  return out.sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0));
}

async function main() {
  const argv = process.argv.slice(2);
  const paidMode = argv.includes('--paid');
  const asCsv = argv.includes('--csv');
  const showAll = argv.includes('--all');
  const daysArg = argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) || 90 : 90;
  const flagValue = (name) => {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : '';
  };

  const email = flagValue('--email') || process.env.FIREBASE_AUTH_EMAIL || '';
  const password = flagValue('--password') || process.env.FIREBASE_AUTH_PASSWORD || '';
  if (!email || !password) {
    console.error('ต้องระบุบัญชีแอดมิน: --email you@example.com --password \'...\'');
    console.error('(หรือตั้ง FIREBASE_AUTH_EMAIL / FIREBASE_AUTH_PASSWORD เป็น env แทน)');
    process.exit(1);
  }

  console.log(`เชื่อมต่อ ${DB_URL}`);
  const token = await signIn(email, password);

  const rows = paidMode ? await collectPaid(token, days) : await collectPending(token);
  const bad = rows.filter((r) => r.flags.length > 0);
  const shown = showAll ? rows : bad;

  if (asCsv) {
    console.log('ref_no,status,customer,base_price,pickup_fee_effective,coupon,adjustments,agreed_with_customer,amount,diff,flags');
    for (const r of shown) {
      console.log([
        r.job.ref_no || r.job.id,
        r.job.status || '',
        String(r.job.cust_name || '').replace(/,/g, ' '),
        r.m.base, r.m.fee, r.m.coupon, r.m.adj,
        r.agreed == null ? '' : r.agreed,
        r.amount,
        r.agreed == null ? '' : r.amount - r.agreed,
        r.flags.map((f) => f.code).join('|'),
      ].join(','));
    }
  } else {
    const scope = paidMode ? `โอนไปแล้วใน ${days} วันหลังสุด` : 'รอโอนตอนนี้';
    console.log(`\n[${scope}] ทั้งหมด ${rows.length} ใบ — พบยอดน่าสงสัย ${bad.length} ใบ\n`);
    for (const r of shown) {
      console.log(`${r.flags.length ? '[!]' : '[ok]'} ${r.job.ref_no || r.job.id}  ${r.job.status || '-'}  ${r.job.cust_name || '-'}  (${r.job.receive_method || '-'})`);
      console.log(`    ราคาเครื่อง ${baht(r.m.base)} − ค่าบริการ ${baht(r.m.fee)} + คูปอง ${baht(r.m.coupon)} + ปรับราคา ${baht(r.m.adj)} = ${baht(r.m.formula)}`);
      console.log(`    ตกลงกับลูกค้า: ${r.agreed == null ? '-' : baht(r.agreed)}   |   ${paidMode ? 'โอนจริง' : 'จะโอน'}: ${baht(r.amount)}`);
      for (const f of r.flags) console.log(`    -> ${f.code}: ${f.detail}`);
      console.log('');
    }
    if (!bad.length) console.log('ไม่พบใบที่ยอดเพี้ยน\n');
    if (paidMode) {
      console.log('หมายเหตุ: PAID_VS_RECORD อาจเกิดจากการแก้ราคาในใบงาน "หลัง" โอนไปแล้ว');
      console.log('ให้ดู qc_logs ประกอบก่อนสรุปว่าจ่ายผิดจริง\n');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
