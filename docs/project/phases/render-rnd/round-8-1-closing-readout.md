# Round 8.1 R&D Closing Readout

Date: 2026-05-29
Spec: [`round-8-1-targeted-touchup-spec.md`](./round-8-1-targeted-touchup-spec.md)
Research log: [`round-8-research-log.md`](./round-8-research-log.md)
Manifest source: `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json`

## Review Ratification

Completion review performed as part of the document job (2026-05-29). Cross-referenced the closing readout persona-body matrix against `manifest.json` schema v7 `bodyOverride` entries, the Round 8.1 research log appendix, and the implement job's verification output. All eight persona entries, sha256 values, source URLs, armor attach bones, and mechanism-fired records match across all three sources. No corrections required. Implement verification commands all passed (see §Verification Status below). Readout ratified.

## Summary

Round 8.1 moves the Showroom body axis, not another material-texture pass. The current schema 7 manifest keeps mesh2motion as the rat control and assigns seven personas to downloaded CC0 character bodies: four Quaternius Poly Pizza GLBs, two Kenney Mini Characters GLBs, and one Kaykit Adventurers Knight GLB.

No procedural character body/skin fallback was used for Round 8.1 body-pack replacement. Existing Round-5/Round-8 procedural skin or UV-layout fallback notes remain inherited metadata for control/material/gore paths, not substitutes for the requested character packs.

No UAT, browsertools, Chromium, screenshot, or headless visual checks were run.

## Strategic Decision Record

| Decision | Record |
|---|---|
| Body swap over material swap | Implemented as schema 7 `bodyOverride` entries so the visible silhouette/outfit/body source changes across seven personas. Round 8 skin/gore/weapon/armor declarations are preserved where they still attach. |
| Quaternius official pack fallback | `Quaternius-ModularCharacterOutfitsFantasy-CC0` remains the intended target, but anonymous headless access was gated. `ITCHIO_SESSION` was absent, so Mechanism 2 was skipped and Mechanism 3 Poly Pizza individual Quaternius GLBs fired. |
| BlackScorp warrior slot | BlackScorp was inspected but not integrated: the archive is OBJ/MTL/PNG only and unrigged. The paranoid slot uses Kaykit Adventurers Knight as the rigged CC0 alternate. |
| Armor preservation | Duelist, paranoid, and vulture keep their Round 8 Quaternius armor overlays. The manifest records body-specific `armourAttachBone` values for those swapped bodies. |
| Procedural fallback policy | No missing character-body slot was filled with a generated body or generated skin. All seven non-control Round 8.1 bodies are sourced CC0 GLBs. |

## Persona-Body Matrix

| Persona | Body source | Body file | License | Body sha256 | Source archive sha256 | Mechanism | Armor note |
|---|---|---|---|---|---|---|---|
| rat | mesh2motion control | `characters/camper-mesh2motion-human-base.glb` | `CC0-1.0` | `578542d26d334805bdeadfc1f394e86a4d470dbc70b4eb277c8fe38b7387c7cd` | n/a (`sourceArchiveSha256: null`) | Existing root control | none |
| duelist | `Quaternius-PolyPizzaIndividual-CC0` / Shaun | `characters/quaternius-shaun.glb` | `CC0-1.0` | `16633fc8b960b025247b6016f0199f848f38c0c6bb2c91c37b81fadc9005d5a5` | `16633fc8b960b025247b6016f0199f848f38c0c6bb2c91c37b81fadc9005d5a5` | Mechanism 3 | chest plate, `armourAttachBone: "Torso"` |
| trader | `Kenney-MiniCharacters-CC0` / character-female-b | `characters/kenney-mini-characters-trader.glb` | `CC0-1.0` | `2288438e7baf9acc91a870c82dc00d66710bb486592cfc3474ef8ed93a03863a` | `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999` | `kenney-direct` | none |
| opportunist | `Quaternius-PolyPizzaIndividual-CC0` / Anne | `characters/quaternius-anne.glb` | `CC0-1.0` | `cfee1b57f380ff4b51fc0b88c9d4750ea1748936eb8b7d5557291913077d1e30` | `cfee1b57f380ff4b51fc0b88c9d4750ea1748936eb8b7d5557291913077d1e30` | Mechanism 3 | none |
| paranoid | `Kaykit-Adventurers-CC0` / Knight | `characters/kaykit-adventurers-knight.glb` | `CC0-1.0` | `c892ed861d1a327b60380d1f59e3cd7d84f5fcb41b130e1372459dd1d01cfb7b` | `abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479` | `itch-anonymous-free-flow` | crown helmet, `armourAttachBone: "head"` |
| camper | `Quaternius-PolyPizzaIndividual-CC0` / Henry | `characters/quaternius-henry.glb` | `CC0-1.0` | `ae91c5ec699f1f97f980628ab6d54fffaa20c0ed30d3680245fde56eea2204cf` | `ae91c5ec699f1f97f980628ab6d54fffaa20c0ed30d3680245fde56eea2204cf` | Mechanism 3 | none |
| sprinter | `Kenney-MiniCharacters-CC0` / character-male-c | `characters/kenney-mini-characters-sprinter.glb` | `CC0-1.0` | `672a6506f7475bbd655da1d7ff712c1729a430f134c62385a4e5d3c1378acb40` | `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999` | `kenney-direct` | none |
| vulture | `Quaternius-PolyPizzaIndividual-CC0` / Pirate Captain | `characters/quaternius-pirate-captain.glb` | `CC0-1.0` | `688b0db0487dadaa6dbbf9e5613793aa9c1280902255212bd51bc46ff17f695d` | `688b0db0487dadaa6dbbf9e5613793aa9c1280902255212bd51bc46ff17f695d` | Mechanism 3 | gauntlet, `armourAttachBone: "Middle1.L"` |

## Pack Provenance

| Pack | Exact URL(s) | License confirmation | Mechanism fired | Integrated persona(s) |
|---|---|---|---|---|
| Quaternius Modular Character Outfits Fantasy target | <https://quaternius.com/packs/modularcharacteroutfitsfantasy.html>; <https://quaternius.itch.io/modular-character-outfits-fantasy> | Target metadata is CC0; manifest body entries record Poly Pizza pages as Public Domain (CC0) / CC0 1.0. | Mechanism 1 metadata/license only; Mechanism 2 skipped (`ITCHIO_SESSION` absent); Mechanism 3 Poly Pizza fired. | duelist, opportunist, camper, vulture via individual GLBs |
| Quaternius Poly Pizza individual bodies | Shaun <https://poly.pizza/m/eJFT9MxzOM>, Anne <https://poly.pizza/m/tZYaOQ4l94>, Henry <https://poly.pizza/m/yEdSk8tRKc>, Pirate Captain <https://poly.pizza/m/sN18LyyHAU> | `CC0-1.0`; no attribution required. | Mechanism 3 | duelist, opportunist, camper, vulture |
| Kenney Mini Characters | <https://kenney.nl/assets/mini-characters>; <https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip> | `CC0-1.0`; Kenney page and archive `License.txt` declare CC0 1.0 Universal. Archive sha256 `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999`. | `kenney-direct` | trader, sprinter |
| OGA BlackScorp Low Poly Warrior | <https://opengameart.org/content/low-poly-warrior> | `CC0-1.0`; archive sha256 `7f6ecd8044093b6c8ab2e594224a3524c2510317ae0b8ec6d2cf742877137c04`. | R3 rigging inspection branch; not a body delivery. | none |
| Kaykit Adventurers | <https://kaylousberg.itch.io/kaykit-adventurers>; manifest download URL `https://kaylousberg.itch.io/kaykit-adventurers/download_url + signed R2 upload 15363167` | `CC0-1.0`; manifest notes rigged/animated characters, free commercial use, no attribution required, and Creative Commons Zero v1.0 Universal metadata. Archive sha256 `abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479`. | `itch-anonymous-free-flow` as BlackScorp alternate | paranoid |

## Body Source URLs

| Persona | Page URL | Download URL | Source archive path |
|---|---|---|---|
| duelist | <https://poly.pizza/m/eJFT9MxzOM> | <https://static.poly.pizza/c8ecc219-6a19-4fd1-ae1a-6ceeda529eaf.glb> | `/tmp/round-8-1-assets/quaternius-polypizza/shaun.glb` |
| trader | <https://kenney.nl/assets/mini-characters> | <https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip> | `/tmp/round-8-1-assets/kenney-mini-characters.zip` -> `Models/GLB format/character-female-b.glb` |
| opportunist | <https://poly.pizza/m/tZYaOQ4l94> | <https://static.poly.pizza/1cc2232d-b43e-4fc0-b97f-134b4a528bf8.glb> | `/tmp/round-8-1-assets/quaternius-polypizza/anne.glb` |
| paranoid | <https://kaylousberg.itch.io/kaykit-adventurers> | `https://kaylousberg.itch.io/kaykit-adventurers/download_url + signed R2 upload 15363167` | `/tmp/round-8-1-assets/kaykit-adventurers-free-2.0.zip` -> `Characters/gltf/Knight.glb` plus `Animations/gltf/Rig_Medium/...` |
| camper | <https://poly.pizza/m/yEdSk8tRKc> | <https://static.poly.pizza/b91485bd-aaa0-4a9a-802c-b16e08ae05e7.glb> | `/tmp/round-8-1-assets/quaternius-polypizza/henry.glb` |
| sprinter | <https://kenney.nl/assets/mini-characters> | <https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip> | `/tmp/round-8-1-assets/kenney-mini-characters.zip` -> `Models/GLB format/character-male-c.glb` |
| vulture | <https://poly.pizza/m/sN18LyyHAU> | <https://static.poly.pizza/c814c745-1cf5-4d92-bd85-200c66eb7843.glb> | `/tmp/round-8-1-assets/quaternius-polypizza/pirate-captain.glb` |

## BlackScorp Rigging Outcome

BlackScorp was inspected from `/tmp/round-8-assets/oga-blackscorp-low-poly-warrior.zip` with sha256 `7f6ecd8044093b6c8ab2e594224a3524c2510317ae0b8ec6d2cf742877137c04`. The archive contains only:

- `base-char-male.obj`
- `base-char-male.mtl`
- `metal2.png`
- `skin.png`

That is an unrigged static OBJ asset set: no GLB/FBX, no skeleton, and no animation clips. It fails the Round 8.1 body requirement, so it was documented as inspected but unrigged and replaced by the rigged CC0 Kaykit Adventurers Knight alternate.

## Failure Modes

| Failure mode | Round 8.1 disposition |
|---|---|
| Quaternius official itch target gated without session | `ITCHIO_SESSION` was absent, so Mechanism 2 was skipped. Mechanism 3 Poly Pizza delivered four CC0 Quaternius body GLBs. |
| Loss of full modular outfit archive | Accepted for this round. The integrated Quaternius bodies are individual GLBs rather than the full 280 MB modular outfit archive, but they satisfy the load-bearing body variety target. |
| BlackScorp unrigged | Rejected for persona body integration after archive inspection. Kaykit Adventurers Knight fills the required rigged-warrior alternate slot. |
| Procedural character fallback risk | Did not fire. No Round 8.1 body or body-skin slot was filled with a generated procedural character fallback. |
| Visual confirmation intentionally skipped | No UAT/browser visual checks were run. Final visual judgment remains with the user's Showroom/UAT pass. |

## Verification Status

Passed:

- `npm run lint`
- `npm run typecheck`
- `npm test` - 926 passed, 2 skipped
- `npm run build`
- `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match test` - 1445 scaffold checks plus Godot scale, mesh2motion clip, rig, body provenance, replay-load, skin/bone, and modular armor audits passed
- `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match run build` - web export passed; `dist/index.pck` is 21,432,988 bytes
- `git diff --check`

Not run:

- UAT, browsertools, Chromium, screenshots, or headless visual checks

## What the User Should Look for in Showroom UAT

Open the Showroom web export. Eight persona cells should be visible. What to check:

1. **Body variety is visible.** Seven of eight personas should show genuinely different character bodies — different silhouettes, proportions, and outfit geometry. Only `rat` retains the original mesh2motion body as the control.
2. **Persona-body mapping.** Each cell label should show the persona name plus a body source key:
   - `rat` → `mesh2motion` (the lone control)
   - `duelist` → `quaternius-polypizza` (Shaun)
   - `trader` → `kenney-mini-characters` (female-b)
   - `opportunist` → `quaternius-polypizza` (Anne)
   - `paranoid` → `kaykit-adventurers` (Knight)
   - `camper` → `quaternius-polypizza` (Henry)
   - `sprinter` → `kenney-mini-characters` (male-c)
   - `vulture` → `quaternius-polypizza` (Pirate Captain)
3. **Armor attachment on swapped bodies.** Three personas kept their Round 8 modular armor overlays on the new bodies:
   - `duelist` — chest plate (bound to `Torso` bone on Quaternius skeleton)
   - `paranoid` — crown/helmet (bound to `head` bone on Kaykit skeleton)
   - `vulture` — gauntlet (bound to `Middle1.L` bone on Quaternius skeleton)
   - Check that armor pieces are visually attached near the expected body part. Exact placement may differ from mesh2motion due to different skeleton proportions — that's expected breadth data.
4. **Animation.** Each persona should idle (at minimum). Weapon-attack/walk/death pose clips may differ per body skeleton — some bodies have richer clip sets than others. Missing non-critical clips fall back to idle; this is expected.
5. **Kenney Mini Characters scale.** Trader and sprinter use Kenney Mini bodies scaled up (2.35× and 2.14× respectively) to match the 1.7m target height. They will look stylistically different from Quaternius/Kaykit bodies — that's the point.
6. **Flag any pack that fails to load.** If a persona cell shows the mesh2motion body instead of its assigned override, or shows a T-pose with no animation, that's a loading failure to report.

## Files Changed

Documentation:
- `docs/project/phases/render-rnd/round-8-research-log.md` — appended Round 8.1 provenance section
- `docs/project/phases/render-rnd/round-8-1-closing-readout.md` — this file (NEW)
- `docs/project/phases/render-rnd/round-8-1-targeted-touchup-spec.md` — v2 plan spec (NEW)

Manifest + runtime:
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json` — schema v6 → v7; 7 `bodyOverride` entries added
- `throwaway-prototypes/d-full-match/src/EquipmentMeshAttachment.gd` — body override merge logic in `_load_manifest`; per-persona body resolution in `instantiate_persona_character` / `instantiate_persona_corpse`
- `throwaway-prototypes/d-full-match/src/Showroom.gd` — `_source_key_for_persona` reads `bodyOverride.sourceKey` explicitly (R8)

Scaffold + audits:
- `throwaway-prototypes/d-full-match/scripts/verify-scaffold.mjs` — relaxed root body assertion; added per-persona `bodyOverride` structural checks; corrected audit math per R2
- `throwaway-prototypes/d-full-match/scripts/audit-body-source-provenance.gd` — NEW: per-persona body GLB provenance assertions (skeleton, idle clip, death clip, armourAttachBone)
- `throwaway-prototypes/d-full-match/scripts/audit-character-scales.gd` — parameterized over per-persona effective body source
- `throwaway-prototypes/d-full-match/scripts/audit-mesh2motion-clips.gd` — restricted to mesh2motion-bodied personas only
- `throwaway-prototypes/d-full-match/scripts/audit-modular-submesh-armor.gd` — reads `bodyOverride.armourAttachBone` for armor bind validation (R1)
- `throwaway-prototypes/d-full-match/scripts/audit-skin-bone-attachments.gd` — adapted for per-body bone name variation
- `throwaway-prototypes/d-full-match/scripts/verify-character-rigs.gd` — updated for multi-body rig verification
- `throwaway-prototypes/d-full-match/package.json` — wired new audit scripts into test runner

Character body GLBs (NEW — all CC0):
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/characters/quaternius-shaun.glb` (duelist)
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/characters/quaternius-anne.glb` (opportunist)
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/characters/quaternius-henry.glb` (camper)
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/characters/quaternius-pirate-captain.glb` (vulture)
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/characters/kenney-mini-characters-trader.glb` (trader)
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/characters/kenney-mini-characters-sprinter.glb` (sprinter)
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/characters/kaykit-adventurers-knight.glb` (paranoid)

Associated textures + Godot import sidecars (`.import`, `.png`):
- `characters/quaternius-shaun_Zombie_Atlas.png`, `characters/quaternius-anne_Atlas_Pirate.png`, `characters/quaternius-henry_Atlas_Pirate.png`, `characters/quaternius-pirate-captain_Atlas_Pirate.png` — embedded textures extracted by Godot import
- `characters/kaykit-adventurers-knight_knight_texture.png`, `characters/Textures/colormap.png` — Kaykit/Kenney textures
- All GLBs and textures have corresponding `.import` sidecars

## References

- [`round-8-1-targeted-touchup-spec.md`](./round-8-1-targeted-touchup-spec.md) — v2 plan spec with D1-D11 decisions and R1-R9 revisions
- [`round-8-research-log.md`](./round-8-research-log.md) — Round 8.1 provenance appendix (mechanism-fired per pack, sha256s, source URLs)
- [`round-8-closing-readout.md`](./round-8-closing-readout.md) — Round 8 close-out (what shipped before 8.1)
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json` — schema v7 manifest (ground truth for persona-body assignments)
- `docs/project/spec/mental-model.md` §10 (recursive breadth/consolidate), §13 (sourced before procedural, niche-art positioning)
