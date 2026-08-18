// ---------------------------------------------------------------------------
// Offline unit test for the store-facts layer of customerSearchOverview.
// No API key, no Firebase — the renderers run against a fake db.
//
//   node functions/test/search-overview-facts.test.mjs
//
// The bug this layer exists for: asked "มีสาขาที่ไหนบ้าง", the generator was
// handed the /branches page's marketing blurb and nothing else, and wrote a
// fluent paragraph of service description containing no branch. It summarised
// what it was given, correctly and uselessly.
//
// So the assertions below are mostly about what must NOT reach the model:
// a bonus we cannot promise, a fee we have not calculated, or an instruction
// to call a tool this surface does not have.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../search-overview.js");
const { sanitizeTopics, renderTopic, buildServiceFacts, factsMemo, SERVICE_FACTS_MAX_CHARS, MAX_TOPICS } = __test;
const { buildOverviewSystemPrompt } = __test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const fakeDb = (tree) => ({
  ref(path) {
    return {
      async once() {
        const val = path.split("/").reduce((acc, k) => (acc == null ? acc : acc[k]), tree);
        return { val: () => (val === undefined ? null : val), exists: () => val !== undefined };
      },
    };
  },
});

const TREE = {
  settings: {
    store_profile: { phone: "02-111-2222", line_id: "@bkkapple", hours_start: "10:00", hours_end: "20:00" },
    branches: {
      b1: { name: "สาขาสยาม", address: "ถนนพระราม 1", isActive: true, openHour: 10, closeHour: 20, lat: 13.7, lng: 100.5 },
      b2: { name: "ปิดถาวร", isActive: false },
      b3: { name: "สาขาภูเก็ต", address: "กะทู้", isActive: true, openHour: 10, closeHour: 22 },
    },
    store: {
      delivery_pricing: {
        zones: [
          { id: "metro", name: "กรุงเทพและปริมณฑล", pricing: { type: "distance", baseFare: 50, freeRadius: 5, perKmRate: 10, maxFee: 300 }, etaText: "1-2 ชั่วโมง" },
          { id: "east", name: "ชลบุรี", pricing: { type: "flat", flatFee: 500 }, etaText: "2-3 ชั่วโมง" },
        ],
      },
    },
  },
  coupons: {
    open1: { code: "ALLMODELS", name: "โบนัสทุกรุ่น", value: 500, is_active: true },
    open2: { code: "MINSPEND", name: "ยอดขั้นต่ำ", value: 300, is_active: true, min_trade_value: 10000, end_date: "2026-12-31" },
    restricted: { code: "MACONLY", name: "เฉพาะแมค", value: 1000, is_active: true, is_model_restricted: true, applicable_models: ["m1"] },
    sys: { code: "REVIEW_REWARD", value: 300, system: true },
    dead: { code: "DEAD", value: 100, is_active: false },
  },
  rider_fee_promotions: {
    p1: { name: "ส่งฟรีทั่วประเทศ", discount_type: "waive", is_active: true },
    p2: { name: "เฉพาะกรุงเทพ", discount_type: "waive", is_active: true, applicable_provinces: [1] },
  },
};
const db = fakeDb(TREE);
const text = async (topic) => (await renderTopic(db, topic)).join("\n");

// ---------------------------------------------------------------------------
// sanitizeTopics — whatever the website sends, reduced to something known
// ---------------------------------------------------------------------------
check("keeps ids it recognises", sanitizeTopics(["branches", "payment"]).join() === "branches,payment");
check("drops ids it does not", sanitizeTopics(["branches", "made_up"]).join() === "branches");
check("caps at MAX_TOPICS", sanitizeTopics(["branches", "payment", "delivery"]).length === MAX_TOPICS);
check("de-duplicates", sanitizeTopics(["branches", "branches"]).join() === "branches");
check("survives junk input", sanitizeTopics(null).length === 0 && sanitizeTopics("branches").length === 0);
check("survives hostile input", sanitizeTopics([{ a: 1 }, 42, "x".repeat(500)]).length === 0);

// ---------------------------------------------------------------------------
// branches — the reported failure
// ---------------------------------------------------------------------------
{
  const t = await text("branches");
  check("branches names the actual branches", t.includes("สาขาสยาม") && t.includes("สาขาภูเก็ต"));
  check("branches hides inactive rows", !t.includes("ปิดถาวร"));
  check("branches carries per-branch hours", t.includes("10:00 - 20:00") && t.includes("10:00 - 22:00"));
  check("branches carries the central contact", t.includes("02-111-2222") && t.includes("@bkkapple"));
  // The chat tool tells the model to attach map links and to offer an
  // escalation. Neither belongs on a page with no chat.
  check("branches carries no chat instruction", !t.includes("escalate") && !t.includes("แนบ map_link"));
}

// ---------------------------------------------------------------------------
// promotions — the money that must not be promised
// ---------------------------------------------------------------------------
{
  const t = await text("promotions");
  check("promotions lists a campaign open to everyone", t.includes("ALLMODELS"));
  check("promotions keeps its conditions", t.includes("10,000") && t.includes("2026-12-31"));
  // A page that does not know which device the reader owns must not announce a
  // bonus that depends on it — that number arrives quoted at the door.
  check("promotions hides a model-restricted campaign", !t.includes("MACONLY") && !t.includes("เฉพาะแมค"));
  check("promotions hides the system master", !t.includes("REVIEW_REWARD"));
  check("promotions hides an inactive campaign", !t.includes("DEAD"));
  check("promotions lists a nationwide pickup promo", t.includes("ส่งฟรีทั่วประเทศ"));
  // No address here either, so the same rule applies.
  check("promotions hides a province-restricted promo", !t.includes("เฉพาะกรุงเทพ"));
}
{
  // "Nothing applies to everyone" is an answer. An empty section is an
  // invitation for the model to fill the gap itself.
  const bare = fakeDb({ coupons: { r: { code: "R", value: 1, is_active: true, is_model_restricted: true, applicable_models: ["x"] } }, rider_fee_promotions: {} });
  const t = (await renderTopic(bare, "promotions")).join("\n");
  check("promotions says so out loud when nothing is open to all", t.includes("ไม่มีโปรโมชั่นที่ใช้ได้กับทุกรุ่น"));
}

// ---------------------------------------------------------------------------
// delivery — a price LIST, never a price
// ---------------------------------------------------------------------------
{
  const t = await text("delivery");
  check("delivery names the zones", t.includes("กรุงเทพและปริมณฑล") && t.includes("ชลบุรี"));
  check("delivery frames the distance zone as a starting point", t.includes("เริ่มต้น") && t.includes("คิดตามระยะทาง"));
  check("delivery says the real number comes later", t.includes("ยอดจริงคำนวณตอนทำรายการ"));
  check("delivery offers the free alternatives", t.includes("Mail-in"));
}

// ---------------------------------------------------------------------------
// FAQ-backed topics
// ---------------------------------------------------------------------------
{
  const t = await text("encumbered");
  check("encumbered returns real FAQ rows", t.includes("ผ่อน") && t.length > 60);
  // OFFICIAL_FAQ_LINES covers the same ground but is written as orders to the
  // chat model. Instructions a surface cannot follow become promises nothing
  // keeps, so only the plain Q&A rows are used.
  check("FAQ topic carries no chat orders", !t.includes("ห้ามพูดว่า") && !t.includes("escalate"));

  const p = await text("payment");
  check("payment returns rows about money", p.includes("โอน") || p.includes("เงิน"));

  check("an unknown topic renders nothing", (await renderTopic(db, "nope")).length === 0);
}

// ---------------------------------------------------------------------------
// buildServiceFacts — the cap, the header, the memo
// ---------------------------------------------------------------------------
{
  factsMemo.clear();
  const block = await buildServiceFacts(db, ["branches"]);
  check("facts block is labelled as system data", block.includes("ข้อมูลร้าน (ข้อเท็จจริงจากระบบ)"));
  check("facts block starts on its own paragraph", block.startsWith("\n\n"));
  check("facts block stays under the cap", block.length <= SERVICE_FACTS_MAX_CHARS + 60);
  check("no topics means no block at all", (await buildServiceFacts(db, [])) === "");
}
{
  // A fact cut mid-sentence is worse than an absent one: the model finishes
  // the thought itself. Truncation is by whole line.
  factsMemo.clear();
  const many = {};
  for (let i = 0; i < 200; i++) {
    many[`b${i}`] = { name: `สาขาทดสอบหมายเลข ${i}`, address: "ที่อยู่ยาวมากสำหรับการทดสอบการตัดบรรทัด", isActive: true, openHour: 10, closeHour: 20 };
  }
  const big = fakeDb({ settings: { branches: many } });
  const block = await buildServiceFacts(big, ["branches"]);
  check("oversized facts are capped", block.length <= SERVICE_FACTS_MAX_CHARS + 60);
  check("cap does not cut a line in half", block.split("\n").every((l) => !l.endsWith("ที่อยู่ยาวมากสำหรับการทดสอบการตั")));
}
{
  // The facts sit inside the cache key, so they are fetched before the cache
  // can be read — every request would otherwise pay the RTDB round trip.
  factsMemo.clear();
  let reads = 0;
  const counting = {
    ref(path) {
      return {
        async once() {
          reads++;
          const val = path.split("/").reduce((acc, k) => (acc == null ? acc : acc[k]), TREE);
          return { val: () => (val === undefined ? null : val), exists: () => val !== undefined };
        },
      };
    },
  };
  await buildServiceFacts(counting, ["branches"]);
  const first = reads;
  await buildServiceFacts(counting, ["branches"]);
  check(`memo serves the second call without re-reading (${first} reads, then 0)`, reads === first && first > 0);
}
{
  // A broken read is "no facts for this topic", never a failed overview: the
  // catalog paragraph is still worth writing.
  factsMemo.clear();
  const broken = { ref: () => ({ once: async () => { throw new Error("rtdb down"); } }) };
  check("a failed read degrades to no facts", (await buildServiceFacts(broken, ["branches"])) === "");
}

// ---------------------------------------------------------------------------
// Rule 9 — the rule the reported failure is written against
// ---------------------------------------------------------------------------
{
  const prompt = buildOverviewSystemPrompt("มาติน");
  check("prompt carries rule 9", prompt.includes("9. ถ้าข้อมูลจากระบบด้านล่างไม่มีคำตอบ"));
  check("rule 9 forbids the plausible non-answer", prompt.includes("ห้ามเขียนย่อหน้าที่ฟังดูเหมือนคำตอบ"));
  check("earlier rules are untouched", prompt.includes("8. ถ้าจะพูดถึง 'ช่วงราคารวม'") && prompt.includes("7. ห้ามใช้อีโมจิ"));
}

// ---------------------------------------------------------------------------
// Rules 10-12 — deduction figures are read-only, estimates are labelled as
// estimates, and the overview never asks the customer anything back.
// Written BEFORE the website ships computed deduction lines: deploy order is
// function-first, so the model knows the rules before it ever sees a figure.
// ---------------------------------------------------------------------------
{
  const prompt = buildOverviewSystemPrompt("มาติน");
  check("rule 10 forbids computing a deduction", prompt.includes("10. ถ้ามีบรรทัดระบุยอดหักตามสภาพ") && prompt.includes("ห้ามคำนวณยอดหักหรือเปอร์เซ็นต์การหักเอง"));
  check("rule 10 forbids estimating an unlisted defect", prompt.includes("ตำหนิที่ไม่มีบรรทัดยอดหักให้ ห้ามประมาณตัวเลขเองเด็ดขาด"));
  check("rule 11 labels remainders as pre-inspection", prompt.includes("11. ยอด 'เหลือประมาณ'") && prompt.includes("ยืนยันอีกครั้งหลังตรวจสภาพเครื่อง"));
  check("rule 11 forbids guarantee wording", prompt.includes("ห้ามใช้คำว่ารับประกัน การันตี"));
  check("rule 12 forbids asking the customer back", prompt.includes("12. ห้ามถามคำถามกลับไปหาลูกค้าไม่ว่ากรณีใด"));
  check("rule 12 hands questioning to chat and the form", prompt.includes("หน้าที่ของแชทและฟอร์มประเมินราคา"));
  // The rules sit inside the numbered block, before the answer-format section
  // — a rule after "รูปแบบคำตอบ" reads as formatting advice, not a rule.
  check("rules 10-12 precede the format section", prompt.indexOf("12. ห้ามถามคำถามกลับ") < prompt.indexOf("รูปแบบคำตอบ"));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
