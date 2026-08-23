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
const { answerLanguage, languageLines } = require("../answer-language.js");
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
check("English branch says English, in full", enLines.includes("เขียนคำตอบเป็นภาษาอังกฤษทั้งหมด"));
check("English branch fixes the currency word", enLines.includes('"baht"'));
// CLAUDE.md's approved glossary — an answer that invents its own vocabulary
// reads as a different company than the page it sits on.
check("English branch carries the approved glossary", enLines.includes("quote") && enLines.includes("doorstep pickup"));
check("English branch bans the forbidden term", enLines.includes("ห้าม appraisal"));

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
check(
  "the two prompts differ ONLY in their language lines",
  v2th.split("\n").filter((l) => !thLines.includes(l) && !l.includes("ภาษาไทยธรรมชาติ")).join("\n") ===
    v2en.split("\n").filter((l) => !enLines.includes(l) && !l.includes("ภาษาอังกฤษธรรมชาติ")).join("\n")
);

const v1th = v1.buildOverviewSystemPrompt("มาติน");
const v1en = v1.buildOverviewSystemPrompt("มาติน", "en");
check("v1 default is Thai", v1th.includes("- ภาษาไทย สุภาพ กระชับ ลงท้ายด้วยครับ"));
check("v1 English drops the Thai close", !v1en.includes("- ภาษาไทย สุภาพ กระชับ ลงท้ายด้วยครับ"));
check("v1 English carries the same glossary as v2", v1en.includes("doorstep pickup"));

// ── the wiring: a detector nothing calls is a detector that does nothing ────

const here = dirname(fileURLToPath(import.meta.url));
const handler = readFileSync(join(here, "..", "search-overview.js"), "utf8");
check(
  "the handler decides the language from the customer's own query",
  handler.includes("const answerLang = answerLanguage(query);")
);
check(
  "and hands it to whichever writer runs",
  handler.includes("buildV2SystemPrompt(assistantName, answerLang)") &&
    handler.includes("buildOverviewSystemPrompt(assistantName, answerLang)")
);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
