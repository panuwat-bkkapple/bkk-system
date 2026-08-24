// ---------------------------------------------------------------------------
// WHICH LANGUAGE THE OVERVIEW ANSWERS IN.
//
//   node functions/test/answer-language.test.mjs
//
// Production, 23 ส.ค. 2569: a customer wrote eleven lines of English to sell
// two iPhone 13 Pro — battery health, no boxes, bought in Vietnam — and got a
// Thai paragraph back. Both writer prompts ended with "ภาษาไทย สุภาพ ลงท้าย
// ด้วยครับ" and no language travelled with the request.
//
// The dangerous half of the fix is the OTHER direction. Thai customers type
// Latin all day ("iphone 17 pro max", "macbook air m4 256gb"), so a detector
// that keys on "no Thai characters" would flip a large share of ordinary Thai
// traffic into English answers — a worse bug, arriving silently. Half of the
// cases below exist only to hold that line.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const { answerLanguage, languageLines, languageDirective, writeAnswerLine } = require("../answer-language.js");
const { buildV2SystemPrompt } = require("../search-overview-v2.js");
const { __test: v1 } = require("../search-overview.js");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// ── the Thai side: everything a Thai customer types, however it is spelled ──

const STAY_THAI = [
  "iphone 17 pro max",
  "iPhone 13 Pro Max 256GB",
  "macbook air m4 256gb",
  "ipad pro m4 wifi 512gb",
  "airpods pro 2",
  "apple watch ultra 2",
  "iphone 15 ราคา",
  "แมคบุ๊ค m1 ราคาเท่าไหร่",
  "iphone 13 pro max price",   // one English content word is not a sentence
  "trade in iphone",           // "in" is not a voter at all — see the word list
  "iphone for sale",           // "for" is, and one voter is not enough
  "",
];
for (const q of STAY_THAI) {
  check(`stays Thai: ${JSON.stringify(q)}`, answerLanguage(q) === "th");
}

// A single Thai character anywhere settles it — a bilingual customer writing
// mostly English but naming the model in Thai is still a Thai customer.
check(
  "one Thai character outvotes a whole English sentence",
  answerLanguage("Can I sell my ไอโฟน 13 Pro if I have no box?") === "th"
);

// ── the English side: prose, not a name plus a word ─────────────────────────

const ANSWER_IN_ENGLISH = [
  "how much is iphone 13 pro",
  "Can I sell my iPhone 13 Pro with no box?",
  "Do you buy phones that were purchased in Vietnam",
  "Hello, I would like to sell two iPhone 13 Pro devices. Is parking available?",
];
for (const q of ANSWER_IN_ENGLISH) {
  check(`answers in English: ${JSON.stringify(q.slice(0, 46))}`, answerLanguage(q) === "en");
}

// The real query from the incident, verbatim.
const INCIDENT = `Hello, I would like to sell two iPhone 13 Pro devices. I am planning to drive to your shop using the location shown on Google Maps. Is parking available ? Details of the phones: * iPhone 13 Pro x 2 * Both are working normally with no issues. * Battery health is around 80%. * Screen protectors have been applied since purchase. * No boxes and cables. * Both phones were purchased in Vietnam. Could you please confirm if you can buy these phones?`;
check("the incident query answers in English", answerLanguage(INCIDENT) === "en");

// ── the lines themselves ────────────────────────────────────────────────────

const thLines = languageLines("th").join("\n");
const enLines = languageLines("en").join("\n");
check("Thai branch keeps the ครับ instruction", thLines.includes("ลงท้ายด้วยครับ"));
check("English branch drops it", !enLines.includes("ลงท้ายด้วยครับ") || enLines.includes("ห้ามลงท้ายด้วยครับ"));
// The wording moved to English on 24 ส.ค. 2569 — a Thai sentence saying
// "answer in English" reads as one more Thai rule. What is pinned is that the
// block still says it, not which language it used to say it in.
check("English branch says English, in full", enLines.includes("ANSWER IN ENGLISH"));
check("English branch fixes the currency word", enLines.includes('"baht"'));
// CLAUDE.md's approved glossary — an answer that invents its own vocabulary
// reads as a different company than the page it sits on.
check("English branch carries the approved glossary", enLines.includes("quote") && enLines.includes("doorstep pickup"));
check("English branch bans the forbidden term", enLines.includes('never "appraisal"'));

// ── the prompts: language flips, TRUTH RULES DO NOT ─────────────────────────

const v2th = buildV2SystemPrompt("มาติน");
const v2en = buildV2SystemPrompt("มาติน", "en");
check("v2 default is Thai", v2th.includes("- ภาษาไทย สุภาพ ลงท้ายด้วยครับ"));
check("v2 English drops the Thai close", !v2en.includes("- ภาษาไทย สุภาพ ลงท้ายด้วยครับ"));
check("v2 English sets the tone line to English", v2en.includes("ภาษาอังกฤษธรรมชาติ") && !v2en.includes("ภาษาไทยธรรมชาติ"));

// The whole point of the three-layer prompt survives the switch. If a rule
// below ever goes missing in the English branch, an English-speaking customer
// is being served by a weaker set of guarantees than a Thai one.
const TRUTH_RULES = [
  "1. ตัวเลขทุกตัวที่พูดถึงต้องมาจาก",
  "2. ทุกยอดเป็นการประเมินก่อนตรวจเครื่องจริง",
  "4.1 ตัวเลขทุกตัวต้องอยู่ในประโยคที่มีประธานเป็นเจ้าของตัวเลขนั้นจริง",
  "เกณฑ์การหักราคาตามสภาพเป็นความลับทางการค้า",
  "ห้ามเขียนชวนให้กดประเมินราคา",
];
for (const rule of TRUTH_RULES) {
  check(`v2 English keeps: ${rule.slice(0, 40)}`, v2en.includes(rule));
}
// The point of this one is that nothing about TRUTH moves when the language
// does. The directive block joined the list of legitimately-different lines on
// 24 ส.ค. 2569; everything outside it must still match line for line.
const DIRECTIVE = languageDirective("en");
const withoutLanguage = (prompt, lines, toneWord) =>
  prompt
    .split("\n")
    .filter((l) => !lines.includes(l) && !l.includes(toneWord) && !DIRECTIVE.includes(l))
    .join("\n");
check(
  "the two prompts differ ONLY in their language lines",
  withoutLanguage(v2th, thLines, "ภาษาไทยธรรมชาติ") ===
    withoutLanguage(v2en, enLines, "ภาษาอังกฤษธรรมชาติ")
);

const v1th = v1.buildOverviewSystemPrompt("มาติน");
const v1en = v1.buildOverviewSystemPrompt("มาติน", "en");
check("v1 default is Thai", v1th.includes("- ภาษาไทย สุภาพ กระชับ ลงท้ายด้วยครับ"));
check("v1 English drops the Thai close", !v1en.includes("- ภาษาไทย สุภาพ กระชับ ลงท้ายด้วยครับ"));
check("v1 English carries the same glossary as v2", v1en.includes("doorstep pickup"));

// ── the page edition: only heard when the query says nothing ───────────────
//
// The /en visitor who types "iPhone 13 Pro 128GB" is the case this parameter
// exists for: a bare model name carries no prose to detect, so without the
// edition they read a Thai paragraph on an English page. That is most of what
// anyone types into a search box.

check("bare model name on /en answers in English", answerLanguage("iPhone 13 Pro 128GB", "en") === "en");
check("bare model name on the Thai site stays Thai", answerLanguage("iPhone 13 Pro 128GB", "th") === "th");
check("no edition given behaves exactly as before", answerLanguage("iPhone 13 Pro 128GB") === "th");
check("an empty query on /en still answers in English", answerLanguage("", "en") === "en");

// Positive evidence of what the customer is writing NOW beats the setting.
check(
  "Thai text on /en answers in Thai",
  answerLanguage("ไอโฟน 13 โปร ราคาเท่าไหร่", "en") === "th"
);
// And the reverse: English prose on the Thai site was already handled, and
// must not regress now that a second signal exists.
check(
  "English prose on the Thai site still answers in English",
  answerLanguage("how much is iphone 13 pro", "th") === "en"
);
// A value we do not recognise is not a third language — it is Thai.
check("an unknown edition value falls back to Thai", answerLanguage("iPhone 13 Pro", "de") === "th");

// ── the wiring: a detector nothing calls is a detector that does nothing ────

const here = dirname(fileURLToPath(import.meta.url));
const handler = readFileSync(join(here, "..", "search-overview.js"), "utf8");
check(
  "the handler decides the language from the query AND the page edition",
  handler.includes("const answerLang = answerLanguage(query, pageLang);")
);
check(
  "the page edition comes from the request body, defaulting to Thai",
  handler.includes('const pageLang = body.lang === "en" ? "en" : "th";')
);
// The one that would be silent: two languages sharing a cache entry serves
// whichever arrived first to everyone for the next hour.
check(
  "the language is part of BOTH cache keys",
  handler.includes("v2CacheKey(query, ingredients, await v2FactsVersion(db), answerLang)") &&
    handler.includes("cacheKeyFor(query, context, answerLang)")
);
check(
  "and hands it to whichever writer runs",
  handler.includes("buildV2SystemPrompt(assistantName, answerLang)") &&
    handler.includes("buildOverviewSystemPrompt(assistantName, answerLang)")
);

// ---------------------------------------------------------------------------
// THE DIRECTIVE THAT LOST, AND WHY IT NOW SITS WHERE IT DOES.
//
// Production, 24 ส.ค. 2569, "iphone 15 pro 128GB" on /en. The function logged
//
//   [searchOverview] answering in en
//
// and served a Thai answer. So `body.lang` arrived, answerLanguage returned
// "en", the cache key carried it — every link worked — and the model still
// answered in Thai, because the instruction was ONE THAI LINE near the end of
// a 5,542-character Thai prompt, followed by a Thai context, followed by a
// Thai closing line.
//
// The old test asserted the prompt CONTAINED an English-language instruction.
// It passed throughout. Containing it was never the property that mattered:
// position and language were. These check those, which is as far as a test
// can reach — whether the model complies is a production observation, not a
// unit test, and this comment is the honest limit of what is proven here.
// ---------------------------------------------------------------------------

check("directive: Thai gets none at all", languageDirective("th").length === 0);
check("directive: an absent language gets none", languageDirective(undefined).length === 0);

{
  const d = languageDirective("en");
  check("directive: English gets one", d.length > 0);
  // Written IN English. A Thai sentence saying "answer in English" reads as
  // one more Thai rule; the same sentence in English reads as the language to
  // produce.
  check(
    "directive: is written in English, with no Thai script in it",
    !/[\u0E00-\u0E7F]/.test(d.filter((l) => !l.includes("BKK APPLE")).join(" "))
  );
  check("directive: says which language, unmissably", /ENTIRE answer in English/.test(d.join(" ")));
  // The prompt around it IS Thai. Without this the model can read the Thai as
  // the answer's register rather than as reference material.
  check(
    "directive: names the Thai around it as source material, not as the register",
    /SOURCE MATERIAL/i.test(d.join(" "))
  );
}

// ── position: first, not eighty lines down ────────────────────────────────
{
  const v2 = require("../search-overview-v2.js");
  const en = v2.buildV2SystemPrompt("มาติน", "en");
  const th = v2.buildV2SystemPrompt("มาติน", "th");
  check(
    "position: the English directive is the FIRST line of the prompt",
    en.startsWith("OUTPUT LANGUAGE")
  );
  check(
    "position: ahead of the persona, which used to open it",
    en.indexOf("OUTPUT LANGUAGE") < en.indexOf("คุณคือมาติน")
  );
  // The Thai site must not move at all. Byte equality, not "looks the same".
  check("position: the Thai prompt still opens with the persona", th.startsWith("คุณคือมาติน"));
  check("position: and carries no directive block", !th.includes("OUTPUT LANGUAGE"));
}

// ── the last line before generation ───────────────────────────────────────
{
  // Whatever else the payload says, this is the closest instruction to the
  // point of generation. It was Thai on every request, including English ones.
  check(
    "closing line: Thai is byte-for-byte the literal it replaced",
    writeAnswerLine("iphone 15", "th") === "เขียนคำตอบสำหรับคำค้น: iphone 15"
  );
  check(
    "closing line: English says the language again, and carries the query",
    writeAnswerLine("iphone 15", "en") === "Write the answer in ENGLISH for this search: iphone 15"
  );
  check(
    "closing line: no Thai script survives in the English form",
    !/[\u0E00-\u0E7F]/.test(writeAnswerLine("iphone 15", "en"))
  );
  // Wired, not merely exported.
  check(
    "wiring: the handler builds its user message with it",
    handler.includes("writeAnswerLine(query, answerLang)")
  );
  check(
    "wiring: and the old hardcoded Thai tail is gone",
    !handler.includes("\\n\\nเขียนคำตอบสำหรับคำค้น: ${query}`")
  );
}

// ── the rules block ───────────────────────────────────────────────────────
check(
  "rules: the English block opens in English",
  // Thai survives inside it on purpose: this line NAMES the particles it
  // bans (ครับ/ค่ะ), and the glossary below maps from Thai terms. What has to
  // be English is the instruction itself.
  languageLines("en")[0].startsWith("- ANSWER IN ENGLISH.")
);
check(
  "rules: Thai is untouched",
  languageLines("th").join("") === "- ภาษาไทย สุภาพ ลงท้ายด้วยครับ"
);
// The glossary line keeps its Thai source terms on purpose — it MAPS Thai to
// English, so the Thai side of each pair has to be there.
check(
  "rules: the glossary still maps from the Thai terms",
  languageLines("en").some((l) => l.includes("ประเมินราคา") && l.includes("quote"))
);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
