// =============================================================================
// SickW shared core — fetch-side constants, response parsing, flag logic and
// the usage audit log. Single source of truth used by BOTH index.js (admin /
// rider / quote-lookup callables) and chat-ai.js (the chat AI's
// check_device_by_serial tool). Keep ALL SickW parsing/flag semantics here —
// never fork a second copy (repo anti-mirror rule).
// No firebase imports: callers pass `db` in.
// =============================================================================

const SICKW_ENDPOINT = "https://sickw.com/api.php";
const SICKW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SICKW_CATALOG_CACHE_KEY = "sickw/services_catalog";

// staff/ key เป็น push id (สร้างตอน Staff Management) ไม่ใช่ Firebase Auth UID
// → lookup ด้วย email match จาก request.auth.token.email
// rider app ต่างกัน — riders/{uid} ใช้ Firebase UID เป็น key ตรงๆ
async function lookupStaffByAuth(db, auth) {
  if (!auth) return null;
  const email = auth.token && auth.token.email;
  if (email) {
    const snap = await db.ref("staff").once("value");
    let matched = null;
    snap.forEach((s) => {
      const v = s.val();
      if (!v) return false;
      const status = String(v.status || "").toUpperCase();
      if (v.email === email && (status === "" || status === "ACTIVE")) {
        matched = { id: s.key, ...v };
        return true; // stop forEach
      }
      return false;
    });
    if (matched) return matched;
  }
  // Fallback rider lookup (rider app ใช้ Firebase UID เป็น key ใน riders/)
  const riderSnap = await db.ref(`riders/${auth.uid}`).once("value");
  if (riderSnap.exists()) {
    const r = riderSnap.val();
    return { id: auth.uid, role: "RIDER", name: r.name || r.displayName || r.email || "Rider", ...r };
  }
  return null;
}

async function recordSickwUsage(db, entry) {
  try {
    let name = "Unknown";
    let role = "UNKNOWN";
    let staffId = null;
    try {
      const staff = await lookupStaffByAuth(db, { uid: entry.uid, token: entry.authToken });
      if (staff) {
        name = staff.name || staff.displayName || staff.email || "Unknown";
        role = String(staff.role || "STAFF").toUpperCase();
        staffId = staff.id || null;
      }
    } catch (e) {
      // best-effort — don't fail the request just because lookup failed
      console.warn("[sickw-audit] lookup name failed:", e?.message || e);
    }

    const log = {
      timestamp: Date.now(),
      uid: entry.uid,
      staff_id: staffId,
      name,
      role,
      imei: entry.imei,
      service_ids: entry.serviceIds,
      job_id: entry.jobId || null,
      cached: entry.cached,
      credit_used: entry.creditUsed,
      status: entry.status,
      source: entry.source || "unknown",
    };

    await db.ref("sickw_usage").push(log);

    // ถ้าตรวจโดยไม่ผูก jobId → flag เป็น suspicious ใน sickw_usage_flags/
    // เผื่อ CEO เปิดดูแยก (น่าจะตรวจ IMEI ที่ไม่ใช่ของลูกค้า — ส่วนตัวหรือ test)
    // ยกเว้น frontend_quote (ลูกค้าเช็ครุ่นเองหน้าเว็บ — ไม่มี jobId เป็นเรื่องปกติ)
    if (!entry.jobId && entry.source !== "frontend_quote") {
      await db.ref("sickw_usage_flags").push({
        ...log,
        reason: "no_job_id",
      });
    }
  } catch (e) {
    console.warn("[sickw-audit] write log failed:", e?.message || e);
  }
}

// ปรับ key ของ Sickw ที่เจอบ่อย → ชื่อ field มาตรฐานของเรา
// ปล่อย key ที่ไม่ match ไว้ใน raw response เพื่อให้แอดมินอ่านได้
//
// ระวัง: Sickw มี 2 key ที่ดูคล้ายแต่ความหมายต่าง
//   - "icloud lock" = Activation Lock ON/OFF → จัดเป็น FMI flag
//   - "icloud status" = Lost/Stolen/Clean → จัดเป็น Blacklist flag
// อย่าสลับ ไม่งั้นเครื่อง FMI=ON จะโชว์ clean ผิดทาง
const SICKW_FIELD_MAP = {
  model: ["model", "model description", "model desc", "model name", "device name", "modal description"],
  modelNumber: ["model number", "model no", "part number", "model code", "material number"],
  capacity: ["capacity", "memory", "storage", "memory capacity"],
  color: ["color", "colour", "device color"],
  country: ["country", "purchase country", "sold by", "region", "sold by country", "purchased in", "country of purchase"],
  imei: ["imei", "imei number"],
  imei2: ["imei2", "imei 2"],
  serial: ["serial", "serial number", "sn"],
  fmiStatus: ["icloud lock", "fmi status", "fmi", "find my iphone", "find my", "find my status"],
  activationLock: ["activation lock", "activation lock status"],
  activationStatus: ["activation status", "activated", "activation", "device activation"],
  mdmStatus: ["mdm lock", "mdm status", "mdm", "mdm lock status"],
  blacklistStatus: ["icloud status", "blacklist status", "blacklist", "gsma blacklist", "stolen", "lost"],
  carrier: ["carrier", "initial carrier", "carrier country", "network", "sold carrier"],
  simLock: ["sim-lock", "sim lock", "simlock", "lock status", "simpolicy unlock status"],
  warrantyStatus: ["warranty status", "warranty", "limited warranty"],
  // service 72 (GSX) คืน "Coverage Duration: Ends on DD/MM/YY" = วันหมดประกัน/AppleCare
  // และ "AppleCare Description" = ชนิดความคุ้มครอง — เราจ่ายค่า GSX แล้ว เก็บให้ครบ
  warrantyExpiry: ["coverage duration", "coverage end date", "estimated expiry date", "warranty end date", "coverage ends"],
  appleCareDescription: ["applecare description"],
  estimatedPurchaseDate: ["estimated purchase date", "purchase date", "initial activation", "coverage start date", "initial unbrick"],
};

function normalizeSickwKey(rawKey) {
  return String(rawKey || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

// Map ค่าจาก Sickw → flag state (clean | flagged | unknown) สำหรับใช้ตัดสิน Gate
// ที่ฝั่ง server ด้วย (อย่าให้ client กำหนดเองทั้งหมด)
function interpretSickwFlag(value, kind) {
  if (!value) return "unknown";
  const v = String(value).toLowerCase();
  if (kind === "fmi" || kind === "icloud") {
    if (v.includes("off") || v.includes("clean") || v.includes("disabled")) return "clean";
    if (v.includes("on") || v.includes("locked") || v.includes("enabled") || v.includes("active")) return "flagged";
    return "unknown";
  }
  if (kind === "mdm") {
    if (v.includes("no") || v.includes("clean") || v.includes("off") || v.includes("clear") || v.includes("not enrolled")) return "clean";
    if (v.includes("yes") || v.includes("lock") || v.includes("enrolled") || v.includes("supervised")) return "flagged";
    return "unknown";
  }
  if (kind === "blacklist") {
    if (v.includes("clean") || v.startsWith("not") || v === "no" || v.includes(" no ") || v.includes("off")) return "clean";
    if (v.includes("blacklist") || v.includes("lost") || v.includes("stolen") || v.startsWith("yes")) return "flagged";
    return "unknown";
  }
  return "unknown";
}

// คำนวณ flags สรุปจาก parsed fields → ใช้ทั้งฝั่ง server (เขียนลง snapshot ของ job)
// และ Gate check ฝั่ง UI (helper เดียวกัน source-of-truth)
//
// fmi = "icloud lock" หรือ "fmi" หรือ "activation lock" (ON/OFF — ติดล็อคไหม)
// blacklist = "icloud status" หรือ "blacklist" (Clean/Lost/Stolen)
// ห้ามใช้ "icloud status" ตัดสิน FMI เพราะ status=Clean บอกแค่ว่า "ไม่หาย" ไม่ใช่ "FMI=OFF"
function summarizeSickwFlags(parsed) {
  const p = parsed || {};
  return {
    fmi: interpretSickwFlag(p.fmiStatus || p.activationLock, "fmi"),
    mdm: interpretSickwFlag(p.mdmStatus, "mdm"),
    blacklist: interpretSickwFlag(p.blacklistStatus, "blacklist"),
  };
}

function parseSickwResult(raw) {
  // Sickw คืน result เป็น HTML/text เช่น
  //   "Model Description: iPhone 14 Pro<br>IMEI: 35xx<br>FMI Status: OFF"
  // หรือบาง service มี IMEI/Serial เป็น prefix ของทุก key:
  //   "klfqvl2mj6 find my iphone: ON<br>klfqvl2mj6 imei: ..."
  // ขั้นตอน: split ด้วย <br>/\n → split "key:value" → strip imei prefix
  // → map ด้วย endsWith (ทน prefix variants)
  if (!raw || typeof raw !== "string") return { parsed: {}, fields: {} };

  const lines = raw
    .split(/<br\s*\/?>|\r?\n/i)
    .map((s) => s.trim())
    .filter(Boolean);

  // เก็บ field ดิบทุก key:value ที่หาเจอ (สำหรับโชว์ในแอดมิน)
  const fields = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = normalizeSickwKey(line.slice(0, idx));
    const value = line
      .slice(idx + 1)
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    if (!key || !value) continue;
    // เก็บแบบ first-write-wins (ค่าแรกของ key เดิม)
    if (!(key in fields)) fields[key] = value;
  }

  // Map ลง standard fields — ใช้ endsWith เพื่อทน IMEI/Serial prefix
  // (เช่น "klfqvl2mj6 find my iphone" → match candidate "find my iphone")
  // ลำดับ candidate สำคัญ: ตัวที่จำเพาะมากกว่าต้องอยู่ก่อน
  const parsed = {};
  for (const [stdKey, candidates] of Object.entries(SICKW_FIELD_MAP)) {
    for (const candidate of candidates) {
      const hit = Object.keys(fields).find(
        (k) => k === candidate || k.endsWith(" " + candidate)
      );
      if (hit) {
        parsed[stdKey] = fields[hit];
        break;
      }
    }
  }

  // FMI/Activation Lock: iPad/Mac/Watch คืน key เป็น "Find My iPad/Mac/Watch"
  // ซึ่ง endsWith-match ของ generic map จับไม่โดน (candidate มีแค่ "find my
  // iphone"). เก็บ fallback แบบ startsWith เพื่อให้ Find My มาจาก lookup ครบทุก
  // ชนิดอุปกรณ์ ไม่ต้องให้ไรเดอร์กรอกเอง
  if (!parsed.fmiStatus) {
    const k = Object.keys(fields).find(
      (key) => key.startsWith("find my") || key === "icloud lock" || key.endsWith("activation lock")
    );
    if (k) parsed.fmiStatus = fields[k];
  }

  // บาง service (GSX/MDM status) ไม่ได้คืน capacity/color เป็น field แยก แต่ฝังรวมใน
  // "model name" เช่น "iPhone 13 Pro Max 256GB Sierra Blue" — แกะออกมาเติมให้
  // เฉพาะตอนที่ยังว่าง (ไม่ทับค่าที่ service คืนมาตรงๆ)
  const modelName = parsed.model || fields["model name"] || "";
  if (!parsed.capacity) {
    const cap =
      modelName.match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i) ||
      (fields["device configuration"] || "").match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
    if (cap) parsed.capacity = `${cap[1]}${cap[2].toUpperCase()}`;
  }
  if (!parsed.color && modelName) {
    // สี = ข้อความที่อยู่หลัง token ความจุใน model name
    const m = modelName.match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
    if (m && m.index != null) {
      const after = modelName.slice(m.index + m[0].length).trim();
      if (after) parsed.color = after;
    }
  }

  return { parsed, fields };
}

module.exports = {
  SICKW_ENDPOINT,
  SICKW_CACHE_TTL_MS,
  SICKW_CATALOG_CACHE_KEY,
  SICKW_FIELD_MAP,
  lookupStaffByAuth,
  recordSickwUsage,
  normalizeSickwKey,
  interpretSickwFlag,
  summarizeSickwFlags,
  parseSickwResult,
};
