// Drill into equipped-loadout state across the match. Are agents weaponed
// when they attack? Hypothesis: combat outcomes near zero because attackers
// are unarmed and the damage floor (5) makes 100-HP kills nearly impossible.
//
// Usage: npx tsx harness/inspect-equipped.ts <matchId>

import { makeConvexClient } from "./client.js";
import { api } from "../convex/_generated/api.js";

const matchId = process.argv[2];
if (!matchId) {
  console.error("usage: tsx harness/inspect-equipped.ts <matchId>");
  process.exit(2);
}

const client = makeConvexClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const turns: any[] = await client.query(api.turns.byMatch, {
  matchId: matchId as never,
});

// Also need worldState OR characters at a snapshot. The agentRecords store
// `input.visibleStateDigest` text, which mentions Equipped — so we can grep.
const equippedSnapshots: Record<string, string> = {}; // last seen per persona

for (const t of turns) {
  for (const r of t.agentRecords) {
    const digest = r.input?.visibleStateDigest ?? "";
    // Equipped line: "HP: 100  Equipped: <weapon> / <armour> / <consumable>"
    const m = /Equipped:\s*([^\n]+)/.exec(digest);
    if (m) {
      const equipped = m[1]?.trim() ?? "";
      equippedSnapshots[`${r.personaId}@${t.turn}`] = equipped;
    }
  }
}

// Tabulate distinct equipped strings per persona over the match
const persona2equips: Record<string, Map<string, number>> = {};
for (const [k, v] of Object.entries(equippedSnapshots)) {
  const persona = k.split("@")[0]!;
  persona2equips[persona] ??= new Map();
  persona2equips[persona].set(v, (persona2equips[persona].get(v) ?? 0) + 1);
}

console.log("=== match", matchId, "===");
console.log("\nEquipped digest line distribution per persona:");
for (const [p, m] of Object.entries(persona2equips)) {
  console.log(`  ${p}:`);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  for (const [eq, c] of sorted) {
    console.log(`    ${c}× "${eq}"`);
  }
}

// Now: at the moment of decision-attack, what was equipped?
console.log("\nWhen action.kind=attack, equipped weapon at time of decision:");
const attackerLoadouts: Record<string, Record<string, number>> = {};
for (const t of turns) {
  for (const r of t.agentRecords) {
    if (r.decision.action?.kind === "attack") {
      const digest = r.input?.visibleStateDigest ?? "";
      const m = /Equipped:\s*([^\n]+)/.exec(digest);
      const eqLine = m && m[1] ? m[1].trim() : "?";
      // First slash-separated token is the weapon
      const weapon = eqLine.split("/")[0]?.trim() ?? "?";
      const personaBucket = attackerLoadouts[r.personaId] ?? {};
      personaBucket[weapon] = (personaBucket[weapon] ?? 0) + 1;
      attackerLoadouts[r.personaId] = personaBucket;
    }
  }
}
for (const [p, hist] of Object.entries(attackerLoadouts)) {
  console.log(`  ${p}:`, hist);
}
