# Phase 02 — De-risking

> Single load-bearing unknown for this phase: **does the
> position-reconstruction walk produce correct entity state at every
> turn for every matchId in the closing-50 set?**
>
> Everything else in WP-A through WP-D is plumbing — typed query bindings,
> an SVG grid render, hash routing, hover cards, modal sheets. None of
> those need a spike; they're either trivially correct or trivially fixed
> on first UAT.
>
> The reconstruction walk is the one place where a subtle bug would
> silently corrupt the user's intuition. The user looking at a wrong
> position for `Player_4` on turn 23 and forming a wrong vibe-judgement
> about persona behaviour is the failure mode this de-risking exists to
> prevent.

---

## 1. Reconstruction walk — failure modes and tests

The walk's contract is in `architecture-decisions.md` §4. The failure
modes below are enumerated from a careful trace of the 8-phase resolver
in `concept-spec.md` §23 against the schema validators in
`convex/schema.ts`.

### 1.1 Stationary character (no `kind:"none"` move entry)

**Failure mode.** When `decision.move.kind === "none"`, the engine emits
NO entry in `resolution.moves[]` for that actor. A naive walk that only
applies entries from `resolution.moves[]` will leave the character at
its *previous* position correctly — but only if the walk's data model
is "previous snapshot, mutated by entries from this turn", not "rebuild
from this turn's entries alone".

**Test (Vitest).** Synthetic 2-character bundle. Character A has a move
on turn 1. Character B has `kind:"none"` (no entry in moves). Assert
B's position is unchanged from turn 0 to turn 1.

**Already covered by:** `reconstruct.ts` design — accumulator pattern
("previous snapshot, mutated by this turn's entries"), not "rebuild
from scratch".

---

### 1.2 Death timing — corpse appears at the actor's *current* position

**Failure mode.** Per `concept-spec.md` §23 phase 6 ("Death and loot
phase"), corpses are placed at the actor's *current* position (post-
movement, post-action). If the walk applies deaths *before* movement,
the corpse appears at the wrong tile. Conversely, if a character moves
on turn N and dies on turn N, the corpse should be at turn-N's `to`,
not turn-N-1's position.

**Test (Vitest).** Synthetic bundle: character A at (5,5) moves to
(8,5) on turn N (move entry: `from:(5,5) to:(8,5)`), then dies on the
same turn (death entry). Assert corpse position at turn N is (8,5),
not (5,5).

**Engine behaviour to mirror.** The walk applies in this order:
moves → actions → deaths → visibilityUpdates. Same as
`concept-spec.md` §23.

---

### 1.3 Chest open / loot timing

**Failure mode.** A chest opened on turn N should be `opened: true` for
all turns ≥ N. The walk must persist the flip across turn iterations.
A regression where the walk forgets to carry the open flag forward
would silently revert chests to closed on subsequent turns.

**Test (Vitest).** Synthetic bundle: action on turn 3 opens chest_001.
Assert `reconstruct(bundle, 5).chests[0].opened === true`.

---

### 1.4 Hidden flag from `visibilityUpdates`

**Failure mode.** `visibilityUpdates[].hidden` is the hidden state for
the named character at the end of the turn (after the visibility-update
phase per §23.7). The walk must apply it *last* in the turn iteration
so a character that revealed itself by attacking on the same turn
shows `hidden: false` even if it was hidden before.

**Test (Vitest).** Synthetic bundle: character A is hidden at turn N.
On turn N+1, A attacks and triggers a `visibilityUpdates` entry with
`hidden: false, revealedBy: "attack"`. Assert
`reconstruct(bundle, N+1).characters[A].hidden === false`.

---

### 1.5 Initial position determinism

**Failure mode.** The walk reads `characters[].spawnIndex` and looks up
`maps/reference.json`'s `spawns[spawnIndex]` for the turn-0 position.
If `spawnIndex` is missing on a character row (it's an indexed `number`
in the schema, but a defensive walk should still fail loud), the walk
should throw rather than silently anchor at (0,0). The closing-50 set
guarantees `spawnIndex` is present, but defensive failure surfaces
phase-1 invariant violations explicitly.

**Test (Vitest).** Synthetic bundle with one character missing
`spawnIndex`. Assert the walk throws with a clear error message naming
the offending character.

---

### 1.6 Idempotency of `reconstruct(bundle, T)`

**Failure mode.** If the walk uses any closure-captured state (a
mutable accumulator outside the function scope), `reconstruct(bundle,
T)` called twice could produce different results. The walk must be
purely-functional: same input bundle and turn → same snapshot every
time, with no order dependence on prior calls.

**Test (Vitest).** For a fixture bundle, assert
`structuralEqual(reconstruct(bundle, 30), reconstruct(bundle, 30))`
when called twice in succession. Then assert backward jump:
`reconstruct(bundle, 30); reconstruct(bundle, 10);` produces the same
snapshot at turn 10 as a single fresh `reconstruct(bundle, 10)` call.

---

### 1.7 Corpse contents consistency — RETIRED via worldState.corpses[] fallback

**Status.** Retired during phase-2 closure-readiness reconciliation
(parallels the D-P2-12 chest-contents fallback in
`architecture-decisions.md` §10).

**Why retired.** The walk in `apps/replay/src/lib/reconstruct.ts`
does NOT derive corpse contents at all — `SnapshotCorpse` is
`{characterId, pos}` only. The hover card reads contents *directly*
from `bundle.worldState.corpses[]` (engine-authored truth) at
`apps/replay/src/components/HoverCard.tsx:338-339` via
`bundle.worldState?.corpses.find(c => c.characterId === characterId)`.
There is no walk-side inference to be consistent with, so there is
nothing to test for divergence. The originally-feared failure mode —
the walk's equipment-state inference drifting from the engine's
authoritative `worldState.corpses[]` — does not exist because the
inference does not exist (locked by D-P2-11 / ADR §4 walk caveat:
equipment + HP are NOT derivable from the ledger; corpse contents
read from the engine-authored snapshot).

**Consequences.** No Vitest test owed for §1.7. The corpse-hover
display is a thin pass-through of `worldState.corpses[]`, which the
phase-1 substrate writes during the engine's death/loot handling and
is the same data surface the live-integration test would have
verified against. WP-D's HoverCard implementation is the test surface
(component-level rendering of the engine-authored data).

**Cross-reference.** Identical resolution shape to D-P2-12
(opened-chest contents not persisted): when the engine owns the
authoritative state and the renderer reads it directly, no walk-side
test is needed.

---

### 1.8 Extracted character disappearance

**Failure mode.** Extraction is **not an action** in the resolution
trace — `convex/engine/resolution.ts:711-723` performs it as a phase-8
mutation that sets `characters[c].extractedAtTurn = EVAC_EXTRACT_TURN`
(50) for every character standing inside the evac zone on turn 50.
There is **no `kind: "extract"` entry** in `resolution.actions[]`; an
earlier draft of this plan referenced `harness/analyze-match.ts:55`,
which checks for a literal that the engine never emits. A walk that
relies on the missing action kind would never mark anyone as
extracted; the renderer would keep them on the grid forever.

**Resolution (locked by ADR §4 walk rule 4 / D-P2-20).** The walk reads
extraction from `bundle.characters[c].extractedAtTurn` (the terminal
characters[] row, written by phase-8 mutation). For each `c`, if
`c.extractedAtTurn !== null` and `c.extractedAtTurn <= atTurn`, mark
`snapshot.characters[c].extractedAtTurn = c.extractedAtTurn`. The
token is hidden from the grid for `t >= extractedAtTurn` — i.e.
visible BEFORE `extractedAtTurn`, hidden AT `extractedAtTurn` and
after.

**Why hidden AT, not after.** Engine extraction is phase 8 (last) of
the turn — `convex/engine/resolution.ts:711-723` mutates
`characters[c].extractedAtTurn = state.turn` for every character
inside the evac zone, then increments to `state.turn + 1`. The
*post-resolution* snapshot at turn N (the snapshot the user sees when
they slide to turn N) therefore legitimately omits any character that
got extracted during turn N's phase 8: the extraction has already
happened in-trace, so the grid view at turn N reflects the world
*after* extraction completed. Renderer filter at
`apps/replay/src/components/Grid.tsx:207-212` matches this:
`c.extractedAtTurn <= snapshot.turn` → hidden.

**Test (Vitest).** Synthetic bundle: character A has
`extractedAtTurn: 50` on the terminal characters row. Assert
`reconstruct(bundle, 50).characters[A].extractedAtTurn === 50` and
that the snapshot's grid filter (`extractedAtTurn === null || extractedAtTurn > snapshot.turn`)
excludes A from the live-tokens list at turn 50 and any later turn.
Assert the same character is still on the grid at turn 49.

---

### 1.9 Turn 0 is synthetic — turn-number keying, not array-index

**Failure mode (locked by D-P2-13).** Phase 1's
`convex/runMatch.ts:461` sets `currentTurn = matchRow.turn + 1`; the
first `turns` row written to the ledger is `turn === 1`. The
pre-turn-1 state (spawn positions, no actions, no agentRecords) is
therefore **not represented as a row in the ledger**. Any UI code that
indexes by array position (`bundle.turns[currentTurn]`,
`slider 0..bundle.turns.length-1`) will be off-by-one against the
turn the user thinks they're looking at.

**Resolution.** The walk + UI key turns by **turn-number**, not array
index:

- The walk constructs `turnRowByTurn = new Map<number, TurnRow>()` once
  per bundle resolve, keyed by `row.turn`.
- For `currentTurn === 0`, the walk synthesises the snapshot from
  `characters[].spawnIndex` × `maps/reference.json`'s `spawns[]` —
  **no ledger row consulted**. The UI feed renders "Pre-turn / spawn
  positions, no decisions".
- For `currentTurn >= 1`, the walk applies `turnRowByTurn.get(t)` for
  `t = 1..currentTurn`. Slider range is `0..bundle.match.turn`
  (inclusive of synthetic turn 0).

**Test (Vitest).** Synthetic bundle whose `turns[]` array starts at
`turn === 1` (mirroring the engine). Assert
`reconstruct(bundle, 0)` returns spawn positions with no
ledger-derived state. Assert `reconstruct(bundle, 1)` applies
`turnRowByTurn.get(1).resolution`. Assert
`reconstruct(bundle, 0).characters.length === bundle.characters.length`
and that the synthetic turn 0 has no `diedAtTurn` / `extractedAtTurn`
set.

**Test (live integration, gated by `LIVE_CONVEX`).** Load a
closing-50 bundle. Assert `bundle.turns[0].turn === 1` (no row at
turn 0). Assert `reconstruct(bundle, 0)` produces 8 agents at the
spawn positions documented in `maps/reference.json`.

---

## 2. Manual UAT checklist (before phase closure)

After WP-D lands, the user (or a reviewing agent in their stead) runs
this checklist against three closing-50 matches:

- [ ] Match picker loads in <1 s and shows ≥ 3 matches.
- [ ] Click a match row → replay route loads in <2 s.
- [ ] Turn 0: 8 agents at the 8 ring spawns surrounding the central
      evac arena (per `maps/reference.json`, coordinates
      (28,28)..(48,48) — interior ring, not 100×100 perimeter), no
      corpses, all chests closed, evac ring centred at (47..49, 47..49).
- [ ] Slider scrubs 0 → 50 and back without visual artifacts.
- [ ] At each turn, the side-panel feed shows 8 rows (or fewer if
      agents have died) with English decision summaries that read
      naturally.
- [ ] Hovering an agent shows persona, displayName, position, and
      decision summary. Equipment + HP show "see expand panel"
      (D-P2-11).
- [ ] Hovering a closed chest at turn 0 shows "closed". Hovering an
      opened chest at the terminal turn shows "opened (turn N)" plus
      "contents not persisted" (D-P2-12).
- [ ] Click "..." on a feed row → modal shows persona prompt + system
      prompt + visibleStateDigest + scratchpad + LLM trace; all are
      copy-to-clipboard.
- [ ] Persona prompt in the modal matches what was set when the match
      ran, NOT necessarily what's in `personas/*.md` today (per ADR
      §7 — historical capture).
- [ ] User can form a vibe-judgement: "are these minds messy in the
      way the design pillars promise?"

If any item fails, file a follow-up WP and do not close the phase.

---

## 3. What is NOT a load-bearing unknown

Calling these out so they don't get accidentally promoted to "needs a
spike":

- **Convex `usePaginatedQuery` ergonomics.** Documented; standard.
- **SVG rendering of ~100 nodes.** Trivially fast; no spike needed.
- **Hash routing.** A 30-line custom hook; no spike needed.
- **Vite + Convex client wiring.** `VITE_CONVEX_URL` env var; standard.
- **Decision-as-English vocabulary.** Locked in ADR §5 from
  `convex/engine/resolution.ts:374-586` per D-P2-14
  (`dmg N` / `no_target` / `out_of_range` / `opened` /
  `already_opened` / `no_chest` / `looted` / `no_corpse`). No spike;
  the table is the contract.
- **React + TypeScript + Convex codegen interop.** Convex's
  `_generated/api.d.ts` is the canonical surface; types flow.
- **Persona colour palette.** Pick 8 high-contrast colours; trivial.
- **The user's Convex dev deployment URL.** They have one; they ran
  the closing-50 against it.

These are noted only to avoid over-engineering the de-risking story.
The walk is the unknown; everything else is craft.

---

## 4. Reasoning policy / engine policy

**Phase 1 carry-overs that this phase respects but does not change:**

- Reasoning effort baseline `"low"` — locked by phase-1
  `de-risking.md` "Reasoning policy". Phase 2 v0 does not run any LLM
  calls and does not modify this knob.
- `previous_response_id` lives within a turn, never between turns —
  locked by `azure-llm.md` §7. Phase 2 v0 does not run any LLM calls
  and does not interact with this contract.
- The scratchpad is the only persistent inter-turn memory — locked by
  `concept-spec.md` §2A.2. Phase 2 v0 reads the captured scratchpad
  text but does not modify it; reads from
  `agentRecord.scratchpadBefore` and `scratchpadAfter` only.

---

## 5. Cross-references

- `architecture-decisions.md` §4 — full reconstruction-walk contract.
- `architecture-decisions.md` §5 — decision-as-English contract.
- `work-packages.md` WP-B — owns reconstruction tests.
- `work-packages.md` WP-C — owns decision-as-English tests.
- `concept-spec.md` §23 — resolution order the walk mirrors.
- `convex/schema.ts` — schema source of truth; bundle types are
  expressed via `Doc<T>` aliases from `convex/_generated/dataModel`
  (per ADR §7 / M3).
- `convex/engine/resolution.ts:374-586` — canonical source of the
  result-string vocabulary the renderer parses (per D-P2-14).
- `convex/engine/resolution.ts:711-723` — phase-8 extraction mutation
  (extraction is NOT a `kind:"extract"` action — per D-P2-13/§1.8).
- `convex/runMatch.ts:461` — `currentTurn = matchRow.turn + 1`; the
  first ledger row is `turn === 1` (D-P2-13 / §1.9).
- `harness/analyze-match.ts` — phase-1 CLI counterpart. **Stale**
  with respect to result strings (per D-P2-14 — do not use lines
  49-58 as a vocabulary reference; the canonical source is
  `convex/engine/resolution.ts`).
