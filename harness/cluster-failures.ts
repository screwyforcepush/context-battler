// Diagnostic: cluster fallback patterns by failure mode and field-scoped
// validator errors.
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

type Sample = { turn: number; persona: string; raw: string };

const fieldRejectsByReason: Record<string, Sample[]> = {};
let fieldRejectsUnknown = 0;
const schemaFails: Sample[] = [];
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
      const fieldErrors = r.llm.validatorFieldErrors ?? {};
      const entries = Object.entries(fieldErrors);
      if (entries.length > 0) {
        for (const [field, message] of entries) {
          const reason = `${field}: ${String(message)}`;
          fieldRejectsByReason[reason] ??= [];
          fieldRejectsByReason[reason].push({
            turn: t.turn,
            persona: r.personaId,
            raw: r.llm.rawArguments?.slice(0, 280) ?? "",
          });
        }
      } else {
        fieldRejectsUnknown += 1;
      }
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

const validatorTotal =
  Object.values(fieldRejectsByReason).reduce((a, b) => a + b.length, 0) +
  fieldRejectsUnknown;
console.log(
  "\n=== field-rejection (",
  validatorTotal,
  ") grouped by reason ===",
);
const sortedReasons = Object.entries(fieldRejectsByReason).sort(
  (a, b) => b[1].length - a[1].length,
);
for (const [reason, samples] of sortedReasons) {
  console.log(`\n  [${samples.length} cases] ${reason}`);
  for (const s of samples.slice(0, 3)) {
    console.log(`    T${s.turn} ${s.persona}:`, s.raw);
  }
}
if (fieldRejectsUnknown > 0) {
  console.log(
    `\n  [${fieldRejectsUnknown} cases] (no field-error details)`,
  );
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
