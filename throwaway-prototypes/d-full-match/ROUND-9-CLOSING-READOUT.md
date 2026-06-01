# Round 9 Closing Readout - Locked Body Adherence Breadth

Date: 2026-06-01
Commit: `7812244` (`Implement round 9 adherence breadth`)
Spec: [`round-9-adherence-breadth-spec.md`](../../docs/project/phases/render-rnd/round-9-adherence-breadth-spec.md)
Previous: [`round-8-1-closing-readout.md`](../../docs/project/phases/render-rnd/round-8-1-closing-readout.md)
Scope: `throwaway-prototypes/d-full-match/**` — no Convex/production/apps-replay touched

## Outcome

Round 9 reverts the Round-8.1 body-swap axis and restores one universal
Mesh2Motion substrate body for all eight personas:

- Body file: `characters/camper-mesh2motion-human-base.glb`
- Source key shown in every Showroom cell: `mesh2motion`
- Manifest schema: `8`
- Persona body substitution field: absent from the manifest and runtime source
- Foreign body GLBs/textures: **deleted** (POC posture; provenance preserved
  below)

The varied signal is now the adhering treatment layer, not the body.

## Revert Record (Round 8.1 → Round 9)

Round 8.1 (commit `eb96cb6`, schema v7) introduced `bodyOverride` blocks on 7
personas, substituting foreign CC0 character GLBs for the mesh2motion body. This
was the **wrong axis** — body substitution cannot become render code (mental-model
§13.1: the substrate body is locked). Round 9 reverts this:

- `bodyOverride` key removed from all 7 persona entries in `manifest.json`
- `schemaVersion` bumped 7 → 8
- `EquipmentMeshAttachment.gd`: `bodyOverride` merge branch, corpse-body
  override branch, and armour bind-bone `bodyOverride` lookup all removed;
  foreign-skeleton bone lists trimmed to mesh2motion vocabulary
- `Showroom.gd`: `bodyOverride.sourceKey` lookup removed; all cells resolve to
  root `mesh2motion`
- `audit-body-source-provenance.gd` deleted; replaced by
  `audit-universal-body.gd` (asserts single body) and
  `audit-adherence-matrix.gd` (asserts per-layer × per-approach coverage)
- 7 foreign character GLBs + associated textures + `.import` sidecars deleted
  from `shared-harness/art-kit/characters/`

The Round-8 adherence layer data (`skin`, `corpse`, `armorOverlay`, weapon
mappings, bone references `spine_03`/`head`/`hand_l`/`hand_r`) was preserved
intact beneath the `bodyOverride` blocks and auto-restored by their deletion.

## Deleted Foreign GLB Provenance

Per Decision D3 (delete, not park — POC posture), the 7 foreign character-body
GLBs introduced in Round 8.1 are deleted. Full provenance is preserved here so
the bytes are recorded even though the files are gone. For complete details
(sha256, source URLs, download URLs, mechanism fired, archive paths), see
[`round-8-1-closing-readout.md` §Persona-Body Matrix and §Pack Provenance](../../docs/project/phases/render-rnd/round-8-1-closing-readout.md).

| Deleted file | Pack | Persona (was) | License |
|---|---|---|---|
| `quaternius-shaun.glb` + `*_Zombie_Atlas.png` | Quaternius Poly Pizza CC0 | duelist | CC0-1.0 |
| `quaternius-anne.glb` + `*_Atlas_Pirate.png` | Quaternius Poly Pizza CC0 | opportunist | CC0-1.0 |
| `quaternius-henry.glb` + `*_Atlas_Pirate.png` | Quaternius Poly Pizza CC0 | camper | CC0-1.0 |
| `quaternius-pirate-captain.glb` + `*_Atlas_Pirate.png` | Quaternius Poly Pizza CC0 | vulture | CC0-1.0 |
| `kenney-mini-characters-trader.glb` | Kenney Mini Characters CC0 | trader | CC0-1.0 |
| `kenney-mini-characters-sprinter.glb` | Kenney Mini Characters CC0 | sprinter | CC0-1.0 |
| `kaykit-adventurers-knight.glb` + `*_knight_texture.png` + `Textures/colormap.png` | Kaykit Adventurers CC0 | paranoid | CC0-1.0 |

All corresponding `.import` sidecars were also deleted.

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

## Decision Record

| Decision | Resolution |
|---|---|
| D-1 (schema bump 7→8) | **DONE.** Forward-only POC posture (§10). |
| D-2 (delete vs park foreign GLBs) | **DONE — deleted.** POC posture; provenance preserved in this readout + Round-8.1 readout. |
| D-3 (weapons 2nd approach) | **RESOLVED — dynamic hand-bone vs static-root-socket.** Static socket is the negative-control contrast: it intentionally detaches during the attack swing, making the adherence difference visible. Sheathed second-bone fallback was not needed; the static detach reads as signal, not a bug. |
| D-4 (toggle scope) | **DONE — global-row toggles.** All 4 layer toggles + 2 mode switches apply row-wide. Per-cell independent toggling deferred (Q3). |
| D-5 (global-row vs per-cell) | **DONE — global-row.** Per-cell deferred to a possible Q3 refinement. |

## Verification

The final audit surface (`verify-scaffold.mjs` + Godot audits) asserts:

- schemaVersion 8
- exactly one universal mesh2motion body for all personas
- no manifest or runtime source body substitution path
- per-layer adherence coverage for skin, gore, weapons, and armour
- runtime application paths for skin, gore, weapon attach modes, armour prop, and
  armour paint
- web export build

All verification gates passed:

- `npm run lint` / `npm run typecheck` / `npm test` / `npm run build`
- `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match test` (scaffold +
  Godot audits: universal body, adherence matrix, character scales, mesh2motion
  clips, character rigs, skin bone attachments, modular submesh armour)
- `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match run build` (web
  export)

User UAT remains the Showroom inspection pass (no automated UAT job — NS AC5).

## Round Closure

Round 9 closes the §13.1/§10.1 correction of Round 8.1's body-swap axis error.
The substrate body is confirmed locked; the four adhering layers (skin, gore,
weapons, armour) are breadth-sampled with ≥2 distinct §13.1 approaches each on
the one mesh2motion body. The Showroom exposes independent à-la-carte toggles so
the user evaluates adherence under controlled conditions.

Next axis for R&D (if pursued) is consolidation within each layer — the user
picks a lane per layer from the breadth data this round provides.

## References

- [`round-9-adherence-breadth-spec.md`](../../docs/project/phases/render-rnd/round-9-adherence-breadth-spec.md) — spec
- [`round-8-1-closing-readout.md`](../../docs/project/phases/render-rnd/round-8-1-closing-readout.md) — what was reverted (full provenance)
- [`round-8-closing-readout.md`](../../docs/project/phases/render-rnd/round-8-closing-readout.md) — the Round-8 layer work that was preserved and reused
- [`mental-model.md`](../../docs/project/spec/mental-model.md) §10.1, §13, §13.1 — governing intent
