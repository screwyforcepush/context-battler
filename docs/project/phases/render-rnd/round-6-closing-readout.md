# Round 6 Showroom Closing Readout

Date: 2026-05-27
Spec: [`round-6-showroom-spec.md`](./round-6-showroom-spec.md)
Previous: [Round 5 closing readout](./round-5-closing-readout.md) (8-source rigged-anim breadth + within-turn timing + VFX pipeline rework)

> **Render R&D sequence:** Round 1 (substrate survey) -> Round 2 (Godot/WASM ratified) -> Round 3 (full-match playback proven) -> Round 4 (event-stream contract + spectacle polish + 4-source asset breadth) -> Round 5 (8-source rigged-anim breadth + within-turn timing + VFX pipeline rework) -> **Round 6** (Showroom curator-diagnostic surface + per-persona scale calibration). Still pre-section-10-gate R&D; breadth-first sampling complete, user UATs locally via the Showroom, next round picked from user's curation decisions.

## Summary

Round 6 adds a **Showroom** mode to the d-full-match Godot prototype (commit `598be35`) and fixes the **per-persona scale inconsistency** flagged in Round-5 UAT. The Showroom is a side-by-side curator-diagnostic surface (mental-model section 10 -- "Breadth needs a dedicated viewing surface") that displays all 8 personas on a sample PBR environment with animation trigger buttons, equipment tier selectors, and a free-orbit camera. A new `modelScaleMultiplier` field on each character manifest entry normalises apparent height across packs via a deterministic headless AABB-median calibration. A factory extraction into `EquipmentMeshAttachment.instantiate_persona_character` unifies the character-loading path between the replay renderer and the Showroom -- single source of truth, no duplicate code.

All changes are confined to `throwaway-prototypes/d-full-match/`. No Convex, schema, HTTP, or production code was touched.

## Post-Review Refinements

Two final review refinements are part of the Round-6 closing contract:

- **D21 -- Armour selector uses manifest `visualTier` buckets.** Weapons remain mapped by manifest numeric `tier` because the weapon catalog is authored as the 1/2/3 equipment progression. Armour selector buckets map by manifest `visualTier` (`low`, `mid`, `high`) because armour numeric tiers are protection ordering, while the Showroom selector is a visual comparison surface. First representatives by manifest order are Low=`cloth`, Mid=`chain`, High=`plate`.
- **D22 -- No armed-coercion before fallback diagnostics.** The Attack (armed) trigger passes `attack_armed` through to the resolver so the ClipLabel exposes each pack's real fallback state instead of hiding it behind a no-weapon coercion to unarmed.

## Scope Delivered

Two work packages landed as a single sequential commit:

**WP-A -- Per-persona scale calibration.** Each of the 8 character manifest entries gained a `modelScaleMultiplier` field, calibrated against idle@0 AABB-median measurements. The factory `EquipmentMeshAttachment.instantiate_persona_character(persona, label, fallback_material, base_scale)` applies `base_scale * multiplier` at instance time. `EntityRenderer.CHARACTER_MODEL_SCALE := 0.21` remains declared once in `EntityRenderer.gd` line 3 (Round-5 scaffold lock at `verify-scaffold.mjs:209` preserved). Manifest `schemaVersion` bumped 3 -> 4 (art-kit only; replay snapshot `schemaVersion === 3` at `MatchPlayer.gd:73` untouched).

**WP-B -- Showroom scene.** New `scenes/Showroom.tscn` + `src/Showroom.gd`. Home-screen `MatchPicker` gained a Showroom button (`change_scene_to_file` pattern). Back button and `Esc` return to the picker. The Showroom instantiates all 8 personas through the same factory the replay uses, positioned in a row along the X axis at fixed 1.6-unit spacing on a synthetic `{w:32, h:12}` floor/wall/cover stage built through `SceneBuilder.build_from_snapshot`. Seven animation triggers and two equipment-tier selector rows (weapon + armor, 4 tiers each) fire across all personas simultaneously. Per-character `Label3D` shows persona name, source key, and active clip (with fallback annotation). CameraRig locked to `MODE_FREE` for orbit/pan/zoom inspection.

## Per-Persona Scale Calibration

Calibration target: **median idle@0 source height 3.9748 units.** Post-scale heights: 3.9745--3.9750 (within the mandatory +/-15% band). Multipliers clamped to `[0.4, 3.0]`.

| Persona | Source key | idle@0 source height | modelScaleMultiplier | Post-scale height |
|---|---|---:|---:|---:|
| rat | kaykit | 2.6688 | 1.4894 | 3.9748 |
| duelist | robin-lamb | 6.6452 | 0.5981 | 3.9745 |
| trader | interglactic | 3.7740 | 1.0532 | 3.9748 |
| opportunist | quaternius | 5.2077 | 0.7633 | 3.9750 |
| paranoid | gdquest | 1.7979 | 2.2108 | 3.9750 |
| camper | mesh2motion | 1.8296 | 2.1725 | 3.9748 |
| sprinter | xcvg-systems | 4.1756 | 0.9519 | 3.9748 |
| vulture | styloo | 8.1073 | 0.4903 | 3.9750 |

The headless audit script `scripts/audit-character-scales.gd` runs in `--assert` mode via `npm --prefix throwaway-prototypes/d-full-match test` when `GODOT_BIN` is set, exiting non-zero on any band violation.

**Known curator-diagnostic signal (not a regression):** opportunist uses `attachBone-fallback:handOffset` (Quaternius mech, no hand bone) so weapon socket is parented at root-space offset. Under `modelScaleMultiplier = 0.7633` the body shrinks but the weapon offset stays fixed -- visible misalignment is expected and signals the pack lacks a hand bone. Pack-swap territory, not Round-6 scope.

## Clip Resolution -- Extended for Showroom

Round 6 adds optional manifest keys `attack_unarmed`, `attack_armed`, `take_hit`, and `death` where the source pack ships matching clips. A structured fallback resolver in `EquipmentMeshAttachment` returns `{clip, requested_kind, resolved_kind, is_fallback}` so the Showroom's per-character ClipLabel surfaces which packs resolved via fallback.

Fallback chains: `attack_armed` -> `attack` -> `generic`; `attack_unarmed` -> `attack` -> `generic`; `take_hit` -> `generic` -> `idle`; `death` -> `take_hit` -> `generic` -> `idle`.

| Persona | Idle | Walk | Attack (unarmed) | Attack (armed) | Loot | Take hit | Death |
|---|---|---|---|---|---|---|---|
| rat | `Idle` | `Walking_A` | `Unarmed_Melee_Attack_Punch_A` | `Dualwield_Melee_Attack_Chop` | `PickUp` | `Hit_A` | `Death_A` |
| duelist | `idle` | `walk` | `attack`* | `attack` | `jump`* generic | `hurt` | `die` |
| trader | `idle` | `walk` | `attack`* | `attack`* | `jump`* generic | `idle`* fallback | `idle`* fallback |
| opportunist | `RobotArmature\|Idle` | `RobotArmature\|Walk` | `RobotArmature\|Punch` | `RobotArmature\|Shoot_Big` | `RobotArmature\|Pickup` | `RobotArmature\|HitReact` | `RobotArmature\|Death` |
| paranoid | `idle` | `run` | `fight_punch` | `fight_punch`* | `fight_kick`* generic | `idle`* fallback | `idle`* fallback |
| camper | `Idle` | `Walk` | `Sword_Attack`* | `Sword_Attack` | `PickUp_Table` | `Hit` | `Death` |
| sprinter | `Armature\|Standing` | `Armature\|Run` | `Armature\|Punch` | `Armature\|Punch`* | `Armature\|CrouchDefault`* generic | `Armature\|Standing`* fallback | `Armature\|Standing`* fallback |
| vulture | `iddle` | `walking` | `attackwithhand` | `attackwithhand`* | `grab` | `iddle`* fallback | `iddle`* fallback |

`*` = resolved via fallback chain. Entries marked `fallback` surface as frozen idle pose in the Showroom -- a highly visible diagnostic signal that the pack lacks that clip kind. These are curation candidates for a future pack-swap round, not Round-6 scope.

## Equipment Tier Representatives

Tier-to-asset mapping is manifest-driven, not hardcoded. Weapon selector buckets use manifest numeric `asset.tier`; armour selector buckets use manifest `asset.visualTier` because numeric armour tiers are protection ordering rather than the Showroom's Low/Mid/High visual bucket. First-in-manifest-order representative per UI tier:

| Category | None (0) | Low (1) | Mid (2) | High (3) |
|---|---|---|---|---|
| Weapon | _(empty)_ | `rusty_blade` | `sword` | `greatsword` |
| Armor | _(empty)_ | `cloth` | `chain` | `plate` |

## Showroom Controls Reminder

- **Animation triggers (7 buttons):** Idle, Walk, Attack (unarmed), Attack (armed), Loot, Take hit, Death. Each fires across all 8 personas simultaneously.
- **Weapon tier:** None / Low / Mid / High selector row.
- **Armor tier:** None / Low / Mid / High selector row. Armor renders as material-change on the character mesh (Round-5 contract).
- **Camera:** Left-drag orbits, right-drag pans, wheel zooms. Locked to free mode (no anchored toggle).
- **Back / Esc:** Returns to MatchPicker home screen.
- **Labels:** Each persona has a top `NameLabel` (persona + sourceKey) and a bottom `ClipLabel` (active clip name, annotated with fallback info when the resolved clip differs from the requested kind).

Death-pose hold: the death clip plays once and pauses on its last frame via `animation_finished` -> `player.pause()`. No cached `Animation.loop_mode` mutation anywhere. Any subsequent trigger supersedes the paused state.

## Key Decisions Applied

The D9--D18 spec amendments from the three plan reviews held. Post-review D21/D22 are included because they correct Showroom diagnostic policy without changing the ratified scope:

| Decision | Summary |
|---|---|
| D9 | Factory `base_scale: float` parameter; `CHARACTER_MODEL_SCALE` stays in `EntityRenderer.gd` line 3 verbatim |
| D10 | Synthetic showroom map `{w:32, h:12}` -- floor covers the 11.2-unit row |
| D11 | Death hold via `animation_finished` -> `pause()`; no `Animation.loop_mode` mutation |
| D12 | +/-15% AABB band assertion mandatory in `audit-character-scales.gd --assert` (non-zero exit) |
| D13 | AABB measured with `global_transform * get_aabb()`, pose-locked to idle@0 |
| D14 | Structured resolver returns `{clip, requested_kind, resolved_kind, is_fallback}` |
| D15 | CameraRig locked to `MODE_FREE` in Showroom |
| D16 | Manifest-driven equipment selectors, no hardcoded names; weapons use numeric `asset.tier`, armour visual buckets use `asset.visualTier` per D21 |
| D17 | `animation_state_for_character()` accessor; Showroom does not read `registered_characters` directly |
| D18 | All 8 section-7 open questions ratified (Q1--Q8 binding) |
| D21 | Armour selector maps UI buckets by manifest `visualTier`; first representatives are Low `cloth`, Mid `chain`, High `plate` |
| D22 | Attack (armed) dispatches `attack_armed` unchanged so resolver fallback state reaches ClipLabel; no no-weapon coercion to unarmed |

## Acceptance Criteria Satisfied

All 13 MUST criteria from the north star met:

1. Home screen exposes Showroom button (MatchPicker)
2. Showroom instantiates all 8 personas via the shared factory -- single source of truth
3. Per-character text label (persona name + sourceKey)
4. Sample environment visible (wall, cover, floor) using Round-5 PBR materials via SceneBuilder
5. 7 animation triggers fire across all 8 characters simultaneously
6. Per-character active-clip-name Label3D visible during playback (with fallback annotation)
7. Equipment tier selectors: Weapon {none, low, mid, high}, Armor {none, low, mid, high}
8. Weapon meshes attach at manifest-declared hand offset/bone via EquipmentMeshAttachment
9. Per-asset `modelScaleMultiplier` on all 8 character manifest entries; calibrated
10. EntityRenderer reads the multiplier via factory, applies `CHARACTER_MODEL_SCALE * multiplier`
11. Camera: free orbit + zoom
12. Back/Esc returns to home screen
13. Scale fix applies in BOTH Showroom AND replay path (shared manifest + shared factory)

## Validation Evidence

| Check | Result |
|---|---|
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm run build` | Clean |
| `npm test` | 926 passed, 2 skipped |
| `npm --prefix throwaway-prototypes/d-full-match test` | 918 PASS (scaffold) |
| `GODOT_BIN=... audit-character-scales.gd --assert` | All 8 within +/-15% band |
| `GODOT_BIN=... npm --prefix throwaway-prototypes/d-full-match run build` | Web export clean |
| Forbidden-token grep (pathing logic + browsertools) | Clean |

## Mental-Model Cross-Link

The Showroom is the concrete realisation of mental-model section 10's "Breadth needs a dedicated viewing surface" bullet (landed in the working tree as part of Round-6 pre-dispatch). The user is the building agent for the asset-curation loop; the Showroom is their diagnostic tool, not a player-facing surface and not the consumer-render era.

## Blind Review Focus

1. Open the Showroom from the home screen and confirm all 8 personas are visible in a side-by-side row with NameLabels.
2. Click each of the 7 animation triggers -- confirm all 8 characters play simultaneously, ClipLabels update, and fallback annotations appear where expected (trader death -> idle, vulture take_hit -> idle, etc.).
3. Cycle through weapon tiers None -> Low -> Mid -> High and confirm weapon meshes swap on all personas.
4. Cycle through armor tiers and confirm material-change reads per tier (not a separate floating mesh).
5. Click Death and confirm the end pose holds (frozen, not looping). Click Idle and confirm recovery from the paused state.
6. Inspect the 8-persona line-up for scale consistency -- camper, paranoid, and sprinter should now be roughly the same height as the other 5.
7. Orbit, pan, and zoom the camera freely; confirm no anchored-mode drift (KEY_C should be inert).
8. Press Back or Esc and confirm return to MatchPicker; load a real match and confirm the replay path still works with the calibrated scale.
9. Inspect opportunist's weapon attachment for the known root-offset misalignment (not a regression -- pack lacks hand bone).

## Technical Ceilings

Trader uses `jump` as both attack and generic action clip (the CC0 source ships only idle/walk/jump) and falls back to `idle` for take_hit and death. Paranoid and sprinter similarly lack dedicated take_hit and death clips. Vulture lacks take_hit and death. These fallback chains produce frozen-idle poses that are highly visible diagnostic signals via the ClipLabel. They are curation candidates for a future pack-swap round; the Showroom exists precisely to evaluate them.

Socket attachment quality remains mixed across packs (no shared humanoid bone map). The manifest records `attachBone` metadata and the runtime falls back to stable hand offsets when a bone is missing.

Gore (blood pools, dismemberment chunks) is excluded from the Showroom Take hit / Death triggers per D4/D6 -- the user's verbatim ask targeted asset/anim/equipment curation, not gore evaluation. Gore remains on the replay path only.

## What Is Intentionally NOT Shipped

- **No new character packs.** The Showroom uses the existing 8 Round-5 personas. Pack curation/swaps are a separate later round, gated on what the user decides from this Showroom evaluation.
- **No gore on Take hit / Death** (D4/D6). Showroom is the asset/anim curation surface, not a gore evaluation tool.
- **No consumer-facing renderer changes.** This is still R&D substrate inside `throwaway-prototypes/d-full-match/`.
- **No Convex / production code changes.** Showroom is renderer-only; no snapshot, no HTTP, no schema change.
- **No UAT by implementer.** Round-4/5 D4 discipline preserved. User runs visual UAT themselves.

## Hand-Off

The Showroom is ready for the user to run visual UAT on their own machine. The Round-5 pack-ceiling signals remain in scope to evaluate via the Showroom but are explicitly NOT fixed here:

- **Trader "bunny-hop attack"** -- `jump` clip used as attack/generic (source-pack ceiling).
- **Sprinter "crouch generic"** -- `CrouchDefault` used as generic action stand-in (source-pack ceiling).
- **Paranoid Mannequiny CC-BY-4.0 attribution** -- manifest preserves full attribution; user decides whether to keep or swap for a CC0 alternative.
- **Mid-turn attack-while-gliding** -- spec-compliant per Round-5 D11 (render reads engine truth; movement interpolation is continuous, action events fire at `ACTION_PHASE_START`).

The user's curation decisions from this Showroom evaluation will gate the next round's scope (pack swaps, clip upgrades, or direction change).
