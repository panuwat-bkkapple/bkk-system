/**
 * WHICH LANGUAGE THE SEARCH OVERVIEW ANSWERS IN.
 *
 * The bug this exists for: a customer wrote in to sell two iPhone 13 Pro —
 * eleven lines of English, battery health, no boxes, bought in Vietnam — and
 * got a Thai paragraph back, because both writer prompts ended with the line
 * "ภาษาไทย สุภาพ ลงท้ายด้วยครับ" and nothing anywhere carried a language.
 * Someone who writes that much detail is someone who means to sell; an answer
 * they cannot read ends the conversation there.
 *
 * WHY THIS IS NOT "no Thai characters = answer in English"
 *
 * Thai customers type Latin all day: "iphone 17 pro max", "macbook air m4
 * 256gb", "ipad pro m4 wifi". A character-class test would flip the answer
 * language for a large share of ordinary Thai traffic — a far worse bug than
 * the one being fixed, and one that would arrive silently.
 *
 * So the test asks for evidence of an English SENTENCE, not the absence of
 * Thai: no Thai characters at all, AND at least two distinct English function
 * words. Model names and capacities carry none of those, so a lookup stays
 * Thai however it is spelled.
 *
 * The bias is deliberate and one-directional, the same shape as
 * isQuestionQuery on the website: missing an English question costs one
 * customer an answer in the wrong language, which is exactly what happens
 * today. Reading a Thai lookup as English would hand a wrong-language answer
 * to the majority. When unsure, Thai.
 */

/** Any Thai character at all settles it — mixed input is a Thai customer. */
const THAI_RE = /[฀-๿]/;

/**
 * Function words only, and deliberately NOT content words.
 *
 * "sell", "buy", "price", "battery", "screen" are all things a Thai customer
 * types into a Thai-language search box, so none of them may vote. What is
 * left is the connective tissue of an English sentence: a query carrying two
 * of these was written by someone composing in English.
 */
const EN_FUNCTION_WORDS = new Set([
  "a", "an", "the",
  "is", "are", "am", "was", "were", "be", "been",
  "do", "does", "did", "can", "could", "would", "should", "will",
  "have", "has", "had",
  "i", "you", "we", "my", "your", "me", "it", "they", "them",
  "this", "that", "these", "those", "there",
  "and", "but", "or", "if", "so",
  "to", "for", "with", "from", "of", "on", "at", "about",
  "how", "what", "when", "where", "which", "who", "why",
  "please", "hello", "hi", "thanks", "thank",
  "want", "need", "like", "still", "any", "some", "much", "many",
]);

/**
 * Two, not one. "trade in iphone" and "iphone for sale" each carry exactly one
 * — both are lookups a Thai customer types. Two distinct function words is the
 * first point where the query reads as prose rather than as a name plus a word.
 */
const EN_MIN_FUNCTION_WORDS = 2;

/** Does the text read as English prose, rather than as a name plus a word? */
function looksLikeEnglishProse(raw) {
  const words = raw.toLowerCase().match(/[a-z]+/g) || [];
  const hits = new Set();
  for (const w of words) {
    if (EN_FUNCTION_WORDS.has(w)) hits.add(w);
    if (hits.size >= EN_MIN_FUNCTION_WORDS) return true;
  }
  return false;
}

/**
 * @param {string} query the customer's raw search text
 * @param {"th"|"en"} [pageLang] which language edition of the site they are on
 * @returns {"th"|"en"} the language the answer must be written in
 *
 * TWO SIGNALS, AND THEY DISAGREE FOR GOOD REASONS.
 *
 * The query says what the customer just wrote; the page says which edition
 * they chose to be on. Neither alone is enough:
 *
 *   - Query alone leaves the /en visitor who types "iPhone 13 Pro 128GB" —
 *     a bare model name, no prose to detect — reading a Thai paragraph on an
 *     English page. That is most of what anyone types into a search box.
 *   - Page alone would answer a Thai sentence in English because the visitor
 *     once tapped the language switch.
 *
 * So: Thai characters settle it for Thai (positive evidence of what they are
 * writing now beats a setting), English prose settles it for English, and
 * only when the query carries no evidence either way does the page edition
 * decide. That last line is the whole point of this parameter.
 */
function answerLanguage(query, pageLang = "th") {
  const raw = String(query || "");
  if (THAI_RE.test(raw)) return "th";
  if (raw.trim() && looksLikeEnglishProse(raw)) return "en";
  return pageLang === "en" ? "en" : "th";
}

/**
 * The closing lines of a writer prompt that decide the OUTPUT language.
 *
 * Lives here rather than in each prompt builder because v1 and v2 must not
 * drift on this: one pipeline answering an English customer in Thai while the
 * other answers in English is the same bug wearing a different hat.
 *
 * The instructions themselves stay Thai in both branches — they are addressed
 * to the model, not to the customer, and translating them would mean keeping
 * two copies of every rule in sync forever.
 *
 * The glossary is not decoration. CLAUDE.md fixes the English wording this
 * brand uses (Quote / Valuation, Device, Doorstep Pickup, Condition Guide),
 * and an answer that invents its own vocabulary reads as a different company
 * than the page it sits on.
 */
/**
 * WHY THIS IS IN ENGLISH AND WHY IT IS THREE PLACES, 24 ส.ค. 2569.
 *
 * The first version was one Thai line near the END of a 5,542-character Thai
 * system prompt, followed by a wholly Thai context, followed by a Thai
 * closing instruction. It was outnumbered and it lost: production log for
 * "iphone 15 pro 128GB" on /en —
 *
 *   [searchOverview] answering in en
 *
 * — and the served answer was Thai. So the plumbing was right the whole time
 * and the INSTRUCTION was the weak link. Three things changed:
 *
 *   1. the directive is written in the target language. "Write in English",
 *      in English, is a signal the model reads as language-of-output;
 *      the same sentence in Thai reads as one more Thai rule among ninety.
 *   2. it goes FIRST, ahead of the persona, not eighty lines down.
 *   3. the LAST line before generation says it again (writeAnswerLine) —
 *      previously that line was Thai, which is the strongest position in the
 *      whole request quietly arguing the other way.
 *
 * The Thai path is byte-for-byte unchanged: every helper here returns exactly
 * what it returned before when lang is not "en".
 */
function languageDirective(lang) {
  if (lang !== "en") return [];
  return [
    "OUTPUT LANGUAGE — READ THIS FIRST AND APPLY IT TO EVERYTHING BELOW:",
    "The customer is reading the English edition of this site. Write the ENTIRE answer in English.",
    "Every field of the JSON you return — summary and detail — must be English prose.",
    "The rules and the shop data below are written in Thai. That is the SOURCE MATERIAL, not the language to answer in.",
    "Never mix Thai words or Thai script into the answer. Product names and the shop name (BKK APPLE) stay as they are.",
    "",
  ];
}

/**
 * The last line of the user message — the closest instruction to the point of
 * generation, and the one that used to be Thai on every request.
 */
function writeAnswerLine(query, lang) {
  return lang === "en"
    ? `Write the answer in ENGLISH for this search: ${query}`
    : `เขียนคำตอบสำหรับคำค้น: ${query}`;
}

function languageLines(lang) {
  if (lang !== "en") return ["- ภาษาไทย สุภาพ ลงท้ายด้วยครับ"];
  return [
    "- ANSWER IN ENGLISH. Professional and plain. No Thai script anywhere in the answer, and no ครับ/ค่ะ.",
    '- Currency is written "THB" — never "baht", never "฿". Keep the comma thousands separators exactly as the data gives them.',
    '- Required terms: ประเมินราคา = "quote" or "valuation" (never "appraisal"), เครื่อง/รุ่น = "device" or "model", รับซื้อถึงบ้าน = "doorstep pickup", เกณฑ์การประเมินสภาพ = "condition guide", ตรวจสภาพเครื่อง = "device assessment" or "inspection"',
  ];
}

module.exports = {
  answerLanguage,
  languageLines,
  languageDirective,
  writeAnswerLine,
  EN_MIN_FUNCTION_WORDS,
  __test: { EN_FUNCTION_WORDS, looksLikeEnglishProse },
};
