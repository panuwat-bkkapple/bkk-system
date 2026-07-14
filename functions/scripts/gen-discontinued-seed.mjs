// ---------------------------------------------------------------------------
// Generate a seed of DISCONTINUED ("งดรับซื้อ", isActive:false) Apple models
// to import into RTDB /models. These become greyed-out SEO/marketing pages on
// the customer site and let the chat AI decline them directly (no escalation).
//
//   node functions/scripts/gen-discontinued-seed.mjs
//     -> writes functions/scripts/discontinued-seed.json
//
// Shape mirrors a real model (see iPhone 13 mini). All prices 0, imageUrl ""
// (images added later via PriceEditor). Import is a SEPARATE step that needs
// admin credentials — see import-discontinued-seed.mjs.
//
// Covers iPhone (<=X + SE), Apple Watch (Series 3-7), iPad (older gens).
// Mac is intentionally excluded here — its lineup is entangled with existing
// entries and needs a careful, deduped pass of its own.
// ---------------------------------------------------------------------------

import { writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Names already in the catalogue (to skip) — dumped from the live snapshot.
let existing = new Set();
try {
  existing = new Set(
    readFileSync(join(__dirname, "existing_names.txt"), "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  );
} catch {
  console.warn("existing_names.txt not found — no dedup applied");
}

const FLAGS = { inStore: true, pickup: true, mailIn: true, isFeatured: false };

function iphone(name, series, storages) {
  return {
    name,
    brand: "Apple",
    category: "Smartphones",
    series,
    conditionSetId: "iphone_standard_set",
    pricingMode: "legacy",
    isActive: false,
    imageUrl: "",
    ...FLAGS,
    attributesSchema: [{ key: "storage", label: "Storage (ความจุ)", type: "text" }],
    variants: storages.map((s) => ({
      name: s,
      attributes: { storage: s },
      usedPrice: 0,
      newPrice: 0,
    })),
  };
}

function watch(name, sizes) {
  return {
    name,
    brand: "Apple",
    category: "Smart Watch",
    series: "Series",
    conditionSetId: "watch_standard_set",
    pricingMode: "legacy",
    isActive: false,
    imageUrl: "",
    ...FLAGS,
    attributesSchema: [
      { key: "size", label: "Size (ขนาด)", type: "text" },
      { key: "case_material", label: "Case (วัสดุ)", type: "select", options: ["Aluminium", "Stainless Steel", "Titanium", "Black Titanium"] },
      { key: "connectivity", label: "Network (ระบบ)", type: "select", options: ["GPS", "GPS + Cellular"] },
    ],
    variants: sizes.map((s) => ({
      name: s,
      attributes: { size: s, case_material: "Aluminium", connectivity: "GPS" },
      usedPrice: 0,
      newPrice: 0,
    })),
  };
}

function ipad(name, storages) {
  return {
    name,
    brand: "Apple",
    category: "Tablets",
    series: name,
    conditionSetId: "ipad_standard_set",
    pricingMode: "legacy",
    isActive: false,
    imageUrl: "",
    ...FLAGS,
    attributesSchema: [
      { key: "connectivity", label: "Network (เครือข่าย)", type: "select", options: ["Wi-Fi", "Wi-Fi + Cellular"] },
      { key: "storage", label: "Storage (ความจุ)", type: "text" },
    ],
    variants: storages.map((s) => ({
      name: s,
      attributes: { connectivity: "Wi-Fi", storage: s },
      usedPrice: 0,
      newPrice: 0,
    })),
  };
}

const models = [
  // ---- iPhone: everything below the current buy-floor (iPhone 11) + SE ----
  iphone("iPhone X", "iPhone X Series", ["64GB", "256GB"]),
  iphone("iPhone XR", "iPhone XR Series", ["64GB", "128GB", "256GB"]),
  iphone("iPhone XS", "iPhone XS Series", ["64GB", "256GB", "512GB"]),
  iphone("iPhone XS Max", "iPhone XS Series", ["64GB", "256GB", "512GB"]),
  iphone("iPhone 8", "iPhone 8 Series", ["64GB", "256GB"]),
  iphone("iPhone 8 Plus", "iPhone 8 Series", ["64GB", "256GB"]),
  iphone("iPhone 7", "iPhone 7 Series", ["32GB", "128GB", "256GB"]),
  iphone("iPhone 7 Plus", "iPhone 7 Series", ["32GB", "128GB", "256GB"]),
  iphone("iPhone 6s", "iPhone 6s Series", ["16GB", "32GB", "64GB", "128GB"]),
  iphone("iPhone 6s Plus", "iPhone 6s Series", ["16GB", "32GB", "64GB", "128GB"]),
  iphone("iPhone 6", "iPhone 6 Series", ["16GB", "32GB", "64GB", "128GB"]),
  iphone("iPhone 6 Plus", "iPhone 6 Series", ["16GB", "64GB", "128GB"]),
  iphone("iPhone SE (2016)", "iPhone SE Series", ["16GB", "32GB", "64GB", "128GB"]),
  iphone("iPhone SE (2020)", "iPhone SE Series", ["64GB", "128GB", "256GB"]),
  iphone("iPhone SE (2022)", "iPhone SE Series", ["64GB", "128GB", "256GB"]),

  // ---- Apple Watch: Series 3-7 (below current floor Series 8) ----
  watch("Apple Watch Series 3", ["38mm", "42mm"]),
  watch("Apple Watch Series 4", ["40mm", "44mm"]),
  watch("Apple Watch Series 5", ["40mm", "44mm"]),
  watch("Apple Watch Series 6", ["40mm", "44mm"]),
  watch("Apple Watch Series 7", ["41mm", "45mm"]),

  // ---- iPad: older generations not already in the catalogue ----
  ipad("iPad Generation 5 (2017)", ["32GB", "128GB"]),
  ipad("iPad Generation 6 (2018)", ["32GB", "128GB"]),
  ipad("iPad Generation 7 (2019)", ["32GB", "128GB"]),
  ipad("iPad Generation 8 (2020)", ["32GB", "128GB"]),
  ipad("iPad Air (2013)", ["16GB", "32GB", "64GB", "128GB"]),
  ipad("iPad Air 2 (2014)", ["16GB", "64GB", "128GB"]),
  ipad("iPad Air 3 (2019)", ["64GB", "256GB"]),
  ipad("iPad mini 2 (2013)", ["16GB", "32GB", "64GB", "128GB"]),
  ipad("iPad mini 3 (2014)", ["16GB", "64GB", "128GB"]),
  ipad("iPad mini 4 (2015)", ["16GB", "64GB", "128GB"]),
  ipad("iPad mini 5 (2019)", ["64GB", "256GB"]),
  ipad('iPad Pro 9.7" (2016)', ["32GB", "128GB", "256GB"]),
  ipad('iPad Pro 10.5" (2017)', ["64GB", "256GB", "512GB"]),
  ipad('iPad Pro 12.9" (2015)', ["32GB", "128GB", "256GB"]),
  ipad('iPad Pro 12.9" (2017)', ["64GB", "256GB", "512GB"]),
  ipad('iPad Pro 11" (2018)', ["64GB", "256GB", "512GB", "1TB"]),
  ipad('iPad Pro 12.9" (2018)', ["64GB", "256GB", "512GB", "1TB"]),
  ipad('iPad Pro 11" (2020)', ["128GB", "256GB", "512GB", "1TB"]),
  ipad('iPad Pro 12.9" (2020)', ["128GB", "256GB", "512GB", "1TB"]),
];

// Dedup + assign stable variant ids.
const skipped = [];
const out = [];
let vid = 1;
for (const m of models) {
  if (existing.has(m.name)) {
    skipped.push(m.name);
    continue;
  }
  m.variants = m.variants.map((v) => ({ ...v, id: `disc-${vid++}` }));
  out.push(m);
}

const outPath = join(__dirname, "discontinued-seed.json");
writeFileSync(outPath, JSON.stringify(out, null, 2));

const byCat = out.reduce((a, m) => ((a[m.category] = (a[m.category] || 0) + 1), a), {});
console.log(`Wrote ${out.length} models -> ${outPath}`);
console.log("By category:", JSON.stringify(byCat));
if (skipped.length) console.log("Skipped (already in catalogue):", skipped.join(", "));
