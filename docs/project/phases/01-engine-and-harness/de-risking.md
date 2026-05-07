# Phase 01 — De-risking Plan

> Phase-1 has **one** genuine unknown (Azure rate-limit behaviour at stage-2 concurrency, captured here as Measurement C) plus **one** operational bootstrap (Convex deploy-key write path on a fresh deployment, captured as Bootstrap Checklist B). Azure tool-use shape was previously framed as Spike A; v1.2 retires that framing because `azure-llm.md` §7 documents the contract — sanity assertions move to WP6 integration tests. The "Reasoning policy" lifted out of Spike A is preserved as a top-level section below; it is binding for the entire phase.

---

## Spike A — Azure tool-use round-trip *(removed in v1.2)*

Removed in v1.2. Azure tool-use shape is a contract specified in `azure-llm.md` §7. Sanity assertions (function_call emitted, `JSON.parse(arguments)` succeeds, schema validates, latency observed, no parallel calls despite `parallel_tool_calls: false` defaulting on) are absorbed into WP6 integration-test acceptance — not a separate 0.5-day spike. WP4 (the spike's execution work package) is correspondingly deleted; foundation parallelism is now WP2 ∥ WP3 only after WP1 lands.

---

## Reasoning policy *(binding for the entire phase)*

`reasoning.effort: "low"` is the phase-1 default for every per-turn LLM call. `reasoning.effort: "none"` is **never** acceptable for:

- gate runs (Gate 1 / Gate 2 / Gate 3),
- WP15 tuning iterations,
- the closing 50-run report,
- any data point that informs a phase-1 conclusion.

If `low` is too slow under load, the responses are: (a) lower `--concurrency` (Measurement C / WP13), (b) shrink the prompt (WP8 token-budget caps), (c) escalate to user. Reasoning-off would degrade the per-turn decision to next-token autocompletion and collapse persona attribution — which is exactly the signal phase 1 is built to measure (`mental-model.md` §10). The `--reasoning` CLI flag (WP11) accepts only `low | medium | high`.

---

## Bootstrap Checklist B — Convex deploy-key write path

**Frame.** Not a spike — `convex-backend.md` §4 documents the operational sequence for a fresh deployment. This is a WP1 readiness checklist absorbed into WP1's acceptance bullets. Listed here only so the steps are visible alongside the rate-limit measurement.

**Steps (cross-ref WP1 acceptance):**
1. `mkdir convex && echo "import { defineSchema } from 'convex/server'; export default defineSchema({});" > convex/schema.ts`. Run `npx convex dev --once`. Confirm `convex/_generated/` exists.
2. Add a tiny action `convex/spike.ts` exporting an `internalAction` that returns `process.env.AZURE_API_KEY?.slice(0, 4) ?? "MISSING"`. Set the env var via `npx convex env set AZURE_API_KEY ...`. Run via `npx convex run spike:checkEnv`. Confirm it returns the first 4 chars (proves env var is plumbed in).
3. Once the real schema lands in WP2, repeat with production-shaped schema: `matches.create` from CLI, `matches.get` reads it back. Confirms read/write path is working with the production-shaped schema.

**Done when** all three steps succeed on the live deployment. If any step fails:
- Convex dev refuses to deploy without a non-empty schema → add a placeholder table to `schema.ts`, document workaround in WP1 notes.
- Action can't see env var even after `convex env set` → likely deploy key vs deployment mismatch; check `convex-backend.md` §1's slug-match rule.

**Effort.** Folded into WP1's 0.5-day budget.

---

## Measurement C — Rate-limit characterisation at stage-2 concurrency

**Why this is genuinely unknown.** Stage-2 fan-out is 10 matches × 8 agents = 80 concurrent in-flight LLM calls per turn, sustained across 50 turns per match. Azure deployment's RPM/TPM limits are **not** documented in `azure-llm.md`; `mental-model.md` §10 explicitly says concurrency tuning is reactive. Stage-3 is 50 matches × 8 agents at concurrency `C`, so understanding the curve at C=10 lets us pick C for stage 3. This is a measurement (not a gate) — the bands below set the resulting policy, not whether to proceed.

**Hypothesis.** At `--concurrency 10` (so up to 80 in-flight calls per turn), the deployment either:
- (a) handles all calls without rate limiting; or
- (b) rate-limits a small fraction (< 5 %) that an exponential backoff can paper over; or
- (c) rate-limits a large fraction (> 5 %), forcing us to drop stage-3 concurrency.

**Scope.** WP13 — runs against the live engine after WP10/WP11/WP12 land:
1. `npm run harness -- --runs 10 --concurrency 10`.
2. Hook `azure.ts` to count: total calls, 429 responses, 5xx responses, mean latency, p95 latency, reasoning-token count per call, total tokens consumed.
3. Print summary at harness exit.

**Outcome to record.**

```text
Spike C — Azure rate-limit behaviour at concurrency 10 — outcome
Date: <YYYY-MM-DD>

Total LLM calls:    ___
429 responses:      ___ (___%)
5xx responses:      ___ (___%)
Other failures:     ___
Mean latency (ms):  ___
p95 latency (ms):   ___
Mean reasoning tokens: ___
Total input tokens: ___
Total output tokens: ___

Notes:
- ...

Conclusion (ONE policy, repeated verbatim in WP13):
- 0 % 429s:        Stage-3 concurrency = 10. No backoff machinery. No re-spike needed.
- 0 – 5 % 429s:    Add 3-retry exponential backoff (base 1 s, jittered) to azure.ts. Re-spike. After re-spike clean: stage-3 concurrency = 10.
- 5 – 20 % 429s:   Add the same backoff AND lower concurrency (start at 7, then 5) until re-spike is clean. Stage-3 concurrency = whichever value ran clean.
- > 20 % 429s:     Stage-3 concurrency = 5 with backoff. If still > 20 % at concurrency 5, escalate to user (PM) before running 50.

Stage-3 locked concurrency: ___
```

**What "RED" looks like.** 429 rate > 20 % even at concurrency 5 with backoff, OR p95 latency > 30 s under load. Either means stage-3 is going to be slow and expensive; escalate to user (PM) before running 50.

**Effort.** 0.5 day execution + variable tuning.

---

## What this plan does *not* de-risk (and why that's OK)

- **Persona signal at the done-bar.** Whether the 8 personas, with brief prompts, actually clear the §10 spread thresholds. This isn't a spike — it's the whole point of phase 1. WP15 is the iteration loop that owns it; if it never converges, that's a real-finding outcome, not a planning failure.
- **Convex action 10-min timeout under load.** Each turn is its own action via `runAfter(0, ...)`. The risk only materialises if a single LLM call hangs > 10 min, which is mitigated by an `AbortController` with a 60 s cap inside the wrapper (ADR §4 / WP6). Not worth a separate spike.
- **Determinism / replay-equivalence.** Explicitly out of scope per `architecture.md` §6. If two 50-run reports diverge wildly, that's stochastic LLM behaviour, not a bug. The done-bar is intentionally lenient to absorb variance.
- **Cost ceiling for the closing 50-run.** Token math: 50 matches × 8 agents × 50 turns × ~1 500 input tokens × $X/M tokens. Likely materially under $50 at gpt-5.4-mini pricing. Document the actual after WP16 for future planning.

---

## Changelog — v1.2

Diff vs v1.1 (bird's-eye nudge — verified guides are contracts, not unknowns):

- **Spike A — DROPPED.** Azure tool-use shape is a contract specified in `azure-llm.md` §7, not a load-bearing unknown. The v1.1 GREEN/YELLOW/RED bands, `N ≥ 20` sample, calibration-only carve-out, and JSON-mode-not-a-fallback paragraph are all retired. Sanity assertions (function_call emitted, JSON.parse succeeds, schema validates, latency observed, parallel-call defence) move into WP6 integration-test acceptance. Cascade: WP4 deleted in `work-packages.md`; foundation parallelism in `README.md` §7 / §11 becomes WP2 ∥ WP3 only.
- **Reasoning policy — LIFTED.** Was a sub-section inside Spike A; now a top-level section because it is binding for the entire phase, not bound to the (now-removed) spike. Substance unchanged: `none` is never used in phase-1 gates / tuning / closing report; the `--reasoning` CLI flag accepts only `low | medium | high`.
- **Spike B — REFRAMED.** Was framed as a GREEN/YELLOW/RED spike; now "Bootstrap Checklist B — Convex deploy-key write path." Steps unchanged; outcome block and pass/fail bands dropped. The checklist lives as part of WP1's acceptance bullets (cross-ref `convex-backend.md` §4).
- **Spike C — RENAMED.** Now "Measurement C — Rate-limit characterisation at stage-2 concurrency". The 4-band rate-limit policy (0 % / 0–5 % / 5–20 % / > 20 %) is unchanged and remains verbatim across Measurement C / WP13 / ADR §8.
- **Header.** Reframed "three load-bearing unknowns" → "one genuine unknown (Measurement C) plus one bootstrap checklist (B)". The previous v1.1 framing implied three unknowns; only rate-limits remained genuinely unknown after the bird's-eye sweep.

## Changelog — v1.1

Diff vs v1.0, by section:

- **Spike A.** Replaced JSON-mode RED rollback with block / simplify / escalate. JSON-mode is no longer a planned fallback — it would require an explicit source-of-truth change. Added explicit YELLOW band for recoverable schema/prompt tweaks (max 2 iterations before promotion to RED). Promoted GREEN sample size from N=5 to N≥20 with ≥80 % parseable schema-valid `function_call` outputs. Made `parallel_tool_calls: false` honoured-on-every-call a GREEN gate. Added "Reasoning policy" — `reasoning.effort: "none"` is calibration-only (single sample inside this spike), never acceptable for gate runs / WP15 tuning / closing report; if `low` is too slow, lower concurrency / shrink prompt / escalate.
- **Spike C.** Locked threshold policy to one shape, repeated verbatim in WP13: 0 % → no backoff; 0–5 % → 3-retry exponential backoff (base 1 s, jittered) and re-spike, stage-3 concurrency 10; 5–20 % → backoff plus lower concurrency until clean; > 20 % → concurrency 5 with backoff or escalate to user. RED is now > 20 % at concurrency 5 with backoff OR p95 latency > 30 s.
- **What this plan does *not* de-risk.** Updated the `AbortController` reference to point at ADR §4 / WP6 (now the canonical owner) instead of WP10 risk text.
