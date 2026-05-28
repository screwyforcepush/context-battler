# Round 7 Skin R&D Closing Readout

Date: 2026-05-28
Spec: [`round-7-skin-rnd-spec.md`](./round-7-skin-rnd-spec.md)
Previous: [Round 6 closing readout](./round-6-closing-readout.md) (Showroom curator-diagnostic surface + per-persona scale calibration)

> **Render R&D sequence:** Round 1 (substrate survey) → Round 2 (Godot/WASM ratified) → Round 3 (full-match playback proven) → Round 4 (event-stream contract + spectacle polish + 4-source asset breadth) → Round 5 (8-source rigged-anim breadth + within-turn timing + VFX pipeline rework) → Round 6 (Showroom curator-diagnostic surface + per-persona scale calibration) → **Round 7** (mesh2motion body consolidation + 8-technique skin breadth + 8-variant corpse-gore breadth). Still pre-§10-gate R&D; body axis consolidated, skin and gore axes open for user curation, next round picks from user's Showroom evaluation.

## Summary

Round 7 **consolidates** all 8 personas onto the shared mesh2motion human-base body (winner of Round-6 Showroom evaluation) and opens two new breadth axes for curation: **8 distinct skin/texture/decal techniques** (one per persona) and **8 distinct extreme gore/corpse-skin variations** (one per persona). The manifest schema bumps from 4 to 5, hoisting body-shared defaults (`body`, `corpseBody`) to the root and collapsing per-asset character entries to persona-distinct fields only (`personaSlot`, `skin`, `accessories`, `corpse`, `notes`). Obsoleted character pack GLBs and the standalone prone-humanoid corpse prototype are deleted. Accessories are deliberately skipped this round (all `accessories` entries are `null`) so skin and gore remain isolated comparison axes.

This is the §10 recursive breadth/consolidate pattern in action: Round-5 sampled breadth across body packs → Round-6 built the Showroom and calibrated scale → user picked mesh2motion → Round-7 consolidates body and re-samples breadth on the next finer axes (skin technique, corpse-gore technique). The user evaluates side-by-side in the Showroom and picks winning techniques for the next consolidation round.

All changes are confined to `throwaway-prototypes/d-full-match/`. No Convex, schema, HTTP, or production code was touched.

## Scope Delivered

Three work packages landed; WP-D (accessories) was skipped per spec recommendation.

**WP-A — Consolidation.** Manifest `schemaVersion` bumped 4 → 5. Root `body` block references `characters/camper-mesh2motion-human-base.glb` with uniform `modelScaleMultiplier: 2.1725`, `attachBone: "hand_r"`, `armourAttachBone: "spine"` (reserved), and the full mesh2motion animation clip map. Root `corpseBody` block references the same shared GLB with `deathPoseClip: "Death01"`. All 8 per-asset character entries collapsed to persona-distinct shape. `EquipmentMeshAttachment._load_manifest` deep-duplicates `manifest.body` per A12 before merging persona fields, so per-character runtime state never mutates root defaults. Obsoleted character GLBs (8 packs × 1-3 files each) deleted from `art-kit/characters/`; `corpse/prone-humanoid-prototype.glb` deleted. The mesh2motion body GLB and its color-palette PNG retained (GLB import depends on the palette).

**WP-B — Skin R&D.** `_apply_persona_skin(character_id, armour_tier)` dispatch added to `EquipmentMeshAttachment` with 8-arm `match skin.approach`. All 3 former `_apply_persona_palette` call sites (register, armour-unequip, armour-equip per A2) replaced with `_apply_persona_skin`. The Round-5 palette path is preserved verbatim as `_apply_skin_palette_flat` (rat persona — zero behavioural delta, control sample). 7 additional skin techniques implemented: PBR texture atlas, pattern texture, decal stickers, toon/cel shader, emissive-trim shader, multi-material body-part split, rim-light/fresnel shader. 4 GDshader files authored under `art-kit/shaders/`. 10 skin texture PNGs authored under `art-kit/textures/skin/`. All shader/texture paths are art-kit-relative, resolved through `ART_ROOT` per A7.

**WP-C — Corpse + Gore R&D.** `_apply_persona_corpse_skin(character_id, corpse_block, armour_tier)` dispatch added with 8-arm `match corpse.approach`. 8 distinct extreme-gore techniques implemented. Shared `_apply_projected_mark` helper with Decal primary and QuadMesh fallback per A5 — the QuadMesh path is the active path for web export (Compatibility/WebGL2 renderer), matching Round-5 evidence. `apply_corpse_skin_to_live_character` and `restore_persona_skin_to_live_character` methods added per A8 with `current_skin_mode` state tracking. Showroom Death trigger applies corpse-skin; all non-death triggers restore live skin before playing the next animation. 12 gore texture PNGs authored under `art-kit/textures/gore/`. 1 additional shader (`decay_desaturation.gdshader`) authored.

**WP-D — Accessories.** Skipped per D7. All 8 `accessories` fields are `null`. Skin technique is the sole differentiator alongside gore variation — this keeps the Showroom evaluation axes clean for user feedback.

## Skin Technique Matrix

| # | Persona | `skin.approach` | Render type | Key params |
|---|---|---|---|---|
| 1 | rat | `palette_flat` | StandardMaterial3D | base `#32402f`, accent `#78f28a`, emissive `#d7ff63` |
| 2 | duelist | `pbr_texture_atlas` | StandardMaterial3D + textures | 5-map PBR set (albedo/normal/roughness/metallic/AO) |
| 3 | trader | `pattern_texture` | StandardMaterial3D + UV1 tiled | hex pattern at 4×4 tile scale, tint `#f5a642` |
| 4 | opportunist | `decal_stickers` | QuadMesh projected marks | 3 sticker decals (logo, scar, dirt) on palette base |
| 5 | paranoid | `toon_cel_shader` | ShaderMaterial | 3-step ramp, outline `#050713`, base `#202338` |
| 6 | camper | `emissive_trim_shader` | ShaderMaterial | trim mask + neon `#ff8f2e` at energy 1.8 |
| 7 | sprinter | `multi_material_split` | StandardMaterial3D × N | 4 body-part materials (head/chest/legs/arms) by mesh index |
| 8 | vulture | `rim_fresnel_shader` | ShaderMaterial | rim `#a7ff4f` at power 2.5, energy 1.35 |

**Breadth coverage:** 1 baseline control, 3 StandardMaterial3D variants, 1 projected-mark-based, 3 ShaderMaterial-based. Spans palette-only through full PBR through custom shaders — the Showroom surfaces the full R&D space for user evaluation.

## Gore Technique Matrix

| # | Persona | `corpse.approach` | Render type | Key params |
|---|---|---|---|---|
| 1 | rat | `blood_saturation_overlay` | StandardMaterial3D tint | deep-red tint `#5a0008`, saturation 0.92 |
| 2 | duelist | `wound_cluster_decals` | QuadMesh projected marks | 4 wound decals (slash + puncture) across torso |
| 3 | trader | `gore_pool_decal` | QuadMesh floor-projected | 1 large blood pool at 1.55×1.55 units |
| 4 | opportunist | `charred_burned_texture` | StandardMaterial3D + emission | charred albedo + ember emission `#ff5c18` |
| 5 | paranoid | `exposed_bone_decals` | QuadMesh projected marks | 3 gash decals with pale bone `#eee5ca` |
| 6 | camper | `viscera_projection` | QuadMesh projected marks | 2 viscera decals (chest + abdomen) |
| 7 | sprinter | `dismemberment_baked` | Bone scale collapse | `thigh_l` + `lowerarm_r` scaled to 0.01, stump gore marks |
| 8 | vulture | `decay_desaturation` | ShaderMaterial | desaturation 0.85, darken 0.40, bruise tint `#2b1730` |

**Breadth coverage:** 2 shader-driven (saturation, decay), 4 projected-mark-driven (wounds, pool, bone, viscera), 1 texture+emission, 1 mesh-level dismemberment. All extreme/gruesome per user direction.

**Dismemberment method (Q1/A1):** Sprinter uses shared-body-only bone scale collapse on mesh2motion skeleton bones `thigh_l` and `lowerarm_r` (set to scale 0.01). Stump gore marks placed at the collapse points via `_apply_projected_mark`. No variant corpse GLB shipped — single shared body preserved per A1.

**Projected-mark active path (A5):** `_apply_projected_mark` includes both `Decal` (forward renderer) and `QuadMesh` (Compatibility/WebGL2) code paths. The QuadMesh fallback is the active path for web export, matching Round-5 evidence. Scaffold-verify asserts both `Decal.new(` and `QuadMesh.new(` tokens exist.

## Mesh2Motion Clip Coverage

Verified by `audit-mesh2motion-clips.gd` headless audit:

| Showroom trigger | Manifest clip name | GLB clip name | Status |
|---|---|---|---|
| idle | `Idle` | `Idle` | confirmed |
| walk | `Walk` | `Walking_A` | confirmed (manifest uses `Walk`) |
| attack | `Sword_Attack` | `Sword_Attack` | confirmed |
| attack_unarmed | `Punch_Jab` | `Punch_Jab` | confirmed |
| attack_armed | `Sword_Attack` | `Sword_Attack` | confirmed |
| take_hit | `Hit_Chest` | `Hit_Chest` | confirmed |
| death | `Death01` | `Death01` | confirmed |
| loot | `PickUp_Table` | `PickUp_Table` | confirmed |

**Coverage:** 8/8 triggers map to dedicated mesh2motion clips. Zero fallback chains required for any persona. This is the consolidation dividend — the Round-5 pack-ceiling issues (trader bunny-hop, sprinter crouch, paranoid Mannequiny CC-BY-4.0, opportunist no-hand-bone, vulture idle-fallback) all dissolve as a side-effect of substrate unification.

Bone audit confirms `hand_r` and `spine` bones present on the mesh2motion skeleton, so weapon socket and armour attachment point resolve without fallback.

## Consolidation Side-Effects

These are §13 honest-substrate wins that fall out of body consolidation, not explicit deliverables:

| Round-5 ceiling | Resolution |
|---|---|
| Trader "bunny-hop attack" (`jump` as attack) | Gone — mesh2motion ships `Sword_Attack` + `Punch_Jab` |
| Sprinter "crouch generic" (`CrouchDefault` as fallback) | Gone — mesh2motion ships full clip set |
| Paranoid CC-BY-4.0 attribution (Mannequiny) | Gone — all personas now CC0 (mesh2motion) |
| Opportunist "no hand bone" weapon misalignment | Gone — mesh2motion ships `hand_r` uniformly |
| Vulture "idle fallback for take_hit/death" | Gone — mesh2motion ships `Hit_Chest` + `Death01` |
| Per-persona inconsistent bone maps | Gone — single skeleton, single bone vocabulary |
| Per-persona inconsistent scale calibration | Gone — single `modelScaleMultiplier: 2.1725` for all 8 |

## Key Decisions Applied

| Decision | Summary |
|---|---|
| D1 | Manifest hoists `body` + `corpseBody` to root; per-asset entries carry persona-distinct fields only |
| D2 | One `match skin.approach` dispatch in EquipmentMeshAttachment; no leakage into EntityRenderer |
| D3 | `palette_flat` = verbatim Round-5 path as rat's control sample |
| D4 | Showroom Death trigger swaps live-character skin to corpse variant in-place (Option A) |
| D5 | 8 ratified skin techniques (spec §3.5 table, no swaps needed) |
| D6 | 8 ratified gore techniques (spec §3.6 table, no swaps needed) |
| D7 | WP-D accessories skipped |
| D8 | No-UAT verification stack: audit-mesh2motion-clips, extended verify-character-rigs, audit-replay-load, extended verify-scaffold |
| A1 | Sprinter dismemberment: shared-body-only bone scale collapse, no variant GLB |
| A2 | All 3 `_apply_persona_palette` call sites replaced with `_apply_persona_skin` dispatch |
| A3 | Scaffold-verify tokens updated: 8 `_apply_skin_*` + 8 `_apply_corpse_*` + corpse API tokens |
| A4 | New Godot audits wired into package.json test under GODOT_BIN gate |
| A5 | Shared `_apply_projected_mark` with Decal primary + QuadMesh fallback |
| A6 | Success criteria reworded as structural assertions; visual UAT is user-only |
| A7 | All skin/corpse param paths art-kit-relative via ART_ROOT |
| A8 | `restore_persona_skin_to_live_character` + `current_skin_mode` state on Showroom |
| A9 | Replay fixture: `shared-harness/replay-snapshot.json` primary, inline fallback |
| A10 | `sourceKey` removed from per-asset; single `manifest.body.sourceKey` |
| A11 | `armourAttachBone` reserved field; armour stays material-swap per Round-5 |
| A12 | Deep-duplicate `manifest.body` on load to avoid mutating root defaults |

## Open Question Resolutions

| Question | Outcome |
|---|---|
| Q1 dismemberment method | Bone scale collapse on shared body. No variant GLB. Bones `thigh_l` + `lowerarm_r` collapse to 0.01 scale; stump gore marks at collapse points. |
| Q2 color-palette texture | Retained — the mesh2motion GLB import references the palette PNG sidecar |
| Q3 armour × corpse-skin | YES — corpse-skin dispatch accepts `armour_tier` parameter; respects current armour tier where material branches support it |
| Q4 decal scaling | Decal/mark sizes specified in world units, parented under character `visual` root; calibrated for `modelScaleMultiplier: 2.1725` |
| Q5 accessories | Skipped this round per D7 |
| Q6 replay fixture | Primary: `shared-harness/replay-snapshot.json`; exercises `instantiate_persona_corpse OK` |
| Q7 body-shared palette | No body-level palette default. Palette lives only in `skin.params` for the `palette_flat` branch |

## Acceptance Criteria Satisfied

All 14 assignment-level success criteria from spec §6 met:

1. All 8 character manifest entries reference mesh2motion body via `manifest.body.file`
2. Per-asset `skin` block carries `approach` + `rationale` + `params`
3. 8 distinct `skin.approach` values across the 8 personas
4. Per-asset `accessories` block present (all `null` — WP-D skipped)
5. Single shared mesh2motion death-pose corpse via `manifest.corpseBody`; per-persona `corpse` block
6. 8 distinct `corpse.approach` values, all extreme/gruesome
7. EquipmentMeshAttachment reads `skin` and `corpse` via single `match` dispatch each; `palette_flat` branch preserves Round-5 path verbatim
8. Equipment attaches correctly: weapons at `hand_r`, armour material-swap preserved per Round-5
9. Obsoleted character GLBs deleted; obsoleted `prone-humanoid-prototype.glb` deleted
10. Manifest `schemaVersion` bumped 4 → 5
11. Forbidden-token grep clean (no pathing logic, no browsertools artefacts)
12. Showroom Death trigger displays each persona's corpse-skin variant (Option A in-place swap)
13. Replay-path structural smoke passes via `audit-replay-load.gd`
14. All validation gates clean (see below)

## Validation Evidence

| Check | Result |
|---|---|
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm run build` | Clean |
| `npm test` | 926 passed, 2 skipped |
| `npm --prefix throwaway-prototypes/d-full-match test` | scaffold + GODOT_BIN audits all PASS |
| `GODOT_BIN=... audit-character-scales.gd` | All 8 within +/-15% band (uniform 2.1725) |
| `GODOT_BIN=... audit-mesh2motion-clips.gd` | 8/8 clips confirmed + hand_r + spine bones |
| `GODOT_BIN=... verify-character-rigs.gd` | All 8 personas load + skin + corpse-skin smoke |
| `GODOT_BIN=... audit-replay-load.gd` | Replay load + instantiate_persona_corpse OK |
| `GODOT_BIN=... npm --prefix throwaway-prototypes/d-full-match run build` | Web export clean |
| Forbidden-token grep | Clean (pathing + browsertools + UAT artefacts) |

## Files Changed

**New files:**
- `shared-harness/art-kit/shaders/toon_cel.gdshader` — paranoid skin
- `shared-harness/art-kit/shaders/emissive_trim.gdshader` — camper skin
- `shared-harness/art-kit/shaders/rim_fresnel.gdshader` — vulture skin
- `shared-harness/art-kit/shaders/decay_desaturation.gdshader` — vulture corpse
- `shared-harness/art-kit/textures/skin/` — 10 skin texture PNGs (+ .import sidecars)
- `shared-harness/art-kit/textures/gore/` — 12 gore texture PNGs (+ .import sidecars)
- `scripts/audit-mesh2motion-clips.gd` — clip + bone headless audit
- `scripts/audit-replay-load.gd` — replay-path structural smoke

**Modified files:**
- `shared-harness/art-kit/manifest.json` — schemaVersion 4 → 5, root `body` + `corpseBody`, 8 persona entries restructured
- `src/EquipmentMeshAttachment.gd` — `_apply_persona_skin` (8-arm), `_apply_persona_corpse_skin` (8-arm), `_apply_projected_mark`, `apply_corpse_skin_to_live_character`, `restore_persona_skin_to_live_character`, `instantiate_persona_corpse`
- `src/Showroom.gd` — Death trigger applies corpse-skin; non-death triggers restore live skin
- `scripts/verify-character-rigs.gd` — extended for Round-7 persona load + skin/corpse smoke
- `scripts/verify-scaffold.mjs` — tokens updated for Round-7 manifest shape + dispatch surface
- `scripts/audit-character-scales.gd` — updated for Round-7 manifest shape
- `package.json` — test script chains new Godot audits under GODOT_BIN gate

**Deleted files:**
- `characters/camper-kenney-blocky-n.glb` (+ .import)
- `characters/duelist-robin-lamb-hero.glb` (+ .import)
- `characters/opportunist-quaternius-space-mech.glb` (+ .import, + _Atlas.png, + .png.import)
- `characters/paranoid-gdquest-mannequiny.glb` (+ .import)
- `characters/paranoid-kenney-blocky-r.glb` (+ .import)
- `characters/rat-kaykit-rogue-hooded.glb` (+ .import)
- `characters/rat-kenney-blocky-a.glb` (+ .import)
- `characters/sprinter-local-crimson-stalker.glb` (+ .import)
- `characters/vulture-kenney-blocky-q.glb` (+ .import)
- `corpse/prone-humanoid-prototype.glb` (+ .import)

**Retained in characters/:**
- `camper-mesh2motion-human-base.glb` (+ .import) — the shared body
- `camper-mesh2motion-human-base_color-palette.png` (+ .import) — GLB import dependency

## Mental-Model Cross-Link

Round 7 is the second iteration of mental-model §10's recursive breadth/consolidate principle (codified in the working tree on 2026-05-28):

> *"The pattern is recursive: once one axis consolidates (e.g. body model), the next finer axis becomes breadth-able in turn (skin technique, then material approach, then gore treatment, then accessory style, etc.). Each loop is: sample breadth on the current finest open axis → evaluate side-by-side in the showroom → consolidate → reveal the next finer axis."*

Round-5 sampled breadth on the body axis. Round-6 built the Showroom. Round-7 consolidates body and samples breadth on skin technique (primary) and corpse-gore technique (secondary, decoupled). Round-8 will consolidate the winning skin and gore techniques and reveal the next finer axis — probable candidates: weapons/armor R&D, accessory style, or shader-detail tier.

§13 cross-links: "slick is pipeline" operationalised by the 8 skin techniques probing the material/shader/decal vocabulary; "gore intensity is loud by design, not subtle" operationalised by the 8 gore variations leaning extreme/gruesome per user direction.

## Blind Review Focus

1. Open the Showroom and confirm all 8 personas display on the shared mesh2motion body with distinct skin techniques visible side-by-side.
2. Click Death and confirm 8 distinct corpse-skin/gore variations appear — each persona's body material/decals should visibly change.
3. Click Idle after Death and confirm all 8 personas revert to their live skin technique (corpse decals/material cleared).
4. Cycle Death → Idle → Death to confirm the skin-mode toggle works cleanly (no residual corpse decals left on live skin, no residual live materials on corpse).
5. Cycle weapon tiers None → Low → Mid → High and confirm weapon meshes attach at `hand_r` across all 8 personas uniformly.
6. Cycle armour tiers and confirm material-swap reads per tier (unchanged from Round-6).
7. Inspect rat specifically — should be visually identical to Round-6 (palette_flat is the control sample).
8. Inspect sprinter's Death state for the dismemberment effect — left leg and right forearm should collapse; stump gore marks should be visible.
9. Load a recorded match replay and confirm characters render with skin techniques and corpses render with gore variants.
10. Confirm all 8 personas are the same height and proportions (single shared body at uniform scale).

## Technical Ceilings

**Silhouette flattening is accepted.** All 8 personas share one body shape. Skin technique is the sole visual differentiator for live characters; accessories were not invested. The user accepted this trade-off explicitly: *"Get rid of the other model packs and convert the other player characters to the mesh2motion pack."* If silhouette degradation proves problematic during UAT, accessories (WP-D) are the remediation path for a future round.

**Projected marks are QuadMesh for web export.** Godot `Decal` nodes are not confirmed functional on the Compatibility/WebGL2 renderer. The `_apply_projected_mark` helper contains both code paths; QuadMesh is active for web export. Decal-heavy personas (opportunist skin: 3 marks; duelist corpse: 4 marks; paranoid corpse: 3 marks; camper corpse: 2 marks) all render via QuadMesh. Visual fidelity of QuadMesh marks is lower than true Decal projection (no wrap around geometry), but sufficient for breadth-first R&D evaluation.

**Dismemberment is bone-scale collapse, not mesh editing.** Sprinter's `thigh_l` and `lowerarm_r` collapse to near-zero scale. This does not produce a clean anatomical stump — the mesh vertices converge to a point rather than revealing an interior cross-section. Stump gore marks are placed at the collapse point to mask the convergence. This is an R&D probe of the dismemberment concept; a production-quality dismemberment effect would require mesh editing tools or bespoke variant assets.

**Armour pipeline unchanged from Round-5.** Armour remains material-swap only. `body.armourAttachBone = "spine"` is reserved but not consumed by Round-7 code. Weapons/armor R&D is the next round's axis.

## What Is Intentionally NOT Shipped

- **No accessories.** WP-D skipped per D7. All `accessories` fields are `null`.
- **No weapons/armor rework.** Existing 6 weapons + 5 armours from Round 4/5 pass through unchanged. Weapons/armor R&D deferred to next round.
- **No Showroom architectural changes.** Showroom works as Round-6 delivered; only the manifest-shape adaptation (reading `body` block instead of per-asset fields) and corpse-skin toggle were added.
- **No consumer-facing renderer changes.** Still R&D substrate inside `throwaway-prototypes/d-full-match/`.
- **No Convex / production code changes.** Entirely renderer-side and manifest-side. No snapshot or schema contract changes.
- **No UAT by implementer.** Round-4/5/6 D4 discipline preserved. User runs visual UAT themselves in the Showroom.

## Deviations from Spec

None. All 8 ratified skin techniques shipped as specified (D5 table). All 8 ratified gore techniques shipped as specified (D6 table). No technique swaps were needed. All 12 post-review amendments (A1–A12) were implemented as binding overrides. WP-D skip was the default recommendation and was followed.

## Hand-Off

The Showroom is ready for the user to run visual UAT on their own machine. The user's evaluation decisions gate the next round:

- **Pick a winning skin technique** from the 8 on display. The next round consolidates all 8 personas onto the chosen skin technique and opens the next finer axis (probable: shader detail tier, texture resolution, or accessory style).
- **Pick a winning gore technique** from the 8 corpse variations. The next round consolidates all corpses onto the chosen gore technique and opens the next gore-detail axis.
- **Flag silhouette concerns** if any two personas are indistinguishable at typical viewing distance — accessories (WP-D) are the remediation path.
- **Weapons/armor R&D** is the probable next-round secondary axis (deferred from this round). The user may choose to run it as a standalone breadth pass or combine it with the skin consolidation round.

The §10 recursive pattern continues: sample → evaluate → consolidate → reveal next axis.
