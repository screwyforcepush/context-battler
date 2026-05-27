# Round-6 Showroom Spec — Curator's Showroom + Per-Persona Scale Calibration

> **Status: PLAN_RATIFIED (amended 2026-05-27, post-`3036a28`)** —
> three plan reviews folded in via D9–D18; §7 is a ratified-
> decisions table. Engineer treats this spec as the WP-A dispatch
> contract. See `## Plan Review Verdict — RATIFIED` at the foot for
> the amendment summary and the source review artefacts.
>
> Follow-up to Round 5
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

#### 3.1.3 Renderer application — factory extraction with `base_scale` injection (ratified D9)

**Factory extraction is the ratified shape (Q2/D9).** Pass-persona-through
is rejected — WP-B would otherwise duplicate the character-loading
dance. The factory signature accepts `base_scale: float` so the
canonical `CHARACTER_MODEL_SCALE := 0.21` constant **stays declared
in `EntityRenderer.gd` line 3** (Round-5 scaffold lock at
`verify-scaffold.mjs:209`) and is **never duplicated or moved**.

Add to `EquipmentMeshAttachment`:

```gdscript
# Factory: scene-load + scale + pivot + fallback-capsule in one place.
# base_scale: caller-injected canonical base scale (EntityRenderer.CHARACTER_MODEL_SCALE).
# The constant is NOT redeclared here. The factory has no other base-scale source.
func instantiate_persona_character(
        persona: String,
        label: String,
        fallback_material: Material,
        base_scale: float) -> Node3D:
    var multiplier := scale_multiplier_for_persona(persona)
    # ... loads PackedScene via character_assets_by_persona[persona];
    #     instances; reads pivotYOffset; falls back to capsule on miss.
    # The single line that applies scale is:
    visual.scale = Vector3.ONE * base_scale * multiplier
    # ... returns the assembled Node3D.
```

Caller sites:

- `EntityRenderer._spawn_characters` calls
  `equipment_attachment.instantiate_persona_character(persona, label, fallback_material, CHARACTER_MODEL_SCALE)`.
  `EntityRenderer._instance_or_capsule` becomes a thin delegate (or
  is deleted entirely if no second caller remains).
- `Showroom.gd` does:
  ```gdscript
  const EntityRendererScript = preload("res://src/EntityRenderer.gd")
  ...
  var character := equipment_attachment.instantiate_persona_character(
      persona, label, fallback_material, EntityRendererScript.CHARACTER_MODEL_SCALE)
  ```
  No second literal `0.21` is introduced anywhere in the codebase.

**Substrate lock — explicit constraint for the engineer:**
- The `const CHARACTER_MODEL_SCALE := 0.21` declaration **MUST remain
  in `EntityRenderer.gd`** verbatim. Do not move it. Do not duplicate
  it. Do not redeclare it inside `EquipmentMeshAttachment` or
  `Showroom.gd`. `verify-scaffold.mjs:209` regex-asserts this
  declaration site — keep it green.
- The factory receives the constant via the `base_scale` parameter;
  it must not import or read it from EntityRenderer otherwise (no
  `EntityRendererScript.CHARACTER_MODEL_SCALE` inside the factory
  body — only at call sites).
- The verify-scaffold assertion that complements the lock is *"per-
  persona scale multiplier is read from manifest at instance time"*
  via `scale_multiplier_for_persona`, **not** the factory name.

`EquipmentMeshAttachment` also exposes:
```gdscript
func scale_multiplier_for_persona(persona: String) -> float:
    var asset: Dictionary = character_assets_by_persona.get(persona, {})
    var value := asset.get("modelScaleMultiplier", 1.0)
    return float(value) if (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) else 1.0
```

**Manifest schemaVersion bump 3 → 4 is local to the art kit**
(`verify-scaffold.mjs:348`). It is **NOT** the replay snapshot
`schemaVersion === 3` (`MatchPlayer.gd:73`) — those are independent.
Do not touch the snapshot version.

#### 3.1.4 Calibration methodology (no UAT, no browser)

**Deterministic, numerical, headless.** The engineer writes a new
`throwaway-prototypes/d-full-match/scripts/audit-character-scales.gd`
(or extends `verify-character-rigs.gd`) that runs under Godot
`--headless`.

**Measurement protocol — pose-locked, world-transformed AABB (D13):**

1. For each character manifest entry, instantiate the PackedScene
   under headless Godot.
2. **Pose-lock before sampling.** Resolve the persona's `idle` clip
   via the existing manifest key; if present, call
   `AnimationPlayer.play(idle_clip)` then `AnimationPlayer.seek(0.0,
   true)` and `AnimationPlayer.stop()` to evaluate the clip's
   pose-at-time-zero onto the skeleton. If no idle clip is declared,
   fall back to the rig's T-pose (do not call any AnimationPlayer
   method). Packs that ship in arbitrary author-time poses must NOT
   skew the median because of pose differences. The chosen pose is
   recorded in the audit output (per-persona `pose: "idle@0"` or
   `"t-pose"`).
3. Walk **all visible** `MeshInstance3D` descendants and merge each
   `mesh_instance.global_transform * mesh_instance.get_aabb()` into
   a combined AABB. World-transforming each mesh's AABB before
   merging accounts for any local scale baked into intermediate
   transform nodes (e.g. a GLB root with non-1.0 scale, a rig parent
   rotated 90°, etc.) — Reviewer C flagged baked-root-scale as a
   real risk. Skip MeshInstance3Ds with `visible == false` or
   zero-volume AABBs.
4. Report `source_height = aabb.size.y` per persona. This is the
   instance-time apparent height *before* `CHARACTER_MODEL_SCALE` or
   any per-persona multiplier is applied.
5. Compute the **median source height** across all 8 personas as
   the calibration target. Median is robust against an outlier pack
   distorting the band.
6. Compute the per-persona multiplier:
   `multiplier = median_source_height / source_height`, clamped to
   `[0.4, 3.0]` to catch pathologically broken AABBs.
7. Print the table for the engineer to commit into `manifest.json`:

   ```
   persona       source_h   multiplier   post_scale_h   pose       notes
   rat            X.XX       1.00         …              idle@0     (within ±5% of median — left at 1.0)
   duelist        Y.YY       0.92         …              idle@0
   trader         Z.ZZ       1.10         …              idle@0
   ...
   ```

Engineer **commits the multipliers into the manifest** (not auto-
generated at runtime — manifest is the durable record).

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

**Apparent-height band assertion — MANDATORY in GDScript (D12).**
Once multipliers are committed, `audit-character-scales.gd` runs in
**assert mode** (e.g. invoked as `godot --headless --script
audit-character-scales.gd -- --assert`) and:

- Loads the committed `manifest.json`.
- Recomputes each persona's `source_height` via the pose-locked,
  world-transformed AABB protocol above.
- Computes each persona's `post_scale_height = source_height *
  modelScaleMultiplier`.
- Computes the median `post_scale_height` across all 8 personas.
- Asserts that **every** persona's `post_scale_height` is within
  ±15% of that median.
- On any failure: prints the offending persona(s), the actual vs.
  permitted band, and **exits with a non-zero status code** via
  `quit(1)` (or `OS.set_exit_code(1)` + `quit()`).
- Also asserts `modelScaleMultiplier ∈ [0.4, 3.0]` for every entry.

The ±15% tolerance is the deterministic substitute for the user's
"no persona is markedly taller or shorter" visual judgement.

**Non-goal: stdout parsing.** `verify-scaffold.mjs` does NOT parse
Godot stdout to enforce the band. The band check lives entirely
inside `audit-character-scales.gd` so the contract is one process
(no quoting/locale/stdout-format fragility). Verify-scaffold's role
is to invoke the GDScript (when `GODOT_BIN` is available) and treat
its exit code as the verdict — see §3.1.5 and §6.

#### 3.1.5 Replay-path verification + audit invocation contract

The manifest is shared between Showroom and existing replay path.
**Scale fix must not regress the replay.** Verification:

- Reviewer code-traces that `EntityRenderer._spawn_characters`
  invokes `equipment_attachment.instantiate_persona_character(...,
  CHARACTER_MODEL_SCALE)` (the new factory) as the SOLE caller-site
  that originates `CHARACTER_MODEL_SCALE`. `EntityRenderer.gd` must
  not have a second path that hard-codes scale; `Showroom.gd` must
  pass `EntityRendererScript.CHARACTER_MODEL_SCALE` and must not
  redeclare the constant.
- Scaffold-verify forbidden-token grep gains a check that the
  literal `0.21` appears in `EntityRenderer.gd` only inside the
  `CHARACTER_MODEL_SCALE := 0.21` declaration — no second occurrence
  in `EntityRenderer.gd`, `EquipmentMeshAttachment.gd`, or
  `Showroom.gd`.
- Closing-readout notes confirm the engineer ran an existing
  recorded match (any match from harness output) end-to-end after
  calibration and code-traces that the persona heights changed as
  expected without regressing pivot-Y / heading / movement
  interpolation logic.
- **Known curator-diagnostic signal (not a regression):** opportunist
  uses `attachBone-fallback:handOffset` (Quaternius mech, no hand
  bone) and gets a `Node3D` weapon socket parented to the character
  ROOT at offset `(0.15, 0.31, -0.10)` outside the scaled `visual`.
  Under any `modelScaleMultiplier ≠ 1.0` the weapon will sit at the
  root-space offset while the body grows/shrinks — visible
  misalignment is **expected** and a signal that the source pack
  lacks a hand bone. Pack-swap territory, not Round-6 scope. Document
  in closing readout.

The "run an existing match end-to-end" verification is **code-trace
and snapshot-load**, not browser UAT — the engineer confirms
deterministically that the renderer initializes without error,
character instances spawn, and per-persona multipliers were read
from the manifest. The user does the visual confirmation themselves
in their own UAT pass after closure.

**Audit invocation contract (D12, mandatory):**

- The throwaway prototype's `npm test` script (in
  `throwaway-prototypes/d-full-match/package.json`) invokes
  `audit-character-scales.gd --assert` via `$GODOT_BIN --headless`
  when `GODOT_BIN` is set in the environment. The GDScript's exit
  code IS the verdict: non-zero fails the npm test step.
- When `GODOT_BIN` is unset, the audit step is skipped (CI-friendly
  for environments without Godot) but the throwaway prototype's
  `test` script clearly logs `audit-character-scales: skipped
  (GODOT_BIN unset)` so the omission is visible.
- The audit is NOT a soft, parsed-stdout check inside
  `verify-scaffold.mjs`. Verify-scaffold continues to enforce purely
  textual invariants (forbidden tokens, manifest shape, file
  presence). The ±15% apparent-height band check lives entirely
  inside the GDScript per §3.1.4.

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
   - Instantiates the character via the WP-A factory:
     ```gdscript
     const EntityRendererScript = preload("res://src/EntityRenderer.gd")
     ...
     var character := equipment_attachment.instantiate_persona_character(
         persona,
         label,
         fallback_material,
         EntityRendererScript.CHARACTER_MODEL_SCALE)
     ```
     Single source of truth shared with the replay path. Showroom
     does not redeclare `CHARACTER_MODEL_SCALE`; it reads it from
     `EntityRenderer.gd` via preload (D9 ratified lock).
   - Positions it in a row along the X axis with a fixed spacing of
     1.6 units, centered on origin (e.g.,
     `Vector3(i * 1.6 - 5.6, 0.0, 0.0)` for an 8-character row from
     `x = -5.6` to `x = +5.6`, spanning 11.2 world units). Spacing
     stays fixed under all per-persona multipliers — outlier widths
     showing as overlap are themselves curator-diagnostic signal
     (Q7/D18 ratified). The `[0.4, 3.0]` multiplier clamp prevents
     extreme outliers.
   - Adds two `Label3D` children above the character head:
     - `NameLabel` shows `"<persona>\n<sourceKey>"`.
     - `ClipLabel` shows the currently-playing animation clip name
       (updated each `_process` from `animation_state_for_character`
       — see §3.2.6). When idle/none, shows `"(idle/none)"`.
   - Calls `equipment_attachment.register_character(showroom_id,
     character_node, persona)` with a synthetic showroom ID
     (`"showroom-<persona>"`) so the attachment can drive equipment
     and animation clips on this character via the same code path
     the replay uses.
5. Configures the CameraRig **locked to MODE_FREE** (D15) with
   `free_anchor` at the centerpoint of the row (e.g.,
   `Vector3(0.0, 0.5, 0.0)`). Pass a synthetic snapshot
   `{"characters": []}` and `entity_renderer=null`. The Showroom
   never reaches `MODE_ANCHORED` — see §3.2.7 for the lock contract
   (either a `lock_free_mode: bool` field on CameraRig, or Showroom
   programmatically hides the mode button and filters `KEY_C` input).
   The user can orbit (left-drag), pan (right-drag), and zoom
   (wheel) freely. `[`/`]` anchor cycling becomes a no-op with the
   empty character list regardless of the lock mechanism.
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
That call already exists from Round 5 — the extension is teaching
`EquipmentMeshAttachment` to (a) resolve the new clip-kind keys via
the fallback chains in §3.2.3, (b) return **structured** resolution
state (clip + requested kind + resolved kind + isFallback) so the
Showroom's `ClipLabel` can surface the curator-diagnostic signal
(see §3.2.3 and §3.2.6), and (c) implement the death-pose hold
mechanism described below.

**Animation-clip event synthesis directly bypasses the snapshot/
MatchPlayer turn loop.** No `PlaybackClock`, no `update_to_turn`, no
`ACTION_PHASE_START` gating. The Showroom is event-driven on user
input. Idle/Walk clips honour their authored loop mode (the source
packs already author these as looping). Round-5's
`play_character_clip` restarts the clip only when the character's
`currentClip` changes, so re-clicking the same button doesn't reset
the playhead disruptively.

**Edge — Death pose hold (D11, mandatory mechanism).** The Showroom
holds the last frame of the death clip **without mutating any
imported Animation resource**. Mechanism:

1. On death trigger, resolve the clip via the §3.2.3 fallback chain.
2. Call `player.play(resolved_clip)` (no mutation; the imported
   loop_mode is left untouched on the cached resource).
3. Connect `player.animation_finished` as a one-shot
   (`Object.CONNECT_ONE_SHOT`) to a handler that calls
   `player.pause()`. Combined with no mutation, this leaves the
   skeleton posed at the last keyframe.
4. On any subsequent trigger (Idle, Walk, etc.), the new
   `player.play(clip)` call automatically supersedes the paused
   state — no extra unpause logic needed.

**Non-goal — explicit (D11):** the Showroom never assigns to
`animation.loop_mode` on a cached `Animation` resource. The Round-5
"play-time-only override" idea was rejected by reviewers because
`Animation.loop_mode` is a resource-level property; assigning to it
mutates the shared cached resource and risks bleeding into the
replay path (even though replay currently uses corpse-swap and not
death clips). The `animation_finished → pause()` mechanism above is
the contract. If a future need for instance-local loop_mode override
arises, the engineer must duplicate the Animation resource first
(`animation.duplicate(true)`) and register the copy under a
Showroom-only name — but no such need exists in Round 6.

A missing death clip falls through `death → take_hit → generic →
idle` per §3.2.3. With the `animation_finished → pause()` mechanism
applied uniformly to the resolved clip, this means: a missing death
clip surfaces as a frozen `idle` pose — a highly visible diagnostic
signal that the pack lacks death-clip authoring.

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

`EquipmentMeshAttachment` gains a **structured resolver** (D14)
that returns the full resolution state, not just a string:

```gdscript
# New API: structured clip resolution.
# Returns a Dictionary with the exact shape:
#   {
#     "clip":           String,   # the AnimationPlayer clip name to play
#     "requested_kind": String,   # the kind the caller asked for, e.g. "attack_armed"
#     "resolved_kind":  String,   # the manifest key that supplied the clip, e.g. "attack"
#     "is_fallback":    bool,     # true iff resolved_kind != requested_kind
#   }
# Returns {"clip": "", "requested_kind": kind, "resolved_kind": "", "is_fallback": true}
# when no fallback in the chain resolves to a non-empty manifest value.
func resolve_animation_clip(character_id: String, kind: String) -> Dictionary:
    ...
```

The legacy `clip_name_for_character(character_id, kind) -> String`
remains for replay-path callers (it can be implemented as
`resolve_animation_clip(...).clip`). `play_character_animation`
internally calls `resolve_animation_clip`, plays the returned
`clip`, and stores the full resolution dict on the per-character
state so `animation_state_for_character` (§3.2.6) can surface it.

**Fallback chains (first non-empty manifest key wins, in order):**

| Requested kind | Fallback chain |
|---|---|
| `attack_armed` | `attack_armed` → `attack` → `generic` → `""` (no-op) |
| `attack_unarmed` | `attack_unarmed` → `attack` → `generic` → `""` |
| `take_hit` | `take_hit` → `generic` → `idle` |
| `death` | `death` → `take_hit` → `generic` → `idle` |
| (Other kinds unchanged — `idle`, `walk`, `attack`, `loot` already exist.) |

When `is_fallback == true`, the Showroom's per-character
`ClipLabel` surfaces the fallback explicitly (e.g.
`"PickUp* (loot via attack fallback)"` — exact label format is
engineer's call provided the dict's `requested_kind`,
`resolved_kind`, and `is_fallback` are visible in the rendered
text). This is the **curator-diagnostic** signal §10 calls for: the
user can see at a glance which packs lack a dedicated clip without
mousing over each character or re-running the trigger.

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
`map` block. The Showroom synthesizes a minimal map.

**Map sizing math (D10).** `SceneBuilder.WORLD_SCALE := 0.38`
(`SceneBuilder.gd:3`). A `{w:14, h:8}` map produces a `14 * 0.38 ×
8 * 0.38 = 5.32 × 3.04` world-unit floor, which is narrower than
the 11.2-unit-wide 8-persona row (`i*1.6 - 5.6` per §3.2.1 step 4).
The character row would overflow the floor on both sides.

**Use `{w:32, h:12}`** — the floor becomes `12.16 × 4.56` world
units, comfortably wider than the row with ~0.5 world units of
margin per side. Adjust wall/cover positions so they remain in
tile-space inside the new map bounds.

```gdscript
var synthetic_snapshot := {
    "map": {
        "size": {"w": 32, "h": 12},
        "walls": [
            {"x": 0, "y": 0, "w": 32, "h": 1}     # back wall behind the row (full width)
        ],
        "coverClusters": [
            {"x": 15, "y": 6, "w": 2, "h": 1}     # one cover piece in front-centre
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

Engineer-tunable layout dimensions provided they preserve the
floor-covers-row invariant: `world_floor_width = size.w *
WORLD_SCALE > 11.2 + margin`. The cucumber requirement remains "at
least one wall segment, one cover piece, and a floor patch".
(Alternative tile_to_world-based positioning is acceptable if the
engineer prefers — D10 ratifies the widen-dims path as the simpler
default.)

#### 3.2.5 Equipment tier selector — event synthesis

Two `HBoxContainer` rows in a `VBoxContainer`:

- **Weapon row:** 4 buttons — `None`, `Low`, `Mid`, `High`
- **Armor row:** 4 buttons — `None`, `Low`, `Mid`, `High`

State held in the Showroom script:
```gdscript
var current_weapon_tier: String = ""   # "" | "low" | "mid" | "high"
var current_armor_tier: String = ""    # "" | "low" | "mid" | "high"
```

**Tier → asset mapping by manifest `tier` numeric field (D16).**
The selectors do NOT hardcode asset names. Instead, at Showroom
startup, build the tier→asset map by filtering existing manifest
assets on their `tier` numeric field:

| UI label | Tier value (numeric) |
|---|---|
| None | _empty string equip — no asset_ |
| Low | `tier == 1` |
| Mid | `tier == 2` |
| High | `tier == 3` |

Resolution at Showroom `_ready` (separately for weapons and armour):

```gdscript
# Filter the manifest's weapon_assets_by_name / armour_assets_by_name
# by tier field. Pick one representative per tier deterministically
# (first-in-manifest-order — i.e. iteration order of the dictionary
# as configure() loaded it). Engineer documents the chosen
# representative per tier in IMPLEMENTATION-SUMMARY.md so the
# Showroom curation is reproducible.
var weapon_by_tier := {1: "", 2: "", 3: ""}
for asset_name in equipment_attachment.weapon_assets_by_name.keys():
    var asset: Dictionary = equipment_attachment.weapon_assets_by_name[asset_name]
    var tier := int(asset.get("tier", 0))
    if weapon_by_tier.has(tier) and weapon_by_tier[tier] == "":
        weapon_by_tier[tier] = asset_name
# Same shape for armour.
```

This makes the selectors **substrate-driven, not name-driven** — if
the engineer renames or re-tiers an asset in the manifest, the
Showroom continues to surface the tier ramp without code edits.
Reviewers can grep that `"rusty_blade"`, `"sword"`, etc. do not
appear as hardcoded strings in `Showroom.gd`. The
`verify-scaffold.mjs` schema check at `:414` + `:417` already
asserts `asset.tier: number`, so the field is structurally
guaranteed to exist.

If two assets share a tier, the deterministic first-in-iteration
pick is logged in IMPLEMENTATION-SUMMARY.md as part of the
"Showroom mode" section. If a tier has zero matching assets (e.g.
no `tier==3` armour exists), the corresponding selector button is
disabled or hidden — engineer documents which tiers were sparse in
the closing readout (curator-diagnostic signal for content
gaps).

Button click flow (`current_weapon_tier` / `current_armor_tier`
hold integer tier values 0 = none, 1 = low, 2 = mid, 3 = high):

```gdscript
func _apply_equipment() -> void:
    var equipped := {}
    for persona in PERSONAS:
        var showroom_id := "showroom-" + persona
        equipped[showroom_id] = {
            "weapon": weapon_by_tier.get(current_weapon_tier, ""),
            "armour": armour_by_tier.get(current_armor_tier, ""),
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

**Public accessor — substrate-clean (D17).** Showroom is a
*consumer* of the attachment subsystem, not a peer that pokes
private state. `EquipmentMeshAttachment` exposes:

```gdscript
# Read-only view of the last resolution + playback state for a
# registered character. Returns the same dict shape stored by
# play_character_animation when it called resolve_animation_clip.
# Returns an empty dict if the character is not registered.
func animation_state_for_character(character_id: String) -> Dictionary:
    # Shape (when present):
    #   {
    #     "clip":           String,   # the resolved clip name (or "" when none)
    #     "requested_kind": String,   # last requested kind (or "idle" before any trigger)
    #     "resolved_kind":  String,   # manifest key the clip came from
    #     "is_fallback":    bool,
    #     "is_playing":     bool,     # AnimationPlayer.is_playing() at query time
    #   }
    ...
```

`Showroom._process` (no private-state access):

```gdscript
func _process(_delta: float) -> void:
    for persona in PERSONAS:
        var showroom_id := "showroom-" + persona
        var clip_label: Label3D = clip_labels.get(showroom_id)
        if clip_label == null:
            continue
        var state := equipment_attachment.animation_state_for_character(showroom_id)
        if state.is_empty() or not state.get("is_playing", false):
            clip_label.text = "(idle/none)"
        else:
            clip_label.text = _clip_label_text(state)

func _clip_label_text(state: Dictionary) -> String:
    var clip := str(state.get("clip", ""))
    if state.get("is_fallback", false):
        return "%s* (%s via %s fallback)" % [
            clip,
            state.get("requested_kind", ""),
            state.get("resolved_kind", ""),
        ]
    return clip
```

The Showroom never reads `equipment_attachment.registered_characters`
directly. The accessor is the contract; `registered_characters` may
remain script-private (or be marked `var` only by convention) without
breaking the Showroom.

#### 3.2.7 Free-orbit camera — MODE_FREE lock (D15)

Reuse `CameraRig` in `MODE_FREE`. Pass a synthetic snapshot
`{"characters": []}` to `CameraRig.configure` so `cycle_anchor`
becomes a no-op. `entity_renderer` argument can be `null` — the
existing `_anchor_world()` guards null.

The default Director radius (`26.0`) is comfortable for the
11.2-unit row; the engineer tunes initial `pitch`/`yaw` so the user
opens into a wide three-quarter view of the line-up.

**MODE_FREE is locked — the Showroom never reaches MODE_ANCHORED.**
The current `CameraRig` lets `KEY_C` (line 113) and the on-screen
mode button (line 203–205) swap to `MODE_ANCHORED`. Even with an
empty character list `cycle_anchor` no-ops, but `toggle_mode` on
line 121 still flips `mode` to `MODE_ANCHORED` and `_anchor_world()`
falls back to `Vector3.ZERO`, breaking right-drag pan
(`CameraRig.gd:108` — `panning and mode == MODE_FREE`). The
Showroom must not allow this drift.

**Concrete contract — pick one (engineer's call):**

- **(a) `lock_free_mode: bool` field on CameraRig.** Default `false`
  (preserves replay behaviour). When `true`: `_handle_input` skips
  the `KEY_C` branch; `_make_controls` hides (or never creates) the
  mode button. Showroom sets `camera_rig.lock_free_mode = true`
  before `configure`. Smallest CameraRig diff, cleanest substrate.
- **(b) Showroom-side gating.** Showroom programmatically calls
  `camera_rig.mode_button.visible = false` (or removes it from the
  tree) and installs an `_unhandled_key_input` filter that swallows
  `KEY_C` events. No CameraRig changes; Showroom owns the lock.

Recommend **(a)** — substrate-clean and lock-mode becomes a
documented CameraRig affordance. Either is acceptable; engineer
documents the choice in IMPLEMENTATION-SUMMARY.md.

**Acceptance contract:** the Showroom never observes
`camera_rig.get_mode() == MODE_ANCHORED`. Reviewers can spot-check
by toggling `KEY_C` repeatedly in the inspection harness — mode
must stay `MODE_FREE`.

`[`/`]` anchor cycling remains a no-op via the empty-character
snapshot — no extra disable needed.

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
  factory extraction** (`instantiate_persona_character` with
  `base_scale: float` parameter) for clean single-source-of-truth
  reuse. Factory extraction is the ratified shape (D18.Q2);
  pass-persona-through was rejected because WP-B would otherwise
  duplicate the scene-load + scale + pivot dance.
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

1. **Factory extraction (ratified D9/Q2) — extract character
   instantiation into `EquipmentMeshAttachment`.**
   - Add public method:
     ```gdscript
     func instantiate_persona_character(
         persona: String,
         label: String,
         fallback_material: Material,
         base_scale: float
     ) -> Node3D
     ```
     Owns scene-load, scale, pivot-Y, fallback-capsule, and
     scale-multiplier application. **Reads `base_scale` from the
     caller** — does not import or redeclare
     `CHARACTER_MODEL_SCALE`.
   - `EntityRenderer._spawn_characters` calls
     `instantiate_persona_character(..., CHARACTER_MODEL_SCALE)`.
     `const CHARACTER_MODEL_SCALE := 0.21` declaration **stays in
     `EntityRenderer.gd` line 3 verbatim** (Round-5 scaffold lock).
   - Showroom consumes the same factory via
     `preload("res://src/EntityRenderer.gd").CHARACTER_MODEL_SCALE`.
   - Pillar-6 honoured: single source of truth for character
     instantiation; new round adds no asymmetric handling.
2. **Manifest field.**
   - Add `modelScaleMultiplier: number` to each of the 8 character
     entries. Engineer-calibrated values committed alongside.
   - Default 1.0 where calibration shows the persona is already at
     the median band.
   - Per-persona `notes` extended with a `modelScaleMultiplier:X.XX
     because <reason>` annotation where the value deviates from 1.0.
   - Bump manifest `schemaVersion` 3 → 4 (D18.Q1 ratified). Update
     `verify-scaffold.mjs:348` accordingly. **Do not touch the
     replay snapshot `schemaVersion === 3`** at `MatchPlayer.gd:73`
     — independent version.
3. **Calibration audit script (mandatory band assertion — D12).**
   - Create `scripts/audit-character-scales.gd` (or extend
     `verify-character-rigs.gd` in-place; engineer picks). Script
     class is `SceneTree`.
   - For each character: pose-lock to `idle@0` (or T-pose if no idle
     clip declared), walk visible `MeshInstance3D` descendants,
     merge `mesh_instance.global_transform * mesh_instance.get_aabb()`
     (D13 world-transform protocol), report
     `source_height = aabb.size.y`.
   - Compute median across all 8; emit per-persona
     `multiplier = median / source_height`, clamped `[0.4, 3.0]`.
   - Print the table the engineer commits into `manifest.json`.
   - **Assert-mode** (invoked as `--assert`): reload manifest,
     recompute, verify each persona's `source_height *
     modelScaleMultiplier` is within ±15% of the median post-scale
     value, **exit non-zero on failure** (mandatory — no soft skip).
4. **Renderer wiring.**
   - `EquipmentMeshAttachment.scale_multiplier_for_persona(persona)
     -> float` reads manifest, defaults `1.0`.
   - The factory applies `Vector3.ONE * base_scale * multiplier` at
     instance time. **Only callsite that originates the literal
     `0.21` is `EntityRenderer.gd` line 3.**
   - `CHARACTER_MODEL_SCALE := 0.21` declaration unchanged (Round-5
     scaffold-verify assertion at `verify-scaffold.mjs:209` stays
     passing).
5. **Replay-path verification.**
   - Code-trace confirms the factory is the SOLE site reading
     `base_scale`/applying `CHARACTER_MODEL_SCALE`; no second `0.21`
     literal in `EntityRenderer.gd`, `EquipmentMeshAttachment.gd`,
     or `Showroom.gd`.
   - Closing-readout records that the engineer code-loaded an
     existing harness-produced snapshot in `MatchPlayer` and
     verified the renderer initialized without error and read the
     multipliers per persona. (No browser, no screenshots — just
     deterministic load + log inspection.)
   - Closing-readout flags opportunist's `attachBone-fallback:handOffset`
     known-signal (weapon misalignment under non-1.0 multiplier —
     pack-swap territory, not a regression — see §3.1.5).
6. **Scaffold-verify update.**
   - `verify-scaffold.mjs:348` assertion bumps to
     `schemaVersion === 4` (D18.Q1).
   - New assertions:
     - Each character entry has `modelScaleMultiplier` of type
       number, in `[0.4, 3.0]`.
     - `EntityRenderer.gd` invokes
       `equipment_attachment.instantiate_persona_character(...,
       CHARACTER_MODEL_SCALE)` at the character-instance site (the
       constant flows through the factory parameter).
     - `EquipmentMeshAttachment.gd` defines
       `scale_multiplier_for_persona`.
     - `EquipmentMeshAttachment.gd` defines
       `instantiate_persona_character` with a `base_scale: float`
       parameter (factory).
     - `EquipmentMeshAttachment.gd` does NOT redeclare or import
       `CHARACTER_MODEL_SCALE` (forbidden-token-style grep for the
       literal `0.21` outside its sole declaration in
       `EntityRenderer.gd`).
   - **Mandatory band assertion via GDScript exit code** (D12):
     `package.json` `test` script in
     `throwaway-prototypes/d-full-match/` invokes
     `$GODOT_BIN --headless --script scripts/audit-character-scales.gd
     -- --assert` when `GODOT_BIN` is set in the environment. Non-zero
     exit fails the npm test step. When `GODOT_BIN` is unset, the
     audit step logs `audit-character-scales: skipped (GODOT_BIN
     unset)` and is omitted. **Not implemented as stdout parsing
     in `verify-scaffold.mjs`** — the GDScript owns the assertion
     end-to-end.
7. **Documentation.**
   - Closing readout records the calibration table (persona,
     source_height, multiplier, post-scale apparent height, pose)
     and the replay-path verification code-trace.

**Success criteria:**
- ✅ Manifest character entries carry `modelScaleMultiplier` per
  entry; values are committed (not placeholder 1.0s where the
  audit script shows a deviation needed). Manifest
  `schemaVersion` bumped 3 → 4.
- ✅ Camper, paranoid, sprinter (and any other audit-flagged
  persona) have post-calibration apparent heights within ±15% of
  the median across all 8 personas. **Asserted mandatorily by
  `audit-character-scales.gd --assert` (non-zero exit on failure),
  wired into `npm --prefix throwaway-prototypes/d-full-match test`
  when `GODOT_BIN` is set.**
- ✅ Factory `EquipmentMeshAttachment.instantiate_persona_character`
  exists with `base_scale: float` parameter; `EntityRenderer` and
  `Showroom` both call it; no second literal `0.21` anywhere.
- ✅ `CHARACTER_MODEL_SCALE := 0.21` declaration in
  `EntityRenderer.gd` line 3 unchanged verbatim; Round-5
  scaffold-verify assertion at `:209` still passes.
- ✅ Replay path verified end-to-end against an existing snapshot
  via code-trace + load (no browser).
- ✅ Forbidden-token grep clean: `browsertools`, `chromium`,
  `screenshot`, `puppeteer`, `playwright`, `a_star`, `astar`,
  `find_path`, `bresenham`, `dijkstra`, `breadth_first_search`,
  `manual_collision`.
- ✅ `npm run lint` / `typecheck` / `build` / `test` clean.
- ✅ `npm --prefix throwaway-prototypes/d-full-match test` clean
  (includes the mandatory audit-band assertion when GODOT_BIN set).
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
   - `EquipmentMeshAttachment` adds a **structured resolver**
     `resolve_animation_clip(character_id, kind) -> Dictionary`
     returning `{clip, requested_kind, resolved_kind, is_fallback}`
     (D14, §3.2.3). `play_character_animation` calls it, plays the
     resulting clip, and stores the full dict on the per-character
     state for `animation_state_for_character` to surface.
   - Legacy `clip_name_for_character` may remain (delegating to
     `resolve_animation_clip(...).clip`) for replay-path callers.
   - **Death-pose hold** via `animation_finished` one-shot →
     `player.pause()` (D11). **No mutation of cached
     `Animation.loop_mode`** anywhere in `EquipmentMeshAttachment` or
     `Showroom.gd`.
5. **Manifest extension for new clip kinds.**
   - Add optional `animation.take_hit`, `animation.death`,
     `animation.attack_unarmed`, `animation.attack_armed` keys to
     character entries where the source pack ships a matching clip.
   - Engineer audits each pack's available clips via
     `verify-character-rigs.gd` (extended to print full inventory).
   - Where a pack lacks the clip, leave the manifest key out and
     rely on the fallback chain.
6. **Equipment tier selectors (manifest-tier-driven — D16).**
   - VBoxContainer with two HBox rows (Weapon, Armor) of 4 buttons
     each. UI labels: None / Low / Mid / High → numeric tiers
     0/1/2/3.
   - At `_ready`, build `weapon_by_tier` and `armour_by_tier` dicts
     by filtering `equipment_attachment.weapon_assets_by_name` /
     `.armour_assets_by_name` on `asset.tier`. Pick first-in-
     iteration-order representative per tier. **No hardcoded asset
     name strings in `Showroom.gd`** (e.g. no `"rusty_blade"`,
     `"sword"`, `"plate"` literals — reviewers grep).
   - Engineer documents the resolved per-tier representatives in
     IMPLEMENTATION-SUMMARY.md's "Showroom mode" section.
   - On any click, build the synthetic `equipped_by_character` dict
     (all 8 personas same tier) and call
     `equipment_attachment.update_equipment(equipped)`.
7. **Per-character active-clip label (substrate-clean — D17).**
   - Two `Label3D` children per persona station (NameLabel +
     ClipLabel), billboarded, no-depth-test, outlined.
   - `EquipmentMeshAttachment.animation_state_for_character(character_id)
     -> Dictionary` accessor returns
     `{clip, requested_kind, resolved_kind, is_fallback, is_playing}`
     (full dict — exact shape in §3.2.6).
   - Showroom polls per frame in `_process` and renders ClipLabel
     via `_clip_label_text(state)`. **Showroom does NOT read
     `equipment_attachment.registered_characters` directly** — the
     accessor is the contract (reviewers grep that
     `registered_characters` is not referenced from `Showroom.gd`).
   - When `state.is_fallback == true`, ClipLabel renders e.g.
     `"PickUp* (loot via attack fallback)"` so the curator sees
     which packs lack a dedicated clip.
8. **Free-orbit camera (MODE_FREE locked — D15).**
   - `CameraRig.configure({"characters": []}, null, scene_builder,
     null)` with `mode = MODE_FREE` and `free_anchor =
     Vector3(0.0, 0.5, 0.0)`. Engineer tunes default pitch/yaw to
     present the row in a wide three-quarter view.
   - **MODE_FREE lock**: Showroom enforces that
     `camera_rig.get_mode()` never becomes `MODE_ANCHORED`. Two
     acceptable mechanisms (engineer picks per §3.2.7):
     (a) add `lock_free_mode: bool` field on CameraRig (preferred —
     substrate-clean), or (b) Showroom-side gating that hides the
     mode button and filters `KEY_C` input. Document the chosen
     mechanism in IMPLEMENTATION-SUMMARY.md.
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
    - Forbidden-token sweep loop in `verify-scaffold.mjs:452` (the
      existing code-file list) extended to include
      `src/Showroom.gd` and `scenes/Showroom.tscn`.
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
      - `Showroom.gd` references `MODE_FREE` and does NOT initialize
        in `MODE_ANCHORED`. (If lock mechanism (a) chosen: assert
        `lock_free_mode = true` reference. If (b) chosen: assert
        Showroom hides the mode button or filters `KEY_C`.)
      - `Showroom.gd` does **NOT** reference
        `registered_characters` (substrate-clean accessor contract
        per D17).
      - `Showroom.gd` does **NOT** contain the literal `0.21` (the
        `CHARACTER_MODEL_SCALE` constant must flow through the
        factory parameter from `EntityRenderer.gd` — D9).
      - `Showroom.gd` does **NOT** assign to `animation.loop_mode`
        (D11 — no cached-resource mutation).
      - `Showroom.gd` does **NOT** hardcode equipment asset names
        (`"rusty_blade"`, `"sword"`, `"greatsword"`, `"cloth"`,
        `"chain"`, `"plate"`, etc. — D16 substrate-driven mapping).
      - `EquipmentMeshAttachment.gd` defines
        `resolve_animation_clip(character_id, kind) -> Dictionary`
        (D14 structured resolver).
      - `EquipmentMeshAttachment.gd` defines
        `animation_state_for_character` accessor (D17).
      - `EquipmentMeshAttachment.gd` fallback chains documented in
        code: searches for `attack_armed` → `attack` and
        `attack_unarmed` → `attack` and `take_hit` → `generic` /
        `idle` and `death` → `take_hit` / `generic` / `idle`.
      - `EquipmentMeshAttachment.gd` connects
        `animation_finished` for death-trigger pause (D11) — no
        `animation.loop_mode = ANIMATION_LOOP_NONE` assignment
        anywhere.
      - Synthetic map dims in `Showroom.gd` satisfy
        `size.w * 0.38 > 11.2` (i.e. width 32+ — covers the row).
        Engineer may choose tile_to_world positioning instead;
        either path passes provided the floor covers the row.
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
   Manifest `schemaVersion` bumped 3 → 4 (D18.Q1). Post-calibration
   apparent heights sit within ±15% of the median across all 8
   personas — **asserted mandatorily inside `audit-character-scales.gd
   --assert` (non-zero exit on failure)**, wired into
   `npm --prefix throwaway-prototypes/d-full-match test` when
   `GODOT_BIN` is set (D12).
   `EquipmentMeshAttachment.instantiate_persona_character` is the
   single factory through which `CHARACTER_MODEL_SCALE` is applied;
   `EntityRenderer.gd` line 3 retains the constant declaration
   verbatim (D9 substrate lock).

2. **Showroom accessible.** Home-screen MatchPicker exposes a
   Showroom button. Clicking it transitions to a new
   `scenes/Showroom.tscn`. Back button / Esc returns to MatchPicker.

3. **8 personas instantiated via shared factory.** Showroom
   instantiates the 8 Round-5 personas through
   `EquipmentMeshAttachment.instantiate_persona_character(persona,
   label, fallback_material, EntityRendererScript.CHARACTER_MODEL_SCALE)`
   — the same factory the replay path uses. Single source of truth,
   no duplicate character-loading code, no second `0.21` literal
   anywhere.

4. **Sample environment present.** Showroom renders ≥1 wall, ≥1
   cover piece, and a floor patch through the existing
   `SceneBuilder.build_from_snapshot` pipeline with Round-5 PBR
   materials, via a synthetic minimal-map dict. Map dims satisfy
   `size.w * WORLD_SCALE > 11.2` (e.g. `{w:32, h:12}` — D10) so the
   floor covers the 11.2-unit row.

5. **7 animation trigger buttons** (Idle, Walk, Attack (unarmed),
   Attack (armed), Loot, Take hit, Death) fire across all 8
   personas via `play_character_animation` with the §3.2.3
   structured fallback chain (D14). Manifest optional keys
   `attack_unarmed`, `attack_armed`, `take_hit`, `death` populated
   where source packs ship matching clips. **Death-pose hold via
   `animation_finished` → `player.pause()`** one-shot, **no
   `Animation.loop_mode` mutation** anywhere (D11).

6. **Per-character active-clip label** (Label3D) displays the
   currently-playing clip name per persona via the
   `animation_state_for_character` accessor (D17, no
   private-state poke). When the resolved clip came from a fallback,
   the label surfaces `requested_kind`, `resolved_kind`, and the
   fallback marker (D14 structured resolver dict).

7. **Equipment tier selectors (manifest-tier-driven, D16).** Weapon
   {None, Low, Mid, High} and Armor {None, Low, Mid, High} buttons.
   Per-tier asset chosen at Showroom `_ready` by filtering
   `weapon_assets_by_name` / `armour_assets_by_name` on the
   `asset.tier` numeric field — no hardcoded asset names in
   `Showroom.gd`. Each selection calls
   `EquipmentMeshAttachment.update_equipment` unchanged from Round
   5. Armor renders as material-change (Round-5 contract); weapon
   as mesh-swap.

8. **Free-orbit camera locked to MODE_FREE (D15).** CameraRig
   permits orbit + pan + zoom around the line-up. The Showroom
   never observes `camera_rig.get_mode() == MODE_ANCHORED`,
   enforced via the §3.2.7 lock mechanism (either CameraRig
   `lock_free_mode` field or Showroom-side gating).

9. **Throwaway boundary preserved.** All changes inside
   `throwaway-prototypes/d-full-match/`. No Convex production code
   change. No HTTP traffic. No snapshot schema change (replay
   snapshot `schemaVersion === 3` at `MatchPlayer.gd:73` untouched
   — separate from the manifest version bump).

10. **Validation suite clean** (run, all green):
    - `npm run lint`
    - `npm run typecheck`
    - `npm run build`
    - `npm test`
    - `npm --prefix throwaway-prototypes/d-full-match test` —
      includes the mandatory `audit-character-scales.gd --assert`
      run when `GODOT_BIN` is set; non-zero exit fails this step.
    - `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match
      run build` (web export)
    - Forbidden-token grep clean across `src/*.gd`,
      `IMPLEMENTATION-SUMMARY.md`, scene files (`browsertools`,
      `chromium`, `screenshot`, `puppeteer`, `playwright`,
      `a_star`, `astar`, `find_path`, `bresenham`, `dijkstra`,
      `breadth_first_search`, `manual_collision`) — coverage
      extended to `src/Showroom.gd` and `scenes/Showroom.tscn`.

11. **No UAT artefacts.** Zero browsertools / chromium / screenshot
    / headless-visual-check tooling or output committed. Round-4/5
    D4 discipline preserved as a hard constraint.

---

## 7. Ratified Decisions (D18)

Section 7 originally listed 8 open questions; all 8 have been
ratified across the three plan reviews and the assignment ADR
(D18). The table below is **binding contract** for the engineer —
no re-debate. Cross-references to the spec amendments (D9–D17)
where the resolution is fully detailed.

| # | Question | Decision | Source / cross-ref |
|---|---|---|---|
| Q1 | Bump manifest `schemaVersion` 3 → 4? | **Bump to 4.** Manifest version only — the throwaway art-kit schema. **Do NOT touch the replay snapshot `schemaVersion === 3`** at `MatchPlayer.gd:73` (independent). Update `verify-scaffold.mjs:348` to assert 4. POC-posture forward-only; additive field still triggers signal-of-change bump. | D18.Q1; §3.1.3 closing paragraph |
| Q2 | Factory extraction vs. pass-persona-through? | **Factory extraction** — single source of truth for character instantiation. Pass-through is rejected (would duplicate the scene-load + scale + pivot dance in WP-B). Factory signature accepts `base_scale: float`; `CHARACTER_MODEL_SCALE := 0.21` stays declared in `EntityRenderer.gd` line 3 verbatim (D9, scaffold lock at `verify-scaffold.mjs:209`). | D18.Q2 + D9; §3.1.3 |
| Q3 | Tier→asset mapping for selectors? | **Map by manifest `tier` numeric field** (D16). Build the tier→asset dict at Showroom `_ready` by filtering `weapon_assets_by_name` / `armour_assets_by_name`. Pick first-in-manifest-iteration-order representative per tier; document the chosen representatives in IMPLEMENTATION-SUMMARY.md. No hardcoded asset names in `Showroom.gd`. | D18.Q3 + D16; §3.2.5 |
| Q4 | Death-clip hold mechanism? | **`animation_finished` → `player.pause()`** as a one-shot connection (D11). **No mutation of cached `Animation.loop_mode`** — the Round-5 "play-time-only loop_mode override" idea is rejected as non-functional (loop_mode is resource-level in Godot 4). Replay path is unaffected (it uses corpse-swap, not death clips), but the no-mutation discipline is mandatory regardless. | D18.Q4 + D11; §3.2.2 |
| Q5 | Row vs. grid layout? | **Row** along the X axis, fixed 1.6-unit spacing, centered on origin (`i*1.6 - 5.6`, 11.2 world units wide). Matches user's "line them up side by side" mental model. | D18.Q5; §3.2.1 step 4 |
| Q6 | Gore VFX on Take hit / Death? | **Excluded.** Matches the user's verbatim ask (curation surface, not gore evaluation). Blood-pool persistence (cap 64) would also bleed across take-hit clicks and clutter the comparison. Gore stays on the replay path only. | D18.Q6 + D4 (assignment ADR); §3.3 |
| Q7 | Persona station spacing tied to multipliers? | **Fixed 1.6-unit spacing.** Anomalous widths showing as overlap are themselves curator-diagnostic signal of outlier source-pack dimensions. The `[0.4, 3.0]` multiplier clamp prevents extreme outliers. Variable per-AABB spacing was rejected (would mask the very anomaly the curator should see). | D18.Q7; §3.2.1 step 4 |
| Q8 | Keyboard shortcuts for triggers? | **Deferred to engineer as optional polish.** Not part of acceptance. If added (e.g. `1`–`7` for the 7 animation triggers, `Q`/`W`/`E`/`R` for weapon tiers, `A`/`S`/`D`/`F` for armour tiers), document in closing notes. | D18.Q8 |

These decisions are the **plan ratification contract**. Engineer
proceeds to WP-A implement on this basis; further architecture
changes require PM/Outcome🧭Steward sign-off before commit.

---

## 8. Recommended Job Sequence

1. **Plan job (this artifact).** PM/Outcome🧭Steward reviews and
   records this spec at `docs/project/phases/render-rnd/round-6-
   showroom-spec.md`.
2. **Plan review (DONE — three reviews + amendment pass).** §7 is
   now a ratified-decisions table (D18, Q1–Q8 binding). The
   amendment pass folded D9–D17 into the spec sections noted in the
   verdict footer. No further plan pass required.
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
treats it as a contract. §7 is now a ratified-decisions table
(D18) — not open questions. Anything substantively changing the
architecture or success criteria as implementation progresses must
come back through PM/Outcome🧭Steward before commit.*

---

## Plan Review Verdict — RATIFIED (post-amendment)

**Verdict: APPROVED for WP-A dispatch.**

This spec has been **amended in place** on 2026-05-27 (post-commit
`3036a28`) to fold in the convergent findings of three plan
reviews:

- [`round-6-showroom-spec-review.md`](./round-6-showroom-spec-review.md) — Review A (CHANGES_REQUESTED, 2 High + 4 Med)
- [`round-6-showroom-plan-review.md`](./round-6-showroom-plan-review.md) — Review B (CHANGES_REQUESTED, 2 High + 4 Med)
- [`round-6-review-readout.md`](./round-6-review-readout.md) — Review C (PASS, 1 Med + 2 Low)

**Nine ratified amendments (D9–D17 on the assignment ADR log) are
folded into the sections noted; the corresponding `§7` open
questions are now ratified decisions (D18, Q1–Q8 binding):**

| Amendment | Sections amended | ADR |
|---|---|---|
| Factory `base_scale: float` parameter; `CHARACTER_MODEL_SCALE := 0.21` stays in `EntityRenderer.gd` line 3 verbatim | §3.1.3, §3.2.1 step 4, §5 WP-A item 1, §6 item 1 | D9 |
| Synthetic showroom map widens to `{w:32, h:12}` (covers 11.2-unit row) | §3.2.1 step 4, §3.2.4, §5 WP-B item 11, §6 item 4 | D10 |
| Death-clip end-pose via `animation_finished` → `player.pause()`; **no `Animation.loop_mode` mutation** | §3.2.2, §5 WP-B item 4, §6 item 5 | D11 |
| ±15% AABB band assertion is MANDATORY inside `audit-character-scales.gd --assert` (non-zero exit) — invoked by `npm test` when `GODOT_BIN` set | §3.1.4, §3.1.5, §5 WP-A items 3 & 6, §6 items 1 & 10 | D12 |
| AABB measurement: pose-lock to idle@0 (or T-pose); merge `mesh.global_transform * mesh.get_aabb()` across visible MeshInstance3D descendants | §3.1.4 | D13 |
| Structured resolver dict: `resolve_animation_clip(...) -> {clip, requested_kind, resolved_kind, is_fallback}` | §3.2.2, §3.2.3, §3.2.6, §5 WP-B items 4 & 7, §6 items 5 & 6 | D14 |
| CameraRig locked to `MODE_FREE` in Showroom (`lock_free_mode` field or Showroom-side gating; never reaches `MODE_ANCHORED`) | §3.2.1 step 5, §3.2.7, §5 WP-B item 8, §6 item 8 | D15 |
| Tier→asset mapping by manifest `asset.tier` numeric field, no hardcoded names | §3.2.5, §5 WP-B item 6, §6 item 7 | D16 |
| §3.2.6 sample code uses `animation_state_for_character` accessor; no direct `registered_characters` read | §3.2.6, §5 WP-B item 7 | D17 |
| §7 rewritten as ratified-decisions table (Q1–Q8 binding) | §7 | D18 |

Engineer treats this amended spec as the implementable contract.
Proceed to **WP-A dispatch** — no further plan pass required. If
implementation surfaces a substrate constraint that conflicts with
these ratified decisions, escalate via PM/Outcome🧭Steward before
deviating.
