#!/usr/bin/env node

/**
 * BKK System — Bulk Upload Mac Products from CSV to Firebase Realtime Database
 *
 * ใช้สำหรับ import ข้อมูลสินค้า Mac จากไฟล์ CSV เข้า Firebase RTDB
 * โดยจะ **ไม่เขียนทับ** ข้อมูลที่มีอยู่แล้ว (INSERT-only)
 *
 * Usage:
 *   node scripts/bulk-upload-mac-products.cjs --file ./BKK_Mac_Products_2017-2026.csv --dry-run
 *   node scripts/bulk-upload-mac-products.cjs --file ./BKK_Mac_Products_2017-2026.csv --email admin@example.com --password secret
 *   node scripts/bulk-upload-mac-products.cjs --file ./BKK_Mac_Products_2017-2026.csv --batch-size 200
 *
 * Environment variables (alternative to CLI flags):
 *   FIREBASE_AUTH_EMAIL     — Admin email for Firebase Auth
 *   FIREBASE_AUTH_PASSWORD  — Admin password for Firebase Auth
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Load .env from project root
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

// ---------------------------------------------------------------------------
// Configuration — matches existing codebase (src/api/firebase.ts, .env)
// ---------------------------------------------------------------------------

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app';

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  '';

// Mac / Laptop attribute schema — from src/features/trade-in/constants/categorySchemas.ts
const MAC_LAPTOP_SCHEMA = [
  { key: 'processor', label: 'Processor (ชิป)', type: 'text' },
  { key: 'ram', label: 'RAM (หน่วยความจำ)', type: 'text' },
  { key: 'storage', label: 'Storage (ความจุ)', type: 'text' },
  { key: 'display', label: 'Display (จอ)', type: 'select', options: ['Standard Glass', 'Nano-Texture'] },
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 60000;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    file: null,
    dryRun: false,
    batchSize: 500,
    email: process.env.FIREBASE_AUTH_EMAIL || '',
    password: process.env.FIREBASE_AUTH_PASSWORD || '',
    skipFetch: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        opts.file = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--batch-size':
        opts.batchSize = parseInt(args[++i], 10) || 500;
        break;
      case '--skip-fetch':
        opts.skipFetch = true;
        break;
      case '--email':
        opts.email = args[++i];
        break;
      case '--password':
        opts.password = args[++i];
        break;
      case '--help':
        console.log(`
Usage: node ${path.basename(__filename)} [options]

Options:
  --file <path>        Path to the CSV file (required)
  --dry-run            Preview only — do not write to Firebase
  --batch-size <n>     Records per batch (default: 500, max: 500)
  --skip-fetch         Skip fetching existing data (treat all as new)
  --email <email>      Firebase admin email (or set FIREBASE_AUTH_EMAIL)
  --password <pass>    Firebase admin password (or set FIREBASE_AUTH_PASSWORD)
  --help               Show this help message

Note: Read (GET /models) is public. Write requires admin authentication.
      Auth is only needed for actual upload (not for --dry-run).
`);
        process.exit(0);
    }
  }

  if (!opts.file) {
    console.error('Error: --file is required. Use --help for usage.');
    process.exit(1);
  }

  if (opts.batchSize > 500) opts.batchSize = 500;
  return opts;
}

// ---------------------------------------------------------------------------
// CSV Parser (handles quoted fields with embedded commas and quotes)
// ---------------------------------------------------------------------------

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function readCSV(filePath) {
  let raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    console.error('CSV file has no data rows.');
    process.exit(1);
  }

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

function generateVariantKey(modelName, processor, ram, storage, display) {
  const raw = [modelName, processor, ram, storage, display]
    .map((s) => (s || '').trim().toLowerCase())
    .join('|');
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
}

function generateModelKey(modelName) {
  const sanitized = modelName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hash = crypto
    .createHash('md5')
    .update(modelName.trim())
    .digest('hex')
    .slice(0, 8);
  return `${sanitized}-${hash}`;
}

// ---------------------------------------------------------------------------
// Group CSV rows into models → variants
// ---------------------------------------------------------------------------

function groupByModel(rows) {
  const modelMap = new Map();

  for (const row of rows) {
    const modelName = row['Model Name'] || '';
    const brand = row['Brand'] || 'Apple';
    const series = row['Series'] || '';
    const processor = row['Processor (ชิป)'] || '';
    const ram = row['RAM (หน่วยความจำ)'] || '';
    const storage = row['Storage (ความจุ)'] || '';
    const display = row['Display (จอ)'] || '';
    const newPriceRaw = (row['ราคาเครื่องจัด (฿)'] || '0').replace(/[^0-9]/g, '');
    const usedPriceRaw = (row['ราคาท็อปมือสอง (฿)'] || '0').replace(/[^0-9]/g, '');
    const inStore = (row['In-Store'] || 'Y').toUpperCase() === 'Y';
    const pickup = (row['Pickup'] || 'Y').toUpperCase() === 'Y';
    const mailIn = (row['Mail-in'] || 'Y').toUpperCase() === 'Y';
    const conditionItem = row['Condition Item'] || '';

    if (!modelName) continue;

    const modelKey = generateModelKey(modelName);

    if (!modelMap.has(modelKey)) {
      modelMap.set(modelKey, {
        modelKey,
        modelName,
        brand,
        series,
        inStore,
        pickup,
        mailIn,
        conditionItem,
        variants: [],
      });
    }

    const variantId = generateVariantKey(modelName, processor, ram, storage, display);
    const attrParts = [processor, ram, storage, display].filter(Boolean);
    const variantName = attrParts.join(' | ');

    modelMap.get(modelKey).variants.push({
      id: variantId,
      name: variantName,
      attributes: {
        processor,
        ram,
        storage,
        display,
      },
      price: parseInt(newPriceRaw, 10) || 0,
      usedPrice: parseInt(usedPriceRaw, 10) || 0,
    });
  }

  return modelMap;
}

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Request timeout: ${method} ${parsedUrl.pathname}`));
    });

    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Firebase Auth — sign in with email/password
// ---------------------------------------------------------------------------

async function signInWithEmailPassword(email, password) {
  if (!FIREBASE_API_KEY) {
    throw new Error('FIREBASE_API_KEY (VITE_FIREBASE_API_KEY) is not set. Cannot authenticate.');
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const res = await httpRequest(url, 'POST', {}, {
    email,
    password,
    returnSecureToken: true,
  });

  if (res.status !== 200) {
    const errMsg = res.data?.error?.message || JSON.stringify(res.data);
    throw new Error(`Firebase Auth failed: ${errMsg}`);
  }

  return res.data.idToken;
}

// ---------------------------------------------------------------------------
// Firebase RTDB REST API
// ---------------------------------------------------------------------------

function firebaseRequest(method, dbPath, body, authToken) {
  let url = `${FIREBASE_DATABASE_URL}${dbPath}.json`;
  if (authToken) url += `?auth=${authToken}`;

  return httpRequest(url, method, {}, body).then((res) => {
    if (res.status >= 200 && res.status < 300) return res.data;
    throw new Error(`Firebase ${method} ${dbPath}: ${res.status} — ${JSON.stringify(res.data)}`);
  });
}

async function fetchExistingModels(authToken) {
  console.log('📡 Fetching existing models from Firebase...');
  const data = await firebaseRequest('GET', '/models', null, authToken);
  return data || {};
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

function buildExistingVariantKeys(existingModels) {
  const keys = new Set();

  for (const [, model] of Object.entries(existingModels)) {
    if (!model || typeof model !== 'object') continue;
    if (!model.variants || !Array.isArray(model.variants)) continue;
    const modelName = model.name || '';

    for (const v of model.variants) {
      if (!v) continue;
      const attrs = v.attributes || {};
      const key = [
        modelName,
        attrs.processor || '',
        attrs.ram || '',
        attrs.storage || '',
        attrs.display || '',
      ]
        .map((s) => s.trim().toLowerCase())
        .join('|');
      keys.add(key);
    }
  }
  return keys;
}

function isVariantDuplicate(existingKeys, modelName, variant) {
  const attrs = variant.attributes || {};
  const key = [
    modelName,
    attrs.processor || '',
    attrs.ram || '',
    attrs.storage || '',
    attrs.display || '',
  ]
    .map((s) => s.trim().toLowerCase())
    .join('|');
  return existingKeys.has(key);
}

function buildExistingModelMap(existingModels) {
  const map = new Map();
  for (const [fbKey, model] of Object.entries(existingModels)) {
    if (!model || typeof model !== 'object') continue;
    const modelKey = generateModelKey(model.name || '');
    map.set(modelKey, { fbKey, ...model });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Batch upload with retry
// ---------------------------------------------------------------------------

async function uploadBatch(updates, authToken, retryCount = 0) {
  try {
    await firebaseRequest('PATCH', '', updates, authToken);
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`\n   ⚠️  Batch failed, retrying in ${delay}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      return uploadBatch(updates, authToken, retryCount + 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(60));
  console.log('  BKK System — Bulk Upload Mac Products');
  console.log('='.repeat(60));
  console.log(`  File:       ${opts.file}`);
  console.log(`  Dry-run:    ${opts.dryRun ? 'YES (preview only)' : 'NO (will write to Firebase)'}`);
  console.log(`  Batch size: ${opts.batchSize}`);
  console.log(`  Database:   ${FIREBASE_DATABASE_URL}`);
  console.log(`  Auth:       ${opts.email ? opts.email : '(none — public read only)'}`);
  console.log('='.repeat(60));
  console.log();

  // 1. Read CSV
  const csvPath = path.resolve(opts.file);
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File not found: ${csvPath}`);
    process.exit(1);
  }

  const rows = readCSV(csvPath);
  console.log(`📄 Read ${rows.length} rows from CSV.`);

  // Safety: confirm if > 5000 rows
  if (rows.length > 5000 && !opts.dryRun) {
    console.log(`\n⚠️  WARNING: File has ${rows.length} rows (> 5,000). This is a large upload.`);
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((res) => rl.question('Continue? (yes/no): ', res));
    rl.close();
    if (answer.toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // 2. Group by model
  const modelMap = groupByModel(rows);
  console.log(`📦 Grouped into ${modelMap.size} unique models.\n`);

  // 3. Authenticate if needed (read is public, write needs admin)
  let authToken = null;

  // 4. Fetch existing data from Firebase (public read)
  let existingModels = {};
  if (opts.skipFetch) {
    console.log('⏩ Skipping fetch — treating all records as new.\n');
  } else {
    existingModels = await fetchExistingModels(authToken);
    const existingModelCount = Object.keys(existingModels).length;
    console.log(`🔍 Found ${existingModelCount} existing models in Firebase.\n`);
  }

  const existingVariantKeys = buildExistingVariantKeys(existingModels);
  const existingModelLookup = buildExistingModelMap(existingModels);

  // 5. Determine what to insert vs skip
  const stats = { totalVariants: 0, toInsert: 0, toSkip: 0, newModels: 0, existingModelsUpdated: 0, errors: 0 };
  const updates = {};

  for (const [modelKey, modelData] of modelMap) {
    const newVariants = [];

    for (const variant of modelData.variants) {
      stats.totalVariants++;
      if (isVariantDuplicate(existingVariantKeys, modelData.modelName, variant)) {
        stats.toSkip++;
      } else {
        stats.toInsert++;
        newVariants.push(variant);
      }
    }

    if (newVariants.length === 0) continue;

    const existingModel = existingModelLookup.get(modelKey);

    if (existingModel) {
      // Model exists — merge new variants into existing variants array
      stats.existingModelsUpdated++;
      const fbKey = existingModel.fbKey;
      const existingVariants = Array.isArray(existingModel.variants) ? existingModel.variants : [];
      const mergedVariants = [...existingVariants, ...newVariants];
      updates[`models/${fbKey}/variants`] = mergedVariants;
      updates[`models/${fbKey}/updatedAt`] = Date.now();
    } else {
      // Brand new model
      stats.newModels++;
      const newFbKey = `mac_${modelKey}`;

      updates[`models/${newFbKey}`] = {
        brand: modelData.brand,
        category: 'Mac / Laptop',
        series: modelData.series,
        name: modelData.modelName,
        imageUrl: '',
        isActive: true,
        isFeatured: false,
        inStore: modelData.inStore,
        pickup: modelData.pickup,
        mailIn: modelData.mailIn,
        conditionSetId: '',
        attributesSchema: MAC_LAPTOP_SCHEMA,
        variants: newVariants,
        updatedAt: Date.now(),
      };
    }
  }

  // 6. Summary
  console.log('─'.repeat(60));
  console.log('  SUMMARY');
  console.log('─'.repeat(60));
  console.log(`  Total CSV rows:            ${rows.length}`);
  console.log(`  Total variants:            ${stats.totalVariants}`);
  console.log(`  Variants to INSERT:        ${stats.toInsert}`);
  console.log(`  Variants to SKIP:          ${stats.toSkip}`);
  console.log(`  New models to create:      ${stats.newModels}`);
  console.log(`  Existing models to update: ${stats.existingModelsUpdated}`);
  console.log('─'.repeat(60));

  if (stats.totalVariants > 0 && stats.toSkip / stats.totalVariants > 0.9) {
    console.log('\n⚠️  WARNING: More than 90% of records already exist in Firebase.');
    console.log('   Most data has already been uploaded.\n');
  }

  if (stats.toInsert === 0) {
    console.log('\n✅ Nothing to insert. All records already exist in Firebase.');
    process.exit(0);
  }

  if (opts.dryRun) {
    console.log('\n🔍 DRY-RUN MODE — No changes written to Firebase.');
    console.log(`   Would insert ${stats.toInsert} new variants across ${stats.newModels} new + ${stats.existingModelsUpdated} existing models.`);

    const updateKeys = Object.keys(updates);
    const modelPaths = [...new Set(updateKeys.map((k) => k.split('/').slice(0, 2).join('/')))];
    console.log(`\n   Models affected (${modelPaths.length}):`);
    for (const mp of modelPaths.slice(0, 30)) {
      console.log(`     - ${mp}`);
    }
    if (modelPaths.length > 30) {
      console.log(`     ... and ${modelPaths.length - 30} more`);
    }
    process.exit(0);
  }

  // 7. Authenticate for write
  if (!opts.email || !opts.password) {
    console.error('\n❌ Write requires admin authentication.');
    console.error('   Use --email and --password, or set FIREBASE_AUTH_EMAIL / FIREBASE_AUTH_PASSWORD env vars.');
    process.exit(1);
  }

  console.log('\n🔐 Authenticating...');
  authToken = await signInWithEmailPassword(opts.email, opts.password);
  console.log('   ✅ Authenticated successfully.\n');

  // 8. Execute batched upload
  console.log('🚀 Uploading to Firebase...');

  const updateEntries = Object.entries(updates);
  const totalBatches = Math.ceil(updateEntries.length / opts.batchSize);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const start = batchIdx * opts.batchSize;
    const end = Math.min(start + opts.batchSize, updateEntries.length);
    const batchEntries = updateEntries.slice(start, end);
    const batchPayload = Object.fromEntries(batchEntries);

    const progress = `[${batchIdx + 1}/${totalBatches}]`;
    process.stdout.write(`   ${progress} Uploading ${batchEntries.length} paths... `);

    try {
      await uploadBatch(batchPayload, authToken);
      console.log('✅');
    } catch (err) {
      console.log('❌');
      console.error(`   Error: ${err.message}`);
      stats.errors++;
    }
  }

  // 9. Final report
  console.log('\n' + '='.repeat(60));
  console.log('  FINAL REPORT');
  console.log('='.repeat(60));
  console.log(`  Variants inserted:  ${stats.toInsert}`);
  console.log(`  Variants skipped:   ${stats.toSkip}`);
  console.log(`  New models:         ${stats.newModels}`);
  console.log(`  Updated models:     ${stats.existingModelsUpdated}`);
  console.log(`  Batch errors:       ${stats.errors}`);
  console.log(`  Status:             ${stats.errors === 0 ? '✅ SUCCESS' : '⚠️  COMPLETED WITH ERRORS'}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
