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

### 1.7 Corpse contents consistency with `worldState.corpses[]`

**Failure mode.** The walk derives corpse contents from the actor's
last-known equipped state — which is itself best-effort from action-
result parsing (per ADR §4 caveat). The phase-1 substrate ALSO
persists `worldState.corpses[]` as engine-authored truth. If the
walk's corpse contents diverge from `worldState.corpses[]` at the
final turn, the walk's equipment-state inference is buggy.

**Test (live integration, gated by `LIVE_CONVEX` env var).** Pick the
most-recent closing-50 match. Reconstruct at the terminal turn
(turn=match.turn). Assert that for every dead character, the walk's
inferred corpse contents match the corresponding entry in
`worldState.corpses[]` (with a tolerance for the documented best-
effort surface — i.e. log mismatches, only fail the test if mismatches
exceed a small threshold).

**Mitigation if the test fails.** ADR §4's authoritative-fallback
strategy: the rendered corpse hover card reads contents *directly*
from `worldState.corpses[]`, not from the walk. The walk's corpse-
contents output is then purely cosmetic and the divergence becomes a
display-only nicety to fix later.

---

### 1.8 Extracted character disappearance

**Failure mode.** Characters that extract on turn N (action `kind:
"extract"` per `harness/analyze-match.ts:55`) should not appear on the
grid for turns ≥ N+1. A regression that keeps extracted characters at
their last position would mislead the user about who's still in the
arena.

**Test (Vitest).** Synthetic bundle: character A extracts on turn 50.
Assert `reconstruct(bundle, 50).characters[A].extractedAtTurn === 50`
and that the renderer's grid component (or the snapshot's "alive"
filter) excludes A from the live-tokens list.

---

### 1.9 Turn 0 vs turn 1 — the first-row invariant

**Failure mode.** Phase 1's `convex/runMatch.ts:advanceTurn` is invoked
first by `matches.start` with no turn argument; the chain produces the
first `turns` row at `turn === 1`, NOT `turn === 0`. The pre-turn-1
state (i.e. spawn positions, no actions yet) is therefore **not
represented as a row in the ledger**. The walk must treat the
"snapshot before bundle.turns[0]" as the synthetic turn-0 state
(spawn positions, closed chests, no corpses).

**Action item.** WP-B's pre-step is to inspect a real bundle from
`npx convex run` and document the actual `bundle.turns[0].turn` value
in `reconstruct.ts`'s comment header. If `turn === 1`, the walk
synthesises a turn-0 snapshot from spawnIndex / map / characters
without consulting any ledger row. If `turn === 0`, the walk's
iteration starts at the first row.

**Test (live integration, gated by `LIVE_CONVEX`).** Load a closing-50
bundle. Assert `bundle.turns[0].turn` equals either 0 or 1 and that
the walk produces correct spawn positions for that turn-0 view either
way.

---

## 2. Manual UAT checklist (before phase closure)

After WP-D lands, the user (or a reviewing agent in their stead) runs
this checklist against three closing-50 matches:

- [ ] Match picker loads in <1 s and shows ≥ 3 matches.
- [ ] Click a match row → replay route loads in <2 s.
- [ ] Turn 0: 8 agents at 8 perimeter spawns, no corpses, all chests
      closed, evac ring centred at (47..49, 47..49).
- [ ] Slider scrubs 0 → 50 and back without visual artifacts.
- [ ] At each turn, the side-panel feed shows 8 rows (or fewer if
      agents have died) with English decision summaries that read
      naturally.
- [ ] Hovering an agent shows persona, equipped, decision summary.
- [ ] Hovering a chest at terminal turn shows opened-state matching
      `worldState.chests[]`.
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
- **Decision-as-English vocabulary.** Enumerated by inspection of
  `convex/engine/{combat,loot,affordances}.ts`; one grep at WP-C
  kickoff; no spike needed.
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
- `convex/schema.ts` — schema validators the bundle types alias.
- `harness/analyze-match.ts` — phase-1 CLI counterpart; result-string
  enumeration for WP-C kickoff lives here at lines 49–58.
