# Phase 04 — Per-Turn Context Redesign + Diagnostic Bundle

> Goal: reshape the per-turn LLM context to the user's hand-crafted intent
> sketch — slim system role, tool-schema-carries-grammar, Visible-as-keyed-
> object, ordered `## previous turn` → `# Current Game State` narrative,
> global kill feed + alive count. Fix the prompt-hygiene leak. Ship the
> replay-UI diagnostic bundle. Prove the redesign with a 10-run pass the
> user can step through with **< 5% no-op turns** and no regression vs
> phase-3 thresholds.
>
> Phase status: **dispatched 2026-05-11**. Phase-3 closure record:
> `docs/project/phases/03-substrate-refinement/PHASE-3-CLOSURE.md`. The
> intent anchor — **canonical, treat as source of truth on prose and
> structure** — is `docs/project/spec/per-turn-context-intent.md`. The
> mental-model framing for this phase is `mental-model.md` §13.

---

## 1. Why this phase

Stepping through the phase-3 closing-10 in the replay UI surfaced four
classes of issue. Each one has a phase-3 fingerprint we can point at; each
fix lands in this phase.

| Symptom (phase-3 replay observation) | Root cause | Phase-4 fix |
|---|---|---|
| System prompt duplicates the JSON Schema in English (`How to read Visible:`, `How to act on Visible:`, action arm cheat-sheet) | Two encodings of the same contract → token waste + drift risk. Phase-3's "schema teacher" framing was the band-aid for the LLM not parsing the schema's own descriptions. | Slim system role to stable rules-of-the-game. Tool-schema property `description` fields carry the action grammar self-descriptively. |
| Visible digest's unkeyed bracketed observations (`[HP~high, holding axe, attacked Player_2]`) force the model to *infer* field semantics | The bullet+bracket shape made the model parse-then-infer rather than parse. | Visible becomes a keyed object. Exact serialisation (JSON / YAML / keyed-inline) is chosen by an empirical token+pass-rate bench. |
| Replay UI shows `decision` only — `rawArguments`, `validatorReason`, `usage.output_tokens` cap, and the tool schema itself are invisible | The phase-3 raw-pane collapsed five tabs to three sections but did not expose the model's literal emission, the engine's rejection reason, the per-call truncation signal, or the request body's tool-schema slot. | Diagnostic bundle: render `rawArguments` next to `decision` with matched/diverged indicator; surface `validatorReason`; show `output_tokens / max_output_tokens` with 🔴 truncated ≥ 95%; add `--- tool schema ---` section to Full LLM Input. **Full LLM Input is *input* only — system role + user role + tool schema. Reasoning text is model output and stays in its own existing pane.** |
| Phase-3 system prompt closes with `Output discipline: ... Invalid choices are replaced with the safe default` | The prompt teaches the model that emitting nonsense has a graceful fallback. Exactly the wrong incentive. | DELETE the line. Downstream safe-defaulting stays downstream. Prompt-hygiene memory: `feedback_prompt_hygiene_no_fallback_leak`. |

The redesign also adds a new design surface — a **global kill feed**
(`<killer> killed <victim> with <weapon>`) and **alive count** (`M/8
players alive`). This is a deliberate departure from strict fog-of-war for
match-meta only; spatial perception stays local. Unlocks BR-genre persona
behaviour the current local-only signal cannot.

The intent anchor (`docs/project/spec/per-turn-context-intent.md`) is the
source of truth for the prose and structure. This plan elaborates on the
**how** without refactoring the **what** away from the user's sketch.

## 2. What "done" means (closing condition)

Ten Convex-persisted runs on the **redesigned** substrate, each fully
steppable from the replay UI, with:

- **< 5% no-op turns** across all (run, agent, turn) tuples in the 10
  runs. A no-op = `primary:"stationary_action"` AND `move.kind === "none"`
  AND `action.kind === "none"`.
- **No regression vs the phase-3 closing thresholds** (extraction ≥ 30%,
  kill ≥ 80%, equip ≥ 80%, speech ≥ 50%, persona-spread ≥ 15 pp, 0
  crashes), measured on the same 10 runs (or a 50-run follow-up if the
  10-run vibe is uncertain).
- A persisted phase-4 report row (`reportType: "phase-4-closing-10"`)
  carrying the new metrics + the carry-over phase-3 view.
- A token-usage + tool-call-pass-rate bench documented for the Visible-
  object serialisation choice (Acceptance C). **Canonical tool-call
  pass rate (intent §4): `rawArguments == decision`** after JSON parse
  + key-canonicalisation. `fellBackToSafeDefault` and `validatorReason
  != null` are supporting telemetry — reported alongside, but NOT the
  headline number.
- A short doc of which `max_output_tokens` and `reasoning.effort` values
  were chosen, justified against the probe data (Acceptance E).

**Hard gates:**

- `npm run lint && npm run typecheck && npm run build && npm test` —
  green at root and in `apps/replay/`.
- The schema additive (action-trace `weapon?: string` on attack/overwatch
  entries — see ADR §1) is pushed cleanly. POC-mode wipe acceptable per
  `project_poc_schema_wipe_acceptable`; preferred path is additive (no
  wipe required) since the field is optional.
- The user can open any of the closing-10 runs and step through it; on
  every turn row, `rawArguments` is visible (matched-or-diverged indicator
  set on `rawArguments == decision` canonical equality), `validatorReason`
  is surfaced when set, the `output_tokens / max_output_tokens` bar is
  rendered with the 🔴 indicator when ≥ 95%, and the tool schema is in
  the Full LLM Input pane (alongside system and user roles; reasoning
  text remains in its own separate pane).

## 3. Scope (what's in)

**Cucumber surface** (mirrors the assignment north star, condensed):

```gherkin
Feature: Per-turn context redesign + diagnostic bundle

  Scenario: System role carries only stable rules of the game
    Given the redesigned system prompt
    When an agent receives its per-turn input
    Then the system role contains the stakes line, match-shape lines,
         and the walls/cover affordance lines from per-turn-context-intent §1
    And the system role does NOT contain "How to read Visible"
    And the system role does NOT contain "How to act on Visible"
    And the system role does NOT contain "Output discipline"
    And the system role does NOT contain "safe default" anywhere

  Scenario: Tool schema descriptions carry the action grammar
    When the tool schema is sent to Azure
    Then `decide_turn.description` declares the overwatch dual contract
    And the `move` property description declares the 6-arm grammar and movement range
    And the `action` property description declares the 3-arm grammar and attack/loot range
    And the `primary` description declares the three-value semantics + overwatch dual
    And the `overwatch_stance` description declares the null-iff-not-overwatch contract
    And the `scratchpad_update` description carries the usage hint
    And no description field contains "safe default" / "replaced with" leakage

  Scenario: Per-turn user message follows the intent §2 ordering
    Given a non-first turn
    When the agent's user message is composed
    Then the message contains, in order:
      1. the persona body
      2. a `## previous turn` heading with the You: outcome,
         the Scratchpad: prior-turn text, and zero-or-more
         `<killer> killed <victim> with <weapon>` lines
      3. a `# Current Game State` heading with `Turn N, M/8 players alive`,
         the You: line, and the Visible keyed-object
    And there is no top-level `## Scratchpad` section

  Scenario: Global kill feed broadcasts independently of LOS
    Given Player_2 killed Player_1 with axe on turn N
    And the observer at turn N+1 could not see Player_2 at any time
    When the observer's `## previous turn` is rendered
    Then it contains the line "Player_2 killed Player_1 with axe"

  Scenario: Alive count line is current-turn ground truth
    Given 3 of 8 spawned agents are alive at the start of turn N+1
    When the observer's `# Current Game State` is rendered
    Then it contains "Turn N+1, 3/8 players alive"

  Scenario: Visible is a keyed object, not unkeyed bracket prose
    When the agent's user message is composed
    Then the Visible block does NOT contain the phase-3 bracket idiom
         (`[HP~high, holding axe, attacked Player_2]`)
    And the Visible block IS the format chosen by the WP-E bench
         (JSON-style, YAML-style, or keyed-inline)

  Scenario: rawArguments and decision are both visible in the replay UI
    Given an agent emitted a tool call last turn
    When the user opens the expand modal on that turn
    Then the raw pane shows both `rawArguments` and `decision`
    And shows a "matched" indicator when they are equal
    And shows a "diverged" side-by-side render when they differ

  Scenario: validatorReason is surfaced when set
    Given the engine validator zeroed a syntactically-valid decision
    When the user opens the turn feed row for that agent
    Then `validatorReason` is visible inline or in the expand modal

  Scenario: Truncation indicator lights at ≥95% of max_output_tokens
    Given a turn whose `usage.output_tokens` is ≥95% of `max_output_tokens`
    When the user views the turn feed row
    Then a "🔴 truncated" indicator is shown
    And the bar is hidden or muted on rows below the threshold

  Scenario: Tool schema is in the Full LLM Input pane
    When the user opens the expand modal
    Then the Full LLM Input pane has three sections:
         system role, user role, tool schema
    And the tool schema section pretty-prints the `decide_turn` JSON Schema
    And reasoning text is NOT in the Full LLM Input pane
         (it stays in its own existing reasoning section)

  Scenario: Closing-10 — the user can step through and < 5% no-op
    When the user runs the phase-4 closing-10 harness pass
    Then 10 matches complete with no crashes
    And each match is reachable via the replay UI's match picker
    And the no-op rate across all (run, agent, turn) is < 5%
    And the phase-3 closing thresholds are not regressed on the same 10 runs
```

**Concrete in-scope deliverables:**

- **System prompt rewrite** (`convex/llm/systemPrompt.ts`) — slim to
  stakes + match shape + walls/cover bullets per intent §1. Delete the
  "How to read Visible", "How to act on Visible", and "Output discipline"
  sections. Token target ≤ 200 (vs phase-3 ≤ 500).
- **Tool-schema description enrichment** (`convex/llm/decisionTool.ts`) —
  enrich `description` fields on `decide_turn` (top-level), `move`,
  `action`, `primary`, `overwatch_stance`, `scratchpad_update` per intent
  §5. No JSON Schema shape changes; only `description` text.
- **Prompt-hygiene fix** — the `Output discipline` line is deleted; a
  test guards against any "safe default" / "replaced with" / similar
  fallback-leak phrasing reappearing in system prompt OR schema
  descriptions.
- **Per-turn user message rebuild** (`convex/llm/inputBuilder.ts` +
  `convex/llm/azure.ts`) — the `## previous turn` → `# Current Game State`
  ordering from intent §2. Scratchpad relabelled inside `## previous turn`.
  Global kill feed lines under `## previous turn`. `Turn N, M/8 players
  alive` line under `# Current Game State`.
- **Visible-as-keyed-object** — replace the phase-3 bullet-with-brackets
  shape with a keyed object. WP-E selects JSON / YAML / keyed-inline
  empirically; WP-D ships the rebuild with one initial serialisation;
  WP-E pins the winner.
- **Trace surfaces for kill feed** (`convex/engine/resolution.ts` +
  `convex/schema.ts`) — additive optional `weapon?: string` field on
  `resolution.actions[]` attack/overwatch entries so the kill-feed
  renderer doesn't have to reconstruct the killer's weapon from
  characters-table state (which can drift between strike and render).
  POC-additive, no wipe required.
- **Composed user-message persistence** (`convex/schema.ts`
  `agentInputValidator` + `convex/runMatch.ts`) — additive optional
  `composedUserMessage?: string` field on `agentRecord.input`. WP-D
  narrows `visibleStateDigest` to the Visible-object body only;
  persisting the full assembled user message keeps the replay raw-pane
  faithful for both phase-3 and phase-4 traces (the raw-pane reads
  `composedUserMessage` verbatim when present; falls back to phase-3
  client-side composition when absent). POC-additive, no wipe required.
- **Replay UI diagnostic bundle** (`apps/replay/src/lib/rawPane.ts` +
  `apps/replay/src/components/ExpandModal.tsx` +
  `apps/replay/src/components/TurnFeed.tsx`):
  - `rawArguments`-vs-`decision` render with matched/diverged indicator.
    Canonical metric (intent §4): `rawArguments == decision` after JSON-
    parse + key-canonicalisation. `fellBackToSafeDefault` is supporting
    telemetry; the equality predicate is the headline.
  - `validatorReason` surface on the turn row when non-null.
  - `usage.output_tokens / max_output_tokens` bar with 🔴 truncated
    indicator at ≥ 95% of cap.
  - `--- tool schema ---` section added to `composeFullLlmInput`,
    pretty-printed `decide_turn` JSON Schema from
    `convex/llm/decisionTool.ts`. **`composeFullLlmInput` is request-
    inputs-only**: system role + user role + tool schema. Reasoning
    text is model output; it stays in its own existing pane (the
    `composeReasoningText` section in the ExpandModal).
- **Visible-format bench** — short probe (5–10 runs per shape, fixed
  seeds + personas) measuring token cost + tool-call-pass-rate + no-op
  rate across JSON / YAML / keyed-inline. Winner pinned; data persisted
  to `docs/project/phases/04-context-redesign/visible-format-bench.md`.
- **Lever probe** (`convex/runMatch.ts` `MAX_OUTPUT_TOKENS` lift) —
  parameterise `max_output_tokens` (current 1200) to probe 1500 and 2000;
  probe `reasoning.effort` from "low" to "medium". Chosen values
  documented with the probe data.
- **Closing-10 pass + persisted report** (`harness/run.ts`,
  `convex/reports/phase4.ts` extending or reusing `convex/reports/phase3.ts`)
  with the no-op-rate metric added.
- **Phase-4 closure doc**
  (`docs/project/phases/04-context-redesign/PHASE-4-CLOSURE.md`).

## 4. Hard out of scope

- **Schema break / Convex wipe.** Phase-4 stays additive: the two new
  fields (`resolution.actions[].weapon?` and
  `agentRecord.input.composedUserMessage?`) are both optional. Phase-3
  trace rows continue to validate; phase-4 trace rows carry the new
  fields. Migration shims and dual-shape branches are out of scope —
  the replay UI's raw-pane uses a single `if (composedUserMessage)
  render verbatim; else legacy compose` switch.
- **Persona prompt edits** — orthogonal. Surface for future iteration.
- **Cursed-item flavour text** — phase 5+. Moderation layer is still a
  binding constraint. The weapon name in the kill feed IS the seam for
  future cursed-item work, but no aggressive in-world text content lands
  this phase.
- **Consumer-facing renderer / public spectator / fog-of-war UI** —
  later phase. Replay UI stays personal-overseer-only.
- **Procedural map generation** — `maps/reference.json` remains the only
  map.
- **Multi-turn scratchpad strategies** beyond the existing carry-forward
  contract.
- **Engine combat tuning** — HP, weapon damage, ranges, vision range,
  reasoning model upgrade. The lever probe in scope is request-shape
  (max_output_tokens, reasoning.effort) only, not model selection.
- **Migration shims / dual-shape compatibility** — POC posture; if a
  break is needed, wipe per `project_poc_schema_wipe_acceptable`. The
  additive `weapon?: string` on action trace entries should avoid a wipe.

## 5. Acceptance criteria — phase-4 closing-10

**Carry-over from phase 3 (10-run-scaled, MUST NOT REGRESS):**

| Metric | Threshold | Source |
|---|---|---|
| Runs ending with ≥ 1 extraction | ≥ 30% | `characters.extractedAtTurn` |
| Runs containing ≥ 1 kill | ≥ 80% | `resolution.deaths[]` |
| Runs containing ≥ 1 chest equip | ≥ 80% | `resolution.actions[]` kind=loot, target=chest_*, result=opened |
| Runs containing ≥ 1 speech event | ≥ 50% | `resolution.speech[]` |
| Persona extraction-rate spread (max−min, 8 personas) | ≥ 15 pp | characters × extracted |
| 10 consecutive runs, no crashes | required | match.status |

**New metrics specific to the context redesign:**

| Metric | Threshold | Source |
|---|---|---|
| **No-op turn rate** | **< 5%** across all (run, agent, turn) | `agentRecord.decision` with `primary === "stationary_action"` AND `move.kind === "none"` AND `action.kind === "none"` |
| Fellback-to-safe-default rate | ≤ 10% (phase-3 carry; should NOT regress) | `agentRecord.llm.fellBackToSafeDefault` |
| Truncation rate | documented (not threshold) | `agentRecord.llm.usage.output_tokens ≥ 0.95 × max_output_tokens` |
| Reasoning capture rate | documented (not threshold; phase-3 floor was 68.8% at "low" effort) | `agentRecord.llm.reasoning !== null` |
| Visible-object format choice | one of {json, yaml, keyed-inline} pinned with data | WP-E bench output |
| `max_output_tokens` choice | one of {1200, 1500, 2000} pinned with data | WP-F probe output |
| `reasoning.effort` choice | one of {low, medium} pinned with data | WP-F probe output |

The phase-3 fellback-to-safe-default rate (8.256% at closing-10) is
**carry-over** — the redesign should not regress it. The no-op rate is
the **headline metric** for the redesign: phase-3 didn't publish a
no-op rate, but the user's stepping-through observation was that
reasoning-rich-but-stationary turns clustered noticeably. The diagnostic
bundle (WP-B) makes this measurable; the redesign (WP-A + WP-C + WP-D)
should pull it under 5%.

## 6. Architecture at a glance

The architecture-§1 three-slice contract (LLM / State / Engine /
Renderer) is preserved. Engine and renderer still meet only at State.

| Slice | What changes this phase |
|---|---|
| LLM | `systemPrompt.ts` rewrite (slim, no schema mirror); `decisionTool.ts` description enrichment (no shape change); `inputBuilder.ts` rebuild (sectioned user message, kill feed, alive count, Visible-as-keyed-object); `azure.ts` user-message composer drops the phase-3 `## Persona / ## Scratchpad / ## Visible state` wrapper (inputBuilder owns the whole shape now). |
| State | Schema additive: `resolution.actions[].weapon?: string` on attack/overwatch entries. No removals; no wipe required. |
| Engine | `resolution.ts` + `combat.ts` emit `weapon` on attack/overwatch entries (read killer's equipped weapon at strike time, before any post-strike unequip / death cleanup). |
| Renderer | `rawPane.ts`: `--- tool schema ---` section appended to `composeFullLlmInput` (now 3 sub-sections: system + user + tool schema; reasoning stays in its own existing `composeReasoningText` pane), `composeRawArgumentsVsDecision` helper. `ExpandModal.tsx`: Full LLM Input pane (3 sub-sections) + Reasoning pane + Tool call pane with rawArguments-vs-decision render + validatorReason block. `TurnFeed.tsx`: validatorReason badge, truncation indicator bar. |

**Dependency map:**

```
                  WP-B  Replay UI diagnostic bundle (UI only; lands EARLY)
                  │   - rawArguments vs decision matched/diverged render
                  │   - validatorReason surface
                  │   - usage.output_tokens / max_output_tokens bar + 🔴 indicator
                  │   - tool schema section in composeFullLlmInput
                  │   No schema/engine deps — can land first.
                  │
                  ║  PARALLEL with WP-B (disjoint write sets):
                  ║
                  WP-A  Trace surfaces for kill feed + alive count
                  │   - schema: resolution.actions[].weapon?: string (additive)
                  │   - engine: combat.ts / resolution.ts emit weapon on attack+overwatch
                  │   - state: runMatch.ts threads aliveCount + priorTurn kill records
                  │     into PrevTurnRow for inputBuilder
                  │
                  ║  PARALLEL with WP-A/WP-B (only systemPrompt.ts + decisionTool.ts):
                  ║
                  WP-C  System prompt slim + tool-schema description enrichment
                  │   - systemPrompt.ts rewrite to ≤ 200 tokens
                  │   - decisionTool.ts: enrich `description` on decide_turn,
                  │     move, action, primary, overwatch_stance, scratchpad_update
                  │   - prompt-hygiene guard test (no "safe default" leak)
                  │
                  ▼ Gate (parallel three-WP join): npm run typecheck + npm test
                    green; one smoke turn renders the new shape end-to-end.
                  
                  WP-D  Per-turn user message rebuild
                  │   - inputBuilder.ts: ## previous turn → # Current Game State
                  │   - kill feed line renderer
                  │   - alive count line
                  │   - Visible-as-keyed-object renderer (3-shape switch)
                  │   - azure.ts user-message composer simplified
                  │   - tests for ordering + kill feed + alive count
                  │   Depends on WP-A (kill-feed records, alive count plumbing)
                  │     and WP-C (slim system prompt so we don't double-teach grammar).
                  │
                  ▼
                  WP-E  Visible-object format bench
                  │   - probe runs: JSON-style, YAML-style, keyed-inline (stretch)
                  │   - measure tokens + tool-call pass rate + no-op rate
                  │   - pin winner into inputBuilder default
                  │   - visible-format-bench.md
                  │
                  ▼
                  WP-F  Lever probe (max_output_tokens, reasoning.effort)
                  │   - parameterise MAX_OUTPUT_TOKENS via matches row
                  │   - probe 1200 vs 1500 vs 2000 (cap)
                  │   - probe reasoning.effort low vs medium
                  │   - pin chosen values
                  │
                  ▼
                  WP-G  Closing-10 + closure record
                  │   - 10 Convex-persisted runs on redesigned harness
                  │   - phase-4 report row (carry phase-3 metrics + no-op rate)
                  │   - PHASE-4-CLOSURE.md
                  ▼
                  PHASE 4 CLOSED
```

**Why WP-B lands first** — the assignment is explicit on this: the user
needs to see `rawArguments`, `validatorReason`, and the truncation
indicator BEFORE running the bench (WP-E) and the closing pass (WP-G).
Without those signals, the bench cannot distinguish "the model emitted
the wrong shape" from "the engine validator zeroed it" from "Azure
truncated mid-tool-call". WP-B is a pure UI delta against the phase-3
trace ledger (every field it renders is already persisted), so it can
land before any prompt or schema change.

## 7. Token budget cross-check

Phase-3 budget: ≤ 1 200 tokens total (chars/4 proxy). Phase-3 actual
ceiling: ~ 1 155 tokens. Phase-4 redesign target. **Reading the table:
the scratchpad lives INSIDE `## previous turn` (it is one line of that
block, not a sibling); the row labelled `## previous turn` is the sum
of its sub-lines (You: + Scratchpad: + kill-feed). Each slot is counted
once.**

| Slot | Phase-3 (current) | Phase-4 (target) | Δ |
|---|---|---|---|
| System prompt | ≤ 500 tokens | ≤ 200 tokens (slim — stakes + match-shape + walls/cover only) | −300 |
| Persona body | ≤ 80 tokens | ≤ 80 tokens (no change) | 0 |
| `## previous turn` block | new — folded from phase-3 `Last turn (you)` + `## Scratchpad` | ≤ 210 tokens **(You: outcome ~30 + Scratchpad: ~125 + kill feed up to ~50)** | +5 net vs phase-3's separate Last-turn (~30) + Scratchpad (~125) wrapper (~155) |
| `# Current Game State` | new — turn + alive count line ~15 tokens + You: line ~30 + Visible-keyed-object | ~ 245–445 tokens (15 + 30 + Visible ~ 200–400 depending on shape, see WP-E) | varies |
| **Total user message** | ~ 1 155 tokens (system+persona+scratchpad+digest) | ~ 735–935 tokens (sum of rows above: 200+80+210+245…445) | **−220 to −420** |
| Tool-schema description tax (request body) | ~ 200 tokens (terse descriptions) | ~ 300 tokens (action grammar moved here from system prompt) | +100 |
| **Net per-turn (user message + tool schema)** | ~ 1 355 tokens | ~ 1 035–1 235 tokens | **−120 to −320** |

The slim system prompt buys ~300 tokens of headroom that the enriched
tool-schema descriptions and the (potentially) wordier Visible-keyed-
object can consume without breaking the phase-3 budget. WP-E's bench
includes a token-cost column so the format choice respects this budget.

**Budget test scope.** The phase-3 budget test in
`tests/llm/inputBuilder.test.ts:1238-1324` asserts on the phase-3
`system + persona + scratchpad-wrapped + digest` shape. WP-D extends
that test to the **phase-4 request shape end-to-end**: system prompt
(slim) + assembled user message (persona body + `## previous turn`
with 500-char scratchpad + max-density kill feed of 7 lines + `# Current
Game State` with Visible-keyed-object) + enriched `decisionTool`
descriptions. The composed total must stay within the phase-3 ≤ 1 200
token user-message envelope; the +100 token tool-schema description tax
is tracked separately and must stay under 350 tokens.

The `max_output_tokens` probe (WP-F) is downstream of input tokens and
is its own budget axis — the input redesign keeps input tokens roughly
neutral so the no-op-rate-vs-reasoning-budget question can be probed
independently.

## 8. Open questions and locked answers

### 8.1 Visible-object serialisation — DECIDED BY BENCH (WP-E)

Intent anchor §4 lists three candidate shapes (JSON-style, YAML-style,
keyed-inline) and prescribes an empirical probe. WP-E runs the bench;
WP-D ships the rebuild with JSON-style as the initial scaffold (it's
the shape the model is most-trained-on; the bench may move us off it).
Bench output documented in `visible-format-bench.md` and the chosen
constant pinned in `inputBuilder.ts`.

### 8.2 Kill feed weapon name — engine-emit, not renderer-reconstruct

The renderer cannot reliably reconstruct the killer's weapon at strike
time by reading `characters.equipped` (the killer may have swapped or
the corpse path may have mutated state). WP-A adds an additive optional
`weapon?: string` on `resolution.actions[]` entries (kind ∈
{attack, overwatch}) emitted at strike resolution. Schema-additive;
historical rows validate without migration; new rows carry the field.

### 8.3 Kill feed scope — match-meta only, NOT spatial

Per intent §3: the kill feed broadcasts `<killer> killed <victim> with
<weapon>` and `M/8 players alive` GLOBALLY (BR-genre convention).
Spatial info (positions, HP, last-seen) stays LOCAL — vision rules
unchanged. This is a deliberate departure from strict fog-of-war for
match-meta only. The substrate change is small (two new lines in the
user message); the unlock is potentially large (trader negotiates
based on who's left, rat lays low after the feed thins).

### 8.4 Prompt-hygiene leak — guarded by test

The phase-3 line `Output discipline: ... Invalid choices are replaced
with the safe default (do nothing).` is deleted from `systemPrompt.ts`.
A WP-C test asserts that none of the strings `safe default`, `replaced
with`, `invalid choices`, `fallback`, `do nothing` appear in either
the system prompt OR any of the tool-schema description fields. The
guard is the contract; future drift fails the test.

### 8.5 No schema break required (additive only)

Phase-3 endorsed POC schema wipe, but phase-4 should not need it:
- Kill feed weapon name → additive `resolution.actions[].weapon?:
  string`. Optional. No wipe.
- **Raw-pane faithfulness → additive `agentRecord.input.
  composedUserMessage?: string`. Optional.** Persists the assembled
  phase-4 user message so the replay raw-pane renders verbatim; phase-3
  traces (field absent) fall back to legacy compose. No dual-shape
  branch needed.
- Alive count → derived from `characters.alive`. No schema change.
- Diagnostic bundle → all OTHER fields already persisted
  (`rawArguments`, `validatorReason`, `usage`). UI-only beyond the
  `composedUserMessage` additive.
- Tool schema in raw pane → read from live `decisionTool.ts` at render
  time. No persistence.
- Per-turn message rebuild → only the two additives above; no removals
  and no required-field changes.

If WP-E's bench surfaces a desire to persist a different Visible
serialisation in the trace (currently `visibleStateDigest: v.string()`
holds the rendered text — any format fits), the field stays a string.
No schema change.

### 8.6 Reasoning capture rate at "low" effort — Azure-side floor

Phase-3 §3.3 closure: reasoning capture at `effort: "low"` is sticky
around 68.8% — an Azure-side floor where the response stream emits
empty `summary: []` arrays on a sub-tier of responses. WP-F probes
`effort: "medium"` to see whether the capture rate lifts. This is NOT
a threshold for phase-4; it is a documented lever decision.

### 8.7 Concept-spec / mental-model edits

Mental-model §13 already carries the phase-4 dispatch paragraph
(landed 2026-05-11). No further mental-model edits required this phase
unless the WP-G closure reveals something the §13 framing missed.
Concept-spec §7 (visible-state digest example) will need a one-edit
diff once the Visible-format winner is picked (WP-E output); WP-G
ships that edit alongside the closure doc.

## 9. Files in this folder

- `README.md` — this file. Phase goal, scope, acceptance, dep map,
  recommended sequence, token-budget cross-check.
- `architecture-decisions.md` — five ADRs: §1 trace surfaces for kill
  feed (action-trace `weapon?: string` AND agent-input
  `composedUserMessage?: string`, both additive), §2 system prompt
  slim contract, §3 tool-schema descriptions carry the grammar, §4
  per-turn user message ordering, §5 diagnostic bundle contract.
- `work-packages.md` — WP-A through WP-G with scope, acceptance, test
  strategy, risks.
- `de-risking.md` — three risks: D1 (slim system prompt regression
  probe), D2 (Visible-object format bench), D3 (kill-feed moderation
  pre-flight).
- `visible-format-bench.md` — WP-E output (created by WP-E execution).
- `PHASE-4-CLOSURE.md` — WP-G closure record.

## 10. Engineering hygiene non-negotiables

- **Tests-first** for the pure modules under refactor:
  `inputBuilder.ts` (user-message ordering, kill feed renderer, alive
  count, Visible-object renderer), `decisionTool.ts` (description-field
  contents), `systemPrompt.ts` (slim contract + hygiene guard),
  `rawPane.ts` (rawArguments-vs-decision composer, tool schema section).
  Every Cucumber scenario in §3 traces to at least one Vitest case.
- **Prompt-hygiene guard** in `tests/llm/systemPrompt.test.ts` — assert
  the deleted phrases don't reappear in either the system prompt or any
  tool-schema description.
- **WP-B before everything else.** UI diagnostic bundle lands first so
  WP-E's bench and WP-G's closing pass can be diagnosed in flight.
- **WP-A additive only.** The `weapon?: string` field on the action
  trace AND the `composedUserMessage?: string` field on `agentRecord
  .input` are OPTIONAL — historical phase-3 rows validate without
  migration. No POC wipe required this phase.
- **Engine reads State only.** No new imports from `convex/engine/*`
  into `apps/replay/`. Renderer continues to read State only per
  architecture §1.
- **Faithful to the intent anchor.** Variations in this plan are
  acceptable; refactors that drift from `per-turn-context-intent.md`'s
  prose and structure are not.

## 11. Recommended job sequence

1. **WP-B first (UI diagnostic bundle, lands EARLY).** Pure UI delta —
   `rawArguments`-vs-`decision` matched/diverged render, `validatorReason`
   surface, `output_tokens / max_output_tokens` bar with 🔴 indicator,
   tool-schema section in Full LLM Input. The user can step through the
   existing phase-3 closing-10 runs with the new diagnostic surface
   before any other change ships. **Gate:** the user opens at least one
   phase-3 trace in the replay UI and sees all four diagnostic surfaces
   rendering correctly.

2. **WP-A in parallel with WP-B** (disjoint write sets — UI vs engine /
   schema). Additive `weapon?: string` on the action trace; engine emit
   in `combat.ts` / `resolution.ts`; `runMatch.ts` threads
   `aliveCount` and prior-turn kill records into `PrevTurnRow`.
   **Gate:** `npm test` green for `tests/engine/*` and the new
   inputBuilder kill-feed fixtures; one smoke run completes.

3. **WP-C in parallel with WP-A + WP-B** (disjoint write sets — only
   touches `systemPrompt.ts`, `decisionTool.ts`, and their tests). Slim
   the system prompt; enrich the tool-schema descriptions; prompt-
   hygiene guard test locks the "no safe-default leak" contract.
   **Gate:** `npm test` green for `tests/llm/systemPrompt.test.ts`,
   `tests/llm/decisionTool.test.ts`, `tests/llm/schemaMirror.test.ts`.

4. **WP-D after WP-A + WP-C** (depends on both — the kill-feed records
   and the slim system prompt). **Probe-gated: WP-D requires green D1
   AND D3 sign-off** (de-risking.md) before commit. Rebuild
   `inputBuilder.ts` to the §2 ordering: `## previous turn` (You:
   outcome / Scratchpad / kill feed) → `# Current Game State` (Turn N
   alive line / You: line / Visible keyed-object). Ship the
   Visible-object renderer with a format switch; default to JSON-style
   as the WP-E starting point. Drop the phase-3 `## Persona / ##
   Scratchpad / ## Visible state` wrapper in `azure.ts`. WP-D also
   persists the assembled user message on `agentRecord.input.
   composedUserMessage` so the raw-pane reconstruction is faithful for
   phase-4 traces (additive optional field — phase-3 traces still
   validate). **Gate:** `npm run lint && npm run typecheck && npm run
   build && npm test` green at root; one smoke run end-to-end through
   the replay UI shows the new user-message shape and the diagnostic
   bundle from WP-B renders the assembled `composedUserMessage`
   verbatim against the new traces.

5. **WP-E after WP-D** (Visible-object format bench). **Probe-gated:
   WP-E requires green D2 sign-off** (de-risking.md cohort-sizing
   pilot) before commit. Probe runs across JSON-style, YAML-style, and
   (stretch) keyed-inline on the same fixed-seed cohort. Measure
   tokens + tool-call-pass-rate (canonical: `rawArguments == decision`,
   intent §4) + no-op rate. Pin the winner. **Gate:**
   `visible-format-bench.md` records the data; the chosen format is
   the default in `inputBuilder.ts`.

6. **WP-F after WP-D, can overlap WP-E** (lever probe). Parameterise
   `max_output_tokens` via the `matches` row (mirrors the existing
   `reasoningEffort` plumbing). Probe 1200 vs 1500 (and 2000 if 1500
   doesn't move the needle); probe `reasoning.effort` "low" vs "medium".
   Pin chosen values. **Gate:** the chosen values are recorded with the
   data that justified them.

7. **WP-G closing-10 pass.** 10 runs on the redesigned substrate with
   the chosen Visible format + max_output_tokens + reasoning.effort.
   Aggregate phase-3-carry-over + no-op rate into a phase-4 report row
   (`reportType: "phase-4-closing-10"`). Write `PHASE-4-CLOSURE.md`.

**Reviews go *before* the phase closes**, not after — mirroring the
phase-1/2/3 rhythm. A code-review pass before WP-G's harness run
catches any drift from the intent-anchor prose.
