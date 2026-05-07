# Gate-3 Completion Review - Phase 1 North Star

Review date: 2026-05-07
Review scope: Phase 1 completion against `docs/project/spec/mental-model.md` section 10, Cucumber Closing Report scenario, engineering hygiene gates, and Convex trace introspection contract.

Workspace note: the assignment named implementation commit `7740060`. At review time the workspace had a newer docs-only commit (`744e861`) adding `PHASE-1-CLOSURE.md` and a prior draft of this file. `git diff --name-only 7740060..HEAD` showed only those two documentation files, so the implementation under review is the `7740060` substrate plus documentation.

## Review Summary

- Overall assessment: **Pass / APPROVE**. Phase 1 North Star is closeable.
- What is solid: the persisted Convex `closing-50` row exists, is reachable through both report queries, recomputes cleanly against all six done-bar thresholds, and has `missingRunsForMatchIds: []`. The harness log has 50 starts, 50 ends, 50 per-run aggregate rows, one `report_created`, zero fallback matches, and zero failure events. Per-turn traces are queryable through `turns.getAgentTurn` and include visible-state digest, decision, scratchpad-before, scratchpad-after, and LLM telemetry.
- What is risky or unclear: no blocking risk found. The only review-context wrinkle is procedural, not technical: HEAD advanced beyond the assignment commit via docs only. No source files changed between `7740060` and the review-time HEAD.

## Independent Review Passes

### Pass A - Report Persistence and Thresholds

Verdict: **APPROVE**.

Direct Convex checks:

- `npx convex run reports:byId '{"id":"jd760kqja7sfwvt71mn0gdcexh8686jd"}'`
- `npx convex run reports:byMatchIdsHash '{"matchIdsHash":"64c2f318db35273a4e90ccff3bece75ba4f9d074668b82aa8468ba5b11324fd2","reportType":"closing-50"}'`

Both returned byte-identical rows: `reportType=closing-50`, `runCount=50`, `matchIds.length=50`, `metBar=true`, and `missingRunsForMatchIds.length=0`. I independently recomputed the SHA-256 hash over sorted `matchIds` and it matched `64c2f318db35273a4e90ccff3bece75ba4f9d074668b82aa8468ba5b11324fd2`.

Threshold recomputation from persisted `payload`:

| Metric | Required | Persisted value | Review result |
|---|---:|---:|---|
| Runs with >=1 extraction | >=15/50 | 48/50 (96%) | PASS |
| Runs with >=1 kill | >=40/50 | 48/50 (96%) | PASS |
| Runs with >=1 chest equip | >=40/50 | 50/50 (100%) | PASS |
| Runs with >=1 speech event | >=25/50 | 50/50 (100%) | PASS |
| Persona extraction-rate spread | >=15 pp | 28 pp | PASS |
| Crashes / invalid terminal gaps | 0 | 0 missing rows, 0 failure events | PASS |

Code evidence:

- `convex/reports.ts:160-177` implements idempotent early return for an existing `(matchIdsHash, reportType)` row.
- `convex/reports.ts:381-390` exposes the `reports.byMatchIdsHash` query used for independent lookup.
- `convex/engine/reportStats.ts:74-87` locks the section 10 thresholds.
- `convex/engine/reportStats.ts:226-248` counts per-run presence and per-persona extraction counts.
- `convex/engine/reportStats.ts:273-309` computes spread in percentage points and derives the `meets*` flags.
- `harness/run.ts:725-744` persists `reports.create` after completed-match aggregation and emits the `report_created` event.
- `harness/run.ts:760-768` exits nonzero on failed runs or missing `runs` rows, preventing silent partial reports.

Harness log sanity:

- `/tmp/stage-3-rerun-1778194076.log`: 4,866 lines / 486,775 bytes.
- Parsed counts: `run_start=50`, `run_end=50`, `run_aggregate=50`, `report_created=1`.
- Regex count over the log for `fallback|agent_decision_fallback|llm_validation_fallback`: `0`.
- Regex count over the log for `run_failed|harness_error|FATAL`: `0`.

### Pass B - Trace Introspection and Architecture Contract

Verdict: **APPROVE**.

The trace query path works against live Convex data. I sampled three report matchIds and pulled concrete per-agent turn records:

| Match | Turn | Character | Persona | Trace fields verified |
|---|---:|---|---|---|
| `j97884pxwm9s742ekvtxpx7y41868w3f` | 10 | `j57apgwx0ajs4rr5p5fpcvtchd868ysz` | `rat` | visible digest len 625, decision present, scratchpad before len 87, scratchpad after len 100, `fellBackToSafeDefault=false` |
| `j97ben4npa45swyxjj2mxs4v158692db` | 25 | `j572sepn1kbhadtmwjycxvays1868mqa` | `camper` | visible digest len 632, overwatch decision, scratchpad before/after present, `fellBackToSafeDefault=false` |
| `j971zswr1wrh282b3ge4cpk351868mft` | 40 | `j57bpk17t3mz25gv7xypr7jm4h868pmd` | `duelist` | visible digest len 992, overwatch decision, scratchpad before/after present, `fellBackToSafeDefault=false` |

The sampled `turns.getAgentTurn` rows include the exact North Star introspection fields: what the agent saw (`input.visibleStateDigest`), what it decided (`decision`), what it remembered before (`input.scratchpadBefore`), and what it remembered after (`scratchpadAfter`).

Code evidence:

- `convex/turns.ts:35-53` implements `turns.getAgentTurn({ matchId, turn, characterId })`.
- `convex/turns.ts:64-72` implements `turns.byMatch({ matchId })`, bounded by the 50-turn phase-1 match length.
- `convex/schema.ts:223-270` defines the full trace record shape: prompt text/hash, visible digest, scratchpad before, decision, scratchpad after, and LLM metadata.
- `convex/schema.ts:489-495` stores trace rows in the `turns` table indexed by `(matchId, turn)`.
- `convex/runMatch.ts:649-680` persists the ADR trace shape on every resolved turn.
- `convex/runMatch.ts:547-558` performs per-agent stateless decision calls for living agents in the turn.
- `convex/llm/azure.ts:425-443` sends Azure Responses API requests with `tools: [decisionTool]`, `tool_choice: "required"`, `parallel_tool_calls: false`, `reasoning.effort`, `store: false`, and a bounded output budget.

### Pass C - Persona Signal, Rule Substrate, and Validation

Verdict: **APPROVE**.

Persona differentiation is real and distributed across many runs, not a single outlier:

- Vulture extracted in 21 runs and camper in 20 runs, producing the top extraction rates of 42% and 40%.
- Rat extracted in 7 runs and recorded 0 kills, consistent with survival-first behavior rather than a dead persona.
- Duelist had kills in 30 runs, vulture in 35 runs, and camper in 21 runs; kill behavior is distributed across multiple aggressive/camping archetypes.
- Trader had speech in 50 runs and paranoid had speech in 50 runs; their high speech totals are persona-consistent and not one-match spikes (`maxSpeechInRun`: trader 48, paranoid 47).
- Opportunist equipped in 48 runs and vulture in 48 runs; loot/equip behavior is likewise distributed.

Persisted per-persona payload:

| Persona | Extraction rate | Kills | Equips | Speech |
|---|---:|---:|---:|---:|
| rat | 14% | 0 | 18 | 0 |
| duelist | 28% | 90 | 95 | 6 |
| trader | 24% | 10 | 51 | 1,583 |
| opportunist | 20% | 20 | 106 | 10 |
| paranoid | 26% | 8 | 5 | 1,449 |
| camper | 40% | 32 | 44 | 83 |
| sprinter | 24% | 9 | 67 | 39 |
| vulture | 42% | 70 | 118 | 85 |

Validation evidence:

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS (`tsc --noEmit`).
- `npm test`: PASS, 332 passed + 4 skipped. The skipped tests are the live-Azure-gated integration tests.

Rule-substrate evidence:

- `convex/engine/resolution.ts:21-46` documents the 8-phase resolver order matching `concept-spec.md` section 23.
- `convex/engine/resolution.ts:333-381` preserves the section 9 movement-plus-optional-action economy and section 11 overwatch path.
- `convex/engine/resolution.ts:504-521` applies attack damage in a simultaneous batch and then reveals attackers.
- `convex/engine/resolution.ts:523-549` emits chest equip success only after actual equip side effect, keeping `equips` grounded.
- `convex/engine/resolution.ts:600-633` forms corpses after death.
- `convex/engine/resolution.ts:700-729` handles turn-30 evac reveal and turn-50 extraction.
- `convex/engine/runStats.ts:185-225` aggregates kills, overwatch kill credit, and successful equip events from the trace ledger.
- `convex/engine/types.ts:94-106` keeps `CHARACTER_MAX_HP=50` as a shared phase-1 tuning constant, not a spec invariant.
- `convex/matches.ts:251-260` seeds new characters from `CHARACTER_MAX_HP`.
- `convex/runMatch.ts:193-205` uses the same HP constant as in-memory `maxHp`, preventing the Gate-2.5 dual-init drift.

## Issues

No blocking, medium, or low-severity issues found.

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| - | - | No Phase 1 completion issues identified. | Live Convex row, persisted payload recomputation, trace samples, harness log, and validation gates all pass. | Close Phase 1 North Star. |

## Spec / Guide Deviations

- None found against `mental-model.md` section 10, the Cucumber Closing Report scenario, `concept-spec.md` phase-1 substrate requirements, `docs/project/guides/azure-llm.md`, or `docs/project/guides/convex-backend.md`.
- The HP value tuning to `CHARACTER_MAX_HP=50` is not a spec deviation. `concept-spec.md` section 12 defines deterministic damage and a minimum floor but does not pin max HP; `mental-model.md` section 10 explicitly allows bounded prompt/value tuning to clear the report signal.
- AOP.UAT is not applicable here: Phase 1 has no UI/rendering layer, and the North Star explicitly targets agent-ergonomic Convex/query artifacts rather than user-facing observation.

## Decision Notes

- **Decision:** APPROVE. Phase 1 North Star is truly done and closeable.
- **No fix list:** There are no required code or documentation fixes to close Phase 1.
- **No new tuning requirement:** The review intentionally does not add persona aggression, balancing, rendering, or downstream feature requirements. The quantitative done-bar is met and further tuning is out of Phase 1 scope.
- **Canonical closure evidence:** Convex report `jd760kqja7sfwvt71mn0gdcexh8686jd`, `reportType=closing-50`, `matchIdsHash=64c2f318db35273a4e90ccff3bece75ba4f9d074668b82aa8468ba5b11324fd2`, `runCount=50`, `missingRunsForMatchIds=[]`, `meetsAllThresholds=true`.
