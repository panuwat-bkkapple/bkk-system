// ---------------------------------------------------------------------------
// Import the discontinued-models seed into RTDB /models. REQUIRES admin creds.
//
// Dry-run (default, writes nothing):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json \
//     node functions/scripts/import-discontinued-seed.mjs
//
// Actually write:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json \
//     node functions/scripts/import-discontinued-seed.mjs --commit
//
// Safe to re-run: it skips any model whose name already exists in /models
// (deduped against LIVE data, not just the snapshot).
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import admin from "firebase-admin";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes("--commit");
const DB_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app";

const seed = JSON.parse(readFileSync(join(__dirname, "discontinued-seed.json"), "utf8"));

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: DB_URL,
});
const db = admin.database();

const snap = await db.ref("models").once("value");
const existingNames = new Set();
snap.forEach((c) => {
  const n = c.val() && c.val().name;
  if (n) existingNames.add(String(n).trim());
});

const toAdd = seed.filter((m) => !existingNames.has(m.name.trim()));
const skipped = seed.filter((m) => existingNames.has(m.name.trim())).map((m) => m.name);

console.log(`Live models: ${existingNames.size}`);
console.log(`Seed models: ${seed.length}  |  new: ${toAdd.length}  |  skip(existing): ${skipped.length}`);
if (skipped.length) console.log("Skip:", skipped.join(", "));
console.log(toAdd.map((m) => `  + ${m.category} · ${m.name}`).join("\n"));

if (!COMMIT) {
  console.log("\nDRY RUN — nothing written. Re-run with --commit to import.");
  process.exit(0);
}

const now = Date.now();
let n = 0;
for (const m of toAdd) {
  await db.ref("models").push({ ...m, updatedAt: now });
  n++;
}
console.log(`\nImported ${n} discontinued models (isActive:false).`);
process.exit(0);
