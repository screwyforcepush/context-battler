# Round-6 Showroom Spec — Curator's Showroom + Per-Persona Scale Calibration

> **Status: PLANNED** — follow-up to Round 5
> ([`round-5-spectacle-spec.md`](./round-5-spectacle-spec.md),
> [`round-5-closing-readout.md`](./round-5-closing-readout.md)).
> Pre-§10-gate R&D probe. Default posture: **all changes confined to
> `throwaway-prototypes/d-full-match/`**. No Convex contract change.
> No snapshot schema bump. No HTTP traffic. Manifest is throwaway-local
> and may bump within the prototype.

⭐ **North Star** ⭐ — Add a **Showroom** mode to the d-full-match
Godot prototype: a side-by-side asset/anim comparison surface that
displays all 8 personas with sample environment (wall, cover, floor),
animation trigger buttons (idle, walk, attack unarmed, attack armed,
loot, take hit, death), and equipment tier selectors (weapon
none/low/mid/high, armor none/low/mid/high) that fire across all 8
characters simultaneously. The showroom is the user's R&D curation
surface for the breadth-sample landed in Round 5 — chasing comparison
moments in replay scrubs does not scale once breadth is wide.

Also fix the **per-persona scale inconsistency** flagged in Round-5
UAT (camper, paranoid, sprinter appear ~half-size of the others)
caused by a uniform `CHARACTER_MODEL_SCALE` applied to GLBs with
different intrinsic dimensions. Fix: per-asset
`modelScaleMultiplier` on character manifest entries, calibrated so
all 8 sit in roughly the same apparent-height band. Fix applies to
**both** the Showroom AND the existing replay path (shared manifest).

🚫 **BLIND ASSIGNMENT** — No browsertools, no chromium, no
screenshots, no visual UAT, no `uat` job, no headless visual checks.
Round 4/5 D4 discipline is a hard constraint. Reviewers operate on
code + scaffold-verify + closing readout. The user performs visual
UAT themselves after assignment closure.

---

## 1. Purpose

Mental-model §10 just landed a new bullet — *"Breadth needs a
dedicated viewing surface"* — codifying that once breadth-sampling is
wide (8 personas × N animation states × M equipment tiers), the user
**cannot reliably curate by waiting for the right moment to surface
in a replay scrub**. A controlled comparison surface is required.

Two outcomes, each independently testable, neither sufficient alone:

1. **Showroom — curator's diagnostic surface (§10 new bullet).** A
   playpen scene that displays every sampled asset side-by-side and
   lets the user fire any animation state or equipment tier on every
   persona simultaneously. The user *is* the building agent for the
   asset/pack/material curation loop (§10 "diagnostics target
   building agents first") — the showroom is *their* introspection
   tool. NOT player-facing. NOT the consumer-render era.

2. **Per-persona scale calibration (§13 honest substrate).** The
   uniform `CHARACTER_MODEL_SCALE := 0.21` at `EntityRenderer.gd:3`
   applied at `EntityRenderer.gd:673` produces inconsistent
   apparent-heights because different source packs ship at different
   intrinsic GLB dimensions. Camper, paranoid, and sprinter were
   flagged in Round-5 UAT as ~half the size of the others. Fix is a
   per-asset multiplier on the manifest, audited across all 8
   personas, applied at instance time. **Must land in the same round
   as the showroom** because the showroom — displaying inconsistent
   scale side-by-side — would otherwise defeat its own purpose.

Decision filter (§7): does this make prompt-authored behaviour more
*legible* or more *shareable*? Indirect-yes:
- The Showroom is a *curation tool*, not a player surface; it enables
  the building agent (the user) to pick a direction for the
  consumer-render era. Behaviour legibility downstream is what it
  improves.
- Scale calibration is honest-substrate hygiene — characters at half
  the intended size misread silhouette comparisons and obscure
  attribution in replay just as much as in the showroom.

---

## 2. Overview

Two work packages, both throwaway by default:

| WP | Scope | Throwaway? |
|---|---|---|
| **WP-A** | Per-asset `modelScaleMultiplier` on manifest character entries; EntityRenderer applies `CHARACTER_MODEL_SCALE * multiplier`; calibrate all 8 personas via headless AABB audit; verify existing replay path still reads correctly | **Throwaway** (manifest + renderer + scaffold-verify only) |
| **WP-B** | New `Showroom.tscn` scene + `Showroom.gd`; sample environment (wall + cover + floor) using Round-5 PBR materials via SceneBuilder; animation trigger button bar; equipment tier selectors; per-character `Label3D` showing persona name + sourceKey + currently-playing clip; free-orbit camera; back-to-home; home-screen entry point (Showroom button in MatchPicker that routes to Showroom.tscn); manifest may grow optional `animation.takeHit` / `animation.death` / `attack_unarmed` / `attack_armed` keys with documented fallbacks where source packs lack the clip | **Throwaway** |

Both WPs stay strictly inside `throwaway-prototypes/d-full-match/`.
The Round-5 scaffold-verify regression locks (forbidden tokens,
no-UAT artefacts, contract-shape assertions) remain in force.

---

## 3. Architecture Design

### 3.1 WP-A — Per-persona scale calibration

#### 3.1.1 Root-cause confirmation

`throwaway-prototypes/d-full-match/src/EntityRenderer.gd:3`:
```gdscript
const CHARACTER_MODEL_SCALE := 0.21
```
applied uniformly at `EntityRenderer.gd:673` in `_instance_or_capsule`:
```gdscript
visual.scale = Vector3.ONE * CHARACTER_MODEL_SCALE
```

Each character manifest entry already carries `pivotYOffset` per
asset, but **no per-asset scale field**. Because the 8 source packs
(KayKit, Robin Lamb, OpenGameArt-interglactic, Quaternius, GDQuest
Mannequiny, Mesh2Motion, XCVG, styloo) ship GLBs with different
intrinsic dimensions, multiplying them by the same `0.21` produces a
visibly inconsistent line-up — confirmed by user UAT (camper,
paranoid, sprinter ≈ half-size).

Round-5 scaffold-verify has a *hard* assertion that
`CHARACTER_MODEL_SCALE := 0.21` (see `verify-scaffold.mjs:209` —
`assertMatches(entityRenderer, /CHARACTER_MODEL_SCALE\s*:=\s*0\.21/, …)`).
That assertion **stays**. The base constant remains the persona-agnostic
unit; the multiplier rides on top.

#### 3.1.2 Manifest field

Each character asset entry gains a `modelScaleMultiplier: number`
field. Default `1.0` (no-op for personas already at the target
band). Per-persona deviations carry a one-line `notes` justification.

Example manifest entry shape:
```jsonc
{
  "id": "character.camper",
  "category": "character",
  "personaSlot": "camper",
  "sourceKey": "mesh2motion",
  "file": "characters/camper-mesh2motion-human-base.glb",
  "pivotYOffset": 0,
  "modelScaleMultiplier": 1.85,   // ← NEW (engineer-calibrated)
  "attachBone": "hand_r",
  "animation": { ... },
  ...
  "notes": "...; modelScaleMultiplier:1.85 to bring mesh2motion AABB into the persona-height band (~0.7 source units → ~1.3 source units)."
}
```

Engineer fills the actual multiplier per persona via the calibration
methodology below.

#### 3.1.3 Renderer application

`EntityRenderer._instance_or_capsule` reads the per-persona
multiplier from `EquipmentMeshAttachment` and applies:

```gdscript
var multiplier := equipment_attachment.scale_multiplier_for_persona(persona)
visual.scale = Vector3.ONE * CHARACTER_MODEL_SCALE * multiplier
```

The current `_instance_or_capsule` does not take `persona`; it
currently receives only `scene, label, material, pivot_y`. Two
acceptable refactors:

- **Pass persona through** — extend the signature to
  `_instance_or_capsule(scene, label, material, pivot_y, persona)`
  and have `_spawn_characters` pass it.
- **Extract to factory** — add
  `EquipmentMeshAttachment.instantiate_persona_character(persona, label, fallback_material) -> Node3D`
  that owns the scene-load + scale + pivot logic centrally;
  `_instance_or_capsule` becomes a thin delegate (or is replaced
  entirely). Showroom calls the same factory directly. **Preferred —
  single source of truth for character instantiation; honors the
  pillar-6 "fix the substrate, don't band-aid" principle.**

Either path is acceptable; engineer picks. The verify-scaffold
assertion is *"per-persona scale multiplier is read from manifest at
instance time"*, not the function name.

`EquipmentMeshAttachment` exposes a new public method:
```gdscript
func scale_multiplier_for_persona(persona: String) -> float:
    var asset: Dictionary = character_assets_by_persona.get(persona, {})
    var value := asset.get("modelScaleMultiplier", 1.0)
    return float(value) if (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) else 1.0
```

#### 3.1.4 Calibration methodology (no UAT, no browser)

**Deterministic, numerical, headless.** The engineer writes (or
extends `scripts/verify-character-rigs.gd` into)
`scripts/audit-character-scales.gd` that:

1. For each character manifest entry, loads the GLB scene under
   Godot `--headless`.
2. Walks the instantiated scene's `MeshInstance3D` descendants and
   computes their combined world-space AABB via `AABB.merge`,
   accounting for any local scale baked into the scene root (but
   NOT the renderer-side `CHARACTER_MODEL_SCALE`).
3. Reports `source_height = aabb.size.y` per persona.
4. Computes the **median source height** across all 8 personas as
   the calibration target. Median is robust against an outlier pack
   distorting the band.
5. Computes the per-persona multiplier:
   `multiplier = median_source_height / source_height`, clamped to
   `[0.4, 3.0]` to catch pathologically broken AABBs.
6. Prints the table for the engineer to commit into `manifest.json`:

   ```
   persona       source_h   multiplier   notes
   rat            X.XX       1.00        (within ±5% of median — left at 1.0)
   duelist        Y.YY       0.92
   trader         Z.ZZ       1.10
   ...
   ```

Engineer **commits the multipliers into the manifest** (not auto-
generated at runtime — manifest is the durable record). The audit
script can also be wired into scaffold-verify as a check rather than
an autogeneration step (see §3.1.5 below).

**Why median, not mean?** A single outlier pack with anomalous AABB
(e.g., a giant prop accidentally child of the character root) would
distort the mean and pull every other persona's multiplier into a
matching error. Median is invariant against single outliers.

**Why clamp `[0.4, 3.0]`?** A multiplier outside this band signals a
pack mismatch (e.g., the GLB was exported in centimetres instead of
metres, or includes an unintended root parent). The engineer
investigates and either re-extracts the asset or documents the
deviation in `notes`. Reviewers code-grep that no committed
multiplier exceeds the clamp.

**Apparent-height band assertion.** Once multipliers are committed,
scaffold-verify asserts that for every character entry:
- `modelScaleMultiplier` is a number in `[0.4, 3.0]`.
- The product `aabb_source_height_y * modelScaleMultiplier` is
  within ±15% of the median such product across all 8 personas. (I.e.
  post-calibration apparent-heights fall in a tight band.)

The ±15% tolerance is the deterministic substitute for the user's
"no persona is markedly taller or shorter" visual judgement.

#### 3.1.5 Replay-path verification

The manifest is shared between Showroom and existing replay path.
**Scale fix must not regress the replay.** Verification:

- Reviewer code-traces that `EntityRenderer._spawn_characters` (or
  the new `instantiate_persona_character` factory if extracted) is
  the SOLE site reading `CHARACTER_MODEL_SCALE`. (`EntityRenderer`
  must not have a second path that hard-codes scale.)
- Scaffold-verify forbidden-token grep gains a check that
  `CHARACTER_MODEL_SCALE` appears in `EntityRenderer.gd` only as the
  base constant declaration and one or two reference sites — no
  literal `0.21` hardcodes elsewhere.
- Closing-readout notes confirm the engineer ran an existing
  recorded match (any match from harness output) end-to-end after
  calibration and code-traces that the persona heights changed as
  expected without regressing pivot-Y / heading / movement
  interpolation logic.

The "run an existing match end-to-end" verification is **code-trace
and snapshot-load**, not browser UAT — the engineer confirms
deterministically that the renderer initializes without error,
character instances spawn, and per-persona multipliers were read
from the manifest. The user does the visual confirmation themselves
in their own UAT pass after closure.

### 3.2 WP-B — Showroom scene + home-screen entry point

#### 3.2.1 Scene structure

New scene `throwaway-prototypes/d-full-match/scenes/Showroom.tscn`
with root `Node3D` driving `src/Showroom.gd`. Node tree:

```
Showroom (Node3D, script: Showroom.gd)
├── SceneBuilder (Node3D)            — reuse src/SceneBuilder.gd unchanged
├── EquipmentMeshAttachment (Node)   — reuse src/EquipmentMeshAttachment.gd unchanged
├── CameraRig (Node3D)               — reuse src/CameraRig.gd in MODE_FREE
├── PersonaStations (Node3D)         — 8 Node3D children, one per persona, placed in a row
├── EnvironmentSample (Node3D)       — wall + cover + floor sample placed visibly in scene
└── UI (CanvasLayer)
    ├── BackButton              — top-left, "Back" → MatchPicker.tscn
    ├── TitleLabel              — "Showroom — 8 personas, all sourced from Round-5 manifest"
    ├── AnimationTriggerBar     — HBoxContainer with 7 buttons
    └── EquipmentTierBar        — VBoxContainer of 2 HBox rows: Weapon {None, Low, Mid, High}, Armor {None, Low, Mid, High}
```

`Showroom.gd` is the orchestrator. On `_ready`:

1. Sets clear color (cyberpunk dark, matches MatchPicker).
2. Instantiates `EquipmentMeshAttachment`, calls its `configure({})`
   so it loads the manifest.
3. Builds a synthetic minimal `snapshot.map` dictionary (see §3.2.4)
   and calls `scene_builder.build_from_snapshot(synthetic_snapshot)`
   to wire the Round-5 PBR materials onto floor/walls/cover/evac
   geometry. The "sample environment" the user can inspect is
   exactly the same geometry pipeline that a real match would
   produce, just with a one-wall, one-cover minimal layout.
4. For each of the 8 personas in
   `["rat","duelist","trader","opportunist","paranoid","camper","sprinter","vulture"]`:
   - Instantiates the character via
     `equipment_attachment.instantiate_persona_character(persona, label, fallback_material)`
     (the WP-A factory) — single source of truth shared with the
     replay path.
   - Positions it in a row along the X axis with a fixed spacing
     (e.g., `Vector3(i * 1.6 - 5.6, 0.0, 0.0)` for an 8-character
     row centered on origin).
   - Adds two `Label3D` children above the character head:
     - `NameLabel` shows `"<persona>\n<sourceKey>"`.
     - `ClipLabel` shows the currently-playing animation clip name
       (updated each `_process` from the character's
       `AnimationPlayer.current_animation`). When the
       `AnimationPlayer` isn't playing, shows `"-idle (default)-"`.
   - Calls `equipment_attachment.register_character(showroom_id,
     character_node, persona)` with a synthetic showroom ID
     (`"showroom-<persona>"`) so the attachment can drive equipment
     and animation clips on this character via the same code path
     the replay uses.
5. Configures the CameraRig in `MODE_FREE` with `free_anchor` at the
   centerpoint of the row (e.g., `Vector3(0.0, 0.5, 0.0)`). Pass a
   synthetic snapshot `{"characters": []}` and `entity_renderer=null`
   — CameraRig's `_anchor_world()` already guards null and
   `cycle_anchor` becomes a no-op with an empty character list. The
   user can orbit (left-drag), pan (right-drag), and zoom (wheel)
   freely. Anchored mode and `[`/`]` anchor cycling are
   intentionally unused.
6. Wires the UI buttons (see §3.2.2, §3.2.3, §3.2.5).

`Showroom.gd` does NOT use `EntityRenderer`, `PlaybackClock`, or any
match-snapshot-driven plumbing. The Showroom is a static stage; it
fires animation/equipment events on user input, not on a clock.

#### 3.2.2 Animation trigger button bar — event synthesis

7 buttons in an `HBoxContainer`, each calling
`_trigger_animation(kind: String)`:

| Button label | `kind` arg | Notes |
|---|---|---|
| Idle | `"idle"` | Loops; default state |
| Walk | `"walk"` | Loops |
| Attack (unarmed) | `"attack_unarmed"` | Loops if pack supports; otherwise plays once and rests in idle |
| Attack (armed) | `"attack_armed"` | Same; depends on weapon-tier selection |
| Loot | `"loot"` | Plays once or loops per pack |
| Take hit | `"take_hit"` | Plays once and rests in idle |
| Death | `"death"` | Plays once and **holds end pose** so user can inspect |

`_trigger_animation(kind)` iterates all 8 showroom character IDs and
calls `equipment_attachment.play_character_animation(showroom_id, kind)`.
That call already exists from Round 5 — the only extension is teaching
`EquipmentMeshAttachment.clip_name_for_character(character_id, kind)`
to resolve the new clip-kind keys with the fallback chains in §3.2.3.

**Animation-clip event synthesis directly bypasses the snapshot/
MatchPlayer turn loop.** No `PlaybackClock`, no `update_to_turn`, no
`ACTION_PHASE_START` gating. The Showroom is event-driven on user
input. Clips loop or hold their end pose per the engineer's
`AnimationPlayer.play(clip, ...)` arguments — for Idle/Walk, set
loop mode on; for Death, set loop mode off and let the player hold
the last frame. Round-5's `play_character_clip` already restarts the
clip only when the character's `currentClip` changes, so re-clicking
the same button doesn't reset the playhead disruptively.

**Edge — Death pose hold.** Godot 4 `AnimationPlayer.play(name)`
respects each clip's authored loop mode by default. If the source
pack's death clip is authored as looping, the Showroom code force-
overrides `animation.loop_mode = ANIMATION_LOOP_NONE` before
playing. Engineer applies this override only for `death` and only at
play time, not by mutating the cached AnimationLibrary.

#### 3.2.3 Manifest extension for new clip kinds + fallback chain

Round-5 manifest character entries carry:
```jsonc
"animation": {
  "idle":   "Idle",
  "walk":   "Walking_A",
  "attack": "Dualwield_Melee_Attack_Chop",
  "loot":   "PickUp"
}
```

Round 6 extends to (optional keys, additive — no breaking changes):
```jsonc
"animation": {
  "idle":            "...",
  "walk":            "...",
  "attack":          "...",                  // existing — fallback for both armed/unarmed
  "attack_unarmed":  "...",                  // NEW optional
  "attack_armed":    "...",                  // NEW optional
  "loot":            "...",
  "take_hit":        "...",                  // NEW optional
  "death":           "...",                  // NEW optional
  "generic":         "..."
}
```

`EquipmentMeshAttachment.clip_name_for_character(character_id, kind)`
gains fallback chains:

| Requested kind | Fallback chain (first non-empty wins) |
|---|---|
| `attack_armed` | `attack_armed` → `attack` → `generic` → `""` (no-op) |
| `attack_unarmed` | `attack_unarmed` → `attack` → `generic` → `""` |
| `take_hit` | `take_hit` → `generic` → `idle` |
| `death` | `death` → `take_hit` → `generic` → `idle` |
| (Other kinds unchanged — `idle`, `walk`, `attack`, `loot` already exist.) |

When a fallback fires (the requested kind resolved to a fallback
rather than the direct match), the Showroom's per-character
`ClipLabel` shows the resolved clip with a tag, e.g.
`"PickUp (loot via fallback)"`, so the user can see at a glance
which packs lack a dedicated clip. This is the **curator-diagnostic**
signal §10 calls for.

**Audit step (engineer task).** The engineer runs the headless
`verify-character-rigs.gd` extended to enumerate ALL clips present
in each character's `AnimationPlayer` and prints the per-pack
inventory. From that inventory, the engineer fills in the new
manifest keys (`take_hit`, `death`, `attack_unarmed`, `attack_armed`)
where the source pack ships an obvious match, and leaves them
unspecified where it doesn't — the fallback chain handles the rest.

The optional keys do NOT change existing scaffold-verify assertions
on `idle`/`walk`/`attack`/`loot|generic` — those remain mandatory.
Optional keys are *only* asserted if present (must be non-empty
strings).

#### 3.2.4 Sample environment — synthetic minimal snapshot

`SceneBuilder.build_from_snapshot` already knows how to render
`walls`, `coverClusters`, `evac`, and `airdrops` from a snapshot's
`map` block. The Showroom synthesizes a minimal map:

```gdscript
var synthetic_snapshot := {
    "map": {
        "size": {"w": 14, "h": 8},
        "walls": [
            {"x": 0, "y": 0, "w": 14, "h": 1}     # back wall behind the row
        ],
        "coverClusters": [
            {"x": 6, "y": 4, "w": 2, "h": 1}      # one cover piece in front-centre
        ],
        "evac": {
            "zone": {"x": -50, "y": -50, "w": 1, "h": 1}  # off-stage; rendered but unobtrusive
        },
        "airdrops": []
    }
}
scene_builder.build_from_snapshot(synthetic_snapshot)
```

Outcome: a textured-PBR floor patch, a back wall, and a cover
piece — using the **exact same materials** the replay uses
(`mat_ground`, `mat_wall`, `mat_cover`, `mat_evac`). Reusing
SceneBuilder honors the "single source of truth" constraint — the
showroom sample is the same surface treatment the user is curating
against.

Engineer-tunable layout dimensions; the above is one viable shape.
The cucumber requirement is "at least one wall segment, one cover
piece, and a floor patch" — anything matching that bar is acceptable.

#### 3.2.5 Equipment tier selector — event synthesis

Two `HBoxContainer` rows in a `VBoxContainer`:

- **Weapon row:** 4 buttons — `None`, `Low`, `Mid`, `High`
- **Armor row:** 4 buttons — `None`, `Low`, `Mid`, `High`

State held in the Showroom script:
```gdscript
var current_weapon_tier: String = ""   # "" | "low" | "mid" | "high"
var current_armor_tier: String = ""    # "" | "low" | "mid" | "high"
```

Tier→manifest-asset mapping (engineer picks one representative
weapon/armour name per tier from the existing Round-5 manifest;
suggestions):

| Tier | Weapon (existing manifest name) | Armor (existing manifest name) |
|---|---|---|
| None | `""` | `""` |
| Low | `rusty_blade` (or `dagger`) | `cloth` (or `leather`) |
| Mid | `sword` (or `axe`) | `chain` |
| High | `greatsword` (or `warhammer`) | `plate` (or `riot_plate`) |

Button click flow:

```gdscript
func _apply_equipment() -> void:
    var equipped := {}
    for persona in PERSONAS:
        var showroom_id := "showroom-" + persona
        equipped[showroom_id] = {
            "weapon": _weapon_name_for_tier(current_weapon_tier),
            "armour": _armour_name_for_tier(current_armor_tier),
        }
    equipment_attachment.update_equipment(equipped)
```

`equipment_attachment.update_equipment` (Round-5 unchanged) handles
the weapon-mesh swap and armor material-change. The Showroom is a
pure consumer.

**Attack-clip selection by weapon state.** When the user clicks
"Attack (armed)" while `current_weapon_tier == ""`, the Showroom
still fires `kind="attack_armed"` and lets the fallback chain
resolve to `attack` — the button label is the **request**, not a
gated state. When the user clicks "Attack (unarmed)" while a weapon
IS equipped, same — fires `kind="attack_unarmed"`. (Mismatches are
diagnostic information for the user, not a bug.) Per-character
`ClipLabel` shows what clip actually resolved.

#### 3.2.6 Per-character active-clip label mechanism

`Label3D` (Godot 4 built-in 3D billboarded label) above each
character:

- `pixel_size = 0.005` (small enough to not overlap neighbours)
- `billboard = BaseMaterial3D.BILLBOARD_ENABLED`
- `no_depth_test = true` (always visible above geometry)
- `outline_size = 6` (readable over textured floor)

Two stacked labels per persona station:
- **NameLabel** (top, larger): `"camper\nmesh2motion"`
- **ClipLabel** (below): `"Idle"` or `"PickUp (loot via fallback)"`

`Showroom._process`:
```gdscript
func _process(_delta: float) -> void:
    for persona in PERSONAS:
        var showroom_id := "showroom-" + persona
        var character_dict: Dictionary = equipment_attachment.registered_characters.get(showroom_id, {})
        var player := character_dict.get("animationPlayer") as AnimationPlayer
        var clip_label: Label3D = clip_labels.get(showroom_id)
        if clip_label == null:
            continue
        if player != null and player.is_playing():
            clip_label.text = _clip_label_text(showroom_id, player.current_animation)
        else:
            clip_label.text = "(idle/none)"
```

`_clip_label_text` annotates with the fallback tag when the resolved
clip is the fallback rather than the direct match.

`registered_characters` is currently a script-private dictionary in
`EquipmentMeshAttachment`; add a public read-accessor
`EquipmentMeshAttachment.animation_state_for_character(character_id)
-> Dictionary` returning `{"clipName": "...", "isFallback": bool}`
rather than letting the Showroom poke private state directly.

#### 3.2.7 Free-orbit camera

Reuse `CameraRig` in `MODE_FREE`. Pass a synthetic snapshot
`{"characters": []}` to `CameraRig.configure` so `cycle_anchor`
becomes a no-op. `entity_renderer` argument can be `null` — the
existing `_anchor_world()` guards null.

The default Director radius (`26.0`) is fine for an 8-character row;
the engineer may tune the initial `pitch`/`yaw` so the user opens
into a wide-three-quarter view of the line-up.

The hard-coded `KEY_C` toggle (mode swap) and `KEY_BRACKETLEFT/
RIGHT` anchor cycling stay registered (no need to disable them) —
they're no-ops with the empty-character snapshot. The user simply
has no anchor to cycle to.

#### 3.2.8 Home-screen entry point

`scenes/MatchPicker.tscn` grows one new node: a `Button`
("Showroom") in the existing `Header` `HBoxContainer`, placed next
to (or replacing position with) the `RefreshButton`. Pattern in
`MatchPicker.gd`:

```gdscript
@onready var showroom_button: Button = %ShowroomButton
...
showroom_button.pressed.connect(_on_showroom_pressed)
...
func _on_showroom_pressed() -> void:
    get_tree().change_scene_to_file("res://scenes/Showroom.tscn")
```

`Showroom.gd._on_back_pressed`:
```gdscript
func _on_back_pressed() -> void:
    get_tree().change_scene_to_file("res://scenes/MatchPicker.tscn")
```

Also wire `KEY_ESCAPE` to back-to-MatchPicker (matches MatchPlayer's
existing pattern at `MatchPlayer.gd:36`).

**Why button, not tab?** A `TabContainer` requires the showroom 3D
viewport to live as a `SubViewport` child of a `Control`, which is
viable but adds plumbing (texture-rect display, input forwarding,
viewport sizing). A separate scene with a button is simpler, matches
the existing MatchPicker → MatchPlayer scene-swap pattern, and
preserves the Round-2 substrate decision that the home screen and
the 3D scene are separate `Control` and `Node3D` trees. Engineer may
upgrade to a tab post-WP-B if the user prefers — that's a UI tweak,
not an architecture change.

### 3.3 Out-of-scope (Round 6 hard constraints)

- ❌ No new character packs. Showroom uses the existing 8 Round-5
  manifest entries. Pack curation/swaps are a later round, gated on
  what the user decides from this Showroom evaluation.
- ❌ No Convex / production code changes. Convex schema, snapshot
  builder, replay endpoints, harness, eval pipeline — all untouched.
- ❌ No snapshot or HTTP traffic for the Showroom. The Showroom
  reads the manifest directly via `EquipmentMeshAttachment`; it
  does NOT invent a "showroom snapshot" format and does NOT hit
  `/replay/listMatches` or `/replay/exportMatch`.
- ❌ No new VFX / spectacle pipeline changes (blood, gore, decals,
  PBR). Showroom consumes Round-5 outputs unchanged.
- ❌ No browsertools, no chromium, no screenshots, no headless
  visual checks, no `uat` job. Round-4/5 D4 discipline.
- ❌ No pathing logic in renderer (forbidden tokens remain banned):
  `a_star`, `astar`, `find_path`, `bresenham`, `dijkstra`,
  `breadth_first_search`, `manual_collision`.
- ❌ No self-modeling — sourced/stylized assets only (§13).
- ❌ No mid-Showroom "spawn a new character" interactivity. The
  user *selects animation* and *equipment*; they do not edit the
  roster.
- ❌ No clip-name override UI. If a pack lacks a clip, the fallback
  chain handles it and the per-character ClipLabel surfaces the
  fallback — engineer does not build a "swap the camper attack clip
  to X" tool.

### 3.4 Documentation

- `throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md`
  updated by the closing-readout job: new section "Showroom mode",
  per-persona `modelScaleMultiplier` table, fallback-chain table
  for new clip kinds.
- `docs/project/phases/render-rnd/round-6-closing-readout.md`
  written by the closing-readout job at assignment end (mirrors
  Round-5 structure).
- `throwaway-prototypes/d-full-match/README.md` adds a "Showroom"
  one-paragraph callout pointing to the Showroom button in the home
  screen.
- Mental-model §10 already carries the "Breadth needs a dedicated
  viewing surface" principle (landed in Round-6 pre-dispatch). No
  further mental-model edits required from the engineer; if the
  engineer surfaces a substrate insight during implementation that
  belongs in §10 or §13, the closing readout flags it for PM/
  Outcome🧭Steward.

---

## 4. Dependency Map

```
        WP-A (scale calibration: manifest field + renderer apply + audit)
         │  small, isolatable; touches manifest + EntityRenderer +
         │  EquipmentMeshAttachment factory extraction
         ▼
    [unblocks]
         │
         ▼
        WP-B (Showroom scene + UI + home-screen entry point)
         │  largest WP; reuses WP-A's EquipmentMeshAttachment factory
         │  extraction for character instantiation;
         │  reuses SceneBuilder/CameraRig unchanged;
         │  manifest gains optional animation.takeHit/death/
         │  attack_unarmed/attack_armed keys
         ▼
        closing readout
```

- **WP-A is independent** in principle but **WP-B depends on WP-A's
  factory extraction** (`instantiate_persona_character`) for clean
  single-source-of-truth reuse. If the engineer chooses the
  pass-persona-through refactor instead of factory extraction, WP-B
  can still consume `scale_multiplier_for_persona` directly — but
  duplicates the scene-load + scale + pivot dance. **The factory
  approach is preferred.**
- **WP-A's calibration step (audit + commit multipliers)** must
  complete before WP-B is signed off, otherwise the Showroom
  displays the very inconsistency the user flagged and defeats its
  own purpose. (WP-B can be developed against `modelScaleMultiplier
  = 1.0` placeholders while the calibration runs in parallel; final
  values land before WP-B closes.)
- **Parallelisation opportunity:** scale audit + manifest
  multiplier commit (WP-A.2) is human-judgement-light (read median,
  write number) and can run in parallel with WP-B UI scaffolding
  for a multi-engineer scenario. Single-engineer dispatch sequences
  them as WP-A → WP-B.

**Practical dispatch shape recommendation** (single-engineer):
WP-A → WP-B as two sequential commits, each with its own
scaffold-verify pass.

---

## 5. Work Package Breakdown

### WP-A — Per-persona scale calibration *(throwaway)*

**Scope:**

1. **Factory extraction (recommended) — extract character
   instantiation into `EquipmentMeshAttachment`.**
   - Add public method
     `instantiate_persona_character(persona: String, label: String, fallback_material: Material) -> Node3D`
     that owns scene-load, scale, pivot-Y, fallback-capsule, and
     scale-multiplier application.
   - `EntityRenderer._spawn_characters` delegates to this factory.
   - Showroom will consume the same factory in WP-B.
   - Pillar-6 honoured: single source of truth for character
     instantiation; new round adds no asymmetric handling.
2. **Manifest field.**
   - Add `modelScaleMultiplier: number` to each of the 8 character
     entries. Engineer-calibrated values committed alongside.
   - Default 1.0 where calibration shows the persona is already at
     the median band.
   - Per-persona `notes` extended with a `modelScaleMultiplier:X.XX
     because <reason>` annotation where the value deviates from 1.0.
3. **Calibration audit script.**
   - Extend or fork `scripts/verify-character-rigs.gd` into
     `scripts/audit-character-scales.gd` (or in-place extension —
     engineer picks; the existing script's class is `SceneTree` so
     extending it is straightforward).
   - For each character, instantiate the GLB headless, walk
     `MeshInstance3D` descendants, compute combined AABB, report
     `source_height = aabb.size.y`.
   - Compute median across all 8; print the per-persona
     `multiplier = median / source_height`, clamped `[0.4, 3.0]`.
   - Print a table the engineer commits into `manifest.json`.
4. **Renderer wiring.**
   - `EquipmentMeshAttachment.scale_multiplier_for_persona(persona)
     -> float` reads manifest, defaults `1.0`.
   - `EntityRenderer._instance_or_capsule` (or the new factory)
     applies `CHARACTER_MODEL_SCALE * multiplier` at instance time.
   - `CHARACTER_MODEL_SCALE := 0.21` constant is **unchanged**
     (Round-5 scaffold-verify assertion stays passing).
5. **Replay-path verification.**
   - Code-trace that no second site in EntityRenderer hardcodes
     `0.21` or applies an independent scale.
   - Closing-readout records that the engineer code-loaded an
     existing harness-produced snapshot in `MatchPlayer` and
     verified the renderer initialized without error and read the
     multipliers per persona. (No browser, no screenshots — just
     deterministic load + log inspection.)
6. **Scaffold-verify update.**
   - Manifest schemaVersion: engineer's call to bump 3 → 4
     (preferred — POC posture, signal explicit) or hold at 3 (the
     field is additive). If bumped, `verify-scaffold.mjs:348`
     assertion follows. Throwaway-local; no production impact.
   - New assertions:
     - Each character entry has `modelScaleMultiplier` of type
       number, in `[0.4, 3.0]`.
     - `EntityRenderer.gd` references `scale_multiplier_for_persona`
       (or equivalent factory call) at the character-instance site.
     - `EquipmentMeshAttachment.gd` defines
       `scale_multiplier_for_persona`.
     - `EquipmentMeshAttachment.gd` defines the factory method (if
       the factory-extraction path is taken).
     - Optional: AABB post-calibration band check — every
       (aabb_source_height_y * multiplier) sits within ±15% of
       median.  Implementable as a separate scaffold step that runs
       the audit script and parses its output.
7. **Documentation.**
   - Closing readout records the calibration table (persona,
     source_height, multiplier, post-scale apparent height) and the
     replay-path verification code-trace.

**Success criteria:**
- ✅ Manifest character entries carry `modelScaleMultiplier` per
  entry; values are committed (not placeholder 1.0s where the
  audit script shows a deviation needed).
- ✅ Camper, paranoid, sprinter (and any other audit-flagged
  persona) have post-calibration apparent heights within ±15% of
  the median across all 8 personas. Asserted via scaffold-verify
  AABB check.
- ✅ `EntityRenderer` (or the new factory) reads the multiplier per
  persona and applies `CHARACTER_MODEL_SCALE * multiplier`.
- ✅ `CHARACTER_MODEL_SCALE := 0.21` base constant unchanged;
  Round-5 scaffold-verify assertion still passes.
- ✅ Replay path verified end-to-end against an existing snapshot
  via code-trace + load (no browser).
- ✅ Forbidden-token grep clean: `browsertools`, `chromium`,
  `screenshot`, `puppeteer`, `playwright`, `a_star`, `astar`,
  `find_path`, `bresenham`, `dijkstra`, `breadth_first_search`,
  `manual_collision`.
- ✅ `npm run lint` / `typecheck` / `build` / `test` clean.
- ✅ `npm --prefix throwaway-prototypes/d-full-match test` clean.
- ✅ Godot web export builds clean.
- ❌ Zero browsertools / chromium / visual UAT artefacts.

**Estimated reach:** 1 manifest edit (8 entries), 1-2 `.gd` files
modified (`EntityRenderer.gd`, `EquipmentMeshAttachment.gd`), 1
audit/verify script (new or extended), 1 scaffold-verify update.

---

### WP-B — Showroom scene + home-screen entry point *(throwaway)*

**Scope:**

1. **New scene + script.**
   - `scenes/Showroom.tscn` with node tree per §3.2.1.
   - `src/Showroom.gd` orchestrator script.
2. **Character row instantiation.**
   - 8 personas spawned via WP-A's factory
     (`equipment_attachment.instantiate_persona_character`),
     positioned along the X axis with deterministic spacing.
   - Per-character `register_character` call with synthetic
     `"showroom-<persona>"` IDs so the equipment/animation pipeline
     can address them.
3. **Sample environment.**
   - Synthetic minimal map dict per §3.2.4.
   - `SceneBuilder.build_from_snapshot(synthetic)` to render the
     wall/cover/floor with Round-5 PBR materials. No code change in
     SceneBuilder.
4. **Animation trigger button bar.**
   - HBoxContainer with 7 buttons (Idle, Walk, Attack (unarmed),
     Attack (armed), Loot, Take hit, Death).
   - Each calls
     `equipment_attachment.play_character_animation(showroom_id, kind)`
     across all 8 personas.
   - `EquipmentMeshAttachment.clip_name_for_character` extended
     with the §3.2.3 fallback chains for the new kinds.
5. **Manifest extension for new clip kinds.**
   - Add optional `animation.take_hit`, `animation.death`,
     `animation.attack_unarmed`, `animation.attack_armed` keys to
     character entries where the source pack ships a matching clip.
   - Engineer audits each pack's available clips via
     `verify-character-rigs.gd` (extended to print full inventory).
   - Where a pack lacks the clip, leave the manifest key out and
     rely on the fallback chain.
6. **Equipment tier selectors.**
   - VBoxContainer with two HBox rows (Weapon, Armor) of 4 buttons
     each.
   - State held in `Showroom.gd`; on any click, build the synthetic
     `equipped_by_character` dict (all 8 personas same tier) and
     call `equipment_attachment.update_equipment(equipped)`.
7. **Per-character active-clip label.**
   - Two `Label3D` children per persona station (NameLabel +
     ClipLabel), billboarded, no-depth-test, outlined.
   - `EquipmentMeshAttachment.animation_state_for_character` public
     accessor returns `{"clipName": "...", "isFallback": bool}`;
     Showroom polls per frame in `_process` and updates ClipLabel.
   - Fallback-resolved clips display with a `" (X via fallback)"`
     suffix.
8. **Free-orbit camera.**
   - `CameraRig.configure({"characters": []}, null, scene_builder,
     null)` with `mode = MODE_FREE` and `free_anchor =
     Vector3(0.0, 0.5, 0.0)`. Engineer tunes default pitch/yaw to
     present the row in a wide three-quarter view.
9. **Home-screen entry point.**
   - `scenes/MatchPicker.tscn` grows a `ShowroomButton` in the
     header HBoxContainer.
   - `MatchPicker.gd` wires the button to
     `change_scene_to_file("res://scenes/Showroom.tscn")`.
   - `Showroom.gd` has a `BackButton` and `KEY_ESCAPE` handler
     that returns to MatchPicker.tscn.
10. **Documentation.**
    - `IMPLEMENTATION-SUMMARY.md` gains a "Showroom mode" section.
    - `README.md` adds a Showroom callout.
    - Closing readout follows.
11. **Scaffold-verify update.**
    - `requiredFiles` extended with
      `scenes/Showroom.tscn` and `src/Showroom.gd`.
    - Assertions:
      - `MatchPicker.gd` references `Showroom.tscn` (transition
        target).
      - `Showroom.gd` references `MatchPicker.tscn` (back button
        target).
      - `Showroom.gd` references the 7 animation trigger kinds as
        string literals (`"idle"`, `"walk"`, `"attack_unarmed"`,
        `"attack_armed"`, `"loot"`, `"take_hit"`, `"death"`).
      - `Showroom.gd` calls
        `equipment_attachment.play_character_animation` and
        `equipment_attachment.update_equipment`.
      - `Showroom.gd` references `Label3D` for per-character
        labels.
      - `Showroom.gd` references the 8 persona slots as string
        literals.
      - `Showroom.gd` calls
        `scene_builder.build_from_snapshot` (sample env).
      - `Showroom.gd` calls `CameraRig.configure` in `MODE_FREE`
        only (no anchored-mode initialization).
      - `EquipmentMeshAttachment.gd` defines
        `animation_state_for_character` accessor.
      - `EquipmentMeshAttachment.gd` fallback chains documented in
        code: searches for `attack_armed` → `attack` and
        `attack_unarmed` → `attack` and `take_hit` → `generic` /
        `idle` and `death` → `take_hit` / `generic` / `idle`.
      - Forbidden-token grep on `src/Showroom.gd`:
        `browsertools`, `chromium`, `screenshot`, `puppeteer`,
        `playwright`, `a_star`, `astar`, `find_path`, `bresenham`,
        `dijkstra`, `breadth_first_search`, `manual_collision`.
    - `verify-character-rigs.gd` extended:
      - Optional manifest clip keys (`take_hit`, `death`,
        `attack_unarmed`, `attack_armed`), if present, must resolve
        to a real clip on the imported `AnimationPlayer`.
      - Per-pack full clip-inventory printed (so the engineer can
        re-run after each manifest edit to confirm clip names).

**Success criteria:**
- ✅ Home screen exposes a Showroom button; clicking it loads
  Showroom.tscn.
- ✅ Showroom instantiates all 8 personas via the Round-5 manifest
  pipeline through WP-A's factory; no duplicate character-loading
  code path.
- ✅ Per-character `NameLabel` shows persona name + sourceKey.
- ✅ Sample environment visible: ≥1 wall, ≥1 cover piece, floor —
  using Round-5 PBR materials via SceneBuilder.
- ✅ 7 animation trigger buttons fire across all 8 personas
  simultaneously.
- ✅ Each persona's currently-playing clip name is visible via
  `ClipLabel` Label3D; fallback-resolved clips marked with a
  fallback tag.
- ✅ Weapon tier selector {None, Low, Mid, High} swaps weapon
  meshes across all 8 personas via existing `update_equipment`.
- ✅ Armor tier selector {None, Low, Mid, High} drives the
  Round-5 material-change armor on all 8 personas (no
  separately-attached armor mesh appears — Round-5 contract
  preserved).
- ✅ Camera orbits, pans, zooms freely from any angle.
- ✅ Back button (and Esc) returns to MatchPicker.
- ✅ All changes inside `throwaway-prototypes/d-full-match/`. No
  Convex, no schema, no HTTP.
- ✅ Forbidden-token grep clean.
- ✅ Godot web export builds clean.
- ✅ `npm run lint` / `typecheck` / `build` / `test` clean.
- ✅ `npm --prefix throwaway-prototypes/d-full-match test` clean
  (extended scaffold passes).
- ✅ Godot headless rig-verify passes (new optional clip keys
  resolve where declared).
- ❌ Zero browsertools / chromium / visual UAT artefacts.

**Estimated reach:** 2 new scene files (`scenes/Showroom.tscn`,
`src/Showroom.gd`), 1 `.gd` file modified (`MatchPicker.gd`), 1 `.gd`
file extended (`EquipmentMeshAttachment.gd` — fallback chains +
`animation_state_for_character`), 1 manifest edit (optional clip
keys per persona where applicable), 1 scaffold-verify extension, 1
character-rig verifier extension.

---

## 6. Assignment-Level Success Criteria

All testable without browser-mediated visual UAT.

1. **Per-persona scale calibrated.** Every character entry in
   `manifest.json` carries `modelScaleMultiplier` in `[0.4, 3.0]`.
   Post-calibration AABB heights sit within ±15% of the median
   across all 8 personas (asserted in scaffold-verify or audit
   script). EntityRenderer reads the per-asset multiplier through
   a single factory call site.

2. **Showroom accessible.** Home-screen MatchPicker exposes a
   Showroom button. Clicking it transitions to a new
   `scenes/Showroom.tscn`. Back button / Esc returns to MatchPicker.

3. **8 personas instantiated via shared factory.** Showroom
   instantiates the 8 Round-5 personas through the same
   `EquipmentMeshAttachment.instantiate_persona_character` (or
   equivalent factory) that the replay path uses — single source of
   truth, no duplicate character-loading code.

4. **Sample environment present.** Showroom renders ≥1 wall, ≥1
   cover piece, and a floor patch through the existing
   `SceneBuilder.build_from_snapshot` pipeline with Round-5 PBR
   materials, via a synthetic minimal-map dict.

5. **7 animation trigger buttons** (Idle, Walk, Attack (unarmed),
   Attack (armed), Loot, Take hit, Death) fire across all 8
   personas via `play_character_animation` with the §3.2.3 fallback
   chain. Manifest optional keys `attack_unarmed`, `attack_armed`,
   `take_hit`, `death` populated where source packs ship matching
   clips.

6. **Per-character active-clip label** (Label3D) displays the
   currently-playing clip name per persona, with a fallback tag
   when the resolved clip came from the fallback chain rather than
   the direct manifest key.

7. **Equipment tier selectors.** Weapon {None, Low, Mid, High} and
   Armor {None, Low, Mid, High} buttons. Each selection synthesizes
   an `equipped_by_character` dictionary (all 8 personas, same
   tier) and calls `EquipmentMeshAttachment.update_equipment`
   unchanged from Round 5. Armor renders as material-change (Round-5
   contract); weapon as mesh-swap.

8. **Free-orbit camera.** CameraRig in `MODE_FREE` permits orbit +
   pan + zoom around the line-up. No anchor cycling required.

9. **Throwaway boundary preserved.** All changes inside
   `throwaway-prototypes/d-full-match/`. No Convex production code
   change. No HTTP traffic. No snapshot schema change.

10. **Validation suite clean** (run, all green):
    - `npm run lint`
    - `npm run typecheck`
    - `npm run build`
    - `npm test`
    - `npm --prefix throwaway-prototypes/d-full-match test`
    - `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match
      run build` (web export)
    - Forbidden-token grep clean across `src/*.gd`,
      `IMPLEMENTATION-SUMMARY.md`, scene files (`browsertools`,
      `chromium`, `screenshot`, `puppeteer`, `playwright`,
      `a_star`, `astar`, `find_path`, `bresenham`, `dijkstra`,
      `breadth_first_search`, `manual_collision`).

11. **No UAT artefacts.** Zero browsertools / chromium / screenshot
    / headless-visual-check tooling or output committed. Round-4/5
    D4 discipline preserved as a hard constraint.

---

## 7. Open Questions / Decisions Needed

These shape the *how*; engineer flags any uncertainty in
implementation notes.

1. **Manifest `schemaVersion` bump 3 → 4?** Field addition is
   additive; bump is signal-of-change, not technical necessity.
   Recommendation: **bump to 4**, POC-posture forward-only, scaffold
   assertion follows. Engineer's call if a stronger reason emerges
   to hold at 3.

2. **Factory extraction vs. pass-persona-through.** §3.1.3 lists
   both refactor shapes for centralising scale application.
   Recommendation: **factory extraction** for honest single-source-
   of-truth; engineer may pick pass-through if the diff stays small
   and is documented in WP-A closing notes.

3. **Tier-to-asset mapping for weapon/armor selectors.** §3.2.5
   suggests `rusty_blade/sword/greatsword` for Low/Mid/High weapon
   tiers and `cloth/chain/plate` for armor. Engineer can substitute
   any existing manifest weapon/armour as long as one representative
   per tier is picked and the choice is documented in the closing
   readout. (The selectors are a curation tool, not a content
   commitment — they need to map onto real existing assets and
   surface the tier ramp the user is curating against.)

4. **Death-clip hold behavior across packs.** Some source packs may
   author their death clips with loop mode on; some with hold-last-
   frame. §3.2.2 specifies the Showroom force-overrides
   `loop_mode = ANIMATION_LOOP_NONE` for `death` only. Engineer
   verifies headless that this override does not interfere with
   replay-path death rendering (the replay path doesn't currently
   fire death clips — it uses corpse swap — so this should be a
   no-op for replay, but worth code-tracing).

5. **Showroom layout — row vs. grid.** §3.2.1 suggests a single row
   along X axis with 1.6-unit spacing. 8 personas in a row at
   ~1.6 spacing = ~12 units wide, which the default Director-radius
   26 comfortably frames. Engineer picks row vs. grid; row is
   simpler and matches the user's "line up side by side" mental
   model. Either is acceptable as long as all 8 are
   simultaneously visible at the default camera framing.

6. **Should "Take hit" and "Death" trigger Round-5's existing
   gore/blood VFX?** Decision: **no.** The Showroom is a stable
   asset-comparison surface. Gore VFX would clutter the view, the
   blood pool would persist (cap 64) and bleed into the next take-
   hit click, and the user is curating animation+rig+material — not
   evaluating gore in isolation. The cucumber/north-star does NOT
   include gore in the trigger set. Gore stays on the replay path
   only. If the user later asks for "preview gore in the showroom,"
   that's a future round.

7. **Persona station spacing tied to multipliers?** A persona with
   `modelScaleMultiplier = 2.5` (if any) might be wider as well as
   taller, risking overlap with neighbours at fixed 1.6-unit
   spacing. Engineer either:
   - (a) Uses fixed spacing and accepts edge-case overlap as a
     curator-diagnostic signal ("this pack is anomalously wide —
     consider re-extracting"); OR
   - (b) Computes spacing per-persona from the AABB width × the
     multiplier and lays them out tightly.
   Recommendation: **(a) fixed spacing** — anomalous widths are
   themselves curation signal; the audit script's `[0.4, 3.0]`
   multiplier clamp already prevents extreme outliers.

8. **Should the Showroom support keyboard shortcuts for the
   triggers?** (e.g., `1`/`2`/`3`/... for the animation buttons.)
   Not required by the north star. Engineer may add as polish if
   the buttons stay focused after a click is awkward in practice.
   Document in closing notes if added.

---

## 8. Recommended Job Sequence

1. **Plan job (this artifact).** PM/Outcome🧭Steward reviews and
   records this spec at `docs/project/phases/render-rnd/round-6-
   showroom-spec.md`.
2. **Plan review** by Outcome🧭Steward or PM. Open questions in §7
   resolved or explicitly deferred to engineer judgement.
3. **WP-A implement** — scale calibration. Land first; lets
   subsequent WP-B development consume the factory.
4. **WP-A scaffold + reviewer code-trace** confirms replay-path
   compatibility. Engineer's WP-A closing notes record per-persona
   audit results and the median-target methodology.
5. **WP-B implement** — Showroom scene + UI + home-screen entry.
   Engineer may choose to bundle the manifest optional-clip-key
   audit (`take_hit`, `death`, `attack_*` per pack) as a first WP-B
   sub-step before scene work, or interleave.
6. **WP-B scaffold + reviewer code-trace** confirms the trigger
   buttons + label mechanism + camera + entry point all wire
   through.
7. **No UAT job.** The user runs visual UAT themselves on their
   own machine. Closing readout is the handoff artifact, mirroring
   Round-5 structure.
8. **Closing readout** at
   `docs/project/phases/render-rnd/round-6-closing-readout.md`,
   structurally mirroring `round-5-closing-readout.md`:
   - Scope delivered
   - Per-persona scale calibration table (source_h, multiplier,
     post-scale apparent_h)
   - Per-pack optional-clip-key inventory + fallback resolutions
   - Showroom controls reminder (button bar, equipment selectors,
     camera)
   - Blind-review focus items
   - Technical ceilings (which packs lacked which clips, what the
     fallback does, what reads "off" deterministically vs. by
     user-visual judgement)

---

*This spec is the why-layer extension for Round 6; the engineer
treats it as a contract. Open questions in §7 are explicit invitations
for engineer judgement, not blockers. Anything substantively changing
the architecture or success criteria as implementation progresses
must come back through PM/Outcome🧭Steward before commit.*

---

## Plan Review Verdict

**Verdict: CHANGES_REQUESTED.**

Architecture and substrate decisions ratify; two high-severity spec
defects + four medium-severity contract-tightening items must be
amended before WP-A implement begins. See
[`round-6-showroom-spec-review.md`](./round-6-showroom-spec-review.md)
for the full review, issue table, §7 question-by-question decisions,
and the prioritised amendment list.

High-severity defects to fix in this doc:
1. **§3.2.1 step 4 + §3.2.4** — synthetic-map dims `{w:14, h:8}`
   produce a 5.32×3.04 floor; the proposed 11.2-unit-wide character
   row overflows it. Widen to `{w:32, h:12}` or use
   `tile_to_world`-derived positions.
2. **§3.2.2 "Edge — Death pose hold" + §7 Q4** — proposed
   `animation.loop_mode` play-time-only override is not achievable
   in Godot 4 (loop_mode lives on the cached resource). Switch to
   `animation_finished` → `player.pause()`.
