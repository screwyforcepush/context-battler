# Round 5 Spectacle Closing Readout

Date: 2026-05-27

## Scope Delivered

Round 5 extends `throwaway-prototypes/d-full-match` only, plus this readout.
No replay contract change was needed. The renderer now delays action-phase
effects, uses eight sourced character lanes, drives imported AnimationPlayers,
uses material-tier armour, uses splatter-textured blood pools, and keeps the
Round-4 prone corpse path intact.

## Persona Pack Table

| Persona | Source key | Source | License | Rationale |
|---|---|---|---|---|
| rat | `kaykit` | KayKit Character Pack: Adventurers, Rogue Hooded | CC0 | Hooded rogue gives the rat a sourced scavenger silhouette with full pickup and melee clips. |
| duelist | `robin-lamb` | Robin Lamb Animated Low Poly Hero | CC0 | Preserves the strongest Round-4 humanoid comparison lane and sword-shield identity. |
| trader | `interglactic` | OpenGameArt simple 3D rigged character | CC0 | Minimal rigged humanoid creates a deliberately plain broker contrast lane. |
| opportunist | `quaternius` | Quaternius Ultimate Space Kit mech | CC0 | Keeps the detailed mech lane for comparison, now with rigged walk/pickup/shoot clips. |
| paranoid | `gdquest` | GDQuest Mannequiny | CC-BY-4.0 | Clean Godot-native mannequin with fight clips fits nervous, exposed motion. |
| camper | `mesh2motion` | Mesh2Motion human base animations | CC0 | Reserved stance with broad utility animation library, including pickup/table interaction. |
| sprinter | `xcvg-systems` | XCVG Rigged and Animated Humanoid | CC0 | Low-poly humanoid with run and punch clips gives the speed lane a clear rigged runner. |
| vulture | `styloo` | styloo Robot character | CC0 | Robot grab and hand-attack clips give scavenger action readability without reusing Quaternius. |

## Clip Resolution

| Persona | Idle | Walk | Attack | Loot/generic |
|---|---|---|---|---|
| rat | `Idle` | `Walking_A` | `Dualwield_Melee_Attack_Chop` | `PickUp` |
| duelist | `idle` | `walk` | `attack` | `jump` generic |
| trader | `idle` | `walk` | `jump` generic | `jump` generic |
| opportunist | `RobotArmature|Idle` | `RobotArmature|Walk` | `RobotArmature|Shoot_Big` | `RobotArmature|Pickup` |
| paranoid | `idle` | `run` | `fight_punch` | `fight_kick` generic |
| camper | `Idle` | `Walk` | `Sword_Attack` | `PickUp_Table` |
| sprinter | `Armature|Standing` | `Armature|Run` | `Armature|Punch` | `Armature|CrouchDefault` generic |
| vulture | `iddle` | `walking` | `attackwithhand` | `grab` |

`scripts/verify-character-rigs.gd` loads every manifest character scene under
Godot headless and asserts `Skeleton3D`, `AnimationPlayer`, attach bone
resolution when declared, and clip-name resolution. Translation-only fallback
count is zero.

## VFX And Materials

Blood pool path: Godot Decal was not used for this web-export pass. Fallback A
is active: `QuadMesh` placed flat on the floor with the CC0 AlejandroHaibi
splatter alpha texture. The Round-4 64-entry persistent pool cap is preserved.

Armour path: armour no longer spawns a body-attached mesh. `EquipmentMeshAttachment`
applies material changes to character meshes. Tier ramp moves from persona base
palette toward metal, raises emissive trim, raises metallic, and lowers
roughness. Cloth/leather/chain/plate/riot-plate still map to tiers 1 through 5.

Environment path: Round-4 PNG textures for floor, wall, cover, crate, and evac
remain wired. Round 5 adds normal-map noise plus metallic/roughness values to
make walls, cover, floor, crates, and evac read as textured PBR surfaces rather
than flat blocks.

Palette picks are stored per character in the manifest as base, accent, and
emissive channels:

| Persona | Base | Accent | Emissive |
|---|---|---|---|
| rat | `#32402f` | `#78f28a` | `#d7ff63` |
| duelist | `#51242e` | `#f2c46b` | `#ff304d` |
| trader | `#173b42` | `#f5a642` | `#16f2ff` |
| opportunist | `#263245` | `#8df0ff` | `#ff5c18` |
| paranoid | `#202338` | `#caa6ff` | `#6affd2` |
| camper | `#23351e` | `#c7d072` | `#ff8f2e` |
| sprinter | `#43211c` | `#ff4e38` | `#ffe14a` |
| vulture | `#2c2d31` | `#a7ff4f` | `#ff2868` |

## Timing Fix

Action-phase event resolution is renderer-side. `CombatVfx` and environmental
red mist now use fired-through counters initialized from `startTurn - 1`.
Action VFX and loot fire only once `fraction >= ACTION_PHASE_START`, currently
`0.65`, with final-turn clamp to avoid stranding end-turn effects.

Equipment visibility uses the same `0.65` threshold, so looted weapon/armour
state does not snap on at fraction `0.0`. Wall face-slam is movement resolution,
not action resolution, so it uses `WALL_SLAM_PHASE_START = 0.95`.

## Controls Reminder

`C` toggles Director and Anchored camera. `[` and `]` cycle anchors. Left mouse
drag orbits, right mouse drag pans in Director mode, mouse wheel zooms, and the
bottom HUD provides play/pause, scrub, and speed.

## Blind Review Focus

1. Check all eight persona lanes for silhouette breadth and palette separation.
2. Watch walk, attack, and loot/generic actions for visible limb motion.
3. Confirm move-plus-action turns resolve movement first, then loot/gore/equipment.
4. Compare armour tier readability as material changes, not separate clothing.
5. Inspect blood pools for splatter-paint read rather than circular object read.
6. Inspect walls, cover, floor, crates, and evac for texture/PBR readability.
7. Confirm Round-4 prone corpses still read well.

## Technical Ceilings

This is still breadth-first R&D. Trader uses `jump` as both attack and generic
action because the source only ships idle/walk/jump. Socket quality varies by
pack because bone naming is not standardized. Blood uses Fallback A rather than
Decal nodes for export compatibility. Combat gore chunks remain lightweight
primitive chunks; authored limb detachment is not part of this pass.
