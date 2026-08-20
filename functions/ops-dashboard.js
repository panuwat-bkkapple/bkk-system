// ---------------------------------------------------------------------------
// Ops Dashboard — one callable feeding one admin page (/ops).
//
// PURPOSE: the numbers the owner checks before and after the V2 flip, on one
// screen, readable in five seconds: today's spend against the caps, answer
// health, cache/latency, and what is actually switched on right now.
//
// READS ONLY WHAT ALREADY EXISTS — no new store (the one condition of the
// chunk): chat_ai_usage/{ymd} (the daily ledger both spenders share),
// search_overview_archive/{ymd} (one day's answer rows — bounded by distinct
// questions per day, tens not thousands), settings/chat_widget/public, and
// env presence. All server-side behind a CEO/MANAGER callable, same gate as
// adminSearchAnalytics: the archive and the ledger inherit the root deny, so
// no client can read them directly, and that stays true.
//
// THE ORIGIN DIMENSION (the other half of the chunk): every AI spend is now
// mirrored under chat_ai_usage/{ymd}/by_origin/{search|chat} via
// recordAiUsage below — real tokens per origin per model, written at every
// call site in chat-ai.js and search-overview.js. The dimension exists BEFORE
// the second channel opens, so day one of v2 traffic is already split. The
// pre-existing top-level fields keep their exact meaning (calls = chat,
// overview_calls = search, token totals = chat's) — nothing that reads them
// today changes.
//
// WHAT THIS PAGE DOES NOT SHOW, said plainly rather than papered over:
// chat has no per-answer archive (answers live in inbox conversations), so
// the answer-health row is search-only and the UI says so. A chat archive is
// a new store — next round's decision, not this one's.
// ---------------------------------------------------------------------------

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase, ServerValue } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");

const REGION = "asia-southeast1";
const READ_ROLES = ["CEO", "MANAGER"];

// Mirrors DEFAULT_DAILY_OVERVIEW_CAP (search-overview.js) and
// DEFAULT_DAILY_CALL_CAP (chat-ai.js) — the same fallback the spenders use
// when settings/chat_widget/public carries no override. Requiring them from
// their homes would work for search-overview but chat-ai pulls firebase
// params at load; two numbers are cheaper than that import.
const DEFAULT_OVERVIEW_CAP = 2000;
const DEFAULT_CHAT_CAP = 1500;

/**
 * Anthropic list prices, USD per million tokens, matched on the model id.
 * Cache multipliers are the published ones: a cache read bills at 10% of the
 * input rate, a cache write at 125%. Order matters — fable/mythos before
 * opus, and the default is Haiku because both of this project's pipelines
 * run on it.
 */
const PRICE_TABLE = [
  { match: /fable|mythos/i, in: 10, out: 50 },
  { match: /opus/i, in: 5, out: 25 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /haiku/i, in: 1, out: 5 },
];
const DEFAULT_PRICE = { in: 1, out: 5 };

function priceFor(modelKey) {
  const hit = PRICE_TABLE.find((p) => p.match.test(String(modelKey || "")));
  return hit ? { in: hit.in, out: hit.out } : DEFAULT_PRICE;
}

/**
 * The estimate used ONLY for ledger days without by_origin token data (rows
 * written before this chunk deployed). Derived from the live-probe's measured
 * sizes, per generation: stage 1 ~500 tokens in + ~150 out, stage 3 ~4,000 in
 * + ~700 out, both Haiku ($1/$5 per MTok) → ~$0.0087. Rounded up — an
 * estimate on a budget bar should err on the expensive side.
 */
const EST_SEARCH_CALL_USD = 0.009;

/** One model's token usage priced in USD. Accepts the aggregated field names
 *  the ledger stores (cache_read_tokens/cache_write_tokens). */
function costFromTokens(modelKey, u) {
  const p = priceFor(modelKey);
  const inTok = Number(u.input_tokens) || 0;
  const outTok = Number(u.output_tokens) || 0;
  const cacheRead = Number(u.cache_read_tokens) || 0;
  const cacheWrite = Number(u.cache_write_tokens) || 0;
  return (inTok * p.in + outTok * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / 1e6;
}

/** Σ cost over a by_model map. Null when the map holds nothing — the caller
 *  falls back rather than reporting a confident zero. */
function costFromByModel(byModel) {
  const entries = Object.entries(byModel || {});
  if (!entries.length) return null;
  let usd = 0;
  for (const [mk, u] of entries) usd += costFromTokens(mk, u || {});
  return usd;
}

// ---------------------------------------------------------------------------
// The origin dimension — written at every AI call site from now on
// ---------------------------------------------------------------------------

/** RTDB-safe model key, same scrub chat-ai.js uses for by_model. */
function modelKeyOf(model) {
  return String(model || "unknown").replace(/[.#$/\[\]]/g, "_");
}

/**
 * The multi-path increment map for one AI call's usage, PURE so the test can
 * pin every path without a database. Wire-format usage field names
 * (cache_read_input_tokens / cache_creation_input_tokens) are accepted next
 * to the ledger's aggregated names, because the call sites hold whichever
 * their response object carries.
 *
 * Zero-valued token fields are dropped (an increment of 0 is a write that
 * changes nothing); `calls` always writes — a call that used no tokens still
 * happened.
 */
function buildUsageIncrements(origin, model, usage, calls = 1) {
  const o = origin === "chat" ? "chat" : "search";
  const u = usage || {};
  const mk = modelKeyOf(model);
  const fields = {
    calls: Number(calls) || 0,
    input_tokens: Number(u.input_tokens) || 0,
    output_tokens: Number(u.output_tokens) || 0,
    cache_read_tokens: Number(u.cache_read_tokens ?? u.cache_read_input_tokens) || 0,
    cache_write_tokens: Number(u.cache_write_tokens ?? u.cache_creation_input_tokens) || 0,
  };
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k !== "calls" && v === 0) continue;
    out[`by_origin/${o}/${k}`] = v;
    out[`by_origin/${o}/by_model/${mk}/${k}`] = v;
  }
  return out;
}

/** Bangkok calendar day — mirrors bangkokYmd in search-overview.js (kept
 *  local so this module imports nothing from either spender; both import
 *  from HERE, and a cycle would be the alternative). */
function opsBangkokYmd(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Mirror one AI call's usage under by_origin — fire-and-forget, exactly like
 * the ledger writes it sits next to: accounting must never fail a customer
 * request, so every failure is a swallowed warn.
 */
function recordAiUsage(db, { origin, model, usage, calls = 1 }) {
  try {
    const inc = buildUsageIncrements(origin, model, usage, calls);
    const payload = {};
    for (const [path, v] of Object.entries(inc)) payload[path] = ServerValue.increment(v);
    db.ref(`chat_ai_usage/${opsBangkokYmd()}`)
      .update(payload)
      .catch((e) => console.warn(`[opsUsage] by_origin write failed:`, e && e.message));
  } catch (e) {
    console.warn(`[opsUsage] by_origin write threw:`, e && e.message);
  }
}

// ---------------------------------------------------------------------------
// The aggregation — pure, so the offline test pins every number
// ---------------------------------------------------------------------------

/** Nearest-rank percentile on a sorted copy. Null for an empty day — a
 *  latency of 0 would read as "instant", which is a lie about no data. */
function percentile(values, p) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * One day's operational picture from the stores that already exist.
 *
 * `archive` is one day's search_overview_archive node: hash-keyed rows
 * (answers and refusals) plus the `_gate` counters. `usage` is the shared
 * daily ledger. `pub` is settings/chat_widget/public. `env` carries booleans
 * and names only — never key material.
 */
function summarizeOps({ now, usage, archive, pub, env }) {
  const u = usage || {};
  const a = archive || {};
  const p = pub || {};
  const e = env || {};

  // ── budget ────────────────────────────────────────────────────────────────
  const searchCalls = Number(u.overview_calls) || 0;
  const chatCalls = Number(u.calls) || 0;
  const searchCap = Number(p.daily_overview_cap) || DEFAULT_OVERVIEW_CAP;
  const chatCap = Number(p.daily_call_cap) || DEFAULT_CHAT_CAP;

  const byOrigin = u.by_origin || {};
  const searchTokenCost = costFromByModel(byOrigin.search && byOrigin.search.by_model);
  // Chat's by_model existed BEFORE the origin dimension and only chat ever
  // wrote it, so it is an accurate chat fallback for ledger days older than
  // this chunk — by_origin wins once both exist.
  const chatTokenCost =
    costFromByModel(byOrigin.chat && byOrigin.chat.by_model) ?? costFromByModel(u.by_model);

  const search = {
    calls: searchCalls,
    cap: searchCap,
    cost_usd: searchTokenCost ?? searchCalls * EST_SEARCH_CALL_USD,
    cost_basis: searchTokenCost != null ? "tokens" : "estimate",
  };
  const chat = {
    calls: chatCalls,
    cap: chatCap,
    cost_usd: chatTokenCost ?? 0,
    cost_basis: chatTokenCost != null ? "tokens" : "none",
  };
  const totalCalls = searchCalls + chatCalls;
  const totalCap = searchCap + chatCap;

  // ── answer health + performance, from the archive rows ───────────────────
  const skipped = {};
  const latencies = [];
  const extractLatencies = [];
  let answered = 0;
  let salvaged = 0;
  let excisedAnswers = 0;
  let excisedSentences = 0;
  let cacheHits = 0;
  let v2Answers = 0;
  let rateLimitedToday = 0;
  let rateLimitedThisHour = 0;
  const hourStart = now - (now % 3600000);

  for (const [key, row] of Object.entries(a)) {
    if (key === "_gate" || !row || typeof row !== "object") continue;
    cacheHits += Number(row.hits) || 0;
    if (row.skipped) {
      const reason = String(row.skipped);
      skipped[reason] = (skipped[reason] || 0) + 1;
      if (reason === "rate_limited") {
        rateLimitedToday += 1;
        if (Number(row.ts) >= hourStart) rateLimitedThisHour += 1;
      }
      continue;
    }
    if (!row.summary) continue; // orphan hit row (midnight edge) — hits counted above
    answered += 1;
    if (row.v2 === true) v2Answers += 1;
    if (row.salvaged === true) salvaged += 1;
    if (Number(row.excised) > 0) {
      excisedAnswers += 1;
      excisedSentences += Number(row.excised);
    }
    if (Number(row.latencyMs) > 0) latencies.push(Number(row.latencyMs));
    if (Number(row.extractMs) > 0) extractLatencies.push(Number(row.extractMs));
  }

  const gate = {};
  for (const [reason, count] of Object.entries(a._gate || {})) {
    if (Number(count) > 0) gate[reason] = Number(count);
  }

  const unparseable = (skipped.unparseable || 0) + (skipped.extract_unparseable || 0);
  const served = answered + cacheHits;

  return {
    budget: {
      search,
      chat,
      total_calls: totalCalls,
      total_cap: totalCap,
      pct: totalCap > 0 ? totalCalls / totalCap : 0,
      total_cost_usd: search.cost_usd + chat.cost_usd,
    },
    health: {
      // Search-only BY FACT, not by oversight: chat keeps no per-answer
      // archive (a new store = a different chunk). The UI prints this.
      search: {
        answered,
        salvaged,
        excised_answers: excisedAnswers,
        excised_sentences: excisedSentences,
        unparseable,
        skipped,
        skipped_total: Object.values(skipped).reduce((s, n) => s + n, 0),
        gate,
      },
      chat: null,
    },
    perf: {
      cache_hits: cacheHits,
      generated: answered,
      cache_hit_rate: served > 0 ? cacheHits / served : null,
      latency_p50: percentile(latencies, 50),
      latency_p95: percentile(latencies, 95),
      extract_p50: percentile(extractLatencies, 50),
      extract_p95: percentile(extractLatencies, 95),
      rate_limited_this_hour: rateLimitedThisHour,
      rate_limited_today: rateLimitedToday,
    },
    flags: {
      assistant_enabled: p.enabled === true,
      ai_suspended: p.ai_suspended === true,
      ai_suspended_reason: String(p.ai_suspended_reason || ""),
      ai_suspended_at: Number(p.ai_suspended_at) || null,
      search_overview_key_set: e.searchOverviewKeySet === true,
      anthropic_key_set: e.anthropicKeySet === true,
      overview_model: String(e.overviewModel || ""),
      extract_model: String(e.extractModel || ""),
      chat_model: String(e.chatModel || ""),
      last_model_fallback: u.last_model_fallback || null,
      // SEARCH_OVERVIEW_V2 lives on Vercel and cannot be read from here, so
      // the flag row reports the OBSERVED truth instead: how many of today's
      // answers ran each pipeline. v2 > 0 = the flag is live somewhere.
      v2_answers_today: v2Answers,
      v1_answers_today: answered - v2Answers,
    },
  };
}

// ---------------------------------------------------------------------------
// The callable
// ---------------------------------------------------------------------------

function registerOpsDashboard() {
  const adminOpsDashboard = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ต้องล็อกอินก่อน");
    const db = getDatabase();
    const staff = (await lookupStaffByAuth(db, request.auth)) || {};
    const role = String(staff.role || "").toUpperCase();
    if (!READ_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", `เฉพาะ ${READ_ROLES.join("/")} เท่านั้น`);
    }

    const now = Date.now();
    const ymd = opsBangkokYmd(now);
    const [usageSnap, archiveSnap, pubSnap] = await Promise.all([
      db.ref(`chat_ai_usage/${ymd}`).once("value"),
      db.ref(`search_overview_archive/${ymd}`).once("value"),
      db.ref("settings/chat_widget/public").once("value"),
    ]);
    const usage = usageSnap.val() || {};
    // Per-conversation SICKW noise — same exclusion getChatAiKnowledge makes.
    delete usage.sickw_by_uid;

    const summary = summarizeOps({
      now,
      usage,
      archive: archiveSnap.val() || {},
      pub: pubSnap.val() || {},
      env: {
        searchOverviewKeySet: Boolean(process.env.SEARCH_OVERVIEW_KEY),
        anthropicKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
        overviewModel: process.env.OVERVIEW_MODEL || process.env.CHAT_AI_MODEL || "claude-haiku-4-5",
        extractModel: process.env.OVERVIEW_EXTRACT_MODEL || process.env.OVERVIEW_MODEL || "claude-haiku-4-5",
        chatModel: process.env.CHAT_AI_MODEL || "claude-haiku-4-5",
      },
    });
    return { ymd, generated_at: now, ...summary };
  });

  return { adminOpsDashboard };
}

module.exports = {
  registerOpsDashboard,
  recordAiUsage,
  // Pure pieces, exported for the offline tests.
  buildUsageIncrements,
  summarizeOps,
  percentile,
  costFromTokens,
  priceFor,
  EST_SEARCH_CALL_USD,
  opsBangkokYmd,
};
