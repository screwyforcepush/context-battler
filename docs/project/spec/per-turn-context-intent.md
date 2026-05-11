# Per-Turn Context — User Intent Sketch (Canonical)

> **Status:** Hand-crafted by the user (Outcome Steward) on 2026-05-11. This
> document is a **near-exact signal of intent** for the per-turn LLM context
> redesign that follows phase 3. Do not refactor the prose into other shapes
> — variations and tradeoffs go in the executing phase's plan; the *intent
> anchor* lives here.

This sketch lands four moves at once:
1. **System role** carries the game's stable rules (the referee speaking).
2. **Tool schema** carries the action grammar (move/action arm descriptions,
   movement range, scratchpad usage hint) — self-descriptive so the system
   prompt doesn't need to teach it.
3. **Visible** becomes a self-descriptive object (push the model into "parse
   mode") with keyed fields, not unkeyed bracketed prose.
4. **Per-turn narrative** has explicit sections in deliberate order:
   `## previous turn` (outcome + scratchpad + global kill feed) →
   `# Current Game State` (turn, alive count, You: line, Visible).

---

## 1. System role (verbatim intent)

```
You are an extraction-arena agent. Each turn, emit ONE tool call to `decide_turn`.

Match shape:
- 7 other agents competing for the prize pool.
- 50 turns. Turn 30 reveals evac zone. Turn 50 extracts living agents inside the 3×3 zone and splits the prize. Outside evac at turn 50 you are incinerated.
- Walls block LOS and movement; cover hides you from other agents' vision (revealed by enemy within 2, attacking, speaking, looting, consumable, or leaving cover).
```

Notes on what's deliberately **gone** vs. phase-3:

- **"How to read Visible:" section** — removed. The Visible object is
  keyed and self-descriptive; no glossary needed.
- **"How to act on Visible:" section** — removed. Action grammar lives in
  the tool schema's `description` fields (move arms, action arms, overwatch).
- **"Output discipline" section** — removed. Telling the model "invalid
  choices are replaced with the safe default" teaches it that emitting
  nonsense has a graceful fallback. That's the opposite incentive to what
  we want. Downstream handling stays downstream; the prompt only tells the
  model what a legitimate response is.
- **Vision/movement/attack tunables in the system prompt** — moved into the
  tool schema property `description` fields. `Movement range max 8 dist or
  abs(dx+dy) (12 w/ speed)` goes on the `move` arm's description.
  `Use scratchpad for core memories and multi turn objectives` goes on the
  `scratchpad_update` description.

What's **new** / clarified vs. phase-3:

- **Stakes framing** — "7 other agents competing for the prize pool" sets
  the social stakes up front.
- **Cover affordance is finally explained.** Phase-3 told the model what
  cover *doesn't* do (block LOS) but never what cover *does* do. Per
  `convex/engine/hiding.ts:30-36`, cover is the hide affordance: standing
  on a cover tile makes you `hidden`, revealed by enemy-within-2 proximity,
  attacking, speaking, looting, consumable, or leaving cover.
- **Walls block movement.** Phase-3 covered this implicitly via the
  `blockedBy: "wall"` last-turn-line marker; system prompt now states it
  explicitly.

## 2. User role (verbatim intent)

```
You adopt player persona:
<persona>

## previous turn
You: moved 2 SE, attacked Player_7 (dmg 10)
Scratchpad: Armed rusty_blade. Pressure Player_7 now. Close to range 2 and keep attacking until down.
Player_2 killed Player_1 with axe

# Current Game State
Turn 44, 3/8 players alive
You: at (44,53), 35/50 HP, rusty_blade / — / —, not in evac zone

{visibleObj...}
```

**The ordering is deliberate.** The user explicitly called this out:
"my sketch is highly deliberate in structure and prose. separation of game
state vs visible obj (visibleObj is still under the gamestate heading), and
the previous turn with scratchpad → current game state narrative."

Read it as a temporal narrative:
1. **Who you are** (persona) — character first.
2. **What just happened to you** (`## previous turn` — own outcome, then
   what you wrote in scratchpad, then global kill events).
3. **What is now** (`# Current Game State` — turn, alive count, You: line,
   Visible object).

`{visibleObj…}` sits under the `# Current Game State` heading; it is the
spatial-perception slice of "what is now", not its own top-level section.

### Section semantics

- `## previous turn` → renamed from phase-3's `Last turn (you):` line.
  Subsumes three sub-fields:
  - `You: <outcome fragments>` — same as phase-3 last-turn-line content
    (move outcome, action outcome, damage from whom, said). Renders
    `no-op` if every fragment is null.
  - `Scratchpad: <prior-turn text>` — the agent's own notes from the
    turn that just ended. (Phase-3 called this `## Scratchpad` at the
    user-message level, which was ambiguous against the `scratchpad_update`
    tool field — that ambiguity is gone.)
  - **Global kill feed** — one line per kill that happened on the prior
    turn: `<killer> killed <victim> with <weapon>`. **NEW affordance**;
    see §3 below.

- `# Current Game State` → a top-level "snapshot now" header:
  - `Turn N, M/8 players alive` — match-meta. Turn number was implicit
    in phase-3; alive count is **new** (global stat, see §3).
  - `You: at (X,Y), HP/maxHP, weapon/armour/consumable[, in/not in evac zone]`
    — same as phase-3 You: line.
  - `{visibleObj…}` — keyed visible object (see §4).

## 3. Global game events (new design surface)

`Player_2 killed Player_1 with axe` and `M/8 players alive` are a
**deliberate departure from strict fog-of-war.** Currently kill knowledge
is local: you only know `Player_2 attacked Player_X` if Player_2 was in
your Visible. Under this redesign, **kill events broadcast globally**
(BR-genre convention: kill feed is independent of LOS) while spatial
perception stays local.

Scope of the broadcast:
- **Yes:** `<killer> killed <victim> with <weapon>` — one line per kill
  on the prior turn.
- **Yes:** `M/8 players alive` — global alive count on the current turn.
- **No:** positions, HP, locations. Spatial info still requires vision.

Why this is aligned with the design pillars:
- Pillar 2 ("rules simple, minds messy") — adding the kill feed is a
  simple rule that unlocks rich persona behaviour (trader negotiates
  based on who's left, rat lays low after the feed thins, opportunist
  swoops on a survivor they never saw).
- Pillar 5 ("text is terrain") — the weapon name in the kill feed is
  exactly the kind of in-world text that can carry prompt-injection
  cargo (cursed item flavour text), foreshadowing phase-4+ work.
- North star: "does this make prompt-authored behaviour more
  interesting, legible, or exploitable?" — yes.

## 4. Visible object format (parse mode)

The current phase-3 digest renders bullet lines with **unkeyed bracket
observations**:
```
- Player_4, dist 7 S [HP~high, holding axe, attacked Player_2]
```

The redesign moves to a **keyed object** the model parses as data, not
prose. The exact serialisation (YAML vs JSON vs keyed-inline) is a
**probe to run** — empirically measure token cost and tool-call pass rate
on each.

Candidate shapes (illustrative — final shape decided by the probe):

**JSON-style:**
```
Visible: [
  {id:Player_4, dist:7S, hp:high, holding:axe, attacked:Player_2},
  {id:Chest_006, dist:5S, opened:false},
  {id:Wall_64_30, dist:4SW}
]
```

**YAML-style:**
```
Visible:
- id: Player_4
  dist: 7S
  hp: high
  holding: axe
  attacked: Player_2
- id: Chest_006
  dist: 5S
  opened: false
```

**Keyed-inline (terser):**
```
Visible:
- Player_4 dist:7S hp:high holding:axe attacked:Player_2
- Chest_006 dist:5S opened:false
```

Decision criteria for the probe:
- **Token cost** per typical-turn payload (representative sample of
  Visible sizes from phase-3 traces).
- **Tool-call pass rate** = `rawArguments == decision` (no schema-
  validation safe-defaults) over N runs holding persona/seed fixed.
- **No-op rate** = % of turns where the model emitted `kind:"none"` for
  both move and action with `primary:"stationary_action"`.

## 5. Tool schema carries the action grammar

The phase-3 system prompt teaches the move arms and action arms in
English. The same arms are **already declared as JSON Schema** in
`convex/llm/decisionTool.ts` and shipped to Azure on every request.
That's two encodings of the same contract, paid for in tokens, and
drift-prone.

Lean into the tool schema's `description` fields:

- **`decide_turn` (top-level description)** — keep the phase-3 description
  but augment with the overwatch-stance contract (phase-3 ADR §1).
- **`move` property** — add description: "Move arms: `relative dx,dy`
  (integers in [-12,12]); `toward_entity Player_N`; `away_from_entity
  Player_N`; `toward_object <Chest_NNN|Corpse_Player_N>`; `toward_evac`;
  `none`. Movement range max 8 (12 w/ speed)."
- **`action` property** — add description: "Action arms: `attack
  Player_N`; `loot <Chest_NNN|Corpse_Player_N>` (copy id verbatim);
  `none`. Attack/loot range 2 (Chebyshev)."
- **`primary` property** — describe the three values, including the
  overwatch dual relationship with `overwatch_stance`.
- **`overwatch_stance` property** — describe the offensive/defensive
  semantics and the null-when-not-overwatch contract.
- **`scratchpad_update` property** — add description: "Use scratchpad for
  core memories and multi-turn objectives. ≤ 500 chars. Carries forward
  to next turn as `Scratchpad:` under `## previous turn`."

The schema is shipped to the model on every request; descriptions reach
the model as part of the tool spec.

## 6. Diagnostic surface (replay UI)

Three observability gaps the current UI has:

1. **`rawArguments` divergence from `decision`.** Phase-3 persists
   `rawArguments` (the literal JSON string the LLM emitted) but the
   replay UI shows `agentRecord.decision` (the parsed/safe-defaulted
   version). On schema failure they diverge; the UI hides the divergence.
   **Fix:** render both, side by side, with a clear "matched" /
   "diverged" indicator. When they match, collapse to one pane.

2. **`validatorReason` is not surfaced.** The engine validator zeroes
   syntactically-valid decisions when the target is dead, out of range,
   etc. The reason is persisted but invisible in the UI. **Fix:** show
   `validatorReason` whenever it's set.

3. **`usage.output_tokens` vs. `max_output_tokens` cap.** Phase-3
   sets `MAX_OUTPUT_TOKENS = 1200` in `convex/runMatch.ts`. When the
   model exhausts the budget on reasoning tokens it may ship a minimal
   `none/none` tool call to satisfy `tool_choice: "required"`. **Fix:**
   show `usage.output_tokens / max_output_tokens` on every row; light
   up a "🔴 truncated" indicator when usage ≥ 95% of cap.

4. **Tool schema is not in `Full LLM Input` text.** The replay's
   `composeFullLlmInput` only shows system + user roles
   (`apps/replay/src/lib/rawPane.ts:33-46`). The tool schema is shipped
   on every request but never surfaced. **Fix:** add a fourth
   `--- tool schema ---` section, pretty-printed JSON.

## 7. Levers to experiment with

In scope for the executing assignment:

- **`max_output_tokens`** — current 1200. Probe 1500, 2000, 2500 against
  truncation rate and no-op rate.
- **`reasoning.effort`** — current "low". Probe "medium" against
  per-call latency and reasoning capture rate (phase-3 closed at 68.8%
  capture at "low"; "medium" should lift it).
- **Visible object format** — JSON / YAML / keyed-inline, per §4.
- **Persona prompt budget** — orthogonal; surface for future iteration
  but not load-bearing for this slice.

## 8. Success criteria for the executing assignment

1. All redesigned-context changes in §1–§5 land in production.
2. Diagnostic surfaces in §6 are live in the replay UI.
3. Token-usage and tool-call-pass-rate bench documented for JSON vs.
   YAML (and keyed-inline if cheap to include) Visible-object shapes.
4. Final 10-run pass that the user can step through in the replay UI
   with **< 5% no-op turns** (`primary:"stationary_action"` AND
   `move.kind === "none"` AND `action.kind === "none"`, summed across
   all agents across all turns of the 10 runs).
5. No regression against the phase-3 closing thresholds (extraction
   rate ≥ 30%, kill rate ≥ 80%, etc.) — verified on the same 10 runs
   or a follow-up 50-run if vibe is uncertain.

---

*This document is the intent anchor for the executing phase. Plan,
specs, and work-package docs may elaborate but must remain faithful to
the structure and prose intent captured here.*
