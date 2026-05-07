# Phase 1 — Closure Record

> Single-file handoff for phase 2 planning. Records what was built, what
> proves it, what is intentionally absent, and what to carry into phase 2.
> Closure date: 2026-05-07. Source commit at close: `7740060`.
>
> This is a closure RECORD, not a retrospective and not a phase 2 plan.

---

## 1. What we set out to build (North Star)

> Phase 1 — build the context-battler simulation engine + multi-run
> evaluation harness, proven by a 50-run simulation report persisted to
> Convex that meets the quantitative done-bar in
> `docs/project/spec/mental-model.md` §10. The substrate is proven when
> a 50-run closing report runs cleanly end-to-end, persists to Convex,
> meets every threshold in the Cucumber "Closing report" scenario, and
> any agent can query Convex and inspect any (run, agent, turn) to see
> exactly what an agent saw, decided, and remembered.

The substrate is the precondition for every downstream phase. Without it,
rendering / player input / prompt-injection items / progression / public
leaderboards are all premature. With it, the rest of the project becomes a
tractable layered build.

---

## 2. Done-bar verdict (Cucumber Scenario 3 / mental-model §10)

Every threshold below is computed from the persisted Convex report row.
No threshold was relaxed; all are verbatim from `mental-model.md` §10.

**Canonical source:**
- `reportId` = `jd760kqja7sfwvt71mn0gdcexh8686jd`
- `reportType` = `closing-50`
- `matchIdsHash` = `64c2f318db35273a4e90ccff3bece75ba4f9d074668b82aa8468ba5b11324fd2`
- `runCount` = 50
- `metBar` = `true`
- `missingRunsForMatchIds` = `[]`
- `generatedAt` = 2026-05-07 23:06:02 UTC

| § Threshold | Required | Measured | Verdict |
|---|---|---|---|
| ≥ 30% runs end with at least one extraction | ≥ 15 / 50 | 48 / 50 (96%) | PASS |
| ≥ 80% runs contain at least one kill | ≥ 40 / 50 | 48 / 50 (96%) | PASS |
| ≥ 80% runs contain at least one chest equip | ≥ 40 / 50 | 50 / 50 (100%) | PASS |
| ≥ 50% runs contain at least one speech event | ≥ 25 / 50 | 50 / 50 (100%) | PASS |
| Persona extraction-rate spread ≥ 15 pp | ≥ 15 pp | 28 pp (vulture 42% − rat 14%) | PASS |
| 50 consecutive runs no crashes / invalid states | 0 failures | 0 `run_failed`, 0 `harness_error`, 0 missing rows | PASS |

**6 / 6 thresholds met. Verdict: PASS.**

Engineering hygiene at HEAD (`7740060`): `npm run lint`, `npm run typecheck`,
`npm run build` (`tsc --noEmit`), and `npm test` all green; 332 tests pass +
4 skipped (the skipped tests are `LIVE_AZURE`-gated integration tests in
`tests/llm/integration.test.ts`).

Detailed run dispatch evidence (harness PID, log path, walltime, JSONL
event counts) lives in `stage-3-closing-50-findings.md` alongside this
file. The Gate-3 completion review records the independent verdict.

---

## 3. Substrate-introspection proof

The North Star DONE-WHEN clause requires that "an agent can query Convex
and inspect any (run, agent, turn) to see exactly what an agent saw,
decided, and remembered." This is delivered by `convex/turns.ts`:

```ts
// Worked example: agent investigating Player_4's decision on turn 23
// of any matchId in the closing-50 row's matchIds[].
const record = await convex.query(api.turns.getAgentTurn, {
  matchId,                  // any of the 50 matchIds on report jd760...
  turn: 23,
  characterId,              // Player_4's characters _id
});
// record contains the full self-contained ADR §7 shape:
//   record.input.systemPromptText  + .systemPromptHash
//   record.input.personaPromptText + .personaPromptHash
//   record.input.visibleStateDigest          (the tactical digest)
//   record.input.scratchpadBefore
//   record.decision                          (ParsedDecision union)
//   record.scratchpadAfter
//   record.llm.{responseId,callId,rawArguments,usage,latencyMs,
//               httpStatus,fellBackToSafeDefault,failureReason?,
//               validatorReason?,httpBodyExcerpt?}
```

Per ADR §7 the prompt text is captured per-row (not pulled from
`personas/` at read time), so post-WP15 persona edits do not invalidate
historical traces. `rawArguments` preserves the model's un-validated tool
output for failure-mode debugging. `convex/turns.ts:byMatch` returns all
50 turn rows for a match if a reviewer wants the full timeline.

---

## 4. Per-persona signal (50-run aggregate)

| Persona | extractions / 50 | extractionRate | kills | equips | speechEvents |
|---|---:|---:|---:|---:|---:|
| rat         |  7 | 14% |   0 |  18 |     0 |
| duelist     | 14 | 28% |  90 |  95 |     6 |
| trader      | 12 | 24% |  10 |  51 | 1 583 |
| opportunist | 10 | 20% |  20 | 106 |    10 |
| paranoid    | 13 | 26% |   8 |   5 | 1 449 |
| camper      | 20 | 40% |  32 |  44 |    83 |
| sprinter    | 12 | 24% |   9 |  67 |    39 |
| vulture     | 21 | 42% |  70 | 118 |    85 |

**Differentiation evidence.** The 28 pp spread (vulture 42% − rat 14%) is
nearly 2× the §10 threshold of 15 pp. Each persona registers on a distinct
axis: vulture and camper lead extractions; duelist and vulture together
account for 78% of all kills (160 / 205); trader and paranoid carry 93%
of speech volume (3 032 / 3 255); rat extracts seven times across 50 runs
without ever engaging — its design intent. No persona is a no-op on any
of the four §10 axes in aggregate.

---

## 5. Architecture artifacts inventory

Paths and one-line purposes — no invented descriptions; pulled from file
headers and ADR-locked boundaries. Full rationale lives in
`architecture-decisions.md`.

- **`convex/engine/*`** — pure-function game kernels (zero Convex imports
  per ADR §1): `distance.ts` (Chebyshev), `vision.ts`, `hiding.ts`,
  `movement.ts`, `combat.ts`, `loot.ts`, `affordances.ts`, `validation.ts`,
  `lastKnown.ts`, `map.ts`, `types.ts`, plus the 8-phase `resolution.ts`
  composed turn resolver and the `runStats.ts` / `reportStats.ts`
  aggregators.
- **`convex/runMatch.ts`** — the per-match scheduled action chain (WP10):
  reads state, fans out 8 `callDecisionTool` invocations, validates,
  resolves the turn, persists the `turns` row per ADR §7, patches
  `characters` + `worldState`, and either chains the next turn via
  `scheduler.runAfter(0, ...)` or marks the match terminal and schedules
  `runs.aggregate` (WP10 → WP12 boundary).
- **`convex/llm/*`** — Azure tool-use wrapper (`azure.ts`), single
  `decide_turn` tool definition + Zod parser (`decisionTool.ts`),
  tactical-digest input builder (`inputBuilder.ts`), terse system prompt
  (`systemPrompt.ts`), persona registry (`personas.ts`). `azure.ts` never
  throws — every failure mode resolves to a per-agent safe default with a
  populated `failureReason` (ADR §4).
- **`harness/run.ts`** — local TS CLI fan-out (WP11): parses `--runs`,
  `--concurrency`, `--reasoning`; bounded-concurrency triggers
  `matches.start`; polls `matches.status` to terminal; emits JSONL events
  (`run_start` / `poll` / `run_end` / `multi_run_summary` /
  `report_created` / `harness_error`); on finalisation calls
  `reports.create` with the completed matchIds.
- **`convex/reports.ts`** — `reports.create` mutation (WP14): reads each
  matchId's `runs` row, calls the pure `reportStats` aggregator, writes
  a single `reports` row. Idempotent on `(matchIdsHash, reportType)`
  tuple via SHA-256 of sort-then-comma-joined matchIds; re-fires return
  the existing row id. Plus `reports.byId` and `reports.byMatchIdsHash`
  query helpers.
- **`convex/schema.ts`** — six tables (ADR §6): `matches`, `characters`,
  `turns` (the per-(run, agent, turn) trace ledger), `worldState`,
  `runs` (per-match aggregate, owned by WP12), `reports` (multi-run
  aggregate, owned by WP14). `PersonaId` is a locked kebab-case literal
  union shared across every consumer. Item stat tiers (weapons / armour /
  consumables, `MIN_DAMAGE_FLOOR = 5`) and `CHARACTER_MAX_HP` live in
  `convex/engine/types.ts` so the engine kernels and Convex modules share
  one source of truth.

Supporting artifacts: `maps/reference.json` (hand-authored 100×100 map
descriptor — walls / cover / chests / 8 spawns / 3×3 evac at centre),
`personas/*.md` (8 brief behavioural prompts, kebab-case filename =
`PersonaId` literal), `convex/_data/personas.ts` + map data inlined for
Convex bundling, `harness/{analyze-match,cluster-failures,inspect-attacks,
inspect-equipped,inspect-http}.ts` (engineer-ergonomic diagnostic
helpers — JSONL/grep-friendly, not human dashboards, per
`feedback_observability_targets_agents`).

---

## 6. Out of scope — reaffirmed for phase 2

Phase 1 deliberately did NOT build any of the following, per North Star
§11. This list is a guard against phase-2 scope drift:

- No rendering layer.
- No player input / UI.
- No public or player-facing leaderboard. (The closing report is
  evaluation-only, persisted to Convex for agent introspection.)
- No prompt-injection item naming / cursed item text.
- No progression / RPG layer.
- No procedural map generation. (Phase 1 used the same hand-crafted
  reference map every run.)
- No cross-run learning.
- No mid-run prompt editing.
- No post-run AI coaching / auto-postmortem.
- No daily-seed mode.

Each of these is a candidate for a downstream phase, not a missing piece
of phase 1.

---

## 7. Open follow-ups for phase 2

Observations from the 50-run closing report. Factual, non-prescriptive —
phase 2 may treat any of these as in-scope, deferred, or accepted as-is.

- **rat: 0 kills across all 50 runs.** Consistent with rat's design
  intent (survival-first, avoid engagement); 14% extraction rate proves
  the persona is not a no-op. If phase 2 wants symmetric combat
  attribution across all 8 personas it will need to revisit either the
  rat persona or the engagement-trigger lever.
- **trader speech-volume dominance.** Trader emitted 1 583 speech events
  on 50 runs, ~half the total speech volume. Persona signal as designed,
  but a rendering / replay layer in phase 2 may want speech sampling or
  filtering to keep a watchable feed.
- **paranoid low-equip pattern.** Paranoid logged 5 equips across 50 runs
  vs 1 449 speech events and 13 extractions — confirms the post-Gate-2.5
  evac-corner camp behaviour is producing the intended low-equip /
  high-speech / mid-pack-extraction shape. Worth noting if phase 2
  changes evac geometry.
- **HP and spawn-radius tunings landed during WP15.** Phase 1 closes with
  `CHARACTER_MAX_HP = 50` (down from 100) and spawn radius ~20 (down
  from ~45). Both are in `convex/engine/types.ts` / `maps/reference.json`
  and surfaced during Gate-2.5 as structural levers. Phase 2 inheriting
  the substrate inherits these values.
- **HTTP 400 / content-filter sensitivity.** The original "betrayer"
  archetype tripped Azure content moderation persistently and was
  archetype-swapped to "opportunist" in WP10.5 Phase E.1 per North Star
  §4 ("personas illustrative, not prescribed"). Phase 2 personas with
  aggressive deception language should expect similar moderation
  behaviour.
- **Reasoning level held at `low` for the closing run.** A medium-effort
  probe was attempted in WP15 and retired. Phase 2 may revisit if
  persona signal changes shape.

---

## 8. Cross-references

Phase 1 documents that together form the full record:

- `README.md` — phase goal / scope / gates / dependency map.
- `architecture-decisions.md` — 8 ADRs (runtime, test stack, harness
  shape, Azure wrapper, map descriptor, schema, trace shape, concurrency).
- `work-packages.md` — 15 WPs (WP4 vacated in v1.2).
- `de-risking.md` — Bootstrap Checklist B + Measurement C, reasoning
  policy.
- `plan-review.md`, `gate-1-review.md`, `gate-2-5-review.md` — review
  history.
- `wp10-5-phase-{a,e,e2-and-wp12-stage2}.md`, `wp15-tuning-findings.md`
  — substrate-tuning trajectory.
- `stage-3-closing-50-findings.md` — Stage-3 dispatch + verdict
  evidence.
- `docs/project/spec/mental-model.md` §10 — done-bar (read-only; the
  why layer).
- `docs/project/spec/concept-spec.md` — the rules.
- `docs/project/guides/azure-llm.md`, `docs/project/guides/convex-backend.md`
  — operational guides.
