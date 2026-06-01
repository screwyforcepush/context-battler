# Round 9 Closing Readout - Locked Body Adherence Breadth

Date: 2026-06-01
Scope: `throwaway-prototypes/d-full-match/**`

## Outcome

Round 9 reverts the Round-8.1 body-swap axis and restores one universal
Mesh2Motion substrate body for all eight personas:

- Body file: `characters/camper-mesh2motion-human-base.glb`
- Source key shown in every Showroom cell: `mesh2motion`
- Manifest schema: `8`
- Persona body substitution field: absent from the manifest and runtime source
- Deleted foreign body GLBs/textures: Quaternius Shaun/Anne/Henry/Pirate
  Captain, Kenney trader/sprinter, Kaykit knight, and their extracted character
  texture sidecars

The varied signal is now the adhering treatment layer, not the body.

## Showroom Controls

The Showroom exposes global row controls for:

- Skin on/off
- Gore on/off
- Weapons on/off
- Armour on/off
- Weapon attach mode: dynamic hand bone vs static root socket
- Armour mode: modular prop vs armour as paint

The animation row remains independent. Death now plays the death clip only;
gore is controlled solely by the Gore toggle, so the same treatment can be
checked on idle, walk/attack, and death.

## Layer Matrix

| Layer | Approach A | Approach B | Extra Coverage | Notes |
|---|---|---|---|---|
| Skin | `uv_painted` materials/shaders on the skinned body | `bone_attached` sticker decals | - | Round-8 data reused. |
| Gore | `bone_attached` QuadMesh/Decal marks | `uv_painted` corpse materials | `mesh_baked` dismemberment | Round-8 data reused and decoupled from death. |
| Weapons | `dynamic_hand_bone` BoneAttachment3D | `static_root_socket` Node3D | - | Round-9 contrast path added. |
| Armour | `modular_submesh_prop` rigid props | `armor_as_paint` UV-painted material shift | - | Round-9 paint mode promoted from existing material-tier path. |

## Honest Limitations

| Layer | Approach | Expected adherence | Known limitation |
|---|---|---|---|
| Skin | `uv_painted` | Deforms with the body mesh. | Reads as paint; no added thickness. |
| Skin | `bone_attached` decals | Tracks the pinned bone. | Can slide/protrude across deforming skin because it is not multi-bone skinned. |
| Gore | `uv_painted` material | Deforms with the body mesh. | No geometric wound depth. |
| Gore | `bone_attached` marks | Tracks the pinned bone. | Can slide/protrude; web path uses QuadMesh fallback rather than native Decal. |
| Gore | `mesh_baked` dismemberment | Tracks by modifying skeleton/mesh state. | Macro body-state only; stump seams are expected. |
| Weapons | `dynamic_hand_bone` | Tracks the hand through attack/death clips. | Rigid prop can clip at extreme wrist bends. |
| Weapons | `static_root_socket` | Intentionally does not follow the hand. | Detachment during attack is the comparison signal, not a production choice. |
| Armour | `modular_submesh_prop` | Tracks a single bind bone. | Rigid prop protrudes/clips; it is not a true multi-bone skinned armour garment. |
| Armour | `armor_as_paint` | Deforms with the body mesh. | No plate thickness; metal bends like skin. |

## Verification

The final audit surface asserts:

- schemaVersion 8
- exactly one universal mesh2motion body for all personas
- no manifest or runtime source body substitution path
- per-layer adherence coverage for skin, gore, weapons, and armour
- runtime application paths for skin, gore, weapon attach modes, armour prop, and
  armour paint
- web export build

User UAT remains the Showroom inspection pass.
