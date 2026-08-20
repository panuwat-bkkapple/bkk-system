// ---------------------------------------------------------------------------
// Offline test for the Ops Dashboard aggregation + the by_origin dimension.
//
//   node functions/test/ops-dashboard.test.mjs
//
// Everything pinned here is pure: the increment map one AI call writes, the
// price arithmetic, and summarizeOps over a hand-computed fixture day. The
// fixture numbers are worked by hand in the comments — a test that asserts
// whatever the code returns pins nothing (กติกา §4.11/§4.12).
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ops = require("../ops-dashboard.js");
const {
  buildUsageIncrements,
  summarizeOps,
  percentile,
  costFromTokens,
  priceFor,
  EST_SEARCH_CALL_USD,
  opsBangkokYmd,
} = ops;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

// ── 1. buildUsageIncrements — the write every AI call now makes ────────────
{
  const inc = buildUsageIncrements("search", "claude-haiku-4-5", {
    input_tokens: 500,
    output_tokens: 150,
  });
  check(
    "increments land under by_origin/search, totals + by_model",
    inc["by_origin/search/calls"] === 1 &&
      inc["by_origin/search/input_tokens"] === 500 &&
      inc["by_origin/search/by_model/claude-haiku-4-5/output_tokens"] === 150
  );
  check(
    "zero token fields are dropped; calls always writes",
    !("by_origin/search/cache_read_tokens" in inc) && inc["by_origin/search/calls"] === 1
  );

  const wire = buildUsageIncrements("chat", "claude-sonnet-5", {
    input_tokens: 10,
    cache_read_input_tokens: 7,
    cache_creation_input_tokens: 3,
  });
  check(
    "wire-format cache field names normalize to the ledger's names",
    wire["by_origin/chat/cache_read_tokens"] === 7 && wire["by_origin/chat/cache_write_tokens"] === 3
  );

  check(
    "model keys are RTDB-scrubbed, same rule as by_model",
    "by_origin/chat/by_model/model_v1_2/calls" in buildUsageIncrements("chat", "model.v1#2", {})
  );
  check(
    "an unknown origin string cannot invent a third bucket",
    "by_origin/search/calls" in buildUsageIncrements("junk", "m", {})
  );
  check(
    "aggregated multi-call usage carries its call count",
    buildUsageIncrements("chat", "m", { input_tokens: 1 }, 4)["by_origin/chat/calls"] === 4
  );
}

// ── 2. price arithmetic ────────────────────────────────────────────────────
{
  check("haiku priced 1/5 per MTok", priceFor("claude-haiku-4-5").in === 1 && priceFor("claude-haiku-4-5").out === 5);
  check("sonnet priced 3/15", priceFor("claude-sonnet-5").out === 15);
  check("opus priced 5/25, fable ranks above it", priceFor("claude-opus-5").in === 5 && priceFor("claude-fable-5").in === 10);
  check("unknown model falls back to haiku rates", priceFor("mystery").in === 1);
  // 1M in + 100k out + 1M cache-read (10% of input rate) + 100k cache-write
  // (125%) on haiku: 1.0 + 0.5 + 0.1 + 0.125 = 1.725 USD.
  check(
    "cache reads bill at 10% and writes at 125% of the input rate",
    close(
      costFromTokens("claude-haiku-4-5", {
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_read_tokens: 1_000_000,
        cache_write_tokens: 100_000,
      }),
      1.725
    )
  );
}

// ── 3. percentile — nearest rank, null for an empty day ────────────────────
{
  check("p50 of [1000,3000,2000] is 2000", percentile([1000, 3000, 2000], 50) === 2000);
  check("p95 of three values is the max", percentile([1000, 3000, 2000], 95) === 3000);
  check("empty day reads null, never a fake zero", percentile([], 50) === null);
  check("junk values are ignored", percentile([NaN, 500], 50) === 500);
}

// ── 4. summarizeOps over a hand-computed day ───────────────────────────────
// now = 37,800,000 → the current clock hour starts at 36,000,000.
const NOW = 37_800_000;
const ARCHIVE = {
  r1: { summary: "a", latencyMs: 1000, ts: 1, v2: true, origin: "search" },
  r2: { summary: "b", latencyMs: 3000, extractMs: 400, ts: 2, v2: true, salvaged: true, excised: 2, hits: 3 },
  r3: { summary: "c", latencyMs: 2000, ts: 3 },
  r4: { skipped: "rate_limited", ts: 36_500_000 },
  r5: { skipped: "rate_limited", ts: 1_000 },
  r6: { skipped: "unparseable", ts: 2 },
  r7: { skipped: "extract_unparseable", ts: 3 },
  r8: { skipped: "nothing_to_write", ts: 4 },
  r9: { hits: 2, lastHitTs: 5, ts: 5, origin: "search" },
  _gate: { disabled: 4, suspended: 0 },
};
const USAGE = {
  overview_calls: 40,
  calls: 25,
  last_model_fallback: { at: 5 },
  by_origin: {
    search: { by_model: { "claude-haiku-4-5": { input_tokens: 1_000_000, output_tokens: 100_000 } } },
  },
  by_model: {
    "claude-haiku-4-5": {
      input_tokens: 2_000_000,
      output_tokens: 200_000,
      cache_read_tokens: 1_000_000,
      cache_write_tokens: 100_000,
    },
  },
};
const PUB = { enabled: true, daily_overview_cap: 100, daily_call_cap: 50 };
const ENV = {
  searchOverviewKeySet: true,
  anthropicKeySet: false,
  overviewModel: "claude-haiku-4-5",
  extractModel: "claude-haiku-4-5",
  chatModel: "claude-haiku-4-5",
};
const S = summarizeOps({ now: NOW, usage: USAGE, archive: ARCHIVE, pub: PUB, env: ENV });

// budget: search 1M in + 100k out haiku = 1.5 USD (real tokens);
// chat via legacy by_model = 2.0 + 1.0 + 0.1 + 0.125 = 3.225 USD.
check("budget: calls per origin from the ledger", S.budget.search.calls === 40 && S.budget.chat.calls === 25);
check("budget: caps from settings override", S.budget.search.cap === 100 && S.budget.chat.cap === 50);
check("budget: search cost from REAL by_origin tokens", close(S.budget.search.cost_usd, 1.5) && S.budget.search.cost_basis === "tokens");
check("budget: chat cost falls back to legacy by_model (chat-only by fact)", close(S.budget.chat.cost_usd, 3.225) && S.budget.chat.cost_basis === "tokens");
check("budget: one bar = both origins over both caps", S.budget.total_calls === 65 && S.budget.total_cap === 150 && close(S.budget.pct, 65 / 150));
check("budget: total cost is the sum", close(S.budget.total_cost_usd, 4.725));

// health (search-only by fact; chat has no per-answer archive)
check("health: chat row is null, stated not invented", S.health.chat === null);
check("health: answered counts answer rows only", S.health.search.answered === 3);
check("health: salvaged and excised counted", S.health.search.salvaged === 1 && S.health.search.excised_answers === 1 && S.health.search.excised_sentences === 2);
check(
  "health: skip reasons kept apart, unparseable headline sums both parsers",
  S.health.search.skipped.rate_limited === 2 &&
    S.health.search.skipped.nothing_to_write === 1 &&
    S.health.search.unparseable === 2 &&
    S.health.search.skipped_total === 5
);
check("health: gate counters pass through, zero-count reasons dropped", S.health.search.gate.disabled === 4 && !("suspended" in S.health.search.gate));

// perf
check("perf: cache hits include orphan hit rows", S.perf.cache_hits === 5);
check("perf: hit rate over everything SERVED (hits + generated)", close(S.perf.cache_hit_rate, 5 / 8));
check("perf: latency p50/p95 from answer rows", S.perf.latency_p50 === 2000 && S.perf.latency_p95 === 3000);
check("perf: extract latency tracked separately (v2 rows)", S.perf.extract_p50 === 400);
check("perf: rate-limit hits split this-hour vs today", S.perf.rate_limited_this_hour === 1 && S.perf.rate_limited_today === 2);

// flags
check("flags: enabled/suspended from the widget gate node", S.flags.assistant_enabled === true && S.flags.ai_suspended === false);
check("flags: key presence booleans, never key material", S.flags.search_overview_key_set === true && S.flags.anthropic_key_set === false);
check("flags: v2 observed from archive rows (Vercel env unreadable here)", S.flags.v2_answers_today === 2 && S.flags.v1_answers_today === 1);
check("flags: model fallback notice passes through", Boolean(S.flags.last_model_fallback));

// ── 5. the fallback day (before by_origin existed) ─────────────────────────
{
  const bare = summarizeOps({ now: NOW, usage: { overview_calls: 10 }, archive: {}, pub: {}, env: {} });
  check(
    "search cost estimates calls × probe-measured constant when tokens absent",
    close(bare.budget.search.cost_usd, 10 * EST_SEARCH_CALL_USD) && bare.budget.search.cost_basis === "estimate"
  );
  check("chat with no data costs 0 with basis none", bare.budget.chat.cost_usd === 0 && bare.budget.chat.cost_basis === "none");
  check("caps fall back to the spenders' own defaults", bare.budget.search.cap === 2000 && bare.budget.chat.cap === 1500);
  check("an empty day has null latency and null hit rate", bare.perf.latency_p50 === null && bare.perf.cache_hit_rate === null);
}

// ── 6. suspended day flags ─────────────────────────────────────────────────
{
  const sus = summarizeOps({
    now: NOW,
    usage: {},
    archive: {},
    pub: { enabled: true, ai_suspended: true, ai_suspended_reason: "credit", ai_suspended_at: 9 },
    env: {},
  });
  check(
    "suspension surfaces with its reason and time",
    sus.flags.ai_suspended === true && sus.flags.ai_suspended_reason === "credit" && sus.flags.ai_suspended_at === 9
  );
}

// ── 7. the Bangkok day key matches the spenders' bucketing ─────────────────
//
// This section used to assert "1970-01-01" — the format THIS HELPER happened
// to return, not the one the ledger is addressed by. It passed while the
// dashboard read an empty node and reported a busy day as all zeros. So the
// expectations below are derived from the writers' own format instead:
// `chat_ai_usage/{ymd}` and `search_overview_archive/{ymd}` are written under
// a separator-free YYYYMMDD produced from the Asia/Bangkok calendar day, and
// `ledgerYmd` here is an INDEPENDENT implementation of exactly that (Intl,
// the way chat-ai.js and search-overview.js have always computed it) so a
// drift in either direction shows up as a failure rather than as a screen of
// zeros nobody can explain.
const ledgerYmd = (ms) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((x) => x.type === t)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}`;
};

check("ymd carries no separators — it is a path segment, not a display date", /^\d{8}$/.test(opsBangkokYmd(Date.UTC(2026, 7, 20, 11, 0, 0))));

check("ymd is the Bangkok calendar day", opsBangkokYmd(0) === "19700101" && opsBangkokYmd(17 * 3600 * 1000) === "19700102");

// The real failure was a whole day of traffic landing in one node while the
// page read another, so the day this happened is pinned by name.
check("ymd of the day the split was found reads 20260820", opsBangkokYmd(Date.UTC(2026, 7, 20, 11, 16, 0)) === "20260820");

// Instants either side of a UTC midnight, where a +7 offset and a naive UTC
// date disagree — this is the case that proves it is Bangkok's day, not the
// server's.
for (const ms of [
  Date.UTC(2026, 7, 20, 16, 59, 0), // 23:59 Bangkok, same UTC day
  Date.UTC(2026, 7, 20, 17, 30, 0), // 00:30 Bangkok, NEXT day
  Date.UTC(2026, 0, 1, 0, 0, 0),
  Date.UTC(2026, 11, 31, 20, 0, 0),
]) {
  check(
    `ymd agrees with the writers' own Intl computation at ${new Date(ms).toISOString()}`,
    opsBangkokYmd(ms) === ledgerYmd(ms)
  );
}

// ── done ───────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll ops-dashboard checks passed");
