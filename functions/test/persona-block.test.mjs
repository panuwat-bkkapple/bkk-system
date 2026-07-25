// ---------------------------------------------------------------------------
// Offline unit test for buildPersonaBlock (chat-ai.js).
// Runs with NO API key and NO Firebase — pure function.
//
//   node functions/test/persona-block.test.mjs
//
// Guards the AI-profile contract: the admin persona layer must be fully inert
// unless enabled === true (safe to configure before launch, same pattern as
// every other master gate), must render only the fields the admin actually
// set, must cap free-text lengths, and must keep the style-only framing that
// forbids overriding the iron rules.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { __test } = require("../chat-ai.js");
const { buildPersonaBlock } = __test;

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// --- master gate -----------------------------------------------------------
check("missing profile renders nothing", buildPersonaBlock(undefined) === "");
check("null profile renders nothing", buildPersonaBlock(null) === "");
check("non-object profile renders nothing", buildPersonaBlock("x") === "");
check(
  "disabled profile renders nothing even with fields set",
  buildPersonaBlock({ enabled: false, character: "ร่าเริง", tone: "playful" }) === "",
);
check(
  "enabled must be strict boolean true",
  buildPersonaBlock({ enabled: "true", character: "ร่าเริง" }) === "",
);
check(
  "enabled profile with no persona fields still renders nothing",
  buildPersonaBlock({ enabled: true, gender: "", character: "  ", tone: "", reply_length: "" }) === "",
);

// --- field rendering -------------------------------------------------------
const full = buildPersonaBlock({
  enabled: true,
  gender: "female",
  character: "พนักงานหญิงชื่อหวาน ร่าเริง",
  tone: "playful",
  reply_length: "brief",
  use_emoji: true,
  custom_instructions: "แทนตัวเองว่าหวาน",
});
check("block opens on a fresh line", full.startsWith("\n"));
check("header names the admin page", full.includes("โปรไฟล์ AI"));
check(
  "header keeps the style-only guard (cannot override iron rules)",
  full.includes("หลักการสูงสุด") && full.includes("กฎเหล็ก"),
);
check("female gender renders ค่ะ particle", full.includes("ค่ะ/นะคะ"));
check("character line renders", full.includes("พนักงานหญิงชื่อหวาน ร่าเริง"));
check("playful tone renders its line", full.includes("สดใส มีชีวิตชีวา"));
check("brief length renders its line", full.includes("กระชับ"));
check("emoji allowance renders with the 1-per-message cap", full.includes("ไม่เกิน 1 ตัวต่อข้อความ"));
check("custom instructions render", full.includes("แทนตัวเองว่าหวาน"));

const male = buildPersonaBlock({ enabled: true, gender: "male" });
check("male gender renders ครับ particle", male.includes("ครับ/นะครับ"));
check("unset fields are omitted (no tone line)", !male.includes("โทนการคุย"));
check("unset fields are omitted (no emoji line)", !male.includes("อีโมจิ"));

const noEmoji = buildPersonaBlock({ enabled: true, use_emoji: false });
check("explicit use_emoji=false renders the ban line", noEmoji.includes("ห้ามใช้อีโมจิ"));

// --- hostile / oversized input --------------------------------------------
const longChar = buildPersonaBlock({ enabled: true, character: "ก".repeat(5000) });
check("character capped at 1000 chars", !longChar.includes("ก".repeat(1001)));
const longCustom = buildPersonaBlock({ enabled: true, custom_instructions: "ข".repeat(5000) });
check("custom_instructions capped at 2000 chars", !longCustom.includes("ข".repeat(2001)));
check(
  "unknown tone value renders nothing for tone",
  !buildPersonaBlock({ enabled: true, gender: "male", tone: "sarcastic" }).includes("โทนการคุย"),
);
check(
  "unknown gender value renders no particle line",
  buildPersonaBlock({ enabled: true, gender: "robot", character: "x" }).includes("หางเสียง") === false,
);

// --- call-site wiring ------------------------------------------------------
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "chat-ai.js"), "utf8");
check(
  "persona block is appended to the STATIC system block (prompt-cache safe)",
  src.includes('buildSystemPrompt({ assistantName, pub, kb, customerBlock: "", inHours }) +\n          buildPersonaBlock(settings.ai_profile) +'),
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
