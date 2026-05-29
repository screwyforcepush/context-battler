# Round 8 - Sourced CC0 Asset Research Log

Date: 2026-05-29
Owner: DamonCipher
Scope: WP-B only. This pass stages CC0 assets and records manifest mapping recommendations; it does not edit `manifest.json`.

## Disposition Summary

| Category | CC0 source status | Applied/staged art-kit paths | Integration note |
|---|---|---|---|
| Skin / character textures | CC0 ratified | `textures/skin/cc0-*`, `textures/skin/ambientcg-*` | Strong for material bases and references; mesh2motion-specific UV masks still require authored mapping. |
| Gore / blood / wound decals | CC0 ratified | `textures/gore/cc0-*`; pre-existing staged OGA gore noted below | Good for blood splatter, pools, gibs, and decal sprites; exact body-wrapping wound overlays remain a fallback gap. |
| Weapons | CC0 ratified | pre-existing Quaternius staged files noted below | Quaternius FBX files are the applied weapon set; other source downloads remain in `/tmp` when conversion/import is noisy. |
| Armor / modular armor | CC0 ratified for rigid armor props and armor materials; strict skinned modular armor still limited | `armour/ambientcg-*`; pre-existing Quaternius item armor noted below | Good helmet/chest/gauntlet prop inputs; true same-skeleton skinned armor likely still needs hand-rigging or a larger CC0 modular outfit download. |

## Category 1 - Skin / Character Textures

- Pack: `OGA-TheNess-HumanBodyTexture-CC0`
  Source URL: https://opengameart.org/content/human-male-body-and-head-texture-painted-with-adobe-animate
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded files:
  - `/tmp/round-8-assets/oga-theness-human-body-texture-body_texture.png`
    sha256: `f96078b5ef4748337fc1bf49c8ab91c783e481d555bc4419223966f1c0a841c5`
  - `/tmp/round-8-assets/oga-theness-human-body-texture-head_texture.png`
    sha256: `ad3b2c7eecf959d6675e3f1ebf3474a00d40d91619ea4d9a3dccb1b68b8927d7`
  Applied assets:
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/cc0-theness-human-body-texture.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/cc0-theness-human-head-texture.png`
  Fit rationale: Natural humanoid skin reference improves UV-painted body reads against cyberpunk armor and Diablo-gore overlays.
  Applied to persona recommendation: opportunist or vulture skin source reference; not direct mesh2motion UV-final without remapping.
  Notes: Use as source/albedo reference, not a guaranteed drop-in wrap for mesh2motion.

- Pack: `OGA-MakeHuman-AnnotatedSkin-CC0`
  Source URL: https://opengameart.org/content/annotated-skin
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded file: `/tmp/round-8-assets/oga-makehuman-annotated-skin.png`
  sha256: `76052ebf896aa6cc7b232fbb1bd2a30f400c029fd93b0933cfdaa01eef51281f`
  Applied asset: `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/cc0-makehuman-annotated-skin-region-map.png`
  Fit rationale: Region-labeled skin map is directly useful for UV-painted adherence experiments and body-region mask authoring.
  Applied to persona recommendation: sprinter body-region-mask reference; camper trim-mask fallback reference.
  Notes: It is a MakeHuman UV reference, so integration still needs mesh2motion UV alignment.

- Pack: `ambientCG-Leather034B-CC0`
  Source URL: https://ambientcg.com/view?id=Leather034B
  License URL: https://ambientcg.com/license
  License: `cc0_ratified` - ambientCG publishes assets under CC0.
  Downloaded archive: `/tmp/round-8-assets/ambientcg-leather034b-1k-png.zip`
  sha256: `cf4594e21140ca579474befaeed4163e4cfa7ae092e0b6ee3bcbf26bb0b399b6`
  Applied assets:
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/ambientcg-leather034b-color.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/ambientcg-leather034b-normal-gl.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/ambientcg-leather034b-roughness.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/ambientcg-leather034b-ao.png`
  Fit rationale: Worn leather reads as Diablo-adjacent armor/skin material and can carry cyberpunk tint/emissive contrast.
  Applied to persona recommendation: paranoid toon/PBR control or duelist material-control alternate.
  Notes: Real PBR material, not character-authored skin; use for material-swap or UV-painted armor-as-paint controls.

- Pack: `ambientCG-Fabric029-CC0`
  Source URL: https://ambientcg.com/view?id=Fabric029
  License URL: https://ambientcg.com/license
  License: `cc0_ratified` - ambientCG publishes assets under CC0.
  Downloaded archive: `/tmp/round-8-assets/ambientcg-fabric029-1k-png.zip`
  sha256: `269fbe2f79e046b3357846d55bd959249b225bd439a80cadc075184ceef0a1e5`
  Applied assets:
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/ambientcg-fabric029-color.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/ambientcg-fabric029-normal-gl.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/skin/ambientcg-fabric029-roughness.png`
  Fit rationale: Tiled cloth/fabric reads better than blank procedural patterns for trader/camper clothing passes.
  Applied to persona recommendation: trader pattern texture or camper base under emissive trim.
  Notes: Sourced textile material; not a bespoke body texture.

## Category 2 - Gore / Blood / Wound Decals

- Pack: `OGA-ExileGL-BloodSplatter-CC0`
  Source URL: https://opengameart.org/content/blood-splatter
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded file: `/tmp/round-8-assets/oga-exilegl-blood-splatter.png`
  sha256: `2f625d3ce46c723c54f3a78a94cd54aef808ef2480b470dd70bf7b6fdbb42c14`
  Applied asset: `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/gore/cc0-exilegl-blood-splatter.png`
  Fit rationale: High-contrast blood marks fit corpse decals, floor pools, and bone-attached gore tests.
  Applied to persona recommendation: duelist wound cluster, trader pool, camper viscera projection as a sourced decal base.
  Notes: Flat sprite; it does not solve body wrapping by itself.

- Pack: `OGA-KoAsuna-SimpleBloodSplatter-CC0`
  Source URL: https://opengameart.org/content/simple-blood-splatter
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded file: `/tmp/round-8-assets/oga-koasuna-simple-blood-splatter-spritesheet.png`
  sha256: `5f58ff8f4736fec5e77dcc32e2584a33664813607156d4d082cdc25d7baefda6`
  Applied asset: `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/gore/cc0-koasuna-blood-splatter-spritesheet.png`
  Fit rationale: Sprite-sheet variety supports side-by-side gore comparisons without engineer-authored PNGs.
  Applied to persona recommendation: paranoid gashes and sprinter stump gore source replacement.
  Notes: Integration can crop/select sprites in material setup; no new PNG authoring needed for this WP.

- Pack: `OGA-BloodSplatterAndGibs-CC0`
  Source URL: https://opengameart.org/content/bloodspatter-and-gibs
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded file observed: `/tmp/round-8-assets/oga-bloodsplatterandgibs.png`
  sha256: `e3f8bf437f484af296593ed589256d41f1cfb8ee7e33184f52fa2e9342739d53`
  Applied asset observed: `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/gore/oga-bloodsplatterandgibs.png`
  Fit rationale: Gib pieces are closer to camper/sprinter gore than pure splatter.
  Applied to persona recommendation: camper viscera and sprinter stump source material.
  Notes: This file was already staged in the shared tree during WP-B; kept as sourced CC0 inventory.

- Pack: `OGA-LiquidSplatterPixelTexture-CC0`
  Source URL: https://opengameart.org/content/liquid-splatter-pixel-texture
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded file observed: `/tmp/round-8-assets/oga-liquid-splatter-pixel-texture.png`
  sha256: `171fba1113203f375e097d4bb2cff2ae2c0e896ee433f8b8e4eb65b9adf0f7f8`
  Applied asset observed: `throwaway-prototypes/d-full-match/shared-harness/art-kit/textures/gore/oga-liquid-splatter-pixel-texture.png`
  Fit rationale: Stylized liquid marks can support Diablo-like pools while remaining readable at tactical camera distance.
  Applied to persona recommendation: trader blood pool or rat saturation overlay source control.
  Notes: Useful as a decal source; not a skinned full-body overlay.

## Category 3 - Weapons

- Pack: `OGA-Ralchire-19LowPolyFantasyWeapons-CC0`
  Source URL: https://opengameart.org/content/19-low-poly-fantasy-weapons
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded file: `/tmp/round-8-assets/oga-ralchire-19-low-poly-fantasy-weapons.blend`
  sha256: `d94e068b6ef971555c5e9fd2fc3ad73b7e1ed10b10d25ee6b4022270bc75575a`
  Applied asset: not applied to the art-kit; source remains only in `/tmp/round-8-assets/` because Blender is unavailable and importing `.blend` files causes headless Godot build errors.
  Fit rationale: Coherent low-poly fantasy weapon silhouettes cover the Diablo half of the brief.
  Applied to persona recommendation: source pack for axe/dagger/greatsword variants if a conversion step is available.
  Notes: Candidate logged for future conversion only; no `.blend` file is kept in the Godot art-kit tree.

- Pack: `OGA-CC0GameAssets-LowPolSwords-CC0`
  Source URL: https://opengameart.org/content/3d-swords-lowpol-cc0
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded archive: `/tmp/round-8-assets/oga-cc0gameassets-lowpol-swords-fbx.zip`
  sha256: `1aac1a47be81d0939f1a5cac06bcb2c0d254a20a752c8da46cb1ed9fce08b9f8`
  Applied assets: not applied to the art-kit; archive remains in `/tmp/round-8-assets/` because the FBX files reference source texture names that are not present after normalized staging and generate noisy Godot import errors.
  Fit rationale: Many sword silhouettes give quick weapon breadth while shared tiny textures keep a coherent sourced look.
  Applied to persona recommendation: duelist/vulture sword variants; rat low-tier blade variant.
  Notes: Good future candidate after a clean conversion pass; Round 8 uses the Quaternius CC0 FBX set for applied weapons.

- Pack: `OGA-Mehrasaur-3DHammerPack-CC0`
  Source URL: https://opengameart.org/content/3d-hammer-pack
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded archive: `/tmp/round-8-assets/oga-mehrasaur-3d-hammer-pack.zip`
  sha256: `1b219e50df11bd7b6d4c0b951e6f31f0e3d7655b564a99f999fb4db80b355a5a`
  Applied assets: not applied to the art-kit; archive remains in `/tmp/round-8-assets/` because Round 8 already has a coherent Quaternius CC0 hammer/weapon set.
  Fit rationale: Warhammer shapes make the weapon axis louder and more Diablo-readable than the Round-5 primitive hammer.
  Applied to persona recommendation: opportunist warhammer and high-tier heavy weapon lane.
  Notes: Downloaded and logged as a named CC0 candidate, but not retained under the Godot art-kit because it is not used by the manifest.

- Pack: `Quaternius-UltimateRPGItemsPack-CC0`
  Source URL: https://poly.pizza/bundle/Ultimate-RPG-Items-Bundle-h8mhlZ0dG8
  License URL: https://creativecommons.org/publicdomain/zero/1.0/
  License: `cc0_ratified` - Poly Pizza bundle page exposes CC0 and attributes Quaternius as creator.
  Downloaded archive observed: `/tmp/round-8-assets/quaternius-low-poly-rpg-pack.zip`
  sha256: `7079818e9a02bb0291c3f2b595ec0306ce138fabc26718e86889b19e81077834`
  Applied assets observed:
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/weapons/quaternius-rpg-sword.fbx`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/weapons/quaternius-rpg-dagger.fbx`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/weapons/quaternius-rpg-axe-double.fbx`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/weapons/quaternius-rpg-greatsword.fbx`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/weapons/quaternius-rpg-warhammer.fbx`
  Fit rationale: Best staged coherent weapon set for the 5-of-6 swap because it covers sword, dagger, axe, greatsword, and hammer in one CC0 pack.
  Applied to persona recommendation: preferred weapon sourcePack for WP-D if the integration batch keeps the observed staged files.
  Notes: Observed in shared staging during WP-B; the source is CC0, so this is not a CC-BY exception.

## Category 4 - Armor / Modular Armor

- Pack: `OGA-BlackScorp-LowPolyWarrior-CC0`
  Source URL: https://opengameart.org/content/low-poly-warrior
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded archive: `/tmp/round-8-assets/oga-blackscorp-low-poly-warrior.zip`
  sha256: `7f6ecd8044093b6c8ab2e594224a3524c2510317ae0b8ec6d2cf742877137c04`
  Applied assets: not applied to the art-kit; archive remains in `/tmp/round-8-assets/` because the OBJ references a mismatched material filename and generates Godot import errors without manual source repair.
  Fit rationale: Low-poly warrior material pieces give armor/color references without license overhead.
  Applied to persona recommendation: material reference for modular chest prototype; not a ready skinned armor overlay.
  Notes: OBJ is not rigged to mesh2motion. Use as modeling/reference input after a clean conversion/repair pass, not as the Round-8 modular_submesh proof.

- Pack: `OGA-LucianPavel-BucketHelmet-CC0`
  Source URL: https://opengameart.org/content/bucket-helmet
  License: `cc0_ratified` - OpenGameArt page exposes CC0 1.0.
  Downloaded archive: `/tmp/round-8-assets/oga-lucianpavel-bucket-helmet.zip`
  sha256: `7315ed94c410f21e8f9235274a4cabcd52cfb55c1933246f24a038e3f36b44a4`
  Applied assets: not applied to the art-kit; archive remains in `/tmp/round-8-assets/` because the FBX references its original texture filename and generates Godot import errors after normalized staging.
  Fit rationale: Helmet is a clear wrapping/attachment test cell for paranoid without body texture ambiguity.
  Applied to persona recommendation: paranoid modular helmet candidate.
  Notes: Rigid helmet, not skinned. Future use should either preserve original texture filenames or convert to GLB before adding it to the Godot tree.

- Pack: `ambientCG-Metal062B-CC0`
  Source URL: https://ambientcg.com/view?id=Metal062B
  License URL: https://ambientcg.com/license
  License: `cc0_ratified` - ambientCG publishes assets under CC0.
  Downloaded archive: `/tmp/round-8-assets/ambientcg-metal062b-1k-png.zip`
  sha256: `5e1dfbafe0f9da00722c53cb7bd92939fefeee33c55fb03d9e0e5522ccd24061`
  Applied assets:
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/armour/ambientcg-metal062b-color.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/armour/ambientcg-metal062b-normal-gl.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/armour/ambientcg-metal062b-roughness.png`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/armour/ambientcg-metal062b-metalness.png`
  Fit rationale: Clean CC0 metal PBR maps are useful for armor-as-paint controls and retinting rigid sub-meshes.
  Applied to persona recommendation: duelist/paranoid/vulture armor material control.
  Notes: Material source only; does not create a modular mesh.

- Pack: `Quaternius-UltimateRPGItemsPack-CC0`
  Source URL: https://poly.pizza/bundle/Ultimate-RPG-Items-Bundle-h8mhlZ0dG8
  License URL: https://creativecommons.org/publicdomain/zero/1.0/
  License: `cc0_ratified` - Poly Pizza bundle page exposes CC0 and attributes Quaternius as creator.
  Downloaded archive observed: `/tmp/round-8-assets/quaternius-low-poly-rpg-pack.zip`
  sha256: `7079818e9a02bb0291c3f2b595ec0306ce138fabc26718e86889b19e81077834`
  Applied assets observed:
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/armour/quaternius-rpg-armor-metal.fbx`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/armour/quaternius-rpg-crown-helmet.fbx`
  - `throwaway-prototypes/d-full-match/shared-harness/art-kit/armour/quaternius-rpg-glove-gauntlet.fbx`
  Fit rationale: Coherent helmet/chest/gauntlet props cover the three requested modular armor visual cells with one CC0 sourcePack.
  Applied to persona recommendation: duelist chest plate, paranoid helmet, vulture gauntlet.
  Notes: Rigid item meshes, not pre-skinned mesh2motion overlays. WP-C still must bind, bone-parent, or hand-rig to demonstrate `modular_submesh`.

- Pack: `Quaternius-ModularCharacterOutfitsFantasy-CC0`
  Source URL: https://quaternius.com/packs/modularcharacteroutfitsfantasy.html
  Itch URL: https://quaternius.itch.io/modular-character-outfits-fantasy
  License: `cc0_ratified` - official page and Itch page state CC0; not downloaded by this WP.
  Downloaded archive: not downloaded by this WP; free Standard archive is about 280 MB and sits behind Itch's name-your-own-price flow.
  sha256: n/a
  Fit rationale: Best-fit true modular outfit research hit for future full armor wrapping because it contains modular clothing/armor bodies.
  Applied to persona recommendation: not applied this round unless a later batch explicitly downloads and retargets it.
  Notes: Good candidate for a future deeper modular armor pass; current WP-B stayed with lighter CC0 staging.

## Compatibility-renderer Decal Plugin Survey (Research Note Only)

- Pack/plugin: `Godot-ScreenSpaceDecals`
  Source URL: https://godotengine.org/asset-library/asset/241
  Repository: historical Asset Library link was unavailable during this pass.
  License: MIT.
  Notes: Godot Asset Library entry is old and targets screen-space decals. It may be a future renderer-substrate reference, but it is not integrated this round.

- Pack/plugin: `DecalCo`
  Source URL: https://godotassetlibrary.com/asset/RFPNvt/decalco
  Repository: https://github.com/Master-J/DecalCo
  License: MIT.
  Notes: Shader-based decal system for Godot 3.x with GLES notes. Useful as a design reference, but not a drop-in Godot 4 Compatibility renderer replacement.

- Pack/plugin: `Godot native Decal node`
  Source URL: https://docs.godotengine.org/en/stable/tutorials/3d/using_decals.html
  License: documentation only.
  Notes: Native Decal remains unsuitable for the current web-export renderer path; Round-7.2 QuadMesh + BoneAttachment3D fallback remains the practical route this round.

## Non-CC0 / Flagged Candidates Not Downloaded

- Candidate: `Synty Free / Synty Store packs`
  Source URL: https://syntystore.com/
  Disposition: `non_cc0_flagged_for_user_decision`
  Reason: EULA/commercial-store terms are not CC0. No archive downloaded or applied.

- Candidate: `Kenney character/weapon packs`
  Source URL: https://kenney.nl/assets
  Disposition: `kenney_flagged_for_user_decision`
  Reason: The assignment explicitly requires Kenney candidates to be surfaced rather than downloaded by WP-B, even where individual pages are permissive. No archive downloaded or applied.

- Candidate: `Mixamo-rigged armor workflow`
  Source URL: https://www.mixamo.com/
  Disposition: `terms_flagged_for_user_decision`
  Reason: Useful retargeting path but not a CC0 source pack. No assets downloaded or applied.

## Persona Mapping Recommendations for WP-D

| Persona | Skin sourcePack | Gore sourcePack | Weapon sourcePack | Armor sourcePack | Notes |
|---|---|---|---|---|---|
| rat | `engineer-procedural-fallback` | `OGA-LiquidSplatterPixelTexture-CC0` or control fallback | `OGA-CC0GameAssets-LowPolSwords-CC0` | Round-5 material-swap control | Keep rat as control per spec. |
| duelist | existing `ambientCG-MetalPlates017A-CC0` | `OGA-ExileGL-BloodSplatter-CC0` | `Quaternius-UltimateRPGItemsPack-CC0` | `Quaternius-UltimateRPGItemsPack-CC0` | Best chest-plate and sword/axe coherence if observed staged files are retained. |
| trader | `ambientCG-Fabric029-CC0` | `OGA-ExileGL-BloodSplatter-CC0` | `Quaternius-UltimateRPGItemsPack-CC0` | material-swap control | Fabric/pattern source replaces weak procedural hex base. |
| opportunist | `OGA-TheNess-HumanBodyTexture-CC0` | `OGA-KoAsuna-SimpleBloodSplatter-CC0` | `OGA-Mehrasaur-3DHammerPack-CC0` | material-swap control | Human skin source plus heavy weapon silhouette. |
| paranoid | `ambientCG-Leather034B-CC0` | `OGA-KoAsuna-SimpleBloodSplatter-CC0` | `Quaternius-UltimateRPGItemsPack-CC0` | `OGA-LucianPavel-BucketHelmet-CC0` or `Quaternius-UltimateRPGItemsPack-CC0` | Helmet is the cleanest visible armor test. |
| camper | `ambientCG-Fabric029-CC0` plus fallback trim mask | `OGA-BloodSplatterAndGibs-CC0` | `OGA-CC0GameAssets-LowPolSwords-CC0` | material-swap control | Viscera still needs selection/cropping from sourced sheet or fallback. |
| sprinter | `OGA-MakeHuman-AnnotatedSkin-CC0` plus fallback mesh2motion mask | existing mesh-baked dismemberment + `OGA-BloodSplatterAndGibs-CC0` | `OGA-CC0GameAssets-LowPolSwords-CC0` | material-swap control | Region map is reference; current mesh2motion mask remains implementation-specific. |
| vulture | `OGA-TheNess-HumanBodyTexture-CC0` or `ambientCG-Leather034B-CC0` | `OGA-LiquidSplatterPixelTexture-CC0` | `Quaternius-UltimateRPGItemsPack-CC0` | `Quaternius-UltimateRPGItemsPack-CC0` | Gauntlet or glove prop is a useful wrapping-control cell. |

## Procedural-fallback Justifications

- rat skin - intentional control sample. No replacement recommended because the spec reserves rat as the no-sourced-skin control for comparison.
- rat corpse - can remain fallback if the integration batch wants a pure Round-7 control; otherwise use `OGA-LiquidSplatterPixelTexture-CC0` for sourced pool/saturation input.
- camper trim mask - no CC0 emissive trim mask authored for the mesh2motion UV layout was found. Use `ambientCG-Fabric029-CC0` as material base and retain the existing trim mask only as a mesh2motion-specific fallback.
- sprinter body-region mask - no CC0 body-region mask matching mesh2motion UVs was found. Use `OGA-MakeHuman-AnnotatedSkin-CC0` as reference and retain the current mask only as a UV-layout fallback.
- exact wound/bone/viscera body overlays - CC0 splatter/gib sheets were found, but no strict CC0 full-body wound overlay matched mesh2motion UVs. Use sourced sheets for decal/mark sprites; retain exact anatomical gash/viscera procedurals only where the integration needs those specific shapes.
- true skinned modular armor - CC0 rigid armor props and a large CC0 modular outfit candidate were found, but no small ready-to-drop mesh2motion-rigged armor overlay was found. WP-C should hand-rig/bone-parent staged CC0 props or use a documented placeholder if same-skeleton binding cannot be completed.

## Cross-WP Notes

- Camera and scale were not changed by WP-B.
- Several Quaternius and OGA files were already staged in the shared tree during this pass. They are documented above only where a CC0 source URL and local sha256 could be confirmed.
- No manifest edits were made; `sourcePack` strings above are stable references for the integration batch.

## Round 8.1 - Targeted Character-Body Pack Integration

Date: 2026-05-29
Source of truth: `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json` schema 7 plus staged body/source archive files inspected during the Round 8.1 implementation/documentation pass.

Round 8.1 completed the targeted body-swap follow-up that Round 8 left open. The root mesh2motion body remains only as the rat control; seven personas now declare `bodyOverride` entries from downloaded CC0 character body packs. No procedural character body/skin fallback was used for any Round 8.1 body-pack replacement. The only procedural skin text still present is inherited Round-5/Round-8 control or UV-layout fallback metadata, not a Round 8.1 substitute for a missing character pack.

### Mechanism Summary

| Pack / branch | Mechanism fired | Outcome |
|---|---|---|
| `Quaternius-ModularCharacterOutfitsFantasy-CC0` target | Mechanism 1 used for metadata/license only; Mechanism 2 skipped because `ITCHIO_SESSION` was absent; Mechanism 3 fired | Official Quaternius/itch target is CC0 but gated for anonymous headless download, so four individual Quaternius CC0 Poly Pizza GLBs were integrated. |
| `OGA-BlackScorp-LowPolyWarrior-CC0` | R3 rigging inspection branch fired | Archive inspected and rejected for body integration because it is OBJ/MTL/PNG only and unrigged. |
| `Kaykit-Adventurers-CC0` | R3 rigged-warrior alternate; manifest `downloadMechanism: "itch-anonymous-free-flow"` | Integrated paranoid as the rigged CC0 alternate for the BlackScorp slot. |
| `Kenney-MiniCharacters-CC0` | Manifest `downloadMechanism: "kenney-direct"` | Integrated trader and sprinter from the no-auth Kenney ZIP. |

### Quaternius Character Bodies

Target pack:

- Official page: <https://quaternius.com/packs/modularcharacteroutfitsfantasy.html>
- Itch page: <https://quaternius.itch.io/modular-character-outfits-fantasy>
- License: `CC0-1.0` / CC0 1.0 Universal / Public Domain. The current manifest records that the Poly Pizza model pages report Public Domain (CC0) and that the Quaternius target pack metadata also reports CC0.
- Download path: the official modular outfit archive was not downloaded. `ITCHIO_SESSION` was absent, so Mechanism 2 was skipped and Mechanism 3 (`poly.pizza` individual models) delivered the integrated bodies.
- Official archive sha256: unknown / not downloaded.
- Procedural fallback: none. The fallback was sourced CC0 Quaternius individual GLBs, not generated character bodies or skins.

Integrated Quaternius Poly Pizza bodies:

| Persona | Body | Page URL | Download URL | License | GLB sha256 | Source archive sha256 | Mechanism |
|---|---|---|---|---|---|---|---|
| duelist | `characters/quaternius-shaun.glb` / `Characters Shaun` | <https://poly.pizza/m/eJFT9MxzOM> | <https://static.poly.pizza/c8ecc219-6a19-4fd1-ae1a-6ceeda529eaf.glb> | `CC0-1.0`; CC0 1.0 Universal / Public Domain | `16633fc8b960b025247b6016f0199f848f38c0c6bb2c91c37b81fadc9005d5a5` | `16633fc8b960b025247b6016f0199f848f38c0c6bb2c91c37b81fadc9005d5a5` (`/tmp/round-8-1-assets/quaternius-polypizza/shaun.glb`) | Mechanism 3 |
| opportunist | `characters/quaternius-anne.glb` / `Anne` | <https://poly.pizza/m/tZYaOQ4l94> | <https://static.poly.pizza/1cc2232d-b43e-4fc0-b97f-134b4a528bf8.glb> | `CC0-1.0`; CC0 1.0 Universal / Public Domain | `cfee1b57f380ff4b51fc0b88c9d4750ea1748936eb8b7d5557291913077d1e30` | `cfee1b57f380ff4b51fc0b88c9d4750ea1748936eb8b7d5557291913077d1e30` (`/tmp/round-8-1-assets/quaternius-polypizza/anne.glb`) | Mechanism 3 |
| camper | `characters/quaternius-henry.glb` / `Henry` | <https://poly.pizza/m/yEdSk8tRKc> | <https://static.poly.pizza/b91485bd-aaa0-4a9a-802c-b16e08ae05e7.glb> | `CC0-1.0`; CC0 1.0 Universal / Public Domain | `ae91c5ec699f1f97f980628ab6d54fffaa20c0ed30d3680245fde56eea2204cf` | `ae91c5ec699f1f97f980628ab6d54fffaa20c0ed30d3680245fde56eea2204cf` (`/tmp/round-8-1-assets/quaternius-polypizza/henry.glb`) | Mechanism 3 |
| vulture | `characters/quaternius-pirate-captain.glb` / `Pirate Captain` | <https://poly.pizza/m/sN18LyyHAU> | <https://static.poly.pizza/c814c745-1cf5-4d92-bd85-200c66eb7843.glb> | `CC0-1.0`; CC0 1.0 Universal / Public Domain | `688b0db0487dadaa6dbbf9e5613793aa9c1280902255212bd51bc46ff17f695d` | `688b0db0487dadaa6dbbf9e5613793aa9c1280902255212bd51bc46ff17f695d` (`/tmp/round-8-1-assets/quaternius-polypizza/pirate-captain.glb`) | Mechanism 3 |

Round 8.1 armor preservation notes: duelist keeps `quaternius_chest_plate` with `bodyOverride.armourAttachBone: "Torso"`; vulture keeps `quaternius_gauntlet` with `bodyOverride.armourAttachBone: "Middle1.L"`.

### BlackScorp Rigging Inspection

- Pack: `OGA-BlackScorp-LowPolyWarrior-CC0`
- Source URL: <https://opengameart.org/content/low-poly-warrior>
- License: `CC0-1.0`; OpenGameArt page exposes CC0 1.0 per the Round 8 log.
- Archive: `/tmp/round-8-assets/oga-blackscorp-low-poly-warrior.zip`
- Archive sha256: `7f6ecd8044093b6c8ab2e594224a3524c2510317ae0b8ec6d2cf742877137c04`
- Inspected extracted files: `base-char-male.obj`, `base-char-male.mtl`, `metal2.png`, `skin.png`
- Rigging outcome: unrigged. The archive contains no GLB/FBX, no skeleton-bearing asset, and no animation clips, so it was not integrated as a Round 8.1 persona body.
- Mechanism fired: R3 BlackScorp rigging inspection branch; branch ii selected the rigged CC0 alternate.
- Integrated personas: none.

### Kaykit Adventurers Rigged Alternate

- Pack: `Kaykit-Adventurers-CC0`
- Source URL: <https://kaylousberg.itch.io/kaykit-adventurers>
- Manifest download URL: `https://kaylousberg.itch.io/kaykit-adventurers/download_url + signed R2 upload 15363167`
- License: `CC0-1.0`; manifest notes state the Itch page advertises rigged/animated characters, free commercial use, no attribution required, and Creative Commons Zero v1.0 Universal metadata.
- Mechanism fired: R3 rigged-warrior alternate via manifest `downloadMechanism: "itch-anonymous-free-flow"`
- Source archive: `/tmp/round-8-1-assets/kaykit-adventurers-free-2.0.zip`
- Source archive sha256: `abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479`
- Source archive path: `Characters/gltf/Knight.glb + Animations/gltf/Rig_Medium/Rig_Medium_General.glb + Rig_Medium_MovementBasic.glb`
- Integrated persona: paranoid
- Integrated GLB: `characters/kaykit-adventurers-knight.glb`
- Integrated GLB sha256: `c892ed861d1a327b60380d1f59e3cd7d84f5fcb41b130e1372459dd1d01cfb7b`
- Armor preservation: paranoid keeps `quaternius_crown_helmet` with `bodyOverride.armourAttachBone: "head"`.

### Kenney Mini Characters

- Pack: `Kenney-MiniCharacters-CC0`
- Source URL: <https://kenney.nl/assets/mini-characters>
- Download URL: <https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip>
- License: `CC0-1.0`; manifest notes state the Kenney page and archive `License.txt` declare CC0 1.0 Universal.
- Mechanism fired: manifest `downloadMechanism: "kenney-direct"` (direct no-auth Kenney ZIP)
- Source archive: `/tmp/round-8-1-assets/kenney-mini-characters.zip`
- Source archive sha256: `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999`

| Persona | Integrated body | Source archive path | License | GLB sha256 | Source archive sha256 | Mechanism |
|---|---|---|---|---|---|---|
| trader | `characters/kenney-mini-characters-trader.glb` | `Models/GLB format/character-female-b.glb` | `CC0-1.0`; CC0 1.0 Universal / Public Domain | `2288438e7baf9acc91a870c82dc00d66710bb486592cfc3474ef8ed93a03863a` | `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999` | `kenney-direct` |
| sprinter | `characters/kenney-mini-characters-sprinter.glb` | `Models/GLB format/character-male-c.glb` | `CC0-1.0`; CC0 1.0 Universal / Public Domain | `672a6506f7475bbd655da1d7ff712c1729a430f134c62385a4e5d3c1378acb40` | `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999` | `kenney-direct` |

### Round 8.1 Persona Body Allocation

| Persona | Effective body source | Integrated body file | Pack / license | Mechanism |
|---|---|---|---|---|
| rat | mesh2motion control | `characters/camper-mesh2motion-human-base.glb` | `mesh2motion`; `CC0-1.0` | Existing root control, no Round 8.1 download |
| duelist | Quaternius Poly Pizza | `characters/quaternius-shaun.glb` | `Quaternius-PolyPizzaIndividual-CC0`; `CC0-1.0` | Mechanism 3 |
| trader | Kenney Mini Characters | `characters/kenney-mini-characters-trader.glb` | `Kenney-MiniCharacters-CC0`; `CC0-1.0` | `kenney-direct` |
| opportunist | Quaternius Poly Pizza | `characters/quaternius-anne.glb` | `Quaternius-PolyPizzaIndividual-CC0`; `CC0-1.0` | Mechanism 3 |
| paranoid | Kaykit Adventurers | `characters/kaykit-adventurers-knight.glb` | `Kaykit-Adventurers-CC0`; `CC0-1.0` | `itch-anonymous-free-flow` |
| camper | Quaternius Poly Pizza | `characters/quaternius-henry.glb` | `Quaternius-PolyPizzaIndividual-CC0`; `CC0-1.0` | Mechanism 3 |
| sprinter | Kenney Mini Characters | `characters/kenney-mini-characters-sprinter.glb` | `Kenney-MiniCharacters-CC0`; `CC0-1.0` | `kenney-direct` |
| vulture | Quaternius Poly Pizza | `characters/quaternius-pirate-captain.glb` | `Quaternius-PolyPizzaIndividual-CC0`; `CC0-1.0` | Mechanism 3 |
