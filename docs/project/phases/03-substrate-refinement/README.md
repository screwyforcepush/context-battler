# Phase 03 — Substrate Refinement

> Goal: rebuild the per-turn LLM substrate (digest, system prompt, action
> schema, engine semantics) so agents can reason about *outcomes* and the
> replay UI can show their minds. Close with 10 Convex-persisted runs that
> meet an enhanced acceptance bar.

Phase status: planning. Phase 2 closure record:
`docs/project/phases/02-replay-overseer-v0/phase-2-closure.md`. Phase 3's
why-layer is anchored in `mental-model.md` §11 (substrate-refinement
paragraph, added 2026-05-08).

---

## 1. Why this phase

Stepping through replays in the phase-2 overseer revealed that the
substrate is **structurally insufficient** for pillar 4 (scratchpad as
explainability):

| Symptom (visible in replay) | Root cause |
|---|---|
| Agents take damage but never reference the attacker | digest carries no record of incoming attacks |
| Agents loot drained corpses repeatedly | `resolution.ts` silently skips empty-corpse loot — no trace entry → digest drops the signal |
| Agents get stuck on walls | `computeVisibleEntities` never emits walls (vision.ts head-note acknowledges this) |
| `overwatch_priority` decoration ignored by engine | engine picks nearest-visible; the field is theatre |
| 84.5% safe-default rate (phase 1) patched with `Affordances:` block | band-aid for a disjointed prompt design — 5 input slots authored independently rather than as one rolled context |
| Token counts visible in trace, reasoning text absent | reasoning items not captured from Azure responses |
| Replay expand-modal has 5 tabs | the user wants the raw dump, not five componentised surfaces |

The user has **endorsed POC-mode posture**: schema/db wipe is acceptable,
no migration shims required (memory:
`project_poc_schema_wipe_acceptable`). The locked design decisions in the
North Star are NOT to be re-litigated.

This phase does NOT change the design pillars. It makes pillar 4
attainable — the scratchpad alone cannot preserve what the engine never
told the agent.

## 2. What "done" means (closing condition)

Ten Convex-persisted runs against the dev deployment, accessible from the
phase-2 replay UI's match picker, each fully steppable, with a persisted
closing-10 report row that meets the enhanced acceptance criteria in §5.

**Hard gates:**

- `npm run lint && npm run typecheck && npm run build && npm test` — all
  green at root and in `apps/replay/`.
- The `convex schema` push succeeds against the dev deployment after a
  full database wipe (POC-mode break). Migration shims are explicitly
  forbidden.
- The user can open any of the closing-10 runs in the replay UI and read
  any agent's full LLM input + reasoning text + tool call object for any
  turn from the collapsed-to-raw-pane expand modal.

## 3. Scope (what's in)

**Cucumber surface** (mirrors the North Star, condensed):

```gherkin
Feature: Substrate refinement — outcome attribution + clean schema + raw replay

  Scenario: Agent reasons about outcomes from the previous turn
    Given an agent took 20 damage from Player_3 last turn
    And moved 3 SW only to be blocked by a wall
    When the agent receives its next-turn input
    Then the input contains a "Last turn (you):" line including
         "moved 3 SW → hit wall, Player_3 attacked you (20 dmg)"
    And the agent can scratchpad-update referencing the outcome

  Scenario: Walls are visible and routable
    Given a wall sits at (40,34) and the agent stands at (40,33)
    When the agent receives its next-turn input
    Then "Wall_40_34, dist 1 S" appears in the Visible block

  Scenario: Drained corpses stop attracting repeat loot attempts
    Given Corpse_Player_5 has had its last item looted last turn
    When another agent targets the now-empty corpse
    Then resolution.actions[] contains result="empty" (or equivalent)
    And the empty corpse is suppressed from Visible (or marked [drained])

  Scenario: Overwatch stance is structured, not decorative
    Given an agent commits primary="overwatch", overwatch_stance="defensive"
    And three attackers strike it during simultaneous resolution
    When the engine resolves the turn
    Then the defensive overwatcher counter-fires once per attacker
         (bounded by weapon range)
    And resolution.actions[] shows mutual-damage entries
    And `overwatch_priority` no longer exists in the schema

  Scenario: Loot/interact unified into a single action
    Given an agent's decision contains action.kind="loot",
          targetId="chest_005"
    When the engine resolves the action
    Then the chest is opened and contents auto-equipped
    And the same kind="loot" with targetId="Player_5" loots the corpse
    And action.kind="interact" no longer exists in the schema

  Scenario: System prompt teaches the digest's shape
    When the agent reads its input
    Then the system prompt explains how to interpret each Visible bullet
    And the system prompt teaches the action grammar
    And there is NO `Affordances:` block, NO `Heard (last turn):` block,
        NO separate `Last-known:` block, NO separate `Evac:` block

  Scenario: Reasoning text is captured for replay introspection
    Given an Azure per-turn call returns reasoning items
    When the engine persists the turn record
    Then the reasoning text is stored on the agentRecord
    And the replay UI's raw-pane shows it

  Scenario: Replay UI surfaces raw substrate
    Given the user opens an agent's expand modal
    When the modal renders
    Then it shows three sections: full LLM input (system + user message),
         reasoning text, tool call JSON
    And the previous five-tab structure is gone

  Scenario: Final closure — 10 runs the user can step through
    When the user kicks off a 10-run harness pass
    Then 10 matches complete with no crashes
    And each match is reachable via the replay UI's match picker
    And the closing-10 metrics meet the enhanced acceptance bar (§5)
```

**Concrete in-scope deliverables:**

- **Schema break (POC, no migration).**
  - Unify `interact` + `loot` into a single `loot` action with a single
    `targetId: string`. Engine dispatches by id namespace.
  - Delete `overwatch_priority`. Add `overwatch_stance: "offensive" |
    "defensive"`. Required when `primary === "overwatch"`, null
    otherwise.
  - Add `reasoning: string | null` to `agentRecord.llm` for captured
    reasoning text.
- **Engine fixes** (all in `convex/engine/`):
  - `vision.ts` — emit walls within vision range.
  - `resolution.ts` — drained-corpse trace entry; defensive overwatch
    counter-fire pass; offensive overwatch first-in-range; loot
    dispatch by id namespace.
  - `affordances.ts` — DELETE entire module after digest rebuild.
- **Per-turn input rebuild** (`convex/llm/`):
  - `inputBuilder.ts` — full digest rebuild per North Star §1; new
    `Last turn (you):` line; observation brackets per Visible bullet;
    drop `Affordances:`/`Heard:`/`Last-known:`/`Evac:` sections; evac
    appears as a singleton in Visible; "in evac zone" flag on the You:
    line once revealed.
  - `systemPrompt.ts` — full rewrite as schema teacher.
- **Replay UI raw-pane** (`apps/replay/src/components/`):
  - `ExpandModal.tsx` — collapse 5 tabs to a single raw-dump pane with
    three sections (full LLM input, reasoning text, tool call JSON).
  - `decisionEnglish.ts` — adapt to unified loot vocabulary,
    drained-corpse outcome, overwatch stance display.
  - `TurnFeed.tsx` — minor: stance display in inline expansion;
    reasoning indicator (icon/length) if present.
- **Persona retune** (`personas/*.md`) — minor edits if the new prompt
  shape changes how personas are framed (likely small; current personas
  don't reference internal vocab like `interact`/`Affordances`).
- **Closing-10 harness pass + persisted report** (`harness/run.ts`,
  `convex/reports.ts` if a new `reportType` is needed).

## 4. Hard out of scope

- **Procedural map generation.** Phase-1 deferred. `maps/reference.json`
  remains the only map.
- **Public spectator / consumer renderer / fog of war.** Later phase.
  Phase-3 is still personal-overseer-only.
- **Cursed-item flavour text or prompt-injection content authoring.**
  Phase 3+. Moderation layer is a real constraint and should not be
  load-tested here.
- **Player auth, accounts, leaderboards.**
- **Live (in-progress) match streaming.** Completed-match replay only.
- **Migration shims, dual-shape compatibility, deprecation warnings.**
  POC-mode break is endorsed by the user.
- **Large new vocab on the renderer's grid layer.** Wall and evac
  rendering is already in `Grid.tsx`; this phase touches the *digest*
  emission of walls (engine), not the grid's wall layer (already there).
- **Reasoning model upgrade.** `reasoning.effort` stays at "low" (the
  phase-1 default). Tuning is out of scope.

## 5. Acceptance criteria — enhanced closing-10

**Carry-over from phase 1, scaled to 10 runs:**

| Metric | Threshold |
|---|---|
| Runs ending with ≥1 extraction | ≥ 30% (≥ 3 of 10) |
| Runs containing ≥1 kill | ≥ 80% (≥ 8 of 10) |
| Runs containing ≥1 chest equip | ≥ 80% |
| Runs containing ≥1 speech event | ≥ 50% |
| Persona extraction-rate spread (max−min, 8 personas) | ≥ 15 pp |
| 10 consecutive runs, no crashes / invalid states | required |

**New metrics specific to substrate refinement:**

| Metric | Threshold | Source |
|---|---|---|
| Fellback-to-safe-default rate | ≤ 10% across all per-turn calls | `agentRecord.llm.fellBackToSafeDefault` count |
| Wall-blocked move rate (no-op-due-to-wall) | ≤ 2% of move attempts | derived: `resolution.moves[]` where `from === to` AND adjacent wall in intended direction |
| Drained-corpse repeat rate (same agent, consecutive turns) | ≤ 1% of loot attempts | `resolution.actions[]` with kind="loot" + result="empty" |
| Runs containing ≥1 successful corpse-loot event | ≥ 50% | `resolution.actions[]` with kind="loot" + result="looted" |
| Defensive overwatch counter-fire — at least one trace entry across the 10 runs | > 0 | `resolution.actions[]` with `kind="overwatch"` and `fromOverwatch=true` AND defensive stance attribution |
| Offensive overwatch fire — at least one trace entry across the 10 runs | > 0 | same with offensive stance |
| Outcome-attribution loop (turn N+1 references damage taken in turn N) | ≥ 50% (best-effort heuristic) | derived: agent took damage in turn N AND turn N+1 decision references attacker (attack_back / away_from_entity / heal / scratchpad note containing attacker id) |
| Reasoning text persisted on completed (non-fallback) per-turn calls | ≥ 80% **OR** documented why-not | `agentRecord.llm.reasoning !== null` count |

The reasoning-text threshold is **contingent on the Azure response shape**.
Perplexity research surfaced that Azure Responses API typically does NOT
expose reasoning text in `output[]` — only `usage.output_tokens_details
.reasoning_tokens` counts. WP-A's first deliverable is a probe to determine
the actual shape on the project's deployment. If reasoning text is
unavailable, the de-risking branch in §6 takes effect: add a `rationale`
string field to the decision schema that the model fills in alongside the
tool call. See `de-risking.md` D-P3-1.

## 6. Architecture at a glance

The architecture-§1 three-slice contract is preserved. Engine and renderer
still meet only at State.

| Slice | What changes this phase |
|---|---|
| LLM | New `systemPrompt.ts`, full digest rebuild in `inputBuilder.ts`. Schema break in `decisionTool.ts`. Reasoning extraction in `azure.ts` (or alternative `rationale` field). |
| State | Schema diff: drop `overwatch_priority`, drop `interact` action arm, replace `loot.targetCorpseId` with `loot.targetId`, add `overwatch_stance`, add `reasoning` to `agentRecord.llm`. POC schema-wipe — no migration. |
| Engine | `vision.ts` wall emit; `resolution.ts` drained-corpse trace + defensive overwatch counter-fire + offensive first-in-range + loot dispatch. `affordances.ts` deleted. |
| Renderer | `ExpandModal.tsx` collapse. `decisionEnglish.ts` vocab adapt. `TurnFeed.tsx` stance display. |

**De-risking branch** (D-P3-1, see `de-risking.md`):
If Azure does not surface reasoning text, the schema break also adds a
`rationale: string | null` field on `ParsedDecision` (≤ 280 chars,
populated by the model in the same tool call as the action). The replay
modal's "reasoning" pane reads from `agentRecord.llm.reasoning ??
agentRecord.decision.rationale` — either source is acceptable.

## 7. Dependency map (parallelisation)

```
                WP-A  Schema break + reasoning capture probe         (foundation)
                  │   - decisionTool.ts (loot unify, stance, drop overwatch_priority)
                  │   - schema.ts (validators, agentRecord.llm.reasoning)
                  │   - types.ts (TS mirror)
                  │   - azure.ts (probe & extract reasoning items;
                  │     fallback: add `rationale` to decision tool)
                  │   - convex schema push, dev DB wipe
                  ▼
                WP-B  Engine fixes (vision walls, resolution unify, drained-corpse)
                  │   - vision.ts wall emit
                  │   - resolution.ts: drained-corpse trace; defensive counter-fire;
                  │     offensive first-in-range; loot dispatch by id namespace
                  │   - DELETE affordances.ts
                  │   - all engine tests green
                  ▼ Gate: schema + engine green; one smoke run executes turn-by-turn
              ┌───┴───┐
   Stage 2:   │       │   WP-C, WP-D parallel (disjoint write sets;
              ▼       ▼   inputBuilder/systemPrompt vs replay UI)
          ┌─ WP-C  Digest rebuild + system prompt rewrite ────────┐
          │  - inputBuilder.ts (Last turn line, obs brackets, no  │
          │    Affordances/Heard/Last-known/Evac sections)        │
          │  - systemPrompt.ts (full rewrite as schema teacher)   │
          │  - Last-turn-observation collection per agent in      │
          │    runMatch.ts                                        │
          │  - persona retune if needed                           │
          │  - tests/llm/inputBuilder.test.ts rewrite             │
          └───────────────────────────────────────────────────────┘
          ┌─ WP-D  Replay UI raw-pane ───────────────────────────┐
          │  - ExpandModal.tsx collapse                          │
          │  - decisionEnglish.ts loot vocabulary, stance,       │
          │    drained-corpse outcome                            │
          │  - TurnFeed.tsx stance display                       │
          │  - tests update                                      │
          └──────────────────────────────────────────────────────┘
                          │
                          ▼ Gate: 1-run smoke complete; replay UI
                            shows raw-pane for one match's agent
                  WP-E  Closing-10 harness pass + persisted report + closure record
                          │   - 10 Convex-persisted runs
                          │   - report row aggregating all metrics in §5
                          │   - mental-model.md §11 closure update
                          │   - PHASE-3-CLOSURE.md
                          ▼
                       PHASE 3 CLOSED
```

WP-A is hard-sequenced first because every other WP depends on the new
schema vocabulary. WP-B follows WP-A because the engine fixes consume the
new schema (loot unify dispatch, overwatch_stance). WP-C and WP-D run in
parallel after WP-B because their write sets are disjoint
(inputBuilder/systemPrompt vs. replay UI components). WP-E is the closing
gate.

## 8. Token budget cross-check

Phase-1 budget: ≤ 1 200 tokens total per per-turn call. Current allocation
(approx):

| Slot | Phase-1 (current) | Phase-3 (target) | Δ |
|---|---|---|---|
| System prompt | ≤ 400 tokens | ≤ 500 tokens (schema teacher; richer) | +100 |
| Persona | ≤ 80 tokens | ≤ 80 tokens (no change) | 0 |
| Scratchpad | ≤ 125 tokens (500 chars) | ≤ 125 tokens | 0 |
| Visible-state digest | ~ 200–400 tokens | ~ 250–450 tokens | +~50 |
| Total ceiling | ~ 1 005 tokens | ~ 1 155 tokens | +150 |

Digest delta breakdown:

| Section | Phase-1 | Phase-3 | Δ |
|---|---|---|---|
| Turn line | 8 tokens | 8 tokens | 0 |
| You: line (HP, equipped) | 25 tokens | 30 tokens (+ in-evac flag) | +5 |
| **NEW** Last turn (you): line | — | ~ 30–50 tokens | +40 |
| Visible bullets (8 × ~10 chars) | ~ 80 tokens | ~ 130 tokens (+ obs brackets per char) | +50 |
| Walls (now emitted, sorted last) | — | ~ 30–60 tokens (4–5 walls) | +45 |
| Affordances: | ~ 80 tokens | DELETED | −80 |
| Heard (last turn): | ~ 50 tokens (when present) | DELETED (folded into per-Visible obs) | −50 |
| Last-known: | ~ 50 tokens (when present) | DELETED (agent's job via scratchpad) | −50 |
| Evac: | ~ 30 tokens (when revealed) | DELETED (Evac is a Visible singleton) | −30 |
| **Net digest delta** | — | — | ~ −70 to +30 |

The net digest cost is roughly neutral or slightly positive. The system
prompt expansion (+100 tokens) is the biggest single growth. Total stays
under the 1 200-token budget by ~50–100 tokens of headroom.

**Risk:** if the system prompt rewrite over-shoots 500 tokens, the digest
budget gets squeezed. WP-C's acceptance includes a tiktoken-proxy
assertion (chars/4) on the composed (system+digest+persona+scratchpad)
input matching `≤ 1 200` tokens for at least one turn from each persona
on a smoke run. If this fails, lower `VISIBLE_ENTITY_CAP` from 8 → 6
and/or trim the system prompt. The cap-trim option is explicitly
non-blocking; the budget is the binding constraint.

## 9. Open questions and locked answers

### 9.1 Schema break vs migration shim — LOCKED

POC-mode schema wipe per `mental-model.md` §11 + memory
`project_poc_schema_wipe_acceptable`. No dual-shape compatibility, no
deprecation warnings, no historical-row rescue. The replay UI's
existing closing-50 traces from phase 1 will not validate against the
new schema; that is acceptable.

### 9.2 Reasoning text source — DE-RISK FIRST (WP-A.1)

Perplexity research suggests Azure Responses API does not expose
reasoning text by default, only token counts. WP-A.1 is a small probe
on the dev deployment to confirm the actual response shape. If
reasoning text is exposed (e.g. via a `reasoning.summary` parameter or
a future-Azure feature), capture it. If not, the schema-break adds a
`rationale: string | null` field to the decision tool that the model
fills in alongside the action — the user gets the chain-of-thought
channel either way. See `de-risking.md` D-P3-1.

### 9.3 Visible-bullet observation brackets — LOCKED

Per North Star §1: brackets render last-turn behaviour observed by THIS
agent. Drop the "last turn" qualifier — from the agent's POV it's
current state. Concrete vocabulary:

- For a character bullet: `[HP~mid, holding axe, attacked Player_2]`
  / `[HP~low, said "Truce?"]` / `[HP~high]`.
- For a chest bullet: `[opened]` (when opened).
- For a corpse bullet: `[axe + leather]` (remaining loot) or `[drained]`
  (when empty).
- For cover/wall: no brackets.

Per-character last-turn observations are computed per-observer at
`runMatch.advanceTurn` time from the previous turn's `resolution.speech[]`
+ `resolution.actions[]` filtered by visibility-at-N+1.

### 9.4 Drained-corpse handling — LOCKED

Engine emits a trace `resolution.actions[]` entry with
`result: "empty"` on loot attempts against a corpse with no remaining
slots. Visible-state digest renders empty corpses with `[drained]` and
suppresses them from the closest-N selection (drained corpses sort
*after* non-drained corpses so the cap doesn't push live targets out of
the visible list).

### 9.5 Defensive overwatch counter-fire — LOCKED

Per North Star §4: defensive overwatch counter-fires ONCE PER ATTACKER
who hits the overwatcher this turn, bounded by weapon range. Counter-fires
are batched into the same simultaneous-attacks pass (no separate phase).
Mutual-damage entries appear in `resolution.actions[]`. Range bounding:
counter-fire only against attackers within the overwatcher's weapon range
at the moment of resolution.

### 9.6 Offensive overwatch first-in-range — LOCKED

Per North Star §4: fires on FIRST VALID IN-RANGE VISIBLE ENEMY after move
resolution. Current nearest-then-id ordering is acceptable; "first in
range" is the contract — array order is fine. The engine's existing
overwatch path is already nearest-then-id; the change in this phase is
that this contract is now explicitly named and tested (and that
`overwatch_priority` decoration is gone).

### 9.7 Persona retune — DEFERRED

Personas in `personas/*.md` do not currently reference internal
vocabulary (`interact`, `Affordances`, `overwatch_priority`); the schema
break does not invalidate their bodies. WP-C scope includes a re-read
pass, with edits only if the new system prompt shape conflicts. This is
a soft-deferred sub-task, not a separate WP.

### 9.8 Concept-spec / phase-1 ADR conflicts — RECORDED

This phase invalidates two phase-1 ADRs:

- **ADR §4** (the locked decision schema): the `interact` action arm is
  removed; `loot.targetCorpseId` becomes `loot.targetId` (string, namespace
  dispatch); `overwatch_priority` field is replaced by
  `overwatch_stance: "offensive" | "defensive"`.
- **ADR §7** (trace shape): `agentRecord.llm.reasoning: string | null`
  is added.

Phase 3's `architecture-decisions.md` §1 records the supersession. The
phase-1 ADRs remain as the historical record of what the schema was
under phase-1 closure conditions; the phase-3 ADR is the authoritative
shape going forward.

The `concept-spec.md` change surface is small:
- §11 (overwatch) — the `overwatch_priority` priority example list is
  no longer literal; the structured `overwatch_stance` replaces it.
- §13 (loot/equip) — the conceptual distinction between "interact" with
  chest and "loot" from corpse persists in prose, but the engine action
  vocabulary unifies under `loot`.
- §21 (agent output shape) — `overwatch_priority` removed,
  `overwatch_stance` added.

WP-A's deliverables include diff-targeted edits to `concept-spec.md`
§11/§13/§21 (these are spec source-of-truth and must reflect the new
contract). Other §s remain accurate.

## 10. Files in this folder

- `README.md` — this file. Phase goal, scope, gates, dependency map,
  acceptance criteria, token budget cross-check.
- `architecture-decisions.md` — concrete decisions this phase makes that
  supersede phase-1 ADRs §4 and §7 (schema break, reasoning capture
  contract, overwatch stance, loot unify, system-prompt re-author).
- `work-packages.md` — per-WP scope, acceptance, test strategy, risks.
- `de-risking.md` — load-bearing unknowns (reasoning capture; counter-fire
  semantics; outcome-attribution heuristic) and the spikes/probes that
  retire them.

## 11. Engineering hygiene non-negotiables

- **Tests-first** for the four pure modules under refactor:
  `inputBuilder.ts`, `decisionTool.ts`, `vision.ts` (wall emit slice),
  `resolution.ts` (drained-corpse trace + defensive counter-fire +
  offensive first-in-range slices), and `decisionEnglish.ts`. Every
  Cucumber scenario in §3 traces to at least one Vitest case.
- **POC schema wipe is the migration plan.** After WP-A lands the schema
  diff, run `npx convex run` to wipe the dev DB before the first WP-B
  smoke run. Document the wipe command in WP-A acceptance.
- **Engine reads State only.** No new imports from `convex/engine/*`
  into `apps/replay/`. Renderer continues to read State only per
  architecture §1.
- **No `git stash`.** Working tree is shared. If isolation is needed,
  use `git worktree`.
- **Background processes** (`npx convex dev`, harness runs) must be
  `nohup`'d if they need to survive past an agent's final response.
- **Reasoning capture is gated by the WP-A.1 probe.** Implementation
  branches based on the probe outcome — do not blanket-implement a
  capture path that the deployment doesn't support.
- **Token budget asserts in WP-C.** A tiktoken-proxy (chars/4) check on
  the composed input ensures the new digest + system prompt stay within
  ≤ 1 200 tokens. Failure forces a digest-cap or system-prompt trim.

## 12. Recommended job sequence

1. **WP-A first, single job.** Schema break, reasoning probe, schema
   push to dev DB. **Reviews go *during* WP-A, not after** — the schema
   diff is a contract change and the reviewer catches drift before WP-B
   builds on it. Gate: `npm run typecheck && npm test` green, a probe
   run captures or documents reasoning shape.

2. **WP-B second, single job.** Engine fixes. Includes a 1-run smoke
   pass with the new schema to confirm the engine compiles and runs
   without crashes. Gate: `npm test` green for `tests/engine/*`; one
   match completes turn-by-turn.

3. **WP-C and WP-D in parallel** (2 engineering jobs). Disjoint write
   sets:
   - WP-C: `convex/llm/inputBuilder.ts`, `convex/llm/systemPrompt.ts`,
     `convex/runMatch.ts` (last-turn-observation collection),
     `personas/*.md` (if needed), `tests/llm/inputBuilder.test.ts`.
   - WP-D: `apps/replay/src/components/ExpandModal.tsx`,
     `apps/replay/src/lib/decisionEnglish.ts`,
     `apps/replay/src/components/TurnFeed.tsx`, plus tests.
   Gate: `npm run lint && npm run typecheck && npm run build && npm test`
   green at root and `apps/replay/`. One match end-to-end through replay
   UI shows the new raw-pane.

4. **Independent code-review pass** at the end of WP-D — reviewer agent
   runs three matches end-to-end and confirms every Cucumber scenario
   in §3 holds. Specific checks: every result-string in `resolution.ts`
   has a `decisionEnglish.ts` mapping; reasoning capture either persists
   or documents why-not; the schema diff is fully consistent across
   `decisionTool.ts` ↔ `schema.ts` ↔ `types.ts`.

5. **WP-E closing-10 pass.** 10 runs against dev Convex; aggregate the
   §5 metrics into a persisted report row; write `PHASE-3-CLOSURE.md`;
   update `mental-model.md` §11.

Reviews go *before* the phase closes, not after — the substrate's whole
job is producing watchable, attributable behaviour the user can trust.
