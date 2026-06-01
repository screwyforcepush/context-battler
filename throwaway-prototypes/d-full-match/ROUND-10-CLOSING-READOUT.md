# Round 10 Closing Readout - Adherence Consolidation

Date: 2026-06-01
Spec: [`round-10-adherence-consolidation-spec.md`](../../docs/project/phases/render-rnd/round-10-adherence-consolidation-spec.md)
Previous: [`ROUND-9-CLOSING-READOUT.md`](./ROUND-9-CLOSING-READOUT.md)
Scope: `throwaway-prototypes/d-full-match/**` only

## Outcome

Round 10 consolidates the Round 9 breadth lanes the user selected in Showroom
UAT, while keeping the body locked to the universal Mesh2Motion substrate for
all eight personas. The body-swap axis remains closed; only the adhering layers
vary.

The consolidated lanes are:

- Weapons: dynamic hand-bone attachment only.
- Skin: UV-painted texture/material on the skinned body for all personas.
- Gore: small localized individual marks, not broad wrapping regions.
- Armour: two body-tracking candidates, dynamic modular prop vs donated broad
  adhering region.

There is no automated UAT job for this round. The user UATs the exported
Showroom directly.

## Consolidated Lane Matrix

| Layer | Round-10 lane | Current data | Showroom exposure | Status |
|---|---|---|---|---|
| Weapons | `dynamic_hand_bone` via `BoneAttachment3D` on the live hand bone | Six weapon assets retain the low/mid/high pack and declare dynamic attach only | Weapon tier row; no weapon attach-mode switch | Closed lane; static root-socket negative control retired from selection |
| Skin | `uv_painted` texture/material on the skinned Mesh2Motion body | All 8 persona skins use `adherenceApproach: uv_painted`; opportunist moved from sticker decals to `pattern_texture` | Skin layer toggle | Settled lane; shader/material styling remains a later axis |
| Gore | Small localized individual marks for the re-approached bone-attached gore | Duelist has 8 marks, camper 7, paranoid 8; other corpse treatments remain as controls/coverage | Gore layer toggle, independent of death clip | Re-approached lane; broad region donated to armour |
| Armour A | `modular_submesh_prop` attached through dynamic bone-follow | Duelist chest on `spine_03`, paranoid helmet on `head`, vulture gauntlet on `hand_l` | Armour mode: Modular prop | Body-tracking prop candidate |
| Armour B | `adhering_region` donated from Round-9 broad gore | Duelist 4 region marks, camper 2, paranoid 3 | Armour mode: Adhering region | Body-tracking flat coverage candidate |

## Showroom Controls

The Round 10 Showroom keeps the side-by-side curator surface and exposes:

- Seven global animation triggers: idle, walk, attack unarmed, attack armed,
  loot, take hit, and death.
- Four independent layer toggles: Skin, Gore, Weapons, and Armour.
- Weapon tier row: None, Low, Mid, High.
- Armour tier row: None, Low, Mid, High.
- Armour mode switch: Modular prop vs Adhering region.

The removed controls are intentional:

- No weapon attach-mode switch remains; `static_root_socket` finished its
  Round-9 negative-control job.
- Armour paint is not the active Showroom armour mode; the armour comparison is
  now prop vs adhering region.

## Scale Calibration Evidence

The scale pass was re-run with the refined `audit-character-scales.gd`
measurement required by §4.2 / WP-S:

- Pose: locked Mesh2Motion body at `idle@0`.
- Body-only filter: merged only
  `/root/camper-mesh2motion-human-base/Armature/Skeleton3D/Mannequin`.
  No equipment, weapon, armour, gore, or skin-decal meshes entered the AABB.
- Foot-plane normalization: raw body foot plane `foot_y = -0.000386`; normalized
  bounds `0.000..1.830`.
- Environment anchor: parsed `WORLD_SCALE := 0.38` from `SceneBuilder.gd`;
  target height derived as `0.38 * 4.5 = 1.71` world units.
- Multiplier derivation:
  `modelScaleMultiplier = 1.71 / (1.829564 * CHARACTER_MODEL_SCALE 1.0)`.

| Scale knob | Before | After | Method |
|---|---:|---:|---|
| `targetWorldHeight` | 1.7 | 1.71 | Round-7 env anchor: `WORLD_SCALE 0.38 * 4.5` |
| `modelScaleMultiplier` | 0.92918305 | 0.93464883 | Refined body-only `source_h 1.829564` at idle@0 |

All eight persona records now resolve to `world_h 1.710000` with `meshes 1/0`
and the same body mesh path. The manifest `body` and `corpseBody` pins and the
package test `--target-world-height` all use the derived values above.

The user's Showroom UAT remains the visual acceptance gate. If the body still
reads off in the Showroom, the next pass is a narrow re-calibration of these two
knobs using the same body-only audit method.

## Honest Limitations

| Layer | Lane | Limitation |
|---|---|---|
| Weapons | `dynamic_hand_bone` | Rigid weapon props can clip at extreme wrist bends. |
| Skin | `uv_painted` | Skin reads as paint on the body surface; it adds no physical thickness. |
| Gore | Small individual bone-attached marks | Higher node count than a single broad patch; each mark is still single-bone pinned and can be imperfect near hard joint bends. |
| Armour prop | Dynamic modular prop | Rigid props track the selected bone but can protrude or clip; they are not true multi-bone skinned garments. |
| Armour region | `adhering_region` | Flat broad coverage tracks bones but has no thickness and does not become a wrapped armour shell. |

These are accepted Round-10 lane limits, not blockers. They are the trade-offs
the Showroom is meant to make visible.

## Verification

The Round-10 verifier surface now asserts the consolidated lanes:

- schemaVersion 9 and one locked Mesh2Motion body.
- dynamic-only weapon manifest/runtime mode, with no user-selectable static
  root socket.
- UV-painted-only skin; no `decal_stickers` skin path.
- duelist/camper/paranoid small-mark gore thresholds.
- armour prop via `BoneAttachment3D` plus donor `adhering_region` coverage.
- retired armour paint from manifest and Showroom controls.
- body-only scale calibration evidence and synchronized body/corpse/package
  scale pins.
- an armed-attack audit case with weapon and armour enabled.

Final validation commands:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match test`
- `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match run build`

The x86_64 Godot binary in this container is not usable because its loader is
missing; the arm64 Godot 4.6.2 binary is the verified local renderer binary.

## Open Items

- User Showroom UAT remains the acceptance check for visual read: weapon wrist
  clip tolerance, skin texture read, gore density and mark distribution, and
  armour prop vs region preference.
- Per-cell toggling remains deferred (Round-9 Q3); Round 10 keeps global row
  controls.
- Armour-as-paint can return later only as a deliberate third styling/material
  axis, not as the active Round-10 armour comparison.
- Stylistic shader/material skin looks (toon/emissive/fresnel/multi-material/
  rim/palette) are confirmed as a separate later axis per AC2 — they adhere
  perfectly and are not the Round-10 concern.

## References

- [`round-10-adherence-consolidation-spec.md`](../../docs/project/phases/render-rnd/round-10-adherence-consolidation-spec.md) - acceptance criteria and WP-V readout requirements.
- [`mental-model.md`](../../docs/project/spec/mental-model.md) sections 10.1 and 13.1 - recursive breadth/consolidation and locked-body adherence intent.
- [`ROUND-9-CLOSING-READOUT.md`](./ROUND-9-CLOSING-READOUT.md) - previous breadth baseline.
- [`shared-harness/art-kit/manifest.json`](./shared-harness/art-kit/manifest.json) - final Round-10 lane data.
- [`src/Showroom.gd`](./src/Showroom.gd) - final Showroom controls.
- [`src/EquipmentMeshAttachment.gd`](./src/EquipmentMeshAttachment.gd) - runtime attachment and adhering-region paths.
