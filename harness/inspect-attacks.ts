// Quick diagnostic — drill into attack/overwatch resolution outcomes for a
// single match. Used to characterise the WP15 lethality gap in Stage-2.
//
// Usage: npx tsx harness/inspect-attacks.ts <matchId>

import { makeConvexClient } from "./client.js";
import { api } from "../convex/_generated/api.js";

const matchId = process.argv[2];
if (!matchId) {
  console.error("usage: tsx harness/inspect-attacks.ts <matchId>");
  process.exit(2);
}

const client = makeConvexClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const turns: any[] = await client.query(api.turns.byMatch, {
  matchId: matchId as never,
});

const attackResultHist: Record<string, number> = {};
const overwatchResultHist: Record<string, number> = {};
const counterResultHist: Record<string, number> = {};
const decisionAttackByPersona: Record<string, number> = {};
const decisionOverwatchByPersona: Record<string, number> = {};
const decisionCounterByPersona: Record<string, number> = {};
const decisionAttackByTurn: Record<number, number> = {};
const damages: number[] = [];
let totalAttacksLanded = 0;
let totalOverwatchLanded = 0;
let totalMovementTriggeredOverwatch = 0;
let totalCounterLanded = 0;

for (const t of turns) {
  for (const a of t.resolution.actions) {
    if (a.kind === "attack") {
      attackResultHist[a.result] = (attackResultHist[a.result] ?? 0) + 1;
      if (typeof a.result === "string" && a.result.startsWith("dmg ")) {
        totalAttacksLanded += 1;
        const dmg = parseInt(a.result.slice(4), 10);
        if (!Number.isNaN(dmg)) damages.push(dmg);
      }
    } else if (a.kind === "overwatch") {
      overwatchResultHist[a.result] = (overwatchResultHist[a.result] ?? 0) + 1;
      if (a.triggeredByMovement === true) totalMovementTriggeredOverwatch += 1;
      if (typeof a.result === "string" && a.result.startsWith("dmg ")) {
        totalOverwatchLanded += 1;
        const dmg = parseInt(a.result.slice(4), 10);
        if (!Number.isNaN(dmg)) damages.push(dmg);
      }
    } else if (a.kind === "counter") {
      counterResultHist[a.result] = (counterResultHist[a.result] ?? 0) + 1;
      if (typeof a.result === "string" && a.result.startsWith("dmg ")) {
        totalCounterLanded += 1;
        const dmg = parseInt(a.result.slice(4), 10);
        if (!Number.isNaN(dmg)) damages.push(dmg);
      }
    }
  }
  for (const r of t.agentRecords) {
    if (r.decision.action?.kind === "attack") {
      decisionAttackByPersona[r.personaId] =
        (decisionAttackByPersona[r.personaId] ?? 0) + 1;
      decisionAttackByTurn[t.turn] = (decisionAttackByTurn[t.turn] ?? 0) + 1;
    }
    if (r.decision.position?.kind === "overwatch") {
      decisionOverwatchByPersona[r.personaId] =
        (decisionOverwatchByPersona[r.personaId] ?? 0) + 1;
    }
    if (r.decision.position?.kind === "counter") {
      decisionCounterByPersona[r.personaId] =
        (decisionCounterByPersona[r.personaId] ?? 0) + 1;
    }
  }
}

console.log("=== match", matchId, "===");
console.log("\ndecision action.kind=attack by persona:");
for (const [p, c] of Object.entries(decisionAttackByPersona).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  ${p}: ${c}`);
}

console.log("\ndecision position.kind=overwatch by persona:");
for (const [p, c] of Object.entries(decisionOverwatchByPersona).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  ${p}: ${c}`);
}

console.log("\ndecision position.kind=counter by persona:");
for (const [p, c] of Object.entries(decisionCounterByPersona).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  ${p}: ${c}`);
}

console.log("\nattack resolution result histogram:");
for (const [r, c] of Object.entries(attackResultHist).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  ${c}× ${r}`);
}
console.log(`  total attacks landed (dmg X): ${totalAttacksLanded}`);

console.log("\noverwatch resolution result histogram:");
for (const [r, c] of Object.entries(overwatchResultHist).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  ${c}× ${r}`);
}
console.log(`  total overwatch landed (dmg X): ${totalOverwatchLanded}`);
console.log(
  `  movement-triggered overwatch rows: ${totalMovementTriggeredOverwatch}`,
);

console.log("\ncounter resolution result histogram:");
for (const [r, c] of Object.entries(counterResultHist).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  ${c}× ${r}`);
}
console.log(`  total counters landed (dmg X): ${totalCounterLanded}`);

console.log(`\ndamage values landed: ${damages.length} samples`);
if (damages.length > 0) {
  const min = Math.min(...damages);
  const max = Math.max(...damages);
  const sum = damages.reduce((a, b) => a + b, 0);
  console.log(
    `  min=${min} max=${max} mean=${(sum / damages.length).toFixed(1)} total=${sum}`,
  );
  const hist: Record<number, number> = {};
  for (const d of damages) hist[d] = (hist[d] ?? 0) + 1;
  console.log("  by-value:", hist);
}

const turnsWithAttacks = Object.keys(decisionAttackByTurn).length;
console.log(`\nturns with ≥1 decision-attack: ${turnsWithAttacks}/${turns.length}`);
