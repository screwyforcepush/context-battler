# Completion Review - Phase 7

**Verdict: APPROVE-WITH-EDITS**  
**Date:** 2026-05-13  
**Reviewer:** Review Architect

## Review Summary
- **Overall assessment:** Concern, but bounded. The substrate, slim-query path, dashboard drill-down, and canonical 20-run report are largely aligned with the North Star. The remaining concerns are in diagnostics correctness, not core match resolution.
- **What is solid:** `Vision:` is slimmed to the intended field set; own/inbound speech and loot-outcome rendering are restored in `inputBuilder`; coord chest ids are live in map expansion, engine resolution, run stats, replay reconstruction, and analyzer paths; `turns.byMatchSlim` strips heavy text and the CLI/dashboard fan out per match.
- **What is risky or unclear:** Several "feed delivery" diagnostics are same-turn resolution counters, not proof that next-turn user-role feed lines were delivered. The diagnostics contract also asks for `consume:heal at full HP` and consumable-present equipment cross-cuts, but the slim projection does not carry the needed self HP or consumable slot.

## Issues
| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| High | Diagnostics / Closing Report | The slim derived "feed" signals are temporally misaligned. `inboundSpeechCount`, `lootOutcomeFeed`, and `damageFeedAudit` are computed from the same turn row's `resolution`, while the actual agent-facing feed line appears in the *next* turn's `agentRecord.input.composedUserMessage`. The closing report then reports delivery-style gates from these counters, and `damageFeedMissing` is hard-coded to `0`. | `convex/turnsDerived.ts:353-390` derives signals from the same `row.resolution`; `countInboundSpeech` reads current-row `resolution.speech` at `convex/turnsDerived.ts:279-286`; `extractLootOutcomes` reads current-row actions at `convex/turnsDerived.ts:305-324`; `convex/reports/phase7.ts:435` sets `damageFeedMissing: 0`; `convex/reports/phase7.ts:445` uses `mechanics.speech.inboundDelivered` as the inbound speech gate. Live check: `j975...` turn 1 had `inboundSpeechCount=1` in `byMatchSlim`, but the turn-1 full input had no inbound speech; it appeared on turn 2. | Change `projectSlimTurnRows` to compute delivery signals across adjacent rows before projection: map turn N resolution events to turn N+1 recipient agent records, and verify/render derived booleans from `composedUserMessage` before stripping it. Rename same-turn counters if kept. Recompute and repersist `phase-7-closing-20` after this fix so delivery gates are evidence-backed. |
| Med | Diagnostics Metrics | `consume:heal at full HP` and consumable-present equipment cross-cuts are not actually computable. `selfEquipment` only projects weapon/armour; no self HP is projected; `mechanics.consume.healAtFullHp` is hard-coded to `0`; the behaviour combo can only fire if an undeclared `selfHp` field exists. | `convex/turnsDerived.ts:8-11` defines `SelfEquipment` without consumable; `extractSelfEquipment` only parses weapon/armour at `convex/turnsDerived.ts:190-215`; `harness/diagnostics/mechanics.ts:250-254` returns `healAtFullHp: 0`; `harness/diagnostics/behaviour.ts:414-423` checks a non-projected `selfHp`; `equipmentKey` omits consumable at `harness/diagnostics/behaviour.ts:426-429`. CLI spot-check over last 20 showed `heal: 8` consumes and `healAtFullHp: 0`, but the code cannot know whether that zero is true. | Add lean `selfHp: {hp,maxHp}` and `selfEquipment.consumable` to `byMatchSlim` from the Status block before projection. Compute `healAtFullHp`, `consume:heal at full HP`, and equipment keys including consumable-present. Add tests with a full-HP heal consume that must count. |
| Low | Test / Probe Hygiene | A few non-runtime fixtures still show legacy non-coordinate chest ids or iter-2 Vision leakage. They do not appear to affect runtime, but they violate the spirit of the chest-id/mechanical scrub and can mislead future work. | `tests/llm/schemaMirror.test.ts:622-625` uses `Chest_003`; `harness/probe-reasoning.ts:97-115` uses `Chest_005` plus `kind`, `pos`, `opened`, `contents`, and full `equipped` in a prompt sample. Negative fixtures in `tests/reports/phase7.test.ts:285-307` intentionally use `chest_007` to test legacy-literal detection and are acceptable if documented as negative cases. | Replace non-negative examples with coord ids like `Chest_53_54` and iter-3 Vision shape. Add a comment around intentional legacy detector fixtures so future sweeps do not treat them as missed migration. |

## Acceptance Criteria Scores
| Criterion | Score | Evidence |
|---|---|---|
| A.1 Vision reduced to `dist`/`bearing` plus character `hp`/`armed`; no `kind`/`pos`/`opened`/`drained`/`contents`/`equipped`/`inZone`; block named `Vision:` | PASS | `convex/llm/inputBuilder.ts:303-421`; live `turns:getAgentTurn` Trader T3 shows `Vision:` with characters `{dist,bearing,hp,armed}` and loot/terrain `{dist,bearing}` only. |
| A.2 Inside-Evac suppression and Status `Inside/Outside Evac` | PASS | `observerInEvacZone` and Evac suppression at `convex/llm/inputBuilder.ts:365-403`; Status line at `convex/llm/inputBuilder.ts:423-435`; tests cover inside/outside in `tests/llm/inputBuilder.test.ts:806-826`. |
| A.3 Status unarmed baseline `⚔️weapon: unarmed [dmg 5]` sourced from damage floor | PASS | `renderWeaponSlot` uses `MIN_DAMAGE_FLOOR` at `convex/llm/inputBuilder.ts:100-104`; floor constant is `5` at `convex/engine/types.ts:95-99`; combat binds unarmed to the floor at `convex/engine/combat.ts:35-37`. |
| A.4 Own speech split from mechanical outcome; inbound speech rendered as feed events | PASS for substrate | Own/action split is in `convex/llm/inputBuilder.ts:137-187` and event assembly at `convex/llm/inputBuilder.ts:461-467`; live turn 2 example contained `Trader said "..."`. See High issue for diagnostics overclaim around delivery auditing. |
| A.5 Loot outcome line names contents on success and marks empty on failure | PASS for substrate | Rendering at `convex/llm/inputBuilder.ts:147-157`; chest traces at `convex/engine/resolution.ts:710-751`; corpse traces at `convex/engine/resolution.ts:764-825`; tests in `tests/llm/inputBuilder.test.ts:463-586`. |
| A.6 Coord-encoded chest ids engine-wide | PASS with low hygiene note | `convex/engine/map.ts:127-138`, `convex/matches.ts:100-120`, `convex/engine/resolution.ts:131-133`, `convex/engine/runStats.ts:61-63`, replay reconstruction `apps/replay/src/lib/reconstruct.ts:286-288`. Low issue covers stale non-runtime examples. |
| A.7 System prompt two-phase countdown and win-condition rephrase | PASS | `convex/llm/systemPrompt.ts:5-20`; live T3 system prompt had `Evac location spawns in 27 turns`; post-30 branch verified in UAT report. |
| B.1 `turns.byMatchSlim` strips heavy text fields | PASS | Query in `convex/turns.ts:84-93`; projection in `convex/turnsDerived.ts:327-350`; actual `byMatchSlim` spot-check returned no heavy input/LLM fields. |
| B.2 CLI/dashboard fan out N parallel per-match calls | PASS | Harness fan-out `Promise.all` at `harness/diagnostics/fanout.ts:15-25`; replay fan-out at `apps/replay/src/lib/diagnosticsFanout.ts:68-82`; closing Path 2 uses the same at `harness/closing/phase7.ts:234-246`. |
| B.3 Drill-down uses existing `turns.getAgentTurn` / existing replay modal | PASS | Full query unchanged at `convex/turns.ts:36-54`; replay route opens `ExpandModal` from `?turn=&character=` at `apps/replay/src/routes/Replay.tsx:75-83` and `:342-346`. |
| B.4 No materialized rollups/write hooks for diagnostics view | PASS | Diagnostics recompute through CLI/UI fan-out; only closing report persists `phase7Payload` via `reports/phase7:persistComputedPhase7Report`. No diagnostics report type was added. |
| C.1 CLI `harness/diagnostics.ts`, `--last N <= 20`, JSON/markdown | PASS | Arg clamp and output at `harness/diagnostics.ts:73-114`, `:140-224`, `:226-260`; CLI spot-check over last 20 returned 20 matches, 1,000 turns, 7,212 records. |
| C.2 Dashboard tab/control/deep-link/no new modal | PASS | Route parser `apps/replay/src/lib/useHashRoute.ts:68-72`; tab in `apps/replay/src/main.tsx:117-147`; `last` control in `apps/replay/src/routes/Diagnostics.tsx:84-97`; links at `apps/replay/src/routes/Diagnostics.tsx:537-550`. |
| C.3 Critical-fails family | PASS | Fallback taxonomy, retry, token proximity, validator breakdown, persona cross-tab in `harness/diagnostics/critical.ts:13-145`. |
| C.4 Game-mechanic sanity family | PARTIAL | Most counters are present in `harness/diagnostics/mechanics.ts:13-279`, but damage-feed "delivery" is a same-turn resolution counter and heal-at-full-HP is hard-coded `0`. |
| C.5 Behavioural distribution family | PARTIAL | Main distributions and combos are present in `harness/diagnostics/behaviour.ts:25-277`, but `consume:heal at full HP` cannot fire without `selfHp`, and equipment cross-cuts omit consumable-present. |
| C.6 Recompute on demand; no persisted aggregate rows; no diagnostics report type | PASS | CLI/UI recompute from `byMatchSlim`; schema only adds closing `phase7Payload` and existing report type `phase-7-closing-20`. |
| D. No-op metric redefinition | PASS | `computePhase7Metrics` does not preserve `meetsNoOpThreshold`; report payload carries data-only `armedStancePauseRate` / `trueStationaryRate` at `convex/reports/phase7.ts:440-443`; tests assert no no-op threshold at `tests/reports/phase7.test.ts:260-267`. |
| E.1 Canonical report id/type/runCount/metBar/failed matches | PASS | `npx convex run reports:byId {"id":"jd7c6qjj5dmhxa97m2md7f533n86m9sk"}` returned `reportType: phase-7-closing-20`, `runCount: 20`, `metBar: true`, `failedMatches: 0`. |
| E.2 Comparable phase-6 gates preserved | PASS | Queried `phase7Payload`: extraction 100%, kill 90%, equip 100%, speech 100%, persona spread 50 pp, action+overwatch 33, overwatch triggers 48, counter 78, all 8 bearings, zero illegal `use`, zero `Player_N`, zero whole-turn validator zeroes, 0.119% field rejection, zero failed matches. |
| E.3 Additional feed/loot delivery gates in closure table | PARTIAL | Loot/speech/damage substrate code is present, but the closing payload's delivery-style proof is not reliable until the High issue is fixed. `damageFeedMissing` is hard-coded `0`, and inbound/loot "feed" counts are same-turn resolution counters. |
| E.4 OCC substitution policy | PASS | `PHASE-7-CLOSURE.md:55-83` documents exclusion of one Convex OCC storage-layer failure and two concurrency-1 replacements. This matches mental-model phase-6 precedent and is honest because the canonical set still contains 20 completed matches with zero failed matches. |

## Spec / Guide Deviations
- `behavioural-diagnostics-intent.md` requires a damage-feed delivery audit; current diagnostics count expected/current-row damage events rather than verifying delivered next-turn user-role feed lines.
- `behavioural-diagnostics-intent.md` requires consume waste including `consume:heal at full HP`; the metric is currently non-functional because `selfHp` is not projected.
- `behavioural-diagnostics-intent.md` cross-cuts include equipped state with consumable-present; the current equipment key is only `armed/unarmed | armour`.
- The closure record's feed-delivery table is stronger than the evidence stored in `phase7Payload`; the substrate likely works, but the report proof should not claim actual delivery until the slim projection audits next-turn inputs.
- Stale non-runtime fixture/probe examples still show ordinal-looking chest ids and old Vision fields.

## Decision Notes
- PM decision: do not close Phase 7 as fully approved until the two diagnostics edits above land and `phase-7-closing-20` is recomputed/persisted from corrected derived signals.
- The OCC substitution policy is acceptable for this phase. A harness auto-retry remains a future operational improvement, not a closure blocker.
- Validation context: Navigator pre-confirmed `npm run lint`, `npm run typecheck`, `npm test` (623 passed, 2 skipped), and `npm run build:replay`. This review additionally ran Convex `reports:byId`, `turns:byMatchSlim`, `turns:getAgentTurn`, and `harness/diagnostics.ts --last 20 --format json` spot checks.

---

# Completion Review — Attempt #2

**Verdict: APPROVE**
**Date:** 2026-05-13
**Trigger:** Attempt #1 HIGH (damage-feed delivery audit tautology) and MED (consume:heal at full HP + consumable cross-cut non-functional) findings required structural fixes before Phase 7 could close.

## What changed between attempts

Commit `ac6347c` (`fix(phase-7): make diagnostics delivery audits evidence-backed`) landed three structural fixes:

1. **`turns.byMatchSlim` / `turnsDerived.ts` delivery audit** — `projectSlimTurnRows` now audits previous-turn speech, loot, and damage events against the next turn's `input.composedUserMessage` *before* stripping heavy text. The `damageFeedAudit` derived signal carries `expectedIncoming`, `missingIncoming`, `expectedOutgoing`, `missingOutgoing`, `expectedDealtKills`, and `missingDealtKills` — all computed from cross-turn evidence, not same-turn resolution counters.
2. **Slim projection extended** — `selfHp: {hp, maxHp}` and `selfEquipment.consumable` are now projected before heavy text is stripped. `SelfEquipment` type includes `consumable: string | null`.
3. **Downstream diagnostics wired** — `healAtFullHp` combo (mechanics family) and `consume:heal at full HP` combo (behaviour family) now check `selfHp.hp === selfHp.maxHp`. Equipment cross-cut keys include consumable-present state.

## Re-assessment of attempt-#1 findings

| # | Severity | Finding | Attempt #2 Status | Evidence |
|---|---|---|---|---|
| 1 | High | Damage-feed delivery audit is same-turn counter; `damageFeedMissing` hard-coded 0 | **RESOLVED** | `convex/turnsDerived.ts` `DamageFeedAudit` type now has `expectedIncoming`/`missingIncoming`/`expectedOutgoing`/`missingOutgoing`/`expectedDealtKills`/`missingDealtKills` fields computed from next-turn `composedUserMessage`. `convex/reports/phase7.ts:288` `damageFeedDeliveryCounts` reads from the audit struct. Canonical report `jd73vy815k7rdq6y7935hjagn186n9ga` shows `damageFeedMissing = 0` across 265 audited events — now evidence-backed, not hard-coded. |
| 2 | Med | `consume:heal at full HP` non-functional; consumable cross-cut missing | **RESOLVED** | `turnsDerived.ts:8-12` `SelfEquipment` includes `consumable: string | null`; `SelfHp` type at lines 14-17 carries `hp`/`maxHp`. `harness/diagnostics/mechanics.ts` `healAtFullHp` checks `selfHp.hp === selfHp.maxHp` when `use === "consumable"` and consumable is heal. `harness/diagnostics/behaviour.ts` equipment key includes consumable-present. |
| 3 | Low | Stale chest ids and iter-2 Vision in test fixtures | **RESOLVED** | `harness/probe-reasoning.ts` updated to coord-encoded `Chest_53_54` and iter-3 Vision shape. `tests/llm/schemaMirror.test.ts` non-negative fixture updated. Intentional legacy negative fixture in `tests/reports/phase7.test.ts` documented with comment. |

## Acceptance Criteria Re-scores (previously PARTIAL)

| Criterion | Attempt #1 | Attempt #2 | Evidence |
|---|---|---|---|
| C.4 Game-mechanic sanity family | PARTIAL | **PASS** | Damage-feed delivery audit is now evidence-backed via next-turn cross-audit. `healAtFullHp` computable from projected `selfHp`. |
| C.5 Behavioural distribution family | PARTIAL | **PASS** | `consume:heal at full HP` fires when `selfHp.hp === selfHp.maxHp`. Equipment cross-cuts include consumable-present via extended `SelfEquipment`. |
| E.3 Feed/loot delivery gates in closure | PARTIAL | **PASS** | Canonical report `jd73vy815k7rdq6y7935hjagn186n9ga` carries `damageFeedMissing = 0 / 265` from evidence-backed audit. Loot and speech delivery counters also cross-turn audited. |

All other criteria remain PASS from attempt #1. **20/20 acceptance criteria now PASS.**

## Validation context
- `npm run lint` PASS
- `npm run typecheck` PASS
- `npm test` PASS (626 passed, 2 skipped)
- `npm run build:replay` PASS
- Canonical report `jd73vy815k7rdq6y7935hjagn186n9ga`: `metBar=true`, `failedMatches=0`

## UAT
Attempt-#1 UAT already passed 8/8 stories. The attempt-#2 fixes are backend diagnostics corrections — no user-facing regression surface. UAT-#1 verdict stands; see UAT-REPORT.md §Attempt #2 Addendum for confirmation.

## Final verdict
**APPROVE.** All three attempt-#1 findings are structurally resolved with evidence. The canonical Phase 7 report is evidence-backed end-to-end. No residual gaps block closure.
