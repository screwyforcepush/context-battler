// One-shot diagnostic: inspect a match's turns to compute fallback rate +
// sanity stats. Used to gate WP10.5 Phase A before Stage-2 dispatch.
//
// Usage: npx tsx harness/analyze-match.ts <matchId>

import { makeConvexClient } from "./client.js";
import { api } from "../convex/_generated/api.js";

const matchId = process.argv[2];
if (!matchId) {
  console.error("usage: tsx harness/analyze-match.ts <matchId>");
  process.exit(2);
}

const client = makeConvexClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const turns: any[] = await client.query(api.turns.byMatch, {
  matchId: matchId as never,
});

let total = 0;
let fellBack = 0;
const failureReasons: Record<string, number> = {};
const moveKinds: Record<string, number> = {};
const actionKinds: Record<string, number> = {};
const primaries: Record<string, number> = {};
let attacksLanded = 0;
let attacksMissed = 0;
let attacksOutOfRange = 0;
let chestEquips = 0;
let chestInteracts = 0;
let speechEvents = 0;
let deaths = 0;
let extractions = 0;

const fallbackByPersona: Record<string, { total: number; fellBack: number }> = {};
const sampleRawByPersona: Record<string, string[]> = {};

for (const t of turns) {
  speechEvents += t.resolution.speech.length;
  deaths += t.resolution.deaths.length;
  for (const a of t.resolution.actions) {
    if (a.kind === "attack") {
      if (a.result === "hit" || a.result === "killed") attacksLanded += 1;
      else if (a.result === "missed") attacksMissed += 1;
      else if (a.result === "out_of_range") attacksOutOfRange += 1;
    } else if (a.kind === "interact") {
      chestInteracts += 1;
      if (a.result === "opened" || a.result === "equipped") chestEquips += 1;
    } else if (a.kind === "extract") {
      extractions += 1;
    }
  }
  for (const r of t.agentRecords) {
    total += 1;
    primaries[r.decision.primary] = (primaries[r.decision.primary] ?? 0) + 1;
    moveKinds[r.decision.move.kind] = (moveKinds[r.decision.move.kind] ?? 0) + 1;
    actionKinds[r.decision.action.kind] =
      (actionKinds[r.decision.action.kind] ?? 0) + 1;
    if (r.llm.fellBackToSafeDefault) {
      fellBack += 1;
      const reason = r.llm.failureReason ?? "unknown";
      failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
      const persona = r.personaId;
      sampleRawByPersona[persona] ??= [];
      if (sampleRawByPersona[persona].length < 3 && r.llm.rawArguments) {
        sampleRawByPersona[persona].push(r.llm.rawArguments.slice(0, 200));
      }
    }
    const persona = r.personaId;
    fallbackByPersona[persona] ??= { total: 0, fellBack: 0 };
    fallbackByPersona[persona].total += 1;
    if (r.llm.fellBackToSafeDefault) fallbackByPersona[persona].fellBack += 1;
  }
}

const fallbackRate = total === 0 ? 0 : fellBack / total;

console.log("\n=== match", matchId, "===");
console.log("turns:", turns.length, "agent-records:", total);
console.log(
  "fallback:",
  fellBack,
  "/",
  total,
  `(${(fallbackRate * 100).toFixed(1)}%)`,
);
console.log("failureReasons:", failureReasons);
console.log("primaries:", primaries);
console.log("move.kind:", moveKinds);
console.log("action.kind:", actionKinds);
console.log(
  "actions: attacks landed/missed/out-of-range:",
  attacksLanded,
  "/",
  attacksMissed,
  "/",
  attacksOutOfRange,
);
console.log(
  "chest interacts:",
  chestInteracts,
  "equips/opens:",
  chestEquips,
);
console.log(
  "speech events:",
  speechEvents,
  "deaths:",
  deaths,
  "extractions:",
  extractions,
);

console.log("\nfallback by persona:");
for (const [p, s] of Object.entries(fallbackByPersona)) {
  console.log(
    `  ${p}: ${s.fellBack}/${s.total} (${((s.fellBack / s.total) * 100).toFixed(1)}%)`,
  );
}

console.log("\nsample rawArguments by persona (first 3, fallbacks only):");
for (const [p, samples] of Object.entries(sampleRawByPersona)) {
  console.log(`  ${p}:`);
  for (const s of samples) console.log(`    ${s}`);
}

console.log("\n=== gate ===");
console.log(
  "≤10% fallback rate:",
  fallbackRate <= 0.1 ? "PASS" : "FAIL",
  `(${(fallbackRate * 100).toFixed(1)}%)`,
);
console.log(
  "≥1 chest equip:",
  chestEquips >= 1 ? "PASS" : "FAIL",
  `(${chestEquips})`,
);
console.log(
  "≥1 attack landed-or-near-miss:",
  attacksLanded + attacksMissed >= 1 ? "PASS" : "FAIL",
  `(landed=${attacksLanded} missed=${attacksMissed})`,
);
console.log(
  "≥3 distinct move.kind literals:",
  Object.keys(moveKinds).length >= 3 ? "PASS" : "FAIL",
  `(${Object.keys(moveKinds).length})`,
);
