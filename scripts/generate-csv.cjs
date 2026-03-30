#!/usr/bin/env node
/**
 * Helper: Generate BKK_Mac_Products_2017-2026.csv from structured definitions
 */
const fs = require('fs');
const path = require('path');

const CONDITION = 'มาตรฐานการตรวจ Mac / MacBook (Full Option)';
const SERVICE = 'Y,Y,Y'; // In-Store, Pickup, Mail-in

// Define all product lines
const products = [];

function add(modelName, brand, series, processor, ramOptions, storageOptions, displayOptions) {
  for (const ram of ramOptions) {
    for (const storage of storageOptions) {
      for (const display of displayOptions) {
        products.push({ modelName, brand, series, processor, ram, storage, display });
      }
    }
  }
}

// === MacBook Pro 14" M5 Pro (2026) ===
for (const proc of [
  'M5 Pro (15-core CPU, 20-core GPU)',
  'M5 Pro (18-core CPU, 20-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M5 Pro, 2026)`, 'Apple', 'MacBook Pro 14"', proc,
    ['24GB', '48GB'], ['512GB', '1TB', '2TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === MacBook Pro 14" M5 Max (2026) ===
for (const proc of [
  'M5 Max (14-core CPU, 32-core GPU)',
  'M5 Max (16-core CPU, 40-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M5 Max, 2026)`, 'Apple', 'MacBook Pro 14"', proc,
    ['36GB', '48GB', '64GB', '128GB'], ['1TB', '2TB', '4TB', '8TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === MacBook Pro 16" M5 Pro (2026) ===
for (const proc of [
  'M5 Pro (15-core CPU, 20-core GPU)',
  'M5 Pro (18-core CPU, 20-core GPU)',
]) {
  add(`MacBook Pro 16" (ชิป M5 Pro, 2026)`, 'Apple', 'MacBook Pro 16"', proc,
    ['24GB', '48GB'], ['512GB', '1TB', '2TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === MacBook Pro 16" M5 Max (2026) ===
for (const proc of [
  'M5 Max (14-core CPU, 32-core GPU)',
  'M5 Max (16-core CPU, 40-core GPU)',
]) {
  add(`MacBook Pro 16" (ชิป M5 Max, 2026)`, 'Apple', 'MacBook Pro 16"', proc,
    ['36GB', '48GB', '64GB', '128GB'], ['1TB', '2TB', '4TB', '8TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === MacBook Air 13" M5 (2026) ===
add(`MacBook Air 13" (ชิป M5, 2026)`, 'Apple', 'MacBook Air 13"', 'M5',
  ['16GB', '24GB', '32GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Air 15" M5 (2026) ===
add(`MacBook Air 15" (ชิป M5, 2026)`, 'Apple', 'MacBook Air 15"', 'M5',
  ['16GB', '24GB', '32GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Pro 14" M5 (2025) ===
add(`MacBook Pro 14" (ชิป M5, 2025)`, 'Apple', 'MacBook Pro 14"', 'M5',
  ['16GB', '24GB', '32GB'], ['512GB', '1TB', '2TB'], ['Standard Glass', 'Nano-texture Glass']);

// === MacBook Air 13" M4 (2025) ===
add(`MacBook Air 13" (ชิป M4, 2025)`, 'Apple', 'MacBook Air 13"', 'M4',
  ['16GB', '24GB', '32GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Air 15" M4 (2025) ===
add(`MacBook Air 15" (ชิป M4, 2025)`, 'Apple', 'MacBook Air 15"', 'M4',
  ['16GB', '24GB', '32GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Pro 14" M4 (2024) ===
add(`MacBook Pro 14" (ชิป M4, 2024)`, 'Apple', 'MacBook Pro 14"', 'M4',
  ['16GB', '24GB', '32GB'], ['512GB', '1TB', '2TB'], ['Standard Glass', 'Nano-texture Glass']);

// === MacBook Pro 14" M4 Pro (2024) ===
for (const proc of [
  'M4 Pro (12-core CPU, 16-core GPU)',
  'M4 Pro (14-core CPU, 20-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M4 Pro, 2024)`, 'Apple', 'MacBook Pro 14"', proc,
    ['24GB', '48GB'], ['512GB', '1TB', '2TB', '4TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === MacBook Pro 14" M4 Max (2024) ===
for (const proc of [
  'M4 Max (14-core CPU, 32-core GPU)',
  'M4 Max (16-core CPU, 40-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M4 Max, 2024)`, 'Apple', 'MacBook Pro 14"', proc,
    ['36GB', '48GB', '64GB', '128GB'], ['1TB', '2TB', '4TB', '8TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === MacBook Pro 16" M4 Pro (2024) ===
add(`MacBook Pro 16" (ชิป M4 Pro, 2024)`, 'Apple', 'MacBook Pro 16"', 'M4 Pro (14-core CPU, 20-core GPU)',
  ['24GB', '48GB'], ['512GB', '1TB', '2TB', '4TB'], ['Standard Glass', 'Nano-texture Glass']);

// === MacBook Pro 16" M4 Max (2024) ===
for (const proc of [
  'M4 Max (14-core CPU, 32-core GPU)',
  'M4 Max (16-core CPU, 40-core GPU)',
]) {
  add(`MacBook Pro 16" (ชิป M4 Max, 2024)`, 'Apple', 'MacBook Pro 16"', proc,
    ['36GB', '48GB', '64GB', '128GB'], ['1TB', '2TB', '4TB', '8TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === MacBook Air 13" M3 (2024) ===
add(`MacBook Air 13" (ชิป M3, 2024)`, 'Apple', 'MacBook Air 13"', 'M3',
  ['8GB', '16GB', '24GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Air 15" M3 (2024) ===
add(`MacBook Air 15" (ชิป M3, 2024)`, 'Apple', 'MacBook Air 15"', 'M3',
  ['8GB', '16GB', '24GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === iMac 24" M4 (2024) ===
for (const proc of [
  'M4 (8-core CPU, 8-core GPU)',
  'M4 (10-core CPU, 10-core GPU)',
]) {
  add(`iMac 24" (ชิป M4, 2024)`, 'Apple', 'iMac 24"', proc,
    ['16GB', '24GB', '32GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard Glass', 'Nano-texture Glass']);
}

// === Mac mini M4 (2024) ===
add(`Mac mini (ชิป M4, 2024)`, 'Apple', 'Mac mini', 'M4',
  ['16GB', '24GB', '32GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === Mac mini M4 Pro (2024) ===
for (const proc of [
  'M4 Pro (12-core CPU, 16-core GPU)',
  'M4 Pro (14-core CPU, 20-core GPU)',
]) {
  add(`Mac mini (ชิป M4 Pro, 2024)`, 'Apple', 'Mac mini', proc,
    ['24GB', '48GB', '64GB'], ['512GB', '1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === MacBook Pro 14" M3 (2023) ===
add(`MacBook Pro 14" (ชิป M3, 2023)`, 'Apple', 'MacBook Pro 14"', 'M3',
  ['8GB', '16GB', '24GB'], ['512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Pro 14" M3 Pro (2023) ===
for (const proc of [
  'M3 Pro (11-core CPU, 14-core GPU)',
  'M3 Pro (12-core CPU, 18-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M3 Pro, 2023)`, 'Apple', 'MacBook Pro 14"', proc,
    ['18GB', '36GB'], ['512GB', '1TB', '2TB', '4TB'], ['Standard']);
}

// === MacBook Pro 14" M3 Max (2023) ===
for (const proc of [
  'M3 Max (14-core CPU, 30-core GPU)',
  'M3 Max (16-core CPU, 40-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M3 Max, 2023)`, 'Apple', 'MacBook Pro 14"', proc,
    ['36GB', '48GB', '64GB', '128GB'], ['1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === MacBook Pro 16" M3 Pro (2023) ===
add(`MacBook Pro 16" (ชิป M3 Pro, 2023)`, 'Apple', 'MacBook Pro 16"', 'M3 Pro (12-core CPU, 18-core GPU)',
  ['18GB', '36GB'], ['512GB', '1TB', '2TB', '4TB'], ['Standard']);

// === MacBook Pro 16" M3 Max (2023) ===
for (const proc of [
  'M3 Max (14-core CPU, 30-core GPU)',
  'M3 Max (16-core CPU, 40-core GPU)',
]) {
  add(`MacBook Pro 16" (ชิป M3 Max, 2023)`, 'Apple', 'MacBook Pro 16"', proc,
    ['36GB', '48GB', '64GB', '128GB'], ['1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === MacBook Air 15" M2 (2023) ===
add(`MacBook Air 15" (ชิป M2, 2023)`, 'Apple', 'MacBook Air 15"', 'M2',
  ['8GB', '16GB', '24GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === iMac 24" M3 (2023) ===
for (const proc of [
  'M3 (8-core CPU, 8-core GPU)',
  'M3 (8-core CPU, 10-core GPU)',
]) {
  add(`iMac 24" (ชิป M3, 2023)`, 'Apple', 'iMac 24"', proc,
    ['8GB', '16GB', '24GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// === Mac mini M2 (2023) ===
add(`Mac mini (ชิป M2, 2023)`, 'Apple', 'Mac mini', 'M2',
  ['8GB', '16GB', '24GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === Mac mini M2 Pro (2023) ===
for (const proc of [
  'M2 Pro (10-core CPU, 16-core GPU)',
  'M2 Pro (12-core CPU, 19-core GPU)',
]) {
  add(`Mac mini (ชิป M2 Pro, 2023)`, 'Apple', 'Mac mini', proc,
    ['16GB', '32GB'], ['512GB', '1TB', '2TB'], ['Standard']);
}

// === MacBook Pro 13" M2 (2022) ===
add(`MacBook Pro 13" (ชิป M2, 2022)`, 'Apple', 'MacBook Pro 13"', 'M2',
  ['8GB', '16GB', '24GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Air 13" M2 (2022) ===
add(`MacBook Air 13" (ชิป M2, 2022)`, 'Apple', 'MacBook Air 13"', 'M2',
  ['8GB', '16GB', '24GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Pro 14" M1 Pro (2021) ===
for (const proc of [
  'M1 Pro (8-core CPU, 14-core GPU)',
  'M1 Pro (10-core CPU, 16-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M1 Pro, 2021)`, 'Apple', 'MacBook Pro 14"', proc,
    ['16GB', '32GB'], ['512GB', '1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === MacBook Pro 14" M1 Max (2021) ===
for (const proc of [
  'M1 Max (10-core CPU, 24-core GPU)',
  'M1 Max (10-core CPU, 32-core GPU)',
]) {
  add(`MacBook Pro 14" (ชิป M1 Max, 2021)`, 'Apple', 'MacBook Pro 14"', proc,
    ['32GB', '64GB'], ['512GB', '1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === MacBook Pro 16" M1 Pro (2021) ===
add(`MacBook Pro 16" (ชิป M1 Pro, 2021)`, 'Apple', 'MacBook Pro 16"', 'M1 Pro (10-core CPU, 16-core GPU)',
  ['16GB', '32GB'], ['512GB', '1TB', '2TB', '4TB', '8TB'], ['Standard']);

// === MacBook Pro 16" M1 Max (2021) ===
for (const proc of [
  'M1 Max (10-core CPU, 24-core GPU)',
  'M1 Max (10-core CPU, 32-core GPU)',
]) {
  add(`MacBook Pro 16" (ชิป M1 Max, 2021)`, 'Apple', 'MacBook Pro 16"', proc,
    ['32GB', '64GB'], ['512GB', '1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === iMac 24" M1 (2021) ===
for (const proc of [
  'M1 (8-core CPU, 7-core GPU)',
  'M1 (8-core CPU, 8-core GPU)',
]) {
  add(`iMac 24" (ชิป M1, 2021)`, 'Apple', 'iMac 24"', proc,
    ['8GB', '16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// === MacBook Pro 13" M1 (2020) ===
add(`MacBook Pro 13" (ชิป M1, 2020)`, 'Apple', 'MacBook Pro 13"', 'M1',
  ['8GB', '16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Pro 13" Intel (2020) ===
for (const proc of [
  'Intel Core i5 (10th Gen)',
  'Intel Core i7 (10th Gen)',
]) {
  add(`MacBook Pro 13" (Intel, 2020)`, 'Apple', 'MacBook Pro 13"', proc,
    ['16GB', '32GB'], ['512GB', '1TB', '2TB', '4TB'], ['Standard']);
}

// === MacBook Air 13" M1 (2020) ===
add(`MacBook Air 13" (ชิป M1, 2020)`, 'Apple', 'MacBook Air 13"', 'M1',
  ['8GB', '16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Air 13" Intel (2020) ===
for (const proc of [
  'Intel Core i3 (10th Gen)',
  'Intel Core i5 (10th Gen)',
  'Intel Core i7 (10th Gen)',
]) {
  add(`MacBook Air 13" (Intel, 2020)`, 'Apple', 'MacBook Air 13"', proc,
    ['8GB', '16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// === iMac 27" Intel (2020) ===
for (const proc of [
  'Intel Core i5 (10th Gen)',
  'Intel Core i7 (10th Gen)',
  'Intel Core i9 (10th Gen)',
]) {
  add(`iMac 27" (Intel, 2020)`, 'Apple', 'iMac 27"', proc,
    ['8GB', '16GB', '32GB', '64GB', '128GB'], ['256GB', '512GB', '1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === Mac mini M1 (2020) ===
add(`Mac mini (ชิป M1, 2020)`, 'Apple', 'Mac mini', 'M1',
  ['8GB', '16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Pro 13" Intel (2019) ===
for (const proc of [
  'Intel Core i5 (8th Gen)',
  'Intel Core i7 (8th Gen)',
]) {
  add(`MacBook Pro 13" (Intel, 2019)`, 'Apple', 'MacBook Pro 13"', proc,
    ['8GB', '16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// === MacBook Pro 15" Intel (2019) ===
for (const proc of [
  'Intel Core i7 (9th Gen)',
  'Intel Core i9 (9th Gen)',
]) {
  add(`MacBook Pro 15" (Intel, 2019)`, 'Apple', 'MacBook Pro 15"', proc,
    ['16GB', '32GB'], ['256GB', '512GB', '1TB', '2TB', '4TB'], ['Standard']);
}

// === MacBook Pro 16" Intel (2019) ===
for (const proc of [
  'Intel Core i7 (9th Gen)',
  'Intel Core i9 (9th Gen)',
]) {
  add(`MacBook Pro 16" (Intel, 2019)`, 'Apple', 'MacBook Pro 16"', proc,
    ['16GB', '32GB', '64GB'], ['512GB', '1TB', '2TB', '4TB', '8TB'], ['Standard']);
}

// === MacBook Air 13" Intel (2019) ===
add(`MacBook Air 13" (Intel, 2019)`, 'Apple', 'MacBook Air 13"', 'Intel Core i5 (8th Gen)',
  ['8GB', '16GB'], ['128GB', '256GB', '512GB', '1TB'], ['Standard']);

// === iMac 21.5" Intel (2019) ===
for (const proc of [
  'Intel Core i3 (8th Gen)',
  'Intel Core i5 (8th Gen)',
  'Intel Core i7 (8th Gen)',
]) {
  add(`iMac 21.5" (Intel, 2019)`, 'Apple', 'iMac 21.5"', proc,
    ['8GB', '16GB', '32GB'], ['256GB', '512GB', '1TB'], ['Standard']);
}

// === iMac 27" Intel (2019) ===
for (const proc of [
  'Intel Core i5 (9th Gen)',
  'Intel Core i7 (9th Gen)',
  'Intel Core i9 (9th Gen)',
]) {
  add(`iMac 27" (Intel, 2019)`, 'Apple', 'iMac 27"', proc,
    ['8GB', '16GB', '32GB', '64GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// === MacBook Pro 13" Intel (2018) ===
for (const proc of [
  'Intel Core i5 (8th Gen)',
  'Intel Core i7 (8th Gen)',
]) {
  add(`MacBook Pro 13" (Intel, 2018)`, 'Apple', 'MacBook Pro 13"', proc,
    ['8GB', '16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// === MacBook Pro 15" Intel (2018) ===
for (const proc of [
  'Intel Core i7 (8th Gen)',
  'Intel Core i9 (8th Gen)',
]) {
  add(`MacBook Pro 15" (Intel, 2018)`, 'Apple', 'MacBook Pro 15"', proc,
    ['16GB', '32GB'], ['256GB', '512GB', '1TB', '2TB', '4TB'], ['Standard']);
}

// === MacBook Air 13" Intel (2018) ===
add(`MacBook Air 13" (Intel, 2018)`, 'Apple', 'MacBook Air 13"', 'Intel Core i5 (8th Gen)',
  ['8GB', '16GB'], ['128GB', '256GB', '512GB', '1TB'], ['Standard']);

// === Mac mini Intel (2018) ===
for (const proc of [
  'Intel Core i3 (8th Gen)',
  'Intel Core i5 (8th Gen)',
  'Intel Core i7 (8th Gen)',
]) {
  add(`Mac mini (Intel, 2018)`, 'Apple', 'Mac mini', proc,
    ['8GB', '16GB', '32GB', '64GB'], ['128GB', '256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// === MacBook Pro 13" Intel (2017) ===
for (const proc of [
  'Intel Core i5 (7th Gen)',
  'Intel Core i7 (7th Gen)',
]) {
  add(`MacBook Pro 13" (Intel, 2017)`, 'Apple', 'MacBook Pro 13"', proc,
    ['8GB', '16GB'], ['128GB', '256GB', '512GB', '1TB'], ['Standard']);
}

// === MacBook Pro 13" Touch Bar Intel (2017) ===
for (const proc of [
  'Intel Core i5 (7th Gen)',
  'Intel Core i7 (7th Gen)',
]) {
  add(`MacBook Pro 13" Touch Bar (Intel, 2017)`, 'Apple', 'MacBook Pro 13"', proc,
    ['8GB', '16GB'], ['256GB', '512GB', '1TB'], ['Standard']);
}

// === MacBook Pro 15" Intel (2017) ===
add(`MacBook Pro 15" (Intel, 2017)`, 'Apple', 'MacBook Pro 15"', 'Intel Core i7 (7th Gen)',
  ['16GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);

// === MacBook Air 13" Intel (2017) ===
for (const proc of [
  'Intel Core i5 (5th Gen)',
  'Intel Core i7 (5th Gen)',
]) {
  add(`MacBook Air 13" (Intel, 2017)`, 'Apple', 'MacBook Air 13"', proc,
    ['8GB'], ['128GB', '256GB', '512GB'], ['Standard']);
}

// === iMac 21.5" Intel (2017) ===
for (const proc of [
  'Intel Core i5 (7th Gen)',
  'Intel Core i7 (7th Gen)',
]) {
  add(`iMac 21.5" (Intel, 2017)`, 'Apple', 'iMac 21.5"', proc,
    ['8GB', '16GB', '32GB'], ['256GB', '512GB', '1TB'], ['Standard']);
}

// === iMac 27" Intel (2017) ===
for (const proc of [
  'Intel Core i5 (7th Gen)',
  'Intel Core i7 (7th Gen)',
]) {
  add(`iMac 27" (Intel, 2017)`, 'Apple', 'iMac 27"', proc,
    ['8GB', '16GB', '32GB', '64GB'], ['256GB', '512GB', '1TB', '2TB'], ['Standard']);
}

// Generate CSV
function escapeCSV(val) {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

const header = 'Model Name,Brand,Series,Processor (ชิป),RAM (หน่วยความจำ),Storage (ความจุ),Display (จอ),ราคาเครื่องจัด (฿),ราคาท็อปมือสอง (฿),In-Store,Pickup,Mail-in,Condition Item';
const lines = [header];

for (const p of products) {
  lines.push([
    escapeCSV(p.modelName),
    p.brand,
    escapeCSV(p.series),
    escapeCSV(p.processor),
    p.ram,
    p.storage,
    p.display,
    '0',
    '0',
    'Y',
    'Y',
    'Y',
    CONDITION,
  ].join(','));
}

const BOM = '\uFEFF';
const outPath = path.resolve(__dirname, '..', 'BKK_Mac_Products_2017-2026.csv');
fs.writeFileSync(outPath, BOM + lines.join('\n') + '\n', 'utf-8');
console.log(`✅ Generated ${products.length} rows → ${outPath}`);
