# Per-Turn Context — User Intent Sketch (Canonical)

> **Status:** Iteration 2 (2026-05-12). Hand-crafted by the user
> (Outcome Steward). Supersedes the 2026-05-11 iteration-1 sketch.
> This document is a **near-exact signal of intent** for the per-turn
> LLM context. Do not refactor the prose into other shapes —
> variations and tradeoffs go in the executing phase's plan; the
> *intent anchor* lives here.

Iteration-2 tightens iteration-1 after stepping through phase-3
replays and the schema-emission probe of 2026-05-12. The six moves:

0. **Persona name = agent id.** The 8 personas (Rat / Duelist / Trader
   / Opportunist / Paranoid / Camper / Sprinter / Vulture) replace the
   `Player_N` numeric ids everywhere — in the kill feed, the personal
   damage feed, the visible object, status block, `<Player Name>`
   placeholder substitution, attack/loot `targetId`, and corpse ids
   (`Corpse_Camper`). One match has one of each persona. Names are
   single-word and id-safe; no separate type-safety layer needed for
   POC. This is the model-attention strategy: agents *are* characters
   with names, not numbered participants.

1. **Tool shape collapsed.** `primary` + `move` + `action` +
   `overwatch_stance` + `consume` → `use` + `position` + `action` +
   `say` + `scratchpad`. Position commitment (`overwatch` / `counter`
   / `move`) replaces the primary/move pair and folds `overwatch_stance`
   into first-class kinds. `consume` simplifies to `use: "consumable"
   | null` — the engine knows what's equipped. See
   [`decision-tool-schema-draft.md`](./decision-tool-schema-draft.md).

2. **Compass-only direction.** `relative dx/dy` removed — too easy
   for the model to mis-emit, and Visible already reports bearings as
   8-way compass. Schema vocabulary now mirrors what the model is
   reading.

3. **Status block.** "Your stuff" (position, HP, equipment,
   scratchpad) collapses into a single `## Status` section with
   emoji glyphs. Equipment carries stats inline so the model doesn't
   need to remember weapon damage or consumable effect.

4. **Event log under Current Game State.** Last-turn own-outcome,
   incoming-damage feed, and global kill feed are flat event lines
   under `# Current Game State`. The iteration-1 `## previous turn`
   section is gone — temporal framing folds into a single
   "snapshot-now-with-recent-events" view.

5. **Per-turn schema variants.** New principle: narrow the tool
   schema to current-state truth where cheap. First application:
   narrow `use` to `null`-only when nothing is equipped — pushes
   "consume without consumable" from validator-rejection-land into
   structurally-unrepresentable-land. Validator rejection that still
   slips through is **field-scoped** (zero one field, don't reject
   the whole turn).

---

## 1. System role (verbatim intent)

```
You are <Player Name>, extraction-arena agent. Each turn, emit ONE tool call to `decide_turn`.
Match shape:
- 7 other agents competing for the prize pool.
- 50 turns. Turn 30 reveals evac zone. Turn 50 extracts living agents inside the 3×3 zone and splits the prize. Outside evac at turn 50 you are incinerated.
- Walls block LOS and movement.
- Cover hides you from other agents' vision (revealed by enemy within 2, attacking, speaking, looting, consumable).
- Move range max 8 dist + Attack/loot range 2 = move attack/loot 10.
```

The `<Player Name>` placeholder resolves to the agent's persona name
(e.g. `Duelist`) per move 0 above.

Changes vs. iteration 1:

- **Named self.** Opens `You are <Player Name>, extraction-arena
  agent.` Pillar-aligned — agents are characters with names, not
  anonymous deciders. The placeholder is the agent's id (e.g.
  `Player_5`) used both internally and in the kill feed.
- **Walls split into its own line.** Phase-3/iter-1 chained walls and
  cover in one sentence; iter-2 separates for legibility.
- **Cover-reveal list trimmed.** `leaving cover` dropped — redundant
  ("you're not in cover anymore" is self-evident). `speaking`,
  `looting`, `consumable`, attacking, enemy-within-2 retained.
- **New combo-range line.** `Move range max 8 dist + Attack/loot range
  2 = move attack/loot 10.` Teaches the chain math explicitly so the
  model can plan `position.move.toward` + `action.attack` against
  targets up to 10 tiles distant.
- **Output-discipline tail still gone.** No "invalid choices replaced
  with safe default" — the prompt-hygiene fix from iteration 1 holds.

Action-grammar teaching (move arms, action arms, overwatch semantics,
scratchpad usage) lives entirely in the tool schema's `description`
fields (see §5). The system prompt does not duplicate it.

## 2. User role (verbatim intent)

Concrete example — agent is `Duelist`, turn 44:

```
# Duelist
You adopt Duelist persona:
<persona prompt>

## Status
📍(44,53)
❤️HP: 35/50 HP
⚔️weapon: rusty_blade [dmg 10]
🛡️armour: none
🧪consumable: speed [+4 move range max dist]
🗒️scratchpad: Armed rusty_blade. Pressure Vulture now. Close to range 2 and keep attacking until down.


# Current Game State
Turn 44, 3/8 players alive
You moved 2 SE, attacked Vulture (dmg 10)
Camper attacked you with hammer (dmg 8)
Trader killed Rat with axe

{visibleObj...}
```

**Ownership split, not temporal split.** Iteration 1 separated
"previous turn" from "now"; iteration 2 separates "your stuff" from
"the world."

1. **Who you are** — `# <Player Name>` heading + persona prompt.
2. **Your stuff** — `## Status` — position, HP, equipment, scratchpad.
   Private state.
3. **The world** — `# Current Game State` — turn meta, event log,
   spatial perception (Visible).

### Status section semantics

Each line is glyph-prefixed for skimmability:

- `📍(X,Y)` — current position. Static state. (Iter-1 fused last-turn
  outcome here; iter-2 moves outcome to Current Game State so the 📍
  line never lies on "you got hit but didn't move" turns.)
- `❤️HP: cur/max HP`
- `⚔️weapon: <name> [stats]` — inline `[dmg N]`.
- `🛡️armour: <name | none> [stats]`
- `🧪consumable: <name | none> [effect]` — inline `[+4 move range max
  dist]`. When nothing is equipped, the schema's `use` field narrows
  to `null`-only per
  [`decision-tool-schema-draft.md` §3.1](./decision-tool-schema-draft.md#31-per-turn-variant--no-consumable-equipped).
- `🗒️scratchpad: <prior-turn text>` — the agent's own notes carried
  forward. `scratchpad: null` in the next decision keeps this value
  unchanged.

### Current Game State semantics

A top-level "snapshot now" header containing flat event lines plus
the Visible object:

- `Turn N, M/8 players alive` — match meta.
- `You moved 2 SE, attacked Player_7 (dmg 10)` — your own outcome
  last turn. Emitted as joinable fragments (move outcome, action
  outcome, said). Renders `no-op` if every fragment is null.
- `Player_3 attacked you with hammer (dmg 8)` — incoming damage,
  local to you, with attacker + weapon attribution. Emitted only when
  you took damage this turn. **NEW affordance** — closes the
  phase-3 outcome-attribution gap when the attacker is out of LOS.
- `<killer> killed <victim> with <weapon>` — global kill feed. One
  line per kill on the prior turn. Broadcast independent of LOS.
- `{visibleObj…}` — keyed visible object (see §4).

The event log reads top-down as a tight chronology of "what mattered
since last turn": your own action → what hit you → who died globally
→ what you can see now.

## 3. Personal and global event channels

Iteration 2 introduces a *paired* feed structure: events are scoped
either globally or personally. Both broadcast match-meta knowledge
that does not depend on LOS.

**Global (broadcast independent of LOS):**

- `<killer> killed <victim> with <weapon>` — one line per kill on the
  prior turn (BR-genre convention).
- `Turn N, M/8 players alive` — match-meta.

**Personal (local to you, but LOS-independent for the *attribution*):**

- `You moved 2 SE, attacked Player_7 (dmg 10)` — your own outcome.
- `Player_3 attacked you with hammer (dmg 8)` — incoming damage with
  attacker + weapon attribution. Surfaces only when you took damage.

**Still vision-gated:**

- Positions of others, HP-of-others, last-seen states — all in Visible.

Why the personal damage feed is new:

- Phase-3 closed with outcome attribution 88.6%; the residue was
  largely "agent doesn't know why HP dropped because attacker is out
  of LOS." Surfacing `Player_3 attacked you with hammer` even when
  Player_3 is out of LOS closes the loop without leaking positions.
  The model can react to *who* hurt you (revenge, fear, retreat-from-
  Player_3) without seeing *where* they are.
- The line shape mirrors the kill feed (`<actor> <verb> <target> with
  <weapon>`). Same pattern, two scopes — easy for the model to
  pattern-match both.

Why the global kill feed is retained:

- Pillar 6 (emergent diplomacy): trader / opportunist / rat behaviour
  hinges on knowing who's left without seeing them.
- Pillar 5 (text is terrain): weapon name in kill / damage lines is
  the cursed-item-naming seam.

## 4. Visible object format (parse mode)

Unchanged from iteration 1. The Visible object is still a
self-descriptive keyed shape; serialisation (JSON / YAML /
keyed-inline) remains an empirical probe.

The 8-bearing compass vocabulary used in Visible (`dist 7 SE`) is now
mirrored in the tool schema's `position.move.direction` compass arms.
The model perceives and emits direction in the same vocabulary.

## 5. Tool schema carries the action grammar

The schema is the canonical grammar surface. The system prompt does
not teach action arms in English.

See
[`decision-tool-schema-draft.md`](./decision-tool-schema-draft.md)
for the verbatim iteration-2 tool definition. Highlights:

- `use: "consumable" | null` — the engine knows what's equipped; the
  model just signals "use it or don't." Narrows to `null`-only when
  nothing is equipped (per-turn schema variant).
- `position` is a discriminated union: `{kind:"overwatch"|"counter"}`
  (stationary, reactive — `overwatch` fires on first valid in-range
  enemy; `counter` only retaliates) or `{kind:"move", direction,
  dist}`. Direction is target-relative (toward/away an entity) or
  compass (8 bearings). `dist` is *maximum attempted distance* —
  target-relative moves stop at the entity's useful range.
- `action` is a discriminated union: `{kind:"none"}` or
  `{kind:"attack"|"loot", targetId}`. Attack/loot share `targetId`;
  engine dispatches by id namespace.
- `say: string | null` — broadcast speech this turn; reveals you if
  hidden in cover. Pillar-5 / pillar-6 mechanism for prompt-injection
  through agent text and emergent diplomacy.
- `scratchpad: string | null` — `null` carries the prior scratchpad
  forward unchanged (no overwrite). Iter-1's `scratchpad_update`
  "write or clear" semantic is dropped.

## 6. Diagnostic surface (replay UI)

Iteration-1's diagnostic gaps carry forward; iteration 2 adds two:

1. `rawArguments` vs. `decision` divergence (matched / diverged).
2. `validatorReason` surfaced when the engine zeroed a field.
   **NEW under iteration 2:** validator rejection is **field-scoped**
   — `use:"consumable"` with nothing equipped invalidates only `use`,
   not the whole turn. The replay UI must render which field(s) were
   zeroed and why.
3. `usage.output_tokens` vs. `max_output_tokens` cap with truncation
   indicator at ≥ 95%.
4. **Tool schema pane must show the per-turn variant actually
   shipped.** Static schema reference is insufficient — the `use`
   field's shape changes turn-to-turn based on equipped state.

## 7. Levers to experiment with

In scope for the executing assignment:

- **`max_output_tokens`** — current 1200. Probe higher against
  truncation rate and no-op rate.
- **`reasoning.effort`** — current "low". Probe "medium" against
  per-call latency and reasoning capture rate.
- **Visible object format** — JSON / YAML / keyed-inline, per §4.
- **Persona prompt budget** — orthogonal; surface for future
  iteration but not load-bearing for this slice.

## 8. Success criteria

1. Iteration-2 context changes in §1–§5 land in production.
2. Diagnostic surfaces in §6 are live in the replay UI.
3. Token-usage and tool-call-pass-rate bench documented for the
   `use`-variant on/off case and Visible-object shapes.
4. Final 10-run pass the user can step through in the replay UI with
   **< 5% no-op turns** (`action.kind === "none"` AND
   `position.kind` not in `{move}` with non-zero `dist`, summed
   across all agents across all turns).
5. No regression against the phase-3 closing thresholds (extraction
   ≥ 30%, kill ≥ 80%, etc.) — verified on the same 10 runs or a
   follow-up 50-run if vibe is uncertain.
6. Zero traces where `use:"consumable"` was emitted with nothing
   equipped — the per-turn variant principle must work.

---

*This document is the intent anchor for the executing phase. Plan,
specs, and work-package docs may elaborate but must remain faithful
to the structure and prose intent captured here.*
