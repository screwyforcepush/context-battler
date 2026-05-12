# Phase 05 — De-risking

> Four risks. Each names the concern, the verification that closes it,
> the WP it lives in, and the fallback if verification fails.

This phase is mechanical: the architecture decision is already fixed
(ADR §1), the substrate change has clean slice boundaries, and the
test surface is mostly per-WP unit tests. De-risking is bounded.

---

## R1 — Model adapts to the 4-arm grammar without significant schema_validation regression

**Concern.** The model has been emitting the 6-arm grammar
throughout phase-3 and phase-4. After the WP-A push, the tool
schema declares only 4 arms. If the model continues emitting
`toward_entity` / `toward_object` / etc. beyond the first turn or
two of a smoke match, schema_validation fallback rate spikes and
the smoke cohort is unusable as a substrate verdict.

**Why this is low-risk.** The tool schema is in the
per-turn context every call — the model isn't trained on the
6-arm grammar in any persistent sense; it's prompted with the
in-context schema. Shrinking the surface (6 → 4 arms) should
help, not hurt: the model has fewer wrong arms to emit. The D1
probe's `+15.268pp` WP-C-enriched-tool-description regression is
about schema *prose*, not arm count.

**Verification (WP-E).** Smoke cohort cluster-failures inspection
records the rate of schema_validation failures naming the removed
arm kinds. **This rate is observational, NOT a pass / fail gate
(per README §5 / §2 — only Cover/Wall cluster retirement and
match completion are pass / fail).** Expected: 0, or a small
transient at turn 1-2 that disappears as the model adapts to the
in-context schema.

**Fallback.** If the rate is non-trivially nonzero across the
smoke cohort:
1. Record the rate, per-turn distribution, and the persona spread
   in the closure record. Phase-4 D1 follow-up territory.
2. **User-gated** re-confirmation: PM may request a larger
   cohort (e.g. 10 matches) to disambiguate signal from variance
   before phase-4 D1 inherits the signal. This is NOT an
   automatic next step — substrate verdict is already complete
   if the two pass / fail gates held.
3. Do NOT gate this refactor on it.

**Owner.** WP-E.

---

## R2 — Cover tile is always walkable

**Concern.** The new `toward Cover_X_Y` semantic requires the
resolver to walk the actor ONTO the cover tile (stopAtRange=0).
This depends on the invariant that cover tiles are NEVER also
wall tiles. If a future map descriptor declared cover and walls
overlapping, the resolver would route the actor toward a tile
the `isBlocked` check rejects, and the substep loop would
terminate with the actor stranded at chebyshev 1 — silently
failing the toward-cover semantic.

**Why this is low-risk.** The phase-3 movement.ts header
explicitly states `cover walkable` (line 8, citing concept-spec
§24). The map descriptor format (`MapDescriptor` in types.ts)
declares `walls` and `coverClusters` as separate fields with no
overlap-check, but the hand-authored `maps/reference.json` does
not overlap them. `hiding.ts:41-46` (`isInCover`) walks
`world.coverTiles` independent of walls.

**Verification (WP-C).**
1. Unit test in `tests/engine/movement.test.ts` constructs a
   world state with a cover tile at (54,42) and an actor at
   (50,50); asserts the actor reaches (54,42) within movement
   budget.
2. Defence-in-depth (no code change required): document the
   invariant in `movement.ts` header alongside the existing
   "cover walkable" line.

**Fallback.** If the invariant is violated by a future map: the
resolver halts at chebyshev 1 silently. This is the same
behaviour as wall-toward; not a correctness break, just a
silently-degraded affordance. Real fix is a map-descriptor
validator (out of scope for this refactor).

**Owner.** WP-C.

---

## R3 — Wall stop-at-chebyshev-1 edge cases

**Concern.** `toward Wall_X_Y` halts at chebyshev 1 from
(X, Y). Two edge cases:
1. Wall at the map edge — no walkable tile exists at chebyshev 1
   from the wall (e.g. wall at (0, 0); chebyshev 1 includes
   off-grid tiles).
2. All walkable tiles at chebyshev 1 are occupied by other
   characters or other walls.

In both cases the substep loop must terminate gracefully without
entering the wall.

**Why this is low-risk.** The existing `isBlocked` function
(`movement.ts:225-249`) rejects off-grid tiles AND
`tileBlockedByWall` rejects wall tiles. The substep loop's
existing termination condition (`if (!anyCommitted) break`)
handles "no walkable progress" cleanly. The new code path adds
no novel termination condition.

**Verification (WP-C).**
1. Unit test in `tests/engine/movement.test.ts`: wall at map edge
   (e.g. (0, 0)) with actor approaching. Asserts the actor halts
   at the closest reachable walkable tile without entering the
   wall and without crashing.
2. Unit test: actor surrounded by walls except for one walkable
   tile at chebyshev 2 from the target wall. Asserts the actor
   halts at chebyshev 2 (closest reachable) without entering the
   wall.

**Fallback.** If the substep loop emits a runtime error on these
edge cases (it shouldn't — the existing code paths are robust),
the fallback is to add a defensive break in the `desiredNextTile`
return path. No expected; flagged for vigilance only.

**Owner.** WP-C.

---

## R4 — Legacy phase-3 traces and the renderer

**Concern.** Pre-refactor traces in the Convex dev deployment
carry `decision.move` with the old 6-arm discriminator. After
the schema validators (`convex/schema.ts:moveValidator` and
`convex/_internal_runMatch.ts:moveValidator` mirror) land the
new shape in WP-A, reading those legacy rows raises a Convex
validator error at read time. The replay UI fails to load
legacy matches.

**Why this is bounded.** POC posture
(`project_poc_schema_wipe_acceptable`) explicitly endorses a
schema wipe. The phase-3 closure record's metric persistence is
not load-bearing for this refactor (we don't need to read
phase-3 closing-10 reports here). Phase-4 D1 probe data is in
the repo as Markdown, not in Convex.

**Verification (WP-E).** After the schema wipe + push:
1. `npx convex dev` runs cleanly (no validator failures on
   write).
2. Smoke matches read back cleanly in the replay UI.
3. No attempt is made to read legacy data.

**Fallback (only if user vetoes wipe).** Scope a
**renderer-only** legacy shim:
1. Add `Doc<"turns">["agentRecords"][n]["decision"]["move"]` to
   handle a union of legacy + new shapes (typed as `unknown`
   with a runtime narrowing branch).
2. Renderer `renderMoveIntent` adds the 4 legacy arms as
   read-only display cases.
3. Validator + resolver MUST NOT extend to legacy arms — they
   are contract; only the renderer is display.
4. Flag in the closure record that this shim exists and should
   be removed in a follow-up.

**Owner.** WP-D (default: no shim, ship clean) / WP-E (wipe
gate).

---

## Non-risks (deliberately not tracked)

These were considered and ruled out:

- **Pillar 6 dilution.** Whether the consolidation deepens or
  flattens persona behaviour is a phase-4 measurement question,
  not a refactor risk. The substrate becomes more expressive; the
  prompt strategy decides what to do with it.
- **Backwards compatibility on the LLM grammar.** The
  in-context tool schema is fully replaced per call; there is no
  trained-in grammar to be backwards-compatible with.
- **Schema-validation hardness across reasoning effort levels.**
  Smoke uses `low` effort; phase-4 D1 may want to retest at
  `medium`/`high`. That's phase-4's concern, not this refactor's.
- **Move-arm consolidation interacting with action-arm
  consolidation.** Out of scope per North Star "Hard out of
  scope" — attack/loot stay separate.

---

*Four risks, all verifiable inside this phase. The architecture
decision (ADR §1) is the load-bearing call; everything else is
mechanical.*
