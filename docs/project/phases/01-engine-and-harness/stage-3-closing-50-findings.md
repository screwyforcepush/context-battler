# Stage-3 Closing-50 Report — Findings

Report date: 2026-05-07
Scope: Stage-3 closing 50-run evaluation pass per `mental-model.md` §10 done-bar.
Source commit at dispatch: `800115d` (Path A structural levers + WP14 reports.create wired into harness multi-run finalisation).

## Verdict — North Star Gate-3 Done-Bar

**PASS.** All six `mental-model.md` §10 thresholds met. The closing-50 report row is persisted in Convex and idempotent on `matchIdsHash`. The substrate is proven: an agent can query Convex and inspect any (run, agent, turn) to see what an agent saw, decided, and remembered.

## Run Dispatch Summary

| Field | Value |
|---|---|
| Runs dispatched | 50 |
| Concurrency | 10 |
| Reasoning | low |
| Harness command | `npm run harness -- --runs 50 --concurrency 10 --reasoning low` |
| Harness PID | 44270 |
| Log path | `/tmp/stage-3-rerun-1778194076.log` (4866 lines, 486,775 bytes) |
| Wall-clock start | 2026-05-07 22:47:56 UTC |
| Wall-clock end | 2026-05-07 23:06:02 UTC |
| Total walltime | 18m 06s |
| `run_start` events emitted | 50 / 50 |
| `run_end` events emitted | 50 / 50 |
| `run_failed` events emitted | 0 |
| `harness_error` / `FATAL` lines | 0 |
| `multi_run_summary` event emitted | 1 (line 4865) |
| `report_created` event emitted | 1 (line 4866) |
| Missing `runs` rows | 0 (`missingRunsForMatchIds: []`) |

Exit was clean — final two emitted events are `multi_run_summary` followed immediately by `report_created`, with no trailing error lines. PID 44270 confirmed dead by `kill -0` poll prior to inspection.

## Convex Persistence

| Field | Value |
|---|---|
| `reportId` | `jd760kqja7sfwvt71mn0gdcexh8686jd` |
| `reportType` | `closing-50` |
| `matchIdsHash` | `64c2f318db35273a4e90ccff3bece75ba4f9d074668b82aa8468ba5b11324fd2` |
| `runCount` | 50 |
| `metBar` | `true` |
| `meetsAllThresholds` (payload) | `true` |
| `missingRunsForMatchIds` | `[]` |
| `generatedAt` | 1778195162308 (2026-05-07 23:06:02 UTC) |

Verified by `npx convex run reports:byId '{"id":"jd760kqja7sfwvt71mn0gdcexh8686jd"}'` and `npx convex run reports:byMatchIdsHash '{"matchIdsHash":"64c2f318db35273a4e90ccff3bece75ba4f9d074668b82aa8468ba5b11324fd2","reportType":"closing-50"}'` — both returned the same row, confirming the (matchIdsHash, reportType) idempotency contract from `convex/reports.ts:381-391`.

The 50 dispatched matchIds are persisted in `matchIds[]` on the row and fully match the `multi_run_summary.matchIds` ordering in the harness log.

## Aggregate Stats (50 runs)

| Top-level metric | Value |
|---|---|
| Total kills | 205 |
| Total extractions | 109 |
| Total chest equips | 504 |
| Total speech events | 3 255 |
| `runsWithAtLeastOneKill` | 48 / 50 |
| `runsWithAtLeastOneExtraction` | 48 / 50 |
| `runsWithAtLeastOneEquip` | 50 / 50 |
| `runsWithAtLeastOneSpeech` | 50 / 50 |
| `personaExtractionSpread` (pp) | 27.999... ≈ 28pp |

## Per-Persona Breakdown

| Persona | extractionsCount / 50 | extractionRate | kills | equips | speechEvents |
|---|---|---|---|---|---|
| rat         |  7 | 0.14 |   0 |  18 |     0 |
| duelist     | 14 | 0.28 |  90 |  95 |     6 |
| trader      | 12 | 0.24 |  10 |  51 | 1 583 |
| opportunist | 10 | 0.20 |  20 | 106 |    10 |
| paranoid    | 13 | 0.26 |   8 |   5 | 1 449 |
| camper      | 20 | 0.40 |  32 |  44 |    83 |
| sprinter    | 12 | 0.24 |   9 |  67 |    39 |
| vulture     | 21 | 0.42 |  70 | 118 |    85 |

Spread = max(0.42, vulture) − min(0.14, rat) = 0.28 = **28 percentage points**.

Persona signal is intact and visibly differentiated: vulture and camper lead extractions; duelist and vulture dominate kills; trader and paranoid carry virtually all speech volume; rat extracts but never kills (its design intent — survive without engaging). No persona is a no-op.

## Threshold Verdict (per Cucumber Scenario 3 / §10 done-bar)

Each threshold below is the verbatim §10 cutoff applied to the persisted `payload` field on the Convex row.

- Extraction rate: **48 / 50 (96.0%) — PASS** (≥ 30% required, ≥ 15 / 50 runs).
- Kill rate: **48 / 50 (96.0%) — PASS** (≥ 80% required, ≥ 40 / 50 runs).
- Equip rate: **50 / 50 (100.0%) — PASS** (≥ 80% required, ≥ 40 / 50 runs).
- Speech rate: **50 / 50 (100.0%) — PASS** (≥ 50% required, ≥ 25 / 50 runs).
- Persona extraction-rate spread: **28pp — PASS** (≥ 15pp required; vulture 42% − rat 14%).
- Engine 50 consecutive runs no crashes / invalid states: **0 run_failed, 0 harness_error, 0 missing runs rows — PASS**.

**6 / 6 thresholds met. Overall: PASS.**

## Failed Runs

None. `run_failed` count = 0; `missingRunsForMatchIds` = `[]`; harness exited cleanly after emitting `report_created`.

## Fallback Rate

The harness log contains zero `fallback`, `agent_decision_fallback`, `llm_validation_fallback`, or any matching event. Decision and validation paths held cleanly across 50 runs at `--reasoning low` against the Azure deployment. (The harness emits validator/fallback events as named events when they occur — the absence of any matching line in 4866 log lines is the signal.)

## Persona-Level Outliers

- **rat** is the only persona with 0 kills across all 50 runs. This is consistent with its design (survival-first, avoid engagement) and supported by its 14% extraction rate — rat extracts when geometry allows, never engages. Not a defect.
- **paranoid** has only 5 equips total but 1 449 speech events and 13 extractions across 50 runs. Confirms the post-Gate-2.5 paranoid persona edit (occupy evac-corner cover and overwatch the approach) is producing the intended low-equip / high-speech / corner-camp behavior; its 26% extraction rate is mid-pack.
- **trader** carries 1 583 speech events — half the total speech volume. Negotiation-heavy persona signal as designed.
- **vulture** + **duelist** account for 160 / 205 kills (78%). Aggressive personas dominate killing as expected.
- No persona has 0 extractions, 0 equips, or 0 speech across all 50 runs in aggregate — every persona registered on at least one of the §10 axes.

## Engineering Hygiene (AOP.VALIDATE @ HEAD)

Run after harness exit, before commit:

| Gate | Result |
|---|---|
| `npm run lint` | PASS (clean, no output) |
| `npm run typecheck` | PASS (clean, no output) |
| `npm run build` | PASS (`tsc --noEmit`, clean) |
| `npm test` | PASS — 332 passed, 4 skipped (21 files passed, 1 skipped) |

The 4 skipped tests are the live-Azure integration tests in `tests/llm/integration.test.ts` (gated on `LIVE_AZURE` env, expected skip in CI/local).

## Phase 1 North Star — Status

The Phase 1 North Star objective is **MET**:

- 50-run closing simulation report runs cleanly end-to-end (50 / 50, 0 failures, 18:06 walltime).
- Report persists to Convex (`reports.create` idempotent on `matchIdsHash`, row id `jd760kqja7sfwvt71mn0gdcexh8686jd`).
- Every threshold in the §10 / Cucumber "Closing report" scenario is met — extraction 96%, kills 96%, equips 100%, speech 100%, spread 28pp, 0 crashes.
- Lint / typecheck / build / test gates all green at HEAD.
- An agent can query Convex and inspect any (run, agent, turn) trace via `runs`, `matches`, `turns`, `characters`, and the new WP14 `reports` row.

The substrate is proven. Phase 1 closing condition cleared.
