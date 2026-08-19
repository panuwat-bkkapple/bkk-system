// ---------------------------------------------------------------------------
// V2 live probe — the two-call pipeline against the REAL Anthropic API.
//
//   node scripts/v2-live-probe.mjs --query "ขาย iPhone 16 Pro Max เดือนหน้าดีไหม"
//   node scripts/v2-live-probe.mjs --query "..." --live
//   node scripts/v2-live-probe.mjs --suite            # the spec's sentences
//   node scripts/v2-live-probe.mjs --suite --live
//
// DRY-RUN BY DEFAULT (กติกา: ทุก script ที่มีผลจริงต้อง dry-run เป็นค่าเริ่มต้น).
// Without --live it prints the stage-1 input and the assembled prompt sizes
// and exits — nothing is called, nothing is billed. With --live it runs
// stage 1 → stage 2 → stage 3 in-process using the same module the function
// deploys, prints every intermediate, and runs the quick rule checks below.
//
// CREDENTIALS: reads ANTHROPIC_API_KEY (or OVERVIEW_API_KEY) from the
// environment, or from functions/.env if present. This is a DEV tool — run
// it from a machine that holds the dev key. It never touches RTDB, so the
// cache / rate limit / cap / archive are all out of the loop: it measures
// the MODEL half of the pipeline, which is exactly the half the offline
// suites cannot.
//
// WHAT IT CHECKS on each answer (heuristics, not a verdict — the owner's
// manual pass is the acceptance):
//   - JSON parsed into {summary, detail}
//   - no URL, no emoji
//   - every price-shaped number in the answer appears in the stage-2 context
//   - the verdict words the spec asks for are present when the context
//     carried a forecast ("ควร/ฟันธง/คุ้มกว่า/แนะนำ" — reported, not judged)
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const v2 = require(join(root, "functions", "search-overview-v2.js"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

// ── credentials ─────────────────────────────────────────────────────────────

function loadEnvFile() {
  const p = join(root, "functions", ".env");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}
const envFile = loadEnvFile();
const apiKey =
  process.env.OVERVIEW_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  envFile.OVERVIEW_API_KEY ||
  envFile.ANTHROPIC_API_KEY ||
  "";
const extractModel =
  process.env.OVERVIEW_EXTRACT_MODEL || envFile.OVERVIEW_EXTRACT_MODEL || "claude-haiku-4-5";
const overviewModel = process.env.OVERVIEW_MODEL || envFile.OVERVIEW_MODEL || "claude-haiku-4-5";

// ── fixture ingredients (a realistic mini-catalog) ─────────────────────────
// Override with --ingredients path.json to probe against real catalog data
// (e.g. a dump the owner exports from the admin app).

const FUTURE = Date.now() + 14 * 24 * 3600 * 1000;
const FIXTURE = {
  models: [
    {
      id: "ip16pm", name: "iPhone 16 Pro Max", alias: "ไอโฟน 16 โปรแม็กซ์", family: "iphone",
      min: 30000, max: 42000,
      capacities: [
        { name: "256GB", min: 30000, max: 32000 },
        { name: "512GB", min: 36000, max: 38000 },
        { name: "1TB", min: 40000, max: 42000 },
      ],
      conditionSetId: "set16",
    },
    { id: "ip16p", name: "iPhone 16 Pro", family: "iphone", min: 24000, max: 33000, conditionSetId: "set16" },
    { id: "ip16", name: "iPhone 16", family: "iphone", min: 18000, max: 24000, conditionSetId: "set16" },
    { id: "ip15pm", name: "iPhone 15 Pro Max", alias: "ไอโฟน 15 โปรแม็กซ์", family: "iphone", min: 22000, max: 28000, conditionSetId: "set16" },
    { id: "ip13", name: "iPhone 13", family: "iphone", min: 9000, max: 13000, conditionSetId: "set16" },
    { id: "ipadair6", name: "iPad Air 6", family: "ipad", min: 12000, max: 16000 },
    { id: "mbam2", name: "MacBook Air M2", family: "mac", min: 15000, max: 21000 },
    { id: "aws9", name: "Apple Watch Series 9", family: "apple-watch", min: 5000, max: 8000, paused: true, pausedMessage: "รอเช็คตลาด" },
  ],
  conditionSets: {
    set16: {
      groups: [
        { title: "สภาพหน้าจอ", options: [{ label: "ปกติ" }, { label: "จอมีรอย", deduct: 1500 }, { label: "จอแตก มองเห็นชัด", pct: 20 }] },
        { title: "แบตเตอรี่", options: [{ label: "90% ขึ้นไป" }, { label: "80-89%", deduct: 1200 }, { label: "แบตต่ำกว่า 80% (Service)", deduct: 2500 }] },
        { title: "โครงเครื่อง", options: [{ label: "ปกติ" }, { label: "บุบ/มีรอยลึก", deduct: 2000 }, { label: "ตัวเครื่องงอ/บิด", deduct: 3000 }] },
      ],
    },
  },
  marketFacts: [
    { label: "iPhone 18 เปิดตัวราวกลางเดือนกันยายน", appliesTo: "iphone", certainty: "ความมั่นใจปานกลาง", dropPctMin: 5, dropPctMax: 12, expiresAt: FUTURE },
    { label: "ตลาดรวมช่วงเปิดเทอม", appliesTo: "all", text: "ตลาดมือสองคึกคักขึ้น ราคาทรงตัว", certainty: "ความมั่นใจต่ำ", expiresAt: FUTURE },
  ],
  series: [{ modelId: "ip16pm", days: 30, changePct: -3.5 }],
  pages: [
    { title: "ขั้นตอนการขาย", path: "/how-it-works", description: "ขายยังไง ได้เงินเมื่อไหร่" },
    { title: "สาขาทั้งหมด", path: "/branches", description: "ที่ตั้งและเวลาเปิดของทุกสาขา" },
  ],
};

// The spec's own acceptance sentences (ACCEPTANCE — ความถูก + ความฉลาด).
const SUITE = [
  "ถ้าจะขาย iPhone 16 Pro Max 256GB เดือนหน้า หลังจาก iPhone 18 รุ่นใหม่ เปิดตัว ราคาจะลงอีกไหม",
  "ราคาจะลงอีกไหม",
  "iPhone 20 Ultra",
  "รีบขาย 16 ก่อน 18 ออก",
  "ไอโฟน15โปรแม็กซ์ จอแตก",
  "ip16 pm 256",
  "เครื่องงอ ขายได้ไหม",
  "ขาย 16 PM เดือนหน้าดีไหม",
  "มีสาขาที่ไหนบ้าง",
  "asdfgh",
];

// ── the pipeline, in-process ───────────────────────────────────────────────

async function callAnthropic({ model, system, user, maxTokens }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("").trim();
}

function quickChecks(answer, context) {
  const text = `${answer.summary} ${answer.detail}`;
  const notes = [];
  if (/https?:\/\/|www\./i.test(text)) notes.push("!! มีลิงก์ในคำตอบ");
  if (/\p{Extended_Pictographic}/u.test(text)) notes.push("!! มีอีโมจิ");
  const prices = text.match(/\d{1,3}(?:,\d{3})+/g) || [];
  const missing = prices.filter((p) => !context.includes(p));
  if (missing.length) notes.push(`!! เลขที่ไม่อยู่ใน context: ${missing.join(", ")}`);
  if (/ขึ้นอยู่กับคุณ|แล้วแต่สถานการณ์/.test(text)) notes.push("?? มีคำหนีการฟันธง");
  if (/ควร|คุ้มกว่า|แนะนำ|ดีกว่า/.test(text)) notes.push("มีคำฟันธง/คำแนะนำ (ตรวจเหตุผลด้วยตาคน)");
  return notes.length ? notes : ["ผ่าน quick checks ทุกข้อ"];
}

async function probe(query, ingredients) {
  console.log(`\n${"=".repeat(70)}\nQUERY: ${query}`);
  const extractUser = v2.buildExtractUser(query, ingredients);
  if (!flag("live")) {
    console.log(`[dry-run] stage-1 input: ${extractUser.length} chars · extract=${extractModel} · write=${overviewModel}`);
    return;
  }
  const t0 = Date.now();
  const exText = await callAnthropic({
    model: extractModel,
    system: v2.buildExtractSystemPrompt(),
    user: extractUser,
    maxTokens: v2.EXTRACT_MAX_TOKENS,
  });
  const extraction = v2.parseExtraction(exText, ingredients);
  console.log(`stage 1 (${Date.now() - t0}ms):`, JSON.stringify(extraction, null, 1));
  if (!extraction) return console.log("=> extract_unparseable — fallback chain would own the screen");
  if (!v2.hasAnythingToWrite(ingredients, extraction)) {
    return console.log("=> nothing_to_write — guidance/empty state would own the screen (no stage-3 spend)");
  }
  const { context, droppedSections } = v2.buildV2Context({ query, ingredients, extraction, serviceFacts: "" });
  console.log(`stage 2: ${context.length} chars${droppedSections.length ? ` (dropped: ${droppedSections})` : ""}`);
  console.log(context.split("\n").map((l) => `  | ${l}`).join("\n"));
  const t1 = Date.now();
  const ansText = await callAnthropic({
    model: overviewModel,
    system: v2.buildV2SystemPrompt("มาติน"),
    user: `ข้อมูลจากระบบ:\n${context}\n\nเขียนคำตอบสำหรับคำค้น: ${query}`,
    maxTokens: v2.V2_MAX_OUTPUT_TOKENS,
  });
  // Same parse + same number gate the deployed handler runs — the probe must
  // measure the path customers get, not a private approximation of it.
  const parsed = v2.parseOverviewV2(ansText);
  if (!parsed) return console.log(`stage 3 (${Date.now() - t1}ms): unparseable:\n${ansText}`);
  if (parsed.salvaged) console.log("  NOTE:    reply salvaged (fence/truncation) — summary recovered whole");
  const verified = v2.exciseUnverifiedNumbers(parsed, context);
  if (!verified) {
    return console.log(`stage 3 (${Date.now() - t1}ms): fully excised (unverified numbers):\n${ansText}`);
  }
  if (verified.excised > 0) console.log(`  NOTE:    excised ${verified.excised} sentence(s) with out-of-context numbers`);
  console.log(`stage 3 (${Date.now() - t1}ms):`);
  console.log(`  SUMMARY: ${verified.summary}`);
  if (verified.detail) console.log(`  DETAIL:  ${verified.detail}`);
  for (const n of quickChecks({ summary: verified.summary, detail: verified.detail }, context)) {
    console.log(`  CHECK:   ${n}`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────

const ingredientsPath = opt("ingredients");
const rawIngredients = ingredientsPath ? JSON.parse(readFileSync(ingredientsPath, "utf-8")) : FIXTURE;
const ingredients = v2.sanitizeIngredients(rawIngredients);
if (!ingredients) {
  console.error("ingredients ไม่ผ่าน sanitizeIngredients — ตรวจไฟล์ที่ส่งเข้ามา");
  process.exit(1);
}
if (flag("live") && !apiKey) {
  console.error("ไม่มี ANTHROPIC_API_KEY/OVERVIEW_API_KEY ใน env หรือ functions/.env — รัน --live ไม่ได้");
  process.exit(1);
}

const single = opt("query");
const queries = single ? [single] : flag("suite") ? SUITE : [];
if (!queries.length) {
  console.log("ใช้: node scripts/v2-live-probe.mjs --query \"...\" [--live] | --suite [--live] [--ingredients path.json]");
  process.exit(0);
}
for (const q of queries) {
  // Sequential on purpose: a dev key does not need a burst, and reading the
  // transcript top to bottom is the whole point of the tool.
  await probe(q, ingredients);
}
