# Round-7 Spec — Mesh2Motion Consolidation + Skin-Technique Breadth Sample

> **Status: PLAN (drafted 2026-05-28)**
> Follow-up to Round 6
> ([`round-6-showroom-spec.md`](./round-6-showroom-spec.md),
> [`round-6-closing-readout.md`](./round-6-closing-readout.md)).
> Pre-§10-gate R&D probe. Default posture: **all changes confined to
> `throwaway-prototypes/d-full-match/`**. No Convex contract change.
> No snapshot schema bump. Manifest is throwaway-local and bumps within
> the prototype (schemaVersion 4 → 5; POC posture, forward-only).

⭐ **North Star** ⭐ — **Consolidate** all 8 personas onto the
mesh2motion human-base body (winner of Round-6 showroom evaluation),
then **R&D 8 distinct skin/texture/decal techniques** across the 8
personas as a new breadth-axis sample. Also consolidate the corpse onto
the mesh2motion death-pose body with 8 distinct **extreme gore /
gruesome corpse-skin variations** (one per persona). Cleanup: delete
unused character GLBs from prior rounds. Weapons/armor stay in place
(deferred to next round).

This is the §10 *consolidate-then-rebreadth* iteration pattern in
action: body model consolidated (mesh2motion winner) → finer axis
(skin technique) opens for breadth sampling → next round will
consolidate the winning skin technique → reveal next finer axis.

🚫 **BLIND ASSIGNMENT** — No browsertools, no chromium, no
screenshots, no visual UAT, no `uat` job, no headless visual checks.
Round 4/5/6 D4 discipline is a hard constraint. Reviewers operate on
code + scaffold-verify + closing readout. The user performs visual
UAT themselves in the Showroom after assignment closure.

---

## 1. Purpose

Mental-model §10 just landed a refinement codifying the
breadth/consolidate principle as **recursive on finer axes**. Round 7
*is* that principle in motion:

- Round-5 sampled breadth across **character-pack sources** (8 distinct
  packs, 1 per persona).
- Round-6 added a curator-diagnostic Showroom so the user could
  evaluate the 8-pack sample under controlled conditions and
  calibrated scale.
- User picked **camper's mesh2motion** as the winning pack. Decision
  verbatim: *"Lock in camper's mesh2motion as the pack of choice."*
- Round 7 **consolidates** the body axis onto mesh2motion (one shared
  GLB) and **opens the next finer axis** — *skin technique* — for
  breadth sampling. 8 distinct skin/texture/decal techniques, one per
  persona.
- A second decoupled breadth axis lands in the same round: **corpse
  gore variations** — 8 distinct extreme/gruesome gore approaches on
  the shared mesh2motion death-pose body. Same breadth-first shape,
  same evaluation surface (Showroom Death trigger).

Three outcomes, each independently testable:

1. **Body-model consolidation (§13 "fix the substrate" / §10
   consolidation).** All 8 personas reference one shared GLB; per-asset
   scale/bone/clip distinctions collapse to body-shared defaults. The
   asymmetry of 8 different rigs with 8 different bone-name maps and
   8 different clip vocabularies (Round-5 substrate smell) is resolved
   at the substrate, not papered over.
2. **Skin-technique breadth sample (§10 recursive breadth, §13 "slick
   is pipeline").** 8 distinct skin techniques implemented as
   instance-time material/shader/decal applications. The user picks a
   winning skin technique from side-by-side Showroom evaluation; the
   *next* round consolidates skin technique and opens the *next* finer
   axis (probable: weapons/armor R&D, or accessory style, or shader
   detail tier).
3. **Corpse-skin gore breadth sample (§13 "gore intensity is loud by
   design").** 8 distinct gore approaches on the shared mesh2motion
   death-pose body. Extreme/gruesome per user direction — wounds,
   exposed bone/viscera, gore decals, blood saturation, dismemberment
   baked at mesh level (within Godot Compatibility/WebGL2 budget per
   Round-4 ceiling).

Decision filter (§7): does this make prompt-authored behaviour more
*legible* or more *shareable*?

- **Skin breadth** is curation infrastructure — the user (the building
  agent) needs the breadth sample to pick a direction for the
  consumer-render era. Legibility downstream is what it improves.
- **Gore breadth** seeds the §13 "shareable beat" surface area: the
  cyberpunk × Diablo half. Extreme corpse spectacle is product-DNA per
  §13, and the user explicitly directed "extreme / gruesome." Picking
  a winning gore technique now de-risks the corpse VFX vocabulary
  before the consumer-render era opens.

Mental-model side-effects this round resolves as **substrate
consolidation**, not as explicit fixes:

- Round-5 trader "bunny-hop attack" (uses `jump` as attack) — gone:
  mesh2motion ships `Sword_Attack` + `Punch_Jab`, uniform across all 8.
- Round-5 sprinter "crouch generic" (uses `CrouchDefault` as generic
  fallback) — gone: mesh2motion ships full clip set, no generic
  fallback chain triggered.
- Round-5 paranoid CC-BY-4.0 attribution (Mannequiny) — gone: every
  persona is now CC0 (mesh2motion's LICENSE-CC0.MD).
- Round-5 opportunist "no hand bone" weapon-attachment misalignment —
  gone: mesh2motion ships a `hand_r` skeleton bone uniformly.
- Round-5 vulture "idle fallback for take_hit/death" — gone:
  mesh2motion ships dedicated `Hit_Chest` + `Death01`.

These are the §13 *honest substrate* wins of consolidation. The spec
acknowledges them but does NOT claim them as explicit deliverables;
they fall out automatically.

---

## 2. Overview

| WP | Scope | Throwaway? |
|---|---|---|
| **WP-A — Consolidation** | Collapse 8 char manifest entries onto shared mesh2motion body GLB; hoist body-shared defaults to manifest-level `body` block; restructure per-asset to `{personaSlot, sourceKey, skin, accessories?, corpse, notes}`; bump schemaVersion 4→5; delete obsoleted character GLBs (surgical); delete obsoleted Round-4 `prone-humanoid-prototype.glb`; verify EquipmentMeshAttachment + EntityRenderer read new shape; verify existing replay path still loads | **Throwaway** |
| **WP-B — Skin R&D** | Pick 8 distinct skin techniques; implement each in `EquipmentMeshAttachment._apply_persona_skin` as a single `match skin.approach` dispatch; extend (do not replace) the Round-5 palette-override path as the `palette_flat` branch; per-asset `skin` block documents technique + rationale + params | **Throwaway** |
| **WP-C — Corpse + Gore R&D** | Identify and verify mesh2motion death-pose clip; consolidate corpse pipeline to single shared body model (corpse renders the shared mesh2motion body at the death-pose frame, NOT a separately-attached prone mesh); pick 8 distinct gore approaches (extreme/gruesome); per-asset `corpse` block documents gore approach + rationale + params; verify Showroom Death trigger displays each persona's corpse-skin variant side-by-side | **Throwaway** |
| **WP-D — Accessories (OPTIONAL, low priority)** | Engineer-judgement: invest only if silhouette flattening is visually painful enough to require it; if invested, accessories MUST be a separate manifest field, NOT 1:1 coupled with skin technique. Sourced/stylized assets only. Recommend defer this round unless engineer R&D dev-preview shows silhouette degradation | **Throwaway** |

All WPs stay strictly inside `throwaway-prototypes/d-full-match/`. The
Round-5 scaffold-verify regression locks (forbidden tokens, no-UAT
artefacts, contract-shape assertions) remain in force and gain new
locks specific to Round-7 manifest shape (see §6).

---

## 3. Architecture Design

### 3.1 Manifest schema (schemaVersion 5)

**Key change:** body-shared character defaults hoist to a new
manifest-level `body` block; per-asset character entries collapse to
the persona-distinct fields only. Same posture for `corpseBody`. This
makes the consolidation **legible in the manifest shape itself** —
8 personas, 1 body. Per-asset asymmetry remaining is exactly what
*is* persona-distinct: `skin`, `accessories`, `corpse`.

```jsonc
{
  "schemaVersion": 5,
  "kitName": "d-full-match-round-7-skin-rnd-art-kit",
  "purpose": "Round-7 consolidated mesh2motion body + 8-technique skin breadth + 8-variant gore breadth.",
  "notes": ["..."],

  // NEW: body-shared defaults for the consolidated character pipeline
  "body": {
    "file": "characters/camper-mesh2motion-human-base.glb",
    "sourceKey": "mesh2motion",
    "modelScaleMultiplier": 2.1725,
    "pivotYOffset": 0,
    "attachBone": "hand_r",
    "armourAttachBone": "spine",
    "animation": {
      "idle": "Idle",
      "walk": "Walk",
      "attack": "Sword_Attack",
      "attack_unarmed": "Punch_Jab",
      "attack_armed": "Sword_Attack",
      "take_hit": "Hit_Chest",
      "death": "Death01",
      "loot": "PickUp_Table"
    },
    "source": { /* Scott Petrovic / Mesh2Motion provenance */ },
    "license": { "spdx": "CC0-1.0", /* ... */ },
    "sha256": "<recomputed>",
    "sizeBytes": 6066008
  },

  // NEW: corpse body uses the SAME shared GLB, frozen at death pose
  "corpseBody": {
    "file": "characters/camper-mesh2motion-human-base.glb",
    "deathPoseClip": "Death01",
    "modelScaleMultiplier": 2.1725,
    "pivotYOffset": 0,
    "notes": "Shared mesh2motion body, paused on Death01 final frame. Per-persona corpse-skin variant applied at instance time."
  },

  "assets": [
    {
      "id": "character.rat",
      "category": "character",
      "personaSlot": "rat",
      "skin": {
        "approach": "palette_flat",
        "rationale": "Round-5 baseline retained as the control sample — gives user a 'no-technique' anchor against which to evaluate the 7 R&D techniques.",
        "params": {
          "palette": {"base": "#32402f", "accent": "#78f28a", "emissive": "#d7ff63"}
        }
      },
      "accessories": null,
      "corpse": {
        "approach": "blood_saturation_overlay",
        "rationale": "Whole-body deep-red tint — rat went out red and wet.",
        "params": {"tint": "#5a0008", "saturation": 0.92, "factor": 0.85}
      },
      "notes": "rat persona — palette_flat skin + blood_saturation gore."
    },
    // ... 7 more persona entries, each with distinct skin.approach + distinct corpse.approach
    // weapons + armours unchanged from Round-5
    // environment unchanged from Round-5
  ]
}
```

#### 3.1.1 Hoisting rationale

Round-5's per-asset duplication of `file`, `modelScaleMultiplier`,
`pivotYOffset`, `attachBone`, `animation` was correct *while the body
axis was breadth-sampled* — each persona genuinely had a distinct
file/scale/bone/clip map. Round-7 consolidates that axis, so the
duplication becomes substrate smell (mental-model §6: "asymmetric
treatment of conceptually-uniform things is a design smell"). Hoisting
matches the §13 *honest substrate* posture.

POC posture (§10) authorises the schema break with no backward-compat
shim. Tests verify the post-bump shape; older snapshots are unaffected
(this is a renderer-side / manifest-side change, no snapshot schema
bump).

#### 3.1.2 Per-asset character entry shape (Round-7)

```jsonc
{
  "id": "character.<persona>",
  "category": "character",
  "personaSlot": "<persona>",         // required, one of the 8
  "skin": { "approach": "...", "rationale": "...", "params": {...} },
  "accessories": null | { "items": [...] },   // optional, NOT 1:1 coupled with skin
  "corpse": { "approach": "...", "rationale": "...", "params": {...} },
  "notes": "..."
}
```

Removed from per-asset (now read from `body`): `sourceKey`, `file`,
`modelScaleMultiplier`, `pivotYOffset`, `attachBone`, `animation`,
`palette` (palette migrates into `skin.params` for the `palette_flat`
branch), `source`, `license`, `extraction`, `sha256`, `sizeBytes`.

#### 3.1.3 Weapons, armours, environment, vfx

**Unchanged from Round-5.** Weapons/armor R&D is next round's axis;
Round-7 must not get tempted into rework here. Verify that
EquipmentMeshAttachment still attaches weapon meshes at `body.attachBone`
(now `hand_r`) and armour at `body.armourAttachBone` (`spine`) after
consolidation — these were previously per-asset and may have been
inconsistent across packs in Round-5.

### 3.2 Mesh2Motion clip coverage audit

From the Round-6 closing readout (camper row, verified by user UAT),
mesh2motion ships the following clips on
`characters/camper-mesh2motion-human-base.glb`:

| Showroom trigger | Mesh2Motion clip | Status |
|---|---|---|
| idle | `Idle` | confirmed |
| walk | `Walk` | confirmed |
| attack | `Sword_Attack` | confirmed |
| attack_unarmed | `Punch_Jab` | confirmed |
| attack_armed | `Sword_Attack` | confirmed |
| take_hit | `Hit_Chest` | confirmed |
| death | `Death01` | confirmed |
| loot | `PickUp_Table` | confirmed |

**Coverage:** 8/8 triggers map to dedicated mesh2motion clips. **Zero
fallback chains required for any persona.** This is the consolidation
dividend.

**Engineer verification action:** add `scripts/audit-mesh2motion-clips.gd`
(headless, GODOT_BIN-gated like `audit-character-scales.gd`) that:
1. Loads the shared mesh2motion body GLB.
2. Enumerates available `AnimationPlayer` clips.
3. Asserts every clip referenced in `manifest.body.animation` and
   `manifest.corpseBody.deathPoseClip` exists in the GLB.
4. Exits non-zero on any missing clip.

If the audit finds any documented clip name doesn't match the GLB's
actual clip set (e.g. clip got renamed in upstream mesh2motion since
Round 6), the engineer updates `manifest.body.animation` with the
correct clip names. Document the actual clip names verbatim in the
closing readout.

### 3.3 Bone-name reconciliation

`body.attachBone = "hand_r"` (camper's value, from Round-6 manifest).
Because all 8 personas now share one body GLB with one skeleton, this
bone applies uniformly. `body.armourAttachBone = "spine"` is the
existing armour socket convention (already shared across all
Round-5 armours).

**Engineer verification action:** the existing
`scripts/verify-character-rigs.gd` already iterates manifest character
assets and asserts rig structure. Extend it (or fold into
`audit-mesh2motion-clips.gd`) to assert that the mesh2motion body GLB
exposes a `Skeleton3D` with bone `hand_r` and bone `spine`. If either
is missing, the equipment pipeline silently falls back to a fixed-offset
socket (existing `_ensure_weapon_socket` behaviour) — that's a known
visual regression and must be caught at the substrate level, not in
UAT.

### 3.4 EntityRenderer / EquipmentMeshAttachment extension

#### 3.4.1 Skin dispatch — one switch, no branching leak

The current Round-5 skin pipeline lives in
`EquipmentMeshAttachment._apply_persona_palette(character_id,
armour_tier)` at `EquipmentMeshAttachment.gd:519`. It walks
`character.bodyMeshes`, computes a per-mesh `StandardMaterial3D` from
the persona's `palette` block (base/accent/emissive channels by
mesh-index modulo 3), and applies it as `material_override` with a
`next_pass` accent overlay.

**Round-7 extension shape:**

```gdscript
func _apply_persona_skin(character_id: String, armour_tier: int) -> void:
    var character: Dictionary = registered_characters.get(character_id, {})
    var asset: Dictionary = character.get("asset", {})
    var skin: Dictionary = asset.get("skin", {})
    var approach := str(skin.get("approach", "palette_flat"))
    match approach:
        "palette_flat":
            _apply_skin_palette_flat(character_id, skin, armour_tier)
        "pbr_texture_atlas":
            _apply_skin_pbr_texture(character_id, skin, armour_tier)
        "pattern_texture":
            _apply_skin_pattern_texture(character_id, skin, armour_tier)
        "decal_stickers":
            _apply_skin_decal_stickers(character_id, skin, armour_tier)
        "toon_cel_shader":
            _apply_skin_toon_cel(character_id, skin, armour_tier)
        "emissive_trim_shader":
            _apply_skin_emissive_trim(character_id, skin, armour_tier)
        "multi_material_split":
            _apply_skin_multi_material(character_id, skin, armour_tier)
        "rim_fresnel_shader":
            _apply_skin_rim_fresnel(character_id, skin, armour_tier)
        _:
            push_warning("unknown skin.approach: %s; falling back to palette_flat" % approach)
            _apply_skin_palette_flat(character_id, skin, armour_tier)
```

**Invariants the dispatch must preserve:**

- The Round-5 `_apply_persona_palette` body becomes
  `_apply_skin_palette_flat` verbatim — *zero behavioural delta on the
  rat persona*, which is intentionally the `palette_flat` control
  sample.
- Armour tier still post-modifies each branch's output (armour
  material-swap reads `armour_tier` and shifts metallic/emissive on
  the resulting material). Each `_apply_skin_*` helper signs
  `(character_id, skin: Dictionary, armour_tier: int)` so the existing
  Round-5 armour contract is preserved per-branch.
- **No technique-specific branching leaks into EntityRenderer.gd.**
  EntityRenderer continues to call
  `equipment_attachment.update_equipment(equipped)` and the dispatch
  is entirely inside EquipmentMeshAttachment.
- Decal-based branches (`decal_stickers`, and any
  `decal_*` gore approaches) instantiate `Decal` nodes parented under
  the character's `visual` root, NOT under the skeleton — so they
  follow the character's world transform but do NOT skin-deform with
  bone animation (decals project per-frame from a node transform).
  This is the intended Godot 4 decal usage and is supported under
  Compatibility/WebGL2 (with the per-character decal-count caveat —
  see §3.5).
- Shader-based branches (`toon_cel_shader`, `emissive_trim_shader`,
  `rim_fresnel_shader`) instantiate `ShaderMaterial` with a shader
  resource at `res://shared-harness/shaders/<approach>.gdshader`. Each
  shader file is committed alongside the manifest, MIT/CC0 licensed
  (engineer authors them; small per-shader files, no external pack
  dependency).

#### 3.4.2 Corpse pipeline consolidation

Currently `EntityRenderer._instance_or_corpse(corpse_scene, label,
material)` instantiates the `corpse.prone_humanoid` asset (the standalone
`prone-humanoid-prototype.glb`) and applies `mat_corpse`. Round-7 replaces
this:

- The corpse asset block (`corpse_asset` in EquipmentMeshAttachment)
  goes away as a standalone entry; it reads from `manifest.corpseBody`.
- `EquipmentMeshAttachment.corpse_scene()` now returns the same
  shared body GLB as `character_scene_for_persona()`. The two return
  the SAME `PackedScene`; the corpse just plays `Death01` paused on
  its final frame.
- New API: `EquipmentMeshAttachment.instantiate_persona_corpse(persona,
  label, fallback_material, base_scale) -> Node3D`. Mirrors
  `instantiate_persona_character` but:
  - Plays the `deathPoseClip` (`Death01`) once via the same
    `_handle_animation_finished` → `player.pause()` mechanism (D11 from
    Round 6).
  - Dispatches the per-persona `corpse.approach` via
    `_apply_persona_corpse_skin(character_id, corpse_block,
    armour_tier=0)` — symmetric to `_apply_persona_skin`.
- `EntityRenderer._update_corpses` switches to
  `equipment_attachment.instantiate_persona_corpse(persona, ...)` —
  needs the snapshot's per-character `personaId` (already indexed in
  `character_personas` during `_spawn_characters`).
- The old `corpse_scene` field on EntityRenderer goes away; replace
  with a per-corpse-instance instantiation path that reads persona
  from the snapshot.

#### 3.4.3 Gore dispatch — same shape as skin

```gdscript
func _apply_persona_corpse_skin(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
    var approach := str(corpse_block.get("approach", "blood_saturation_overlay"))
    match approach:
        "blood_saturation_overlay":
            _apply_corpse_blood_saturation(character_id, corpse_block)
        "wound_cluster_decals":
            _apply_corpse_wound_decals(character_id, corpse_block)
        "gore_pool_decal":
            _apply_corpse_gore_pool(character_id, corpse_block)
        "charred_burned_texture":
            _apply_corpse_charred(character_id, corpse_block)
        "exposed_bone_decals":
            _apply_corpse_exposed_bone(character_id, corpse_block)
        "viscera_projection":
            _apply_corpse_viscera(character_id, corpse_block)
        "dismemberment_baked":
            _apply_corpse_dismemberment(character_id, corpse_block)
        "decay_desaturation":
            _apply_corpse_decay(character_id, corpse_block)
        _:
            push_warning("unknown corpse.approach: %s; falling back to blood_saturation_overlay" % approach)
            _apply_corpse_blood_saturation(character_id, corpse_block)
```

Same architectural invariants as `_apply_persona_skin`: one switch in
one file, no technique-specific code leaks into EntityRenderer or
CombatVfx. Note `dismemberment_baked` is the one approach that *can*
require a second GLB asset (a body with a baked missing limb) —
engineer R&D may either bake a one-off variant GLB and reference it
via `corpse.params.bakedFile`, OR achieve the dismemberment effect
purely via hiding/scaling bone-attached MeshInstance3D children of
the shared body skeleton (preferred — no extra asset). Both are
Compatibility/WebGL2 clean wins; engineer picks the cheaper path
during implementation and documents the choice in the closing
readout.

### 3.5 Skin-technique selection (8 distinct, ratified)

Engineer picks below are **ratified-as-default**. Engineer may swap
during WP-B implementation if any technique proves infeasible on
Compatibility/WebGL2 *for reasons not visible from this plan*; any
swap must preserve the breadth-distinctness invariant (no two
personas share a technique) and be documented in the closing readout.

| # | Persona | `skin.approach` | Rationale | Render type |
|---|---|---|---|---|
| 1 | **rat** | `palette_flat` | Round-5 baseline retained as the control sample — gives the user a "no-technique" anchor against which the other 7 techniques are evaluated. Validates the EntityRenderer extension didn't regress the existing path. | StandardMaterial3D (per Round-5) |
| 2 | **duelist** | `pbr_texture_atlas` | UV-mapped sourced PBR texture set (albedo + normal + roughness + metallic + AO) — the duelist reads as "weight + craftsmanship," opposite the palette-only baseline. | StandardMaterial3D + textures |
| 3 | **trader** | `pattern_texture` | Tiled hex/circuit-board CC0 pattern texture — the trader reads as "data-vendor / glitched market lane." | StandardMaterial3D + UV1 tiled |
| 4 | **opportunist** | `decal_stickers` | Projected Decal nodes (logos, scars, dirt patches, gang symbols) — opportunist reads as "scavenged identity, painted-over loyalties." Decal count capped at 3 per persona per WebGL2 guidance. | Decal nodes |
| 5 | **paranoid** | `toon_cel_shader` | Custom toon/cel-shader (flat colors, hard N·L shadow edges, single ramp texture) — paranoid reads as "graphic-novel pulp, exaggerated panic-affect." | ShaderMaterial |
| 6 | **camper** | `emissive_trim_shader` | Dark body + neon emissive trim along UV-mask seams (custom shader, emission via shader, no bloom-dependence) — camper reads as "cyberpunk default; held-position-with-glow." | ShaderMaterial |
| 7 | **sprinter** | `multi_material_split` | Per-body-part StandardMaterial3D (head/chest/legs/arms each in distinct metal/finish) — sprinter reads as "patched-together speed-build, mismatched gear." | StandardMaterial3D × N surfaces |
| 8 | **vulture** | `rim_fresnel_shader` | Rim-light/fresnel edge-highlight (custom shader, view-dependent edge brightening) — vulture reads as "hologram-adjacent, scavenger-ghost." | ShaderMaterial |

**Breadth properties this set delivers:**

- 1 baseline (control), 3 StandardMaterial3D variants (channel/texture/pattern/split),
  1 decal-based, 3 ShaderMaterial-based (toon/trim/fresnel). Spans the
  full Round-5-to-shader R&D space.
- Each technique is visually orthogonal to the others — user can
  articulate "I want PBR texture + camper's emissive trim shader" or
  "I want toon-cel on rat" without the techniques entangling.
- Compatibility/WebGL2 cost ceiling is preserved per Round-4 D-tech
  constraint: 3 shader variants × 8 personas = 24 shader compiles
  on load (well under WebGL2 budget); decal count is 3 per persona
  for 1 persona only = 3 total decals (well under WebGL2 cluster cap).

**Per-asset `skin.params` shapes:**

```jsonc
// palette_flat
{ "palette": {"base": "#hex", "accent": "#hex", "emissive": "#hex"} }

// pbr_texture_atlas
{ "albedo": "textures/skin/duelist-pbr-albedo.png",
  "normal": "textures/skin/duelist-pbr-normal.png",
  "roughness": "textures/skin/duelist-pbr-roughness.png",
  "metallic": "textures/skin/duelist-pbr-metallic.png",
  "ao": "textures/skin/duelist-pbr-ao.png" }

// pattern_texture
{ "albedo": "textures/skin/trader-hex-pattern.png",
  "uv1_scale": [4.0, 4.0],
  "tint": "#hex" }

// decal_stickers
{ "decals": [
    { "file": "textures/skin/opportunist-decal-logo.png", "offset": [0, 0.3, 0.1], "size": [0.2, 0.2, 0.2] },
    { "file": "textures/skin/opportunist-decal-scar.png", "offset": [-0.1, 0.1, 0.05], "size": [0.15, 0.15, 0.1] },
    { "file": "textures/skin/opportunist-decal-dirt.png", "offset": [0.0, -0.1, 0.0], "size": [0.3, 0.2, 0.15] }
  ],
  "basePalette": {"base": "#hex", "accent": "#hex", "emissive": "#hex"} }

// toon_cel_shader
{ "shader": "shaders/toon_cel.gdshader",
  "rampSteps": 3,
  "outlineColor": "#hex",
  "params": {"base": "#hex", "accent": "#hex"} }

// emissive_trim_shader
{ "shader": "shaders/emissive_trim.gdshader",
  "trimMask": "textures/skin/camper-trim-mask.png",
  "trimColor": "#hex",
  "trimEnergy": 1.8,
  "baseColor": "#hex" }

// multi_material_split
{ "bodyParts": {
    "head":  {"base": "#hex", "metallic": 0.2, "roughness": 0.6},
    "chest": {"base": "#hex", "metallic": 0.5, "roughness": 0.4},
    "legs":  {"base": "#hex", "metallic": 0.1, "roughness": 0.8},
    "arms":  {"base": "#hex", "metallic": 0.7, "roughness": 0.3}
  },
  "partAssignmentByMeshIndex": [0, 1, 2, 3, /* ... */] }

// rim_fresnel_shader
{ "shader": "shaders/rim_fresnel.gdshader",
  "rimColor": "#hex",
  "rimPower": 2.5,
  "baseColor": "#hex" }
```

Engineer authors all 8 `skin.params` blocks in the manifest, with
texture files committed under
`shared-harness/art-kit/textures/skin/` and shaders under
`shared-harness/art-kit/shaders/` (new subdir). All textures CC0
sourced (Kenney, OpenGameArt, ambientCG, Polyhaven, etc.) or
generated locally per Round-5 prototype-primitive convention. Shaders
written by engineer, attributed local prototype, CC0 dedicated.

### 3.6 Gore-technique selection (8 distinct, ratified)

Engineer picks below are **ratified-as-default**. Same swap-on-infeasibility
rule as §3.5.

| # | Persona | `corpse.approach` | Rationale | Render type |
|---|---|---|---|---|
| 1 | **rat** | `blood_saturation_overlay` | Whole-body deep-red tint — rat went out red and wet. Shader-driven; cheapest gore approach (validates the cost floor). | ShaderMaterial / StandardMaterial3D tint |
| 2 | **duelist** | `wound_cluster_decals` | Multiple stab/slash decals across torso — duelist died with weapon in hand, took it in close. | Decal nodes (4-6 wound decals) |
| 3 | **trader** | `gore_pool_decal` | Radiating blood-pool decal centered on corpse (large floor-projected decal beneath corpse) — trader bled out slow. | Decal node (1 large pool) |
| 4 | **opportunist** | `charred_burned_texture` | Charred/burned albedo + lingering emissive scorch — opportunist took a cybernetic-fried fatal jolt. | StandardMaterial3D + emission |
| 5 | **paranoid** | `exposed_bone_decals` | Gashes revealing white-bone — paranoid's worst nightmare made literal. | Decal nodes (2-3 gash decals) |
| 6 | **camper** | `viscera_projection` | Exposed-organ decals at chest/abdomen — camper got opened up. | Decal nodes (2 viscera decals) |
| 7 | **sprinter** | `dismemberment_baked` | Bone-attached limb MeshInstance3D hidden (preferred: hide leg/arm child node on shared skeleton; OR baked variant GLB) — sprinter went down dismembered. | Skeleton bone-child hide OR variant GLB |
| 8 | **vulture** | `decay_desaturation` | Immediate desaturation/drained-look shader pass — vulture went out drained, ghost-like. Fits the rim-fresnel skin pairing thematically (engineer flag: skin and corpse are decoupled axes; pairing is illustrative not load-bearing). | ShaderMaterial (desaturate + darken) |

**Breadth properties:**

- 2 shader-driven (blood saturation, decay), 4 decal-driven (wound cluster,
  gore pool, exposed bone, viscera), 1 texture+emission, 1 mesh-level
  dismemberment. Spans the full extreme-gore vocabulary the
  consumer-render era will draw from.
- All extreme/gruesome per user direction; nothing subtle.
- Decal counts total: 4-6 + 1 + 2-3 + 2 = ~12 decals max active across
  the 8 corpses simultaneously in the Showroom Death trigger.
  Comfortably under WebGL2 cluster cap; consumer-replay-era will
  rarely have 8 corpses on screen at once anyway.

**Per-asset `corpse.params` shape examples:**

```jsonc
// blood_saturation_overlay
{ "tint": "#hex", "saturation": 0.92, "factor": 0.85 }

// wound_cluster_decals
{ "decals": [
    { "file": "textures/gore/wound-slash.png", "offset": [0, 0.4, 0.1], "size": [0.18, 0.18, 0.12] },
    /* 3-5 more */
  ] }

// gore_pool_decal
{ "decals": [
    { "file": "textures/gore/blood-pool-large.png", "offset": [0, -0.05, 0], "size": [1.4, 0.05, 1.4], "rotationDeg": [0, 0, 0] }
  ] }

// charred_burned_texture
{ "albedo": "textures/gore/charred-albedo.png",
  "emission": "#hex", "emissionEnergy": 0.6 }

// exposed_bone_decals
{ "decals": [ /* 2-3 gash decals */ ] }

// viscera_projection
{ "decals": [ /* 2 viscera decals */ ] }

// dismemberment_baked
{ "method": "bone_hide" | "variant_glb",
  "hideBones": ["leg_l", "forearm_r"],          // for bone_hide method
  "stumpDecals": [ /* decal at the hide point */ ]
  // OR for variant_glb:
  // "file": "characters/dismembered/sprinter-mesh2motion-missing-leg.glb"
}

// decay_desaturation
{ "shader": "shaders/decay_desaturation.gdshader",
  "desatAmount": 0.85, "darkenAmount": 0.4, "tint": "#hex" }
```

### 3.7 Showroom Death-trigger verification (no-UAT discipline)

The Showroom's existing Death trigger
(`Showroom.gd:_trigger_animation("death")`) plays the death clip via
`equipment_attachment.play_character_animation(showroom_id, "death")`.
With Round-7 consolidation, all 8 personas play `Death01` (uniformly,
no fallback chain).

**The corpse-skin variation does NOT automatically apply** because the
Showroom Death trigger animates the *live character* (which uses
`skin`, not `corpse`). To display 8 corpse-skin variations side-by-side,
the engineer must extend the Showroom Death-trigger handler:

**Option A (recommended):** When the Death trigger fires, after
calling `play_character_animation(..., "death")`, ALSO call a new
method `equipment_attachment.apply_corpse_skin_to_live_character(
showroom_id)` that swaps the live character's body material/decals
from the `skin` approach to the `corpse` approach in-place. The
character keeps animating, but its skin becomes the corpse-skin
variant. When the user clicks Idle or any other trigger, the live
character's skin reverts to `skin.approach`. This matches the
"side-by-side comparison" affordance the Showroom is built for.

**Option B (more faithful but heavier):** When the Death trigger
fires, hide the live character and instantiate a corpse Node3D at the
same station with `instantiate_persona_corpse`. Reverting requires
deleting the corpse and re-spawning the live character. Heavier on
scene-graph churn; rejected.

**Decision: Option A (ratified).** Documented in the spec as binding
for WP-C.

**Verification (no-UAT):**

1. `verify-scaffold.mjs` gains tokens:
   - `Showroom.gd` includes `apply_corpse_skin_to_live_character`
   - `EquipmentMeshAttachment.gd` exposes `apply_corpse_skin_to_live_character` and `_apply_persona_corpse_skin`
   - All 8 `_apply_corpse_<approach>` helper names are present
2. `scripts/audit-mesh2motion-clips.gd` (new, see §3.2) asserts
   `Death01` exists.
3. `scripts/verify-character-rigs.gd` (extended) iterates every
   persona, calls `instantiate_persona_character` + applies skin +
   applies corpse-skin, and asserts no script errors.

### 3.8 Replay-path verification (no-UAT discipline)

Existing recorded matches (snapshot schemaVersion 3) must continue to
play back correctly after consolidation. The renderer-side changes
must NOT trip any snapshot field assumption — characters still come in
with `personaId`, `characterId`, `pos`, `alive`, etc. unchanged.

**Verification approach:**

1. **Structural smoke (no-UAT):** Extend
   `scripts/verify-character-rigs.gd` (or add
   `scripts/audit-replay-load.gd`) that:
   - Loads a fixture snapshot from
     `apps/replay/__fixtures__/` (or a tiny hand-authored one if
     fixtures aren't readily accessible from Godot context).
   - Constructs an `EntityRenderer` + `EquipmentMeshAttachment`,
     calls `configure(snapshot, scene_builder)`, then `update_to_turn(1.0)`.
   - Asserts: ≥1 character spawned, ≥1 corpse spawned (if snapshot
     has deaths), `instantiate_persona_corpse` returns a valid
     Node3D, no GDScript errors, no missing-resource warnings.
   - Exits non-zero on any assertion failure.
2. **Scaffold-verify tokens (no-UAT):** `verify-scaffold.mjs` asserts
   the snapshot contract surfaces EntityRenderer reads (`personaId`,
   `characterId`, `movements`, `attacks`, `loots`, `corpses`,
   `equippedByCharacter`) remain present and unmodified.
3. **No browser. No screenshot. No headless visual checks.** The user
   runs visual UAT themselves on a recorded match.

### 3.9 Cleanup plan (surgical deletion)

Files to **DELETE** after WP-A confirms the new manifest references
ONLY the shared mesh2motion body:

**characters/ (delete everything except the mesh2motion body + import sidecar + color-palette texture):**
- `characters/rat-kaykit-rogue-hooded.glb` (+ `.import`, + `_rogue_texture.png`, + `.png.import`)
- `characters/rat-kenney-blocky-a.glb` (+ `.import`)
- `characters/duelist-robin-lamb-hero.glb` (+ `.import`)
- `characters/trader-oga-simple-char/` (entire dir)
- `characters/trader-local-neon-broker.glb` (+ `.import`)
- `characters/opportunist-quaternius-space-mech.glb` (+ `.import`, + `_Atlas.png`, + `.png.import`)
- `characters/paranoid-gdquest-mannequiny.glb` (+ `.import`)
- `characters/paranoid-kenney-blocky-r.glb` (+ `.import`)
- `characters/camper-kenney-blocky-n.glb` (+ `.import`)
- `characters/sprinter-oga-animated-humanoid.fbx` (+ `.import`)
- `characters/sprinter-local-crimson-stalker.glb` (+ `.import`)
- `characters/vulture-styloo-robot/` (entire dir)
- `characters/vulture-kenney-blocky-q.glb` (+ `.import`)

**Files to KEEP in characters/:**
- `characters/camper-mesh2motion-human-base.glb` (+ `.import`)
- `characters/camper-mesh2motion-human-base_color-palette.png` (+ `.import`) — IF still referenced by any `skin.params` (engineer call; if no `skin.approach` uses this texture, delete it too)

**corpse/ (delete the standalone prone-humanoid prototype):**
- `corpse/prone-humanoid-prototype.glb` (+ `.import`)

The new corpse pipeline uses the shared mesh2motion body, not a
standalone corpse GLB.

**Cleanup verification:**

1. Engineer assembles the new manifest first.
2. Bash-collect every `file` value referenced by the new manifest
   (recursive).
3. Bash-list every file under `shared-harness/art-kit/characters/` and
   `shared-harness/art-kit/corpse/`.
4. Diff (a) vs. (b). Delete files in (b) but not (a).
5. Run `verify-scaffold.mjs` — its sha256/sizeBytes assertions on
   manifest assets will catch any deletion that breaks a still-referenced
   file.
6. Run `npm --prefix throwaway-prototypes/d-full-match test` — the
   GODOT_BIN-gated audit scripts will catch missing-resource warnings
   at load.

Engineer must NOT bulk-delete. Each rm is a discrete git change
trackable via `git status`; if a referenced file was accidentally
caught in the deletion, `git restore` reverses it cleanly.

### 3.10 Decoupling discipline for accessories (WP-D, OPTIONAL)

If engineer invests in WP-D:

- `manifest.assets[i].accessories` is a SEPARATE field from
  `manifest.assets[i].skin`. The two are read independently by
  EquipmentMeshAttachment and applied at instance time in independent
  code paths.
- `accessories` shape:
  ```jsonc
  {
    "items": [
      { "file": "accessories/kaykit-hat-top.glb", "attachBone": "head", "rotationDeg": [0, 0, 0], "scale": 1.0 },
      { "file": "accessories/kenney-mask-skull.glb", "attachBone": "head", "rotationDeg": [0, 0, 0], "scale": 1.0 }
    ]
  }
  ```
- Accessory selection is engineer-judgement: pick 3-5 personas (NOT
  all 8) to receive accessories, NOT 1:1 paired with skin technique.
  E.g. accessories might go to {rat, opportunist, sprinter} — three
  personas whose skin techniques are `palette_flat`, `decal_stickers`,
  `multi_material_split`. Or some other non-1:1 split. The point is
  the user can articulate "I like persona X's skin but not its hat"
  without the two being entangled.
- Accessory assets sourced from CC0 packs only (KayKit, Quaternius,
  Kenney, OpenGameArt, etc.). Engineer documents source/license per
  accessory item in the manifest's `accessories.items[].source` +
  `.license` sub-blocks (same shape as Round-5 character source/license
  metadata).
- Verification: `verify-scaffold.mjs` adds a token check that asserts
  IF any persona has accessories, the accessory-skin coupling is NOT
  1:1 (count of personas with accessories MUST NOT equal the count of
  distinct skin techniques attached to those personas).

**Recommendation: defer WP-D.** Skin breadth is the load-bearing
deliverable; accessories are a polish layer that risks muddying the
breadth signal the user evaluates. Engineer call during WP-A's
dev-preview: if the consolidated body shows up so silhouette-flat that
even skin technique can't carry persona distinguishability, invest
WP-D. Otherwise skip.

---

## 4. Dependency Map (parallelization)

```
WP-A Consolidation
  ├─ A1 manifest schema bump (body block hoist; per-asset collapse)
  ├─ A2 EquipmentMeshAttachment reads new body block
  ├─ A3 EntityRenderer corpse pipeline switches to instantiate_persona_corpse
  ├─ A4 audit-mesh2motion-clips.gd (new script)
  ├─ A5 verify-character-rigs.gd extension
  ├─ A6 verify-scaffold.mjs token updates for new manifest shape
  ├─ A7 surgical cleanup (delete unreferenced character GLBs + corpse GLB)
  └─ A8 replay-path smoke (extends verify-character-rigs.gd OR new audit-replay-load.gd)

WP-B Skin R&D (depends on A1, A2)
  ├─ B1 _apply_persona_skin dispatch (one switch)
  ├─ B2 _apply_skin_palette_flat (relocate existing _apply_persona_palette)
  ├─ B3 _apply_skin_pbr_texture_atlas + sourced PBR textures for duelist
  ├─ B4 _apply_skin_pattern_texture + sourced pattern texture for trader
  ├─ B5 _apply_skin_decal_stickers + decal textures for opportunist
  ├─ B6 _apply_skin_toon_cel + toon_cel.gdshader for paranoid
  ├─ B7 _apply_skin_emissive_trim + emissive_trim.gdshader + trim mask for camper
  ├─ B8 _apply_skin_multi_material for sprinter
  └─ B9 _apply_skin_rim_fresnel + rim_fresnel.gdshader for vulture

WP-C Corpse + Gore R&D (depends on A1, A2, A3)
  ├─ C1 instantiate_persona_corpse (new factory)
  ├─ C2 _apply_persona_corpse_skin dispatch (one switch)
  ├─ C3-C10 eight _apply_corpse_<approach> helpers (one per persona)
  ├─ C11 Showroom Death-trigger extension (apply_corpse_skin_to_live_character — Option A)
  └─ C12 verify-scaffold.mjs token check for corpse dispatch surface

WP-D Accessories (OPTIONAL, depends on A2; gated on dev-preview judgement)
  ├─ D1 manifest accessories field + decoupling rules
  ├─ D2 EquipmentMeshAttachment _apply_persona_accessories
  └─ D3 verify-scaffold.mjs accessory-decoupling assertion
```

**Parallelization opportunities:**

- **WP-A is the critical path.** A1→A2 must land before WP-B/WP-C can
  start. A4–A8 can run parallel after A1–A3 are settled.
- **WP-B's B3–B9 are all parallel.** Each `_apply_skin_<approach>`
  helper is independent — engineer can dispatch all 7 R&D techniques
  concurrently (parallel sub-agents permissible if engineer chooses;
  each touches a different texture/shader file and adds one method to
  EquipmentMeshAttachment.gd).
- **WP-C's C3–C10 are all parallel.** Same shape as WP-B.
- **WP-B and WP-C can run in parallel after WP-A** — they touch
  different dispatch methods in the same file, but the methods are
  non-overlapping. Engineer must coordinate on EquipmentMeshAttachment.gd
  conflicts (line-level merges trivially).
- **WP-D, if invested, is fully independent** after A2 lands.

**Recommended sequencing:**

1. WP-A first (critical path); land in single commit before WP-B/C
   dispatch.
2. WP-B + WP-C in parallel (two engineer-agent dispatches if user
   wants speed; otherwise sequential).
3. WP-D last and only if dev-preview shows silhouette flattening.

---

## 5. Work Package Breakdown

### WP-A — Consolidation

**Scope:**
- Bump manifest `schemaVersion` 4 → 5.
- Add `body` block + `corpseBody` block at manifest root.
- Restructure 8 character asset entries to the persona-distinct shape
  (`personaSlot`, `skin`, `accessories?`, `corpse`, `notes`).
- Update `EquipmentMeshAttachment._load_manifest` to read `body` and
  `corpseBody`, merge body defaults into each character asset
  in-memory at load time so downstream code reads a unified asset
  dict (preserves existing
  `character_assets_by_persona[persona]["file" | "modelScaleMultiplier"
  | "attachBone" | "animation"]` lookup shape — minimal downstream
  delta).
- Update `EntityRenderer._update_corpses` to use new
  `instantiate_persona_corpse(persona, ...)` API (added as a stub in
  WP-A; full corpse-skin dispatch lands in WP-C).
- Add `scripts/audit-mesh2motion-clips.gd` — headless, GODOT_BIN-gated,
  asserts mesh2motion GLB ships all 8 documented clips + `hand_r`
  bone + `spine` bone.
- Extend `scripts/verify-character-rigs.gd` to iterate the new
  manifest shape and assert per-persona rig load + skin/corpse asset
  block validity.
- Update `scripts/verify-scaffold.mjs` to:
  - Assert `manifest.schemaVersion === 5`.
  - Assert `manifest.body.file` exists and references the mesh2motion
    body GLB.
  - Assert `manifest.body.animation` carries all 8 clip kinds.
  - Assert all 8 character assets have `personaSlot`, `skin`, `corpse`
    blocks.
  - Assert 8 distinct `skin.approach` values across the 8 personas.
  - Assert 8 distinct `corpse.approach` values across the 8 personas.
  - Drop or update Round-5/6 manifest-shape assertions that no longer
    fit (per-asset `file`, `modelScaleMultiplier`, etc.).
- Surgical cleanup per §3.9.
- Replay-path structural smoke per §3.8.

**Success criteria:**
- `manifest.json` carries `body` and `corpseBody` blocks; `schemaVersion === 5`.
- All 8 character entries have `personaSlot`, `skin`, `corpse` blocks
  with non-empty `approach` fields; `skin.approach` values are 8
  distinct strings; `corpse.approach` values are 8 distinct strings.
- `EquipmentMeshAttachment` loads the new manifest without errors;
  every `character_assets_by_persona[persona]` lookup returns a
  merged dict with body defaults present.
- `EntityRenderer` loads a recorded snapshot (via the structural
  smoke) and instantiates 8 characters + N corpses without errors.
- `audit-mesh2motion-clips.gd` exits 0 with all 8 clips + 2 bones
  confirmed.
- `verify-character-rigs.gd` exits 0 with all 8 personas loading
  cleanly.
- `verify-scaffold.mjs` exits 0 with new Round-7 token assertions
  passing.
- `art-kit/characters/` and `art-kit/corpse/` contain only files
  referenced by the new manifest.
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`,
  `npm --prefix throwaway-prototypes/d-full-match test`,
  `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match run build`
  all clean.
- Round-5 forbidden-token grep (browsertools, chromium, pathing logic)
  stays clean.

### WP-B — Skin R&D

**Scope:**
- Add `_apply_persona_skin(character_id, armour_tier)` dispatch in
  EquipmentMeshAttachment.
- Relocate existing `_apply_persona_palette` body into
  `_apply_skin_palette_flat` (verbatim; rat persona behaviour
  unchanged).
- Implement 7 additional `_apply_skin_<approach>` helpers per §3.5
  technique table.
- Author 3 GDshader files under
  `shared-harness/art-kit/shaders/`:
  - `toon_cel.gdshader` (for paranoid)
  - `emissive_trim.gdshader` (for camper)
  - `rim_fresnel.gdshader` (for vulture)
- Source/generate skin textures under
  `shared-harness/art-kit/textures/skin/`:
  - PBR set for duelist (5 maps: albedo/normal/roughness/metallic/AO)
  - Pattern texture for trader
  - 3 decal textures for opportunist
  - Trim mask for camper
- Populate per-asset `skin.params` blocks in manifest with concrete
  paths/colors/values.
- All sourced textures CC0-licensed; provenance documented in
  manifest's `assets[i].notes` and a manifest-level `notes[]` entry
  per Round-5 convention.
- Engineer-generated textures dedicated CC0 per
  `local generated asset` convention.
- Update `EntityRenderer._spawn_characters` to call
  `equipment_attachment.apply_persona_skin(character_id, 0)` after
  `register_character` (replaces the existing `_apply_persona_palette`
  call inside `register_character` — promoted to a public API).
- Extend `verify-scaffold.mjs` to assert:
  - All 8 `_apply_skin_<approach>` methods present in
    EquipmentMeshAttachment.gd.
  - All 3 shader files exist.
  - Skin texture files exist for the 5 personas using textures.
  - Manifest `skin.params` shapes match the per-approach contracts
    documented in §3.5.

**Success criteria:**
- Each of 8 personas renders with its distinct skin technique when
  instantiated.
- Rat persona is *visually identical* to Round-6 (palette_flat is
  Round-5 path verbatim).
- 7 R&D techniques produce visually distinct materials/decals
  (verifiable by engineer via dev-preview, not by automated UAT).
- Shader compiles succeed on GODOT_BIN headless smoke (compile errors
  trip `audit-mesh2motion-clips.gd` or `verify-character-rigs.gd`
  extension).
- All validation commands pass clean.

### WP-C — Corpse + Gore R&D

**Scope:**
- Add `instantiate_persona_corpse(persona, label, fallback_material,
  base_scale) -> Node3D` factory in EquipmentMeshAttachment, mirroring
  `instantiate_persona_character`.
- Add `_apply_persona_corpse_skin(character_id, corpse_block,
  armour_tier)` dispatch.
- Implement 8 `_apply_corpse_<approach>` helpers per §3.6 table.
- Author 1 additional shader: `decay_desaturation.gdshader` (for
  vulture corpse).
- Source/generate gore textures under
  `shared-harness/art-kit/textures/gore/`:
  - Wound slash decals (3-5 for duelist wound cluster)
  - Blood pool decal (1 large for trader)
  - Charred albedo + emission map (for opportunist)
  - Gash decals (2-3 for paranoid exposed bone)
  - Viscera decals (2 for camper)
- Populate per-asset `corpse.params` blocks in manifest.
- Update `EntityRenderer._update_corpses` to use
  `instantiate_persona_corpse(persona, ...)` (replaces the WP-A stub
  with full corpse-skin application).
- Extend Showroom Death trigger handler per §3.7 Option A: after
  `play_character_animation(..., "death")`, call
  `equipment_attachment.apply_corpse_skin_to_live_character(showroom_id)`.
- Engineer picks dismemberment method for sprinter (bone-hide
  preferred over variant GLB); documents choice.
- Extend `verify-scaffold.mjs` to assert:
  - All 8 `_apply_corpse_<approach>` methods present.
  - `instantiate_persona_corpse` method present with correct
    signature.
  - `apply_corpse_skin_to_live_character` method present.
  - Showroom Death handler calls
    `apply_corpse_skin_to_live_character`.
  - Gore texture/shader files exist.

**Success criteria:**
- Replay corpses render with the shared mesh2motion body at death pose
  + per-persona gore variant.
- Showroom Death trigger applies the corpse-skin variant to each live
  character (Option A); 8 distinct gore variations visible
  side-by-side.
- Showroom Idle/Walk/etc. triggers correctly revert the live character
  to the `skin` approach (verifiable via dev-preview).
- All validation commands pass clean.

### WP-D — Accessories (OPTIONAL)

**Scope (if invested):**
- Add `accessories` field to per-asset character block per §3.10
  shape.
- Implement `EquipmentMeshAttachment._apply_persona_accessories(character_id)`
  that walks `accessories.items[]`, instantiates each via
  `_scene_for_asset`, parents at the named `attachBone`.
- Source CC0 accessory assets under
  `shared-harness/art-kit/accessories/`.
- Pick 3-5 personas to receive accessories; ensure NOT 1:1 coupled
  with skin technique.
- Extend `verify-scaffold.mjs` to assert decoupling per §3.10.

**Success criteria:**
- Accessories render correctly on selected personas.
- No persona's skin technique is uniquely identifiable by accessory
  presence/absence.
- User can articulate mixed feedback per the decoupling principle.

**Recommended: SKIP WP-D this round** per §3.10 reasoning.

---

## 6. Assignment-Level Success Criteria

1. ✅ All 8 character manifest entries reference the mesh2motion human-base
   body (via `manifest.body.file`); per-asset character entries carry
   ONLY persona-distinct fields.
2. ✅ Per-asset `skin` block carries `approach` + `rationale` + `params`.
3. ✅ 8 DISTINCT `skin.approach` values across the 8 personas.
4. ✅ Per-asset optional `accessories` block (may be `null`); if non-null,
   not 1:1 coupled with `skin.approach`.
5. ✅ Single shared mesh2motion death-pose corpse model via
   `manifest.corpseBody`; per-persona `corpse` block.
6. ✅ 8 DISTINCT `corpse.approach` values across the 8 personas, leaning
   extreme/gruesome.
7. ✅ EquipmentMeshAttachment reads `skin` and `corpse` blocks via a
   single `match`-based dispatch each; extends the Round-5 palette path
   as the `palette_flat` branch without replacing it.
8. ✅ Equipment (weapons at `hand_r`, armour at `spine`) still attaches
   correctly via `body.attachBone` / `body.armourAttachBone`.
9. ✅ Obsoleted character GLBs deleted from
   `art-kit/characters/`; obsoleted `prone-humanoid-prototype.glb`
   deleted from `art-kit/corpse/`.
10. ✅ Manifest `schemaVersion` bumped 4 → 5.
11. ✅ Round-5 forbidden-token grep clean (no pathing logic, no
    browsertools artefacts).
12. ✅ Showroom Death trigger displays each persona's corpse-skin
    variant side-by-side (Option A).
13. ✅ Existing recorded match replay path loads cleanly via the
    structural smoke (no browser UAT).
14. ✅ Validation gates all clean:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run build`
    - `npm test`
    - `npm --prefix throwaway-prototypes/d-full-match test`
    - `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match run build`

---

## 7. Identified Ambiguities / Open Questions

These are questions the implementer should ratify with the
Outcome🧭Steward or PM before / during WP-A:

**Q1. Dismemberment method for sprinter.** Bone-hide (preferred per
§3.6) requires identifying which mesh2motion skeleton bones can be
cleanly hidden without leaving a hole. Engineer to verify
during WP-C C7. Fallback: bake a one-off variant GLB. If bone-hide
proves unviable, document the cost of the variant GLB in the closing
readout (an extra ~6MB GLB in the art kit is acceptable; just call
it).

**Q2. Color-palette texture retention.**
`characters/camper-mesh2motion-human-base_color-palette.png` is
currently referenced for camper's existing rendering. After
Round-7's `skin.params` migration, it may no longer be referenced. If
no `skin.approach` uses it, delete it per §3.9. Engineer call during
WP-A A7.

**Q3. Showroom Equipment-tier × Corpse-skin interaction.** When the
Showroom Death trigger fires, the live character's body material has
been pre-tinted by the persona's `skin` AND modified by the active
armour tier (if any). After `apply_corpse_skin_to_live_character`
swaps to the corpse variant, should the armour tier still post-modify?
Recommend: YES — corpse-skin still respects armour tier per the
existing Round-5 contract (armour tier shifts metallic/emissive on
the final material). The dispatch helpers accept `armour_tier`
parameter for exactly this reason. Document the chosen behaviour in
the closing readout.

**Q4. Decal scaling under modelScaleMultiplier.** The shared body uses
`modelScaleMultiplier = 2.1725` (from camper's Round-6 calibration).
Decal node `size` is in world units, NOT character-local space.
Engineer must size decals appropriately (e.g. a wound decal at
`size=[0.18, 0.18, 0.12]` is in world units, parented under the
character's `visual` root which already has the scale baked in). If
decals come out tiny or huge, recalibrate during WP-B/WP-C
dev-preview.

**Q5. WP-D investment decision.** Engineer decides during WP-A
dev-preview whether silhouette flattening warrants accessory work.
Recommend default skip; if engineer notices any TWO personas are
visually indistinguishable at typical viewing distance, invest
WP-D for those personas only.

**Q6. Replay snapshot fixture.** WP-A A8's structural smoke needs a
snapshot fixture. Options:
- Use existing `apps/replay/__fixtures__/` if such exists (check
  during WP-A).
- Author a tiny hand-rolled snapshot inline in the audit script.
- Skip A8 and rely on user UAT for replay-path validation.
Engineer call during WP-A; recommend Option (a) or (b) for substrate
honesty per §10 "diagnostics target building agents first."

**Q7. Body-shared `palette` removal.** The current Round-6 manifest
has per-asset `palette` blocks that drive the existing
`_apply_persona_palette`. Round-7 moves the palette concept INTO
`skin.params` for the `palette_flat` branch. The 7 R&D branches may
or may not use a palette at all (some use shaders + colors directly).
Engineer must NOT preserve a body-level palette default; each
branch's `skin.params` is self-contained. Verified by §6 success
criterion 7.

---

## 8. Recommended Job Sequence

1. **PLAN Job (this artifact)** — drafted; ready for Outcome🧭Steward
   plan-review pass.
2. **Plan Review** — Outcome🧭Steward or PM cross-checks against
   north star + mental-model §10/§13. Likely friction points: WP-D
   investment default (engineer judgement vs. spec recommendation),
   gore-technique persona assignments (engineer R&D freedom vs. spec
   ratification), Showroom Death-trigger Option A (architectural
   change to live-character skin reverting).
3. **IMPLEMENT WP-A (Consolidation)** — single agent, ~2-3 hour
   estimate. Critical path. No browser UAT.
4. **IMPLEMENT WP-B (Skin R&D) + WP-C (Corpse + Gore R&D)** —
   parallel-dispatchable as two agents OR sequential single-agent.
   ~3-4 hour estimate each. No browser UAT.
5. **(Optional) IMPLEMENT WP-D (Accessories)** — engineer judgement.
   Skip recommended.
6. **CLOSING READOUT** — engineer documents:
   - The mesh2motion clip coverage audit results (verbatim clip names
     verified).
   - The final 8 skin techniques applied (any swaps from §3.5
     ratified defaults).
   - The final 8 gore techniques applied (any swaps from §3.6).
   - Dismemberment method chosen for sprinter (bone-hide vs. variant
     GLB).
   - Accessory investment decision (Q5 outcome).
   - Replay-path smoke verification (Q6 outcome).
   - Q1-Q7 outcomes documented as a table.
   - Files deleted from `art-kit/characters/` + `art-kit/corpse/`.
   - Validation evidence per AOP.VALIDATE.
   - Hand-off note: user runs visual UAT in Showroom; user picks
     winning skin technique + winning gore technique; next round
     dispatch follows the §10 recursive consolidate-then-rebreadth
     pattern on the next-finest open axis.
7. **NO UAT JOB.** Per north star explicit directive: *"No UAT/browser
   in the assignment!"* User runs visual UAT themselves in the
   Showroom.

---

## 9. Mental-Model Cross-Link

This round is the concrete, second-iteration realisation of mental-model
§10's recursive breadth/consolidate principle (just refreshed
2026-05-28):

> *"The pattern is recursive: once one axis consolidates (e.g. body
> model), the next finer axis becomes breadth-able in turn (skin
> technique, then material approach, then gore treatment, then
> accessory style, etc.). Each loop is: sample breadth on the current
> finest open axis → evaluate side-by-side in the showroom →
> consolidate → reveal the next finer axis."*

Round 5 sampled breadth on the body axis. Round 6 built the showroom
and consolidated scale. Round 7 consolidates body and samples breadth
on the skin axis (and the corpse axis as a parallel decoupled
breadth). Round 8 will consolidate skin technique and reveal the next
finer axis — probable candidates: weapons/armor R&D (now their own
isolated breadth pass), accessory style, or shader-detail tier
(specular workflows, anisotropic, subsurface scattering, etc.).

§13 cross-link: "slick is pipeline" is operationalised by the 8 skin
techniques explicitly probing the pipeline's material/shader/decal
vocabulary; "gore intensity is loud by design" is operationalised by
the 8 gore variations leaning extreme/gruesome per user direction.

The Showroom remains the curator's diagnostic surface (§10's
*"Breadth needs a dedicated viewing surface"*); the user is the
building agent for the curation loop; the Showroom is their
introspection tool, not a player-facing surface and not the
consumer-render era.

---

*This spec is the binding contract for Round-7 implementation.
Engineer treats the §3.5/§3.6 technique tables as ratified defaults;
swaps require closing-readout justification. The no-UAT discipline is
HARD CONSTRAINT per Round-4/5/6 D4. All §6 success criteria must hold
at closing.*

---

## 10. Amendments (post-plan-review, binding overrides)

These amendments override the earlier sections at the cited points.
They were ratified by 🧭NavigatorPM after the plan-review round
(2026-05-28) and are themselves part of the binding contract.

### A1. No variant-GLB fallback for sprinter dismemberment (overrides §3.4.3 lines 432-440, §3.6 lines 593-597)

The North Star (success criterion 5) and §6 success criterion 5
require a **single shared mesh2motion corpse body**. A second baked
`variant_glb` for sprinter violates that consolidation.

**Binding:** `dismemberment_baked` is restricted to **shared-body-only**
methods:
- Primary: hide bone-attached MeshInstance3D children on the shared
  skeleton (e.g. hide `leg_l` mesh node).
- Secondary: bone scale collapse (set bone scale to near-zero so the
  attached mesh collapses).
- Decal supplement: stump/gore decal at the hide point per §A5
  projected-mark fallback.

If WP-C R&D dev-discovery shows that NO shared-body-only method yields
a convincing dismemberment effect on the mesh2motion skeleton (visible
geometry holes, bone-mesh association unclear, etc.), engineer must
**swap sprinter to a different distinct gore approach** (e.g.
`severed_torso_mesh_split` if implementable; or pick from gore
candidate space not yet used by the other 7), preserve the
8-distinct-approach invariant, and document the swap + reason in the
closing readout. **Authoring a second corpse GLB requires
PM/user escalation** — do not ship one without it.

`corpse.params` shape for `dismemberment_baked` collapses to:
```jsonc
{ "method": "bone_hide",
  "hideBones": ["leg_l", "forearm_r"],
  "stumpDecals": [ /* projected-mark spec per A5 */ ] }
```
The `variant_glb` method enum value is removed.

### A2. Multi-site dispatch coverage for `_apply_persona_palette` (overrides §3.4.1 line 320-341 and WP-B success criteria)

`_apply_persona_palette` is currently called from **three** sites in
`EquipmentMeshAttachment.gd`, not one:
- Line 127 (inside `register_character`, initial skin apply)
- Line 383 (inside `_swap_armour`, unequip path)
- Line 387 (inside `_swap_armour`, equip path)

**Binding:** WP-B must replace **all three** call sites to dispatch
through `_apply_persona_skin(character_id, armour_tier)`. If only the
register-character site is updated, the other two would silently
regress non-palette skins back to `_apply_persona_palette` on every
armour swap. The §A6 structural assertions must verify no remaining
`_apply_persona_palette` callers exist after WP-B (rename the function
body to `_apply_skin_palette_flat` and call sites become
`_apply_persona_skin`).

### A3. Scaffold-verify token + assertion updates (overrides §3.x scaffold-verify references and WP-A scaffold-verify scope)

`verify-scaffold.mjs` currently asserts the literal token
`_apply_persona_palette` (line 339) and (per review A) hard-asserts
per-asset character `sourceKey` distinctness which inverts after
consolidation.

**Binding:** WP-A scaffold-verify amendment list:
- Drop the literal `_apply_persona_palette` token (line 339).
- Add tokens: `_apply_persona_skin`, `_apply_skin_palette_flat`,
  `_apply_skin_pbr_texture`, `_apply_skin_pattern_texture`,
  `_apply_skin_decal_stickers`, `_apply_skin_toon_cel`,
  `_apply_skin_emissive_trim`, `_apply_skin_multi_material`,
  `_apply_skin_rim_fresnel`.
- Add tokens (corpse dispatch): `_apply_persona_corpse_skin`,
  `_apply_corpse_blood_saturation`, `_apply_corpse_wound_decals`,
  `_apply_corpse_gore_pool`, `_apply_corpse_charred`,
  `_apply_corpse_exposed_bone`, `_apply_corpse_viscera`,
  `_apply_corpse_dismemberment`, `_apply_corpse_decay`.
- Add tokens: `instantiate_persona_corpse`,
  `apply_corpse_skin_to_live_character`,
  `restore_persona_skin_to_live_character` (per §A8).
- Drop per-asset `file` / `modelScaleMultiplier` / `attachBone` /
  `animation` / `sourceKey` / `sha256` / `sizeBytes` assertions on
  character entries; reroute these to root `manifest.body` and
  `manifest.corpseBody`.
- Add: `assert(manifest.body.sourceKey === "mesh2motion")`.
- Add: `assert(manifest.body.file.includes("camper-mesh2motion-human-base.glb"))`.
- Add: 8 distinct `skin.approach` values + 8 distinct
  `corpse.approach` values.
- Add: per-persona path-validity for every nested shader/texture/decal
  path in `skin.params` and `corpse.params` (per §A7).

### A4. Audit wiring into package.json test script (overrides §3.2 and §5 WP-A success criteria)

`throwaway-prototypes/d-full-match/package.json:7` currently runs only
`verify-scaffold.mjs` and (GODOT_BIN-gated) `audit-character-scales.gd`.
The Round-7 new audits will be skipped unless explicitly wired.

**Binding:** WP-A updates the `test` script to chain (all under the
same `if [ -n "$GODOT_BIN" ]` gate already present):
1. `audit-character-scales.gd` (existing, retained)
2. `audit-mesh2motion-clips.gd` (new — clip + bone coverage)
3. `verify-character-rigs.gd` (extended — per-persona rig + skin + corpse load smoke)
4. `audit-replay-load.gd` (new — replay-path structural smoke per §3.8)

Scaffold-verify additionally asserts the `test` script string contains
each of the new audit basenames (so a future engineer cannot remove
them silently).

### A5. Decal + WebGL2 Compatibility fallback (overrides §3.4.1 line 358-365 and §3.5/§3.6 decal entries)

Round-5 closing readout (`round-5-closing-readout.md:50-52`) confirms
Godot `Decal` was **NOT** used for the web-export pass; the active
fallback was `QuadMesh` flat-projected with alpha-blended texture.
Round-7's decal-heavy techniques (opportunist `decal_stickers`; gore
wound_cluster / gore_pool / exposed_bone / viscera) must not assume
`Decal` works on Compatibility/WebGL2.

**Binding:** WP-B/WP-C implement a shared helper:
```gdscript
func _apply_projected_mark(parent: Node3D, mark_spec: Dictionary) -> Node3D:
    # Primary path: Godot Decal node (forward renderer only).
    # Fallback path: QuadMesh on a MeshInstance3D with alpha-blended StandardMaterial3D.
    # Choice driven by ProjectSettings.get_setting("rendering/renderer/rendering_method")
    # or a runtime flag; QuadMesh fallback is the active path for the web-export Compatibility renderer.
```
- For **body-attached** marks (skin decal_stickers, gore wound cluster,
  exposed bone, viscera): QuadMesh parented under the character's
  `visual` root at character-local offsets — no skeleton deformation
  (acceptable for breadth R&D; visible distinctness is what matters).
- For **floor-projected** marks (gore_pool_decal): QuadMesh flat on
  the floor verbatim from the Round-5 pattern (which is already
  validated working).
- The closing readout states which path (`Decal` or `QuadMesh`) is
  active in the web export.
- Scaffold-verify asserts both code paths exist in
  `EquipmentMeshAttachment.gd` (string tokens `Decal.new(`, `QuadMesh.new(`
  and `_apply_projected_mark`).

### A6. No-UAT wording — structural assertions replace "dev-preview" gates (overrides §5 WP-B/WP-C success criteria lines 941-942, 990-991)

Phrases like "verifiable by engineer via dev-preview" conflict with
the assignment's no-UAT discipline. Visual UAT is a **user activity
after closing**, not an implementation gate.

**Binding:** the WP-B/WP-C success criteria reword as follows.

WP-B skin distinctness:
- ~~"7 R&D techniques produce visually distinct materials/decals
  (verifiable by engineer via dev-preview, not by automated UAT)"~~
- **Replace with:** "For each of 8 personas, the
  `_apply_skin_<approach>` invocation recorded in
  `last_applied_skin_approach[character_id]` matches the persona's
  `manifest.assets[i].skin.approach`; shader compiles produce no
  GDScript script errors during the
  `verify-character-rigs.gd`-extended smoke; resource paths in
  `skin.params` all resolve via `ResourceLoader.exists()`."
- **Visual distinctness is a user-UAT outcome.** Engineer does NOT
  perform a visual pre-validation. The user inspects the Showroom
  themselves and picks the winning technique.

WP-C Showroom revert:
- ~~"Showroom Idle/Walk/etc. triggers correctly revert the live
  character to the `skin` approach (verifiable via dev-preview)"~~
- **Replace with:** "Showroom non-death animation handlers
  (Idle/Walk/Attack/etc.) reference `restore_persona_skin_to_live_character`
  before `play_character_animation` (scaffold-verify token); the per-
  station `current_skin_mode` state field toggles to `\"skin\"` after a
  non-death trigger fires; structural assertion in
  `verify-character-rigs.gd` extension exercises the
  death→idle→death cycle and confirms decal/material-override children
  are added then cleared then re-added without script errors."

### A7. Resource path normalization (overrides §3.4.1 line 368, §3.5 lines 500-526, §3.5 lines 529-532)

The spec carries two inconsistent shader path conventions:
- Line 368: `res://shared-harness/shaders/<approach>.gdshader`
- Lines 529-532 + 906-907: `shared-harness/art-kit/shaders/`

**Binding:** ALL nested shader/texture/decal paths in `skin.params`
and `corpse.params` are **art-kit-relative** (no leading slash,
no `res://`). EquipmentMeshAttachment resolves via the existing
`ART_ROOT` constant.

Example resolutions:
- `skin.params.shader = "shaders/toon_cel.gdshader"` →
  loaded at `res://shared-harness/art-kit/shaders/toon_cel.gdshader`
- `skin.params.albedo = "textures/skin/duelist-pbr-albedo.png"` →
  loaded at `res://shared-harness/art-kit/textures/skin/duelist-pbr-albedo.png`

Authored shader files live at
`throwaway-prototypes/d-full-match/shared-harness/art-kit/shaders/`.
Authored texture files live at
`throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/`
and `.../textures/gore/`.

Scaffold-verify adds path-validity checks (recursive walk over
`skin.params` and `corpse.params` for any field whose name ends in
`.png`/`.gdshader` or whose value matches a file-extension pattern;
assert each resolved path exists on disk).

### A8. Showroom skin reversion mechanism (overrides §3.7 Option A)

§3.7 Option A says "When the user clicks Idle... the live character's
skin reverts" but leaves the mechanism unspecified.

**Binding:**
- New method:
  ```gdscript
  func restore_persona_skin_to_live_character(character_id: String) -> void:
      # 1. Clear corpse-skin children (decals/material-overrides added by
      #    apply_corpse_skin_to_live_character).
      # 2. Re-invoke _apply_persona_skin(character_id, current_armour_tier).
      # 3. Set per-station current_skin_mode to "skin".
  ```
- Showroom per-station state field: `current_skin_mode: "skin" | "corpse"`.
- Every **non-death** Showroom animation trigger handler
  (`_trigger_animation("idle" | "walk" | "attack" | "attack_unarmed" | "attack_armed" | "take_hit" | "loot")`)
  checks `current_skin_mode == "corpse"` and if so calls
  `restore_persona_skin_to_live_character(showroom_id)` BEFORE
  `play_character_animation(...)`. Skips the call (no-op) if already in
  `"skin"` mode.
- The **death** trigger handler keeps Option A behaviour: calls
  `apply_corpse_skin_to_live_character(showroom_id)` after
  `play_character_animation(..., "death")` and sets
  `current_skin_mode = "corpse"`.
- Scaffold-verify asserts both `restore_persona_skin_to_live_character`
  and `apply_corpse_skin_to_live_character` tokens exist and are
  referenced in `Showroom.gd`.

### A9. Replay fixture source (overrides §3.8 and Q6)

`apps/replay/__fixtures__/` does **not** exist (Q6 Option (a) is
invalid). Override Q6 resolution:

**Binding:**
- **Primary fixture source:**
  `throwaway-prototypes/shared-harness/replay-snapshot.json` if
  present and structurally compatible (engineer verifies during A8).
- **Fallback:** hand-roll a minimal inline snapshot inside
  `audit-replay-load.gd` — a few characters across 2-3 turns including
  at least one death so the corpse pipeline gets exercised.
- The audit script header comment states which fixture is in use.

### A10. Per-asset `sourceKey` removal (overrides §3.1.2 overview line 115)

Line 115 says per-asset entries collapse to
`{personaSlot, sourceKey, skin, accessories?, corpse, notes}`, but the
detailed shape at lines 222-237 correctly removes `sourceKey`.

**Binding:** the overview is corrected — per-asset shape is
`{personaSlot, skin, accessories?, corpse, notes}` only. Single
`manifest.body.sourceKey = "mesh2motion"` on the root body block.

### A11. Armour scope clarification (overrides §3.1.3 lines 241-245 and §6 line 1034-1035)

Round-5 armour is a **material-swap** on body meshes (no separately
attached mesh). The `armourAttachBone` field is preserved on
`manifest.body` for forward-compat but is **not consumed** by Round-7
code.

**Binding:**
- WP-A verifies weapon socket attaches at `body.attachBone = "hand_r"`.
- WP-A keeps `body.armourAttachBone = "spine"` as a reserved field;
  adds no new code that reads it. Closing readout states "armour
  pipeline unchanged from Round-5 (material-swap on body meshes)".
- §6 success criterion 8 remains satisfied: weapons at `hand_r` work
  post-consolidation, armour material-swap preserved per Round-5
  contract.

### A12. Deep-duplicate body block on load (recommendation from Review A D1 ratification)

To avoid per-character runtime state mutating the root body defaults,
`_load_manifest` MUST deep-duplicate `manifest.body` (and
`manifest.corpseBody`) before merging persona-distinct fields into the
per-character asset dict:
```gdscript
var character_asset := manifest.body.duplicate(true)
character_asset.merge(per_asset_entry, true)
# per-character mutations now stay isolated
```

### Amendments digest

| # | Severity sourced | Spec section overridden | Net effect |
|---|---|---|---|
| A1 | Review B High | §3.4.3, §3.6 dismemberment | No variant_glb; shared-body-only |
| A2 | Review A High H2 | §3.4.1 dispatch | All 3 palette call sites must dispatch |
| A3 | Review A High H1 | scaffold-verify scope | Token + assertion set updated for post-consolidation shape |
| A4 | Review B Medium | §3.2, WP-A | New audits wired into package.json test |
| A5 | Review B Medium | §3.4.1, §3.5/§3.6 | Decal + QuadMesh fallback helper |
| A6 | Review B Medium | §5 success criteria | Dev-preview gates → structural assertions |
| A7 | Review B Medium | §3.4.1, §3.5 | Art-kit-relative paths via ART_ROOT |
| A8 | Review A Medium M3, Review C Low | §3.7 Option A | Concrete revert mechanism + state field |
| A9 | Review A Medium M2 | §3.8, Q6 | Primary = shared-harness snapshot; fallback inline |
| A10 | Review A Low, Review B Low | §3.1.2 line 115 | Drop `sourceKey` from per-asset overview |
| A11 | Review B Low | §3.1.3, §6 cr 8 | Armour stays material-swap; `armourAttachBone` reserved |
| A12 | Review A D1 ratification | §3.1 / _load_manifest | Deep-duplicate body block before per-character merge |

All amendments are in scope for the single WP-A→WP-B→WP-C implementation
sequence; none require user/PM escalation unless A1 triggers the
"swap sprinter technique" branch, in which case engineer documents the
swap in the closing readout (within ratified spec freedom).
