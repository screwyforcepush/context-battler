# Phase 01 — Gate 1 Review

> Scope: Gate-1 review of the Stage-1 engine-smoke vertical slice committed at `37c56d5`. Anchored against `mental-model.md` §10 done-bar realism, `concept-spec.md` §7/§8/§16/§22/§23/§24, `work-packages.md` (WP7/WP8/WP10/WP11 + 🔒 Gate 1), and `architecture-decisions.md` §6/§7. Live Convex match: `j97f95yxsb6djmhgsgn6j8kfzn869pg7`.

---

## Review Summary

- **Overall assessment: APPROVE-WITH-CHANGES.** Gate-1 acceptance bullets in `work-packages.md` §🔒 Gate 1 all pass when verified against live Convex evidence: terminal status reached cleanly, ADR §7 trace shape is fully self-contained, resolution order honours §23, the WP8 N→N+1 speech window holds, and `lint && typecheck && test` are green (205 passed / 4 LLM env-gated skipped). The engine kernel, schema, harness, and trace-introspection contract are sound.
- **Stage-2 dispatch is BLOCKED on a single targeted prompt fix.** The 84.5% (338/400) safe-default fall-back rate is **8.5× the WP6 escalation threshold** (10%) and the failure mode is structurally a contract bug between the system-prompt + affordances vocabulary and the discriminated-union schema literals — *not* persona behaviour. Running Stage-2 / Stage-3 against this baseline would burn ~6 M tokens to measure a noise-floor that won't generalise once the prompt is fixed, and would invalidate the WP13 rate-limit measurements. See **Decision Note D-G1-1**.
- **What is solid.** Pure-function engine kernel with rich unit coverage (151 kernel + 33 resolver + 21 input-builder + 13 azure tests across §4 / §7 / §9–§16 / §22 / §23 / §24); Convex schema mirroring ADR §6 row-for-row; resolver phases composed in §23 order with order-independence guards; tactical digest is plain-text (NOT ASCII grid) per §7 / mental-model §10; WP6 wrapper never throws and surfaces every `FailureReason` distinctly on the trace (`schema_validation_failed=299`, `http_non_200=39`); harness is a thin orchestrator with JSONL output and a 10-min wall-clock cap; the `convex/_data/*` inlining is a reasonable workaround for Convex's bundler not pulling files outside `convex/`.
- **What is risky or unclear.** The substantive risk is the contract-vocabulary mismatch above. Secondary risks are smaller: a redundant heard-speech filter in `runMatch.ts` that drifts slightly from the WP8 "at the moment of speech" rule, a missing `scripts/regenerate-data.ts` referenced by `convex/_data/*` headers, and Stage-1 not yet plumbing `--reasoning` into `matches.start` (Stage-2 acceptance requires this).

---

## Live Gate-1 Verification

| Acceptance bullet (`work-packages.md` §🔒 Gate 1 + ADR §7) | Evidence | Status |
|---|---|---|
| WP10 acceptance: terminal status reached cleanly | `matches:get j97f95…` → `status:"completed", turn:50, completedAt:1778180035660`, `outcome.extracted:[]`, no `failure` field. | **PASS** |
| WP10 acceptance: full self-contained trace per ADR §7 | `turns:getAgentTurn` for `(matchId, 23, Player_4)` returns `input.{systemPromptHash, systemPromptText, personaPromptHash, personaPromptText, visibleStateDigest, scratchpadBefore} + decision + scratchpadAfter + llm.{responseId, callId, rawArguments, usage, latencyMs, httpStatus, fellBackToSafeDefault, failureReason}`. All 9 `llm.*` fields populated. | **PASS** |
| WP10 acceptance: WP10 does NOT write `runs` | No `runs` row exists for the match (`runs.aggregate` is WP12, not yet shipped). The action chain halts cleanly on terminal status without a `runs` write attempt. | **PASS** |
| Resolution order matches §23 | Inspected resolver source (`convex/engine/resolution.ts:139–702`): phases run in §23 order — collect → consumables (heal/speed; reveal-on-consume) → speech (start-of-turn pos for hearing range; reveal-on-speak) → movement (substep loop; speed-active boost) → action (collect attacks → batch-apply for simultaneity → reveal-on-fire AFTER damage; chest-interact + corpse-loot post-attack) → death/loot → visibility update + `lastKnown` cap-3 eviction → next-turn (turn-30 evac reveal / turn-50 extraction). Turn 4's trace (speech `Player_6` at start-pos `(50,94)` + movement `(50,94)→(50,93)` in same turn) confirms speech-before-move ordering. | **PASS** |
| §16 hearing-range filter | Turn 4 speaker at `(50,94)`, all other agents at perimeter spawns ≥ 71 tiles away → `heardBy:[]` correct. Turn 42 speaker at `(38,61)`, listener Player_4 at `(46,46)` (Chebyshev 15 ≤ 20) → `heardBy:[Player_4]`. | **PASS** |
| WP8 speech window: N→N+1 only | Turn 42 `Player_6` says X (`heardBy=[Player_4]`); turn 43 input for Player_4 contains `Heard (last turn): - Player_6: "Heading to evac…"`; turn 44 input for Player_4 has NO `Heard` section. One-turn window confirmed end-to-end. | **PASS** |
| `npm run lint && typecheck && test` green | Reproduced fresh: lint clean, typecheck clean, 205 passed / 4 LLM env-gated skipped. | **PASS** |

Engine integrity is verified independently of the implement crew's prose. Gate-1 acceptance is met.

---

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| **High** | LLM contract / system prompt | **Schema-vocabulary mismatch.** 84.5% (338/400) of decisions fell back to safe-default; 299 of those were `schema_validation_failed`. Inspecting `rawArguments` shows the model emits `move.kind:"move"`, `"toward"`, `"toward cover"`, `"to relative tile"`, `"wait"` and `action.kind:"open"` — none of which are the schema's discriminated-union literals (`relative` / `toward_entity` / `toward_object` / `toward_evac` / `away_from_entity` / `none` for move; `attack` / `interact` / `loot` / `none` for action). The model is faithfully parroting the natural-English vocabulary in the affordances digest (`affordances.ts:82–145` emits `"toward Player_X"`, `"open chest_NNN"`, `"to relative tile"`) and in the system prompt (`systemPrompt.ts:44–59` describes movement / interact rules in prose without ever naming the literal `kind` values). | `rawArguments` samples on Turn 1: `rat → kind:"move"`, `trader → kind:"toward cover"`, `paranoid → kind:"toward"`, `camper → kind:"to relative tile"`, `vulture → kind:"toward"`. Turn 23 sprinter: `move.kind:"wait"`, `action.kind:"open"`. | **BLOCK Stage-2 dispatch.** Insert an implement job — own scope: **WP10.5 — Schema-aligned system prompt + affordances vocabulary** (NOT a WP15 issue, see D-G1-1 below). Two surface fixes: (a) enumerate valid `move.kind` and `action.kind` literals explicitly in `systemPrompt.ts` with one example per literal, and (b) align `affordances.ts` rendering to the schema literals (e.g., emit `"interact: chest_008"` and `"toward_object: chest_008"` rather than `"open chest_008"` / `"toward chest_008"`) OR add a parallel "schema cheat-sheet" subsection inside the digest. Re-run the same 1-match smoke; require fall-back rate ≤ 10% (WP6 risks line 172 threshold) before unblocking Stage-2. |
| **Med** | Speech filter consistency | `runMatch.ts:253–268` `buildHeardForObserver` re-filters speech by **current speaker pos** and **current observer pos** instead of consuming the engine's already-correct `trace.speech[].heardBy` list. The engine computes `heardBy` against start-of-turn-N positions (`resolution.ts:236–263`), which matches `concept-spec.md §16` ("at the moment of speech"). The WP10 re-filter uses positions one turn later, which can drift by up to 12 tiles (with speed). Live evidence shows the practical drift was small in this match, but the divergence violates WP8 acceptance line 251 ("speaker was within 20 tiles of the listener at the moment of speech") on principle. | `convex/runMatch.ts:253–268`; cross-ref `convex/engine/resolution.ts:236–263`. | Replace the re-filter with a direct read of `priorSpeech[i].heardBy.includes(observer.characterId)`. The trace already encodes the answer; computing it twice with different inputs is the bug. ~10 LOC change. Bundle into WP10.5 alongside the prompt fix. |
| **Med** | WP11 stage gating | Harness logs the `--reasoning` argument and validates it but does NOT plumb the value through to `matches.start` / `callDecisionTool` (`runMatch.ts:79` hardcodes `REASONING_EFFORT="low"`; `harness/run.ts:248–258` carries an explicit TODO). Stage-1 acceptance permits this, but the WP11 acceptance bullet "`--reasoning medium` causes the `callDecisionTool` mock to receive `reasoningEffort: "medium"`" is unsatisfied. | `harness/run.ts:248–258` TODO; `convex/runMatch.ts:79`. | Required for Gate-2 acceptance, not Gate-1. Track in Stage-2 entry checklist. Add `reasoningEffort: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high")))` to `matches.start` args, persist on the `matches` row, and forward to `callDecisionTool` in `runMatch.advanceTurn`. |
| **Low** | Doc drift | `convex/_data/personas.ts:2` and `convex/_data/map.ts:2` reference `scripts/regenerate-data.ts` ("To regenerate: run …") but that script does not exist — `scripts/` is not even on disk. WP15 tuning iterations that edit `personas/*.md` will silently no-op against the deployed bundle. | `ls scripts/` → not found; header in both `_data` files. | Either ship the regen script (a 30-line `tsx` reading `personas/*.md` + `maps/reference.json` and writing the inline files) or update the headers to instruct hand-editing the inline files. Pick one and stop the drift before WP15 starts iterating. |
| **Low** | Dead/redundant inlining | `convex/matches.ts:43` already imports `../maps/reference.json` directly via `with { type: "json" }` (Convex's bundler handles JSON natively). Yet `convex/_data/map.ts` exists for `convex/engine/map.ts:47` to consume. The simpler unification is: switch `convex/engine/map.ts` to the same JSON import and delete `convex/_data/map.ts`. Personas (`*.md`) genuinely need inlining; the map descriptor doesn't. | `convex/matches.ts:43` vs. `convex/engine/map.ts:47`. | Optional cleanup. Not blocking; flag to Stage-2 cleanup pass if convenient. |
| **Low** | Trace-vs-schema vocabulary divergence | `ResolutionTrace.consumed[].item` carries a `ConsumableName` string (engine-vocabulary) while the schema validator expects `{category:"consumable", name:…}`; WP10's `adaptResolutionForSchema` patches this at persistence time (`runMatch.ts:316–319`). Two shapes of "the same data" sitting either side of the persistence boundary is a small future-bug risk. | `convex/engine/resolution.ts:79–97` head comment + `convex/runMatch.ts:316–319`. | Acceptable; documented in both call sites. Track for Stage-2 cleanup if a third consumer needs the schema shape. |
| **Low** | Commit hygiene | Single commit `37c56d5` with 77 files / +18,202 lines. | `git show --stat 37c56d5`. | Defensible for a vertical-slice landing — WP1–WP10 are tightly coupled and only the integrated state was validated end-to-end. Splitting per-WP retroactively would be churn. No change recommended. Stage-2 / Stage-3 should land as their own commits per ADR D7. |

---

## Spec / Guide Deviations

- **WP6 escalation threshold breached.** `work-packages.md` WP6 "Risks" line 172 binds: "if > 10 % over a 10-run window, escalate to WP15 (prompt/schema tuning) **or to user (PM) if the failure mode points at the wrapper / schema rather than the prompts**." The observed 84.5% rate over a 1-match (50-turn / 400-decision) window is 8.5× the threshold. The failure mode points at the **system prompt + affordances vocabulary**, not the wrapper or schema (the wrapper handled every fallback correctly per the locked `FailureReason` set). Per the contract this escalates "to WP15" — but WP15's listed levers (`work-packages.md:474–478`) are persona / map / reasoning / system-prompt-as-last-resort. The current issue is a **contract-vocabulary mismatch** that needs to be fixed BEFORE WP15 can usefully run. This is the basis for Decision Note **D-G1-1** below.
- **`mental-model.md` §10 done-bar realism.** The §10 bar requires ≥ 80 % runs-with-kill, ≥ 80 % runs-with-equip, ≥ 30 % runs-with-extraction, ≥ 50 % runs-with-speech, persona spread ≥ 15 pp. Live Stage-1 observed: **0 kills, 0 equips, 0 extractions, 10 speech events across 50 turns, all 8 agents alive at end-of-match** (none reached the 3×3 evac zone). Even ignoring the Stage-1 single-run sample size, the substrate output produced by the current prompt-schema vocabulary is functionally indistinguishable from random safe-defaults — there is no path from this state to the §10 bar without the prompt fix. Anchored explicitly: **`mental-model.md` §10 done-bar will not be met by Stage-3 unless the prompt-schema vocabulary is corrected first.**
- **WP8 acceptance line 251 (minor drift).** WP10's `buildHeardForObserver` filters by current speaker pos rather than start-of-speech pos. Trace's `heardBy` already encodes the §16-correct answer; the re-filter is a redundant near-duplicate that drifts slightly. See Issues table, Medium severity.

No deviations from `azure-llm.md` §7 (wrapper request shape verified — `tool_choice:"required"`, `parallel_tool_calls:false`, `reasoning.effort:"low"`, `additionalProperties:false`, `store:false`, system+user input shape, JSON-encoded `arguments` parsed via `JSON.parse` then Zod). No deviations from `convex-backend.md` (env vars set, schema deployed, queries reachable).

---

## Decision Notes

### D-G1-1 — RULING on the 84.5% safe-default fall-back rate

**Question:** Is the 84.5% schema_validation_failed rate acceptable for Gate-1 closure (defer to a downstream tuning loop), or BLOCKING for Stage-2 dispatch?

**Ruling: BLOCKING for Stage-2; not blocking for Gate-1 engine-acceptance closure.** Specifically:

- **Gate-1 (engine-smoke) acceptance bullets PASS independently of the fall-back rate.** WP6's wrapper contract is met (graceful fall-back with full telemetry), trace introspection is intact, the engine resolved 50 turns without crashes or invalid states, and the gate's literal acceptance bullets in `work-packages.md` §🔒 Gate 1 do not include a fall-back-rate threshold. The implement crew's classification ("within the WP6 contract") is technically correct.
- **However, dispatching Stage-2 (10 parallel) and Stage-3 (50-run closing report) on top of this baseline is invalid.** Three reasons, anchored:
  1. **Done-bar realism (`mental-model.md` §10).** A 50-run report with 84.5% safe-defaults will produce 0 kills / 0 equips / 0 extractions / negligible persona spread — failing every metric in the §10 bar by orders of magnitude. The point of Stage-3 is to validate the substrate; running it now would conclusively prove only that the substrate's prompt-schema vocabulary is broken, which we already know.
  2. **WP6 escalation contract (`work-packages.md` line 172).** The 10% threshold over a 10-run window is breached by 8.5×, and the failure mode is the system prompt / affordances vocabulary — not the wrapper or schema. Per the contract, this escalates to a tuning fix BEFORE further runs.
  3. **WP13 rate-limit measurement validity.** Stage-2's WP13 spike measures Azure RPM/TPM under realistic load. If 84.5% of calls are short safe-defaults emitted by the wrapper before any real engine work, the input-token / latency / 429-rate measurements will not generalise once the prompt is fixed and the model produces full-discipline outputs. This is the same sunk-cost trap as running production benchmarks against degenerate inputs.

**Owner & scope of the unblock:** Insert a new work package — call it **WP10.5: Schema-aligned system prompt + affordances vocabulary** — slotted between Gate-1 and Stage-2 dispatch. Scope:

1. Edit `convex/llm/systemPrompt.ts` to enumerate the valid `move.kind` and `action.kind` literal values explicitly. Suggested inline section: a 4–6 line "Decision schema cheat-sheet" listing each `kind` literal with one concrete example. Token budget: stays under the WP8 ≤ 1 200-input-token assertion.
2. Edit `convex/engine/affordances.ts` rendering so the digest emits the literal `kind` names, not English synonyms. Two acceptable patterns:
   - **Pattern A (preferred, simpler):** Replace `"open chest_008"` with `"interact: chest_008"`, `"toward Player_X"` with `"toward_entity: Player_X"`, `"to relative tile"` with `"relative: dx,dy"`, etc.
   - **Pattern B (more readable):** Keep the current English vocabulary but add a parallel `Schema:` subsection to the digest naming the literal `kind` value next to each affordance.
3. Bundle the speech-filter fix from the Issues table (Medium-severity row) into the same change — replace `runMatch.ts:253–268` with a direct read of `priorSpeech[i].heardBy`.
4. Re-run `npm run harness -- --runs 1 --concurrency 1` against a fresh match. Inspect `turns:byMatch` aggregate fall-back rate. **Acceptance gate: ≤ 10% safe-default rate over the 50-turn smoke** (WP6 line 172 threshold). If it clears, Stage-2 dispatch unblocks.

**Why this is NOT WP15.** WP15 (`work-packages.md:469–502`) is the persona / map / reasoning / system-prompt-as-last-resort tuning loop, scoped to "make the substrate prove itself" once the substrate produces meaningful signal. The current state has no signal — agents emit safe-defaults 84.5% of the time, then sit still. WP15's hard-cap escalation matrix at iteration 13+ even has a row for "All 8 personas converge on byte-identical decisions under the mock LLM smoke → tooling/contract bug → return to WP6/WP8". That is exactly the situation here, only the contract bug is in the system prompt vocabulary rather than the wrapper. Fixing it is a WP6/WP8 boundary issue, not WP15 work.

**Estimated effort:** 1–2 hours of engineering + ~5 minutes of Azure tokens to re-run the smoke. Small, mechanical, well-scoped.

### D-G1-2 — Convex bundling fix is fine, but inconsistent

`convex/_data/personas.ts` is the right call (markdown bodies cannot be imported via `import … with { type: "json" }`). `convex/_data/map.ts` is redundant given `convex/matches.ts:43` already proves the JSON-import path works for Convex's bundler. Recommend collapsing the map inlining back into a JSON import in `convex/engine/map.ts` as a Stage-2 cleanup. Not Gate-1 blocking.

### D-G1-3 — Commit hygiene defensible

Single 77-file / +18,202-line commit reflects the vertical-slice landing. Splitting per-WP retroactively would be churn since WP1–WP10 were validated only as an integrated whole. Future WPs (Stage-2 / Stage-3) should land as their own commits per ADR D7 ("Reviews go BEFORE gates close, not after"); review checkpoints define the natural commit boundaries.

---

## Verdict

**APPROVE-WITH-CHANGES.**

Gate-1 engine-acceptance closes. Stage-2 dispatch is **blocked** until WP10.5 (schema-aligned system prompt + affordances vocabulary, plus the bundled speech-filter cleanup) lands and a re-run smoke shows safe-default rate ≤ 10% per WP6's locked threshold. Track WP10.5 as the explicit owner of the prompt-schema vocabulary fix; do not bundle into WP15 (different scope, different lever set).
