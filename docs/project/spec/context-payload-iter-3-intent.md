# Per-Turn Context — Iter-3 Intent Anchor

> User-hand-shaped intent for the per-turn substrate slice. Sibling to
> `per-turn-context-intent.md` (iter-2, phase 4 → phase 6) and
> `decision-tool-schema-draft.md`. The "why and shape" — implementation owns
> the how.

## Motivation

Phase 6 closed substrate-correct but Vision was over-sharing. The agent could
read every visible chest's `opened` flag, every corpse's `drained` flag and
remaining `contents`, every opponent's full `equipped` slot tree, and full
absolute `pos.x/y` for every entity in view. Most of that was leak from
engine-internal state into the LLM context surface.

Three problems compounded:

1. **Pillar 4 erosion.** Telling the agent which chests are `opened: true`
   and which corpses are `drained: true` makes the scratchpad redundant for
   the most common state-tracking task. The agent doesn't *need* to remember
   what it looted because the engine re-tells it every turn. Pillar 4
   (scratchpad-as-explainability) only carries weight when the substrate
   forces the agent to author its own memory.
2. **Pillar 5 underused.** Showing the agent every opponent's exact weapon
   and armour tier turns equipment into a perception channel. The whole
   *point* of pillar 5 (text is terrain) is that information about an
   opponent's loadout should propagate through speech, kill-feed weapon
   names, and corpse loot — channels that can lie, mislead, or carry
   cursed-item naming attacks.
3. **Token and byte cost.** ~70–120 chars of structural fat per Visible
   entry × ~8 entries/turn × 50 turns × 8 agents × 20 matches ≈ tens of
   MB of redundant prompt material per closing report, and a proportional
   per-call Azure input-token cost.

Two outcome-attribution gaps surfaced in parallel:

4. **Loot resolution silence.** When a loot action returned nothing (chest
   already opened, corpse drained), or returned a specific item, the
   outcome line said `looted chest_009 (opened)` — leaving the agent with no
   sense of *what* it acquired or what came back empty. The agent can't
   write a useful scratchpad note because the substrate didn't tell it the
   answer.
5. **In-range hearing lost.** A regression in the phase 4 / 6 rewrites:
   other players' speech is no longer delivered to the agent's per-turn
   context inside hearing range. Pillar 5 cannot function without this; the
   trader persona's entire reason to exist is broken. Restoring it is
   mandatory, not optional.

This iter-3 fixes all five.

## What lands

### 1. Vision shrinks (the keyed object, formerly `Visible:`)

Renamed to `Vision:` (markdown-header-then-data form, consistent with
`## Status` / `# Current Game State` siblings).

Each entry loses everything that wasn't carrying information the agent should
have. Specifically:

- **`kind` removed.** The id prefix (`Corpse_…`, `Chest_…`, `Cover_…`,
  `Wall_…`, `Evac`) is self-describing. Other players carry no prefix,
  which is fine — `Duelist`/`Trader`/etc. are unambiguous as character
  names.
- **`pos.x/y` removed.** Bearings and distances are the only spatial
  reasoning surface the model uses anyway; absolute coords were noise.
- **`opened` removed** from chests. Agent must scratchpad-track which
  chests it has visited.
- **`drained` removed** from corpses. Agent must scratchpad-track which
  corpses it has looted.
- **`contents` removed** from chests and corpses. Agent learns contents
  *only* by looting (and reading the outcome line — see §3).
- **Opponent `equipped` reduced to `armed: true|false`.** A boolean for
  whether the opponent has any weapon slot occupied. Armour tier,
  consumable presence, and weapon identity are no longer visible. They
  propagate via:
  - The global kill feed (`<Killer> killed <Victim> with <weapon>`).
  - In-range speech (truths and lies authored by other prompts).
  - Cursed-item flavour text on items the agent itself loots and equips.
  - Corpse loot — once you kill them, you can loot their gear, which
    you'll see in the outcome line.
- **`inZone` removed** from Evac. Replaced by a Status flag (§2).
- **Evac entry removed from Vision entirely when the agent is inside the
  evac zone.** Once inside, the Status flag is the only place evac is
  mentioned; spatial relation to evac is irrelevant.

What stays in each Vision entry:

- `dist` — integer Chebyshev distance.
- `bearing` — 8-compass (`N`/`NE`/`E`/`SE`/`S`/`SW`/`W`/`NW`).
- For characters only: `hp` — coarse bucket (`high`/`mid`/`low`); `armed` —
  boolean.

### 2. Status block additions and tweaks

- **Evac status line.** Append `Outside Evac` or `Inside Evac` to the
  position line. Now reads: `📍(52,44) Outside Evac`.
- **Player's own `📍(x,y)` absolute coord stays.** The agent needs a
  per-turn anchor for cross-turn movement reasoning (its own scratchpad
  references like "moved from 52,44 toward …"). Self-locating is fine;
  other-locating is not.
- **Unarmed shows damage.** Replace `⚔️weapon: none` with
  `⚔️weapon: unarmed [dmg 5]`. The 5 is the engine's `MIN_DAMAGE_FLOOR` /
  `UNARMED_BASE_DAMAGE` from `convex/engine/combat.ts` — explicit
  surfacing of the baseline so the model knows fistfighting is a real
  option.

### 3. Current Game State — feed restructuring

The own-outcome line stays as one line but loses speech and gains
loot-content:

- **Speech split out of the outcome line.** Outcome line is mechanical
  only: `You moved 1 NE, attacked Trader (out_of_range)`. The player's own
  speech becomes a separate feed event: `You said "no quarter given"`.
- **Loot resolution is verbose and honest.** Examples:
  - Successful chest loot: `You moved 1 NE, looted speed from Chest_53_54`.
  - Successful corpse loot: `You looted sword from Corpse_Duelist`.
  - Empty corpse (drained): `You looted nothing from empty Corpse_Duelist`.
  - Empty chest (already opened): `You looted nothing from empty Chest_53_54`.
  This is the only signal the agent gets that a lootable is exhausted —
  pillar 4 pressure is now load-bearing on this line.

Feed events appear in chronological order with the global kill feed and
inbound speech:

- `You said "no quarter given"` (own speech, chronological)
- `Trader said "Peace to all nearby. I'm taking the nearby crate…"` (inbound
  in-range speech — **regression restored**)
- `Camper killed Opportunist with sword` (kill feed, global, LOS-independent)

Inbound personal damage feed (phase-6 addition, kept):
- `<Attacker> attacked you with <weapon> (dmg N)` — LOS-independent.

### 4. Id namespace — chest rename engine-wide

Chests move from ordinal ids (`chest_012`) to coord-encoded ids
(`Chest_53_54`), matching cover (`Cover_53_43`) and walls (`Wall_52_40`).
This is a schema break:

- `worldState.chests[].id` shape changes.
- Loot action `targetId` references chests by coord-id.
- Replay UI references update.
- Engine resolution layer updates.

POC posture (`project_poc_schema_wipe_acceptable`) allows the dev DB wipe.
No migration shims. The two-namespace context-layer-alias alternative is
explicitly rejected — drift risk too high.

### 5. System prompt — evac countdown rephrasing

Replace:
```
- 50 turns. Turn 30 reveals evac zone. Turn 50 extracts living agents inside the and splits the prize. Outside evac at turn 50 you are incinerated.
```

With two phase-dependent lines:
```
- On turn 50, living agents Inside the Evac 3×3 zone are extracted and split the prize. You will be incinerated if outside Evac at turn 50.
```

Plus a countdown line whose text flips at turn 30:
- Pre-turn-30: `Evac location spawns in <N> turns` where N = `30 - turn`.
- Post-turn-30: `Extraction in <N> turns` where N = `50 - turn`.

After turn 50 the match is over; no further system prompt rendering needed.

The two-phase countdown is one less branch than a templated "Evac at (X,Y)
in N turns" line and keeps the spatial-position-revealing job inside Vision
where it belongs.

## Sample, before / after

**Before:**

```
## Status
📍(52,44)
❤️HP: 50/50 HP
⚔️weapon: rusty_blade [dmg 10]
🛡️armour: chain [-6 dmg]
🧪consumable: none
🗒️scratchpad: Turn 32: armed; Trader at dist 3 NE and wounded/mid HP. Close to range 2 with 1 step toward Trader, then strike. Continue vulture behavior.

# Current Game State
Turn 33, 8/8 players alive
You moved 1 NE, attacked Trader (out_of_range), said "no quarter given"
Camper killed Opportunist with sword

{
  "Duelist": { "kind": "character", "pos": {"x":53,"y":44}, "dist":1, "bearing":"E", "hp":"high", "equipped": {"weapon":"axe","armour":null,"consumable":null} },
  …
}
```

**After:**

```
## Status
📍(52,44) Outside Evac
❤️HP: 50/50 HP
⚔️weapon: rusty_blade [dmg 10]
🛡️armour: chain [-6 dmg]
🧪consumable: none
🗒️scratchpad: Turn 32: armed; Trader at dist 3 NE and wounded/mid HP. Close to range 2 with 1 step toward Trader, then strike. Continue vulture behavior.

# Current Game State
Turn 33, 8/8 players alive
You moved 1 NE, attacked Trader (out_of_range)
You said "no quarter given"
Trader said "Peace to all nearby. I'm taking the nearby crate and moving for evac, not looking for a fight. If you want to survive, call truce and come with me."
Camper killed Opportunist with sword

Vision:
{
  "Duelist": { "dist":1, "bearing":"E", "hp":"high", "armed":true },
  "Trader": { "dist":3, "bearing":"N", "hp":"mid", "armed":false },
  "Corpse_Sprinter": { "dist":6, "bearing":"SE" },
  "Chest_53_54": { "dist":10, "bearing":"S" },
  "Cover_53_43": { "dist":1, "bearing":"NE" },
  "Cover_42_53": { "dist":10, "bearing":"SW" },
  "Wall_52_40": { "dist":4, "bearing":"N" },
  "Evac": { "dist":2, "bearing":"SE" }
}
```

Inside-Evac variant: Status reads `📍(52,44) Inside Evac` and the `Evac`
entry is absent from `Vision:`.

## What this slice does NOT change

- The decision tool schema. Same five fields (`use`, `position`, `action`,
  `say`, `scratchpad`); same shapes. The agent's emission surface is
  unchanged.
- The persistence shape of `agentRecord.input.composedUserMessage` — still
  the full rolled user-role string. The slim form of Vision flows through
  end-to-end; nothing is "stripped at the boundary".
- Pillar 7 (state-is-contract). Engine still owns canonical state in
  Convex. The LLM context is a *projection* of that state, just a leaner
  one.

## Done bar

- Vision serialises with the reduced field set, named `Vision:` header,
  inside-evac suppression of the Evac entry.
- Status block carries the evac flag and the unarmed-damage line.
- Outcome line is mechanical-only; own speech is a separate feed event;
  inbound in-range speech is delivered as feed events.
- Loot outcome line names contents on success and flags empty-after-the-fact
  on failure.
- Chest ids are coord-encoded engine-wide; action targets resolve.
- System prompt carries the two-phase evac/extraction countdown.
- A 20-run iter-3 closing report (`reportType` per phase-7 dispatch)
  preserves phase-6 thresholds where they remain comparable (extraction ≥
  30%, kill ≥ 80%, equip ≥ 80%, speech ≥ 50%, persona spread ≥ 15 pp, zero
  crashes, zero illegal `use:"consumable"` emissions, ≥ 5 counter / ≥ 5
  overwatch trigger / ≥ 10 action+overwatch combos, all 8 compass bearings,
  zero `Player_N` literals, zero whole-turn validator zeroes).
- Phase-6's `noOpRate < 5%` gate is **deferred** to the behavioural
  diagnostics view (per `behavioural-diagnostics-intent.md`) which redefines
  the metric to separate armed-stance pause from true-stationary do-nothing.
  The substrate change here does not by itself reduce armed-stance pause
  rate, and is not asked to.

## Pillar accounting

| Pillar | Impact |
|---|---|
| 2 Rules simple, minds messy | Vision is ~50% smaller; the rules surface is blunter. |
| 4 Scratchpad as explainability | Scratchpad becomes *load-bearing* for lootable state tracking. Forced authorship. |
| 5 Text is terrain | Weapon/armour intel propagates only via speech, kill feed, and corpse loot — escalating prompt-injection / deception relevance. |
| 6 Build substrate; let strategy emerge | Less data exposed = more strategy authored. The "remember what's drained" pattern is now a player skill, not a free affordance. |
| 7 State is the contract | Unchanged. Engine state is canonical; the LLM context is a projection. |

## References

- `docs/project/spec/mental-model.md`
- `docs/project/spec/per-turn-context-intent.md` (predecessor — iter-2)
- `docs/project/spec/decision-tool-schema-draft.md`
- `docs/project/spec/behavioural-diagnostics-intent.md` (parallel slice)
- `docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md`
- `convex/engine/combat.ts` (unarmed base damage = 5)
- `convex/llm/inputBuilder.ts` (the current user-role composer)
- `convex/llm/systemPrompt.ts` (the current system prompt assembler)
