# Round 12 Closing Readout - Recover & Correct

Date: 2026-06-01
Spec: [`round-12-recover-and-correct-spec.md`](../../docs/project/phases/render-rnd/round-12-recover-and-correct-spec.md)
Previous: [`ROUND-11-CLOSING-READOUT.md`](./ROUND-11-CLOSING-READOUT.md)
R10 reference: manifest at commit `e42e23b`
Scope: `throwaway-prototypes/d-full-match/**` only

## Outcome

Round 12 restores the exact Round-10 persona instances that Round 11
homogenized, then reapplies only the accepted Round-11 deltas: UV2 full-body
texture coverage, amplified small gore where it is not replacing a validated
extreme, dynamic-bone modular armour, and the three new CC0 armour props.

The shared Mesh2Motion body remains locked for all eight personas.

## Recovered Look Diff

| Persona | R10 skin | Round 12 skin | R10 live corpse | Round 12 live corpse |
|---|---|---|---|---|
| rat | `palette_flat` palette `#32402f/#78f28a/#d7ff63` | restored verbatim | `blood_saturation_overlay` | accepted Round-11 delta: `small_bone_attached_marks`, 11 marks |
| duelist | `pbr_texture_atlas`, MetalPlates 5-map atlas, `uv1_scale [1,1]` | restored atlas maps, UV2 full-body path, `uv2_scale [6,6]`, sampler `repeat_enable` | `wound_cluster_decals`, 8 marks | accepted Round-11 delta: `small_bone_attached_marks`, 11 marks |
| trader | `pattern_texture`, Fabric029, `uv1_scale [1.45,1.45]` | restored params on UV2, `uv2_scale [1.45,1.45]` | `gore_pool_decal` | accepted Round-11 delta: `small_bone_attached_marks`, 11 marks |
| opportunist | `pattern_texture`, TheNess body texture, `uv1_scale [1,1]` | restored params on UV2, `uv2_scale [1,1]` | `charred_burned_texture` | accepted Round-11 delta: `small_bone_attached_marks`, 11 marks |
| paranoid | `toon_cel_shader` | restored verbatim | `exposed_bone_decals`, 8 marks | accepted Round-11 delta: `small_bone_attached_marks`, 11 marks |
| camper | `emissive_trim_shader` | restored verbatim | `viscera_projection`, 7 decals, `organColor #740016` | restored first 7 decals + `organColor #740016`, amplified to 18 decals within the 0.12 cap |
| sprinter | `multi_material_split` | restored verbatim | `dismemberment_baked`, `hideBones [thigh_l, lowerarm_r]`, stumps `0.34x0.28` and `0.30x0.24`, `fallbackBoneScale 0.01` | restored verbatim on the live corpse path; no separate universal deathTreatment |
| vulture | `rim_fresnel_shader` | restored verbatim | `decay_desaturation` | accepted Round-11 delta: `small_bone_attached_marks`, 11 marks |

The skin layer now has all seven structural R10 approaches across eight
personas (`pattern_texture` appears for trader/opportunist as in R10), and the
scaffold asserts every persona's skin params are distinct. Duelist and trader
are no longer variations of one shared shader route: duelist is the MetalPlates
PBR atlas; trader is the Fabric029 pattern texture.

## Armour Fit Table

| Prop | Slot | fitScale | propOffset | Notes |
|---|---|---:|---|---|
| Quaternius Metal Cuirass | chest | `0.38` | `[0,0,0]` | existing validated size pinned |
| Quaternius Crown Helmet | helmet | `0.38` | `[0,0,0]` | existing validated size pinned |
| Quaternius Left Gauntlet | gauntlet | `0.38` | `[0,0,0]` | existing validated size pinned |
| Quaternius Leather Cuirass | chest | `0.38` | `[0,0,0.055]` | new Round-11 prop visible via selector |
| Quaternius Black Cuirass | chest | `0.40` | `[0,0,0.055]` | new Round-11 prop visible via selector |
| Lucian Pavel Bucket Helmet | helmet | `0.42` | `[0,-0.58,-0.03]` | new Round-11 prop visible via selector |

Runtime now applies `fitScale` to the source-local mesh transform and then
applies `propOffset` in socket-local space under the live `BoneAttachment3D`.
The new `audit-armour-prop-aabb.gd` selects each new prop, attaches it to a
live body, and asserts nonzero world AABB, sensible prop/body ratio, near-body
placement, and non-buried slot center.

## Audit Changes

- `verify-scaffold.mjs` now rejects Round-11 homogenization: all-identical
  skin params, missing duelist PBR maps/tiling/repeat mode, camper downgraded
  from `viscera_projection`, sprinter downgraded from live
  `dismemberment_baked`, missing `fitScale/propOffset`, legacy `propScale`, and
  skipped Godot audits.
- `audit-skin-bone-attachments.gd` and `audit-adherence-matrix.gd` now branch
  live gore by approach, so sprinter dismemberment is validated by hide bones
  and R10 stump sizes instead of small-mark assertions.
- `audit-modular-submesh-armor.gd` validates `fitScale/propOffset` and pins the
  existing props at `0.38`.
- `package.json` hard-fails when `GODOT_BIN` is unset; a skipped native audit
  no longer reads as a pass.

## Verification

- `npm run lint` - PASS
- `npm run typecheck` - PASS
- `npm test` - PASS (`53` files passed, `1` skipped; `926` tests passed, `2` skipped)
- `npm run build` - PASS
- `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match test` - PASS, including the new armour AABB audit
- `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match run build` - PASS

## UAT Boundary

No automated UAT job was added. The exported Showroom is the user visual gate
for final duelist tiling taste, gore loudness, and armour prop comparison.
