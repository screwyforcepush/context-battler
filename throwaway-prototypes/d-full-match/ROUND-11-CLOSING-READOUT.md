# Round 11 Closing Readout - Lock Gore, Armour, Skin Coverage

Date: 2026-06-01
Spec: [`round-11-lock-and-breadth-spec.md`](../../docs/project/phases/render-rnd/round-11-lock-and-breadth-spec.md)
Previous: [`ROUND-10-CLOSING-READOUT.md`](./ROUND-10-CLOSING-READOUT.md)
Scope: `throwaway-prototypes/d-full-match/**` only

## Outcome

Round 11 keeps the body locked to the shared Mesh2Motion character and closes
the layer decisions that Round 10 UAT made legible. The settled surface lanes
are:

- Weapons: dynamic hand-bone attachment only.
- Gore: amplified small bone-attached marks for live gore.
- Death gore: baked dismemberment on the shared body death pose.
- Armour: scaled rigid modular props attached to live bones.
- Skin: UV-painted body textures, with the load-bearing coverage fix routed
  through the full-body UV2 shader path.

No automated UAT job was added. The user still UATs the exported Showroom
directly.

## Consolidated Lane Matrix

| Layer | Round 11 lane | Current data | Showroom exposure | Status |
|---|---|---|---|---|
| Body | Shared Mesh2Motion body | All personas resolve through `characters/camper-mesh2motion-human-base.glb` | Same 8-persona row | Locked; no body substitution |
| Weapons | `dynamic_hand_bone` | Weapon tiers still attach via the live hand bone | Weapon tier row | Locked from Round 10 |
| Gore live | `small_bone_attached_marks` | All 8 personas have 11 compact marks, including splash marks | Gore layer toggle | Locked and amplified |
| Gore death | `dismemberment_baked` with `bone_hide` | All 8 persona corpse blocks declare baked death treatment | Death animation trigger, independent of Gore toggle | Locked |
| Armour | `modular_submesh_prop` via `BoneAttachment3D` | 6 catalog props: 3 existing, 3 new Round 11 CC0 entries | Armour tier row plus armour asset selector | Locked technique, open asset breadth |
| Skin | `uv_painted` full-body texture path | 4 `pbr_texture_atlas` and 4 `pattern_texture` persona skins route through `uv2_body_texture.gdshader` | Skin layer toggle | Locked on duelist/trader family |

## Rejected Armour Lane

The broad flat adhering region idea is rejected for armour. This is an honest
reversal of the Round 9 idea-bank guess: the flat region can track a body, but
it has no thickness and reads like paint or a bendy patch, not armour. Armour
needs real prop geometry, attached to a live bone, accepting some protrusion or
clipping instead of pretending to be a wrapped garment.

The Showroom now exposes only the modular prop lane. There is no armour mode
switch and no region comparison UI.

## Gore Closeout

Live gore is now the camper-style small mark family across all personas:

- 8/8 personas use `small_bone_attached_marks`.
- Each persona has 11 live marks.
- Mark types include splash, wound, bone_gash, and viscera.
- Individual body mark x/y sizes are kept within the small-mark envelope used
  by the audits.
- 8/8 personas declare `dismemberment_baked` death treatment using `bone_hide`.

The important behaviour remains decoupled: pressing Death changes the animation
clip; toggling Gore controls the live gore layer.

## Armour Scale And Breadth

The armour lane is a rigid child mesh under a live `BoneAttachment3D`. The
body-fit scale correction is applied to each child mesh transform through
`propScale`; it is not applied to the socket (the socket transform is
rewritten from the bone pose every frame, so socket-level scale is
clobbered). Scale values were calibrated with the same body-only idle-pose
audit method Round 10 used for body scale.

| Prop family | Before | After | Notes |
|---|---:|---:|---|
| Existing Quaternius cuirass, crown helmet, left gauntlet | raw source scale, effectively 1.00 | `propScale: 0.38` | Existing overlays promoted into the catalog and scaled down to body fit. |
| New Quaternius cuirasses | raw source scale, effectively 1.00 | `propScale: 0.16` | Larger source cuirass pieces needed a smaller fit scale. |
| New Lucian Pavel bucket helmet | raw source scale, effectively 1.00 | `propScale: 0.14` | Head-slot helmet uses the smallest recorded fit scale. |

The top-level `armourProps[]` catalog currently contains:

| Catalog entry | Slot | File | Provenance | License | sha256 |
|---|---|---|---|---|---|
| Quaternius Metal Cuirass | chest | `armour/quaternius-rpg-armor-metal.fbx` | Quaternius RPG Essentials / Ultimate RPG Items Pack, existing Round 8 source | CC0-1.0 | `7f7f4d3e3eccee5ed224cf48d3c061d2996e9cb3e2c28e99721858d504972539` |
| Quaternius Crown Helmet | helmet | `armour/quaternius-rpg-crown-helmet.fbx` | Quaternius RPG Essentials / Ultimate RPG Items Pack, existing Round 8 source | CC0-1.0 | `fe8b98fde525a165e783b153b9ab61c9fb9c110ac1332686ba94abd6f36fe084` |
| Quaternius Left Gauntlet | gauntlet | `armour/quaternius-rpg-glove-gauntlet.fbx` | Quaternius RPG Essentials / Ultimate RPG Items Pack, existing Round 8 source | CC0-1.0 | `353f617d580fe1be503c34cadca7996169c1e5b60756c3b17e21d44406fe41f2` |
| Quaternius Leather Cuirass | chest | `armour/round11-breadth/Armor_Leather.fbx` | Quaternius RPG Essentials / Ultimate RPG Items Pack, staged from local CC0 archive | CC0-1.0 | `617c25fb9f077c6f123f8601a94a46bc9507ab34182562aa249b0a7cacf4bce8` |
| Quaternius Black Cuirass | chest | `armour/round11-breadth/Armor_Black.fbx` | Quaternius RPG Essentials / Ultimate RPG Items Pack, staged from local CC0 archive | CC0-1.0 | `971a89dc084c6ce7f9cf089b2cc91dfea0cc78dfc757fdf6f12abde53180b1ac` |
| Lucian Pavel Bucket Helmet | helmet | `armour/round11-breadth/oga-lucianpavel-bucket-helmet.fbx` | Lucian Pavel, OpenGameArt Bucket Helmet | CC0-1.0 | `bfb0203d22f0fb898feb10cfab883d3c924ec0764512308103f2af4833c2a1a5` |

## Skin Coverage

The load-bearing skin fix is the UV2 material path:

- `pbr_texture_atlas` and `pattern_texture` route through a `ShaderMaterial`.
- The shader is `shaders/uv2_body_texture.gdshader`.
- The shader samples `UV2`, the full-body unwrap, instead of the palette-like
  UV1 coordinates that caused the duelist texture to appear only around joints.
- The pattern route no longer relies on UV1 triplanar projection, so the trader
  family should stop swimming in world space during animation.

The Round 11 manifest is narrowed to the duelist/trader family: duelist,
paranoid, camper, and vulture use `pbr_texture_atlas`; rat, trader,
opportunist, and sprinter use `pattern_texture`. The non-shortlist shader looks
are no longer selected by persona data.

## Showroom Controls

The Showroom now has:

- Title: `Showroom - Round 11`.
- Seven animation triggers: idle, walk, attack unarmed, attack armed, loot,
  take hit, and death.
- Four layer toggles: Skin, Gore, Weapons, Armour.
- Weapon tier row: None, Low, Mid, High.
- Armour tier row: None, Low, Mid, High.
- Armour asset selector: `All (per-persona)` plus every `armourProps[]` catalog
  entry.

Changing the armour asset selector calls `set_armour_prop_selection` when the
runtime exposes it, then reapplies the existing layer/equipment path. The
runtime re-swaps props on registered live characters, so the control is safe
across idle, a motion clip, and the paused death clip without restarting or
re-instantiating the characters.

## Verification Notes

Observed during final validation:

- The manifest reports 8/8 live gore blocks on small marks, 11 marks each, and
  8/8 baked death treatments.
- The runtime exposes `set_armour_prop_selection`.
- The runtime routes pbr/pattern skin paths through the UV2 shader material.
- `manifest.schemaVersion` reads `10`.

Foreground validation run for this closeout:

- `npm --prefix throwaway-prototypes/d-full-match test` - PASS. The scaffold
  reported 2563 checks passed. `GODOT_BIN` is unset in this shell, so the
  package script skipped the native Godot audit scripts.
- `npm --prefix throwaway-prototypes/d-full-match run build` - PASS. Godot
  exported the web build to `dist`.

## Honest Limitations

| Layer | Limitation | Status |
|---|---|---|
| Gore live | Many small nodes are heavier than one broad patch, and each mark is still single-bone pinned near hard joint bends. | Accepted locked-lane trade-off |
| Gore death | Bone hiding is a coarse dismemberment approximation; stump marks do the visual sell. | Accepted locked-lane trade-off |
| Armour prop | Rigid props follow one bind bone and can protrude or clip at extreme poses; they are not skinned garments. | Accepted locked-lane trade-off |
| Rejected flat armour region | The former broad flat region has no armour thickness and failed the user read. | Rejected, not exposed |
| Skin | UV2 coverage fixes whole-body sampling for pbr/pattern skins, but the result still reads as paint and adds no thickness. | Accepted locked-lane trade-off |
| Showroom selector | A single selected prop applies to all personas for comparison, even when a prop's natural slot makes less sense on some silhouettes. | Accepted comparison trade-off |

## Path Forward

- If user UAT reads any armour prop as too large or too small, recalibrate only
  that prop's `propScale` with the same body-only idle-pose method.
- No UAT job should be added; the exported Showroom remains the user review
  surface.

## References

- [`round-11-lock-and-breadth-spec.md`](../../docs/project/phases/render-rnd/round-11-lock-and-breadth-spec.md) — Round 11 spec (acceptance criteria, WP breakdown, research grounding including D-DIAG1 UV-channel diagnosis and D-DIAG2 armour scale diagnosis).
- [`mental-model.md`](../../docs/project/spec/mental-model.md) sections 10.1 and 13.1 — recursive breadth/consolidation and locked-body adherence intent.
- [`ROUND-10-CLOSING-READOUT.md`](./ROUND-10-CLOSING-READOUT.md) — previous round baseline (lane matrix, body-only scale-audit method, armour A/B comparison).
- [`shared-harness/art-kit/manifest.json`](./shared-harness/art-kit/manifest.json) — final Round 11 lane data (schema 10).
- [`src/Showroom.gd`](./src/Showroom.gd) — final Showroom controls.
- [`src/EquipmentMeshAttachment.gd`](./src/EquipmentMeshAttachment.gd) — runtime attachment, UV2 skin path, propScale application.
- [`shared-harness/art-kit/shaders/uv2_body_texture.gdshader`](./shared-harness/art-kit/shaders/uv2_body_texture.gdshader) — UV2 full-body texture shader (the D-DIAG1 coverage fix).
