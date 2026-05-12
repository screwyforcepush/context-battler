# Phase 6 Completion Review

- **Verdict:** APPROVE-WITH-CONDITIONS
- **Reviewer:** Review Architect
- **Date:** 2026-05-12
- **Reviewed scope:** full Phase 6 substrate, persisted closing-20 report `jd78f616beq7dvs84gcs1n2f9586kbqt`, closure record, validation logs, and intent anchors.

## Review Summary

- **Overall assessment:** Pass with minor evidence/cleanup conditions. The implementation matches the iter-2 substrate intent and the persisted report accurately records a 16/17 gate result with the no-op miss left honest.
- **What is solid:** Tool schema is the five-field Responses flat form with variant `use`; system prompt template matches intent; user-role input carries Status + Current Game State with persona ids; validator rejection is field-scoped; engine traces movement-triggered overwatch with persona-name targets; replay diagnostics cover iter-2 English, schema variant, raw-vs-decision, validator field errors, and token usage.
- **What is risky or unclear:** The canonical `/tmp/phase6-v3-live-azure-iter2.log` is incomplete even though an independent review rerun passed both live Azure variants. Also, `convex/llm/systemPrompt.ts` still exports an unused `<Player Name>` substitution helper, which weakens the D13 "Azure owns LLM-call substitution" boundary even though runtime request composition is correct.

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| Low | Validation Evidence | The claimed canonical live-Azure v3 log is recent but incomplete: it stops after the first `consumable_or_null` raw output and has no Vitest summary or `exit_code=0`. Independent review rerun passed both variants with `exit_code=0`, so this is an evidence artifact issue, not a substrate failure. | `/tmp/phase6-v3-live-azure-iter2.log:1-9`; review rerun `/tmp/phase6-review-live-azure-iter2.log:8-19`. | Replace or append the canonical v3 live-Azure log with a complete run, or update closure evidence to point at the review rerun. |
| Low | LLM Boundary | Runtime LLM-call substitution is correctly in `azure.ts`, but `systemPrompt.ts` still exports a second substitution helper. It appears unused, yet it leaves a second API surface that can drift from D13. | [convex/llm/azure.ts](/workspaces/context-battler/convex/llm/azure.ts:142) and [convex/llm/azure.ts](/workspaces/context-battler/convex/llm/azure.ts:499) are the active call path; [convex/llm/systemPrompt.ts](/workspaces/context-battler/convex/llm/systemPrompt.ts:13) exports an unused replacement helper. | Remove the unused system-prompt rendering export or make it non-exported test-only dead code cleanup. |

No High or Medium issues found.

## Gate Audit

| Gate | Persisted value / evidence | Verdict |
|---|---:|---|
| Report identity | `reportType=phase-6-closing-20`, `runCount=20`, `metBar=false`, `missingRunsForMatchIds=[]`, `failedMatches=0`; closure cites same at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:36). | PASS |
| Extraction | `95% (19/20)` matches closure table at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:85). | PASS |
| Kill | `90% (18/20)` matches closure table at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:86). | PASS |
| Equip | `100% (20/20)` matches closure table at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:87). | PASS |
| Speech | `100% (20/20)` matches closure table at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:88). | PASS |
| Persona spread | `75 pp` matches closure table at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:89). | PASS |
| Zero failed canonical matches | `0` in persisted `phase6Payload.failedMatches`; closure describes the selected set at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:49). | PASS |
| Null-only use violations | `0`; aggregator checks raw arguments, not parsed decision, at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:329). | PASS |
| Action+overwatch combos | `43`; combo detection counts attack damage, corpse `looted`, and chest `opened` via [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:246). | PASS |
| Movement-triggered overwatch fires | `52`; engine emits `triggeredByMovement:true` only when pre-range was out and post-range is in at [convex/engine/resolution.ts](/workspaces/context-battler/convex/engine/resolution.ts:331), and the report scans that marker at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:313). | PASS |
| Counter retaliations | `150`; counter pass is attack-triggered from `originalAttacks`, not movement-triggered, at [convex/engine/resolution.ts](/workspaces/context-battler/convex/engine/resolution.ts:621). | PASS |
| Compass bearings | `E, N, NE, NW, S, SE, SW, W`; movement table covers all eight at [convex/engine/movement.ts](/workspaces/context-battler/convex/engine/movement.ts:50). | PASS |
| Target-relative movement | `away, toward`; target-relative stop ranges flow through `resolveTypedEntity` at [convex/llm/idNormalisation.ts](/workspaces/context-battler/convex/llm/idNormalisation.ts:178). | PASS |
| Damage feed | `0 / 328` missing; scope note is persisted and closure repeats it at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:152). Sample queried turn contained `Camper attacked you with sword (dmg 15)` under `# Current Game State`. | PASS |
| Whole-turn validator zeroes | `0`; field-scoped validator returns per-field errors and preserves other fields at [convex/engine/validation.ts](/workspaces/context-battler/convex/engine/validation.ts:62). | PASS |
| Per-field rejection rate | `0.0297% (10 / 33,715 fields)`; denominator is `totalAgentRecords * 5` at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:439). | PASS |
| Persona ids / `Player_N` | `0`; source grep log reports zero matches at `/tmp/phase6-v3-playern-grep.log:1-3`, and report scan covers character display names plus prompt/raw/decision/trace surfaces at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:204). | PASS |
| No-op rate | `43.245% (2,916 / 6,743)`; threshold missed and `meetsAllThresholds=false`. | MISS, correctly measured |

## No-Op Assessment

The no-op formula matches the North Star definition. The report counts records where `use === null`, `say === null`, `action.kind === "none"`, and the position is stationary: either `position.kind !== "move"` or `position.dist === 0` at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:370). Because `action.kind === "none"` is required first, overwatch/counter with `action.attack` or `action.loot` are not counted as no-ops. I ratify the closure rationale at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:107): this is a behaviour-policy miss under the locked Phase 6 prompt/persona posture, not a metric inflation bug.

## D29 Verification

| Fix condition | Evidence | Verdict |
|---|---|---|
| Per-field rejection denominator is total records × 5 | [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:439), tests at [tests/reports/phase6.test.ts](/workspaces/context-battler/tests/reports/phase6.test.ts:67). | PASS |
| Action+overwatch combo counts chest `opened` | [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:246), tests at [tests/reports/phase6.test.ts](/workspaces/context-battler/tests/reports/phase6.test.ts:126). | PASS |
| `<Player Name>` LLM-call substitution owned by Azure wrapper | Active request path substitutes in [convex/llm/azure.ts](/workspaces/context-battler/convex/llm/azure.ts:499); persisted input keeps the template through [convex/runMatch.ts](/workspaces/context-battler/convex/runMatch.ts:389). | PASS with Low cleanup |
| Phase-3 production fallback stripped | No `buildLegacyUserMessage` remains; rawPane reconstructs iter-2 schema from `useVariant` at [apps/replay/src/lib/rawPane.ts](/workspaces/context-battler/apps/replay/src/lib/rawPane.ts:95), and vintage data is gated before reconstruction at [apps/replay/src/routes/Replay.tsx](/workspaces/context-battler/apps/replay/src/routes/Replay.tsx:160). | PASS |
| Null-only use violations check raw args | [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:224) and [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:329). | PASS |
| Player_N scan includes display names and outgoing payload | Character names at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:302), prompt/raw/decision surfaces at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:204), report samples at [convex/reports/phase6.ts](/workspaces/context-battler/convex/reports/phase6.ts:213). | PASS |
| Schema mirror parity covers both variants | `it.each(USE_VARIANTS)` byte-equality check at [tests/llm/schemaMirror.test.ts](/workspaces/context-battler/tests/llm/schemaMirror.test.ts:590). | PASS |

## Spec / Guide Deviations

- No blocking spec deviations found.
- The closure's damage-feed audit scope is acceptable: final-turn damage and damage to victims with no next-turn agent record have no next user-role message to audit. The persisted note says this explicitly, and the full eligible set reports `damageFeedMissing=0`.
- The OCC replacement is acceptable for this closure: the failed high-concurrency match was outside the canonical selected report set, was a Convex optimistic-concurrency transient rather than an engine invalid state, and was replaced by a concurrency-1 live Azure match. The canonical report therefore satisfies "zero crashes / invalid states across 20 runs." The harness should gain automatic retry/replacement policy in Phase 7, as already deferred at [PHASE-6-CLOSURE.md](/workspaces/context-battler/docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md:205).
- Out-of-scope boundaries held: no persona behaviour tuning was used to hide the no-op miss; the reference map remains fixed; no public/deployed/auth surface was added; one-of-each persona is still seeded in [convex/matches.ts](/workspaces/context-battler/convex/matches.ts:241).

## Decision Notes

- Completion can be ratified with the no-op threshold explicitly failed. Treat Phase 6 as substrate-closed, not metric-perfect.
- Phase 7 should own no-op reduction through persona/policy tuning, not through schema/report redefinition.
- Before relying on `/tmp/phase6-v3-*` as the final validation evidence bundle, refresh the live-Azure log so it has a complete Vitest summary and `exit_code=0`.
