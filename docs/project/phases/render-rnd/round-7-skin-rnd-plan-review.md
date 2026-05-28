# Round-7 Skin R&D Spec Plan Review

Date: 2026-05-28
Reviewed spec: [`round-7-skin-rnd-spec.md`](./round-7-skin-rnd-spec.md)

## Review Summary

- Overall assessment: **Concern / conditional pass**. The plan is aligned with the Round-7 North Star and mental-model §10/§13, but implementation should not begin until the amendments in the Issues table are absorbed.
- What is solid:
  - D1 manifest hoist is the right substrate posture. Root `body` + `corpseBody` makes "8 personas, 1 body" true in data instead of duplicating identical body fields per persona.
  - D4 Showroom Death Option A is acceptable for the Showroom comparison affordance if the implementation also proves non-death triggers restore the live skin.
  - D5/D6 technique selections cover the requested breadth: palette/PBR/pattern/decal/toon/emissive/multi-material/rim-fresnel and blood/wounds/pool/char/bone/viscera/dismemberment/decay.
  - WP-D default **SKIP** is ratified. Accessories are optional, and adding them now risks muddying the skin-technique breadth signal.
- What is risky or unclear:
  - The sprinter dismemberment fallback allows a second corpse GLB, which conflicts with the single shared corpse-body requirement.
  - Decal-heavy techniques rely on Godot `Decal` even though Round 5 explicitly used a QuadMesh fallback for web export.
  - The no-UAT validation stack is directionally right but needs the new Godot audits wired into `npm --prefix throwaway-prototypes/d-full-match test` so they cannot be skipped accidentally.
  - The spec still contains a few contradictory path/schema details that can produce implementation drift.

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| High | Corpse Architecture | Spec permits `dismemberment_baked` to use a second variant GLB / `corpse.params.file`, which breaks the North Star requirement for one shared mesh2motion corpse body. | Spec allows a baked variant GLB in §3.4.3 and `corpse.params` (`round-7-skin-rnd-spec.md:432-438`, `592-598`), while assignment success criterion 5 and the spec's own §6 require a single shared `corpseBody` (`1027-1028`). | Amend Q1: **no variant GLB fallback in Round 7**. Use shared-body-compatible dismemberment only: bone/mesh visibility if available, bone scale collapse, stump/gore decals, or lightweight detached gore chunks. If none works, swap sprinter to another distinct gore technique and document the swap. Extra GLB requires PM/user escalation. |
| Medium | WebGL2 Rendering | Decal-based skin/gore techniques assume Godot `Decal` is supported in Compatibility/WebGL2, but Round 5 deliberately avoided Godot Decal for the web-export path. This risks several techniques compiling but not rendering reliably. | Round-7 asserts Decal support (`360-365`) and uses decals for opportunist plus four corpse techniques (`455`, `545-550`, `560-563`). Round-5 closing says Godot Decal was not used and active fallback was flat `QuadMesh` splatter (`round-5-closing-readout.md:50-52`). | Keep decal techniques, but require a shared `_apply_projected_mark` helper with `Decal` primary and QuadMesh/alpha-plane fallback. Validation should assert both code paths exist and web export passes. Closing readout must state which path is active. |
| Medium | Validation | The plan creates `audit-mesh2motion-clips.gd` and replay smoke, but does not explicitly wire them into the package test command. Current d-full-match `test` only runs `verify-scaffold.mjs` plus `audit-character-scales.gd` when `GODOT_BIN` is set. | Current `package.json` test script (`throwaway-prototypes/d-full-match/package.json:7-9`). Spec requires new audits (`round-7-skin-rnd-spec.md:269-275`, `658-669`) but only lists validation commands generally (`889-892`). | Amend WP-A to update `package.json` or `verify-scaffold.mjs` so `audit-mesh2motion-clips.gd`, extended `verify-character-rigs.gd`, and replay smoke all run under `GODOT_BIN`. Scaffold should assert the test command references the new audits. |
| Medium | No-UAT Discipline | Several success criteria rely on engineer "dev-preview" to judge visual distinctness/revert behavior. That conflicts with the hard no visual UAT posture for this assignment. | Skin visual distinctness is "verifiable by engineer via dev-preview" (`941-942`); Showroom skin revert is also "verifiable via dev-preview" (`990-991`). North Star forbids visual UAT/browser/headless visual checks. | Reword these as user-UAT outcomes, not implementation gates. Replace implementation gates with structural assertions: skin/corpse mode state toggles, material/decal child nodes are added/cleared, non-death triggers call a restore-live-skin path, and shaders/resources load without script errors. |
| Medium | Resource Paths | Shader path conventions conflict. One section says `res://shared-harness/shaders/<approach>.gdshader`; another says files live under `shared-harness/art-kit/shaders/`, while params use `shaders/...`. | Spec shader path (`368`) vs artifact location (`529-532`) and param examples (`500-526`, `600-602`). | Normalize all manifest params to art-kit-relative paths and load through `ART_ROOT`, e.g. `res://shared-harness/art-kit/shaders/toon_cel.gdshader`. Add scaffold checks for every nested shader/texture path in `skin.params` and `corpse.params`. |
| Low | Manifest Shape | Overview says per-character entries collapse to `{personaSlot, sourceKey, skin, accessories?, corpse, notes}`, but §3.1.2 says `sourceKey` is removed from per-asset and read from root `body`. | `sourceKey` included in overview (`115`) but removed in detailed shape (`222-237`). | Remove `sourceKey` from the per-asset overview. Keep only `manifest.body.sourceKey = "mesh2motion"`. |
| Low | Equipment Scope | Spec says verify armour attaches at `body.armourAttachBone`, but Round-5 armour is a material swap, not a body-attached mesh. This could invite out-of-scope armour work. | Spec says weapon and armour attach bones (`241-245`, `1034-1035`); Round-5 closing says armour no longer spawns a body-attached mesh and uses material changes (`round-5-closing-readout.md:54-57`). | Clarify that Round 7 must verify weapon socket `hand_r` and armour material-swap preservation. `armourAttachBone` may remain reserved for future accessory/armour work but should not create new armour-mesh scope. |

## Spec / Guide Deviations

- The variant-GLB fallback for sprinter dismemberment deviates from the single shared corpse-body requirement and from the consolidate-one-body axis.
- The Decal-only assertion deviates from Round-5 web-export evidence, where the renderer used QuadMesh/alpha fallback instead of Godot Decal.
- The "engineer dev-preview" gates deviate from the assignment's no visual UAT posture. User visual UAT is allowed after closure; implementation validation should stay structural/headless.
- The shader path mismatch violates the manifest-as-substrate clarity goal: resource paths need one convention.
- The per-asset `sourceKey` contradiction should be resolved before implementation because D1's value is manifest clarity.

## Decision Notes

- D1 manifest hoist: **Ratified**, with one implementation constraint: `_load_manifest` should deep-duplicate `manifest.body` and merge persona fields into that duplicate so root body defaults are not mutated by per-character runtime state.
- D4 Showroom Death Option A: **Ratified**, conditional on an explicit restore-live-skin path for every non-death trigger and structural verification that corpse decals/material overrides are cleared.
- D5/D6 technique selections: **Ratified**, conditional on shared-body-only dismemberment and a Decal/QuadMesh fallback strategy.
- WP-D accessories default: **Ratified as SKIP**. Do not force a minimum accessory pass this round.

Open question resolutions:

| Question | Resolution |
|---|---|
| Q1 dismemberment | Override default: shared-body-only. No variant GLB without PM/user escalation. |
| Q2 color-palette texture | Ratify delete-if-unreferenced after manifest param migration. If no `skin.params` references `camper-mesh2motion-human-base_color-palette.png`, remove it with the unused character assets. |
| Q3 armour-tier x corpse-skin | Ratify YES. Corpse skin should respect the current armour tier where material branches support it, while preserving Round-5 material-swap semantics. |
| Q4 decal scaling | Ratify the concern, but require a helper that treats params as local/model-relative where possible and converts through the character visual transform, or clearly documents world-unit values per decal. |
| Q5 accessories | Ratify SKIP. Add accessories only in a later round or after user UAT asks for silhouette support. |
| Q6 replay fixture | Do not skip A8. Use an in-prototype tiny fixture under `throwaway-prototypes/d-full-match/` or copy a minimal fixture from `throwaway-prototypes/shared-harness/replay-snapshot.json`; `apps/replay/__fixtures__/` does not exist. |
| Q7 body-shared palette | Ratify no body-level palette default. Palette belongs only inside `skin.params` for branches that need it. |

No PM decision is needed if the spec absorbs the above amendments. PM/user escalation is needed only if the team wants to allow an extra sprinter corpse GLB or force accessories into this round.
