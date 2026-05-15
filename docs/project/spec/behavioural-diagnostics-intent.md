# Behavioural Diagnostics — Intent Anchor

> User-hand-shaped intent for the behavioural-diagnostics slice. Sibling to
> `per-turn-context-intent.md`. The "why and shape" — implementation owns the how.

## Motivation

The phase-6 closing report exposed a metric-vs-substrate mismatch (the "no-op
rate" conflating armed-stance pauses with true do-nothing). Stepping through
replays manually does not scale to seeing *patterns* in agent decisions —
curious player strategies, unusual combo distributions, dead-field usage,
persona-coherence drift. The substrate now captures rich per-turn decisions;
the diagnostic surface should let those decisions answer questions like:

- *Is anyone using `counter + attack`? That's a curious play — you'd think
  aggressive overwatch fits better when you're already attacking.*
- *Are agents declaring `move:relative` when `move:toward<entity>` would do?*
- *Is `consume:speed` ever paired with `position:overwatch` (wasted speed)?*
- *Does paranoid actually pivot at turn 30 reveal, or stay in cover?*

These are pattern questions, not single-turn questions. The replay UI's
turn-detail modal answers the single-turn case; this slice answers the cohort
case.

## Scope (this slice)

- **Input set:** last N completed matches (max 20), N supplied at CLI / UI
  invocation. No persistence of pre-computed aggregates this slice — recompute
  on demand from the persisted traces.
- **Two consumers, one data path:**
  - **CLI** (machine-introspection per
    `feedback_observability_targets_agents`) — markdown / JSON output for
    agent and human review.
  - **Dashboard tab in `apps/replay`** (user-introspection) — simple charts +
    drill-down lists. Pick whatever chart lib fits; minimal styling.
- **Drill-down → existing modal.** Lists are clickable and deep-link to the
  replay UI's existing turn-detail modal (full LLM input + reasoning + raw
  arguments + decision English). No new modal. Aligns with pillar 7
  (state is the contract).
- **Pre-requisite landed in the same slice:** the Convex 16 MB per-function
  read-budget unblock (see §6 below). Without it, the diagnostics CLI / UI
  cannot pull >N matches worth of traces.

Backward compatibility before phase-7 closing-20 is not required.

## Three metric families

### 1. Critical fails

Per-record introspection of the LLM-call → engine-validation pipeline.

- Fallback rate, by `failureReason` (`http_non_200`, `json_parse_failed`,
  `schema_validation_failed`, `content_filter_blocked`, `no_function_call`,
  `multiple_function_calls`, `abort_timeout`, plus the field-scoped
  validator-zero pseudo-bucket).
- HTTP retry success rate (the single existing retry on `{429, 5xx}` — did it
  recover, or did the second attempt also fail?).
- `usage.output_tokens` proximity to `max_output_tokens` cap — histogram
  `<50% / 50-80% / 80-95% / ≥95%` (≥95% is the leading-suspect bucket for
  truncated-reasoning turns).
- Per-field validator rejection breakdown (which of `use` / `position` /
  `action` / `say` / `scratchpad` is rejecting most).
- Persona × failure-reason cross-tab.

### 2. Game-mechanic sanity

Per-resolution counters. Already partially aggregated in phase-6 payload,
generalised here.

- Attack outcomes: landed / missed / out-of-range / blocked-by-cover.
- Overwatch fires: offensive (`triggeredByMovement:true`) vs defensive (else).
- Counter retaliations: fired vs primed-but-no-attack-incoming.
- Crate funnel: crate-seen → loot-action → opened → equipped.
- Corpse funnel: corpse-seen → loot-action → looted vs drained-repeat.
- Consume events: `heal` / `speed` counts, plus wasted-consume (heal at full
  HP; speed without same-turn movement).
- Speech events: count, mean text length, addressee-fanout (`heardBy.length`).
- Deaths and extractions (per persona, per match).
- Wall-blocked moves (`resolution.moves[].blockedBy === "wall"`).
- Declared `dist` vs actual moved distance — divergence = engine-side cap.
- Damage-feed delivery audit — generalise the phase-6 sampler to a full count.

### 3. Behavioural distribution (the interesting one)

#### Top-level totals

- `use` literal distribution × persona.
- `position.kind` distribution × persona × turn-phase.
- `action.kind` distribution × persona × turn-phase.
- `say` non-null rate × persona (trader should top, rat should bottom).
- Scratchpad churn: % records where `scratchpadBefore !== scratchpadAfter`,
  length distribution, never-written-by persona.
- `direction.kind` distribution: compass vs target-relative ratio per persona.
- `dist` histogram per direction kind.

#### Contextual combos

Cross-field combinations, flagged when the combination tells a story. None of
these is by-definition wrong; the dashboard makes them visible so the user can
spot curious plays.

| Combo | What it tells you |
|---|---|
| `move + attack` | Range-awareness — did declared move endpoint actually reach attack range? |
| `move + loot` | Same — did endpoint reach loot range? |
| `overwatch + attack` | Phase-6 first-class combo. Deliberate attack lands AND overwatch arms. |
| `counter + attack` | Curious — why retaliate-if-attacked instead of fire-on-movement after committing to an attack? |
| `overwatch + loot` | Crouching at crate while primed-on-movement. |
| `counter + loot` | Same flavour. |
| `move:dist=0 + action≠none` | Declared move with zero distance — schema gap or fallback artifact? |
| `overwatch/counter + say` | Talking while primed. |
| `move + consume:speed` | Sensible — speed before sprint. |
| `non-move + consume:speed` | Wasted speed buff. |
| `consume:heal at full HP` | Wasted heal. |
| `say + action:attack same target` | Threatening the agent you're hitting (deception data). |
| `move:toward X + action:attack Y` (X ≠ Y) | Moved toward one, hit a different — coherent if Y in range from endpoint, weird otherwise. |
| `move:toward X + action:loot X` | Pair this with distance-to-X to see expected-reach behaviour. |
| `move:away X + say:non-null` | Yelling while retreating. |

#### Cross-cuts (axes applied to everything above)

- **Persona** (obvious).
- **Turn-phase**: `1–29` (pre-evac), `30–49` (evac revealed), `=50` (final).
  Behaviour should pivot at the turn-30 reveal — if it doesn't, that's a
  finding.
- **Visibility state**: was any enemy visible this turn? Was the agent
  damaged last turn (damage feed present)?
- **Equipped state**: armed/unarmed × armour-tier × consumable-present.

#### Saw-enemy-and-did-nothing carve-out

A specific sub-bucket: agent records where an enemy was visible AND the
decision was a no-op. This is the subset that would falsify the "intentional
hold" reading from the no-op survey.

## Drill-down

Every aggregate row is clickable; opens the entry list (matchId, turn,
persona). Each list item deep-links to the existing replay turn-detail modal
at `#/match/<matchId>?turn=<n>&character=<persona>`. No new modal, no new
inspector — the replay UI already shows full LLM input + reasoning + raw
arguments + decision English (PHASE-6-CLOSURE §7).

## What this slice is NOT

- Not a persisted report row in the `reports` table. Recompute on demand.
- Not a substrate change to per-turn capture. The diagnostic surface reads
  whatever the engine already persists.
- Not a behaviour-tuning pass. The point is to *see* behaviour; tuning is a
  separate slice.
- Not consumer-facing analytics. Same audience as the phase-2 replay overseer
  (the user + machine-introspection by future agents).

## Pre-requisite: Convex 16 MB read-limit unblock

`convex/reports/phase6.ts:computeAndPersistPhase6Report` reads all 20 matches'
turns + characters + agentRecords in a single mutation handler. Persisted
agentRecords carry the full per-turn LLM context (systemPromptText,
personaPromptText, visibleStateDigest, scratchpadBefore, composedUserMessage,
plus llm.reasoning, llm.rawArguments, llm.httpBodyExcerpt). At ~10 KB per
agentRecord × 8 agents × ~40 turns × 20 matches ≈ ~60+ MB → over budget.
Phase-6's workaround was local export + local compute + small-payload persist
through `persistComputedPhase6Report`.

The diagnostics view needs to read traces across N matches every recompute.
The unblock approach (decided in the implementing assignment, not here):

- Most likely: **slim Convex query** that returns a per-match lean
  projection — agentRecords stripped of the heavy text fields the diagnostics
  view does not need (systemPromptText / personaPromptText /
  visibleStateDigest / scratchpadBefore / composedUserMessage / reasoning /
  httpBodyExcerpt / rawArguments). The diagnostics view never aggregates
  full LLM input; that's drill-down territory and is fetched on click from
  the existing per-turn query.

The lean per-match projection is ≲ 200 KB; 20 matches is ≲ 4 MB,
comfortable under budget even if pulled in a single fan-out from the client.

Schema change is acceptable per `project_poc_schema_wipe_acceptable` if the
implementation prefers a sibling lean-projection field over a query-time
projection, but the simpler answer is the query-time projection.

## Done bar

- CLI runs over `last N ≤ 20` completed matches and emits machine-readable
  output covering the three metric families above.
- Dashboard tab in `apps/replay` renders the same metrics with simple
  charts; aggregate rows / entries are clickable and deep-link to the
  existing replay turn-detail modal.
- The Convex read-limit unblock is in place: the diagnostics CLI / dashboard
  pulls trace data across 20 matches without hitting the 16 MB per-function
  cap.
- No regression to the phase-6 closing-20 metrics (same numbers reproducible
  via the new path).

## Out of scope

- Persisted aggregate rows / new `reports.reportType`.
- Behaviour tuning of personas.
- Substrate changes to what the engine captures.
- Pre-computed materialised views / write-time aggregation hooks.
- New drill-down modal.
- Consumer-facing analytics.
