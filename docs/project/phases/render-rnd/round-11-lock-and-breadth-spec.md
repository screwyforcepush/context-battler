# Round 11 — Lock & Breadth Spec (lock gore + armour technique, fix skin coverage, open armour-asset breadth)

Date: 2026-06-01
Phase: `docs/project/phases/render-rnd/`
Previous: [`round-10-adherence-consolidation-spec.md`](./round-10-adherence-consolidation-spec.md) · [`ROUND-10-CLOSING-READOUT.md`](../../../../throwaway-prototypes/d-full-match/ROUND-10-CLOSING-READOUT.md)
North Star Anchor: **Render R&D Round 11 — lock gore & armour, fix skin coverage, open armour-asset breadth**
Mental-model contract: [`../../spec/mental-model.md`](../../spec/mental-model.md) §10.1 (recursive *consolidate → reopen the next finer axis*; signal legibility; sourced-inventory-before-procedural), §13 (gore loud by design; consumer-render intent), §13.1 (substrate body **LOCKED**; settled adherence lanes — now corrected: **rigid prop on a live bone, scaled to fit** for armour; **UV-texture covering the WHOLE body** for skin; **small individual marks** for gore; the flat adhering-region fits **neither**)

---

## 1. Purpose (why this exists)

Round 10 consolidated the Round-9 breadth lanes and the user UAT'd the exported Showroom. The per-layer signal is now
clear, and Round 11 is the next §10.1 turn — *lock what's settled, refine what's open, and reopen the next finer
axis beneath a now-locked technique*. This is recursive §10.1 at work:

| Layer | Round-10 state | Round-11 UAT signal | Round-11 move |
|---|---|---|---|
| **Gore** | small marks on 3 personas (re-approach); sprinter `dismemberment_baked` death; 4 other corpse "controls" | "much better"; camper has the **best** gore (small bone-attached marks); sprinter death (baked dismemberment) "looks the best"; wants **more** pieces/splashes | **LOCK** small-marks as THE gore technique + **LOCK** baked-dismemberment as THE death treatment; **amplify** (higher mark count + splash-style marks); retire the other corpse controls |
| **Armour** | two candidates — `modular_submesh_prop` (dynamic bone) vs `adhering_region` (donated flat region) | modular prop "now looks good" (**lock it**); adhering region "not suitable" (**reject it**); props "need to be scaled down a lot"; "are there other armour assets we could try?" | **LOCK** modular-prop technique; **REMOVE** adhering-region entirely (reverses the R9 idea-bank guess); **SCALE props down** (body-only audit); **OPEN** an armour-**ASSET** breadth axis (2–3 more CC0 props + a Showroom asset selector) |
| **Skin** | 8 distinct skins (pbr/pattern/4 shaders/palette), all `uv_painted` | duelist (`pbr_texture_atlas`) + trader (`pattern_texture`) are the shortlist; duelist texture "only applied to the **joints**" — wants it on the **whole** model | **NARROW** to the duelist/trader family (variations across personas; drop the unrelated shader looks from selection); **FIX** full-body coverage (the load-bearing deliverable) |
| **Body** | mesh2motion universal, all 8 personas | settled | **STAYS LOCKED** — no body substitution, ever (§13.1) |

Strictly inside `throwaway-prototypes/d-full-match/**`. **No Convex / production / apps-replay.** CC0-first sourcing
(§10.1). Verification boundary unchanged; **no UAT job** — the user UATs the exported Showroom directly.

## 2. Research grounding (2026-06-01, validated)

Each Round-11 move is grounded in the codebase trace and validated research; the load-bearing diagnoses:

### 2.1 The skin "joints only" bug is a UV-channel mismatch (decisively diagnosed)

Direct inspection of the locked body GLB
(`shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb`) is conclusive:

- The body is a **single mesh** `Mannequin.002`, **one primitive**, with **two UV channels**: `TEXCOORD_0` (UV1) and
  `TEXCOORD_1` (UV2).
- `TEXCOORD_0` (UV1) is concentrated in a small sub-rectangle: **u ∈ [0.531, 0.988], v ∈ [0.263, 0.616]**.
- `TEXCOORD_1` (UV2) spans the **full [0, 1] × [0, 1]** square — a proper full-body unwrap.
- The body's own glTF material (`M_Main.002`) samples its `baseColorTexture` (image name **`color-palette`**) via
  **`texCoord = 0`**. → UV1 is a **palette-swatch atlas**: each body region maps to a tiny solid-color cell of a
  palette image. It is *not* a detail unwrap.

Godot's `StandardMaterial3D.albedo_texture` samples **UV1 only**. So when a persona detail texture (metal-plate
atlas, fabric pattern) is applied via the current `StandardMaterial3D` path, it is sampled at the **palette-swatch
coordinates**: each body region samples a near-constant point of the texture, so detail appears **only where UV1 has
gradient** — i.e. the seams/joint regions between palette cells. **That is exactly the user's "texture only on the
joints" symptom.**

**Fix:** persona detail-texture skins must sample from **UV2 (`TEXCOORD_1`)**, the full-body unwrap. `StandardMaterial3D`
exposes no "albedo from UV2" switch, so the correct, minimal route (validated) is a **spatial `ShaderMaterial`** that
reads `albedo` (and normal/roughness/metallic/ao) from `UV2`. UV2 is a per-vertex attribute carried through skeletal
deformation (only positions are skinned), so coverage is full-body **and** joint deformation stays clean — fully
§13.1-compliant ("UV-painted texture covering the WHOLE body, deforms with the body").

### 2.2 Armour props render at raw source scale (no normalization)

`_apply_modular_submesh_armor` (`src/EquipmentMeshAttachment.gd:653`) parents each prop mesh under a
`BoneAttachment3D` socket and sets `mesh.transform = local_transform` (the source GLB/FBX local transform) — **with no
scale normalization.** Weapons get `WEAPON_ATTACHMENT_SCALE = 0.22` via `_apply_attachment_transform`; armour props get
**nothing**, so they render at their authored source scale, which is far too large for the body (the user's "need to be
scaled down a lot"). **Fix:** introduce a manifest-driven armour prop scale (per-asset `propScale` + a sane default) and
apply it on the socket/mesh, with the corrected value derived by the **same body-only audit method** Round 10 used for
body scale (measure prop AABB against the target body-region size at `idle@0`).

### 2.3 Small-mark gore + baked-dismemberment death are the empirically-confirmed lanes

R10 already proved (and UAT confirmed) that many small single-bone-pinned marks adhere far better than broad regions
(a small mark stays inside one bone's dominant influence; a broad mark spanning a joint slides). The
`_apply_corpse_mark_specs` loop already renders **N marks from data**, so amplifying density + adding splash marks is a
pure manifest data change. `dismemberment_baked` (`bone_hide` + stump decals, `adherenceApproach: mesh_baked`) is the
confirmed death look. Locking = converging every persona's corpse gore onto small marks and the death pose onto baked
dismemberment, and retiring the control treatments (`blood_saturation_overlay`, `charred_burned_texture`,
`decay_desaturation`, floor `gore_pool_decal`).

### 2.4 CC0 armour-prop sources for the breadth axis (validated, §10.1 sourced-first)

The locked modular-prop technique needs **real prop geometry** (§13.1 — region fits neither). Confirmed CC0 sources of
separate armour pieces (helmet / chest / pauldron / gauntlet / greaves), style-consistent with the existing Quaternius
pieces:

- **Quaternius — Ultimate Modular Characters** — `https://quaternius.com/packs/ultimatemodularcharacters.html` — CC0.
  Separate helmets, chest plates, shoulder pads, gauntlets, greaves as swappable parts (usable as rigid props).
- **Quaternius — Modular Fantasy Characters** / **Modular Hero Characters** — `…/modularfantasycharacters.html`,
  `…/modularheropack.html` — CC0. More knight/hero armour modules.
- **Kenney — Characters (Modular 3D)** — `https://kenney.nl/assets/male-characters` — CC0. Modular torsos/headgear/boots.
- **Poly Pizza — armour search** — `https://poly.pizza/search/armor` — per-asset CC0 (verify each model's license);
  good for filling a specific helmet/pauldron/gauntlet gap.
- Already in-kit (CC0, reusable as additional props): the Quaternius `armorOverlay` pieces and the Robin-Lamb shield
  (`riot_plate`).

Exact pack, file, URL, license, and **sha256** are recorded in the manifest + readout at implement time (CC0-first).

## 3. Current-state map (what the runtime/manifest does today, traced to commit `e42e23b`)

- **Manifest** (`shared-harness/art-kit/manifest.json`, **schema 9**):
  - `body.modelScaleMultiplier = 0.93464883`, `targetWorldHeight = 1.71` (mirrored in `corpseBody`). **Body scale knobs.**
  - Skin: all 8 `adherenceApproach: uv_painted`; approaches = `pbr_texture_atlas` (duelist), `pattern_texture`
    (trader, opportunist), `palette_flat` (rat), `toon_cel_shader` (paranoid), `emissive_trim_shader` (camper),
    `multi_material_split` (sprinter), `rim_fresnel_shader` (vulture).
  - Gore (`corpse`): small bone-attached marks on duelist/camper/paranoid (R10 re-approach, 7–8 marks each);
    `blood_saturation_overlay` (rat), `charred_burned_texture` (opportunist), `decay_desaturation` (vulture), floor
    `gore_pool_decal` (trader), `dismemberment_baked` (sprinter — the death look).
  - Armour: per-persona `armorOverlay` props (duelist chest→`spine_03`, paranoid helmet→`head`, vulture
    gauntlet→`hand_l`), `approach: modular_submesh_prop`; **`armorRegion` blocks** on duelist/camper/paranoid (the
    rejected flat region); generic tier assets `cloth/leather/chain/plate/riot_plate` drive the tier row.
  - `round9Adherence.armorApproaches` declares **both** `modular_submesh_prop` and `adhering_region`.
- **Runtime** (`src/EquipmentMeshAttachment.gd`, 2004 lines):
  - Skin: `_apply_persona_skin` → per-approach helpers; `_apply_skin_pbr_texture` / `_apply_skin_pattern_texture` build
    a `StandardMaterial3D` and call `_apply_material_to_body_meshes` (→ `material_override`, **UV1 sampling — the bug**).
  - Gore: `_apply_persona_corpse_skin` → per-approach; small-mark paths iterate `params.decals` via
    `_apply_corpse_mark_specs` → `_apply_projected_mark`.
  - Armour: `set_armour_render_mode` (modular↔region); `_swap_armour` branches on `currentArmourRenderMode`;
    `_apply_modular_submesh_armor` (BoneAttachment3D prop, **no scale norm**); `_apply_adhering_region_armour` /
    `_clear_adhering_region_armour` (**the region path to delete**); `ARMOUR_RENDER_MODULAR` / `ARMOUR_RENDER_REGION`.
- **Showroom** (`src/Showroom.gd`, 451 lines): 4 layer toggles; **armour mode switch** (`_set_armour_render_region`,
  prop↔region); animation bar (idle/walk/attack unarmed/attack armed/loot/take hit/death); weapon + armour tier rows.
  Title says "Round 10".
- **Verification**: `scripts/verify-scaffold.mjs` (1349 lines; `round10*` constants — `round10MinimumModularArmorOverlays`,
  `round10ArmorRegionPersonas`, `round10SmallGorePersonas`, `round10MinimumSmallGoreMarks`, `armourRenderModes`,
  `round10UvPaintedSkinApproaches`, `ROUND-10-CLOSING-READOUT.md` token) + Godot audits (`audit-adherence-matrix.gd`,
  `audit-modular-submesh-armor.gd`, `audit-skin-bone-attachments.gd`, `audit-character-scales.gd`,
  `audit-universal-body.gd`, `audit-mesh2motion-clips.gd`, `verify-character-rigs.gd`, `audit-replay-load.gd`), wired in
  `package.json`.

## 4. Architecture design — per layer

All four layers stay on the **one mesh2motion body**, à la carte in the Showroom. The change set is *one real new
material path (UV2 skin shader)*, *one scale-normalization addition (armour)*, *one deletion (region path)*, *one new
selector + asset catalog (armour breadth)*, and *manifest data re-authoring (gore + skin assignment)*.

### 4.0 Review-folded corrections (LOAD-BEARING — verified against ground truth 2026-06-01)

The Round-11 plan review (3 reviewers, APPROVE-WITH-CHANGES) verified both load-bearing diagnoses against the GLB +
runtime and surfaced four completeness/sequencing corrections, each re-confirmed by direct inspection. **These are not
optional polish — they are folded into the named WPs below and gate the green build.**

- **C1 — Tests are updated SYNCHRONOUSLY, per-WP, NOT backloaded to WP-SR (was a self-imposed green-gate failure).**
  The verification surface (`verify-scaffold.mjs` + the Godot audits) **strictly asserts Round-10 state** — exactly 3
  `armorRegion` donor personas, `MIN_ARMOUR_REGION_MARKS`, the existence of `_apply_adhering_region_armour`, the R10
  gore/skin approach sets. The moment any WP edits the manifest/runtime out of R10 shape, the **unchanged** audits go
  red. So **every WP updates its own slice of `verify-scaffold.mjs` and the Godot audits in the same WP** to keep each
  slice authentically green. §4.6 / WP-SR no longer "owns all test updates" — WP-SR owns only the *final* assertions
  (Showroom selector, lane-matrix print, schema pin) layered on top of the per-WP updates. (Verified: `audit-adherence-
  matrix.gd` 16 region tokens, `audit-skin-bone-attachments.gd` 28, `verify-scaffold.mjs` 29.)
- **C2/B1 — Region deletion must scrub EVERY touchpoint, including the two Godot audits + the manifest description
  strings** (the audit `assertNotIncludes` is a raw lowercased substring match, so prose carrying the token fails the
  gate). Full inventory in §4.2(a) below. (Verified: 115 `adhering_region`/`armorRegion`/… occurrences across 6 files —
  far more than the original WP-A1 runtime-symbol list. `audit-skin-bone-attachments.gd:403-404` *asserts the region
  method EXISTS* — deleting the runtime method without inverting this audit throws.)
- **A2 — Armour `propScale` scales each CHILD MESH transform, NOT the `BoneAttachment3D` socket.** The socket transform
  is rewritten from the bone pose every frame, so `socket.scale` is clobbered. The proven weapon pattern scales the
  child `visual` (`_apply_attachment_transform`). Armour meshes are parented directly under the socket and get
  `mesh.transform = local_transform` (`EquipmentMeshAttachment.gd:697-698`) — fold `propScale` into that child
  transform (or insert an intermediate `Node3D` holder under the socket). §4.2(b) corrected accordingly.
- **B2 — The armour-asset selector needs an explicit runtime API distinct from the armour TIER.** The runtime today
  uses `armour_name` only to pick a tier, then applies the persona's mapped `armorOverlay`; nothing applies a *selected
  catalog prop* across all 8 bodies. WP-A2 must add a named entry point — e.g. `set_armour_prop_selection(prop_id)` or
  an equipment-payload `armourPropId` field — that routes the chosen `armourProps[]` block into
  `_apply_modular_submesh_armor`, keeping prop selection orthogonal to tier. §4.3/§4.5 corrected.
- **A-info (skin nuance, no scope change):** the "joints only" symptom is the **duelist `pbr_texture_atlas`** (pure
  UV1 path); the **trader `pattern_texture`** already has a `uv1_triplanar` branch that "swims" under deformation
  instead of failing identically. Routing both through the UV2 shader is still correct + unifying — **validate the UV2
  fix on the duelist first** (the user's actual report), then confirm the trader no longer swims.

### 4.1 Gore — lock small-marks + baked-dismemberment death, amplify density (§13)

**Mechanism (unchanged, data-driven):** many small `QuadMesh`/`Decal` marks each pinned to one dominant bone
(`_apply_corpse_mark_specs` loop); baked dismemberment (`bone_hide` + stump, `mesh_baked`) for the death pose.

- **Lock small-marks as THE corpse-gore technique.** Re-author the personas currently on control treatments
  (rat/opportunist/vulture/trader) onto **small bone-attached marks** in the camper style. Retire
  `blood_saturation_overlay`, `charred_burned_texture`, `decay_desaturation`, and the floor `gore_pool_decal` from the
  gore **selection** (their helper code may remain dormant, but no persona references them).
- **Amplify (§13 "gore loud by design").** Raise the per-persona mark count over R10 (target **≥ 10 marks**, up from
  6–8) and add **splash-style marks** (a distinct, larger-but-still-single-bone splatter sub-type alongside the
  small wound marks) for density + variety. Keep each mark `size` within one bone's dominant-influence region
  (≤ ~0.12 on x/y) so it sticks.
- **Lock the baked-dismemberment death pose as THE death treatment.** Sprinter's `dismemberment_baked` becomes the
  death-state look; per-persona `hideBones` + stump-decal data is authored so the death pose reads as baked
  dismemberment across personas (D-DEATH scopes how universal). Gore stays decoupled from death (R10 behaviour).

§13.1 family: `bone_attached` small marks (live gore) + `mesh_baked` (death pose). Lane: **LOCKED.**

### 4.2 Armour — lock modular prop, delete region, scale-fix (§13.1 rigid-prop-on-live-bone-scaled-to-fit)

**(a) Lock `modular_submesh_prop` (BoneAttachment3D); delete `adhering_region` entirely — FULL token inventory (§4.0
C2/B1).** The `assertNotIncludes` gate is a raw lowercased substring match, so **prose carrying the token fails too**.
Scrub all of:
- **Manifest** (`shared-harness/art-kit/manifest.json`): the `armorRegion` blocks (duelist/camper/paranoid); the
  `round9Adherence.armorApproaches` region entry; **AND the human-readable description strings** — `notes[]` lines
  carrying "donated adhering-region coverage" / "armorRegion"; `purpose` ("armour prop/region modes"); every
  `round8Evaluation.armor` string ("…plus donated adhering_region coverage", ~:304/:698/:939) and the
  `round8Evaluation.adherence` "body-tracking armour region" string.
- **Runtime** (`src/EquipmentMeshAttachment.gd`): `_apply_adhering_region_armour`, `_clear_adhering_region_armour`
  (**all three call sites** — incl. the *unconditional* clear at the top of `_swap_armour` `:548`, plus `:562`/`:566`),
  `_armor_region_for_character`/`_armour_region_tint`/`armor_region_nodes_by_character`, the `armorRegion` character-
  record field, the `usesArmourRegion` record field (`:648`) and the `uses_region` param of `_record_armour_state`
  (`:636`) — no dangling always-false flag (§10 forward-only), `ARMOUR_RENDER_REGION`, the `set_armour_render_mode`
  region branch, the `_swap_armour` region branch. `set_armour_render_mode` / `currentArmourRenderMode` collapse to the
  single `modular_submesh_prop` value (keep the symbol; one value).
- **Showroom** (`src/Showroom.gd`): the mode switch (`armour_render_mode_switch`, `_set_armour_render_region`,
  `ARMOUR_RENDER_REGION`, `_update_mode_switch_labels`'s region branch).
- **Audits/scaffold (synchronously, §4.0 C1):** `scripts/audit-skin-bone-attachments.gd` — remove
  `_audit_runtime_armour_region` (:394), `_audit_armour_region_block` (:116), the `REGION_DONOR_PERSONAS` asserts
  (:185/:243) and **invert the `has_method("_apply_adhering_region_armour")` check (:403-404)** which currently
  *asserts the region method EXISTS* (→ assert it is ABSENT); `scripts/audit-adherence-matrix.gd` — drop
  `MIN_ARMOUR_REGION_MARKS` / the region-marks assertions (:16/:333); `scripts/verify-scaffold.mjs` — drop
  `round10ArmorRegionPersonas` + the "exactly 3 donor personas" assert, move `"adhering_region"` out of
  `armourRenderModes` into a `retiredArmourRenderModes` list, and add `assertNotIncludes` absent-token checks for
  `adhering_region` / `armorRegion` / `armor_region_nodes_by_character` / `usesArmourRegion` / `_armour_region_tint` /
  `ARMOUR_RENDER_REGION` / `round10ArmorRegionPersonas`.

**The readout records the rejection honestly** (UAT: "not suitable for this one"), noting it **reverses the Round-9
idea-bank guess** that a broad flat region would serve armour — armour needs real prop geometry.

**(b) Scale the props down (the load-bearing armour fix).** Add an armour prop scale knob:
- Manifest: a per-prop `propScale` (and/or a kit-level `armourPropScale` default) on each armour-prop block.
- Runtime: apply `propScale` in `_apply_modular_submesh_armor` by **folding it into each CHILD MESH's transform**
  (`mesh.transform = local_transform.scaled(propScale)` at `:697-698`, or via an intermediate `Node3D` holder under the
  socket) — **NOT on the `BoneAttachment3D` socket**, whose transform the engine rewrites from the bone pose every
  frame (§4.0 A2). This mirrors the proven weapon child-scale pattern (`_apply_attachment_transform` scales the child
  `visual`). Props must sit on the body, not float/oversize.
- Calibration: derive the corrected scale with the **same body-only audit method** Round 10 used — measure the prop
  AABB at `idle@0` against the target body-region size; commit a principled value; document before→after for UAT.

§13.1 family: `bone_attached` rigid prop, **scaled to fit** (accepts protrusion, not true wrapping). Lane: **LOCKED.**

### 4.3 Armour-asset breadth — 2–3 more CC0 props through the locked technique

**Mechanism:** the *same* `modular_submesh_prop` BoneAttachment3D path; only the asset varies (this is a §10.1 asset
breadth axis *beneath* the locked technique — not a technique change).

- **Source 2–3 additional CC0 armour props** (helmet / chest / pauldron / gauntlet / greaves) from §2.4 sources;
  extract single pieces; record provenance (pack, URL, license SPDX, sha256, extraction archive) like the existing
  weapon/armour assets.
- **Manifest: an armour-prop catalog** — a list of prop blocks (`{name, slot, file, bindBone, propScale, source,
  license, sha256, approach: modular_submesh_prop}`) covering the existing 3 overlays **plus** the new pieces, so the
  Showroom can enumerate them. (Engineer's call: a top-level `armourProps[]` catalog, or extend the `category: armour`
  asset list with `bindBone`/`propScale`/`file` for props — keep one source of truth the selector reads.)
- **Runtime API (§4.0 B2 — orthogonal to tier).** Add an explicit selection entry point — `set_armour_prop_selection(
  prop_id)` (or an equipment-payload `armourPropId` field consumed by `_swap_armour`) — that routes the chosen
  `armourProps[]` block into `_apply_modular_submesh_armor` on its bind bone. Keep this **separate from the armour
  `armour_name`/tier path** (tier modulates material; prop selection chooses geometry). `"all"`/per-persona default
  applies each persona's mapped prop; a specific `prop_id` applies that one prop across all 8 bodies.
- **Showroom: an armour-ASSET selector** (see §4.5) drives that runtime API so each catalog prop renders through
  `_apply_modular_submesh_armor` on its natural bind bone, and the user compares pieces side-by-side.
- **OPTIONAL (D-ARMMAT):** offer the **duelist skin texture as one armour-material candidate** (the user's "skin
  texture as armour" idea) — applied to a prop as its material. Optional; **must not block** the core armour work.

§13.1 family: `bone_attached` rigid prop. Axis: **OPEN (asset breadth).**

### 4.4 Skin — narrow to duelist/trader family + full-body UV2 coverage fix (the load-bearing skin deliverable)

**Mechanism:** a **spatial `ShaderMaterial`** that samples albedo (+ normal/roughness/metallic/ao) from **UV2**
(`TEXCOORD_1`), the full-body unwrap (§2.1). Applied to the skinned body via `material_override`, it covers the whole
surface and deforms cleanly.

- **New shader + path.** Add a `shaders/uv2_body_texture.gdshader` (samples `albedo`/normal/orm from `UV2`); route
  `_apply_skin_pbr_texture` and `_apply_skin_pattern_texture` through it (build the `ShaderMaterial`, bind the
  textures + uv scale/tint params, keep the tier-material modulation hook). This is the **coverage fix** — it makes
  the existing duelist/trader textures cover the entire body instead of the palette-swatch joints.
- **Narrow the skin selection to the duelist (`pbr_texture_atlas`) + trader (`pattern_texture`) family.** Re-assign
  the other personas' skins to **variations of those two** (different CC0 albedo/pattern textures + tints/uv scale),
  all sampling via UV2. Drop the unrelated R10 shader looks (`toon_cel_shader`, `emissive_trim_shader`,
  `multi_material_split`, `rim_fresnel_shader`, `palette_flat`) **from the skin selection** — they remain a separate
  later styling axis (the shader files may stay on disk; no persona references them this round). (D-SKINVAR scopes the
  per-persona assignment.)
- **Joint deformation stays clean** — UV2 is per-vertex and follows skinning; verified by the existing rig/clip audits
  plus a new coverage assertion (§4.6).

§13.1 family: `uv_painted` UV2 texture (perfect deformation; whole-body coverage; reads as paint, no thickness). Lane:
**LOCKED on the duelist/trader family + coverage fixed.**

### 4.5 Showroom — single armour lane + armour-asset selector (à-la-carte preserved)

- **Remove** the armour mode switch (`armour_render_mode_switch`, `_set_armour_render_region`, `ARMOUR_RENDER_REGION`,
  `_update_mode_switch_labels`'s region branch).
- **Add** an **armour-asset selector** (`OptionButton`) listing the breadth catalog (§4.3). Model: an **"All
  (per-persona)"** default that shows each persona's mapped prop simultaneously (so the whole breadth set is visible at
  once), plus one entry per prop that applies **that** prop to all 8 bodies for clean same-asset side-by-side
  comparison (D-ARMSEL). Selecting an asset re-runs `update_equipment` / `_swap_armour` with the chosen prop.
- **Keep** the 4 layer toggles, weapon + armour tier rows, animation bar, gore-decoupled-from-death behaviour; ensure
  every re-apply path is animation-safe (no `AnimationPlayer` stop/re-instantiate on toggle). Update the title to
  "Round 11".

### 4.6 Verification surface — assert the locked lanes + the breadth + the coverage

- **`verify-scaffold.mjs`:** rename `round10*` → `round11*`; **gore** — every persona's corpse approach is the
  small-mark family (assert no `blood_saturation_overlay`/`charred_burned_texture`/`decay_desaturation`/`gore_pool_decal`
  in selection), mark count ≥ the raised threshold, splash-mark sub-type present, sprinter/baked-dismemberment death
  pose asserted; **armour** — `adhering_region`/`armorRegion`/`_apply_adhering_region_armour`/`ARMOUR_RENDER_REGION`
  tokens **absent** (assertNotIncludes), single `modular_submesh_prop` technique, `propScale` present + a breadth count
  ≥ existing+2; **skin** — selection limited to `pbr_texture_atlas`/`pattern_texture` family, UV2 shader token present
  (`uv2_body_texture` / `UV2`), no longer references the dropped shader approaches in persona skins; **scale** — armour
  `propScale` pins consistent; point the readout-token check at `ROUND-11-CLOSING-READOUT.md`; bump schema asserts
  9 → 10.
- **Godot audits:** `audit-modular-submesh-armor.gd` — assert prop uses `BoneAttachment3D`, region path gone, breadth
  catalog count, **scaled prop** (prop AABB within an expected body-relative envelope at `idle@0`);
  `audit-skin-bone-attachments.gd` / a new **`audit-skin-coverage.gd`** — assert the persona skin material samples UV2
  (full-body coverage), not the palette UV1; `audit-adherence-matrix.gd` — single gore approach + raised mark counts +
  death pose + single armour technique; `audit-character-scales.gd` — body scale unchanged + armour prop scale recorded;
  keep `audit-universal-body` / clips / rigs / replay-load green.
- Bump `manifest.schemaVersion` **9 → 10** (D-SCHEMA; POC forward-only, §10).

### 4.7 Data-flow summary

```
manifest.json (schema 9 → 10; body LOCKED, no bodyOverride)
  body{modelScaleMultiplier, targetWorldHeight}  ── unchanged (R10 calibration holds) ──┐
  skin{duelist pbr / trader pattern + variations; ALL sample UV2}                        │
  corpse{ALL personas → small marks, ≥10 + splash; death → dismemberment_baked}          │ _load_manifest
  armourProps[]{file, bindBone, propScale, provenance}  (NEW catalog; region removed)    │
  weapon.attachModes[dynamic_hand_bone]  (unchanged)                                     │
        │                                                                                ▼
        │                          EquipmentMeshAttachment
        │   _apply_persona_skin   (Skin)   ── UV2 ShaderMaterial (pbr/pattern only)
        │   _apply_persona_corpse (Gore)   ── small marks (all) | dismemberment_baked death
        │   _ensure_weapon_socket (Weapon) ── dynamic_hand_bone (unchanged)
        │   _apply_modular_submesh_armor   ── BoneAttachment3D prop * propScale  (region path DELETED)
        ▼
   Showroom: 8 cells × {Skin,Gore,Weapons,Armour} toggles × {armour-ASSET selector} × {anim clips} × {tier}
        ▼
   verify-scaffold.mjs + Godot audits → single gore approach + raised counts + death pose; single armour
        technique (region gone) + scaled props + breadth count; UV2 full-body skin coverage
        ▼
   web export (.pck) → user UAT in Showroom
```

## 5. Dependency map / parallelization

```
        ┌───────────────────────────────────────────────────────────┐
        │ Layer WPs all contend on manifest.json + EquipmentMeshAttachment.gd │
        └───────────────────────────────────────────────────────────┘
   WP-G (gore)        WP-A1 (armour lock+scale)        WP-K (skin UV2 + shortlist)
   data re-author     delete region + scale infra       new shader + data
        │                    │                                │
        │                    ▼                                │
        │             WP-A2 (armour-asset breadth)            │   ← needs A1's locked+scaled path
        │             source CC0 + catalog                    │
        └────────────────────┴────────────────────────────────┘
                              ▼
                   ┌────────────────────────────────┐
                   │ WP-SR (Showroom + audits + readout) │ ← needs A1 (switch gone) + A2 (selector) + all data
                   └────────────────────────────────┘
```

**Reality:** the layer WPs are conceptually independent but **all edit the two shared files**. Recommend a **single
engineer in sequence** (or isolated git worktrees with a disciplined merge — never `git stash`, per repo rules):
**WP-A1** (delete region + scale infra — unblocks A2 and the Showroom) → **WP-A2** (armour assets) → **WP-G** (gore data)
→ **WP-K** (skin shader + data) → **WP-SR** (Showroom + audits + readout, lands last and asserts the final shape).
WP-A2 depends on WP-A1; WP-SR depends on A1 (switch) + A2 (selector catalog) + all data.

## 6. Work-package breakdown (UAT-able vertical slices)

Verification boundary (all WPs): `npm run lint` / `typecheck` / `test` / `build` green; `GODOT_BIN=… npm --prefix
throwaway-prototypes/d-full-match test` (scaffold + Godot audits) green; `… run build` web export builds. **No UAT
job** — the user UATs the Showroom. Scope guard on every WP: **`throwaway-prototypes/d-full-match/**` only**, body
LOCKED to mesh2motion, CC0-first.

**Per-WP test synchronicity (§4.0 C1 — mandatory):** the audits + `verify-scaffold.mjs` strictly assert Round-10 state,
so **each WP updates the audit/scaffold assertions it invalidates within the same WP** (e.g. WP-A1 inverts the region
audits as it deletes the region path; WP-G updates the gore-approach/mark-count asserts as it re-authors gore; WP-K
updates the skin-approach/coverage asserts as it adds the UV2 path). "Gates green" is per-WP and authentic — do NOT
backload test edits to WP-SR. WP-SR adds only the *final-shape* assertions (Showroom selector present, lane-matrix
print, schema 9→10 pin, breadth count) layered on top.

### WP-A1 — Armour: lock modular prop + delete region + scale-fix

**UAT slice:** Armour ON — props sit correctly **on** the body (no oversized/floating pieces) and track the bind bone
through idle/walk/attack/death; there is **no** "Adhering region" mode anywhere in the Showroom.

**Subtasks:** delete the `adhering_region` path (manifest `armorRegion` blocks + `round9Adherence` region entry;
runtime `_apply_adhering_region_armour`/`_clear_adhering_region_armour`/`_armor_region_for_character`/`armorRegion`
record/`ARMOUR_RENDER_REGION`/the `set_armour_render_mode` + `_swap_armour` region branches); add a `propScale` knob
(manifest per-prop + default) and apply it in `_apply_modular_submesh_armor`; calibrate the scale via the body-only
audit method (commit a principled value; document before→after).

**Success criteria:** `adhering_region` fully removed (manifest + runtime + Showroom; tokens gone); `modular_submesh_prop`
is the sole armour technique via `BoneAttachment3D`; props are scaled to fit the body (recorded `propScale`); region
rejection recorded in the readout (reverses the R9 idea-bank guess); gates green.

### WP-A2 — Armour: asset-breadth axis (2–3 more CC0 props through the locked technique)

**UAT slice:** Armour ON — the new Showroom armour-asset selector lists ≥ (existing 3 + 2–3 new) props; picking each
shows it tracking the body, scaled to fit, side-by-side across personas.

**Subtasks:** source 2–3 CC0 armour props (§2.4; helmet/chest/pauldron/gauntlet/greaves), extract single pieces,
record provenance (pack, URL, SPDX, sha256, extraction); add them to the armour-prop catalog with `bindBone` +
`propScale` + `approach: modular_submesh_prop`; ensure each wires through `_apply_modular_submesh_armor` cleanly.
*Optional (D-ARMMAT):* add the duelist skin texture as one prop material candidate — must not block.

**Success criteria:** ≥ 2–3 new CC0 armour props sourced + wired through the locked dynamic-bone modular-prop technique,
each scaled to fit; provenance recorded for every new asset (CC0-first); breadth count asserted by WP-SR audits;
optional armour-material candidate noted if done.

### WP-G — Gore: lock small-marks + baked-dismemberment death, amplify density

**UAT slice:** Gore ON, walk clip — every persona shows **many** small bone-attached wound + splash marks (≥10) that
track the body with minimal slide; Death clip — the body reads as baked dismemberment.

**Subtasks:** re-author all personas' `corpse` blocks onto small bone-attached marks (camper style), raising count to
≥10 and adding a splash-style mark sub-type; retire `blood_saturation_overlay`/`charred_burned_texture`/
`decay_desaturation`/floor `gore_pool_decal` from the gore selection; lock `dismemberment_baked` as the death-pose
treatment (per-persona `hideBones`/stump data per D-DEATH); keep gore decoupled from death.

**Success criteria:** small bone-attached marks are the sole live-gore technique (controls retired from selection);
per-persona mark count ≥ the raised threshold with splash variety; baked-dismemberment is the locked death look;
each mark stays within one bone's influence (size ≤ ~0.12); gates green.

### WP-K — Skin: narrow to duelist/trader family + full-body UV2 coverage fix

**UAT slice:** Skin ON — every persona's texture covers the **whole** body (not just the joints) and deforms cleanly;
personas show variations of the duelist (`pbr_texture_atlas`) / trader (`pattern_texture`) family.

**Subtasks:** add `shaders/uv2_body_texture.gdshader` sampling albedo/normal/roughness/metallic/ao from **UV2**; route
`_apply_skin_pbr_texture` + `_apply_skin_pattern_texture` through a `ShaderMaterial` using it (keep tier modulation);
re-assign personas to duelist/trader-family variations (CC0 textures + tints/uv scale); drop the unrelated shader looks
from the skin selection (D-SKINVAR); confirm joint deformation stays clean.

**Success criteria:** the persona skin texture covers the **entire** body surface (verified by the new coverage audit),
not the palette-swatch joints; skin selection is the `pbr_texture_atlas`/`pattern_texture` family only; joint
deformation clean (rig/clip audits green); the dropped shader looks are out of selection (remain a later axis); gates
green.

### WP-SR — Showroom controls + audits + closing readout

**UAT slice:** the 4 layer toggles + the new armour-asset selector compose on every cell through idle + a motion clip +
death; the armour mode switch (region) is gone; nothing halts the animation on toggle; the audit suite prints a
per-layer lane summary.

**Subtasks:** remove the armour mode switch; add the armour-asset `OptionButton` (per-persona "All" default + per-prop
entries) driving `set_armour_prop_selection`; update the title to Round 11; **finalize** the verification surface on top
of the per-WP updates (§4.0 C1) — complete the `verify-scaffold.mjs` `round10*` → `round11*` rename, add the
*final-shape* assertions in §4.6 not already added by the layer WPs (Showroom selector present, breadth count ≥
existing+2, lane-matrix print), confirm `audit-modular-submesh-armor.gd` (region gone, breadth count, scaled prop),
`audit-adherence-matrix.gd` (single gore approach + raised counts + death pose + single armour technique), add/repurpose
`audit-skin-coverage.gd` (UV2 full-body coverage), keep universal-body/scale/clips/rigs/replay-load green; bump schema
9 → 10 + update pinned asserts; write `ROUND-11-CLOSING-READOUT.md` (locked lanes + **honest armour-region rejection** +
new armour assets & provenance + skin UV2 coverage fix + armour prop scale before→after + honest-limitations table +
open items).

**Success criteria:** consolidated controls present + working through idle + a motion clip + death; per-layer signal
isolatable; audits assert the four lanes (locked gore + death pose, single armour technique with region gone + scaled
props + breadth count, UV2 full-body skin) and a single locked body; suite prints a readable lane matrix; all gates
green incl. web export; readout documents every Round-11 move.

## 7. Assignment-level success criteria (maps to NS acceptance criteria)

1. **AC1 (gore locked + amplified):** small individual bone-attached marks are the sole live-gore technique; baked-
   dismemberment is the locked death treatment; mark/splash count raised over R10; other corpse controls retired. ✔ WP-G, WP-SR.
2. **AC2 (armour technique locked + scaled):** dynamic-bone `modular_submesh_prop` only; `adhering_region` removed from
   manifest + runtime + Showroom (rejection recorded honestly); props scaled to fit (body-only audit, recorded). ✔ WP-A1, WP-SR.
3. **AC3 (armour asset breadth):** ≥ 2–3 additional CC0 armour props sourced + wired through the locked modular-prop
   technique, side-by-side selectable; provenance recorded; optional duelist-texture-as-armour candidate. ✔ WP-A2, WP-SR.
4. **AC4 (skin shortlist + full-body coverage):** skin narrowed to the duelist/trader family with variations across
   personas; the texture covers the **whole** body (UV2 fix), not just joints; joint deformation clean; unrelated
   shader looks dropped from selection. ✔ WP-K, WP-SR.
5. **AC5 (Showroom):** independent à-la-carte per-layer toggles + animation triggers; each locked/refined treatment
   viewable on idle + motion + death; armour mode switch reduced to the single modular-prop lane + an armour-asset
   selector. ✔ WP-SR.
6. **AC6 (verification, no UAT job):** lint/typecheck/build/test + Godot audits + web export green; closing readout
   documents the locked lanes, the region rejection, the new armour assets + provenance, and the skin coverage fix. ✔ WP-SR.
7. **AC7 (locked body / scope):** mesh2motion universal for all 8 personas; no body substitution; CC0-first; no
   Convex/production/apps-replay touched. ✔ scope guard on every WP.

## 8. Honest-limitation matrix (confirmed by the closing readout — breadth data, not defects)

| Layer | Locked/refined lane | Adherence | Honest limitation |
|---|---|---|---|
| Gore (live) | small bone-attached marks (raised count + splash) | each small mark sticks to its dominant bone | many nodes; per-mark single-bone pin still imperfect at hard joints |
| Gore (death) | `dismemberment_baked` (`mesh_baked`) | whole-body baked state | bone-hide is a coarse cut; stump decals approximate the wound |
| Armour | `modular_submesh_prop` (BoneAttachment3D), **scaled to fit** | tracks bind bone every frame | rigid prop protrudes/clips at extreme bends; not multi-bone skinned |
| Armour (rejected) | `adhering_region` — **REMOVED** | n/a | flat, no thickness; "metal bends like skin" — unsuitable, reverses the R9 idea-bank guess |
| Skin | `uv_painted` via **UV2** (duelist/trader family) | whole-body coverage; deforms cleanly | reads as paint, no thickness; stylistic shaders deferred to a later axis |

## 9. Ambiguities / decisions needed

- **D-DEATH (dismemberment-death scope) — RECOMMENDED: universal.** Make `dismemberment_baked` the death look for
  **all** personas (per-persona `hideBones`/stump data), per the user's "lock it as THE death treatment" + §13 "gore
  loud by design." *Alternative:* keep it as sprinter's lane and merely lock the technique (less authoring, less loud).
  **Confirm scope with PM/user.**
- **D-ARMSEL (armour-asset selector model) — RECOMMENDED: "All (per-persona)" default + per-prop entries.** Default
  shows the whole breadth set at once (each persona its mapped prop); per-prop entries apply one asset across all 8 for
  clean same-asset comparison. *Alternative:* a plain one-at-a-time selector. **Confirm.**
- **D-SKINVAR (per-persona skin variation map).** Which CC0 texture/tint variation each non-duelist/trader persona
  gets within the pbr/pattern family. Engineer picks defensible CC0 variations (reuse in-kit textures where they fit,
  else source CC0); *the exact mapping is an empirical pick the user UATs.* **Default: 4 pbr-atlas variations + 4
  pattern variations across the 8 personas.**
- **D-ARMMAT (duelist-texture-as-armour) — RECOMMENDED: optional, do not block.** Offer the duelist texture as one
  armour-prop material candidate only if WP-A2's core work lands cleanly.
- **D-SCHEMA (schema bump) — RECOMMENDED: bump 9 → 10.** Removing `adhering_region`/`armorRegion` + adding the armour
  catalog/`propScale` + the UV2 skin path changes the manifest shape; POC posture (§10) is forward-only, breakage
  acceptable. Update all pinned `=== 9` asserts. (Mechanical; flagged so the bump is a named decision.)
- **D-SCALE (armour prop calibration target).** The engineer is blind; the prop `propScale` is chosen for internal
  consistency (prop AABB vs target body-region size, idle@0, body-only) and documented before→after for UAT. If the
  user still reads it off post-UAT, it is a one-line re-calibration.

## 10. Recommended job sequence

1. **No revert/review prerequisite** — the R10 base (locked body, à-la-carte toggles, calibrated body scale,
   gore-decoupled-from-death) is correct. Confirm **D-DEATH**, **D-ARMSEL**, and **D-SCHEMA** with PM/user up front
   (they shape WP-G, WP-SR, and the audits).
2. **Implement the layer WPs in one engineer's sequence** (they serialize on the two shared files): **WP-A1**
   (delete region + scale infra — unblocks A2 + Showroom) → **WP-A2** (armour assets) → **WP-G** (gore data) →
   **WP-K** (UV2 skin shader + data).
3. **WP-SR** last — Showroom controls + audits + closing readout; asserts the final shape, then the user UATs the web
   export in the Showroom.
4. **A light plan-review pass on WP-K** (the UV2 ShaderMaterial path — the one real new material code) and **WP-A1**
   (the region deletion + scale normalization) is where an up-front check adds the most value; the rest is mechanically
   grounded in existing code + the validated diagnoses.

---

### Spec artifact path

`docs/project/phases/render-rnd/round-11-lock-and-breadth-spec.md` (this file).
