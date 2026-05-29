# Round-8 Spec — Scale Revert + Sourced CC0 Inventory + Adherence-Approach Breadth

> **Status: PLAN** — Pre-§10-gate R&D probe. Default posture: **all
> changes confined to `throwaway-prototypes/d-full-match/`**. No Convex
> contract change. No snapshot schema bump. Manifest is throwaway-local
> and bumps within the prototype (schemaVersion 5 → 6; POC posture,
> forward-only).
>
> Follow-up to Round 7
> ([`round-7-skin-rnd-spec.md`](./round-7-skin-rnd-spec.md),
> [`round-7-closing-readout.md`](./round-7-closing-readout.md)) and
> Round 7.2 (in-flight at plan time — single-pass implement adding
> bone-attachment via `BoneAttachment3D` to `_apply_projected_mark`,
> sprinter body-region-mask shader, triplanar pattern mapping; build on
> top of whatever Round 7.2 lands).
>
> ⭐ **North Star** ⭐ — Full R&D round. (1) Revert Round-6/7 character
> model scale per UAT (*"Models are too small … bring them back to
> standard size"*). (2) **Research sourced CC0 packs** for skin, gore,
> weapons, armor — replacing engineer-procedural PNGs from Round-7/7.1
> with real authored assets per §13's *sourced-before-procedural*
> principle. (3) **Implement multiple adherence approaches** for surface
> decorations on the skinned mesh2motion body — bone-attached (already
> exists post-Round-7.2), mesh-baked (existing dismemberment pattern),
> UV-painted region shader (existing sprinter pattern), and **modular
> sub-mesh armor** (NEW prototype) — per §13's three-family adherence
> taxonomy. (4) Apply variety across all 8 personas in the Showroom so
> the user can curation-pick winners across 5 axes (skin / gore /
> weapon / armor / adherence approach).
>
> 🚫 **NO UAT / BROWSERTOOLS / CHROMIUM / SCREENSHOTS / HEADLESS VISUAL
> CHECKS.** Round 4/5/6/7 D4 discipline preserved. User runs the
> Showroom themselves. Reviewers operate on code + scaffold-verify +
> Godot headless audits + closing readout.

---

## 1. Purpose

The user's Round-7.2 UAT surfaced five verbatim findings (carried in
the North Star) that resolve to four design problems:

1. **Models read too small** at the Round-6/7 calibrated scale
   (`CHARACTER_MODEL_SCALE := 0.21` × per-body `modelScaleMultiplier
   := 2.1725` ≈ **0.456× of the GLB's native size**). Standard
   game-character size needs to land closer to ~1.0× of the GLB or
   wherever AABB framing/tile-grid proportions read sensibly. Walls,
   cover, crate, and evac proportions stay unchanged.

2. **Adherence is the load-bearing problem for skinned characters**
   (now codified in mental-model §13). The Round-7.2 BoneAttachment3D
   path works for some semantics (sprinter mesh-level dismemberment
   adheres perfectly; camper viscera bone-attaches reasonably) and
   fails for others (opportunist sticker pinned to one contact point
   doesn't wrap the body). Two distinct R&D directions are now
   visible:
   - **For gore on corpses:** sprinter's mesh-level pattern is the
     best evaluation. Mesh-baked and UV-painted approaches likely beat
     bone-attached flat-decals.
   - **For armor:** wrapping is the IDEAL behavior. Two paths to
     research: (a) UV-painted armor as a shader region on the body
     mesh; (b) **modular sub-mesh armor** (separately-rigged armor
     pieces sharing the mesh2motion skeleton — industry-standard
     pattern).

3. **Engineer-procedural PNG textures are the wrong default** (§13
   *sourced-before-procedural* principle). Round-7 shipped 22 PIL-
   generated PNGs (skin + gore) that "didn't produce evaluable
   spectacle". Round-7.1 sourced ambientCG MetalPlates017A for one
   persona and proved sourced packs outperform procedural. Round-8
   switches to sourced CC0 packs as the primary input and treats
   engineer-procedural as a **documented fallback only**.

4. **Idea banking** — Round-7.2 surfaced two techniques whose failure
   modes are features for a *different* application surface
   (triplanar→cover materials; wrapping decals→armor). Mental-model
   §13 now codifies the *idea bank* discipline. This round does not
   chase the cover/triplanar branch (banked) but does begin to invest
   the armor branch as the **modular sub-mesh armor** prototype.

The §7 filter passes on all of these: scale legibility, adherence
fidelity, sourced art quality, and a wrapping-armor read each make
prompt-authored behaviour more *legible* and the §13 cyberpunk-×-Diablo
spectacle more *shareable*. Tactical realism is not the driver.

This round samples **breadth across five axes simultaneously**
(skin / gore / weapon / armor / adherence approach) — the natural §10
recursive pattern given the §13 taxonomy makes adherence-approach
itself a breadth-able axis. The 8 personas become 8 distinct test cells.
The next round will consolidate the user's picks per axis.

---

## 2. Overview

| WP | Scope | Throwaway? |
|---|---|---|
| **WP-A — Scale revert** | Audit native mesh2motion GLB AABB; calculate "standard" scale; update `CHARACTER_MODEL_SCALE` (+/- `modelScaleMultiplier`); extend `audit-character-scales.gd` with a *world-units target band* assertion; verify Showroom + replay framing reads sensibly; no wall/cover/crate/evac changes; camera framing re-tuning if needed. | **Throwaway** |
| **WP-B — Sourced CC0 research** | Research log at `docs/project/phases/render-rnd/round-8-research-log.md` covering 4 categories (skin, gore, weapon, armor). Per pack: name, source URL, license tier (CC0 ratified / CC-BY flagged for user / fallback procedural), one-line fit-rationale for cyberpunk×Diablo, downloaded archive, sha256 of source archive. Download verified CC0 packs to `/tmp/round-8-assets/` and into `shared-harness/art-kit/` under the existing category dirs. | **Throwaway** |
| **WP-C — Adherence approaches** | Codify the four adherence families in `EquipmentMeshAttachment` as labeled dispatchers: `adherence_bone_attached`, `adherence_mesh_baked`, `adherence_uv_painted`, `adherence_modular_submesh`. The first three already have implementations (Round 7 + Round 7.2). NEW: implement `adherence_modular_submesh` prototype — load an armor GLB whose Skeleton3D shares mesh2motion's bone vocabulary, re-parent its skinned meshes to the character's Skeleton3D, follow animation through the same skin binding. Manifest adds `adherenceApproach` field per skin/corpse/armor block for documentation + audit. | **Throwaway** |
| **WP-D — Apply variety to 8 personas** | Each persona becomes one test cell across the 5 axes (skin treatment / gore variant / weapon / armor / adherence approach demonstrated). Manifest documents the combination per persona. At least 3 personas wear modular sub-mesh armor (helmet / chest / gauntlet) so the user can evaluate the wrapping path; other personas keep the Round-5 material-swap armor as control. Weapons swap to a new coherent CC0 pack (sword/axe/dagger/etc.) for visual breadth. | **Throwaway** |
| **WP-E — Verification kit extensions** | New Godot headless audits: `audit-modular-submesh-armor.gd` (asserts armor mesh present + bound to character Skeleton3D); extend `audit-skin-bone-attachments.gd` for adherence-approach coverage assertion; `audit-character-scales.gd` extended with target world-units band; `verify-scaffold.mjs` token + manifest assertions updated for schemaVersion 6 + `adherenceApproach` field. Wired into `package.json test` under `GODOT_BIN` gate. | **Throwaway** |

All WPs stay strictly inside `throwaway-prototypes/d-full-match/` plus
the research log under `docs/project/phases/render-rnd/`. The
Round-5/6/7 scaffold-verify regression locks (forbidden tokens, no-UAT
artefacts, pathing-token grep, contract-shape assertions) remain in
force; new Round-8 locks are documented in §6.

---

## 3. Architecture Design

### 3.1 Scale revert (WP-A)

**Quantitative target.** "Standard" character size for this cyberpunk-×-
Diablo prototype is **~1.6–1.8 world units tall** (humanoid character
spanning roughly the same height as 1 tile + a margin given the existing
tile grid). The engineer derives the exact target by:

1. Reading the native GLB AABB via the existing
   `audit-character-scales.gd` machinery (already measures
   `source_height` per persona; at the consolidated mesh2motion body
   this is a single number).
2. Comparing to the existing wall/cover/crate world-unit dimensions in
   `SceneBuilder.gd` (not touched this round) to pick a target band.
3. Updating `CHARACTER_MODEL_SCALE` and/or `manifest.body.modelScale
   Multiplier` so `post_scale_height` lands in the target band.
4. Reverting `CORPSE_MODEL_SCALE` and `AIRDROP_CRATE_MODEL_SCALE`
   alignment (both currently track `CHARACTER_MODEL_SCALE`) — corpse
   should stay coupled (same body); airdrop crate should decouple if
   the math says so (engineer judgement, document in research log).
5. **Decoupling regular crate Y-axis from `CHARACTER_MODEL_SCALE`** —
   `EntityRenderer.gd:319` currently sets the regular crate's Y scale
   to `CHARACTER_MODEL_SCALE`
   (`Vector3(CRATE_MODEL_SCALE, CHARACTER_MODEL_SCALE, CRATE_MODEL_SCALE)`).
   This is a pre-Round-8 coupling bug; reverting character scale will
   distort regular crates. Replace with `CRATE_MODEL_SCALE` for all
   three axes. Sweep `_spawn_crates`, `_spawn_airdrops`, evac, and
   SceneBuilder for any further character-scale couplings on non-
   character geometry and decouple — wall/cover/crate/evac final
   world-unit dims must not move.

**Existing audit extension — effective world height (non-negotiable).**
The current `audit-character-scales.gd:43` computes
`post_scale_height = source_height * modelScaleMultiplier` and OMITS
the runtime `CHARACTER_MODEL_SCALE` factor. At runtime,
`EquipmentMeshAttachment.instantiate_persona_character` line 76 sets
`visual.scale = Vector3.ONE * base_scale * multiplier` where
`base_scale == CHARACTER_MODEL_SCALE`. Effective on-screen world
height is therefore `source_height * CHARACTER_MODEL_SCALE *
modelScaleMultiplier`. **WP-A must fix the audit formula** so the
band-check operates on effective world height — otherwise the same
audit-passes-while-models-look-wrong failure mode that produced the
UAT complaint reproduces. The audit must parse `CHARACTER_MODEL_SCALE`
from `EntityRenderer.gd` (or accept it as a `--character-model-scale`
arg fed by the scaffold/test harness), and adds the new
`--target-world-height N.N` arg. Assertion: effective world height
(all three factors) lands in `[target × 0.85, target × 1.15]`. The
test step calls it with the chosen target and `--assert`.

**Camera framing.** Showroom camera in
`Showroom.gd:_configure_camera` (radius 10.0, anchor y=0.52) and
MatchPlayer camera in CameraRig may need re-tuning to keep the same
visual framing under the larger characters. Engineer judgement — if
characters fall out of frame at the new scale, retune. Document the
change in the research log under "camera re-tuning".

**Walls / cover / crate / evac stay unchanged.** Forbidden-token grep
in `verify-scaffold.mjs` is extended to assert `SceneBuilder.gd`
constants (wall heights, cover dims, evac dims) are unchanged from
Round-7. Round-8 is character-scale-only on the geometry axis.

### 3.2 Adherence-approach taxonomy (WP-C)

Mental-model §13 codifies three approach families. Round-8 adds a
fourth (the modular sub-mesh prototype) and labels all four explicitly
in code + manifest for audit.

| # | Adherence family | Existing implementation | Fits | Limitation |
|---|---|---|---|---|
| 1 | **Bone-attached** | `_apply_projected_mark` + `BoneAttachment3D` (Round 7.2) | Single-point items: weapons, scar decals, pinned wound marks | Flat plane pinned at one contact — doesn't wrap |
| 2 | **Mesh-baked** | Sprinter `dismemberment_baked` (bone-scale collapse) | Whole-body state: dismemberment, charred recolor, corpse pose | Requires per-variant authoring; doesn't compose |
| 3 | **UV-painted region shader** | Sprinter `multi_material_split` body-region mask shader (Round 7.2 extension) | Wrapping effects: armor-as-paint, gore-as-paint, region recolor | Requires good UVs + per-region masks |
| 4 | **Modular sub-mesh** (NEW) | — | Separately-rigged armor pieces (helmet / chest / gauntlet / leggings) sharing mesh2motion skeleton | Requires shared bone vocabulary; authoring discipline |

**Manifest schema bump (5 → 6).** Each `skin`, `corpse`, and the new
`armorOverlay` block gain an `adherenceApproach` field (string,
matching one of the four labels above). The field is **documentation +
audit** — the engine doesn't branch on it directly; the existing
`approach` field still drives dispatch. Schema bump is forward-only
(POC posture per §10).

**Modular sub-mesh armor — Godot 4 implementation pattern.** Per
research, the standard Godot 4 pattern for shared-skeleton armor is:

- **ONE authoritative Skeleton3D** (the character's body skeleton).
- Armor `MeshInstance3D` nodes are added as siblings to the body mesh
  *under the same Skeleton3D*, with their `skin` property pointing to a
  `Skin` resource that references the same bone indices/bind pose.
- The armor's source GLB (if rigged separately) must have *identical
  bone names and hierarchy* to mesh2motion's skeleton, OR be re-rigged
  via Mixamo / Blender retargeting to match before import.

**Implementation flow** in `EquipmentMeshAttachment`:

```gdscript
func _apply_modular_submesh_armor(character_id, armor_asset):
    var character = registered_characters[character_id]
    var skeleton: Skeleton3D = character.skeleton
    if skeleton == null:
        return  # no-op; armor falls back to material-swap
    var armor_scene: PackedScene = _scene_for_asset(armor_asset)
    if armor_scene == null:
        return
    var armor_instance = armor_scene.instantiate()
    # Walk armor_instance for its MeshInstance3D + Skin
    var armor_meshes = _mesh_descendants(armor_instance)
    for armor_mesh in armor_meshes:
        # Re-parent the mesh under the character's Skeleton3D
        var original_parent = armor_mesh.get_parent()
        original_parent.remove_child(armor_mesh)
        skeleton.add_child(armor_mesh)
        # Re-bind to the character's skeleton
        armor_mesh.skeleton = skeleton.get_path()
        # Keep the Skin resource as-is (matches bone vocabulary)
    armor_instance.queue_free()
    _track_armor_overlay(character_id, armor_meshes)
```

**Authoring requirement.** The armor GLB must share mesh2motion's bone
vocabulary (`spine_01`, `spine_02`, `spine_03`, `upperarm_l/r`,
`lowerarm_l/r`, `hand_l/r`, `thigh_l/r`, `shin_l/r`, `foot_l/r`, neck,
head, etc.). Two practical sources:

1. **CC0 armor packs rigged for Mixamo skeleton** (research target):
   if the source GLB is Mixamo-rigged, in Blender retarget to
   mesh2motion (the two are similar enough). Document the retarget
   step in the research log.
2. **Hand-rigged in Blender** against the mesh2motion bind pose: if
   research surfaces a CC0 *static* armor mesh without rigging, the
   engineer can rig it to the mesh2motion skeleton in Blender (skin
   weights from automatic envelope + manual fix; document the
   workflow). This is the fallback path.

If **neither** path produces evaluable assets within reasonable effort,
the engineer documents the blocker in the research log and falls back
to a **placeholder authored-in-Godot rigged armor** (e.g., a simple
chest-plate primitive skinned to spine_02/spine_03 in code) so the
prototype still demonstrates the modular sub-mesh path mechanically
even if not visually polished. This fallback is explicitly authorized
because the round's primary goal for armor is to **prove the path
works mechanically** under user evaluation.

### 3.3 Manifest schema (schemaVersion 6)

Minimal additions on top of Round-7's schema 5:

```jsonc
{
  "schemaVersion": 6,
  "kitName": "d-full-match-round-8-sourced-adherence-art-kit",
  "purpose": "Round-8 sourced CC0 assets + adherence-approach breadth across 8 personas.",

  "body": {
    // ... existing fields ...
    "modelScaleMultiplier": <new value per WP-A>,
    "targetWorldHeight": <number, the WP-A target>
    // NEW: targetWorldHeight is documentation for audit consumption
  },

  "corpseBody": { /* mirrors body changes */ },

  "assets": [
    {
      "id": "character.rat",
      "category": "character",
      "personaSlot": "rat",
      "skin": {
        "approach": "palette_flat",
        "adherenceApproach": "uv_painted",  // NEW: documents the family
        "rationale": "...",
        "sourcePack": "engineer-procedural-fallback",  // NEW: documents pack provenance
        "params": { ... }
      },
      "armorOverlay": null,  // NEW field; null = use Round-5 material-swap path
      // OR for personas with modular sub-mesh armor:
      "armorOverlay": {
        "approach": "modular_submesh_chest",
        "adherenceApproach": "modular_submesh",
        "file": "armour/cc0-chestplate-source.glb",
        "sourcePack": "<pack name from research log>",
        "skeletonBindNotes": "Retargeted to mesh2motion bones via Mixamo+Blender; mapping in research log."
      },
      "corpse": {
        "approach": "blood_saturation_overlay",
        "adherenceApproach": "uv_painted",  // NEW
        "rationale": "...",
        "sourcePack": "<pack name from research log>",  // NEW
        "params": { ... }
      },
      "notes": "..."
    }
    // ... 7 more personas, each with one combination across 5 axes
    // weapons + armours from Round-5 partially replaced by new CC0 pack
  ]
}
```

**Field semantics:**

- `adherenceApproach`: one of `bone_attached`, `mesh_baked`,
  `uv_painted`, `modular_submesh` — documentation for audit + future
  consolidation; not a dispatch branch. **Required on `skin`,
  `corpse`, and (when non-null) `armorOverlay` blocks.** Audits MUST
  compute the 4-family coverage union across all three slots — not
  from the dispatch `approach` field, which is technique-name, not
  family-name. The 4-family coverage assertion in §5.5 verifies this
  union.
- `sourcePack`: free-form string identifying the CC0 pack in the
  research log (or `engineer-procedural-fallback` if procedural is the
  documented fallback).
- `armorOverlay`: optional new top-level block per character;
  `null` → fall through to material-swap path (Round-5). Non-null →
  modular-sub-mesh-armor prototype loads `file` into the character's
  Skeleton3D at register time and updates with armour tier.
- `targetWorldHeight`: documentation field on `manifest.body` consumed
  by the audit; the audit asserts the actual measured
  `post_scale_height` lands in the target band.

### 3.4 8-persona × 5-axis breadth table (sketched)

The engineer finalizes assignments during implementation against the
research log's available packs. The shape below is **illustrative** —
it documents the breadth-coverage intent so each adherence family is
sampled and 3 personas wear modular sub-mesh armor.

| # | Persona | Skin source pack | Gore source pack | Adherence approach demonstrated (corpse) | Weapon (new CC0 pack) | Armor (Round-8 axis) |
|---|---|---|---|---|---|---|
| 1 | rat | engineer-procedural (control / fallback) | engineer-procedural (control) | uv_painted (palette flat) | dagger (new pack) | material-swap (Round-5 control) |
| 2 | duelist | sourced PBR pack (e.g., ambientCG humanoid set) | sourced wound atlas | bone_attached | sword (new pack) | **modular sub-mesh chest plate** |
| 3 | trader | sourced hand-painted texture | sourced blood-pool sprite | mesh_baked (floor pool projection) | axe (new pack) | material-swap |
| 4 | opportunist | sourced stylized character texture | sourced charred overlay | bone_attached (sticker decals) | warhammer (new pack) | material-swap |
| 5 | paranoid | sourced toon-shader-compatible texture | sourced bone-gash decals | bone_attached | dagger variant | **modular sub-mesh helmet** |
| 6 | camper | sourced emissive-trim mask | sourced viscera atlas | uv_painted (region mask) | greatsword (new pack) | material-swap |
| 7 | sprinter | sourced body-region mask | mesh-baked dismemberment (existing) | mesh_baked | rusty_blade variant | material-swap |
| 8 | vulture | sourced rim-light-compatible texture | sourced decay shader | uv_painted (full-body desaturation) | sword variant | **modular sub-mesh gauntlets** |

**Coverage check:**

- All 4 adherence families represented (bone_attached × 3, mesh_baked
  × 2, uv_painted × 3, modular_submesh × 3 on the armor axis).
- 3 personas wear modular sub-mesh armor (per north-star
  requirement) — duelist (chest), paranoid (helmet), vulture
  (gauntlets).
- Rat stays the **control sample** (engineer-procedural) so the user
  has a no-source-pack anchor.
- Each skin slot has a different sourced approach where CC0 packs
  exist; engineer-procedural is the documented fallback only for rat.
- Each weapon comes from the same new CC0 weapon pack for coherence
  (engineer picks one pack with sword/axe/dagger/warhammer/greatsword
  coverage).

### 3.5 22 Round-7.1 PIL textures — replacement plan

Round-7 generated 22 PIL PNGs across two directories:

```
shared-harness/art-kit/textures/skin/ — 10 PNGs
shared-harness/art-kit/textures/gore/ — 12 PNGs
```

The Round-7.1 ambientCG MetalPlates017A duelist set is **kept** (5
PBR maps are real authored CC0). The other 17 PIL PNGs are replacement
targets. Mapping (the engineer fills the right column from the
research log during WP-B):

| Round-7 PIL PNG | Persona | Replacement source pack |
|---|---|---|
| `skin/trader-hex-pattern.png` | trader | TBD — hand-painted hex/circuit CC0 |
| `skin/opportunist-decal-{logo,scar,dirt}.png` | opportunist | TBD — sticker/grunge CC0 |
| `skin/camper-trim-mask.png` | camper | TBD — emissive trim mask CC0 |
| `skin/sprinter-body-regions.png` | sprinter | Engineer-authored mask against mesh2motion UVs (CC0-by-author) |
| `gore/wound-slash-{a,b}.png`, `gore/wound-puncture.png` | duelist | TBD — wound atlas (ambientCG smudge/leak or textures.com CC0 blood) |
| `gore/blood-pool-large.png` | trader | TBD — blood-pool sprite (textures.com / ambientCG splatter) |
| `gore/charred-albedo.png`, `gore/charred-emission.png` | opportunist | TBD — charred surface (ambientCG burn/leak) |
| `gore/bone-gash-{a,b,c}.png` | paranoid | TBD — wound/bone overlay (ambientCG smudge) |
| `gore/viscera-{chest,abdomen}.png` | camper | TBD — viscera atlas (OGA CC0 search) |
| `gore/stump-gore.png` | sprinter | TBD — wound overlay (ambientCG smudge) |

**Procedural-fallback discipline.** Where the research log finds no
sourced CC0 option for a category (e.g., truly stylized character-
wrapped wound atlases under strict CC0 may not exist per research), the
engineer documents the gap in the research log with a one-line
justification (*"No CC0 wound-atlas exists; falling back to engineer-
procedural for paranoid gore"*) and the manifest's `sourcePack` field
reads `engineer-procedural-fallback`. The procedural PNG stays, but the
provenance is visible to the user.

### 3.6 Weapon pack swap

Round 4/5 shipped 6 weapons: 5 engineer-procedural primitives + 1 real
sourced (sword from Robin Lamb / OpenGameArt CC0). Round 8 swaps the
5 primitives to a single coherent stylized CC0 pack (OpenGameArt CC0-
filtered weapons, ambientCG metal materials for retexturing, or
Sketchfab CC0 individuals per the research findings). The Robin Lamb
sword stays as a known-good comparison.

**Weapon-pack research outcome posture.** If research finds no
single-author coherent pack at CC0, the engineer either:

1. Curates 5 individual CC0 weapons from OpenGameArt / Sketchfab and
   retextures them with a shared ambientCG metal material (visual
   coherence via shared material, not shared author), OR
2. Flags Quaternius/KayKit/Kenney as **CC-BY-attribution** options in
   the research log and surfaces the licence decision to the user
   before downloading.

Decision is the user's; the spec mandates the engineer **surface the
choice** with named candidates rather than silently choose.

### 3.7 Armor pack research — CC0 modular rigged

Per the research, **strict CC0 modular rigged armor is essentially
nonexistent**. Realistic paths:

1. **Mixamo-rigged CC0 character packs** that include armor variants
   — strip the body, keep armor pieces, retarget skeleton to
   mesh2motion in Blender. The engineer surveys OpenGameArt CC0
   character packs for armor variants.
2. **CC0 base mesh + engineer-authored modular armor in Blender** —
   model simple chest/helmet/gauntlet shells against the mesh2motion
   bind pose, skin to the matching bones, export as GLB. Time-bounded
   to ~2 hours per piece in implementation.
3. **CC-BY-attribution path surfaced to user** — Quaternius low-poly
   character + armor pieces, KayKit Adventurers, etc. The engineer
   flags these as non-CC0 in the research log and the user decides
   whether to accept attribution overhead.

**Manifest support for ALL three paths.** `armorOverlay.sourcePack`
documents the provenance regardless of which path was taken.

### 3.8 Compatibility renderer constraint (carry-over from Round 7.2)

Godot 4's spatial `Decal` node is **not supported in the Compatibility
renderer** (web export). The Round-7.2 `_apply_projected_mark`'s
QuadMesh+BoneAttachment3D fallback remains the active web-export path.
Round 8 does **not** revisit this; the `Decal.new(` branch stays as
the Forward+ path for native editor preview and may benefit future
rounds when Forward+ web export becomes viable.

If the research surfaces a community Godot plugin that provides
Compatibility-renderer-compatible Decal-style projection (research
mentioned "Compatibility Decal Node" plugins), the engineer notes it
in the research log as a **future option** but does NOT integrate it
this round — that's a substrate change at the renderer level and out
of round scope.

---

## 4. Dependency Map (parallelization)

| WP | Depends on | Can parallelize with |
|---|---|---|
| WP-A scale revert | Nothing (independent) | WP-B research |
| WP-B research log + downloads | Nothing (independent) | WP-A scale |
| WP-C adherence approaches (codified labels + modular sub-mesh) | Round-7.2 landed (BoneAttachment3D path); WP-B downloads for the armor GLB | WP-A scale, WP-B continues |
| WP-D apply variety to 8 personas | WP-B + WP-C (needs assets + approaches in place) | — |
| WP-E verification kit | WP-A + WP-C + WP-D (assertions reference all three) | — |

**Recommended sequencing:** WP-A and WP-B run in parallel (both
independent and small/medium). WP-C waits on WP-B's armor assets but
the code-side modular-sub-mesh implementation can land first against a
placeholder GLB. WP-D and WP-E both consume A+B+C and land last.

---

## 5. Work Package Breakdown (UAT vertical-slice focus)

Each WP must deliver a vertical slice the user can evaluate
independently in the Showroom. Reviewers operate on scaffold-verify +
Godot headless audits + closing readout — no implementer UAT.

### 5.1 WP-A — Character scale revert

**Goal.** Characters render at "standard" size (`~1.6–1.8` world
units tall). Walls/cover/crate/evac unchanged.

**Touch points:**
- `src/EntityRenderer.gd` — `CHARACTER_MODEL_SCALE` constant (currently
  `0.21`). Engineer determines new value.
- `src/EntityRenderer.gd:319` — `_spawn_crates` Vector3 scale: replace
  `Vector3(CRATE_MODEL_SCALE, CHARACTER_MODEL_SCALE, CRATE_MODEL_SCALE)`
  with `Vector3.ONE * CRATE_MODEL_SCALE`. Pre-Round-8 coupling bug;
  unblocks the scale revert without distorting regular crates. Sweep
  `_spawn_airdrops` + evac construction for any further character-
  scale couplings on non-character geometry.
- `shared-harness/art-kit/manifest.json` — `body.modelScaleMultiplier`
  (currently `2.1725`). Engineer adjusts so post-scale height hits
  target band. Also adds new `targetWorldHeight` field on `body` and
  `corpseBody`.
- `scripts/audit-character-scales.gd` — fix the effective-world-height
  formula (must include `CHARACTER_MODEL_SCALE` factor, not just
  `modelScaleMultiplier`); add `--target-world-height` arg; asserts
  measured effective world height lands in `target ± 15%`.
- `scripts/verify-scaffold.mjs` — token assertion updated for the new
  `CHARACTER_MODEL_SCALE` literal; assertion that `manifest.body.
  targetWorldHeight` is present and numeric; assertion that
  `_spawn_crates` no longer references `CHARACTER_MODEL_SCALE` in its
  scale Vector3.
- `src/Showroom.gd` and `src/CameraRig.gd` — re-tune camera radius /
  anchor y *only if* characters fall out of frame at new scale
  (engineer judgement, documented in research log). Verification is
  structural (load + AABB-fit math), NOT visual — no screenshots, no
  headless visual checks, no browsertools.

**Forbidden:** any change to `SceneBuilder.gd` wall heights, cover
dims, crate or evac geometry. The scaffold-verify check is extended to
assert these constants did not change.

**Success criteria:**
- `audit-character-scales.gd --assert --target-world-height N.N` PASS.
- `verify-scaffold.mjs` includes new scale literal + manifest
  `targetWorldHeight` assertion.
- Replay + Showroom load without runtime errors at the new scale
  (verified via existing `audit-replay-load.gd` and
  `verify-character-rigs.gd`).
- Research log documents target value + camera re-tuning (if any)
  with one-line rationale.

### 5.2 WP-B — Sourced CC0 research log + asset downloads

**Goal.** A research log at `docs/project/phases/render-rnd/round-8-
research-log.md` listing every candidate pack across 4 categories
(skin / gore / weapon / armor) with license disposition and download
sha256s.

**Research log structure** (engineer fills in):

```markdown
# Round 8 — Sourced CC0 Asset Research Log

## Category 1 — Skin / character textures
- Pack: <name>
  Source URL: <url>
  License: CC0 / CC-BY-flagged-for-user-decision / fallback-procedural
  Fit rationale: <one line — cyberpunk × Diablo angle>
  Downloaded archive: <local path>
  Archive sha256: <hash>
  Applied to persona: <persona slot, or "not selected — reason ...">
  Notes: <retargeting workflow, retexturing notes, etc.>

## Category 2 — Gore / blood / wound decals
- ...

## Category 3 — Weapons
- ...

## Category 4 — Armor (modular rigged for humanoid skeleton)
- ...

## Camera + scale re-tune notes (cross-WP)
- ...

## Compatibility-renderer Decal plugin survey (research-note only)
- Pack/plugin: <name> — Source URL: <url> — License: <tier> —
  Notes: <one line on whether it could replace QuadMesh+BoneAttachment3D
  in the web-export path in a future round>. Not integrated this
  round; per §10 banked for future substrate decision.

## Procedural-fallback justifications
- <persona × slot> — no CC0 alternative found for <category>; using
  engineer-procedural with note "<one line>".
```

**Research candidates the engineer must investigate** (from research):

- **ambientCG** (CC0 confirmed) — all texture categories. Especially:
  Fabric*, Leather*, FabricPattern*, Concrete*, PlasticSoft* (skin
  bases); Dirt*, Leak*, Smudge*, Imperfection* (gore-as-decal
  candidates); Metal*, Painted*, Scratched* (weapon retextures).
- **OpenGameArt CC0-filtered** — humanoid base meshes, low-poly weapon
  packs, CC0 character packs (search "low poly", "stylized", filter
  License = CC0). The "Art for a Diablo-like RPG" collection (mixed
  CC0/CC-BY per asset).
- **textures.com CC0-tagged decals** — blood splatter, grunge,
  imperfections.
- **Sketchfab CC0-filtered** — individual stylized weapons / character
  pieces. Single-author coherent packs are rare; engineer curates.
- **Quaternius / KayKit / Kenney / Synty Free** — **NOT CC0**.
  Quaternius is typically CC-BY or custom permissive; Kenney is
  "Kenney License" (CC0-equivalent for most assets but verify per
  pack); KayKit and Synty are commercial/CC-BY. The engineer surfaces
  these as **flagged options** with attribution overhead for the user
  to decide.

**Per-pack acceptance bar.**

- License tier explicitly classified: `cc0_ratified` /
  `cc_by_flagged_for_user` / `procedural_fallback`.
- Source URL resolves; archive downloaded to `/tmp/round-8-assets/`
  with sha256 recorded.
- Fit-rationale answers "why does this fit cyberpunk × Diablo?" in one
  line.

**Success criteria:**
- Research log committed and reviewed.
- At least 1 CC0 source pack per category (skin, gore, weapon, armor)
  or a documented "no CC0 found — fallback chosen because X" note.
- Downloaded archives present in working tree where applied; sha256
  matches.
- Manifest `sourcePack` field references the research log entry by
  pack name (1:1 with research log).

### 5.3 WP-C — Adherence-approach implementations

**Goal.** Four named adherence families exercised in code, with the
new **modular sub-mesh armor** path as the headline addition.

**Touch points:**

- `src/EquipmentMeshAttachment.gd`:
  - Existing bone-attached path (`_apply_projected_mark` +
    `BoneAttachment3D`) labeled `adherence_bone_attached` via comment
    + audit-token.
  - Existing mesh-baked path (`_apply_corpse_dismemberment` +
    bone-scale collapse) labeled `adherence_mesh_baked`.
  - Existing UV-painted region shader (`_apply_skin_multi_material`
    sprinter body-region) labeled `adherence_uv_painted`.
  - NEW `_apply_modular_submesh_armor(character_id, armor_overlay
    _block)` per §3.2 pseudocode. Called from `_swap_armour` when
    `armor_overlay` is non-null for that persona; falls through to
    existing material-swap when null.
  - NEW `_clear_modular_submesh_armor(character_id)` to remove armor
    meshes when unequipped.
  - Registry extension: `armor_overlay_nodes_by_character` dict
    tracking attached mesh nodes per character_id.
- `shared-harness/art-kit/manifest.json`:
  - Schema 5 → 6.
  - Per-character entry gets `armorOverlay` field (nullable).
  - Per `skin`/`corpse`/`armorOverlay` block gets `adherenceApproach`
    documentation field.

**Armor GLB path requirements** (validated by audit):

- File must exist under `shared-harness/art-kit/armour/` with .import
  sidecar.
- Must instantiate as Node3D with at least one MeshInstance3D
  descendant carrying a Skin resource.
- Bone names in Skin must match mesh2motion's skeleton (verified by
  `audit-modular-submesh-armor.gd`).

**Success criteria:**
- `audit-modular-submesh-armor.gd` PASS for the 3 personas wearing
  modular sub-mesh armor.
- Scaffold-verify token assertions: `_apply_modular_submesh_armor`,
  `armor_overlay_nodes_by_character`, `adherenceApproach`,
  `armorOverlay`.
- Manifest schema 6 + new fields validated by scaffold-verify.

### 5.4 WP-D — Apply variety to 8 personas

**Goal.** Each persona is one breadth-test cell. Manifest documents
the assignment; Showroom renders each combination side-by-side.

**Touch points:**

- `shared-harness/art-kit/manifest.json` — each persona block updated
  with sourcePack references and (for 3 personas) `armorOverlay`
  blocks pointing to the modular sub-mesh armor GLBs.
- `shared-harness/art-kit/textures/skin/`, `textures/gore/` — Round-7
  PIL PNGs replaced with sourced packs per the WP-B mapping. The
  Round-7.1 ambientCG MetalPlates set retained for duelist.
- `shared-harness/art-kit/armour/` — new armor GLBs added for the 3
  modular sub-mesh personas.
- `shared-harness/art-kit/weapons/` — 5 of 6 weapons replaced by new
  CC0 pack variants. Robin Lamb sword retained as known-good.
- `src/Showroom.gd` — likely **no changes needed**; the existing
  manifest-driven flow handles new per-persona combinations. If the
  Showroom needs a label-line addition to surface `adherenceApproach`
  per persona for evaluation, add a third Label3D under each station
  (engineer judgement).

**Success criteria:**
- All 8 personas display in Showroom under the new manifest.
- The 4-family `adherenceApproach` coverage union (across each
  persona's `skin.adherenceApproach`, `corpse.adherenceApproach`,
  and (when non-null) `armorOverlay.adherenceApproach`) hits all four
  values: `bone_attached`, `mesh_baked`, `uv_painted`,
  `modular_submesh`. The check is on the documentation field, not on
  the dispatch `approach` (which encodes the technique name, not the
  family label).
- At least 3 personas have non-null `armorOverlay` pointing to a
  modular sub-mesh armor GLB.
- Each persona's manifest entry documents `sourcePack` for each axis.
- `verify-scaffold.mjs` updated assertions PASS.

### 5.5 WP-E — Verification kit extensions

**Goal.** Headless Godot audits + scaffold-verify catch Round-8
regressions before the user opens the Showroom.

**New / extended audits:**

- `scripts/audit-modular-submesh-armor.gd` (NEW) — for each persona
  with non-null `armorOverlay`:
  - Instantiate persona character through `EquipmentMeshAttachment`.
  - Assert at least one `MeshInstance3D` child of the character's
    `Skeleton3D` exists after armor application.
  - Assert the armor mesh's `skin` resource references valid bone
    indices in the character skeleton.
  - PASS/FAIL per persona.
- `scripts/audit-character-scales.gd` (extend) — accept
  `--target-world-height N.N` arg; assert measured `post_scale_height`
  in `[target × 0.85, target × 1.15]`.
- `scripts/audit-skin-bone-attachments.gd` (extend) — assert per-
  persona `adherenceApproach` field on `skin`, `corpse`, AND (when
  non-null) `armorOverlay` blocks is one of the 4 documented values;
  computes the **coverage union across all three slots** and asserts
  all 4 families are represented at least once across the 8 personas;
  cross-checks the actual rendered attachment pattern against the
  documented family (where feasible).
- `scripts/verify-scaffold.mjs` (extend):
  - Schema 5 → 6 assertion.
  - `adherenceApproach` field required on each skin, corpse, AND
    (when non-null) `armorOverlay` block.
  - 4-family coverage check: union of `adherenceApproach` values
    across `skin` + `corpse` + `armorOverlay` (where non-null) across
    all 8 personas covers `bone_attached`, `mesh_baked`, `uv_painted`,
    `modular_submesh`.
  - `sourcePack` field required on each skin, corpse, and (if present)
    armorOverlay block.
  - `armorOverlay` field declared on each character (nullable;
    structure validated when non-null).
  - At least 3 personas have non-null `armorOverlay`.
  - `EquipmentMeshAttachment.gd` includes new tokens
    (`_apply_modular_submesh_armor`, `armor_overlay_nodes_by_character`,
    `adherence_bone_attached`, `adherence_mesh_baked`,
    `adherence_uv_painted`, `adherence_modular_submesh`).
  - `EntityRenderer.gd` new `CHARACTER_MODEL_SCALE` literal (single
    occurrence, matching the WP-A value).
  - `manifest.body.targetWorldHeight` present and numeric.
  - SceneBuilder constants for wall/cover/crate/evac unchanged from
    Round 7 (forbidden-token list extended with hard-coded literals).
  - Regular-crate Y dimension does NOT track `CHARACTER_MODEL_SCALE`:
    assert `EntityRenderer.gd:_spawn_crates` constructs the crate's
    Vector3 scale without `CHARACTER_MODEL_SCALE` in any axis.
  - Forbidden-token grep unchanged (no browsertools, chromium,
    screenshot, visual UAT artefacts; no pathing tokens in renderer
    code).

**`package.json` test script** chains the new audits under the
existing `GODOT_BIN` gate pattern.

**Success criteria:**
- All scaffold-verify checks PASS.
- All Godot headless audits PASS under GODOT_BIN.
- `nohup npm --prefix throwaway-prototypes/d-full-match test` clean.
- `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match run
  build` clean web export.

---

## 6. Assignment-Level Success Criteria

Reviewers consume code + scaffold-verify + Godot headless audits +
closing readout. **No implementer UAT.** User runs Showroom UAT
themselves after the assignment closes.

1. Character scale reverts to a "standard" size; `audit-character-
   scales.gd --assert --target-world-height N.N` PASS with N.N
   matching the WP-A chosen value, **computed on effective world
   height** (`source_height * CHARACTER_MODEL_SCALE *
   modelScaleMultiplier`).
2. `manifest.body.targetWorldHeight` field present and audit-asserted.
3. Walls / cover / crate / evac world-unit dimensions unchanged
   (scaffold-verify locks); regular crate Y-axis decoupled from
   `CHARACTER_MODEL_SCALE` (pre-Round-8 coupling bug fixed at
   `_spawn_crates`).
4. Research log at `docs/project/phases/render-rnd/round-8-research-
   log.md` committed with: per-pack name + source URL + license
   classification + fit-rationale + downloaded archive + sha256.
5. At least 1 sourced CC0 pack per category (skin, gore, weapon,
   armor) OR a documented "no CC0 found — fallback chosen because X"
   note in the research log.
6. Manifest schema bumped 5 → 6 (POC posture forward-only).
7. `EquipmentMeshAttachment._apply_modular_submesh_armor` implemented;
   `armorOverlay` field on per-character entries supported.
8. At least 3 personas wear a modular sub-mesh armor piece (helmet /
   chest / gauntlets) via `armorOverlay` non-null.
9. Each `skin`, `corpse`, and (when non-null) `armorOverlay` block
   carries `adherenceApproach` field labeled as one of `bone_attached`
   / `mesh_baked` / `uv_painted` / `modular_submesh`. The 4-family
   coverage union across all three slots × 8 personas hits all four
   values.
10. Each `skin`, `corpse`, and `armorOverlay` block carries
    `sourcePack` documenting provenance (CC0 pack name or
    `engineer-procedural-fallback`).
11. All 4 adherence families demonstrated across the 8 personas (at
    least once each).
12. 5 of 6 weapon prototypes replaced by new sourced CC0 pack
    (or documented fallback).
13. Round-7.1 ambientCG MetalPlates duelist set retained (control).
14. New `audit-modular-submesh-armor.gd` PASS.
15. Extended `audit-character-scales.gd` PASS with target band check.
16. Extended `audit-skin-bone-attachments.gd` PASS with
    `adherenceApproach` coverage check.
17. `verify-scaffold.mjs` PASS with all Round-8 token + manifest
    assertions.
18. `npm run lint` / `typecheck` / `build` / `test` (root) clean.
19. `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match run
    build` clean web export.
20. Forbidden-token grep clean (no browsertools, chromium, screenshot,
    visual UAT artefacts; no pathing tokens in renderer code).
21. NO Convex / production code changes; NO body model change; NO
    Showroom architectural rewrite; NO triplanar→cover work; NO full-
    pipeline armor system.

---

## 7. Ambiguities + Decisions Needed (call-out)

These are open at plan time and require PM (or user) resolution
during plan-review or early implementation:

**Q1 — "Standard" character scale target — exact world-unit value.**
The spec says ~1.6–1.8 world units; the engineer derives the exact
target from native AABB + tile-grid context during WP-A. *PM/user
decision needed only if the engineer's chosen target produces a
character that's *still* too small or now too large at first audit;
the audit's ±15% band gives the engineer guidance.*

**Q2 — Non-CC0 license acceptance for armor / weapons.** Research
confirms that strict CC0 modular rigged armor and coherent stylized
weapon packs are essentially nonexistent. If the engineer's WP-B pass
finds only CC-BY (Quaternius / KayKit / Kenney) candidates that fit
the brief, **does the user accept CC-BY-attribution overhead for this
prototype?** Default plan posture (PM-amended after Round-8 plan
review): engineer surfaces named CC-BY candidates in the research log
with one-line rationale + license link + attribution requirements;
PM/user resolves during plan-review or early implementation; **no
CC-BY archive is downloaded into the working tree or applied to a
persona without that explicit surface step**. While no decision is
reached, the engineer proceeds with CC0 alternatives, hand-rigged
authoring, or the documented procedural fallback. CC-BY is not
silently acceptable — the North Star is CC0-only with surface-first
discipline (D4).

**Q3 — Mixamo retargeting workflow.** Modular sub-mesh armor likely
requires retargeting from a source skeleton (often Mixamo) to
mesh2motion's skeleton. **Is the engineer authorized to invest 1–3
hours of Blender retargeting work per armor piece?** Default plan
posture: yes, with the explicit fallback that hand-authored
placeholder armor primitives in Godot are acceptable if retargeting
proves prohibitively time-consuming, so long as the prototype
demonstrates the modular sub-mesh path mechanically.

**Q4 — Showroom label addition for `adherenceApproach`.** Should the
Showroom display each persona's `adherenceApproach` as a third Label3D
under the station, so the user evaluates each approach by name? Plan
default: yes (low-risk, evaluates more legibly), but engineer may skip
if the existing 2-label layout is already crowded.

**Q5 — Procedural-fallback policy for skin.** If WP-B research turns
up few/no CC0 skin packs (research suggests ambientCG fabric/leather
is the strongest CC0 path, with hand-painted character-skin sets near-
absent), is the engineer authorized to **retain Round-7's procedural
PNGs** for some personas with `sourcePack: engineer-procedural-fallback`
provenance? Plan default (PM-amended): procedural fallback is
**per-category / per-persona only**, each instance accompanied by an
explicit "no CC0 alternative found for this category — fallback
because <reason>" line in the research log. Not a blanket fallback
policy. The engineer should exhaust the ambientCG fabric/leather path
and CC0-tagged OGA/Sketchfab options before defaulting to procedural
for any given persona; the goal is sourced-where-possible, procedural-
where-justified, not a 50/50 split.

**Q6 — Weapon-pack source curation.** If no single coherent CC0
weapon pack exists, the engineer either (a) curates individuals from
OpenGameArt CC0-filtered + Sketchfab CC0-filtered + ambientCG metal
retextures for coherence, or (b) surfaces CC-BY packs to user
(Q2-coupled). Plan default: (a) first; (b) only if (a) fails.

---

## 8. Recommended Job Sequence

1. **PLAN review** (this doc) — PM normal-flow review; assignment is
   NOT blocked. Address any ambiguities Q1–Q6 from §7.
2. **IMPLEMENT** as a sequence with parallelization:
   - First batch (parallel): WP-A scale revert + WP-B research log
     (downloads).
   - Second batch (sequential): WP-C adherence approaches once WP-B
     surfaces the armor GLB candidate (or placeholder approved).
   - Third batch (sequential): WP-D apply variety + WP-E verification
     kit. WP-D and WP-E can interleave during the same job.
3. **REVIEW** after implement lands.
4. **DOCUMENT** to produce closing readout
   (`round-8-closing-readout.md`).
5. **NO UAT job.** User runs Showroom UAT themselves after the
   closing-readout job. The user's curation picks across the 5 axes
   drive Round-9's consolidation lane choice.

PM should issue jobs in this exact order. Plan-review first because
the ambiguities in §7 (notably Q2 license tier acceptance) are likely
to surface engineer questions that PM-or-user can resolve cheaply now
versus mid-implement.

---

## 9. Mental-Model Cross-Link

Round 8 is the **third** iteration of §10's recursive breadth /
consolidate pattern:

> *"Each loop is: sample breadth on the current finest open axis →
> evaluate side-by-side in the showroom → consolidate → reveal the
> next finer axis."*

- Round-5 sampled body axis; Round-7 consolidated body to mesh2motion.
- Round-7 sampled skin technique + corpse-gore technique; Round-8
  introduces **the §13 adherence-approach axis** as a load-bearing
  new dimension, samples it alongside re-sampled (sourced) skin +
  gore, and adds **armor** as a previously-deferred axis.
- The 5-axis simultaneous breadth (skin / gore / weapon / armor /
  adherence approach) is justified because the §13 mental-model
  refresh established adherence as load-bearing — postponing it would
  block future consolidation rounds from being legible.

§13 cross-links applied:
- *"Adherence is the load-bearing problem for skinned characters"* →
  the 4-family taxonomy in §3.2 is the working code surface.
- *"Research sourced inventory before engineer-procedural authoring"*
  → WP-B research log is the operational form.
- *"Idea bank — techniques whose flaws are someone else's features"*
  → wrapping-decals-as-armor enters investigation as modular sub-
  mesh; triplanar-as-cover stays explicitly banked (not in scope).

§10 "diagnostics target building agents first" → all WP-E audits are
machine-introspection surfaces for the engineer building agent; the
user is the curation-evaluation agent operating in the Showroom UI.

§7 filter: every WP makes prompt-authored behaviour more *legible*
(scale) or the §13 cyberpunk-×-Diablo spectacle more *shareable*
(sourced packs, adherence wrapping, modular armor) — not tactical
realism.

---

## 10. Out of Scope (explicit)

- Generalizing triplanar UV mapping to cover materials (banked for
  future cover-material round).
- Full render-pipeline armor system (just prototype the modular sub-
  mesh path on 3 personas).
- Body model change (mesh2motion stays).
- Procedural engineer-authored PNG textures as primary input (sourced
  CC0 only, with documented fallback justification only).
- Showroom architectural rewrite (manifest-shape additions for armor
  visualization are OK; the trigger UI stays).
- Convex / production code changes.
- Contract / schema changes outside the throwaway prototype manifest.
- Pathing logic in renderer (Round-5 forbidden-token grep stays
  clean).
- UAT / browsertools / chromium / screenshots / headless visual
  checks. User UATs in the Showroom themselves.
- Adopting community Compatibility-renderer Decal plugins (banked for
  a future round; this round stays on the Round-7.2 QuadMesh+
  BoneAttachment3D web-export path).

---

## 11. References

- `docs/project/spec/mental-model.md` §10 (recursive breadth /
  consolidate; sourced-before-procedural).
- `docs/project/spec/mental-model.md` §13 (adherence families;
  cyberpunk × Diablo positioning; idea bank).
- `docs/project/phases/render-rnd/round-7-skin-rnd-spec.md` (Round-7
  spec — schema 5, skin/gore breadth).
- `docs/project/phases/render-rnd/round-7-closing-readout.md` (Round-7
  delivery state).
- Round-7.2 in-flight (single-pass implement; BoneAttachment3D path
  added to `_apply_projected_mark`; sprinter body-region-mask shader;
  triplanar pattern mapping). **Build on top of whatever lands.**
- `throwaway-prototypes/d-full-match/src/EquipmentMeshAttachment.gd` —
  skin/corpse/equipment dispatch (read first).
- `throwaway-prototypes/d-full-match/src/EntityRenderer.gd` —
  `CHARACTER_MODEL_SCALE := 0.21` (revert target).
- `throwaway-prototypes/d-full-match/src/Showroom.gd` — evaluation
  surface.
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.
  json` — character + body + equipment manifest (read for current
  shape).
- `throwaway-prototypes/d-full-match/scripts/audit-character-scales.
  gd` — scale audit (extend).
- `throwaway-prototypes/d-full-match/scripts/audit-skin-bone-
  attachments.gd` — adherence audit (extend).
- `throwaway-prototypes/d-full-match/scripts/verify-scaffold.mjs` —
  scaffold + manifest assertions (extend).
