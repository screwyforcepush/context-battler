# Round 8 R&D Closing Readout

Date: 2026-05-29
Spec: [`round-8-research-applied-spec.md`](./round-8-research-applied-spec.md)
Research log: [`round-8-research-log.md`](./round-8-research-log.md)
Previous: [`round-7-closing-readout.md`](./round-7-closing-readout.md)

## Review Disposition

Plan-review findings (D9–D11) were applied inline to the spec before
implementation: effective-world-height audit formula fixed (HIGH),
regular-crate Y decoupling added (MED-1), strict surface-first CC-BY
discipline tightened (MED-2), `adherenceApproach` required on `armorOverlay`
with 4-family coverage union check (MED-3), Forward-renderer Decal plugin
survey added as research-log line item (LOW), `armour/` path standardised
(LOW). No post-implement review job was run as a separate artifact; the
decision record (D9–D17) captures all review-stage amendments and the
implementer addressed them during the implement pass.

## Summary

Round 8 completes the requested breadth pass after the Round 7.2 UAT findings:
standard character scale is restored, sourced CC0 inventory is documented and
applied where clean, four adherence families are represented in the manifest,
and the Showroom now presents eight distinct persona cells across skin, gore,
weapon, armor, and adherence axes.

The shared mesh2motion body remains the character body. The Showroom remains the
user curation surface; implementation verification stayed at code, manifest,
structural audit, and export-build boundaries.

## Scope Delivered

**WP-A - Scale revert.** `EntityRenderer.gd` now uses
`CHARACTER_MODEL_SCALE := 1.0`. Manifest `body` and `corpseBody` use
`modelScaleMultiplier: 0.92918305` and `targetWorldHeight: 1.7`.

```text
effective_world_height = source_height * CHARACTER_MODEL_SCALE * modelScaleMultiplier
1.8296 * 1.0 * 0.92918305 = 1.7
```

Regular crates are decoupled from character scale with
`Vector3.ONE * CRATE_MODEL_SCALE`; airdrop crates use the explicit Round-7
`AIRDROP_CRATE_MODEL_SCALE := 0.21`; corpses intentionally stay coupled to
character scale.

**WP-B - Sourced CC0 research.** The research log captures skin, gore, weapon,
armor, and Compatibility-renderer decal-plugin findings with source URLs,
license disposition, hashes, downloaded files, fit rationale, and applied
persona mapping. CC-BY/non-CC0 candidates were surfaced but not downloaded or
applied. Import-noisy CC0 candidates remain logged as downloaded source only;
they are not kept in the Godot art-kit tree.

**WP-C - Adherence implementation.** `EquipmentMeshAttachment.gd` now names the
four Round-8 families as audit tokens:

- `adherence_bone_attached`
- `adherence_mesh_baked`
- `adherence_uv_painted`
- `adherence_modular_submesh`

Bone-attached marks reuse the Round-7.2 `BoneAttachment3D` path, mesh-baked
state reuses sprinter dismemberment/body mutation, UV-painted state uses
material/shader/body-region paths, and the new modular path adds
`_apply_modular_submesh_armor`, `_clear_modular_submesh_armor`, and
`armor_overlay_nodes_by_character`.

**WP-D - Eight-cell Showroom variety.** `manifest.json` is schema 6 and every
persona has skin/corpse `sourcePack` plus `adherenceApproach`; non-null
`armorOverlay` entries also declare both. The union across skin, corpse, and
armor slots covers `bone_attached`, `mesh_baked`, `uv_painted`, and
`modular_submesh`.

**WP-E - Verification kit.** Scaffold checks validate schema 6, effective scale,
crate decoupling, source provenance, adherence coverage, armor overlay fields,
import sidecars, and pathing-token discipline. Godot audits validate scale,
clips/rigs, replay load, skin/bone attachment behavior, and modular armor.

## Research Outcomes

| Category | CC0 result | Applied this round |
|---|---|---|
| Skin/material | ambientCG, OpenGameArt human/region references, retained ambientCG MetalPlates control | ambientCG MetalPlates, Fabric029, Leather034B, Leather001; OGA references where UV-layout fallback is needed |
| Gore | OpenGameArt splatter/gib/liquid sheets | OGA BloodSplatterAndGibs, LiquidSplatterPixelTexture, and sourced splatter sheets as mark/pool sources |
| Weapons | Multiple CC0 weapon candidates found; Quaternius was the clean coherent applied pack | 5 of 6 weapons use Quaternius CC0 FBX; Robin Lamb CC0 sword remains as known-good control |
| Armor | Rigid CC0 armor props found; no small mesh2motion-skinned CC0 armor overlay found | Quaternius chest, crown helmet, and gauntlet drive the modular prototype |
| Decal survey | MIT plugin candidates and native Decal notes recorded | Research note only; no renderer integration |

Procedural fallback is documented per slot in the research log. It remains only
where no CC0 asset matched the mesh2motion UV/layout need, such as the rat
control, camper trim mask, sprinter body-region mask, exact anatomical wound
shapes, and same-skeleton skinned armor.

## Persona Matrix

| Persona | Skin source | Gore source | Weapon source | Armor path | Adherence sampled |
|---|---|---|---|---|---|
| rat | `engineer-procedural-fallback` control | `OGA-LiquidSplatterPixelTexture-CC0` plus saturation fallback | Quaternius sword as rusty blade | material-swap control | `uv_painted` |
| duelist | `ambientCG-MetalPlates017A-CC0` | `OGA-BloodSplatterAndGibs-CC0` | `RobinLamb-HeroSword-CC0` | Quaternius chest plate | `uv_painted`, `bone_attached`, `modular_submesh` |
| trader | `ambientCG-Fabric029-CC0` | `OGA-LiquidSplatterPixelTexture-CC0` | Quaternius dagger | material-swap control | `uv_painted`, `bone_attached` |
| opportunist | `OGA-TheNess-HumanBodyTexture-CC0` plus decal fallback | charred mesh2motion fallback | Quaternius warhammer | material-swap control | `bone_attached`, `uv_painted` |
| paranoid | `ambientCG-Leather034B-CC0` plus toon fallback | `OGA-LiquidSplatterPixelTexture-CC0` | Quaternius dagger | Quaternius crown helmet | `uv_painted`, `bone_attached`, `modular_submesh` |
| camper | `ambientCG-Fabric029-CC0` plus trim fallback | `OGA-BloodSplatterAndGibs-CC0` | Quaternius axe | material-swap control | `uv_painted`, `bone_attached` |
| sprinter | `OGA-MakeHuman-AnnotatedSkin-CC0` plus region-mask fallback | `OGA-BloodSplatterAndGibs-CC0` plus baked dismemberment | Quaternius sword as rusty blade | material-swap control | `uv_painted`, `mesh_baked` |
| vulture | `OGA-TheNess-HumanBodyTexture-CC0` plus rim fallback | `OGA-LiquidSplatterPixelTexture-CC0` plus decay fallback | Quaternius greatsword | Quaternius gauntlet | `uv_painted`, `modular_submesh` |

Trader was moved off character triplanar sampling and now uses UV sampling by
default. The triplanar branch remains code-level opt-in only so the banked
cover-material idea is not lost, but no Round-8 character manifest entry uses
it.

## Modular Armor Limit

The modular armor prototype uses rigid Quaternius CC0 props. When a source mesh
lacks a usable skin, the runtime synthesizes a one-bone `Skin` and binds to the
manifest `bindBone` (`spine_03`, `head`, or `hand_l`). This proves the
skeleton-parent/reapply/clear path and gives three visible armor cells, but it
is **not yet a fully deforming armor mesh skinned to the mesh2motion bind pose**.

Concretely: the armor pieces track the parent bone's transform (they move with
the character and follow the assigned bone's rotation) but do not deform with
multi-bone skinning — a chest plate on `spine_03` stays rigid rather than
flexing with breathing or bending. The research log documents the
`Quaternius-ModularCharacterOutfitsFantasy-CC0` pack as the best-fit candidate
for true multi-bone deforming armor in a future round; it was not downloaded
this round due to the Itch name-your-price gate and 280 MB archive size.

**Carry-forward for Round 9 curation:** the user's UAT decision on armor should
evaluate whether rigid bone-parented props at 3 personas read well enough to
ship, or whether the next consolidation round should invest in the full
multi-bone skinned armor path (Quaternius Modular Outfits download + Blender
retarget to mesh2motion).

## Verification

| Check | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS: 53 files passed, 1 skipped; 926 tests passed, 2 skipped |
| `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match test` | PASS: 1246 scaffold checks; all Godot audits pass |
| `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match run build` | PASS: web export produced `dist` cleanly |
| Scaffold blind-validation/pathing-token checks | PASS inside `verify-scaffold.mjs` |

Key audit observations:

- `audit-character-scales` reports `world_h=1.7000` for all eight personas.
- `_spawn_crates` and `_spawn_airdrops` do not reference character scale.
- `audit-skin-bone-attachments` confirms bone-attached marks and UV pattern
  sampling; trader now reports `StandardMaterial3D uv sampling`.
- `audit-modular-submesh-armor` passes for duelist chest, paranoid helmet, and
  vulture gauntlet.

## Mental-Model Cross-Link

This round operationalises three mental-model sections:

- **§13 — Adherence taxonomy.** The four-family classification
  (`bone_attached` / `mesh_baked` / `uv_painted` / `modular_submesh`) is now
  codified in `EquipmentMeshAttachment.gd` as named constants, manifest
  `adherenceApproach` fields, and audit-coverage assertions. The
  `sourced-before-procedural` principle drove WP-B's CC0 research-first
  posture. The `idea bank` discipline keeps triplanar→cover banked (code
  opt-in only, no manifest entry uses it).

- **§10 — Recursive breadth/consolidate.** Round 8 is the breadth pass on a
  newly revealed axis (adherence approach) simultaneous with re-sampled skin,
  gore, weapon, and armor. The next round consolidates the user's picks per
  axis. The `diagnostics target building agents first` principle is realised in
  the WP-E audit kit (machine-introspection surfaces for the engineer); the
  Showroom is the user's curation diagnostic.

- **§7 — Decision filter.** Scale legibility, adherence fidelity, sourced art
  quality, and wrapping-armor spectacle each make prompt-authored behaviour
  more legible (scale) or the §13 spectacle more shareable (adherence, sourced
  packs). Tactical realism is not the driver.

## Files Changed

- `throwaway-prototypes/d-full-match/src/EntityRenderer.gd`
- `throwaway-prototypes/d-full-match/src/EquipmentMeshAttachment.gd`
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json`
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/{weapons,armour,textures}/...`
- `throwaway-prototypes/d-full-match/scripts/audit-character-scales.gd`
- `throwaway-prototypes/d-full-match/scripts/audit-skin-bone-attachments.gd`
- `throwaway-prototypes/d-full-match/scripts/audit-modular-submesh-armor.gd`
- `throwaway-prototypes/d-full-match/scripts/verify-character-rigs.gd`
- `throwaway-prototypes/d-full-match/scripts/verify-scaffold.mjs`
- `throwaway-prototypes/d-full-match/package.json`
- `docs/project/phases/render-rnd/round-8-research-applied-spec.md`
- `docs/project/phases/render-rnd/round-8-research-log.md`
- `docs/project/phases/render-rnd/round-8-closing-readout.md`
