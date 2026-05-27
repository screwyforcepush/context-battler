# Round-5 Spectacle Spec — Rigged Animation, Pack Breadth, VFX Pipeline Rework

> **Status: PLANNED** — follow-up to round 4 ([`round-4-spectacle-spec.md`](./round-4-spectacle-spec.md),
> [`round-4-closing-readout.md`](./round-4-closing-readout.md)). Pre-§10-gate
> R&D probe. Default posture: **all changes confined to
> `throwaway-prototypes/d-full-match/`**. Renderer-side timing fix means
> no contract change is expected; if WP-A investigation proves a
> schema-side timing field is strictly necessary, follow Round-4 D1
> pattern (separate commit, schemaVersion 3 → 4 bump, forward-only POC
> posture, no back-compat shims).

⭐ **North Star** ⭐ — Extend the d-full-match Godot prototype with
**(a) 8 distinct rigged character packs** sampled one-per-persona for
breadth comparison, **(b) skeletal animation** driving walk/attack/
loot/idle (limbs must move), **(c) within-turn event sequencing fix**
(loot/gore must play AFTER move resolves), and **(d) VFX/material
pipeline polish** (blood as decals, armor as material-change, walls as
PBR texture, per-persona color palette). Still R&D-grade probe —
breadth-first sampling, not consolidation. User will iterate visually.

🚫 **BLIND ASSIGNMENT** — No browsertools, no chromium, no
screenshots, no visual UAT, no `uat` job. Round 4 D4 discipline
applies. Reviewers operate on code + scaffold-verify + closing
readout. The user performs visual UAT themselves after assignment
closure.

---

## 1. Purpose

Three outcomes, each independently testable, none sufficient alone:

1. **Honest within-turn event sequencing (§13: "renderer respects
   engine resolution order within a turn").** The Round-4 prototype
   fires loot/gore VFX at the START of each turn's playback interval
   — observed during blind UAT, traced in this spec to a `floor()`-
   threshold bug in `CombatVfx.update_to_turn`. Move animations should
   play out before action visuals fire. The fix is renderer-side; the
   snapshot already carries `movements[]` and `attacks[]`/`loots[]` as
   separate arrays (engine resolution order is implicit).

2. **Skeletal animation as spectacle floor (§13: "limbs must visibly
   move").** Round 4 used static-pose mesh translation with
   whole-body-tilt attacks. User feedback explicitly: limbs do NOT
   move when walking, looting, or attacking. The §13 refresh codifies
   this as a non-negotiable floor: `AnimationPlayer` + clip selection
   per engine event (walk during `movements[]`, attack during
   `attacks[]`, loot during `loots[]`, idle otherwise).

3. **VFX pipeline language, not entity-meshes (§13: "operationalising
   slick is pipeline").** Round 4 leaks renderer smells: blood pools
   as `CylinderMesh` disks (read as objects, not paint), armor as
   floating attached mesh (reads as t-shirt entity, not a property of
   the body), single-color persona meshes (read as untextured). The
   pipeline language fix: **decals** for surface marks, **material
   swaps** for state changes on existing meshes, **PBR textures** on
   base geometry, **per-persona color palette** (base + accent +
   emissive trim).

   This is also the **pack-breadth round**: 8 distinct CC0/permissive
   rigged stylized character packs (one per persona) so the user can
   compare and pick a direction. Kenney, Quaternius, Robin Lamb
   already burned 4 persona slots in Round 4 — Round 5 reuses at most
   one slot each, freeing 5 NEW pack sources for the remaining
   personas.

Decision filter (§7): does this make prompt-authored behaviour more
*legible* or more *shareable*? — Yes:
- Honest within-turn sequencing makes attribution legible (§5: "user
  must see the move that led to the loot").
- Limb motion is the dominant felt-experience signal (§13) — gore is
  unwatchable when characters slide and t-pose.
- Pack breadth is the probe shape (§10 R&D rounds sample breadth
  before consolidating) — premature consolidation destroys the
  signal the user needs to pick a direction.

---

## 2. Overview

Three work packages, all throwaway by default:

| WP | Scope | Throwaway? |
|---|---|---|
| **WP-A** | Within-turn event sequencing fix | **Throwaway** (renderer-side); contract-side fallback only if investigation proves it strictly necessary |
| **WP-B** | 8-persona pack-breadth sampling + rigged skeletal animation via AnimationPlayer | **Throwaway** |
| **WP-C** | VFX pipeline rework — blood decals, armor material-swap, environment polish extended, per-persona palette | **Throwaway** |

The Round-4 corpse prone-humanoid mesh **STAYS** — user explicitly
liked it. Round-4 wired PNG textures (floor/wall/cover/crate/evac)
**STAY** as the baseline; WP-C extends but does not regress.

---

## 3. Architecture Design

### 3.1 WP-A — Within-turn event sequencing fix (renderer-side)

#### 3.1.1 Diagnosis of the current bug

`throwaway-prototypes/d-full-match/src/CombatVfx.gd:45-55`:

```gdscript
func update_to_turn(turn_value: float, delta: float) -> void:
    var turn_int := int(floor(turn_value))
    if turn_int < last_triggered_turn:
        _clear_effects()
        last_triggered_turn = -1
    if turn_int != last_triggered_turn:
        for event_turn in range(last_triggered_turn + 1, turn_int + 1):
            _trigger_turn(event_turn)
        last_triggered_turn = turn_int
```

Turn N's wall-slams + attacks + loots all fire the **instant**
`floor(turn_value) == N`. Given how turn intervals are laid out in
the playback clock:

- `PlaybackClock.current_turn` starts at `1.0` (`start_turn`); clamps
  at `endTurn = turnCount`.
- `EntityRenderer._active_movement_for_character` reads
  `movements[turn=floor(current_turn_value)]` and interpolates along
  its `path[]` using `_turn_fraction()` = fractional part of
  `current_turn_value`.
- Therefore turn N's movement animation visually occupies
  `turn_value ∈ [N, N+1)`: fraction 0.0 = at fromTile, fraction ~1.0
  = at toTile.

But `_trigger_turn(N)` fires the moment `floor(turn_value)` becomes
N — i.e., at fraction 0.0, when the character is still at the
fromTile and the move animation has not even started. Loot, attack,
and gore VFX play simultaneously with the start of movement, which
the user perceives as "loot fires at the START of the turn".

#### 3.1.2 Fix shape (renderer-side, throwaway)

Introduce a per-turn **action-phase threshold** inside the renderer.
Move animation plays during fraction `[0.0, ACTION_PHASE_START)`;
action VFX fire when `turn_value` crosses
`N + ACTION_PHASE_START`. Suggested starting point:
`ACTION_PHASE_START := 0.65` (implementer-tunable). Concretely:

```gdscript
const ACTION_PHASE_START := 0.65   # implementer-tunable

# Init from start_turn - 1 so the first update at turn = start_turn
# (fraction 0.0) does NOT inadvertently resolve through start_turn - 1
# and re-fire its action phase. PlaybackClock.start_turn is typically 1,
# so the seed is 0; engineer pulls the actual start_turn from the snapshot
# header (see PlaybackClock.gd start_turn / end_turn).
var actions_fired_through_turn := -1   # rebinds to start_turn - 1 in configure()

func update_to_turn(turn_value: float, delta: float) -> void:
    var turn_int := int(floor(turn_value))
    var fraction := turn_value - float(turn_int)

    # Compute through-which-turn the action phase has resolved.
    var resolved_through := turn_int - 1
    if fraction >= ACTION_PHASE_START:
        resolved_through = turn_int
    # End-of-playback clamp: when the clock has hit endTurn, all
    # action phases including the final turn's must have fired. This
    # guarantees the final-turn events are NOT stranded if endTurn is
    # the clock's terminal tick and never visibly crosses
    # endTurn + ACTION_PHASE_START. Scaffold-verify must include an
    # assertion that the clamp branch exists; reviewer trace must
    # confirm `maxEventTurn <= endTurn` and that the final turn's
    # action phase fires before/at playback stop.
    var end_turn := _end_turn_from_snapshot()
    if turn_int >= end_turn:
        resolved_through = end_turn

    # Scrub-back: belt-and-suspenders given EntityRenderer
    # `_clear_event_marks` already reconfigures combat_vfx on backward
    # scrub (which resets actions_fired_through_turn via configure()).
    # The inline branch protects against direct (non-scrub) re-entry.
    if resolved_through < actions_fired_through_turn:
        _clear_effects()
        actions_fired_through_turn = _initial_actions_fired_through_turn()

    if resolved_through > actions_fired_through_turn:
        for tn in range(actions_fired_through_turn + 1, resolved_through + 1):
            _trigger_turn(tn)
        actions_fired_through_turn = resolved_through

    _update_bursts(delta)
    _update_chunks(delta)
```

Required parallel changes:
- `EntityRenderer.gd` currently calls `play_attack_pose`,
  `mark_lethal_target`, `play_wall_slam`, `play_loot_pickup`, and
  `mark_loot_source` synchronously from `CombatVfx._trigger_attack` /
  `_trigger_loot` / `_trigger_wall_face_slam`. Those hooks already
  fire only when CombatVfx triggers — so threading the threshold
  through CombatVfx alone is sufficient. Confirm by code-grep that
  no other site fires action VFX directly off `floor(turn_value)`.
- `EntityRenderer._update_environmental_effects` (the
  `_trigger_mist` red-mist beat for telefrag) ALSO currently fires
  on `last_effect_turn != turn_int` at `floor()` boundary. Apply the
  same threshold gate so environmental death VFX align with action
  phase.
- **`EntityRenderer._update_equipment_for_turn` (the equipment
  visibility update) ALSO reads `_contract_frame_for_turn(int(floor(
  turn_value)))` at line 677 — so a freshly-looted weapon currently
  snaps onto the character mesh at fraction 0.0 of the loot turn,
  *before* the loot VFX / animation play.** Once WP-A gates the VFX,
  this becomes the visible regression: new weapon appears before the
  pickup that produced it. Apply the SAME threshold: hold the previous
  turn's equipped frame until `fraction >= ACTION_PHASE_START`, then
  snap to the current turn's frame. Suggested shape:
  `var equip_turn := turn_int if fraction >= ACTION_PHASE_START else turn_int - 1; equipment_attachment.update_equipment(_contract_frame_for_turn(equip_turn).get("equippedByCharacter", {}))`.
  Edge: for `turn_int == start_turn`, `turn_int - 1 < start_turn` —
  resolve to the snapshot's starting-equipment frame (`_contract_frame_for_turn`
  already does prefix-scan and returns the latest frame ≤ requested turn,
  so passing `start_turn - 1` may return `{}`; engineer guards by
  clamping `equip_turn = max(equip_turn, start_turn)` and accepts that
  starting equipment is visible at t=0 of start_turn).
- **Wall face-slam: fire at movement-end (≈ fraction 1.0), not action
  phase.** A wall-slam is a movement event (the character ramming the
  wall *is* their movement resolving), not an action against another
  character. Firing at action-phase threshold (0.65) would visually
  detach the slam from the path that produced it. **Default for WP-A:
  gate wall-slams on `fraction >= 0.95`** (or equivalent —
  engineer-tunable in `[0.85, 1.0]`), with the end-of-playback clamp
  also covering them. Investigation step: if blocked-movement paths
  have no playback interval (i.e., the renderer doesn't interpolate
  along a truncated path for a wall-blocked move and the character
  pops to the slam tile immediately), the slam may need to ride at
  action-phase threshold for visibility — but the investigation should
  confirm/refute this before the engineer commits. Document the chosen
  semantic in WP-A closing notes.

#### 3.1.3 Investigation plan (before writing the patch)

The engineer must verify the diagnosis above by:
1. Reading `MatchPlayer._process` (`MatchPlayer.gd:28-32`) — confirm
   the per-frame call chain is
   `PlaybackClock._process → EntityRenderer.update_to_turn →
   CombatVfx.update_to_turn(turn_value, delta)` with `turn_value`
   carrying the fractional part untouched.
2. Reading `EntityRenderer._character_world_position` /
   `_active_movement_for_character` / `_turn_fraction` to confirm
   the movement animation interval is `[N, N+1)` for
   `movements[turn=N]`.
3. Reading `CombatVfx._index_events` to confirm events are bucketed
   by `event.turn` and fired only via `_trigger_turn`.
4. Sanity-checking that the engine emits all turn-N attacks/loots
   into the snapshot with `turn === N` (no off-by-one in event
   emission). Grep `convex/replay/snapshot.ts` `buildAttacks` /
   `buildLoots` for the `turn` field assignment.
5. Confirming no other code path fires attack/loot/gore VFX directly
   off the clock (`Grep` for `_trigger`, `play_attack_pose`,
   `play_loot_pickup`, `mark_loot_source`, `play_wall_slam` in
   `src/*.gd`).

**Schema-side timing field — only as fallback.** Mental-model §13
ratifies that within-turn sequencing is *implicit in the snapshot
schema* (`movements[]` and `actions[]` are separate arrays in engine-
resolution order, no within-turn timestamp required). A renderer-side
threshold is the canonical fix. If — and only if — investigation
proves the renderer cannot determine action-after-move timing without
additional snapshot data (e.g., the engine emits events with
overlapping `turn` values that cannot be re-sequenced from existing
fields), the engineer MAY propose a schema-side timing field
(e.g., `attacks[].afterMovementResolved: true`). Such a change
escapes throwaway and MUST follow Round-4 D1 pattern:
- Separate commit, scoped to the contract change only.
- `MatchSnapshotJson.schemaVersion: 3 → 4` (forward-only POC).
- No back-compat shim, no migration code.
- Schema-validator update, persistence-adapter parity tests in both
  `convex/runMatch.ts` and `convex/_internal_runMatch.ts`.
- Snapshot-builder mining of the new field, full unit-test matrix.
- Old prototypes broken on bump is acceptable.

Default posture: investigation will confirm a schema bump is NOT
necessary, and WP-A stays throwaway. The schema-bump branch is
documented here so the engineer doesn't unilaterally invent a
contract change without PM ratification.

### 3.2 WP-B — Pack breadth + rigged skeletal animation

#### 3.2.1 Pack-breadth rule

Eight personas, eight distinct CC0/permissive rigged stylized
character pack sources. Kenney, Quaternius, and Robin Lamb were each
burned across multiple slots in Round 4 (Kenney×4, Quaternius×1,
Robin Lamb×1, plus 2 local primitives) — Round 5 reuses each prior
source for **at most one persona slot**, leaving FIVE NEW pack
sources to be picked by the engineer.

Candidate pool (engineer chooses 5 new):
- **KayKit (Kay Lousberg)** — stylized rigged characters with walk /
  attack / death animations; consistent silhouette family.
- **Mixamo (Adobe)** — auto-rigger + huge animation library;
  royalty-free for commercial; works on any unrigged humanoid base.
  Mixamo is itself an *animation* source — it pairs with a body mesh
  from elsewhere.
- **Synty FREE samples** — limited but available; Synty EULA (not
  CC0) is permissive enough for R&D; engineer records as
  `synty-eula` in manifest license field.
- **Sketchfab CC0** — filtered downloads of CC0-licensed rigged
  characters; quality varies.
- **Poly Pizza** — CC0 stylized model aggregator; some rigged
  options.
- **OpenGameArt CC0** — broad pool; quality varies; rigged subset is
  smaller.
- **GDQuest sample assets** — rigged characters bundled with their
  open-source learning material; CC0/CC-BY depending on pack.

Engineer fills the table in §5 WP-B success criteria with the
specific picks + one-line rationale per persona. The manifest entry
per asset records SPDX license (or permissive-non-SPDX string),
upstream URL, sha256, sizeBytes, the persona slot, and which animation
clips are present (`walk`, `idle`, `attack`, `loot` / generic-action).

**One slot per old source is the cap.** If the engineer reuses Kenney
for, say, the rat persona, the other seven slots MUST come from seven
different new sources (none of which are Kenney). Source breadth is
the deliberate R&D probe shape — overlap defeats the point.

**Mixamo treatment.** Mixamo provides animation clips, not a body
mesh, so a Mixamo-driven persona pairs Mixamo animation with a body
mesh from elsewhere (Quaternius low-poly humanoid, a generic
Sketchfab base, etc.). For the pack-breadth rule, the **body-mesh
source** is what counts. A Mixamo-animated Quaternius body counts as
a Quaternius slot (not a separate Mixamo slot), because the silhouette
under inspection is Quaternius. If the engineer wants Mixamo to be a
distinct pack-source slot, they pair it with a body mesh from an
otherwise-unused source.

**`sourceKey` — normalized body-source identity.** The reuse cap
operates on the *body-mesh creator*, not the *aggregator hosting the
download*. Sketchfab, Poly Pizza, OpenGameArt are aggregators — the
same underlying creator's pack can appear on multiple aggregators.
The pack-breadth rule applies to the underlying creator. Each
character manifest entry MUST include a `sourceKey` field — a
normalized lowercase-kebab string identifying the body-mesh creator
(`"kenney"`, `"quaternius"`, `"robin-lamb"`, `"kaykit"`,
`"synty-free"`, `"poly-haven-character"`, `"sketchfab-creator-<handle>"`,
`"opengameart-creator-<handle>"`, `"gdquest"`, `"local-primitive"`,
etc.). Mixamo body-base usage records the body's `sourceKey` (e.g.,
`"quaternius"` for a Mixamo-animated Quaternius mesh) and a `notes`
line about Mixamo anim sourcing. The scaffold-verify reuse-cap
assertion runs on `sourceKey`, not on `source.creator` / `source.pageUrl`
(which may be aggregator-mediated).

**Local primitive humanoids — strictly fallback.** Round 4 used two
local primitives (trader, sprinter). For Round 5, local primitives
are acceptable **only** if no suitable CC0 pack covers a persona
slot, and only with explicit one-line rationale in the manifest
entry. Default expectation: zero local-primitive personas in Round 5
— eight distinct sourced packs is the target.

#### 3.2.2 Rigged skeletal animation integration

For each character pack, the engineer:

1. **Imports the .glb with rig + animations intact.** Godot's GLTF
   importer handles `Skeleton3D` + `AnimationPlayer` natively for
   well-formed glTF rigs. Mixamo-rigged FBX exports converted to
   glTF via Blender or `gltf-pipeline` are acceptable.
2. **Identifies clip names in each pack.** Pack-by-pack the clip
   names differ (`Walk`, `walk`, `WalkCycle`, `Armature|Walk`,
   `Take 001`, etc.). The manifest records the resolved clip name per
   logical event:

   ```jsonc
   {
     "id": "character.rat",
     "personaSlot": "rat",
     "file": "characters/rat-<pack>.glb",
     ...
     "animation": {
       "walk":   "Armature|Walk",
       "idle":   "Armature|Idle",
       "attack": "Armature|Attack",
       "loot":   "Armature|Pickup",      // optional; fallback to "generic"
       "generic": "Armature|Action"      // fallback for loot if no loot clip
     }
   }
   ```

3. **Drives clip selection per engine event in the renderer**:
   - `walk` clip plays while the character has an active
     `movements[turn=N]` entry and the action phase has not yet
     started (`turn_fraction < ACTION_PHASE_START`).
   - `attack` clip plays during the action phase on the turn the
     character has an `attacks[]` event (oriented attacker → target
     per existing `play_attack_pose` hook).
   - `loot` clip plays during the action phase on the turn the
     character has a `loots[]` event. If the pack lacks a `loot`
     clip, fall back to `generic` (or `attack` as a last resort).
   - `idle` clip plays otherwise (between turns, when stationary,
     when waiting in action phase with no event of their own).

4. **Implementation site** is a new helper or refactor of
   `EntityRenderer.gd` (likely a new `_apply_anim_clip(character_id,
   clip_kind)` method) that resolves the manifest clip name and
   tells the character's `AnimationPlayer` to play it. The existing
   `attack_pose_by_character` / `loot_pose_by_character` /
   `wall_slam_by_character` "pose timer" dictionaries can be retired
   or repurposed to track which clip is currently active so the
   renderer doesn't restart the clip every frame.

5. **Whole-body tilt attacks must be removed where rigged anim is
   available — per-persona policy.** For personas with a rigged
   `animation.attack` clip, `_update_attack_poses` MUST NOT apply
   `visual.rotation_degrees.x` / `visual.position.y` to the parent
   `Node3D` for that persona — the rigged skeleton drives the motion
   via `AnimationPlayer.play("attack")`. For fallback personas
   (manifest lacks a rigged attack clip and is documented as
   translation-only or pose-only), whole-body-tilt remains as the
   visible affordance. Apply the SAME per-persona gate to the
   `wall_slam_by_character` pose updater (rigged personas with no
   wall-slam clip MAY still use the rotation pose if there's no
   rigged equivalent) and the `loot_pose_by_character` updater
   (rigged personas with `animation.loot` use the clip, not the
   `position.y` bob). The gate is: "does this persona's manifest
   `animation.<event>` entry resolve to a clip name? If yes, the
   AnimationPlayer drives it; if no, the legacy pose mechanism
   applies." Implementer wires the gate via a per-character lookup
   into the manifest at attack/loot/slam trigger time.

6. **Incomplete clip coverage policy.** If a sourced pack ships only
   walk + idle (no attack, no loot), the engineer has three
   options:
   - **Pair with Mixamo** — pull missing clips from Mixamo onto the
     same rig (often auto-retargetable). Record in manifest notes.
   - **Fallback to translation-only** for that persona — manifest
     entry calls this out explicitly as a known regression for that
     slot. Acceptable for at most 1 persona; the user wants breadth
     of MOTION, not breadth of stillness.
   - **Reject the pack** — pick a different source for that
     persona slot.

   Whatever option lands per persona must be documented in the
   manifest `notes` field per asset.

#### 3.2.3 EquipmentMeshAttachment under rigged characters

`EquipmentMeshAttachment.gd` currently attaches weapon/armour as
child `Node3D` of the character at deterministic `handOffset` (no
bone lookup, because Round-4 models lacked a shared bone map).

For Round 5, **weapon attachment** should hook into the
`Skeleton3D`'s hand bone where possible. Manifest entry per pack
records the hand bone name (e.g., `"RightHand"`, `"hand.R"`,
`"mixamorig:RightHand"`); the runtime resolves the bone via
`Skeleton3D.find_bone(name)` and attaches the weapon `MeshInstance3D`
to a `BoneAttachment3D` node. Packs without a documented hand bone
fall back to the existing `handOffset` (still acceptable, but
manifest notes call out the inconsistency).

**Armour attachment changes per WP-C** — see §3.3.2.

### 3.3 WP-C — VFX pipeline rework

Three subsystems, each replacing a Round-4 "renderer smell" with the
pipeline language the §13 refresh codifies.

#### 3.3.1 Blood pools — `CylinderMesh` → `Decal` (with fallback)

Round 4 spawns blood pools via `_spawn_blood_pool` in
`CombatVfx.gd:186-203`:

```gdscript
var mesh := CylinderMesh.new()
mesh.top_radius = randf_range(0.20, 0.42)
mesh.bottom_radius = mesh.top_radius
mesh.height = 0.012
pool.mesh = mesh
pool.material_override = mat_blood_dark
```

This reads as a *disk entity* sitting on the floor — exactly the
smell §13 calls out ("Spawning a new entity-mesh as a stand-in for
what should be a material/decal/particle effect is a renderer
smell").

**Migration target: `Decal` node with a splatter texture.** Godot's
`Decal` node projects a texture onto whatever geometry sits inside
its bounding box, so the splatter shape conforms to the floor
material's PBR layer rather than floating as a separate object.

```gdscript
var pool := Decal.new()
pool.name = "persistent-blood-pool"
pool.texture_albedo = preload("res://shared-harness/art-kit/textures/blood-splatter.png")
pool.size = Vector3(randf_range(0.6, 1.2), 0.4, randf_range(0.6, 1.2))
pool.albedo_mix = 1.0
pool.rotation.y = randf() * TAU
pool.position = Vector3(origin.x + jitter, 0.02, origin.z + jitter)
add_child(pool)
blood_pools.append(pool)
# ring-buffer eviction unchanged
```

**Ring-buffer behavior preserved** — `blood_pools` array, cap
`MAX_BLOOD_POOLS = 64`, oldest-evicted-on-overflow,
no decay. Round-4 contract.

**Splatter texture is sourced art**, not procedurally generated. CC0
splatter textures available from OpenGameArt, Poly Haven, ambientCG.
A 512×512 alpha-channel splatter PNG (or atlas of 3-4 splatter
variants randomly selected per spawn) is sufficient. Manifest entry
under `textures/` records source + license + sha256 per the existing
manifest shape.

**Compatibility-renderer fallback.** The Godot Compatibility/WebGL2
renderer's `Decal` support is partial — it works in the Forward+
desktop pipeline but is documented as unsupported or limited in
Compatibility mode (Godot 4.x). The engineer MUST verify behaviour
on the actual web export target before committing. If `Decal` does
not work in Compatibility/WebGL2:

- **Fallback A:** `MeshInstance3D` with a `QuadMesh` lying flat on
  the floor + a `StandardMaterial3D` carrying the splatter texture
  in `albedo_texture` with `transparency = TRANSPARENCY_ALPHA`. This
  reads as a paint *quad* but with a splatter-shaped alpha mask the
  visual smell evaporates — the eye reads "paint splatter", not
  "disk".
- **Fallback B (rejected default):** Continue with `CylinderMesh`
  but apply a splatter alpha texture as material override. Less
  ideal — cylinder edge geometry is visible at oblique angles.

**Engineer's call to make at implement time** based on actual
web-export behaviour. Default to Fallback A if Decal fails — it's
the cheapest visual upgrade that meets the §13 "paint not entity"
read.

#### 3.3.2 Armor — separately-attached mesh → material-change on character

Round 4 attaches armour via `EquipmentMeshAttachment.gd` as a child
mesh at a deterministic offset on the character. User feedback: this
reads as a "floating t-shirt entity". The §13 refresh codifies:
*"armor tier shown as a metallic/emissive shift on the character
body, not a separately-attached floating mesh."*

**Migration target:** the character's body `MeshInstance3D` gets a
runtime material modulation (or override) reflecting the equipped
armour tier. The separately-attached armour mesh is removed.

**Tier readability via material variation alone.** Three armour
tiers — low / mid / high — must be readable at a glance. Suggested
ramp (engineer-tunable):

| Tier | Albedo modulation | Metallic | Emissive trim | Roughness |
|---|---|---|---|---|
| low (cloth, leather) | neutral / slight desaturation | 0.0 | none | 0.9 (matte) |
| mid (chain) | cool steel tint | 0.55 | subtle cyan rim at body-mesh emission channel | 0.45 |
| high (plate, riot_plate) | warm crimson-tinged metal | 0.85 | crimson rim/glow at emission channel | 0.25 (glossy) |

The exact numbers are implementer-tunable within the table's bands.
Acceptance is code-readable, not visual: scaffold-verify asserts the
three tiers map to three distinct `(metallic, emissive_strength)`
tuples per pack body-material (i.e., the code path produces three
materially-different state shapes), and a reviewer code-checks the
ramp shape against the table. The visual readability test ("user can
tell low vs mid vs high at a glance") is user-UAT territory, not
implementer-visual-tuning territory.

**Implementation path** — refactor `EquipmentMeshAttachment.gd`:

- `register_character` records the character's body
  `MeshInstance3D`(s) — walk the imported scene's MeshInstance3D
  children at register time, cache them per character.
- `update_equipment` no longer attaches an armour mesh. Instead, it
  reads the equipped armour tier from the manifest and applies a
  per-tier `StandardMaterial3D` (or `next_pass` material override,
  or shader parameter) to the cached body meshes. If the pack ships
  multi-material body meshes (e.g., separate head + body materials),
  the modulation applies uniformly across all of them — or
  selectively per body part if the manifest pack notes say which
  bones/surfaces are "armour-eligible".
- Weapon attachment is unchanged at this layer (still mesh-on-bone
  per §3.2.3).

**Visible swap timing.** The armour material modulation triggers on
the same `loots[]` event that previously triggered the mesh swap.
Implementer chooses whether to flash a brief emissive ramp during
the swap moment (e.g., glow brightens for 0.3s then settles) to
preserve a felt "upgrade moment".

**Pack-mesh constraints.** Some sourced packs have armour pre-baked
into their body texture (e.g., a knight pack with painted plate).
In that case the material-swap is layered *over* the painted base —
the metallic + emissive boost still reads as a tier difference even
on a pre-painted base mesh. Manifest notes per pack call out any
unusual base-material assumptions.

#### 3.3.3 Environment PBR materials — extend Round 4 baseline

Round 4 wired five PNG textures (`floor-neon-dungeon`,
`wall-dark-metal`, `cover-hazard-rust`, `crate-neon-wear`,
`evac-crimson-glyph`) into `SceneBuilder._make_materials` and
`EntityRenderer` crate materials. **These STAY.** WP-C extends:

- **Normal maps** for at least one of the wall/floor/cover materials
  to make the PBR read more physical. CC0 normal map atlases exist
  for the same texture sources (Poly Haven, ambientCG).
- **Metallic + roughness maps** where the source texture has them,
  or implementer-derived from albedo where they don't.
- **Optional: ambient occlusion** baked into the floor/wall
  materials.
- **Lighting baseline preserved per scaffold-verify** — neon key
  light + crimson rim light remain. No regression on the WorldEnvironment
  configuration.

Acceptance bar: walls, cover, floor, crates, evac read as
**textured PBR surfaces** (visible material grain, surface
variation, depth under light), not flat single-color blocks. Round-4
baseline already meets this in some places; WP-C closes any gaps the
implementer identifies during code review.

#### 3.3.4 Per-persona color palette

User feedback: "Characters are single color." The §13 refresh
codifies *"character base color uses a 2-3 channel palette per
persona (base + accent + emissive trim) — not a single solid
color"*.

Two integration paths, engineer-pick depending on per-pack mesh
structure:

1. **Multi-material packs** (most KayKit, Quaternius, Robin Lamb
   packs ship 2-3 material slots per character — body / accent /
   trim). Apply a per-persona palette by assigning a
   `StandardMaterial3D` per slot with the persona's
   base/accent/emissive colors.

2. **Single-material packs** (some Kenney, single-texture exports).
   Apply a `next_pass` material with an emissive trim or use a shader
   that channel-masks the texture by hue and re-tints regions.
   Cheaper: just tint the existing material with the persona's accent
   color via `albedo_color` modulation, and ADD an emissive trim
   `next_pass` material for a glow stripe.

Suggested palette per persona (implementer-tunable):

| Persona | Base | Accent | Emissive trim |
|---|---|---|---|
| rat | dark grey-brown | rust-red | dim amber |
| duelist | steel-blue | gold | bright cyan |
| trader | charcoal | neon cyan | hot pink |
| opportunist | gunmetal | hazard-yellow | sodium-orange |
| paranoid | deep purple | violet | electric blue |
| camper | olive-green | desaturated tan | warm green |
| sprinter | crimson-black | bright red | white-hot |
| vulture | bone-white / pale | deep red | dim crimson |

Manifest entry per character records the chosen 3-channel palette.
The §13 cyberpunk × Diablo brief is the umbrella aesthetic; per-persona
palettes are picked by code-readable contrast against the
`WorldEnvironment` lighting config (neon key + crimson rim) rather
than by visual inspection — the engineer documents the colour values
in the manifest and reviewer code-checks that no two persona palettes
have all-three-channels within ΔE<10 of each other. Final visual
judgement is the user's, on their own UAT pass.

**Palette application site (pinned).** The per-persona material
modulation is applied at character spawn time, inside
`EquipmentMeshAttachment.register_character(character_id, mesh_root)`
(extended to receive the persona id) OR inside
`EntityRenderer._spawn_characters` immediately after the imported
scene's `MeshInstance3D` children are walked. Either site is
acceptable — `EquipmentMeshAttachment.register_character` is
preferred because it already caches body-mesh references for the
armour material-swap path (§3.3.2) and the palette colour is part of
the same per-character material configuration. NOT applied per-frame
in `_process` (avoids overhead) and NOT applied at manifest-load
time (palette is per-instance, not per-asset). Scaffold-verify
assertion: palette colour values from the manifest appear in the
spawn-site code path.

### 3.4 Documentation

- `throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md`
  updated by the closing-readout job with the new persona→pack table,
  the rigged-animation integration, the VFX pipeline migrations, and
  the timing-fix description.
- `docs/project/phases/render-rnd/round-5-closing-readout.md`
  written by the closing-readout job at assignment end (mirrors the
  Round-4 closing readout structure).
- Mental-model §13 refinements are landed **before** the engineer
  reads it (Outcome🧭Steward owns this; the engineer reads §13 as a
  contract).

---

## 4. Dependency Map

```
       WP-A (timing fix, renderer-side)
        │   small, fast, isolatable
        ▼
   [unblocks] ─ WP-B (pack breadth + rigged anim)
                  │  largest WP, asset-heavy
                  │
                  ├──parallelisable with──┐
                  │                       ▼
                  └─────────────────► WP-C (VFX pipeline rework)
                                       │  touches CombatVfx +
                                       │  EquipmentMeshAttachment +
                                       │  per-persona palettes
                                       ▼
                                 closing readout
```

- **WP-A is independent** — touches `CombatVfx.gd` (and possibly
  `EntityRenderer._update_environmental_effects`) only. Can land
  first in isolation; doesn't depend on WP-B or WP-C.
- **WP-B (pack breadth + rigged anim)** is the largest WP — 8 packs
  to source + manifest + clip-name resolution + renderer integration.
  Can run in parallel with WP-C since their file overlap is small
  (WP-B touches `EntityRenderer.gd` for anim hooks +
  `EquipmentMeshAttachment.gd` for hand-bone attachment; WP-C
  touches `CombatVfx.gd` for blood decals +
  `EquipmentMeshAttachment.gd` for armour material-swap +
  `SceneBuilder.gd` for environment polish + per-persona palette
  may touch character spawn in `EntityRenderer.gd`).
- **WP-C's armor material-swap** depends on knowing the body mesh
  structure of each WP-B pack — so WP-C's armor sub-task is gated on
  WP-B's pack picks being committed (manifest entries with mesh
  structure notes). WP-C's blood decal + environment + palette
  sub-tasks have no WP-B dependency.
- **Parallelisation opportunity:** dispatch WP-A first (small, fast),
  then dispatch WP-B + WP-C blood-decal + WP-C environment + WP-C
  palette simultaneously; gate WP-C armor material-swap on WP-B
  pack-pick commit.

**Practical dispatch shape recommendation** (single-engineer): WP-A
→ WP-B → WP-C as three sequential commits. Parallelism opportunity
exists for multi-engineer scenarios but the WP-B asset-sourcing work
is the long pole and trades poorly against parallelism.

---

## 5. Work Package Breakdown

### WP-A — Within-turn event sequencing fix *(throwaway by default)*

**Scope:**
- Investigation per §3.1.3 (read MatchPlayer / EntityRenderer /
  CombatVfx call chain end-to-end; confirm diagnosis; verify no
  other site fires action VFX off `floor(turn_value)`).
- Patch `CombatVfx.update_to_turn` per §3.1.2:
  - Introduce `ACTION_PHASE_START` constant (default 0.65).
  - Track `actions_fired_through_turn` instead of
    `last_triggered_turn`.
  - Compute `resolved_through` from `turn_value` and the end-of-
    playback clamp.
  - Handle scrub-back via `resolved_through < actions_fired_through_turn`.
- Patch `EntityRenderer._update_environmental_effects` to gate
  red-mist firing on the same threshold (or unify both through a
  shared helper).
- Implement the wall-slam threshold treatment per §3.1.2 default
  (movement-end, `fraction >= 0.95`). If investigation proves
  wall-blocked paths have no playback interval (renderer pops the
  character to the slam tile), document the investigation finding
  and switch to action-phase gating. Decision recorded in WP-A
  closing notes — engineer does not make visual-feel judgements;
  the rule is code-and-data driven.
- Unit/scaffold tests:
  - Scaffold-verify: assert the `ACTION_PHASE_START` constant is
    present and within `[0.5, 0.9]`.
  - Scaffold-verify: assert `actions_fired_through_turn` (or
    equivalent) is the gate, not `last_triggered_turn` /
    `floor(turn_value)`.
  - Scaffold-verify: forbidden-token grep stays clean
    (no pathing tokens, no browsertools tokens).
  - Reviewer trace: end-of-playback clamp fires the final turn's
    action phase (clock at endTurn does not strand turn-endTurn
    events).
- Documentation: include the diagnosis + fix in the implementer
  closing notes for WP-A.
- **Schema-bump branch (FALLBACK)** — only if investigation proves
  renderer-side fix is not viable:
  - Separate commit per Round-4 D1.
  - `MatchSnapshotJson.schemaVersion: 3 → 4`.
  - Full unit-test matrix + persistence adapter parity tests.
  - PM ratifies before commit lands.

**Success criteria:**
- ✅ Diagnosis written up in WP-A implementer notes — the engineer
  identifies the exact line/function/threshold and why it fires at
  the wrong time.
- ✅ For a turn with both a move and an action (loot or attack), the
  action VFX does NOT fire at `turn_value == floor(turn_value)` —
  it fires at `turn_value >= floor(turn_value) + ACTION_PHASE_START`.
  Asserted via scaffold-verify code-pattern check.
- ✅ Wall face-slam VFX timing: documented decision (defaulting to
  action-phase gate) implemented and described.
- ✅ Final turn's action VFX fires (end-of-playback clamp triggers
  `_trigger_turn(endTurn)`). Scaffold-verify asserts the clamp
  branch is present.
- ✅ Scrub-back reset works: scrubbing backward across the
  threshold clears effects and resets the fired-through counter.
- ✅ Forbidden-token grep clean (`browsertools`, `chromium`,
  `screenshot`, `puppeteer`, `playwright`, `a_star`, `astar`,
  `find_path`, `bresenham`, `dijkstra`, `breadth_first_search`,
  `manual_collision`).
- ✅ Godot web export builds clean.
- ✅ `npm run lint` / `typecheck` / `build` / `test` clean
  (no production code changed in the renderer-side default path).
- ✅ If schema-bump fallback was used: full WP1-style validation
  matrix from Round 4 spec §8.2, separate commit.
- ❌ Zero browsertools / chromium / visual UAT artefacts.

**Estimated reach:** ~1 `.gd` file modified (`CombatVfx.gd`),
possibly 1 more (`EntityRenderer.gd` for env-effects gate), 1
scaffold-verify update.

---

### WP-B — Pack breadth + rigged skeletal animation *(throwaway)*

**Scope:**
- Source 8 distinct rigged character packs per §3.2.1. At most one
  reuse of Kenney / Quaternius / Robin Lamb across all 8 personas;
  the other 5+ slots come from NEW sources (KayKit, Mixamo, Synty
  FREE, Sketchfab CC0, Poly Pizza, OpenGameArt CC0, GDQuest, etc.).
- Fill the persona→pack mapping table:

| Persona | Pack (source) | License | Walk | Attack | Loot/Generic | Idle | Rationale (1 line) |
|---|---|---|---|---|---|---|---|
| rat | _engineer fills_ | _SPDX/string_ | y/n | y/n | y/n | y/n | _why this pack for rat_ |
| duelist | _engineer fills_ | | | | | | |
| trader | _engineer fills_ | | | | | | |
| opportunist | _engineer fills_ | | | | | | |
| paranoid | _engineer fills_ | | | | | | |
| camper | _engineer fills_ | | | | | | |
| sprinter | _engineer fills_ | | | | | | |
| vulture | _engineer fills_ | | | | | | |

  (At most one row repeats Kenney; at most one repeats Quaternius;
  at most one repeats Robin Lamb. Five+ rows are NEW sources.)
- Add manifest entries per §3.2.2 step 2, including the resolved
  clip names per logical event (walk / idle / attack / loot or
  generic).
- Add `animation` block to each character asset entry in
  `manifest.json` (per §3.2.2 example shape). Bump manifest
  schemaVersion to 3 (manifest-local; this is throwaway, not the
  Convex snapshot schema).
- Refactor `EntityRenderer.gd` (or extract to a new
  `CharacterAnimator.gd` helper) to drive `AnimationPlayer` clip
  selection per engine event:
  - Active `movements[turn=N]` AND `turn_fraction < ACTION_PHASE_START`
    → walk clip.
  - Has `attacks[turn=N]` with this character as attacker, AND
    `turn_fraction >= ACTION_PHASE_START` → attack clip (oriented
    via existing `play_attack_pose` heading logic).
  - Has `loots[turn=N]` for this character, AND
    `turn_fraction >= ACTION_PHASE_START` → loot clip (or generic
    fallback).
  - Otherwise → idle clip.
- Refactor `EquipmentMeshAttachment.gd` weapon attachment to hook
  into `Skeleton3D` hand bone via `BoneAttachment3D` where the
  manifest documents one; fall back to deterministic `handOffset`
  where not.
- Remove whole-body-tilt attack pose mechanism for personas whose
  pack provides a rigged attack clip. Translation-only fallback is
  allowed ONLY for personas explicitly called out in the manifest as
  lacking a rigged attack clip — and at most 1 such persona is
  acceptable.
- Update `scripts/verify-scaffold.mjs` with explicit assertions:
  - **Persona coverage:** `personas.size === 8` and every persona in
    `["rat","duelist","trader","opportunist","paranoid","camper","sprinter","vulture"]`
    is present.
  - **Body-source breadth:** new `bodySources = new Set(characters.map(c => c.sourceKey))`;
    assert `bodySources.size === 8` (eight distinct body-mesh creators).
    The existing `characterSources.size >= 3` assertion at
    `verify-scaffold.mjs:326` is REPLACED by this stronger check.
  - **Prior-source reuse cap:** among the prior-round sources
    `{"kenney","quaternius","robin-lamb"}`, count occurrences in
    `characters.map(c => c.sourceKey)`; assert each prior source
    appears in ≤1 persona slot.
  - **New-source uniqueness:** every `sourceKey` that is NOT a prior
    source appears in EXACTLY 1 persona slot (no duplicates among the
    new pack picks either).
  - **Animation block shape (per character entry):**
    - `entry.animation.walk` is a non-empty string.
    - `entry.animation.idle` is a non-empty string.
    - `entry.animation.attack` is a non-empty string OR `entry.notes`
      contains an explicit fallback string (`"attack-fallback:translation-only"`,
      `"attack-fallback:pose"`, `"attack-fallback:generic"`, etc.).
    - `entry.animation.loot` is a non-empty string OR
      `entry.animation.generic` is a non-empty string OR
      `entry.notes` documents the loot fallback explicitly.
  - **Translation-only cap:** count manifest entries whose `notes`
    contains `"attack-fallback:translation-only"` OR
    `"motion-fallback:translation-only"`; assert count ≤ 1.
  - **Hand-bone metadata (optional but PM-visible):** entries that
    document `attachBone` use a string; entries without resolve to
    fallback `handOffset` and `entry.notes` records the inconsistency
    explicitly.
  - **Manifest schemaVersion bump:** assert
    `manifest.schemaVersion === 3` (manifest-local, NOT the Convex
    snapshot schema — distinct artefact).
  - **Per-asset baseline retained:** every character asset still has
    `source`, `license`, `sizeBytes`, `sha256`, `pivotYOffset`.
- **Godot headless structural check (new scaffold task).** Add a
  scaffold step that runs Godot headless (`$GODOT_BIN --headless
  --script scripts/verify-character-rigs.gd` or equivalent), opens
  each character scene from the manifest, and asserts:
  - The imported scene has at least one `Skeleton3D` node.
  - The imported scene has at least one `AnimationPlayer` node.
  - For each manifest `animation.<event>` clip name, the
    `AnimationPlayer` has a clip with that exact name.
  - For entries documented as translation-only fallback, the script
    still allows the Skeleton3D/AnimationPlayer to be absent — but
    asserts the manifest `notes` field records the fallback.
  This catches the failure mode where the manifest names a clip the
  imported `.glb` doesn't actually expose, which would otherwise only
  surface at runtime as a silent `play()` no-op. The headless check
  is integrated into `npm --prefix throwaway-prototypes/d-full-match
  test` so the scaffold-verify run covers it.
- Reviewer code-grep: no pathing tokens reintroduced, no
  browsertools/screenshot tokens.

**Success criteria:**
- ✅ 8 distinct rigged character pack sources, one per persona,
  with NO two personas sharing a source pack.
- ✅ At most one persona-slot reuses Kenney, Quaternius, Robin Lamb
  (each — so up to 3 slots total reuse prior sources; the other 5+
  are new).
- ✅ Each character pack provides AT LEAST walk + idle. Missing
  attack or loot clips are documented in the manifest with the
  fallback choice (Mixamo pair-in, generic fallback, or
  translation-only translation for at most 1 persona).
- ✅ During playback, the rendered character plays the **walk**
  clip while moving along `movements[].path`; plays the **attack**
  clip during the action phase on turns with an `attacks[]` event
  with the character as attacker; plays the **loot** clip during
  the action phase on turns with a `loots[]` event; plays **idle**
  otherwise.
- ✅ Whole-body-tilt attack pose is removed for all personas with a
  rigged attack clip (manifest documents which one persona, if any,
  falls back to translation-only).
- ✅ Limbs visibly move during walk + attack + loot — verified by
  scaffold-verify checking `AnimationPlayer` access / clip-name
  resolution code is present in the renderer; reviewer code
  inspection that confirms the clip-selection branch covers all
  four logical events.
- ✅ Weapon attachment uses `Skeleton3D.find_bone` / `BoneAttachment3D`
  for packs that document a hand bone (manifest field present).
- ✅ Persona→pack mapping table filled in this spec (engineer
  edits this doc, or links to the manifest with a corresponding
  table copy).
- ✅ Godot web export builds clean with all 8 packs bundled.
- ✅ `npm --prefix throwaway-prototypes/d-full-match test` clean
  (expanded scaffold-verify passes).
- ✅ Forbidden-token grep clean.
- ❌ Zero browsertools / chromium / UAT.

**Estimated reach:** ~5-8 new `.glb` files in `shared-harness/art-kit/
characters/` (5 new packs), ~1 manifest.json edit (8 character
entries updated), ~2 `.gd` files modified (`EntityRenderer.gd`,
`EquipmentMeshAttachment.gd`), possibly 1 new helper `.gd`, 1
scaffold-verify update.

**Quality posture:** breadth, not uniform polish. The R&D point is
"sample 8 pack flavors so the user can pick a direction"; unfiform
polish across all 8 is explicitly NOT the goal.

---

### WP-C — VFX pipeline rework *(throwaway)*

**Scope (three parallel sub-tasks):**

**WP-C.1 — Blood pools as Decals**
- Implement §3.3.1: replace `CylinderMesh` blood pools with `Decal`
  nodes carrying a splatter texture.
- Add splatter texture(s) under
  `shared-harness/art-kit/textures/blood-splatter*.png` (CC0
  sourced). Manifest entry per texture with source + license +
  sha256.
- Preserve ring-buffer behaviour (`MAX_BLOOD_POOLS = 64`,
  oldest-evicted, no decay).
- Verify `Decal` works in Compatibility/WebGL2 web export. If not,
  fall back to `QuadMesh` + alpha-textured `StandardMaterial3D`
  (Fallback A per §3.3.1).
- Document which path was taken in the closing readout.

**WP-C.2 — Armor as material-change on character**
- Implement §3.3.2: refactor `EquipmentMeshAttachment.gd` armour
  path to apply per-tier material modulation on the cached body
  meshes instead of attaching a separate armour mesh.
- Tier ramp per §3.3.2 table (implementer-tunable).
- Remove the separately-attached armour mesh nodes from spawn /
  swap code paths.
- Per-pack body-mesh discovery happens at `register_character`
  time (walk `MeshInstance3D` children, cache the references).
- Visible swap moment preserved (implementer-judged: flash emissive
  ramp during swap).

**WP-C.3 — Environment PBR extended**
- Implement §3.3.3: add normal maps + metallic/roughness maps to at
  least one of wall/floor/cover materials. Manifest entries per new
  texture (CC0 source + license + sha256).
- Lighting baseline preserved (scaffold-verify asserts
  `WorldEnvironment` + neon key light + crimson rim light still
  configured).

**WP-C.4 — Per-persona color palette**
- Implement §3.3.4: each persona's character mesh uses at least 2
  color channels (base + accent or base + emissive trim).
- Per-persona palette recorded in the manifest character entries.
- Suggested palette table per §3.3.4 — engineer-tunable.

**Success criteria:**

- ✅ Blood pools spawn as `Decal` nodes (or documented Fallback A
  `QuadMesh+alpha-mask` if Decal failed in web export). Visible
  splatter shape, not a perfectly-circular disk.
- ✅ Persistent blood pool ring-buffer preserved (cap 64, no
  decay).
- ✅ Splatter texture sourced as CC0; manifest entry records source
  + license + sha256.
- ✅ Equipped armour reads as a material-change on the character
  mesh — NO separately-attached armour mesh remains in the scene
  graph after equip. Reviewer code-grep for any `add_child` armour-
  mesh paths confirms removal.
- ✅ Armour tier (low/mid/high) readable at a glance across all 8
  character packs.
- ✅ Walls, cover, floor, crates, evac carry textured PBR materials
  (at least one material gains a normal map; metallic/roughness
  configured); Round-4 baseline NOT regressed.
- ✅ Lighting baseline preserved per scaffold-verify
  (`WorldEnvironment` + neon-key + crimson-rim).
- ✅ Each persona's character mesh uses ≥2 color channels (base +
  accent or base + emissive trim) — scaffold-verify asserts the
  manifest entry has a 2+ color palette field per character; reviewer
  inspection confirms render-time application.
- ✅ Corpse prone-humanoid mesh (`prone-humanoid-prototype.glb`)
  STAYS untouched — manifest entry unchanged.
- ✅ Godot web export builds clean with new textures + Decal nodes
  (or fallback) + material-swap armour.
- ✅ Forbidden-token grep clean.
- ✅ `npm --prefix throwaway-prototypes/d-full-match test` clean.
- ❌ Zero browsertools / chromium / UAT.

**Estimated reach:** ~2 `.gd` files modified
(`CombatVfx.gd`, `EquipmentMeshAttachment.gd`), ~1 `.gd` modified
for palette application (`EntityRenderer.gd` or
`EquipmentMeshAttachment.register_character`), ~1-3 new texture
files (splatter + at least one normal/metallic map), ~1 manifest
edit, ~1 scaffold-verify update.

**Quality posture:** the pipeline-language fix is the gate, not
art polish. The user is iterating visually and will give feedback
in Round 6.

---

## 6. Assignment-Level Success Criteria

All criteria below testable without browser-mediated visual UAT.

1. **Within-turn event sequencing honest.** For any turn with both
   a `movements[]` entry and an `attacks[]`/`loots[]` entry on the
   same character, the move animation visibly completes (or
   substantially completes — past `ACTION_PHASE_START`) BEFORE the
   action VFX fires. Verified by scaffold-verify code-pattern + reviewer
   trace of the threshold gate.

2. **Skeletal animation drives walk/attack/loot.** For each of the 8
   personas, the rigged skeleton's `AnimationPlayer` plays a walk
   clip during movement, an attack clip during the action phase on
   attack turns, a loot clip during the action phase on loot turns
   (or documented generic fallback), and an idle clip otherwise.
   At most 1 persona may use translation-only motion as a documented
   pack-coverage fallback.

3. **8 distinct rigged character pack sources.** One per persona;
   no two personas share a source. Kenney / Quaternius / Robin Lamb
   each appear in at most 1 slot. Five+ NEW pack sources are
   introduced. Manifest documents persona slot + clip names + license
   + provenance + sha256 per asset.

4. **Blood pools are decal-language.** Blood pools render via
   `Decal` nodes carrying a CC0 splatter texture **OR** — explicitly
   acceptable if web-export Decal compatibility blocks — via
   Fallback A (`QuadMesh` lying flat + `StandardMaterial3D` with
   `transparency = TRANSPARENCY_ALPHA` and the splatter texture in
   `albedo_texture`). Either path satisfies this criterion; the path
   taken is documented in the closing readout. The Round-4
   `CylinderMesh` blood-pool spawn must be removed in either case —
   scaffold-verify asserts `CombatVfx.gd` no longer references
   `CylinderMesh` (or any other `MeshInstance3D`-as-disk shape) for
   blood-pool spawn. Ring-buffer cap 64 preserved.

5. **Armor renders as material-change.** No separately-attached
   armour mesh nodes remain in the scene graph after equip. Tier
   (low/mid/high) readable via metallic+emissive material variation
   alone.

6. **Environment textured PBR.** Walls, cover, floor, crates, evac
   carry textured PBR materials with at least one of normal /
   metallic / roughness extensions over Round-4 baseline. Lighting
   baseline preserved.

7. **Per-persona palette.** Each of the 8 personas uses ≥2 color
   channels (base + accent or base + emissive trim) — no single-color
   character meshes remain.

8. **Corpse prone-humanoid preserved.** Round-4 corpse mesh is
   untouched per user feedback ("corpses are GOOD").

9. **Throwaway boundary preserved.** All changes confined to
   `throwaway-prototypes/d-full-match/` by default. If WP-A's
   investigation forces a schema-bump fallback, it ships as a
   SEPARATE commit per Round-4 D1 pattern (schemaVersion 3 → 4,
   forward-only POC, full validation matrix), and WP-B/WP-C
   commits remain throwaway-only.

10. **All validation green.**
    - `npm run lint` clean.
    - `npm run typecheck` clean.
    - `npm run build` clean.
    - `npm test` clean.
    - `npm --prefix throwaway-prototypes/d-full-match test` clean
      (expanded scaffold-verify passes).
    - `GODOT_BIN=... npm --prefix throwaway-prototypes/d-full-match
      run build` clean (web export builds).
    - Forbidden-token grep clean: `browsertools`, `chromium`,
      `screenshot`, `puppeteer`, `playwright`, `a_star`, `astar`,
      `find_path`, `bresenham`, `dijkstra`, `breadth_first_search`,
      `manual_collision`.

11. **Closing readout written.** Owned by Job 7 (closing-readout
    writer per §8.5); NOT a WP-A/B/C implementer deliverable.
    Produces `docs/project/phases/render-rnd/round-5-closing-readout.md`
    mirroring the Round-4 structure: persona→pack table, animation
    integration notes, VFX pipeline migration notes (which path was
    taken for Decal vs Fallback A, which armour ramp was chosen),
    timing-fix description (including wall-slam semantic rule and
    equipment-swap threshold), controls reminder, blind-UAT focus
    areas, technical ceilings.

12. **NO browser-mediated visual validation in the work history.**
    Reviewer greps for `browsertools`, `chromium`, `screenshot`,
    `puppeteer`, `playwright` in commits + findings — zero matches
    expected. Any deviation is a blocker.

---

## 7. Ambiguities / Decisions — RATIFIED

Plan-review (three reviewers) ratified all defaults below, with two
revisions (#2 wall-slam → movement-end timing, and the new H1 item
folded into WP-A scope per Review A). Recorded as workflow decisions
D5–D9. Engineer implements on these defaults without further PM
polling.

1. **`ACTION_PHASE_START` default value (WP-A) — RATIFIED `0.65`.**
   Implementer-tunable within `[0.55, 0.80]`. Final pick recorded in
   WP-A closing notes (data-driven adjustment based on observed
   clip durations, not visual feel).

2. **Wall face-slam threshold (WP-A) — REVISED to movement-end
   default.** Plan-review (D6) overrode the original action-phase
   default. **NEW DEFAULT:** wall-slam fires at `fraction >= 0.95`
   (engineer-tunable `[0.85, 1.0]`), or via end-of-playback clamp.
   Rationale: wall-slam is movement resolution (the character ramming
   the wall is *their* movement ending), not an action against
   another character; firing at 0.65 would visually detach the slam
   from the path that produced it. If investigation proves blocked-
   movement paths have no playback interval, engineer documents and
   may revert to action-phase gating.

3. **Schema-bump fallback authority for WP-A — RATIFIED PM-gated.**
   Non-negotiable. If investigation proves renderer-side fix is not
   viable, engineer raises finding; PM approves schema-bump branch
   before commit (separate commit, schemaVersion 3 → 4, forward-only,
   no shims, full parity-test matrix per Round-4 D1).

3a. **WP-A scope extension (NEW, per Review A H1) — RATIFIED.**
    `EntityRenderer._update_equipment_for_turn` must apply the SAME
    action-phase threshold so the equipment visibility doesn't snap
    on at fraction 0.0 of the loot turn while the loot animation
    waits for 0.65. Implemented per §3.1.2 "Required parallel
    changes" bullet. Not optional.

4. **Mixamo licensing — RATIFIED `"mixamo-royalty-free"`.** Manifest
   license field uses the permissive-non-SPDX string; SPDX field
   reflects the SOURCE BODY mesh's license; manifest `notes` carries
   the Mixamo anim sourcing line and the body's `sourceKey`.

5. **Synty FREE-pack licensing — RATIFIED `"synty-eula"`.** North
   Star "CC0 or equivalent permissive" admits Synty EULA. Manifest
   records license string + one-line fitness note.

6. **Reuse-cap edge case — RATIFIED binding.** With 7 candidate new
   sources (KayKit/Mixamo/Synty/Sketchfab-CC0/Poly-Pizza/OpenGameArt-
   CC0/GDQuest) for 5+ new slots, the pool is comfortable. If
   sourcing fails, engineer raises for PM rather than silently
   doubling-up.

7. **Persona palette ratifications — RATIFIED engineer-tunable**
   within the cyberpunk × Diablo brief. Picks recorded in manifest;
   reviewer code-checks ΔE distinguishability per §3.3.4.

8. **Local-primitive personas — RATIFIED zero target.** All 8 slots
   sourced. If a slot resists sourcing, engineer flags for PM, does
   not silently reach for local primitive.

9. **`Decal` web-export support — RATIFIED engineer-call-at-implement-
   time, Fallback A is default.** If Decal fails in
   Compatibility/WebGL2, fall back to `QuadMesh + alpha-textured
   StandardMaterial3D` — no additional PM ratification needed.
   Path taken recorded in closing readout.

10. **Splittability — RATIFIED sequential WP-B → WP-C for single
    engineer.** `EquipmentMeshAttachment.gd` and `EntityRenderer.gd`
    overlap makes parallel rebasing costlier than sequential.
    Multi-engineer parallel only with explicit per-file owner
    designation.

---

## 8. Recommended Job Sequence

### 8.1 Plan handoff (this artefact)
- **Job:** Plan (this).
- **Output:** This spec doc + WP breakdown.
- **Plan-review:** RECOMMENDED — three reasons.
  - WP-A introduces a render-pipeline timing model that affects
    every action VFX (worth a second pair of eyes on the threshold
    semantics + scrub-back logic).
  - WP-B asset-sourcing strategy + 8-pack pick is a high-judgment
    decision (the manifest documents the choices but plan-review
    can sanity-check the source list + licensing).
  - WP-C `Decal` vs Fallback A and armour material-swap are
    visual-semantic decisions that benefit from PM/reviewer
    alignment before implementation — even though the engineer will
    pick at implement time, the decision criteria should be
    plan-reviewed.
  - PM may opt to skip plan-review and dispatch directly if the
    spec reads clean against the north star.

### 8.2 WP-A (sequential, first)
- **Job 1:** WP-A implementer — investigate + patch the timing
  fix. Throwaway-only by default; escalates to PM if schema-bump
  fallback is needed.
- **Job 2:** WP-A reviewer — pure code review. Confirms diagnosis,
  threshold logic, scrub-back handling, end-of-playback clamp.
- **Gate:** WP-A reviewer signs off → unblock WP-B + WP-C.

### 8.3 WP-B + WP-C (parallel after WP-A, OR sequential single-engineer)
- **Job 3:** WP-B implementer — pack breadth + rigged anim.
- **Job 4:** WP-C implementer — VFX pipeline rework (sub-tasks
  C.1 / C.2 / C.3 / C.4).
- **Recommendation:** sequential WP-B → WP-C if single-engineer
  (the file overlap on `EquipmentMeshAttachment.gd` is non-trivial
  — WP-B's hand-bone attachment refactor + WP-C's armour
  material-swap both touch it).
- **PM dispatches parallel** only if explicitly briefed that WP-B
  owns `EntityRenderer.gd` + `EquipmentMeshAttachment.gd` and WP-C
  rebases on top.

### 8.4 Reviews
- **Job 5:** WP-B reviewer — manifest correctness, anim integration,
  hand-bone attachment, scaffold-verify expansions.
- **Job 6:** WP-C reviewer — Decal-vs-fallback decision logged,
  armour material-swap renders cleanly, environment PBR not
  regressed, palettes applied.

### 8.5 Closing readout
- **Job 7:** Closing-readout writer — produces
  `docs/project/phases/render-rnd/round-5-closing-readout.md`. Lists:
  - Persona→pack mapping table (final picks).
  - Animation clip resolution per pack.
  - Decal vs Fallback A decision + WebGL2 compat notes.
  - Armour tier ramp picks.
  - Per-persona palettes applied.
  - Controls reminder.
  - Blind-UAT focus areas for Round-5 specific changes (does the
    timing now feel like move-then-action? do limbs visibly move?
    is blood paint not disks? is armour reading as the body's
    material? etc.).
  - Technical ceilings (e.g., a persona that fell back to
    translation-only, any pack that ships partial clips).

### 8.6 NO `uat` job at any point
The North Star explicitly forbids it. Round 4 D4 discipline applies.
Trust the contract.

---

## 9. Commit-split plan

- **WP-A:**
  - Default path (renderer-side fix only): single commit, throwaway-only.
  - Fallback path (schema-bump required): TWO commits — one for the
    Convex contract change (escapes throwaway, schemaVersion 3 → 4,
    full validation matrix, PM-ratified), one for the renderer-side
    consumption inside the throwaway directory.

- **WP-B + WP-C:** combined throwaway-only commits, may be split per
  WP for review-locality (one commit per WP works fine; one combined
  WP-B+WP-C commit is also acceptable). Either way, NO production-
  code changes in these commits.

- **The corpse mesh** stays untouched — no manifest entry edits to
  the corpse asset.

---

## 10. Validation Discipline (repeated for emphasis)

🚫 NO browsertools / chromium / visual UAT
🚫 NO `uat` job in the work sequence
🚫 NO screenshot artefacts in the work tree
🚫 NO pathing logic in the renderer (forbidden-token grep stays clean)

✅ Validation layer:
- `npm run lint` (root)
- `npm run typecheck` (root)
- `npm run build` (root)
- `npm test` (root)
- `npm --prefix throwaway-prototypes/d-full-match test` —
  scaffold-verify (expanded per WP-A/B/C structural invariants).
- `GODOT_BIN=... npm --prefix throwaway-prototypes/d-full-match
  run build` — Godot web export builds clean.
- Reviewer code-grep for forbidden tokens
  (`browsertools`, `chromium`, `screenshot`, `playwright`,
  `puppeteer`).
- Reviewer code-grep for pathing tokens
  (`a_star`, `astar`, `find_path`, `bresenham`, `dijkstra`,
  `breadth_first_search`, `manual_collision`).
- Closing-readout document so the user can perform their own
  informed visual UAT.

---

## 11. Architectural Principles Re-Stated (load-bearing)

- **Render = ground truth, full stop** (§13). No fog, LOS, perception
  emulation. Round-5 changes do not introduce any of these.
- **Renderer reads engine-emitted truth** (§13). WP-A timing fix
  remains renderer-side; the engine resolution order
  (`movements[]` before `actions[]`) is honoured by the renderer
  reading the separately-bucketed event streams. No re-derivation of
  engine logic in the renderer.
- **Within-turn temporal sequencing is implicit in the snapshot**
  (§13 refresh). No within-turn timestamp is required;
  `movements[]` and `attacks[]`/`loots[]` arrays carry the order
  by being separate streams.
- **Slick is pipeline** (§13 refresh). Decals for surface marks,
  material swaps for state changes, PBR textures over base geometry,
  particles/postprocess for impacts. WP-C is the round's
  operationalisation of this principle.
- **Skeletal animation is part of the spectacle floor** (§13
  refresh). Limbs must visibly move. WP-B is the round's
  operationalisation.
- **R&D rounds sample breadth before consolidating** (§10 refresh).
  WP-B's 8-distinct-source rule is the deliberate probe shape;
  consolidation is a future round, not this one.
- **Gore intensity is loud by design** (§13). Round-4 maximalist
  posture preserved; Decal-language migration does NOT reduce
  intensity — splatter textures are the felt-experience upgrade,
  not a softening.
- **Throwaway boundary preserved** (§13). Production contract
  surfaces (`convex/replay/`, `convex/engine/`,
  `convex/schema.ts`) are untouched in the default path. WP-A
  schema-bump fallback is the only path that escapes throwaway, and
  only with PM ratification.
- **POC posture** (§10). Forward-only; if schema bumps, no
  back-compat shims; old prototypes broken on bump is acceptable.

---

## 12. References

- `docs/project/spec/mental-model.md` §10 (R&D rounds sample
  breadth), §13 (consumer replay render — Decal/material/PBR/
  skeletal-anim/within-turn-sequencing refinements).
- `docs/project/phases/render-rnd/round-4-spectacle-spec.md` (Round 4 spec).
- `docs/project/phases/render-rnd/round-4-closing-readout.md` (Round 4 readout).
- `throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md`
  (Round-4 blind-UAT handoff).
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json`
  (Round-4 per-asset manifest shape — Round-5 extends with
  `animation` block).
- `throwaway-prototypes/d-full-match/src/CombatVfx.gd` (WP-A
  timing-fix site).
- `throwaway-prototypes/d-full-match/src/EntityRenderer.gd` (WP-B
  anim-clip integration site; possible WP-A env-effects gate site).
- `throwaway-prototypes/d-full-match/src/EquipmentMeshAttachment.gd`
  (WP-B hand-bone attachment + WP-C armour material-swap site).
- `throwaway-prototypes/d-full-match/src/SceneBuilder.gd` (WP-C
  environment PBR extension site).
- `throwaway-prototypes/d-full-match/src/MatchPlayer.gd` (WP-A
  per-frame call chain start).
- `throwaway-prototypes/d-full-match/src/PlaybackClock.gd` (WP-A
  current_turn / end_turn semantics).
- `throwaway-prototypes/d-full-match/scripts/verify-scaffold.mjs`
  (scaffold-verify expansion target — WP-A + WP-B + WP-C all add
  structural checks).
- `convex/replay/snapshot.ts` (read-only; confirm event-stream
  `turn` field assignment during WP-A investigation).
- `convex/replay/snapshotTypes.ts` (read-only; only modified if
  WP-A schema-bump fallback fires).

---

*The user will perform visual UAT themselves after assignment
closure. Trust the contract. Round 4 validated this exact
discipline (D4).*
