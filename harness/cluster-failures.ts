// Diagnostic: cluster fallback patterns by failure mode.
import { makeConvexClient } from "./client.js";
import { api } from "../convex/_generated/api.js";

const matchId = process.argv[2];
if (!matchId) {
  console.error("usage: tsx harness/cluster-failures.ts <matchId>");
  process.exit(2);
}

const client = makeConvexClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const turns: any[] = await client.query(api.turns.byMatch, {
  matchId: matchId as never,
});

const validatorRejects: { turn: number; persona: string; raw: string }[] = [];
const schemaFails: { turn: number; persona: string; raw: string }[] = [];
const httpFailsByTurn: number[] = [];

for (const t of turns) {
  for (const r of t.agentRecords) {
    if (!r.llm.fellBackToSafeDefault) continue;
    if (r.llm.failureReason === "schema_validation_failed") {
      schemaFails.push({
        turn: t.turn,
        persona: r.personaId,
        raw: r.llm.rawArguments?.slice(0, 280) ?? "",
      });
    } else if (r.llm.failureReason === "http_non_200") {
      httpFailsByTurn.push(t.turn);
    } else if (!r.llm.failureReason) {
      validatorRejects.push({
        turn: t.turn,
        persona: r.personaId,
        raw: r.llm.rawArguments?.slice(0, 280) ?? "",
      });
    }
  }
}

console.log(
  "=== schema_validation_failed (",
  schemaFails.length,
  ") sampling 10 ===",
);
for (const s of schemaFails.slice(0, 10)) {
  console.log(`  T${s.turn} ${s.persona}:`, s.raw);
}

console.log(
  "\n=== validator-rejection ('unknown' bucket —",
  validatorRejects.length,
  ") sampling 15 ===",
);
for (const s of validatorRejects.slice(0, 15)) {
  console.log(`  T${s.turn} ${s.persona}:`, s.raw);
}

console.log(
  "\n=== http_non_200 turns (",
  httpFailsByTurn.length,
  "): ===",
);
const counts: Record<number, number> = {};
for (const t of httpFailsByTurn) counts[t] = (counts[t] ?? 0) + 1;
console.log(
  "  per-turn count:",
  Object.entries(counts)
    .map(([t, c]) => `T${t}:${c}`)
    .join(" "),
);
