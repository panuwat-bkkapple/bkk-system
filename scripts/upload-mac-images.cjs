#!/usr/bin/env node

/**
 * BKK System — Download Apple Product Images & Upload to Firebase Storage
 *
 * ดึงรูปสินค้า Mac จาก Apple.com แล้วอัปโหลดให้ models ที่ยังไม่มีรูป
 *
 * Usage:
 *   node scripts/upload-mac-images.cjs --dry-run
 *   node scripts/upload-mac-images.cjs --email admin@bkkapple.com --password 123456
 *   node scripts/upload-mac-images.cjs --force --email admin@bkkapple.com --password 123456
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Load .env
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
// Configuration
// ---------------------------------------------------------------------------

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app';

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  '';

const FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.VITE_FIREBASE_STORAGE_BUCKET ||
  'bkk-apple-tradein.firebasestorage.app';

const REQUEST_TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Apple Product Image Mapping
//
// จับคู่ series/model name pattern กับ Apple product image URL
// หลาย model ใน series เดียวกันใช้รูปเดียวกัน
// ---------------------------------------------------------------------------

const IMAGE_MAPPING = [
  // === MacBook Pro 14" ===
  {
    pattern: /MacBook Pro 14.*M5 (Pro|Max).*2026/i,
    url: 'https://www.apple.com/v/macbook-pro/bp/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-14-2026.jpg',
  },
  {
    pattern: /MacBook Pro 14.*M5.*2025/i,
    url: 'https://www.apple.com/v/macbook-pro/bp/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-14-2025.jpg',
  },
  {
    pattern: /MacBook Pro 14.*M4.*2024/i,
    url: 'https://www.apple.com/v/macbook-pro/bo/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-14-2024.jpg',
  },
  {
    pattern: /MacBook Pro 14.*M3.*2023/i,
    url: 'https://www.apple.com/v/macbook-pro/bn/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-14-2023.jpg',
  },
  {
    pattern: /MacBook Pro 14.*M1.*2021/i,
    url: 'https://www.apple.com/v/macbook-pro/bk/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-14-2021.jpg',
  },

  // === MacBook Pro 16" ===
  {
    pattern: /MacBook Pro 16.*M5.*2026/i,
    url: 'https://www.apple.com/v/macbook-pro/bp/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-16-2026.jpg',
  },
  {
    pattern: /MacBook Pro 16.*M4.*2024/i,
    url: 'https://www.apple.com/v/macbook-pro/bo/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-16-2024.jpg',
  },
  {
    pattern: /MacBook Pro 16.*M3.*2023/i,
    url: 'https://www.apple.com/v/macbook-pro/bn/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-16-2023.jpg',
  },
  {
    pattern: /MacBook Pro 16.*M1.*2021/i,
    url: 'https://www.apple.com/v/macbook-pro/bk/images/overview/hero/intro__ewz1ro7xs1cm_large.jpg',
    filename: 'macbook-pro-16-2021.jpg',
  },
  {
    pattern: /MacBook Pro 16.*Intel.*2019/i,
    url: 'https://www.apple.com/v/macbook-pro/ac/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-16-2019.jpg',
  },

  // === MacBook Pro 15" ===
  {
    pattern: /MacBook Pro 15.*Intel.*(2018|2019)/i,
    url: 'https://www.apple.com/v/macbook-pro/ac/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-15-2018-2019.jpg',
  },
  {
    pattern: /MacBook Pro 15.*Intel.*2017/i,
    url: 'https://www.apple.com/v/macbook-pro/ac/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-15-2017.jpg',
  },

  // === MacBook Pro 13" ===
  {
    pattern: /MacBook Pro 13.*M2.*2022/i,
    url: 'https://www.apple.com/v/macbook-pro-13/f/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-13-m2-2022.jpg',
  },
  {
    pattern: /MacBook Pro 13.*M1.*2020/i,
    url: 'https://www.apple.com/v/macbook-pro-13/f/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-13-m1-2020.jpg',
  },
  {
    pattern: /MacBook Pro 13.*Intel.*2020/i,
    url: 'https://www.apple.com/v/macbook-pro-13/f/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-13-intel-2020.jpg',
  },
  {
    pattern: /MacBook Pro 13.*(Intel|Touch Bar).*(2018|2019)/i,
    url: 'https://www.apple.com/v/macbook-pro-13/f/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-13-2018-2019.jpg',
  },
  {
    pattern: /MacBook Pro 13.*Intel.*2017/i,
    url: 'https://www.apple.com/v/macbook-pro-13/f/images/overview/hero_endframe__bsza6x4fldiq_large.jpg',
    filename: 'macbook-pro-13-2017.jpg',
  },

  // === MacBook Air 13" ===
  {
    pattern: /MacBook Air 13.*M5.*2026/i,
    url: 'https://www.apple.com/v/macbook-air/s/images/overview/hero/hero_mba_m4__ghg4d2g4pnmi_large.jpg',
    filename: 'macbook-air-13-m5-2026.jpg',
  },
  {
    pattern: /MacBook Air 13.*M4.*2025/i,
    url: 'https://www.apple.com/v/macbook-air/s/images/overview/hero/hero_mba_m4__ghg4d2g4pnmi_large.jpg',
    filename: 'macbook-air-13-m4-2025.jpg',
  },
  {
    pattern: /MacBook Air 13.*M3.*2024/i,
    url: 'https://www.apple.com/v/macbook-air/r/images/overview/hero/hero_mba_m3__e93wxxe0aueu_large.jpg',
    filename: 'macbook-air-13-m3-2024.jpg',
  },
  {
    pattern: /MacBook Air 13.*M2.*2022/i,
    url: 'https://www.apple.com/v/macbook-air/q/images/overview/hero__gf3la5ct0gii_large.jpg',
    filename: 'macbook-air-13-m2-2022.jpg',
  },
  {
    pattern: /MacBook Air 13.*M1.*2020/i,
    url: 'https://www.apple.com/v/macbook-air/n/images/overview/hero__gnfk5g59t0qe_large.jpg',
    filename: 'macbook-air-13-m1-2020.jpg',
  },
  {
    pattern: /MacBook Air 13.*Intel.*(2019|2020)/i,
    url: 'https://www.apple.com/v/macbook-air/n/images/overview/hero__gnfk5g59t0qe_large.jpg',
    filename: 'macbook-air-13-intel-2019-2020.jpg',
  },
  {
    pattern: /MacBook Air 13.*Intel.*(2017|2018)/i,
    url: 'https://www.apple.com/v/macbook-air/n/images/overview/hero__gnfk5g59t0qe_large.jpg',
    filename: 'macbook-air-13-intel-2017-2018.jpg',
  },

  // === MacBook Air 15" ===
  {
    pattern: /MacBook Air 15.*M5.*2026/i,
    url: 'https://www.apple.com/v/macbook-air/s/images/overview/hero/hero_mba_m4__ghg4d2g4pnmi_large.jpg',
    filename: 'macbook-air-15-m5-2026.jpg',
  },
  {
    pattern: /MacBook Air 15.*M4.*2025/i,
    url: 'https://www.apple.com/v/macbook-air/s/images/overview/hero/hero_mba_m4__ghg4d2g4pnmi_large.jpg',
    filename: 'macbook-air-15-m4-2025.jpg',
  },
  {
    pattern: /MacBook Air 15.*M3.*2024/i,
    url: 'https://www.apple.com/v/macbook-air/r/images/overview/hero/hero_mba_m3__e93wxxe0aueu_large.jpg',
    filename: 'macbook-air-15-m3-2024.jpg',
  },
  {
    pattern: /MacBook Air 15.*M2.*2023/i,
    url: 'https://www.apple.com/v/macbook-air/q/images/overview/hero__gf3la5ct0gii_large.jpg',
    filename: 'macbook-air-15-m2-2023.jpg',
  },

  // === iMac 24" ===
  {
    pattern: /iMac 24.*M4.*2024/i,
    url: 'https://www.apple.com/v/imac/s/images/overview/hero/hero__b1otagxpiaby_large.jpg',
    filename: 'imac-24-m4-2024.jpg',
  },
  {
    pattern: /iMac 24.*M3.*2023/i,
    url: 'https://www.apple.com/v/imac/r/images/overview/hero/hero_endframe__fy4ib1gxnhaq_large.jpg',
    filename: 'imac-24-m3-2023.jpg',
  },
  {
    pattern: /iMac 24.*M1.*2021/i,
    url: 'https://www.apple.com/v/imac/p/images/overview/hero_endframe__focj2x30m5aq_large.jpg',
    filename: 'imac-24-m1-2021.jpg',
  },

  // === iMac 21.5" ===
  {
    pattern: /iMac 21\.5.*Intel.*2019/i,
    url: 'https://www.apple.com/v/imac/p/images/overview/hero_endframe__focj2x30m5aq_large.jpg',
    filename: 'imac-21-5-2019.jpg',
  },
  {
    pattern: /iMac 21\.5.*Intel.*2017/i,
    url: 'https://www.apple.com/v/imac/p/images/overview/hero_endframe__focj2x30m5aq_large.jpg',
    filename: 'imac-21-5-2017.jpg',
  },

  // === iMac 27" ===
  {
    pattern: /iMac 27.*Intel.*(2019|2020)/i,
    url: 'https://www.apple.com/v/imac/p/images/overview/hero_endframe__focj2x30m5aq_large.jpg',
    filename: 'imac-27-2019-2020.jpg',
  },
  {
    pattern: /iMac 27.*Intel.*2017/i,
    url: 'https://www.apple.com/v/imac/p/images/overview/hero_endframe__focj2x30m5aq_large.jpg',
    filename: 'imac-27-2017.jpg',
  },

  // === Mac mini ===
  {
    pattern: /Mac mini.*M4.*2024/i,
    url: 'https://www.apple.com/v/mac-mini/r/images/overview/hero/hero__fz0ppwmuqceq_large.jpg',
    filename: 'mac-mini-m4-2024.jpg',
  },
  {
    pattern: /Mac mini.*M2.*2023/i,
    url: 'https://www.apple.com/v/mac-mini/q/images/overview/hero_endframe__gkpzdrk7i5aq_large.jpg',
    filename: 'mac-mini-m2-2023.jpg',
  },
  {
    pattern: /Mac mini.*M1.*2020/i,
    url: 'https://www.apple.com/v/mac-mini/p/images/overview/hero_endframe__gkpzdrk7i5aq_large.jpg',
    filename: 'mac-mini-m1-2020.jpg',
  },
  {
    pattern: /Mac mini.*Intel.*2018/i,
    url: 'https://www.apple.com/v/mac-mini/p/images/overview/hero_endframe__gkpzdrk7i5aq_large.jpg',
    filename: 'mac-mini-intel-2018.jpg',
  },
];

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    force: false,
    email: process.env.FIREBASE_AUTH_EMAIL || '',
    password: process.env.FIREBASE_AUTH_PASSWORD || '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--force':
        opts.force = true;
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
  --dry-run            Preview only — do not upload or update
  --force              Update imageUrl even for models that already have one
  --email <email>      Firebase admin email (or set FIREBASE_AUTH_EMAIL)
  --password <pass>    Firebase admin password (or set FIREBASE_AUTH_PASSWORD)
  --help               Show this help message
`);
        process.exit(0);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// HTTP helpers
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ...headers,
      },
    };

    const req = transport.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpRequest(res.headers.location, method, headers, body).then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, data: buffer, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Request timeout: ${method} ${parsedUrl.pathname}`));
    });

    if (body) req.write(typeof body === 'string' ? body : body);
    req.end();
  });
}

function httpRequestJSON(url, method, headers, body) {
  return httpRequest(url, method, { 'Content-Type': 'application/json', ...headers },
    body ? JSON.stringify(body) : undefined
  ).then((res) => {
    const parsed = JSON.parse(res.data.toString('utf-8'));
    if (res.status >= 200 && res.status < 300) return parsed;
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(parsed)}`);
  });
}

// ---------------------------------------------------------------------------
// Firebase Auth
// ---------------------------------------------------------------------------

async function signInWithEmailPassword(email, password) {
  if (!FIREBASE_API_KEY) {
    throw new Error('FIREBASE_API_KEY is not set. Cannot authenticate.');
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const res = await httpRequest(url, 'POST', { 'Content-Type': 'application/json' },
    JSON.stringify({ email, password, returnSecureToken: true })
  );

  const parsed = JSON.parse(res.data.toString('utf-8'));
  if (res.status !== 200) {
    throw new Error(`Firebase Auth failed: ${parsed?.error?.message || JSON.stringify(parsed)}`);
  }
  return parsed.idToken;
}

// ---------------------------------------------------------------------------
// Firebase RTDB
// ---------------------------------------------------------------------------

function firebaseDBRequest(method, dbPath, body, authToken) {
  let url = `${FIREBASE_DATABASE_URL}${dbPath}.json`;
  if (authToken) url += `?auth=${authToken}`;
  return httpRequestJSON(url, method, {}, body);
}

// ---------------------------------------------------------------------------
// Firebase Storage — upload via REST API
// ---------------------------------------------------------------------------

async function uploadToFirebaseStorage(fileBuffer, storagePath, contentType, authToken) {
  const encodedPath = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_STORAGE_BUCKET}/o/${encodedPath}`;

  const res = await httpRequest(url, 'POST', {
    'Content-Type': contentType,
    'Authorization': `Bearer ${authToken}`,
  }, fileBuffer);

  if (res.status < 200 || res.status >= 300) {
    const body = res.data.toString('utf-8');
    throw new Error(`Storage upload failed (${res.status}): ${body}`);
  }

  const metadata = JSON.parse(res.data.toString('utf-8'));
  // Generate the public download URL with token
  const downloadToken = metadata.downloadTokens;
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
  return downloadUrl;
}

// ---------------------------------------------------------------------------
// Download image from URL
// ---------------------------------------------------------------------------

async function downloadImage(url, retryCount = 0) {
  try {
    const res = await httpRequest(url, 'GET', {}, null);
    if (res.status !== 200) {
      throw new Error(`Download failed: HTTP ${res.status}`);
    }
    const contentType = res.headers['content-type'] || 'image/jpeg';
    return { buffer: res.data, contentType };
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`      ⚠️  Retry in ${delay}ms... (${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      return downloadImage(url, retryCount + 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Match model name to image mapping
// ---------------------------------------------------------------------------

function findImageForModel(modelName) {
  for (const mapping of IMAGE_MAPPING) {
    if (mapping.pattern.test(modelName)) {
      return mapping;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(60));
  console.log('  BKK System — Mac Product Image Uploader');
  console.log('='.repeat(60));
  console.log(`  Dry-run:    ${opts.dryRun ? 'YES (preview only)' : 'NO (will upload & update)'}`);
  console.log(`  Force:      ${opts.force ? 'YES (overwrite existing images)' : 'NO (skip models with images)'}`);
  console.log(`  Database:   ${FIREBASE_DATABASE_URL}`);
  console.log(`  Storage:    ${FIREBASE_STORAGE_BUCKET}`);
  console.log(`  Auth:       ${opts.email || '(none)'}`);
  console.log('='.repeat(60));
  console.log();

  // 1. Fetch existing models
  console.log('📡 Fetching models from Firebase...');
  const modelsData = await firebaseDBRequest('GET', '/models', null, null);
  if (!modelsData) {
    console.error('❌ No models found in Firebase.');
    process.exit(1);
  }

  const allModels = Object.entries(modelsData)
    .filter(([, m]) => m && typeof m === 'object')
    .map(([key, m]) => ({ fbKey: key, ...m }));

  // 2. Filter Mac / Laptop models
  const macModels = allModels.filter((m) => m.category === 'Mac / Laptop');
  console.log(`📦 Found ${macModels.length} Mac / Laptop models total.`);

  // 3. Filter models needing images
  const needsImage = opts.force
    ? macModels
    : macModels.filter((m) => !m.imageUrl || m.imageUrl.trim() === '');
  console.log(`🖼️  Models needing images: ${needsImage.length}`);

  if (needsImage.length === 0) {
    console.log('\n✅ All Mac models already have images.');
    process.exit(0);
  }

  // 4. Match models to Apple images
  const tasks = [];
  const noMatch = [];

  for (const model of needsImage) {
    const mapping = findImageForModel(model.name);
    if (mapping) {
      tasks.push({ model, mapping });
    } else {
      noMatch.push(model.name);
    }
  }

  console.log(`✅ Matched: ${tasks.length} models`);
  if (noMatch.length > 0) {
    console.log(`⚠️  No image match: ${noMatch.length} models`);
    for (const name of noMatch.slice(0, 10)) {
      console.log(`     - ${name}`);
    }
    if (noMatch.length > 10) console.log(`     ... and ${noMatch.length - 10} more`);
  }
  console.log();

  // 5. Deduplicate downloads (same filename = same image)
  const uniqueImages = new Map();
  for (const task of tasks) {
    const fn = task.mapping.filename;
    if (!uniqueImages.has(fn)) {
      uniqueImages.set(fn, task.mapping);
    }
  }
  console.log(`📥 Unique images to download: ${uniqueImages.size}\n`);

  // Summary
  console.log('─'.repeat(60));
  console.log('  PLAN');
  console.log('─'.repeat(60));
  for (const task of tasks.slice(0, 20)) {
    console.log(`  ${task.model.name}`);
    console.log(`    → ${task.mapping.filename}`);
  }
  if (tasks.length > 20) console.log(`  ... and ${tasks.length - 20} more`);
  console.log('─'.repeat(60));

  if (opts.dryRun) {
    console.log('\n🔍 DRY-RUN MODE — No changes made.');
    console.log(`   Would download ${uniqueImages.size} images and update ${tasks.length} models.`);
    process.exit(0);
  }

  // 6. Authenticate
  if (!opts.email || !opts.password) {
    console.error('\n❌ Write requires admin authentication. Use --email and --password.');
    process.exit(1);
  }

  console.log('\n🔐 Authenticating...');
  const authToken = await signInWithEmailPassword(opts.email, opts.password);
  console.log('   ✅ Authenticated.\n');

  // 7. Download images & upload to Firebase Storage
  const imageUrlCache = new Map(); // filename → Firebase Storage download URL
  const stats = { downloaded: 0, uploaded: 0, updated: 0, skipped: 0, errors: 0 };

  console.log('📥 Downloading & uploading images...\n');

  for (const [filename, mapping] of uniqueImages) {
    process.stdout.write(`   ${filename}... `);

    try {
      // Download from Apple CDN
      const { buffer, contentType } = await downloadImage(mapping.url);
      stats.downloaded++;

      // Upload to Firebase Storage
      const storagePath = `product-images/${Date.now()}_${filename}`;
      const downloadUrl = await uploadToFirebaseStorage(buffer, storagePath, contentType, authToken);
      imageUrlCache.set(filename, downloadUrl);
      stats.uploaded++;

      console.log(`✅ (${(buffer.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.log(`❌ ${err.message}`);
      stats.errors++;
    }

    // Brief pause to avoid rate limiting
    await sleep(500);
  }

  console.log(`\n📤 Downloaded: ${stats.downloaded}, Uploaded: ${stats.uploaded}, Errors: ${stats.errors}\n`);

  // 8. Update imageUrl in RTDB
  console.log('📝 Updating models in Firebase RTDB...\n');

  const updates = {};
  for (const task of tasks) {
    const downloadUrl = imageUrlCache.get(task.mapping.filename);
    if (!downloadUrl) {
      stats.skipped++;
      continue;
    }
    updates[`models/${task.model.fbKey}/imageUrl`] = downloadUrl;
    stats.updated++;
  }

  if (Object.keys(updates).length > 0) {
    try {
      await firebaseDBRequest('PATCH', '/', updates, authToken);
      console.log(`   ✅ Updated ${stats.updated} models.\n`);
    } catch (err) {
      console.error(`   ❌ RTDB update failed: ${err.message}`);
      stats.errors++;
    }
  }

  // 9. Final report
  console.log('='.repeat(60));
  console.log('  FINAL REPORT');
  console.log('='.repeat(60));
  console.log(`  Images downloaded:   ${stats.downloaded}`);
  console.log(`  Images uploaded:     ${stats.uploaded}`);
  console.log(`  Models updated:      ${stats.updated}`);
  console.log(`  Models skipped:      ${stats.skipped}`);
  console.log(`  Errors:              ${stats.errors}`);
  console.log(`  Status:              ${stats.errors === 0 ? '✅ SUCCESS' : '⚠️  COMPLETED WITH ERRORS'}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
