# Migration blueprint: extract accounting → `bkk-accounting`

> Read this in a Claude Code session scoped to **bkk-accounting + bkk-frontend-next + bkk-system**,
> then execute. The accounting team will own `bkk-accounting`; bkk-system (admin team) keeps
> trade-in/ops only. Shared layer = the **same Firebase project `bkk-apple-tradein`** (Auth + RTDB).
> Rules stay canonical in **bkk-frontend-next/database.rules.json**.

## 0. Why / boundaries
- Accounting team ≠ admin team → accounting gets its own repo + its own app + its own functions
  codebase, like `bkk-rider-app` is to `bkk-system`.
- Shared: Firebase project (Auth → SSO, RTDB data, rules). Separate: repo, hosting/app, functions
  codebase, CI, ownership.
- Data contract between teams = the "Data Contracts / Invariants" + "Order Confirmation Emails"
  sections in `bkk-system/CLAUDE.md`. bkk-system OWNS writes to jobs money fields
  (price/pickup_fee/net_payout via its cloud functions). bkk-accounting READS operational data and
  OWNS the accounting docs/ledger paths.

## 1. Scaffold the app (bkk-accounting)
Stack mirrors bkk-system: **Vite + React 19 + TS + Firebase (Auth + RTDB) + Tailwind**.
- `src/api/firebase.ts` — init `bkk-apple-tradein` from VITE_ env (same config keys as bkk-system).
  Same project ⇒ logging in here = same users (SSO).
- Auth/login screen + a `currentUser` with role from `/staff` (mirror bkk-system login), gate the
  whole app to **CEO + FINANCE**.
- A simple sidebar layout + ToastProvider (copy the minimal bits from bkk-system; don't import
  across repos).
- Router with the accounting routes below.

## 2. Move these files from bkk-system (copy, then delete from bkk-system in a separate PR)
Frontend:
- `src/pages/admin/AccountingSettings.tsx`  → settings (toggle/VAT/company/tax-invoice format/reset)
- `src/pages/admin/VatReport.tsx`           → ภ.พ.30 output-VAT report
- `src/pages/admin/FinancialReport.tsx`     → P&L + net VAT
- `src/pages/admin/GeneralLedger.tsx`       → double-entry journal + trial balance
- `src/utils/accounting.ts`                 → chart of accounts + helpers

Functions (→ new codebase `accounting`):
- `functions/email.js`                      → Resend client + templates + companyOf + serviceFeeBreakdown + normalizeStatus
- `functions/voucher-pdf.js`                → ใบสำคัญรับเงิน / ใบกำกับภาษี / ใบกำกับภาษีขาย (pdf-lib)
- `functions/assets/fonts/Sarabun-*.ttf` + `OFL.txt`  → Thai font (REQUIRED, else Thai = boxes)
- From `functions/index.js`, move these exports + helpers into the new codebase's index:
  - `onJobCreatedSendEmails` (onValueCreated /jobs/{jobId})
  - `onJobStatusEmail` (onValueUpdated /jobs/{jobId}/status)
  - `onSaleCreated` (onValueCreated /sales/{saleId})
  - helpers: `loadAccountingSettings`, `applyAccounting`, `bangkokYM`,
    `allocateTaxInvoiceNumber`, `writeAccountingDocument`,
    `ORDER_CREATED_STATUSES`, `ACTIVE_LEAD_STATUSES`
  - deps: `pdf-lib`, `@pdf-lib/fontkit` in functions/package.json; firebase-admin, firebase-functions

## 3. Functions codebase + deploy
- `firebase.json` in bkk-accounting: a functions entry with `"codebase": "accounting"`,
  `"source": "functions"`, region asia-southeast1. Deploy to project `bkk-apple-tradein`.
- Function names already unique project-wide (no collision with bkk-system / rider). Keep them.
- CI: GitHub Actions deploy `--only functions --project bkk-apple-tradein` (codebase accounting).
  Write `functions/.env` from secrets: RESEND_API_KEY, EMAIL_FROM, ORDER_NOTIFY_EMAIL,
  EMAIL_REPLY_TO?, CUSTOMER_TRACKING_BASE_URL?  (same as bkk-system today).
- Hosting: own target/site (e.g. accounting.bkkapple.com) — same project ⇒ shared Auth.

## 4. Rules (bkk-frontend-next, already deployed)
Already present + live: `accounting_documents`, `expenses`, `journal_entries` (admin read; indexes).
Add new accounting paths there if needed (PR to bkk-frontend-next; deploy-rules auto-deploys —
note it now deploys both DB+storage on every triggering push).

## 5. Remove from bkk-system (separate PR, after bkk-accounting is live)
- delete the 5 frontend files above + their routes in `src/App.tsx` + nav items in
  `src/components/layout/AdminLayout.tsx` (ตั้งค่าระบบบัญชี / รายงานภาษีขาย / รายงานการเงิน /
  สมุดรายวัน)
- delete the 3 triggers + helpers from `functions/index.js` and `functions/email.js`,
  `functions/voucher-pdf.js`, `functions/assets/fonts/*`, and the pdf-lib deps
- remove RESEND_/EMAIL_/ORDER_NOTIFY_/TELEGRAM (keep telegram) env lines that are accounting-only
  from `.github/workflows/firebase-hosting-deploy.yml`
- IMPORTANT: do this only AFTER bkk-accounting's functions are deployed, so the /jobs + /sales
  triggers keep firing continuously (no gap in tax-doc issuance).

## 6. Phase 4d remaining (build in bkk-accounting)
- 4d-2 auto-posting: cloud functions post balanced journal entries to /journal_entries from
  POS sales, order Paid, expenses (define posting rules per transaction type; get accountant sign-off).
- 4d-3 financial statements: งบกำไรขาดทุน (P&L) + งบดุล (balance sheet) from ledger balances.

## 7. Master gate stays
`settings/accounting/order_emails_enabled` gates everything (inert when false). Keep it.
