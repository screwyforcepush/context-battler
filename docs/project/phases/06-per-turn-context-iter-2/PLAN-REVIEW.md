# Phase 6 Plan Review — Per-Turn Context Iteration 2

- **Verdict:** APPROVE-WITH-CONDITIONS
- **Reviewer:** Review Architect
- **Date:** 2026-05-12
- **Reviewed:** phase plan README, intent anchors, mental model, probe artifacts, phase-3/5 records, and sampled current implementation callouts.

## Review Summary
- **Overall assessment:** Concern, but proceed once the conditions below are accepted into WP ownership.
- **What is solid:** ADR-1/2 match the schema intent after Responses-API flattening; the persona-name-as-id move is aligned with mental-model pillar 1; scratchpad-null carry-forward is preserved; safe default as `dist:0` no-op is the right prompt-hygiene call; POC wipe / no migration shim posture is correctly accepted.
- **What is risky or unclear:** The plan currently lets existing offensive overwatch semantics masquerade as the new movement-triggered overwatch, and the report scan path would not prove the north-star condition. The personal damage feed also assumes `resolution.actions[].target` is already a persona display name, but current overwatch/counter trace entries emit internal ids.

## Issues
| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| High | Engine / Metrics | The planned overwrite of the existing offensive-overwatch pass does not by itself satisfy "fires on a moving enemy." The current pass fires after movement at the nearest visible in-range enemy; it does not prove the target moved into range this turn. The proposed metric `kind="overwatch" + result="dmg N"` can falsely pass with already-in-range targets. | Plan says existing pass becomes trigger arm at `README.md:266-270` and WP-B routes `position.overwatch` there at `README.md:526-527`; metric source is only `kind="overwatch" + result="dmg N"` at `README.md:88-90`. Current code fires from post-move visibility/range only in `convex/engine/resolution.ts:376-426`. | Add a WP-B requirement and tests for movement-trigger semantics: target must have moved into range during the movement phase, or the trace must carry an explicit movement-trigger marker. WP-I must scan that marker or join overwatch target to same-turn `resolution.moves[]`, not just count damage rows. |
| High | Event Feed / Trace Contract | ADR-8 filters personal damage by `entry.target === observer.displayName`, but current reactive trace targets are internal character ids for offensive overwatch and defensive counter-fire. That would drop overwatch/counter damage from the personal feed or leak non-persona ids unless WP-B changes trace targets. | Plan filter: `README.md:354-356`. Current offensive overwatch trace target is internal `targetId` at `convex/engine/resolution.ts:418-423`; current defensive counter target is internal `cf.attackerId` at `convex/engine/resolution.ts:799-803`. | Condition WP-B/D on a canonical trace target contract: every character target emitted to persisted per-turn surfaces is the persona display name, including overwatch and counter. Add tests for LOS-independent personal damage lines from attack, overwatch, and counter. |
| Med | Report Aggregator | Several scan paths use the wrong field path for the new schema: `decision.position.move.direction.kind` / `position.move.dist`, but the schema has `position:{kind:"move", direction, dist}`. This can seed bad aggregator and replay code. | Plan metric source at `README.md:91-92`; no-op definition at `README.md:878-885`. Canonical schema shape is `position.kind`, `position.direction`, `position.dist` in `decision-tool-schema-draft.md:62-70` and `README.md:178-180`. | Correct WP-I/WP-G scan language before implementation: use `decision.position.kind === "move"`, then `decision.position.direction.kind` and `decision.position.dist`. |
| Med | Cleanup / No-Shim Posture | WP-G includes a phase-3 static-schema fallback for historical traces while the north star grants a wipe and says no migration shims. This is small in code but conceptually at odds with the cleanup gate. | Raw-pane fallback is planned at `README.md:630-632`; no-migration posture is `README.md:381-382` and north star cleanup requires no `Player_N` seam in code/tests/fixtures. | Keep fixture support new-shape only for Phase 6, or explicitly limit any fallback to test-only helpers that cannot render persisted phase-6 traces. Do not keep a production static phase-3 schema path. |
| Med | Cleanup Gate | The plan does not make the repo-wide `Player_N` cleanup concrete enough. WP-H greps only persona prompt sources, while the north star requires code, prompts, tests, fixtures, persona files, and persisted traces to be clean. | WP-H grep is limited to `personas/ convex/_data/personas.ts` at `README.md:664-666`; current source has many `Player_N` literals in code/tests/comments. | Add a source grep gate over `convex/`, `apps/`, `tests/`, `personas/`, and fixtures, with documented exclusions only for historical docs. Persisted trace grep remains necessary but not sufficient. |
| Med | DB Wipe Procedure | WP-H references a hypothetical `_internal_cleanup:wipeAll`; the repo already has a paginated wipe helper, and phase-5 closure used it. Leaving this vague risks a late operational stall. | WP-H wipe block at `README.md:655-661`; existing helper is `convex/spike.ts:52-78`; prior wipe record is `docs/project/phases/05-move-arm-consolidation/closure.md:30-49`. | Scope WP-H to the existing `spike:wipeOneTable` loop, or explicitly add a new cleanup helper before WP-H. Closure should record exact commands and row counts. |
| Med | Closing Report | WP-I names the iter-2 metrics but does not fully specify formulas for the hardest ones: personal damage feed audit, no-op resolved movement, player-name literal scan, and whole-turn validator zeros. | Metric list at `README.md:676-680`; personal damage feed row at `README.md:93`; whole-turn zero row at `README.md:94`. | Add formula notes before implementation: e.g. turn N damage entries -> turn N+1 `agentRecord.input.composedUserMessage` contains exact line; no-op uses resolved movement absence plus decision fields; literal scan covers rawArguments, decision, composed input, schema variant text, resolution targets, reports. |
| Low | Replay UI | Target-relative move English omits `dist`, even though `dist` is part of the emitted decision and affects whether target-relative movement is a commitment or a small adjustment. | WP-G English examples at `README.md:624-629`; schema has `dist` in `decision-tool-schema-draft.md:64-70`. | Render target-relative as "Moved toward <targetId> up to <dist>" / "Moved away from <targetId> up to <dist>". |

## Spec / Guide Deviations
- The highest-risk deviation is overwatch: the plan must prove movement-triggered fire, not just post-move in-range fire.
- The phase-3 rawPane fallback conflicts with the no-shim / wipe posture unless constrained to non-production test fixtures.
- The cleanup plan underspecifies the north-star `Player_N` source cleanup across code/tests/fixtures.
- The documented report scan paths need field-path corrections for the actual iter-2 `position` shape.

## §9 Ambiguity Ratification
| # | Decision | Verdict | Citation / Rationale |
|---|---|---|---|
| 1 | Visible object = JSON-style keyed | Ratify | `per-turn-context-intent.md:211-219` says keyed parse-mode object; README choice at `README.md:748-756` is reasonable given no probe budget. |
| 2 | Safe default = `dist:0` no-op move | Ratify | `decision-tool-schema-draft.md:441-445` defines `dist:0` no-op; avoids counter leaking fallback defensive intent. |
| 3 | Stance field retired | Ratify | Position union in `decision-tool-schema-draft.md:62-70` carries overwatch/counter structurally; matches player-perspective substrate. |
| 4 | `leaving_cover` emit retired | Ratify | System prompt reveal list omits it at `per-turn-context-intent.md:63-66`; README ADR-10 aligns substrate at `README.md:384-393`. |
| 5 | `validatorFieldErrors` structured object | Ratify | Field-scoped rejection is required by intent diagnostics at `per-turn-context-intent.md:253-258`; README ADR-6 shape at `README.md:274-305` supports replay UI rendering. |
| 6 | Persist `useVariant` discriminator | Ratify | `decision-tool-schema-draft.md:338-343` requires replay to know the shipped variant; discriminator reconstruction is the right trace-size tradeoff. |
| 7 | Persona scrub light touch | Ratify | Matches out-of-scope boundary at `README.md:128-134`; do not behavior-tune personas in this phase. |
| 8 | One-of-each-persona invariant | Ratify | Current assignment uses a seeded permutation in `convex/matches.ts:142-159`; add the test assertion as planned at `README.md:796-800`. |

## Cross-Reference Health
| North-star scenario | Plan mapping | Review |
|---|---|---|
| 1 Tool shape collapse | ADR-1/2, WP-A | Good. |
| 2 Per-turn `use` variant | ADR-1, WP-C, WP-G, WP-I | Good; add thread-through invariant tests. |
| 3 Action+overwatch combo | ADR-5, WP-B, WP-I | Conditional: movement-trigger semantics and metric proof need tightening. |
| 4 Counter retaliation | ADR-5, WP-B, WP-I | Good if trace kind becomes `counter` and no movement trigger path remains. |
| 5 Personal damage feed | ADR-8, WP-D, WP-I | Conditional: trace target/displayName contract must include overwatch/counter. |
| 6 Persona name as id | ADR-3, WP-E, WP-H, WP-I | Good direction; cleanup gate must be repo-wide. |
| 7 Field-scoped validator | ADR-6, WP-B, WP-G, WP-I | Good. |
| 8 Status + Current Game State | ADR-7, WP-D | Good; layout matches §2 including glyph order and two blank lines. |
| 9 System prompt verbatim | WP-F | Good; include named self and combo-range line, drop leaving-cover and fallback tail. |
| 10 Compass + dist movement | ADR-4, WP-B, WP-I | Good mechanics; fix `position.move.*` wording in report scan paths. |

Carry-over thresholds in README §2 match the north star. Iter-2 thresholds are present, but the overwatch trigger-fire and no-op scan paths need the corrections above to be load-bearing.

## Sampled Callout Verification
| Plan callout | Result | Evidence |
|---|---|---|
| `convex/matches.ts:255` displayName seed | Accurate | Current seed is `displayName: \`Player_${spawnIndex + 1}\`` at `convex/matches.ts:251-256`. |
| `convex/engine/validation.ts:299` `Player_` dispatch | Accurate but partial | `targetId.startsWith("Player_")` branch starts at `convex/engine/validation.ts:299`; other persona-id work also exists in helpers and tests. |
| `convex/engine/resolution.ts` offensive pass ~380 | Accurate location; semantics need change | Current offensive overwatch branch starts at `convex/engine/resolution.ts:376` and emits at `:418-425`. |
| `convex/engine/resolution.ts` defensive pass ~677 | Accurate | Defensive counter-fire pass starts at `convex/engine/resolution.ts:677` and emits trace rows at `:799-807`. |
| `convex/engine/resolution.ts:608` `Player_` corpse branch | Accurate | Current branch starts at `convex/engine/resolution.ts:608`. |
| `convex/llm/idNormalisation.ts:227` `Player_` resolve branch | Accurate | Current branch is `if (targetId.startsWith("Player_"))` at `convex/llm/idNormalisation.ts:227`. |
| `convex/llm/inputBuilder.ts:211` regex fallback | Accurate | `^P(\d+)$ -> Player_$1` fallback returns at `convex/llm/inputBuilder.ts:210-211`. |

## Risks Not Already Covered By §11.5
- There is no §11.6 in the plan; §11.5 only covers token budget. The following need owner attention.
- Schema-mirror parity across both `use` variants is tractable: current `tests/llm/schemaMirror.test.ts` already has live-export comparison patterns, but WP-A must table-drive both `buildDecisionTool({useVariant})` outputs.
- `useVariant` has a three-place coordination path: computed in `runMatch.ts`, consumed in `azure.ts`, persisted on `agentRecord.input`, then reconstructed in replay UI. WP-C should add an end-to-end test that the persisted discriminator equals the sent tool variant.
- Existing wipe helper is paginated per table; a single wipe-all action may hit Convex limits on large `turns` rows. Reuse the proven per-table loop unless a new helper is explicitly tested.
- Action trace target normalization is now a data-contract issue, not UI polish. If engine traces keep internal ids, persona-name-as-id will be inconsistent in reports and replay even if prompts look clean.

## Decision Notes
- PM can proceed to WP-A/WP-E after accepting the conditions above into WP ownership.
- Do not expand into persona behavior tuning, renderer fog/animation/mobile, reasoning/max-output probes, or multi-persona-per-match handling.
- The implementation review gate before WP-I should re-check the two high-risk items specifically: movement-triggered overwatch evidence and damage-feed attribution from reactive fire.
