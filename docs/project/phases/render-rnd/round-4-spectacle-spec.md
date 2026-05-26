# Round-4 Spectacle Spec — Engine-Truth Event Streams + Renderer Polish

> **Status: PLANNED** — follow-up to round 3 ([`full-match-godot-spec.md`](./full-match-godot-spec.md),
> [`round-3-closing-readout.md`](./round-3-closing-readout.md)). Pre-§10-gate
> exploration. WP1 escapes throwaway as a real-code schema bump (2 → 3);
> WP2–4 are renderer R&D inside `throwaway-prototypes/d-full-match/`.

⭐ **North Star** ⭐ — Snapshot contract extension (movements / attacks /
loots event streams) + full renderer R&D polish pass on the d-full-match
Godot prototype: 8 visually-distinct character models, weapon/armour
mesh-on-equip, attack + loot animations, maximalist gore VFX,
environment polish, wall-slide-correct pathing, scale + camera tuning.

🚫 **BLIND ASSIGNMENT** — No browsertools, no chromium UAT, no `uat` job.
Round 3 validated the discipline: three reviewer passes plus the
implementer all missed a CORS preflight defect that surfaced in 5
seconds of real-browser UAT by the user. Visual UAT is performed by the
user themselves *after* assignment closure. Validation = typecheck +
build + lint + unit tests + scaffold-verify scripts + reviewer judgment
against acceptance criteria + a clear written closure summary.

---

## 1. Purpose

Two outcomes, neither sufficient alone:

1. **Codify the §13 "renderer reads engine-emitted truth" principle in
   the contract.** The engine has the real waypoint path of every
   wall-slide move; the renderer has been faking it as a straight line
   and drawing characters through walls. Same gap for per-attack and
   per-loot events that currently can only be reverse-engineered from
   `actions[]` strings and `deaths[]`. WP1 fixes the substrate so the
   renderer is a *projection surface*, not a gameplay reasoner.
   `MatchSnapshotJson.schemaVersion` bumps **2 → 3** (forward-only POC
   posture, §10; old prototypes broken on bump is acceptable, §13).

2. **Spectacle-grade R&D polish on the d-full-match Godot prototype.**
   Felt-experience round 4: 8 distinct character models (cyberpunk ×
   Diablo readability), weapon/armour mesh-on-equip, attack + loot +
   wall face-slam animations, maximalist gore VFX (§13 "gore intensity
   is loud by design"), and scene polish (scale, ground, facing,
   camera, environment). User performs visual UAT themselves
   post-closure.

Decision filter (§7): does this make prompt-authored behaviour more
*legible* or more *shareable*? — Yes on both counts. Engine-truth event
streams make attribution honest (§5, §10 — diagnostics target machine
introspection first); maximalist VFX cashes in the shareable comedy
beats (§12 wall face-slams; §11 telefrag red-mist; §5 "best failure"
attributable moments).

---

## 2. Overview

Two layers, deliberately separated by the throwaway boundary (same
posture as round 3):

| Layer | Throwaway? | Lives at |
|---|---|---|
| **Snapshot contract extension** (event streams + schemaVersion 3 + engine waypoint plumbing) | **No — escapes throwaway** | `convex/replay/`, `convex/engine/movement.ts`, `convex/schema.ts`, `tests/convex/` |
| **Renderer polish + asset R&D + VFX/animation** | **Yes — throwaway** | `throwaway-prototypes/d-full-match/` |

The contract is the load-bearing piece. The prototype is the
felt-experience probe that informs whether and how the consumer-render
era eventually proceeds (still §10-gated, still deferred until after
the player-facing layer matures).

---

## 3. Architecture Design

### 3.1 New event streams in `MatchSnapshotJson` (schemaVersion 3)

Three new top-level arrays added to the existing snapshot shape. All
three are *flat* (one row per event) — turn is a column on each row, so
the renderer can scan them once and bucket by turn cheaply.

```ts
// convex/replay/snapshotTypes.ts (additive)

movements: Array<{
  turn: number;
  characterId: string;
  fromTile: Tile;
  toTile: Tile;
  path: Tile[];              // engine-truth waypoint sequence INCLUDING fromTile and toTile
  blockedBy?: "wall";        // present iff a wall-blocked face-slam (fromTile === toTile)
  wallRectId?: string;       // present iff blockedBy === "wall" — forwarded from bodyCollision.wallRectId so the renderer can place the face-slam VFX at the wall (mental-model §13: engine-emitted truth; no renderer-side wall geometry derivation)
  bodyCollisionKind?: "character" | "wall"; // present iff entry carried a bodyCollision — lets the renderer differentiate charge-into-character from wall-bonk without re-deriving from the moves trace
}>;

attacks: Array<{
  turn: number;
  attackerId: string;
  targetId: string;          // engine characterId (normalised; never an LLM display id)
  weapon: WeaponName | null; // null for ALL non-weapon damage: bodyCollision AND unarmed regular attacks (initial characters start with no equipped weapon; engine trace omits weapon for unarmed); kind carries origin
  kind: "attack" | "overwatch" | "counter" | "bodyCollision";
  hit: boolean;              // true when damage > 0 applied
  lethal: boolean;           // true iff this attack killed the target this turn
}>;

loots: Array<{
  turn: number;
  characterId: string;
  source: "crate" | "corpse" | "airdrop";
  sourceId: string;          // crate/airdrop id (Crate_x_y) or corpse characterId
  item: ItemRef;             // {category, name} — the item picked up
  equipped: boolean;         // false iff held item was strictly-better (discardedWeaker)
}>;
```

`schemaVersion: 2` → `schemaVersion: 3`. Old shape removed entirely; no
back-compat shim (POC posture §10).

### 3.2 Engine plumbing — capturing waypoints

`MoveTraceEntry` in `convex/engine/movement.ts` gains a `path: Tile[]`
field.

**Critical init step (review-A H2 fix):** the substep loop in
`simulateMovement` already maintains a per-mover `currentPos` map and
commits one tile per substep. BEFORE the substep loop begins, the
plumbing seeds `pathByMover.set(id, [startPos.get(id)!])` for every
mover. Inside the planned-commit block (at `movement.ts:494-506`,
next to the `firstSlideByMover` assignment), the per-substep push
appends the *committed* tile (`p.tile`) onto the path. This
seed-then-append pattern is load-bearing because:

- **Wall-blocked face-slams** (`d.mover.budget = 0` at line 462 before
  `planned` is built — `movement.ts:444-464`): the planned loop never
  commits for this mover, so push never fires, and the path remains
  the initial `[fromTile]`. ✓
- **Character-collision charges** (`d.mover.budget = 0` at line 478):
  same — path remains `[fromTile]`. The renderer differentiates from
  wall-slam via `bodyCollisionKind`. ✓
- **Normal moves and wall-slides**: each substep commit appends a
  tile, so the path becomes `[from, ..., to]` — for a 2-substep slide
  (X-fallback + Y-fallback) that yields 3 entries. ✓

End-of-path tile equals `currentPos` at loop exit; `toTile` and the
path's last element are identical for moved characters. For
wall-blocked face-slams and character-collision charges, `path` has
length 1 and `fromTile === toTile === path[0]`.

The `ResolutionTrace.moves[]` entry shape mirrors this — same `path`
field, same `blockedBy` flag, same `bodyCollision` shape.
`convex/schema.ts` `resolutionValidator.path` is added as a
**non-optional** array of `{ x, y }` tile records (forward-only POC
posture — every move entry carries a path of length ≥ 1).

**WP1 file scope — schema duplication checklist (review-A L1 fix):**
The `path` field must land at all three definition sites:
1. `MoveTraceEntry` in `convex/engine/movement.ts`
2. The inline `ResolutionTrace.moves[]` type in
   `convex/engine/resolution.ts` (lines ~104-117)
3. The `resolutionValidator.moves` Convex validator in
   `convex/schema.ts` (lines ~312-348)

**Persistence adapter parity (review-B H1 fix):** The
`adaptResolutionForSchema` mapper in `convex/runMatch.ts` (~line 525)
explicitly remaps `moves[]` field-by-field; the mirror in
`convex/_internal_runMatch.ts` (~line 194) is structurally identical.
Both adapters MUST be updated to forward the new `path` array, or
persisted resolutions will silently drop the field. Required tests in
`tests/integration/persistAdaptParity.test.ts`: assert `path` round-
trips through both adapters identical to the engine output, including
wall-slide, wall-face-slam, and character-collision-charge cases.

### 3.3 Snapshot builder — mining events

`buildMatchSnapshot` walks `bundle.turns[]`:

- **`movements[]`**: each `turn.resolution.moves[]` entry → one event
  with `turn`, `characterId`, `fromTile = from`, `toTile = to`, `path`
  (copied from the move entry), `blockedBy` (forwarded), `wallRectId`
  (forwarded from `bodyCollision.wallRectId` when
  `bodyCollision.kind === "wall"`), and `bodyCollisionKind` (forwarded
  from `bodyCollision.kind` when the entry carries one — lets the
  renderer differentiate `[fromTile]` paths that are wall face-slams
  vs character-charge stops without re-deriving from the underlying
  bodyCollision union).

- **`attacks[]`**: built from two sources:
  - **Regular damage actions** — each `turn.resolution.actions[]`
    entry where `kind ∈ {"attack","overwatch","counter"}` AND the
    `target` resolves to a real characterId. Mine `weapon` from the
    action entry (may be undefined for unarmed attacks; emit `null`
    in those cases per §7-#1). `hit = /^dmg /.test(result)`.
  - **BodyCollision attacks** — emitted from `turn.resolution.moves[]`
    entries with `bodyCollision.kind === "character"`. **Pair-dedupe
    required (review-B H3):** the engine in `resolution.ts:330-352`
    dedupes bodyCollision damage per `[mover, defender].sort().join("|")`
    pair key and emits exactly two damage events per unique pair (one
    each direction). The snapshot builder MUST apply the same pair-key
    dedupe so that a bilateral charge (two `moves[]` entries, one each
    direction) produces exactly two `attacks[]` events — not four.
    Each yields `kind: "bodyCollision"`, `weapon: null`, `hit: true`,
    attacker ↔ defender per-direction. Wall-bonk bodyCollisions
    (`kind === "wall"`) do NOT emit attack events.

  **`lethal` attribution (review-A H1 / review-B H4 / review-C M1 —
  consolidated fix):** the existing `killAttribution.ts::isDamageAction`
  predicate matches only `kind ∈ {attack, overwatch, counter}` action
  rows. BodyCollision damage lives in `moves[]`, not `actions[]`, so
  the existing kill-feed lookup currently CANNOT credit bodyCollision
  kills (this is also a latent bug in `buildKillFeed` — environmental
  deaths bypass it, but a 1-HP target killed by a charging mover
  shows "Unknown killed Victim"). WP1 extends the attribution
  substrate:
  - Add a new helper `collectDamageCandidates(turn)` in
    `killAttribution.ts` that returns the unified list of damage events
    for a turn: actions[]-derived rows (existing) plus
    bodyCollision-derived rows synthesised from `moves[]` (mover side
    only for the lethal-credit lane — see deterministic rule below).
  - For `lethal` computation, the snapshot builder cross-references
    every `attacks[]` event's `(attackerId, targetId)` pair against
    the unified damage-candidate list AND `turn.resolution.deaths[]`.
    The lethal flag is set on the single damage event that wins the
    deterministic lookup.
  - Deterministic single-killer rule for bodyCollision pairs (the
    pair emits two damage events, one each direction): the lethal
    credit goes to the *mover* (the character with the move entry
    whose `bodyCollision` was authored — i.e., the actor who chose to
    charge into the defender). The reciprocal defender→mover damage
    event in `attacks[]` carries `lethal: true` ONLY if the mover
    also died this turn (mutual collision death — both 1-HP). This
    rule is testable, deterministic, and matches "charger attribution"
    intent. The unified helper also fixes `buildKillFeed` as a side
    effect (kill feed text gains correct attribution for bodyCollision
    duel deaths).

- **`loots[]`**: each `turn.resolution.actions[]` entry where
  `kind === "loot"` AND `result ∈ {"opened","looted"}`. Source
  classification uses the existing engine helper for a single
  lookup (review-A M3 fix):
  - For `result === "opened"`: call
    `findCrateById(worldState, target, turn)` and read its `.source`
    field — `"static"` maps to snapshot `source: "crate"`, `"airdrop"`
    maps to snapshot `source: "airdrop"`. No prefix matching, no
    double scan.
  - For `result === "looted"` AND target starts with `"Corpse_"` →
    `source: "corpse"`, `sourceId` is the corpse characterId
    (resolved via `normaliseCorpseTargetId` for parity with the engine)
  - `item` is mined from `lootedItem` (action field) plus a small
    catalog lookup to recover the `category` (the engine action trace
    drops the category; the catalog lives in `convex/engine/types.ts`
    `WEAPONS / ARMOUR / CONSUMABLES` constants).
  - `equipped = !discardedWeaker` (default `true` when the field is
    absent — schema reads cleanly).

  Loot results that are not pickups (`"empty"`, `"already_opened"`,
  `"no_target"`, `"no_crate"`, `"no_corpse"`, `"out_of_range"`) do NOT
  emit `loots[]` events — only successful pickups land in the stream.
  This is the legible substrate: a `loots[]` event means "an item
  actually transferred".

### 3.4 Renderer changes (throwaway, d-full-match/)

Inside `throwaway-prototypes/d-full-match/`:

- **`EntityRenderer.gd`** — replace position-lerp with per-character
  **waypoint animator**. Read `snapshot.movements` once on configure;
  bucket by `(turn, characterId)`. Per frame: for each character with
  an active turn's movement, interpolate along its `path[]` using
  fractional turn progress. Compute facing as the direction vector
  between current and next waypoint (or hold last heading when
  stationary). **No pathing logic in the renderer** — it consumes the
  engine's waypoint sequence verbatim. Wall-blocked moves
  (`blockedBy === "wall"`) trigger the face-slam beat at the
  fromTile/wall-direction.

- **`SceneBuilder.gd`** — scale halved (`WORLD_SCALE` stays at 0.38 to
  preserve map geometry, but character `Vector3.ONE * 0.42` instance
  scale halves to ~0.21; crates similarly proportional). Y-pivot
  offset corrected per-mesh (model-specific — the Astronaut hovers
  because its GLB pivot is between feet; new models will have their
  own offsets recorded in `manifest.json`). Wall-clip padding via a
  small inset on character render position when adjacent to a wall
  rect (renderer-side cosmetic — does NOT change engine positions).

- **`CameraRig.gd`** — anchored cam default `radius` reduced
  (implementer judgment, starting point ~14 from current 26),
  director cam unchanged, max zoom-out cap reduced (implementer
  judgment, ~32 from current 62).

- **New `CombatVfx.gd`** — subscribes to `attacks[]` + `loots[]` +
  movements-with-blockedBy. Emits VFX nodes (GPUParticles3D blood
  splash, MeshInstance3D decal blood pools with ring-buffer cap,
  CameraRig screen-shake signal, dust-puff at wall, dismemberment
  burst). The Godot web export remains configured for the
  Compatibility/WebGL2 renderer; validation is "web export builds
  clean + scaffold-verify structural checks", NOT browser-mediated
  inspection (review-B M3 fix — blind-UAT discipline). Particle
  counts moderate (per-emitter ≤ ~120, short lifetimes, ring-buffered
  pools ≤ 64) — these are budget guards, not validation gates.

- **New `EquipmentMeshAttachment.gd`** — reads `equippedByCharacter`
  per-frame; when a character's weapon/armour identity changes
  (drives off the existing per-frame equipped data, not the
  loots[] stream — loots[] just times the swap animation/VFX), the
  attachment swaps the weapon mesh at a known bone/socket on the
  character. Bone/socket names are documented per-model in
  `manifest.json` (or fall back to a deterministic offset if the
  model lacks a hand bone). Armour visualisation is mesh swap OR
  material tier overlay per implementer judgment.

### 3.5 Asset R&D — `manifest.json` restructure (multi-source)

**Review-A H3 fix:** the existing
`throwaway-prototypes/shared-harness/art-kit/manifest.json` was
authored for a single-vendor (Quaternius) kit and carries `source`,
`license`, and `extraction` as **top-level singletons**. Round 4 needs
≥2–3 different upstream sources per the North Star, so a single
top-level `source`/`license` is structurally incoherent.

**Direction:** create a NEW file at
`throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json`
with a *per-asset* shape — `source`, `license`, `sizeBytes`, `sha256`,
and `extraction` (when applicable) move INTO each asset entry. The
existing single-vendor shared-harness manifest stays untouched (still
used by the round-1/2/3 prototypes). Do NOT mutate the shared-harness
manifest in place — that would break the existing prototypes.

The d-full-match manifest records per-asset entries with:

- `personaSlot`: `"rat" | "duelist" | "trader" | "opportunist" | "paranoid" | "camper" | "sprinter" | "vulture"` for character entries (deterministic persona ↔ model mapping)
- `category`: `"character" | "weapon" | "armour" | "corpse" | "environment"`
- `tier`: numeric tier index for weapons/armour entries (drives mesh-on-equip lookup)
- `attachBone`: bone name for weapon-mounting (or `null` to fall back to a hand-offset transform)
- `pivotYOffset`: Y-offset to apply on instance so the model sits flush with ground
- `notes`: one-line implementer rationale for the choice
- `source`: URL of origin AND title/creator of the upstream pack (per-asset)
- `license`: SPDX id where possible (e.g. `"CC0-1.0"`), or
  permissive-non-SPDX string (e.g. `"synty-eula"`,
  `"mixamo-royalty-free"`) when not an SPDX licence — paired with a
  one-line fitness note. Per-asset.
- `sizeBytes`, `sha256`: integrity, per-asset
- `extraction`: optional per-asset block recording source archive + path

The top-level fields of the new manifest are limited to:
`schemaVersion`, `kitName`, `purpose`, `notes[]`, and `assets[]`.
There is no top-level `source` / `license` / `extraction` in the
multi-source manifest — those become per-asset.

8 character entries (one per persona) + ≥5 weapon meshes (one per
`WeaponName`) + ≥3 armour variants (low/mid/high tier readability) +
1 corpse mesh + any new environment textures.

Models MUST come from **≥2–3 different free/CC0/permissive sources**.
Mixamo's auto-rigger is acceptable for unrigged source meshes.

### 3.6 Documentation

- `convex/replay/README.md` (or inline header comments in
  `snapshot.ts`) gains a section describing the three new event
  streams + the schemaVersion bump rationale. The existing
  `docs/project/guides/convex-backend.md` §2a (the replay-snapshot
  section) updates with the new event-stream descriptions.

---

## 4. Dependency Map

```
              WP1 (snapshot contract + engine waypoints)
                 │
       ┌─────────┼─────────┬──────────────┐
       ▼         ▼         ▼              ▼
      WP2      WP3       WP4 (depends    (docs / closure
   renderer   asset     on WP1 events     summary —
   polish     R&D       AND WP3 weapon    written by
              (manifest, meshes for      reviewer at
              models,   the swap)         end)
              meshes)
```

- **WP1 must land first.** WP2's facing-direction story consumes
  waypoints; WP4 consumes the new `attacks[]`/`loots[]` streams. WP3
  doesn't strictly need WP1 but is sequenced after for tidiness (one
  implementer dispatch boundary at WP1 close).
- **WP2 & WP3 can run in parallel** after WP1 closes — they touch
  disjoint files (WP2 = `src/*.gd` polish; WP3 = `shared-harness/`
  asset additions + `manifest.json`).
- **WP4 runs after WP3 closes** (needs weapon meshes for the
  equipment-swap timing) AND after WP1 closes (needs `attacks[]` +
  `loots[]` streams). WP4 can run *partially* in parallel with WP3 —
  the gore VFX + screen-shake + dust-puff don't depend on WP3 assets
  — but the equipment-mesh-on-equip part is gated on WP3.

Parallelisation opportunity: dispatch WP2 + WP3 + (WP4 gore-vfx half)
simultaneously after WP1 close; merge WP4 equipment-swap half last.

---

## 5. Work Package Breakdown

Each WP is a vertical slice that delivers an evaluable acceptance
gate. No WP requires browsertools / chromium UAT to validate.

### WP1 — Snapshot Contract Extension *(escapes throwaway)*

**Scope:**
- Add `path: Tile[]` to `MoveTraceEntry` in `convex/engine/movement.ts`;
  capture per-substep tile sequence in `simulateMovement` per §3.2
  (init `pathByMover.set(id, [startPos.get(id)!])` before the substep
  loop; push committed tiles inside the planned-commit branch).
- Mirror `path` into the inline `ResolutionTrace.moves[]` type in
  `convex/engine/resolution.ts`.
- Extend `convex/schema.ts` `resolutionValidator.moves[].path` as a
  **non-optional** validator (forward-only — no back-compat shim;
  schema-wipe acceptable per §7-#6).
- **Persistence adapter parity (review-B H1):** update
  `adaptResolutionForSchema` in `convex/runMatch.ts` AND the
  mirrored adapter in `convex/_internal_runMatch.ts` so the `path`
  field round-trips into persisted resolutions. Forgetting either
  silently drops the new field.
- Extend `killAttribution.ts` with `collectDamageCandidates(turn)`
  per §3.3 (unified actions + bodyCollision damage candidates with
  the deterministic mover-attributed lethal rule for bodyCollision
  pairs).
- Extend `MatchSnapshotJson` in `convex/replay/snapshotTypes.ts` with
  the three new event streams + bump `schemaVersion: 3`.
- Extend `buildMatchSnapshot` in `convex/replay/snapshot.ts` to mine
  `movements[]` / `attacks[]` / `loots[]` from `bundle.turns[]` per
  §3.3 above. Apply the bodyCollision pair-key dedupe when building
  `attacks[]` from `moves[]`. Use `findCrateById(.).source` directly
  for `loots[]` source classification.
- `buildKillFeed` updated to consume the unified damage candidates
  so bodyCollision duel deaths attribute correctly (no more
  "Unknown killed Victim" for charge-kills).
- Unit-test matrix in `tests/convex/replaySnapshot.test.ts` grows:
  every new event shape × every edge case (review-A M4 + M2 additions
  inline below):
  - `movements[]`: multi-move-per-turn, wall-slide path (≥3 entries
    for 2-substep slide; deterministic exact-sequence fixture
    assertion, NOT a `>` length rule — review-B L1 fix), wall-blocked
    face-slam (`path: [fromTile]`, `wallRectId` present,
    `bodyCollisionKind: "wall"`), character-collision charge
    (`path: [fromTile]`, `bodyCollisionKind: "character"`, NO
    `wallRectId`).
  - `attacks[]`: attack-without-kill, attack-with-kill,
    multi-attacker lethal determinism (two attackers both damage a
    victim who dies → exactly one `attacks[]` entry has
    `lethal: true`, deterministically the kill-credit winner — new
    case per review-A M2), overwatch fire, counter-fire-hit,
    counter-fire OOR (`hit: false, lethal: false` — new case per
    review-A M4), unarmed regular attack (`weapon: null`),
    bodyCollision character-charge pair (exactly 2 events for one
    pair-key collision; lethal-credit goes to the mover side),
    bilateral bodyCollision (both characters charged each other —
    still exactly 2 attacks[] events; pair-key dedupe verified),
    bodyCollision lethal (mover charges 1-HP defender → mover side
    of pair gets `lethal: true`), mutual bodyCollision death (both
    at 1 HP → both events have `lethal: true`), wall-bonk
    bodyCollision (NO `attacks[]` entry emitted).
  - `loots[]`: loot-from-crate (`source: "crate"`), loot-from-airdrop
    (`source: "airdrop"`, via `findCrateById(.).source === "airdrop"`),
    loot-from-corpse (`source: "corpse"`),
    loot-discarded-weaker (`equipped: false` — new case per
    review-A M4 + review-C L2), drained-corpse non-event, opened-
    empty non-event, out-of-range non-event.
- `killFeed` regression test: bodyCollision duel death now
  attributes correctly (the kill-line carries the charging mover's
  display name, not "Unknown").
- The HTTP shape automatically picks up the schema bump
  (`handleExportMatch` returns whatever `buildMatchSnapshot` returns).
  Existing `tests/convex/http.test.ts` cases that match shapes by key
  presence will need light updates if they assert
  `schemaVersion === 2`.
- Documentation: `docs/project/guides/convex-backend.md` §2a updated
  with the new event-stream descriptions; closing-readout written by
  reviewer at assignment close.
- No `apps/` changes (the shim path still works; tests/llm/* may
  need minor type-only updates if `ResolutionTrace.moves[]` shape
  changes — implementer audits).
- POC posture: forward-only. No migration code. Any
  `worldState`/`turns` documents persisted by the round-3 deployment
  that lack `path` arrays are an acceptable schema-wipe casualty
  (memory: POC schema wipe acceptable).

**Success criteria:**
- ✅ `MatchSnapshotJson.schemaVersion === 3`.
- ✅ `movements[]` event present for every per-turn `moves[]` entry
  where the engine emitted one. `path` array assertions use
  **deterministic exact-sequence fixtures** (review-B L1 fix), not a
  `>` length rule — a wall-slide fixture asserts the exact `[from,
  fallback, to]` sequence the engine emits.
- ✅ Wall-blocked face-slams emit `path: [fromTile]` with
  `wallRectId` present and `bodyCollisionKind: "wall"`.
- ✅ Character-collision charges emit `path: [fromTile]` with
  `bodyCollisionKind: "character"` and no `wallRectId`.
- ✅ `attacks[]` present for every `actions[]` entry of kind
  attack/overwatch/counter where the target resolved to a real
  character, AND exactly TWO events per unique character-character
  bodyCollision pair (pair-key dedupe matches engine
  `resolution.ts:330-352`).
- ✅ `lethal === true` events sum to the same victim count as
  `killFeed.filter(k => k.kind === "duel")` — including bodyCollision
  duel kills (which previously fell through to "Unknown"). Environmental
  deaths (telefrag) are NOT attacks.
- ✅ For bodyCollision pair lethal: when defender dies, the mover-
  side event has `lethal: true`; the defender→mover event has
  `lethal: true` ONLY in the mutual-death case (both at 1 HP).
- ✅ `loots[]` present for every `actions[]` entry with
  `result ∈ {"opened","looted"}` with the right `source`
  classification (crate vs airdrop vs corpse) — sourced from
  `findCrateById(.).source` for opened entries.
- ✅ `loots[].equipped === false` iff the action carries
  `discardedWeaker: true`.
- ✅ Unit tests cover all enumerated edge cases (≥20 cases per the
  expanded list above).
- ✅ Persistence adapter parity test confirms `path` round-trips
  through both `runMatch.ts` and `_internal_runMatch.ts`.
- ✅ `npm run lint` / `typecheck` / `build` / `test` all clean.
- ✅ Engine determinism preserved: existing engine tests
  (`tests/engine/movement.test.ts` etc.) still pass with the new
  `path` field present.
- ✅ NO `apps/replay` import surface changes.
- ❌ Zero browsertools / chromium / UAT artefacts in the WP work history.

**Estimated reach:** ~5 files modified in `convex/`, ~2 test files,
~1 doc page. Mostly additive (the `MoveTraceEntry.path` push and the
new builder branches are concentrated changes).

---

### WP2 — Renderer Polish *(throwaway, inside `d-full-match/`)*

**Scope:**
- **Character scale:** halve from current `~0.42` instance scale
  toward `~0.21`. Floor/wall geometry untouched (WORLD_SCALE stays).
- **Ground level:** per-model Y-pivot offset from `manifest.json`
  (default 0 for new models that come centred); existing Astronaut
  offset corrected.
- **Facing direction:** `EntityRenderer._update_characters` reads
  the *active* movement event for each character on the current
  turn and computes the heading vector from the
  current-interpolation-segment's path[i] → path[i+1]; sets
  `node.rotation.y` to face that heading. Replaces the existing
  decorative idle sway. Stationary characters preserve last heading.
- **Waypoint animation:** `EntityRenderer` swaps the current
  position-lerp between adjacent timeline frames for a per-character
  waypoint-walker keyed off `snapshot.movements`. Interpolation
  remains turn-fractional but along the engine's actual tile path
  rather than a straight line. **No pathing logic in renderer.**
- **Wall-clip padding (cosmetic):** when a character renders adjacent
  to a wall rect, apply a small cosmetic offset away from the wall
  normal so the visible mesh does not overlap wall geometry. Engine
  position unchanged. **Renderer-side wall adjacency math is
  permitted here** — this is purely a render-position cosmetic offset,
  not pathfinding. The scaffold-verify forbidden-token grep targets
  *pathfinding/route derivation* only (see §5 WP2 scope for the
  enumerated token list); cosmetic adjacency inset is explicitly
  excluded (review-B M2 fix).
- **Camera:** anchored cam `radius` default reduced (~26 → ~14),
  max zoom-out cap reduced (~62 → ~32). Director cam unchanged.
  Defaults are implementer judgment within the spirit "noticeably
  tighter".
- **Environment polish:** textures + materials for walls / floor /
  cover / crates / evac (cyberpunk × Diablo: dark, neon-accented,
  moody). Lighting baseline (WorldEnvironment + neon-key-light +
  crimson-rim-light) preserved per scaffold-verify; amped via
  postprocessing / material work, NOT via hand-modeled bespoke art
  (§13 "slick is pipeline"). Texture sizes browser-friendly
  (≤1024px, ideally compressed).
- **Playback speed unchanged.** The 0.5x/1x/2x dial already exists;
  the requested "half-speed" calibration is descoped (the user
  walked it back — the dial covers it).

**Success criteria:**
- ✅ Character models render at ~half the round-3 visual size.
- ✅ Models sit flush on the ground (no float, no buried legs).
- ✅ Models rotate to face their movement heading; stationary
  characters preserve last heading.
- ✅ Models do not visibly overlap wall rects when adjacent.
- ✅ Wall-slide moves animate along the engine's `path[]`, NOT a
  straight line through walls. (Verified by code inspection +
  unit-style replay-of-fixture in a scaffold-verify check.)
- ✅ Anchored cam default zoom-in noticeably tighter than round 3.
- ✅ Anchored cam cannot zoom out past the configured ceiling.
- ✅ Director cam free orbit/pan/zoom intact (regression check).
- ✅ Environment textures / materials applied; existing lighting
  baseline still present per `verify-scaffold.mjs`.
- ✅ Godot web export builds clean; `npm --prefix
  throwaway-prototypes/d-full-match run build` succeeds.
- ✅ Updated `scripts/verify-scaffold.mjs` asserts the new structural
  invariants (waypoint reader present, no pathing logic in renderer,
  facing-direction code path present, camera radius/cap constants
  bounded in the spec ranges). **Forbidden-token grep enumeration
  (review-A L2 fix):** `a_star`, `astar`, `find_path`, `bresenham`,
  `dijkstra`, `breadth_first_search`, `manual_collision` — any match
  in `EntityRenderer.gd` or peers fails the scaffold-verify gate.
  Cosmetic wall-clip padding code paths are explicitly NOT on the
  forbidden list (the padding uses a Vector3 inset against wall-rect
  normals, which is render-position cosmetic, not pathfinding).
- ❌ Zero browsertools / chromium / visual UAT.

**Estimated reach:** ~4 `.gd` files modified, 1 `manifest.json` edit
(pivot offsets per model), 1 scaffold-verify update.

---

### WP3 — Asset R&D *(throwaway, inside `d-full-match/`)*

**Scope:**
- Source **8 visually-distinct character models** — one per persona
  (`rat`, `duelist`, `trader`, `opportunist`, `paranoid`, `camper`,
  `sprinter`, `vulture`). Models MUST come from **≥2–3 different
  free/CC0/permissive sources**. Acceptable: Quaternius (CC0),
  Synty CC0 free samples (note: Synty's standard EULA is not CC0;
  free *CC0* samples are scarce — implementer judges), Mixamo
  (royalty-free per Adobe TOS, fine for R&D and commercial; use as
  rigger for unrigged source meshes), Kenney.nl (CC0),
  Sketchfab CC0 filter, OpenGameArt CC0 filter, itch.io
  permissive-license packs.
- Animated/rigged preferred. Mixamo auto-rigger acceptable for
  unrigged source meshes.
- Persona ↔ model mapping is **deterministic per-persona** so the
  user can judge fit per archetype across runs.
- **Weapon mesh library:** one mesh per `WeaponName`
  (rusty_blade, dagger, sword, axe, greatsword, warhammer). Tier
  recorded in `manifest.json` for the mesh-on-equip lookup.
- **Armour visual variation:** ≥3 distinct visual states across the
  5 armour tiers (cloth → riot_plate). Mesh swap OR accessory OR
  material overlay per implementer judgment; tier readable at a
  glance.
- **Corpse mesh:** a recognisable down-figure (ragdoll-pose, prone,
  slumped) — NOT the existing flat-box capsule. Single mesh is
  fine; the gore VFX (WP4) carries the spectacle.
- **`manifest.json`** mirrors the existing
  `throwaway-prototypes/shared-harness/art-kit/manifest.json` shape
  and extends per §3.5 (personaSlot, category, tier, attachBone,
  pivotYOffset, notes, source, license, sizeBytes, sha256). New
  entries live under
  `throwaway-prototypes/d-full-match/shared-harness/art-kit/`
  (the throwaway-side directory used by the prototype at runtime —
  see scaffold-verify path).

**Success criteria:**
- ✅ 8 distinct character models attached, one per persona, sourced
  from ≥2 different upstream sources (3+ preferred).
- ✅ Each character renders in the scene (placeholder fallback to
  capsule on load failure — `_instance_or_capsule` already handles
  this safely; reviewer greps to confirm no model misses its
  fallback).
- ✅ Weapon meshes exist for every `WeaponName`.
- ✅ Armour visual variation lands across ≥3 tiers (low/mid/high
  visibly different).
- ✅ Corpse mesh present and recognisable as a down-figure.
- ✅ `manifest.json` documents source URL, SPDX license, size, sha256,
  notes, and the new fields for every new asset.
- ✅ Persona ↔ model mapping is recorded in `manifest.json` and
  deterministic across runs.
- ✅ `npm --prefix throwaway-prototypes/d-full-match run build`
  succeeds with new assets bundled.
- ✅ `verify-scaffold.mjs` adds a manifest-completeness check (each
  persona has an entry; each WeaponName has an entry; corpse entry
  present; all entries carry license + sha256).
- ❌ Zero browsertools / chromium / visual UAT.

**Estimated reach:** ~10–14 new asset files (binary .glb + .png
atlases) under `shared-harness/art-kit/`, 1 `manifest.json` edit,
1 scaffold-verify check.

**Quality posture:** breadth, not uniform polish. The R&D point is
"see what fits per archetype", not "ship-grade art direction".

---

### WP4 — Combat VFX + Animation *(throwaway, depends on WP1 + WP3)*

**Scope:**
- **Attack animation** per character: oriented attacker → target
  (read from new `attacks[]` events). Differentiated by weapon class
  via the swing animation chosen (dagger jab, sword arc, axe chop,
  hammer overhead, greatsword swing — all weapons are range 2 per
  the engine, so this is animation flavour not mechanical
  signalling). Impact pose on `hit: true`, recovery pose on
  `hit: false` (e.g., overwatch out-of-range / counter-fire-OOR).
- **Death animation:** lethal attacks (`lethal: true`) chain into a
  ragdoll/prone pose using the WP3 corpse mesh swap.
- **Gore VFX (MAXIMALIST — no ceiling):**
  - Blood splash at impact (GPUParticles3D one-shot, ~80 amount,
    1.0s lifetime, dark-red → transparent ramp, gravity-biased
    downward).
  - Blood spray on miss / glancing hits (narrower cone, lower
    amount).
  - Persistent blood pools on the floor: `Decal` node or
    `MeshInstance3D` quad with alpha, ring-buffered up to ~64
    (no decay — pools accumulate for the rest of the match).
  - Dismemberment on lethal hits: hide main character mesh, spawn
    3–5 generic limb chunk meshes with `RigidBody3D` impulse +
    short lifetime + dissolve shader on the corpse over 1–3s
    (cheap R&D pattern — not bespoke break-meshes).
  - Screen-shake / camera punch on heavy hits: `CameraRig` emits
    on a hit signal; punch is direction + magnitude scaled by
    damage. Damped over ~0.4s.
  - Existing red-mist beat for environmental death (telefrag)
    preserved.
- **Wall face-slam beat:** on `movements[]` entries with
  `blockedBy: "wall"`, fire a comedic impact beat at the wall
  (camera nudge ~half the normal punch, dust-puff
  GPUParticles3D burst, faint thud sound stub — no audio
  pipeline yet, just a sound-emitter placeholder marked TODO).
- **Loot animation:** brief pickup beat at the looting character
  (small pose / particle flourish ~0.3s). Source visual updates:
  crate empties / fades when looted, corpse loses its item
  visually (mesh swap to "drained" variant — implementer
  judgment; if not feasible, recolor / material darken),
  airdrop empties.
- **Equipment-on-equip mesh swap:** when `equippedByCharacter`
  changes for a character between frames (the engine auto-applies
  on strictly-better loots; the renderer reflects it), the
  attached weapon mesh swaps at the character's bone/socket.
  **Timing of the swap animation is driven by the corresponding
  `loots[]` event** (so the swap visibly coincides with the
  pickup beat). Armour visualisation updates the same frame.

**Browser-deployment guardrails (NOT validation gates — blind-UAT
discipline; web export builds clean is the gate, NOT browser
inspection):**
- Particle counts moderate (per-emitter ≤ ~120; short lifetimes).
- Decal/quad blood pools ring-buffered (cap ≤ 64).
- Pool particle scenes rather than instantiating per-hit.
- Avoid huge transparent overlays / heavy overdraw.
- Godot web export must build clean with the Compatibility/WebGL2
  renderer configuration intact.

**Success criteria:**
- ✅ Attack animation fires on every `attacks[]` event with kind
  attack/overwatch/counter, oriented attacker → target.
- ✅ Lethal attacks (`lethal: true`) chain into death/ragdoll pose.
- ✅ Blood splash particles fire on every `hit: true` attack
  event; spray on `hit: false`.
- ✅ Persistent blood pools accumulate on lethal hits and persist
  to end-of-match (no decay) up to a ring-buffer cap.
- ✅ Screen-shake fires on heavy hits (damage threshold —
  implementer judgment, e.g., damage ≥ 15).
- ✅ Wall face-slam beat fires on every movement event with
  `blockedBy: "wall"`.
- ✅ Loot animation fires on every `loots[]` event; source visual
  updates (crate empties / corpse drained / airdrop empties).
- ✅ Equipment mesh swap is visible on `equippedByCharacter`
  changes; tier difference readable at a glance.
- ✅ Environmental-death red-mist beat preserved (regression
  check — `_trigger_mist` still wired to `killFeed[kind=="environmental"]`).
- ✅ Godot web export builds clean, runs in WebGL2 Compatibility
  renderer.
- ✅ `verify-scaffold.mjs` adds structural checks for the new VFX
  module (`CombatVfx.gd` present + wired in scene, particle-cap
  constants bounded, pool ring-buffer constant present).
- ❌ Zero browsertools / chromium / visual UAT.

**Estimated reach:** ~3 new `.gd` files (`CombatVfx.gd`,
`EquipmentMeshAttachment.gd`, possibly `ScreenShake.gd`), edits to
`EntityRenderer.gd` and `CameraRig.gd` (wire signals), 1 scaffold-
verify update, the `MatchPlayer.tscn` scene gains the new VFX
nodes.

**Quality posture:** "operatic", per §13. Implementer is licensed to
push the gore. Diagnosis (sidebar) stays clean.

---

## 6. Assignment-Level Success Criteria

All criteria below testable without browser visual UAT.

1. **Schema bump deployed and tested.**
   `MatchSnapshotJson.schemaVersion === 3`. Three new event streams
   (`movements`, `attacks`, `loots`) populated for every relevant
   engine event. Unit-test matrix expanded with every enumerated
   edge case (WP1 success criteria). All existing tests still pass.

2. **Engine waypoints exposed end-to-end.**
   `MoveTraceEntry.path` carries the substep tile sequence; the
   wall-slide test fixture asserts the exact `[from, fallback, to]`
   sequence the engine emits (deterministic exact-sequence
   assertion, NOT a `>` length rule — review-B L1 fix). Persisted
   resolutions round-trip the path through both adapters
   (`runMatch.ts` + `_internal_runMatch.ts`). Schema validator
   accepts the new shape. No pathing logic in the renderer.

3. **Forward-only POC posture preserved.**
   No back-compat shims, no migration code, no `schemaVersion: 2`
   fallback path in the codebase. Old prototypes broken on bump
   is acceptable (mental-model §10 / §13).

4. **8 visually-distinct character models attached.**
   One per persona, deterministic mapping, ≥2 different sources,
   manifest documents license + provenance + sha256 for every
   asset.

5. **Equipment renders as mesh on the character.**
   Weapon mesh attached at bone/socket per `WeaponName`. Tier
   visibly readable at a glance. Loot pickup → equipment swap
   timing visible.

6. **Renderer reads engine truth.**
   `EntityRenderer.gd` walks `snapshot.movements[].path` for
   character animation, NOT a straight-line lerp. Scaffold-verify
   asserts the structural pattern. Reviewer greps for any
   pathing logic / coordinate arithmetic re-derived in the
   renderer.

7. **Maximalist gore VFX present.**
   Blood splash, miss spray, persistent pools (ring-buffered, no
   decay), screen-shake on heavy hits, dismemberment, environment
   red-mist beat (regression). Implementer summary captures what
   was attempted, what landed, what hit a technical ceiling.

8. **Wall face-slam beat fires on `blockedBy: "wall"` movements.**

9. **Scene polish landed.**
   Character scale halved, ground-flush, facing-direction working,
   anchored cam tighter + max zoom-out cap, environment textures /
   materials applied, lighting baseline preserved.

10. **All validation green.**
    `npm run lint`, `npm run typecheck`, `npm run build`, `npm
    test` clean. `npm --prefix throwaway-prototypes/d-full-match
    run build` clean. `verify-scaffold.mjs` clean (with the
    expanded check set).

11. **Closure summary written.**
    Reviewer writes
    `docs/project/phases/render-rnd/round-4-closing-readout.md`
    enumerating: new event streams + shape, WP3 asset sources +
    persona mapping, WP4 VFX list (what landed + what hit a
    ceiling), controls reminder, blind-UAT focus areas — so the
    user can perform their own informed visual UAT.

12. **NO browser-mediated visual validation in the work history.**
    Reviewer greps for `browsertools`, `chromium`, `screenshot`,
    `puppeteer`, `playwright` in commits and findings — zero
    matches expected. Any deviation is a blocker.

---

## 7. Ambiguities / Decisions Needed

Flagged for plan-review / PM confirmation before implementer
dispatch. Default recommendations given.

1. **`weapon` field on `attacks[]` for non-weapon damage.**
   PM-RATIFIED (review-B M1 correction): `weapon: null` for ALL
   non-weapon damage including bodyCollision AND unarmed regular
   attacks. Initial characters spawn with no equipped weapon (see
   `convex/matches.ts:224` starting equipment + `combat.ts:85`
   unarmed damage path), and the engine trace omits `weapon` in
   that case. The snapshot normalises absent weapon → `null`. Kind
   field carries origin (attack/overwatch/counter/bodyCollision).
   This avoids the conflation Review A originally flagged.

2. **`item` category recovery on `loots[]`.**
   The engine's `lootedItem` action trace field is just the
   name string. To produce a full `ItemRef` (`{category, name}`),
   the snapshot builder needs a name → category lookup. The
   `WEAPONS / ARMOUR / CONSUMABLES` constants in
   `convex/engine/types.ts` provide it.
   **DEFAULT: small lookup helper in `snapshot.ts` driven by
   those constants. No new engine surface.**

3. **`path` length for wall-slide moves.**
   For a 2-substep slide (1 X-fallback + 1 Y-fallback), is
   `path` `[from, intermediate, to]` (3 entries) or
   `[from, to]` (2 entries)? The substep loop commits one tile
   per substep, so the natural answer is "every tile touched
   including start and end" → 3 entries. **DEFAULT: full per-
   substep tile sequence, fromTile inclusive, toTile inclusive.**

4. **`lethal` flag for the bodyCollision attack pair.**
   PM-RATIFIED (review-A H1 / review-B H4 / review-C M1 — unanimous
   reviewer concern): the existing `killAttribution.ts::isDamageAction`
   CANNOT credit bodyCollision kills — it only matches
   actions[]-derived damage rows with `kind ∈ {attack, overwatch,
   counter}`. WP1 extends the attribution substrate (new
   `collectDamageCandidates(turn)` helper that unifies actions[]-
   derived rows with bodyCollision-derived rows from `moves[]`). The
   deterministic single-killer rule is **mover-attribution**: when a
   bodyCollision pair produces a defender death, the mover-side
   event in `attacks[]` carries `lethal: true`; the defender→mover
   event carries `lethal: true` ONLY in the mutual-death case (both
   at 1 HP). This is a single, testable, deterministic rule that
   matches the intent "the charger is the killer". `buildKillFeed`
   consumes the same unified helper, fixing the latent
   "Unknown killed X" bug for bodyCollision duel deaths.

5. **Wall-clip padding magnitude.**
   Implementer judgment. Probably ~0.05–0.1 of WORLD_SCALE.
   **DEFAULT: implementer-tuned; success criterion is "model does
   not visually overlap wall rect when adjacent" — verified by
   reviewer code inspection plus a scaffold-verify check that the
   inset constant is present and non-zero.**

6. **Schema-wipe required?**
   The new `path` field on `ResolutionTrace.moves[]` means existing
   persisted turn documents are missing the field. The
   `resolutionValidator` will reject them on read. **DEFAULT:
   acceptable schema-wipe (memory: POC schema-wipe acceptable).
   The user's dev Convex deployment is reset; round-3 matches are
   not preserved; round-4 produces fresh matches.** Implementer
   handles in the closing notes.

7. **Should `attacks[]` include `targetDisplayName` / `attackerDisplayName`?**
   Recommendation: NO. The renderer can look up display names via
   the `characters[]` array already in the snapshot. Adding the
   denormalised fields bloats the JSON for marginal benefit.
   **DEFAULT: characterId only; renderer joins.**

8. **Synty CC0 availability.**
   Synty's free-sample packs are typically under Synty's custom
   EULA, not CC0. If a Synty pack is used, it counts as a
   *permissive* source but NOT a CC0 source. The North Star says
   "free/CC0/permissive". **DEFAULT: permissive licenses are
   accepted; implementer records the SPDX (or "synty-eula" string
   if non-SPDX) and a one-line license-fitness note in the
   manifest.**

9. **WP4 splittability.**
   WP4 is large. Recommendation: PM can optionally split into
   WP4a (attack animation + gore VFX + wall face-slam — depends
   on WP1) and WP4b (loot animation + equipment mesh swap —
   depends on WP1 + WP3). This is a dispatch-time call; the
   single-WP-4 framing in this spec is fine if the implementer
   can carry both halves. **DEFAULT: dispatch as one WP4 with
   the splittability noted for the PM.**

---

## 8. Recommended Job Sequence

### 8.1 Plan handoff (this artefact)
- **Job:** Plan (this).
- **Output:** This spec doc + WP breakdown.
- **Plan-review COMPLETED.** PM overrode the original "skip plan-
  review" recommendation (per Decision D3: foundational schema bump
  + engine substep-loop modification + 9 ambiguity defaults warrant
  review). Three parallel reviewers (A/B/C) signed off after
  consolidated patches:
  - Engine `pathByMover` init step explicit (review-A H2)
  - `killAttribution.ts::collectDamageCandidates` extension for
    bodyCollision lethal attribution (review-A H1 / review-B H4 /
    review-C M1)
  - WP1 file scope expanded to include `convex/runMatch.ts`,
    `convex/_internal_runMatch.ts`, and
    `tests/integration/persistAdaptParity.test.ts` (review-B H1)
  - Manifest restructured as per-asset shape at new path under
    `d-full-match/shared-harness/art-kit/` (review-A H3)
  - `movements[]` carries `wallRectId` + `bodyCollisionKind` so the
    renderer can place face-slam VFX without re-deriving (review-B H2)
  - `attacks[]` bodyCollision pair-key dedupe explicit (review-B H3)
  - `weapon: null` rule generalised to all non-weapon damage
    (review-B M1)
  - Wall-clip padding vs forbidden-token grep conflict resolved
    (review-B M2)
  - "Browser-tested" wording removed from WP4 (review-B M3 / blind-
    UAT discipline)
  - Test enumeration expanded (review-A M2/M4, review-B L1,
    review-C M1)
  - Forbidden-token grep list enumerated (review-A L2)
  - Schema duplication checklist added (review-A L1)

### 8.2 WP1 (sequential, first)
- **Job 1:** WP1 implementer — snapshot contract extension.
- **Job 2:** WP1 reviewer — pure code review (no UAT). Checks the
  schema bump, the new event-stream shapes, the engine waypoint
  capture, the unit-test matrix.
- **Gate:** WP1 reviewer signs off → unblock WP2/WP3/WP4.

### 8.3 WP2 + WP3 + WP4 (parallel after WP1)
- **Jobs 3, 4, 5:** dispatched simultaneously after WP1 close.
  - Job 3: WP2 implementer (renderer polish).
  - Job 4: WP3 implementer (asset R&D).
  - Job 5: WP4 implementer (combat VFX + animation).
- Per parallelisation note above, WP4 can start its gore-VFX +
  screen-shake + wall face-slam half in parallel with WP3 (those
  pieces don't need WP3 weapon meshes); the equipment-swap half
  picks up after WP3 closes. The PM may choose to gate WP4 on WP3
  close for simplicity — implementer-friendly framing.

### 8.4 Reviews (parallel after each implementer closes)
- **Job 6:** WP2 reviewer.
- **Job 7:** WP3 reviewer.
- **Job 8:** WP4 reviewer.
- All three reviewers operate on code + scaffold-verify + the
  closing summary content the implementers produced. NO UAT.

### 8.5 Closure synthesis
- **Job 9:** A final closing-readout writer (reviewer with the
  full picture) produces
  `docs/project/phases/render-rnd/round-4-closing-readout.md` —
  the blind-UAT handoff the user needs to do their own visual UAT.
  This consolidates per-WP summaries into one document and lists:
  - The three new event streams + shapes.
  - The WP3 asset sources + persona mapping table.
  - The WP4 VFX feature list (what landed + what hit a ceiling).
  - Controls reminder (anchored vs director, scrub, speed dial).
  - Blind-UAT focus areas (per-scenario in the North Star Gherkin).
  - Any open follow-ups for round 5 (deferred items).

### 8.6 Critically: NO `uat` job at any point.
The North Star explicitly forbids it. Round 3 proved the
discipline works (CORS bug detected by user UAT in 5 seconds;
three reviewers missed it without contradicting the spec). Trust
the contract.

---

## 9. Validation Discipline (repeated for emphasis)

🚫 NO browsertools / chromium / visual UAT
🚫 NO `uat` job in the work sequence
🚫 NO screenshot artefacts in the work tree

✅ Validation layer:
- `npm run lint` (root)
- `npm run typecheck` (root)
- `npm run build` (root)
- `npm test` (root) — including the expanded WP1 unit-test matrix
- `npm --prefix throwaway-prototypes/d-full-match test` — scaffold-
  verify (expanded per WP2/3/4 structural invariants)
- `npm --prefix throwaway-prototypes/d-full-match run build` —
  Godot web export builds clean
- Reviewer code-grep for the forbidden tokens (`browsertools`,
  `chromium`, `screenshot`, `playwright`, `puppeteer`)
- Closing-readout summary so the user can perform their own
  informed visual UAT

---

## 10. Architectural Principles Re-Stated (load-bearing)

- **Renderer reads engine-emitted truth; never duplicates engine
  logic** (§13). Wall-slide pathing waypoints are the case in point.
  WP1 makes the substrate honest; WP2 makes the renderer
  consume the honesty.
- **Render = ground truth, full stop** (§13). No fog, no LOS, no
  perception emulation. Sidebar carries diagnosis. WP4 leaves the
  diagnostic sidebar untouched.
- **Match-data contract escapes throwaway** (§13). WP1 is real
  Convex code. Schema bump is forward-only POC posture (§10).
- **Slick is pipeline** (§13). WP2 environment polish + WP4 VFX
  ride lighting / postprocess / materials / particles — NOT
  hand-modeled bespoke art.
- **Gore intensity is loud by design** (§13). WP4 unapologetic.
  Diagnosis stays clean on the side pane.
- **Build the substrate; let the strategy emerge** (§6). The
  schema bump exposes more of the engine's truth to consumers
  (renderer is one); it does not add gameplay logic. Renderers
  consume the substrate, never re-derive it.

---

## 11. References

- `docs/project/spec/mental-model.md` §6, §10, §11, §12, §13
- `docs/project/phases/render-rnd/full-match-godot-spec.md` (round 3 spec)
- `docs/project/phases/render-rnd/round-3-closing-readout.md` (round 3 readout)
- `throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md` (blind-UAT handoff target)
- `throwaway-prototypes/d-full-match/scripts/verify-scaffold.mjs` (scaffold-verify pattern)
- `throwaway-prototypes/shared-harness/art-kit/manifest.json` (asset attribution pattern)
- `convex/replay/snapshot.ts` — builder being extended
- `convex/replay/snapshotTypes.ts` — type being extended; schemaVersion bumps here
- `convex/replay/reconstruct.ts` — engine-side reconstruction (read-side; unchanged this round)
- `convex/engine/movement.ts` — substep loop; `MoveTraceEntry`; `path` field added
- `convex/engine/resolution.ts` — `ResolutionTrace.moves[]`; `actions[]`; deaths
- `convex/engine/killAttribution.ts` — reused for `lethal` lookup
- `convex/engine/types.ts` — `WEAPONS / ARMOUR / CONSUMABLES` constants for category recovery
- `tests/convex/replaySnapshot.test.ts` — matrix to expand
- `tests/convex/http.test.ts` — CORS regression-lock (preserved as-is; light schemaVersion edit)

---

*The user will perform visual UAT themselves after assignment closure.
Trust the contract. Round 3 validated this exact discipline.*
