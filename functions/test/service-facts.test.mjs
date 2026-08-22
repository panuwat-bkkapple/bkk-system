// ---------------------------------------------------------------------------
// Offline unit test for service-facts.js. No API key, no Firebase — the pure
// half runs as-is and the loaders run against a tiny fake db.
//
//   node functions/test/service-facts.test.mjs
//
// Two jobs:
//
// 1. THE BOUNDARY. service-facts.js exists so a second surface (the /search AI
//    overview) can answer "มีสาขาที่ไหนบ้าง" without a second copy of the
//    branch reader. The danger of a file named "the stuff the assistant uses"
//    is that the assistant uses pricing too, and pricing needs input only a
//    conversation has — the condition answers, the battery percentage, the
//    address. A price computed without them is a number we quote and then do
//    not honour at the door. So the identifier grep below is not style
//    policing: it is the thing that makes "Overview reads, never calculates"
//    survive the next person who thinks a helper looks lonely.
//
// 2. THE SHAPES. The tool handlers in chat-ai.js now spread these return
//    values straight into their replies, so a renamed key is a silently
//    emptier answer to a customer, not a crash.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const sf = require("../service-facts.js");

const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, "..", "service-facts.js"), "utf8");

// The rule is "no pricing CODE here", so prose is stripped before the grep —
// the file's header has to be free to name the forbidden functions in order to
// explain why they are forbidden, which is the whole point of writing it down.
// Block comments go first, then whole-line // comments; a trailing comment
// after real code survives, and a trailing comment naming a pricing function
// is worth a second look anyway.
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// ---------------------------------------------------------------------------
// 1. The boundary
// ---------------------------------------------------------------------------

// Identifiers, not Thai words. "แบต" and "Battery Health" appear in FAQ prose
// and always will; `liquidityFactor` can only appear if somebody moved a
// pricing formula in here.
const FORBIDDEN = [
  "resolveOptionDeduction", // condition deduction — needs the customer's answers
  "tierDeduction",
  "liquidityFactor",
  "pickBatteryOptionId", // battery bucketing — needs a stated percentage
  "batteryOptionRange",
  "usedPrice", // catalog money: the overview reads this on its own side
  "newPrice",
  "zoneFeeOf", // pickup fee — needs a geocoded address and a distance
  "haversineKm",
  "condition_sets",
  "create_quote_card",
];
for (const id of FORBIDDEN) {
  check(
    `no pricing identifier "${id}" in service-facts.js`,
    !SOURCE.includes(id)
  );
}

// A calculator would have to be exported to be useful to a caller, so the
// export list is the second gate — and the cheaper one to read in review.
const CALC_PREFIX = /^(resolve|compute|calc|price|quote|deduct|estimate)/i;
check(
  "no export is named like a calculator",
  !Object.keys(sf).some((k) => CALC_PREFIX.test(k))
);

// The zone table is data; turning it into baht is not. loadDeliveryZones must
// hand back the published list untouched, with no fee resolved for anyone.
check(
  "loadDeliveryZones exists and zoneFeeOf does not",
  typeof sf.loadDeliveryZones === "function" && sf.zoneFeeOf === undefined
);

// ---------------------------------------------------------------------------
// 2. Pure helpers — unchanged behaviour after the move
// ---------------------------------------------------------------------------

check("FAQ is a non-empty array", Array.isArray(sf.FAQ) && sf.FAQ.length > 0);
check(
  "every FAQ row has category, question and answer",
  sf.FAQ.every((f) => f && f.c && f.q && f.a)
);
check(
  "OFFICIAL_FAQ_LINES is a non-empty array of strings",
  Array.isArray(sf.OFFICIAL_FAQ_LINES) &&
    sf.OFFICIAL_FAQ_LINES.length > 0 &&
    sf.OFFICIAL_FAQ_LINES.every((l) => typeof l === "string" && l.length > 0)
);

// searchFaq is the tool body for get_faq. Empty query = a starter slice, never
// the whole 40-row book (the model is told to summarise, not to paste).
const empty = sf.searchFaq("");
check("searchFaq('') returns a bounded slice", empty.length > 0 && empty.length <= 8);
check(
  "searchFaq returns only {q,a} — no category leaks to the model",
  empty.every((r) => Object.keys(r).sort().join(",") === "a,q")
);
// ── การจ่ายเงิน: what we pay WITH, not just when ──────────────────────────
//
// Added 22 ส.ค. 2569 from a real conversation an admin had to answer by hand:
//
//   customer: "Hello my only bank account is wise"
//   customer: "Is there anyway I can be paid in cash"
//
// Neither question had a fact behind it anywhere in the assistant's brain.
// The only payment line said WHEN money moves ("จ่ายเงินหน้างานทันที"), which
// a customer asking about cash reads as yes — and a rider arrives carrying a
// phone, not cash.
{
  // Thai has no spaces, so retrieval is substring matching and the row has to
  // contain the phrase a customer actually types, verbatim. Both spellings are
  // asserted because the first draft of this row said "โอนหรือเงินสด" and the
  // query "จ่ายเงินสด" matched nothing at all.
  const cash = sf.searchFaq("จ่ายเงินสด");
  const cashLong = sf.searchFaq("จ่ายเงินสดได้ไหม");
  check("cash question retrieves a fact", cash.length > 0 && cashLong.length > 0);
  check(
    "and that fact says no, in words a model cannot soften",
    cash.some((r) => r.a.includes("ไม่ได้") || r.a.includes("ไม่มีการจ่ายเป็นเงินสด"))
  );

  // The /search overview reaches the same rows through a fixed seed query —
  // if this stops returning them, the payment topic goes quiet over there
  // without anything failing here.
  check("the overview's payment seed still reaches the corpus", sf.searchFaq("จ่ายเงิน โอนเงิน ได้เงินเร็วแค่ไหน ช่องทางชำระ").length > 0);

  const wise = sf.searchFaq("Wise บัญชีต่างประเทศ");
  check("a foreign-account question retrieves a fact", wise.length > 0);
  check(
    "naming Wise explicitly, because that is what customers type",
    wise.some((r) => r.a.includes("Wise") && r.a.includes("ธนาคารในประเทศไทยเท่านั้น"))
  );

  // The chat does not depend on retrieval finding the row: the same rule is in
  // the always-on block, where it cannot be missed by a search that scored
  // badly.
  const always = sf.OFFICIAL_FAQ_LINES.join("\n");
  check("the always-on block carries the rule too", always.includes("ธนาคารในประเทศไทยเท่านั้น"));
  check("including the rider, the case most likely to be assumed", always.includes("ไรเดอร์ไม่ได้ถือเงินสดไป"));
  check("and forbids inventing a way out we do not have", always.includes("ห้ามเสนอทางออกที่ร้านไม่มี"));

  // The line that made "cash" a plausible reading in the first place.
  const chatSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "chat-ai.js"), "utf-8");
  check(
    'the service block no longer says the ambiguous "จ่ายเงินหน้างานทันที"',
    !chatSrc.includes('แล้ว "จ่ายเงินหน้างานทันที" ตอนรับเครื่อง')
  );
  check("it says transfer, out loud", chatSrc.includes('โอนเงินเข้าบัญชีหน้างานทันที'));
}

const icloud = sf.searchFaq("iCloud");
check("searchFaq finds a real topic", icloud.length > 0);
check("searchFaq caps its result set at 6", sf.searchFaq("เครื่อง").length <= 6);
check("searchFaq on nonsense returns nothing", sf.searchFaq("zzzqqqxxx").length === 0);

// promoWindowOpen — a date-only end_date must last until the end of that day,
// which is the difference between a campaign ending at midnight and one that
// silently died the moment the day began.
const DAY = "2026-08-15";
check(
  "date-only end_date stays open during that day",
  sf.promoWindowOpen({ end_date: DAY }, Date.parse("2026-08-15T18:00:00+07:00"))
);
check(
  "date-only end_date is shut the next day",
  !sf.promoWindowOpen({ end_date: DAY }, Date.parse("2026-08-17T09:00:00Z"))
);
check(
  "a campaign that has not started is shut",
  !sf.promoWindowOpen({ start_date: "2099-01-01" }, Date.now())
);
check("no dates at all means always open", sf.promoWindowOpen({}, Date.now()));

check("quotaFull is true at the limit", sf.quotaFull({ total_limit: 5, used_count: 5 }));
check("quotaFull is false below it", !sf.quotaFull({ total_limit: 5, used_count: 4 }));
check("no limit is never full", !sf.quotaFull({ used_count: 999 }));

// deliveryZonesFrom — the zone TABLE resolver. Legacy flat config must still
// produce zones rather than nothing.
check(
  "an explicit zones array wins",
  sf.deliveryZonesFrom({ zones: [{ id: "x" }] })[0].id === "x"
);
check(
  "legacy flat config still yields zones",
  sf.deliveryZonesFrom({ baseFare: 40, perKmRate: 8 }).length === 2
);
check("empty config falls back to the defaults", sf.deliveryZonesFrom(null) === sf.DEFAULT_DELIVERY_ZONES);

// buildKbGraphBlock / buildStoreProfileBlock — inert when unset, which is what
// lets the admin configure them long before anyone switches them on.
check("empty kb graph renders nothing", sf.kbGraphRows(null) === "");
// Rows only. The framing sentence that orders the model to call
// escalate_to_human lives in chat-ai.js, because a search page cannot escalate
// anything — this assertion is what stops it drifting back.
check(
  "kbGraphRows emits rows with no chat framing",
  (() => {
    const rows = sf.kbGraphRows({
      nodes: { n: { label: "หมวดหนึ่ง", type: "custom", items: { a: { q: "ถามนี่", a: "ตอบนั่น" } } } },
    });
    return (
      rows.includes("[หมวด: หมวดหนึ่ง]") &&
      rows.includes("ถาม: ถามนี่") &&
      !rows.includes("escalate_to_human") &&
      !rows.includes("คลังคำตอบของร้าน")
    );
  })()
);
check("empty store profile renders nothing", sf.buildStoreProfileBlock(null) === "");
check(
  "a store profile renders the central phone",
  sf.buildStoreProfileBlock({ phone: "02-000-0000" }).includes("02-000-0000")
);

// ---------------------------------------------------------------------------
// 3. Loaders, against a fake db
// ---------------------------------------------------------------------------

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
      b1: { name: "สยาม", address: "ถนนพระราม 1", isActive: true, openHour: 10, closeHour: 20, lat: 13.7, lng: 100.5 },
      b2: { name: "ปิดไปแล้ว", isActive: false },
      b3: { name: "อโศก", isActive: true },
    },
    store: { accept_defective_devices: true },
    chat_kb: { nodes: {}, edges: {} },
  },
  coupons: {
    c1: { code: "SAVE500", name: "ลด 500", value: 500, is_active: true },
    c2: { code: "REVIEW_REWARD", name: "รีวิว", value: 300, system: true },
    c3: { code: "DEAD", value: 100, is_active: false },
    c4: { code: "MACONLY", value: 1000, is_active: true, is_model_restricted: true, applicable_models: ["m1"] },
  },
  rider_fee_promotions: {
    p1: { name: "ส่งฟรีกรุงเทพ", discount_type: "waive", is_active: true, applicable_provinces: [1] },
  },
};

const db = fakeDb(TREE);

const branches = await sf.loadBranches(db);
check("loadBranches drops inactive rows", branches.branches.length === 2);
check(
  "loadBranches formats opening hours from the hour fields",
  branches.branches[0].open_hours === "10:00 - 20:00 น."
);
check(
  "loadBranches builds a map link only when there are coordinates",
  typeof branches.branches[0].map_link === "string" && branches.branches[1].map_link === null
);
check(
  "loadBranches carries the central contact block",
  branches.central && branches.central.phone === "02-111-2222" &&
    branches.central.standard_hours === "10:00-20:00 น."
);

const promos = await sf.loadPromotions(db);
check("loadPromotions hides the system master", !promos.coupons.some((c) => c.code === "REVIEW_REWARD"));
check("loadPromotions hides an inactive campaign", !promos.coupons.some((c) => c.code === "DEAD"));
check("loadPromotions keeps the live ones", promos.coupons.length === 2);
// The flag the /search overview filters on — a bonus it cannot verify the
// customer qualifies for must not be advertised on a page with no device.
check(
  "a model-restricted coupon is flagged as such",
  promos.coupons.find((c) => c.code === "MACONLY").model_restricted === true
);
check(
  "an unrestricted coupon carries no flag",
  promos.coupons.find((c) => c.code === "SAVE500").model_restricted === undefined
);
check(
  "rider promotions come back under their own key",
  promos.pickup_fee_promotions.length === 1 &&
    promos.pickup_fee_promotions[0].province_restricted === true
);

check("loadStoreProfile returns the profile", (await sf.loadStoreProfile(db)).line_id === "@bkkapple");
check("loadKbGraph returns the graph", (await sf.loadKbGraph(db)) !== null);
check("loadAcceptDefective returns the policy flag", (await sf.loadAcceptDefective(db)) === true);
check("loadDeliveryZones falls back when unset", (await sf.loadDeliveryZones(db)).length === 2);

// A missing node is "not configured", never a crash — every one of these is
// optional back-office config that may legitimately never be filled in.
const bare = fakeDb({});
check("no branches configured is an empty list", (await sf.loadBranches(bare)).branches.length === 0);
check("no store profile is an empty object", Object.keys(await sf.loadStoreProfile(bare)).length === 0);
check("no kb graph is null", (await sf.loadKbGraph(bare)) === null);
check("no coupons is an empty list", (await sf.loadPromotions(bare)).coupons.length === 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
