// Diagnostic: cluster fallback patterns by failure mode.
//
// WP10.5 Pass B.3 — validator-rejection bucket is now sub-clustered by
// `validatorReason` text (the engine's rejection message), instead of being
// reported as one opaque "unknown"-bucket count. This is the diagnostic key
// the gate-1 smoke was missing — see
// `docs/project/phases/01-engine-and-harness/wp10-5-phase-a-findings.md`
// §"Bucket 2 — validator-rejection (112, 62.2%)".
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

const validatorRejectsByReason: Record<string, Sample[]> = {};
let validatorRejectsUnknown = 0; // legacy rows w/o validatorReason
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
      // Validator-rejection bucket — group by validatorReason value (the
      // engine's human-readable rejection string). When validatorReason is
      // absent the row predates Pass B.3 and stays in a legacy "unknown"
      // bucket so its count is still visible.
      const reason: string | undefined = r.llm.validatorReason;
      if (reason) {
        validatorRejectsByReason[reason] ??= [];
        validatorRejectsByReason[reason].push({
          turn: t.turn,
          persona: r.personaId,
          raw: r.llm.rawArguments?.slice(0, 280) ?? "",
        });
      } else {
        validatorRejectsUnknown += 1;
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
  Object.values(validatorRejectsByReason).reduce((a, b) => a + b.length, 0) +
  validatorRejectsUnknown;
console.log(
  "\n=== validator-rejection (",
  validatorTotal,
  ") grouped by reason ===",
);
const sortedReasons = Object.entries(validatorRejectsByReason).sort(
  (a, b) => b[1].length - a[1].length,
);
for (const [reason, samples] of sortedReasons) {
  console.log(`\n  [${samples.length} cases] ${reason}`);
  for (const s of samples.slice(0, 3)) {
    console.log(`    T${s.turn} ${s.persona}:`, s.raw);
  }
}
if (validatorRejectsUnknown > 0) {
  console.log(
    `\n  [${validatorRejectsUnknown} cases] (legacy: pre-B.3 row, no validatorReason)`,
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
