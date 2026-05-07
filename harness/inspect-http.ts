import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import dotenv from "dotenv";
dotenv.config();

const matchId = process.argv[2];
if (!matchId) {
  console.error("usage: tsx harness/inspect-http.ts <matchId>");
  process.exit(2);
}

const client = new ConvexHttpClient(process.env.CONVEX_URL!);
const turns = await client.query(api.turns.byMatch, { matchId: matchId as never });

const buckets = new Map<string, { count: number; samples: string[] }>();
const personaHttp = new Map<string, Map<number, number>>();
const personaRetried = new Map<string, { retried: number; total_fb: number }>();

for (const turn of turns) {
  for (const rec of turn.agentRecords) {
    const llm = rec.llm;
    const fb = llm.failureReason;
    if (!fb) continue;
    const persona = (rec as { personaId?: string }).personaId ?? "unknown";
    const status = llm.httpStatus ?? -1;
    const retried = (llm as { retried?: boolean }).retried === true;
    const key = `${fb} status=${status}`;
    const b = buckets.get(key) ?? { count: 0, samples: [] };
    b.count++;
    if (b.samples.length < 3) {
      // `errorBody` is not persisted on `agent-llm`; use `rawArguments`
      // (the un-validated tool-call JSON, when available) as the failure
      // context proxy. For HTTP 400s there is no parsed body — fall back
      // to a marker so the per-bucket sample line still emits.
      const sample = llm.rawArguments
        ? String(llm.rawArguments).slice(0, 200)
        : "(no body persisted on this row)";
      b.samples.push(`T${turn.turn} ${persona} retried=${retried}: ${sample}`);
    }
    buckets.set(key, b);
    if (fb === "http_non_200") {
      const m = personaHttp.get(persona) ?? new Map<number, number>();
      m.set(status, (m.get(status) ?? 0) + 1);
      personaHttp.set(persona, m);
      const pr = personaRetried.get(persona) ?? { retried: 0, total_fb: 0 };
      pr.total_fb++;
      if (retried) pr.retried++;
      personaRetried.set(persona, pr);
    }
  }
}

console.log("=== fallback bucket × httpStatus ===");
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${v.count}× ${k}`);
  for (const s of v.samples) console.log(`  ${s}`);
}

console.log("\n=== http_non_200 by persona × status ===");
for (const [persona, m] of personaHttp) {
  const parts = [...m.entries()].map(([s, c]) => `${s}=${c}`).join(" ");
  const pr = personaRetried.get(persona)!;
  console.log(`${persona}: ${parts}  (retried=${pr.retried}/${pr.total_fb})`);
}
