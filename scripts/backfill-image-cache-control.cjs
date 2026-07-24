#!/usr/bin/env node
/**
 * Backfill Cache-Control metadata ให้รูปที่อัปโหลดไว้ก่อนหน้า (product-images/)
 *
 * ปัญหา: ไฟล์เก่าไม่มี cacheControl metadata → Firebase เสิร์ฟ `private, max-age=0`
 * → browser ลูกค้า cache ไม่ได้เลย ทุก pageview ต้องยิง network ใหม่ และเป็นเหตุให้
 * เห็นรูปแตกทันทีที่ optimizer/เน็ตสะดุด. ไฟล์ทั้งหมดชื่อเป็น timestamp (immutable)
 * จึงตั้ง `public, max-age=31536000, immutable` ได้ปลอดภัย
 *
 * วิธีรัน (ครั้งเดียว จากเครื่องที่มี service account):
 *   cd functions && npm ci   (ถ้ายังไม่มี node_modules)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node ../scripts/backfill-image-cache-control.cjs
 *
 * หรือถ้ามี gsutil อยู่แล้ว ใช้คำสั่งเดียวเทียบเท่า:
 *   gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" \
 *     "gs://bkk-apple-tradein.firebasestorage.app/product-images/*"
 */
const admin = require(require('path').join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const BUCKET = process.env.STORAGE_BUCKET || 'bkk-apple-tradein.firebasestorage.app';
const PREFIX = process.env.PREFIX || 'product-images/';
const CACHE = 'public, max-age=31536000, immutable';

async function main() {
  admin.initializeApp({ storageBucket: BUCKET });
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  console.log(`found ${files.length} files under ${PREFIX}`);
  let updated = 0, skipped = 0, failed = 0;
  for (const file of files) {
    const current = file.metadata.cacheControl || '';
    if (current === CACHE) { skipped++; continue; }
    try {
      await file.setMetadata({ cacheControl: CACHE });
      updated++;
      console.log(`updated  ${file.name} (was: ${current || 'unset'})`);
    } catch (e) {
      failed++;
      console.error(`FAILED   ${file.name}: ${e.message}`);
    }
  }
  console.log(`done — updated ${updated}, already-ok ${skipped}, failed ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
