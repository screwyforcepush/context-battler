# Round 9 — Adherence-Breadth Spec (revert body-swap + à-la-carte layer breadth)

Date: 2026-06-01
Phase: `docs/project/phases/render-rnd/`
Previous: [`round-8-1-closing-readout.md`](./round-8-1-closing-readout.md) · [`round-8-closing-readout.md`](./round-8-closing-readout.md)
North Star Anchor: **Render R&D Round 9 — adhering treatments on the LOCKED substrate body (revert the body-swap)**
Mental-model contract: [`../../spec/mental-model.md`](../../spec/mental-model.md) §10.1, §13, §13.1

---

## 1. Purpose (why this exists)

The user asked for "skin, gore, weapons, armour on the mesh2motion model." Round 8.1 misread that as a
request for *body variety* and swapped in seven foreign CC0 character GLBs (Quaternius Poly Pizza, Kenney
Mini Characters, Kaykit Adventurers) via a schema-v7 `bodyOverride` block. That is the **wrong axis**.

Mental-model §13.1 locks the substrate body: *"In a match an agent has one persistent body; its gore,
armour, and weapon appear as dynamic state changes on that body, never as a swap to a different model.
Substituting whole foreign character packs … produces variety that can never become render code."* Body-swap
variety is a dead end — it can never be rendered in a real match, where a single persistent body must show
"duelist just reached tier-3 armour" as a *state change on that body*, not as a different character model.

The genuinely unsolved problem across Rounds 7→8→8.1 is **adherence**: surface decorations that look fine on a
static mesh do **not** automatically follow skeletal deformation (§13.1). Round 9 attacks adherence head-on, on
the one locked mesh2motion body, by breadth-sampling the four independent adhering layers — **skin, gore,
weapons, armour** — each with ≥2 distinct §13.1 adherence *approaches*, all toggleable à la carte in the
Showroom so the user can isolate each layer's signal under controlled conditions (§10.1).

This is a **revert + a new breadth pass, in that order.**

## 2. Overview (what is being built)

1. **Revert the Round-8.1 body-swap.** Remove every `bodyOverride` block so all 8 personas render the single
   mesh2motion body. Re-point body/corpse/armour-bone resolution at the root body. Re-tighten the
   audit/scaffold layer to *assert a single universal body* (it was relaxed in 8.1 to permit per-persona
   bodies). Delete the seven foreign character GLBs from the art-kit.
2. **Confirm + complete the per-layer × per-approach adherence matrix** on the mesh2motion body, **reusing
   Round-8's genuinely-adhering assets** (the bodies were the dead asset, not these layers). Skin and gore
   already carry ≥2 §13.1 approaches in the preserved Round-8 manifest data; **weapons and armour each need a
   second, distinct approach added** (§5).
3. **Redesign the Showroom UX** into four **independent on-demand layer toggles** (skin / gore / weapons /
   armour), composable in any combination, working **while any animation clip plays**, so the user
   demonstrates adherence **through deformation** (idle + a motion clip + death).
4. **Re-tighten verification** to assert the single universal body *and* per-layer × per-approach adherence
   coverage. Honest-limitation artifacts are documented as breadth data, not hidden.

Strictly inside `throwaway-prototypes/d-full-match/**`. **No Convex / production / apps-replay.** Verification
boundary unchanged (§9). **No UAT job** — the user UATs in the Showroom.

### 2.1 Key insight: the layers already adhere; only the bodies were dead

The Round-8.1 `bodyOverride` blocks are **purely additive** on top of intact Round-8 data. The per-persona
`skin`, `corpse` (gore), `armorOverlay`, and weapon mappings — *and their mesh2motion bone references*
(`spine_03`, `head`, `hand_l`, `right_hand`) — are all still present in `manifest.json`. Removing the
`bodyOverride` blocks therefore **restores the Round-8 adherence behaviour automatically**: armour rebinds to
`spine_03`/`head`/`hand_l`, decals re-pin to `spine_*`, weapons re-socket to `hand_r`. Round 9 is *not* a
re-authoring of the four layers from scratch — it is a revert plus two targeted additions plus a UX redesign.

## 3. Research grounding (§13.1 families, validated)

Perplexity/Godot-docs research (2026-06-01) confirms the §13.1 taxonomy and the existing codebase's
implementation choices, and pins down the **honest limitations** that are this round's breadth data:

| §13.1 family | Mechanism | Adherence behaviour | Honest limitation (breadth data) |
|---|---|---|---|
| **bone_attached** | `BoneAttachment3D` / parented prop follows **one bone's transform** | Tracks that bone through animation; fine on rigid contact points (hand, head) | On a *deforming* limb the rigid piece **protrudes / clips / appears to slide** because neighbouring skin vertices move under it (multi-bone skinning) — §13.1 "accept that they protrude rather than wrap" |
| **mesh_baked** | Hide/scale skeleton bones, mesh-variant swap | Tracks the skeleton **by definition** (it *is* the skeleton state) | Macro structural change only (limb removal); does not solve fine surface marks |
| **uv_painted** | Material / shader change on the **same skinned mesh** (albedo + emissive tint, region mask) | **Perfect adherence** — deforms exactly with the body, no protrusion, no sliding | No geometric thickness; rigid metal "bends like skin" — looks *painted on* |

Two hard facts the design must respect (already handled in the existing code, must not regress on revert):

- **The native `Decal` node is NOT supported in the GL Compatibility / web renderer** (Forward+/Mobile only).
  `EquipmentMeshAttachment._apply_projected_mark` already detects this and falls back to a `QuadMesh` on
  compatibility. The web export uses this path — bone-pinned `QuadMesh` marks carry the documented sliding
  limitation, which is exactly the breadth signal the user evaluates.
- A single-bone `BoneAttachment3D` is **transform-correct for one bone only**; it is *not* skinned. The
  Round-8 `modular_submesh` armour is in reality a *single-bone-bound* rigid prop (`_ensure_modular_armor_skin`
  injects a one-bone `Skin`), so it protrudes — true multi-bone deforming armour was explicitly out of scope
  in Round 8 and remains a deferred lane. Round 9 documents this honestly rather than papering over it.

## 4. Revert design — exact surface to undo

### 4.1 Manifest (`shared-harness/art-kit/manifest.json`)

- Bump `schemaVersion` **7 → 8** (POC forward-only, §10; old throwaway breaks on bump are acceptable).
- **Delete the `bodyOverride` object from all 7 personas** (duelist, trader, opportunist, paranoid, camper,
  sprinter, vulture). Leave `skin`, `corpse`, `armorOverlay`, `round8Evaluation`, `notes` intact.
- Scrub the Round-8.1 body-swap sentences from each persona's `notes` string (the `"Round-8.1
  bodyOverride=…"` clauses) and from the top-level `kitName` / `purpose` / `notes`. Replace `kitName`/`purpose`
  with a Round-9 adherence-breadth description.
- Root `body` and `corpseBody` blocks are **unchanged** (mesh2motion, `modelScaleMultiplier` 0.92918305,
  `targetWorldHeight` 1.7, `armourAttachBone: "spine"`, full animation map). They are already the universal
  body — they were only being *shadowed* by `bodyOverride`.
- Add the two new adherence-approach declarations from §5 (weapon `adherenceApproach`/attach-mode tags;
  armour `armorAsPaint` block or equivalent).

### 4.2 Runtime — `src/EquipmentMeshAttachment.gd`

Three resolution points read `bodyOverride`. After the manifest no longer contains it they become inert, but
**clean them up so the single-body contract is explicit in code** (not merely "happens to work because the
field is absent"):

1. `_character_body_asset_for_manifest(asset, shared_body)` (≈L372) — delete the `bodyOverride` merge branch;
   return `shared_body.duplicate(true)` (fall back to `asset` only if `shared_body` is empty). Per-persona
   `skin`/`corpse`/`armorOverlay` still merge via the existing `character_asset.merge(source_asset, true)` at
   the call site.
2. `_corpse_body_asset_for_persona(persona_asset)` (≈L382) — delete the `bodyOverride`-present branch
   (`if not _dictionary_block(persona_asset, "bodyOverride").is_empty(): return persona_asset.duplicate(true)`).
   Keep the explicit `corpseOverride` branch and the default-to-`corpse_body_asset` path.
3. `_armor_bind_bone_for_character(character_id, armor_overlay_block)` (≈L639) — delete the
   `bodyOverride.armourAttachBone` lookup; resolve directly to `armor_overlay_block.bindBone`
   (`spine_03` / `head` / `hand_l`), defaulting to `spine_03`.
4. `_ensure_modular_armor_skin` (≈L619) — trim the foreign-skeleton fallback bone list
   (`"Torso", "Middle1.L", "handslot.l", "arm-left", …`) back to the mesh2motion bone vocabulary
   (`spine_03`, `spine_02`, `spine_01`, `head`, `hand_l`, `hand_r`). Harmless if left, but the single-body
   contract should read cleanly.

### 4.3 Showroom label — `src/Showroom.gd`

- `_source_key_for_persona` (≈L330) — delete the `bodyOverride.sourceKey` lookup. All cells now resolve to the
  root body `sourceKey` = `mesh2motion`. (The label still shows persona name + source key; with one universal
  body it reads `mesh2motion` on every cell, which is the correct, honest signal that the body is locked.) The
  cell's *layer* identity is what now varies and is surfaced by the toggle UI (§6), not the body label.
- Update the title string (`"Showroom - 8 personas, Round-5 manifest assets"`) to a Round-9 adherence label.

### 4.4 Delete foreign character GLBs

Remove from `shared-harness/art-kit/characters/` (and their `.import` sidecars + extracted texture PNGs +
`.import` sidecars + the `Textures/` subdir created by the Kenney/Kaykit imports):

```
quaternius-shaun.glb              quaternius-anne.glb
quaternius-henry.glb              quaternius-pirate-captain.glb
kenney-mini-characters-trader.glb kenney-mini-characters-sprinter.glb
kaykit-adventurers-knight.glb
+ all *_Atlas*.png / *_texture.png / colormap.png and every matching *.import
```

**Keep** `camper-mesh2motion-human-base.glb` (+ its `.import` and `_color-palette.png`). POC posture (§10)
favours deletion over parking in a throwaway tree; the closing readout records the removal so provenance is not
lost. (If the engineer prefers to *park* rather than delete, move them under a `_parked/` dir excluded from the
manifest and `.gitignore`'d — but they must **no longer be loadable as bodies**.)

### 4.5 Audit / scaffold re-tightening (single universal body)

These were relaxed in 8.1 to permit per-persona bodies; re-tighten to **assert exactly one universal body**:

| File | 8.1 state (to undo) | Round-9 target |
|---|---|---|
| `scripts/verify-scaffold.mjs` | `schemaVersion === 7`; `bodyOverridePersonas.size === 7`; `bodySourceCategoryCounts` (quaternius≥4/kenney≥2/warrior≥1); `assertBodyOverride()`; `effectiveBodyFiles.size >= 4`; references to `Quaternius-PolyPizzaIndividual-CC0` / `Kaykit-Adventurers-CC0` / `Kenney-` | `schemaVersion === 8`; assert **no asset has a `bodyOverride` key** (`bodyOverridePersonas.size === 0`); assert every character resolves to `manifest.body.file === camper-mesh2motion-human-base.glb`; delete `bodySourceCategoryCounts` / `assertBodyOverride` / `round81*Packs` sets; keep `manifest.body.file`/`sourceKey`/`armourAttachBone` root assertions (L697–698, already correct); add the §5/§8 per-layer × per-approach coverage assertions |
| `scripts/audit-body-source-provenance.gd` | per-persona body provenance (asserts ≥4 Quaternius etc.) | **Repurpose → `audit-universal-body.gd`** (or delete + fold into `audit-mesh2motion-clips.gd`): assert all 8 personas resolve to the **same** body GLB + skeleton, no `bodyOverride` present, idle+death clips on the one shared skeleton |
| `scripts/audit-mesh2motion-clips.gd` | restricted to "mesh2motion-bodied personas only" (L67 `bodyOverride` filter) | re-universalise: iterate **all 8** personas; all share the mesh2motion clip set |
| `scripts/verify-character-rigs.gd` | `required_kinds = … if bodyOverride empty else ["idle","death"]` (L127); `bodyOverride` block read (L138) | all 8 require the full mesh2motion clip kind set; drop `bodyOverride` branch |
| `scripts/audit-character-scales.gd` | parameterised over per-persona body source (L80 `bodyOverride`) | all 8 on root body → `world_h=1.7000` (the Round-8 assertion) |
| `scripts/audit-skin-bone-attachments.gd` | adapted for per-body bone variation | re-assert mesh2motion bone vocabulary for skin/decal marks |
| `scripts/audit-modular-submesh-armor.gd` | reads `bodyOverride.armourAttachBone` (L144, L200) | validate `armorOverlay.bindBone` resolves on the **mesh2motion** skeleton (`spine_03`/`head`/`hand_l`); drop `bodyOverride` branch |
| `package.json` test script | invokes `audit-body-source-provenance.gd` | invoke the repurposed `audit-universal-body.gd` (or drop, if folded); add the new adherence-matrix audit (§8) |

## 5. The per-layer × per-approach breadth matrix (the design core)

All four layers apply to the **one mesh2motion body**. Each layer carries **≥2 distinct §13.1 adherence
approaches**. Skin and gore are satisfied by preserved Round-8 data; **weapons and armour each gain a second
approach** this round. Reuse Round-8 assets throughout; CC0-first for anything new; engineer-procedural only as
a flagged last resort (§10.1).

| Layer | Approach A (§13.1 family) | Approach B (§13.1 family) | Approach C | Source of approach |
|---|---|---|---|---|
| **Skin** | **uv_painted** — material/shader on the skinned mesh: `pbr_texture_atlas`, `pattern_texture`, `toon_cel_shader`, `emissive_trim_shader`, `multi_material_split`, `rim_fresnel_shader`, `palette_flat` (7 personas). *Perfect adherence.* | **bone_attached** — `decal_stickers` projected marks pinned to `spine_*`/`upperarm_l` (opportunist). *Slides/protrudes on deforming limbs — breadth data.* | — | **Reuse Round-8** (manifest `skin.adherenceApproach` already set) |
| **Gore** | **bone_attached** — `wound_cluster_decals`, `gore_pool_decal`, `exposed_bone_decals`, `viscera_projection` QuadMesh marks pinned to `spine_*`/limb bones (duelist, trader, paranoid, camper). *Slide/protrude — breadth data.* | **uv_painted** — material variants: `blood_saturation_overlay`, `charred_burned_texture`, `decay_desaturation` (rat, opportunist, vulture). *Perfect adherence.* | **mesh_baked** — `dismemberment_baked` bone-hide/scale + stump decals (sprinter). *Tracks skeleton by definition.* | **Reuse Round-8** (manifest `corpse.adherenceApproach` already set) |
| **Weapons** | **bone_attached (dynamic)** — `BoneAttachment3D` on the `hand_r` bone, re-evaluated per frame, weapon follows the attack swing & death fall. *Tracks the hand.* | **bone_attached (static/secondary contact)** — a contrasting attach the user can A/B: either a **static `Node3D` socket** on the character root (fixed offset, **does NOT follow the hand** — visibly lags/detaches during the attack swing) **or** a **sheathed attach on a second bone** (e.g. `spine_01`/back). *The adherence question: do weapons need true bone-follow, or is a static socket "good enough"?* | — | **A reuses Round-8** Quaternius weapons + `_ensure_weapon_socket`; **B is the NEW approach** this round (engineer picks the contrast — see D-3) |
| **Armour** | **bone_attached / "modular_submesh"** — rigid CC0 Quaternius prop (chest/helmet/gauntlet) parented & single-bone-bound to `spine_03`/`head`/`hand_l` (duelist, paranoid, vulture). *Protrudes/clips — the §13.1 honest limitation, breadth data.* | **uv_painted "armour-as-paint"** — armour tier rendered as a **metallic/emissive material shift on the body mesh itself** (no separate floating mesh), per §13 *"armour tier as a metallic/emissive shift on the body, not a separately-attached floating mesh."* *Perfect adherence; reads as a coating, not a plate.* | — | **A reuses Round-8** `armorOverlay` + `_apply_modular_submesh_armor`; **B is the NEW approach** — promote the existing `_apply_armour_tier_to_standard_material` tier-shift into a first-class, declared, toggleable armour-layer approach |

Coverage check: every layer ≥2 distinct §13.1 families ✔. Across the matrix all three families
(bone_attached, mesh_baked, uv_painted) appear ✔. Both "perfect adherence" (uv_painted) and "honest protrusion/
slide limitation" (bone_attached) are sampled side-by-side per layer ✔ — the comparison is the deliverable.

### 5.1 Weapons — second approach detail (NEW)

`_ensure_weapon_socket` already contains both mechanisms: it prefers a real bone (`BoneAttachment3D` →
dynamic follow, approach A) and falls back to a static `Node3D` socket on the character root when no bone is
found (approach B). Round 9 makes this a **deliberate, switchable** breadth control rather than a silent
fallback: a Showroom "Weapons attach mode" switch flips all cells between *dynamic hand-bone* and
*static-socket* attachment so the user can watch — during the **attack** clip — whether the static weapon
detaches/lags while the dynamic one tracks. This answers a real curation question for the consumer renderer.
The engineer may instead/also implement a **sheathed second-bone** attach if the static-socket "detach" reads
as a bug rather than as signal (D-3).

### 5.2 Armour — second approach detail (NEW)

`_apply_armour_tier_to_standard_material(material, armour_tier)` already shifts albedo/metallic/roughness/
emissive on the body material by tier — i.e. armour-as-paint already exists as a *side effect* of the tier
system. Round 9 promotes it to a **named, declared, independently-toggleable armour approach**: when the
Armour layer is ON in "paint" mode, the body mesh gets the tier material shift (and the personas *without* a
rigid `armorOverlay` — rat, trader, opportunist, camper, sprinter — finally have a visible armour treatment
that adheres perfectly). When in "prop" mode, the three `armorOverlay` personas show the rigid bone-attached
prop. This gives the user the cleanest possible side-by-side: *plate that protrudes* vs *coating that wraps*.

## 6. Showroom UX redesign — four independent à-la-carte layer toggles

Goal (NS criterion 3, §10.1): the user isolates each layer's adherence signal under controlled conditions —
independent toggles, composable on any cell, working while any animation clip plays.

### 6.1 Controls (added to `Showroom._make_ui`)

A new **"Adherence Layers"** row of four `CheckButton`s, each independently on/off, default all ON:

- **Skin** — ON: each cell shows its authored persona skin treatment (uv_painted or bone_attached decals).
  OFF: neutral base material (the `fallback_material`), so the user sees the bare body and can judge other
  layers in isolation.
- **Gore** — ON: apply the persona's `corpse` gore treatment to the **live, animating** body via
  `apply_corpse_skin_to_live_character` (decoupled from the death clip). OFF:
  `restore_persona_skin_to_live_character`. This is the headline change — gore becomes a layer the user flips
  while *walk*/*attack* plays, proving (or disproving) that each gore approach tracks the skeleton.
- **Weapons** — ON: equip each cell's preferred weapon. OFF: no weapon. Paired with the **attach-mode** switch
  (§5.1: dynamic hand-bone ↔ static-socket).
- **Armour** — ON: apply armour. OFF: none. Paired with the **mode** switch (§5.2: rigid prop ↔ armour-as-paint).

Two small segmented switches (Weapons attach-mode, Armour mode) sit beside their toggles. The existing
weapon/armour **tier** rows are retained (tier is orthogonal — it modulates intensity within an approach).

### 6.2 Animation interplay (adherence-through-deformation)

The animation trigger bar (idle / walk / attack_unarmed / attack_armed / loot / take_hit / death) is retained.
**Decouple gore from death**: `_trigger_animation` no longer force-applies corpse skin on the death clip;
death plays the death *clip* (the body falls), while gore is governed solely by the Gore toggle. So the user
can run **walk + Gore ON** to see gore adherence on a moving skeleton, and **death + Gore ON** to see it on the
death pose — satisfying NS criterion 4 (idle + a motion clip + death).

**All four toggles are animation-safe by construction**: each re-applies/clears material overrides, decal
nodes, weapon sockets, or armour meshes **without touching the `AnimationPlayer`** — the clip keeps playing
through every toggle. The engineer must preserve this (no `player.stop()`/re-instantiation on toggle).

### 6.3 Scope decision: global-row toggles (D-4)

Toggles apply **globally across the 8-cell row** (each cell renders its own per-persona approach for an enabled
layer). This matches §10.1's "side-by-side display of every sampled asset" and the existing Showroom pattern
(animation/equipment already apply row-wide). "Composable on any cell" is satisfied by *any combination of
layers* composing on *every* cell. Per-cell independent toggling is a possible later refinement, explicitly out
of scope (noted as Open Question Q3).

## 7. Architecture & data flow summary

```
manifest.json (schema 8, NO bodyOverride)
  body{} ── universal mesh2motion ──────────────┐
  assets[persona].skin{adherenceApproach}        │
  assets[persona].corpse{adherenceApproach}      │  _load_manifest → character_assets_by_persona
  assets[persona].armorOverlay{bindBone}         │   (shared_body merged with per-persona layers;
  assets[persona].weapon mapping + attach-mode   │    NO bodyOverride merge)
  assets[persona].armorAsPaint (NEW)             │
        │                                        ▼
        │                          EquipmentMeshAttachment
        │        instantiate_persona_character → ALWAYS mesh2motion scene
        │        _apply_persona_skin            (Skin layer)   ── uv_painted | bone_attached
        │        apply_corpse_skin_to_live_…    (Gore layer)   ── bone_attached | uv_painted | mesh_baked
        │        _swap_weapon + socket mode     (Weapons layer)── bone_attached dynamic | static/sheathed
        │        _swap_armour: prop | paint     (Armour layer) ── modular_submesh | uv_painted
        ▼
   Showroom: 8 cells × {Skin,Gore,Weapons,Armour} toggles × {animation clips} × {tier}
        ▼
   verify-scaffold.mjs + Godot audits  → assert ONE body + per-layer×approach coverage
        ▼
   web export (.pck)  → user UAT in Showroom
```

## 8. Dependency map / parallelization

```
            ┌─────────────────────────────┐
            │ WP-0  REVERT (serializing)  │  ← lands FIRST; everything builds on the single-body base
            └──────────────┬──────────────┘
                           │
     ┌─────────┬───────────┼───────────┬───────────┐
     ▼         ▼           ▼           ▼           │
┌─────────┐┌─────────┐┌─────────┐┌─────────┐      │
│WP-Skin  ││WP-Gore  ││WP-Weap  ││WP-Armour│      │  (conceptually independent layers;
│(verify) ││(verify) ││(+2nd    ││(+armour │      │   SERIALIZE on shared manifest.json
│         ││         ││ approach)││ -as-    │      │   + EquipmentMeshAttachment.gd —
└────┬────┘└────┬────┘└────┬────┘│ paint)  │      │   coordinate or worktree)
     └──────────┴──────────┴─────┴────┬────┘      │
                                      ▼           ▼
                              ┌───────────────────────┐
                              │ WP-Toggle (Showroom UX)│  ← needs layer apply-methods
                              └───────────┬───────────┘
                                          ▼
                              ┌───────────────────────┐
                              │ WP-Verify (audits)    │  ← per-layer×approach coverage
                              └───────────────────────┘
```

**Parallelization reality:** WP-0 is a hard serializing prerequisite. The four layer WPs are *conceptually*
independent but all edit `manifest.json` and `EquipmentMeshAttachment.gd`, so they contend on shared files —
recommend a **single engineer executes them in sequence** (Skin/Gore are mostly *verify-existing*, low effort;
Weapons/Armour carry the real new code), or use git worktrees with a disciplined merge. WP-Skin and WP-Gore
can be collapsed into one "verify layers adhere on reverted base" task if convenient.

## 9. Work package breakdown

Each WP is a UAT-able vertical slice. Verification boundary (all WPs): `npm run lint` / `typecheck` / `build` /
`test` green; `GODOT_BIN=… npm --prefix throwaway-prototypes/d-full-match test` (scaffold + Godot audits)
green; `… run build` web export builds. **No UAT job.**

### WP-0 — Revert the body-swap (serializing prerequisite)

**UAT slice:** open the Showroom; all 8 cells show the **same** mesh2motion body (one silhouette, no foreign
character packs); every cell label reads `mesh2motion`.

**Subtasks:** §4.1 manifest (schema 8, strip all `bodyOverride`, scrub notes); §4.2 runtime resolution (3
points + bone-list trim); §4.3 Showroom label; §4.4 delete 7 foreign GLBs + textures + sidecars; §4.5
re-tighten scaffold + audits to assert a single universal body.

**Success criteria:**
- No `bodyOverride` key anywhere in `manifest.json`; `schemaVersion === 8`.
- `EquipmentMeshAttachment` resolves all 8 personas to `camper-mesh2motion-human-base.glb`; no `bodyOverride`
  read in the codebase (grep clean in `src/`).
- The 7 foreign character GLBs are gone from `art-kit/characters/` (or parked + unreferenced + unloadable).
- `verify-scaffold.mjs` asserts the single universal body; `audit-mesh2motion-clips` / `verify-character-rigs`
  / `audit-character-scales` pass over **all 8** personas (`world_h=1.7000` each).
- Armour still binds (`spine_03`/`head`/`hand_l`) and weapons still socket (`hand_r`) — Round-8 adherence
  restored. Lint/typecheck/build/test + Godot audits + web export green.

### WP-Skin — Skin layer adheres on the reverted base (verify + label)

**UAT slice:** with Skin ON and other layers OFF, each cell shows its authored skin treatment on the
mesh2motion body; toggling Skin OFF reveals the neutral base body.

**Subtasks:** confirm all 8 `skin.adherenceApproach` values resolve correctly on mesh2motion; confirm the
uv_painted (7) vs bone_attached decal_stickers (opportunist) split renders; ensure `_apply_persona_skin` and
the Skin OFF→neutral path are wired for the toggle (§6). No re-texturing per §6.1.

**Success criteria:** skin layer toggles cleanly on/off across all cells during any clip; ≥2 distinct §13.1
skin approaches visible (uv_painted + bone_attached); audit confirms coverage.

### WP-Gore — Gore layer decoupled from death + adheres

**UAT slice:** with Gore ON during the **walk** clip, each cell's gore approach renders on the moving body;
duelist/paranoid/camper decals visibly pin to bones (and slide/protrude — breadth data), rat/opportunist/
vulture material gore wraps perfectly, sprinter dismemberment hides limbs.

**Subtasks:** decouple gore from the death clip (§6.2); wire the Gore toggle to
`apply_corpse_skin_to_live_character`/`restore_persona_skin_to_live_character`; confirm the three §13.1
families (bone_attached/uv_painted/mesh_baked) all render on mesh2motion live + on death pose.

**Success criteria:** Gore toggles independently of animation and of the death clip; ≥2 (in fact 3) distinct
§13.1 gore approaches visible; honest slide/protrusion of bone-pinned decals documented, not hidden.

### WP-Weapons — second weapon adherence approach (NEW)

**UAT slice:** with Weapons ON, flip the attach-mode switch during the **attack** clip: in dynamic mode the
weapon tracks the hand through the swing; in the contrasting mode (static-socket or sheathed) the difference is
visible.

**Subtasks:** make `_ensure_weapon_socket`'s bone-vs-static choice a switchable mode (§5.1); declare the weapon
attach approaches in the manifest; (optional) implement sheathed second-bone attach if static-detach reads as
a bug (D-3); wire the Weapons toggle + attach-mode switch (§6).

**Success criteria:** ≥2 distinct weapon attach approaches selectable and visibly different under the attack
clip; both reuse Round-8 Quaternius weapons; adherence/limitation documented.

### WP-Armour — armour-as-paint second approach (NEW)

**UAT slice:** with Armour ON, flip mode: "prop" shows the rigid bone-attached chest/helmet/gauntlet on
duelist/paranoid/vulture (protruding — breadth data); "paint" shows a tier metallic/emissive shift on **every**
cell's body mesh (wrapping perfectly).

**Subtasks:** promote `_apply_armour_tier_to_standard_material` into a declared, toggleable armour-as-paint
approach (§5.2); add manifest declaration; ensure both modes compose with skin/gore; wire the Armour toggle +
mode switch (§6).

**Success criteria:** ≥2 distinct §13.1 armour approaches (modular_submesh bone_attached prop + uv_painted
paint) selectable and visibly contrasting; paint mode adheres on all 8 cells; prop protrusion documented
honestly.

### WP-Toggle — Showroom à-la-carte layer UX

**UAT slice:** four independent layer toggles + two mode switches; any combination composes on every cell while
any animation clip plays; nothing stops the animation.

**Subtasks:** §6.1 controls; §6.2 animation-safe re-apply (no `AnimationPlayer` disruption); §6.3 global-row
scope; retain tier rows + animation bar.

**Success criteria:** all four layers toggle independently and compose; toggling mid-clip never halts
animation; the user can isolate each layer's adherence signal (e.g. Gore-only + walk).

### WP-Verify — re-tighten audits to assert one body + the adherence matrix

**UAT slice:** the audit suite (machine-introspection, §10) prints a per-layer × per-approach matrix and
asserts a single universal body.

**Subtasks:** finalize §4.5 single-body audits; add a per-layer × per-approach coverage assertion to
`verify-scaffold.mjs` (each of skin/gore/weapons/armour ≥2 distinct §13.1 approaches; union covers all three
families); add/repurpose a Godot audit that instantiates the one body and confirms each layer's apply-path
fires on the mesh2motion skeleton; wire into `package.json`; ensure the forbidden-token grep
(`verify-scaffold.mjs` discipline) no longer references Round-8.1 body packs.

**Success criteria:** audits assert exactly one universal body AND per-layer ≥2-approach coverage; suite prints
a readable matrix for the closing readout to quote; all green.

## 10. Assignment-level success criteria (maps to NS acceptance criteria)

1. **AC1 (single body):** all 8 personas render the mesh2motion body; the 8.1 `bodyOverride`
   substitution is gone from manifest + `EquipmentMeshAttachment` + Showroom; foreign GLBs not loaded as
   bodies; audits assert a single universal body. ✔ WP-0, WP-Verify.
2. **AC2 (four layers ≥2 approaches each):** skin, gore, weapons, armour each carry ≥2 distinct §13.1
   approaches on the mesh2motion body, reusing Round-8 assets (weapons + armour gain a 2nd approach). ✔ §5,
   WP-Skin/Gore/Weapons/Armour.
3. **AC3 (independent toggles):** Showroom exposes independent on-demand toggles per layer, composable on any
   cell, while any clip plays. ✔ WP-Toggle.
4. **AC4 (adherence via deformation):** each treatment shown on idle + a motion clip + death; known-limitation
   artifacts (bone-pinned protrusion/slide) documented honestly. ✔ §6.2, all layer WPs, closing readout.
5. **AC5 (verification boundary, no UAT job):** lint/typecheck/build/test + Godot audits + web export green;
   closing readout documents the per-layer × per-approach matrix + honest per-approach limitations. ✔
   WP-Verify + readout.
6. **AC6 (no regressions of intent):** no body substitution reintroduced; CC0-first sourcing respected; no
   Convex/production/apps-replay touched. ✔ scope guard on every WP.

## 11. Honest-limitation matrix (to be filled by the closing readout — breadth data, not defects)

| Layer | Approach | Expected adherence | Expected honest limitation |
|---|---|---|---|
| Skin | uv_painted | perfect | none (looks painted, by design) |
| Skin | bone_attached decals | tracks pinned bone | slides/protrudes on deforming limb |
| Gore | uv_painted material | perfect | no geometric wound depth |
| Gore | bone_attached decals | tracks pinned bone | slides/protrudes; QuadMesh fallback unshaded on web |
| Gore | mesh_baked dismemberment | exact (is skeleton state) | macro only; stump seam |
| Weapons | bone_attached dynamic | tracks hand through swing | rigid; minor wrist clipping at extreme bend |
| Weapons | static/sheathed | — | static lags/detaches in swing (the signal) / sheathed protrudes |
| Armour | modular_submesh prop | tracks bind bone | **protrudes/clips** (single-bone bind, not multi-bone skinned) |
| Armour | uv_painted paint | perfect | no thickness; "metal bends like skin" |

## 12. Decisions — resolved

- **D-1 (schema bump):** ✅ **DONE.** `schemaVersion` bumped 7 → 8 (POC forward-only, §10).
- **D-2 (delete vs park foreign GLBs):** ✅ **DONE — deleted.** POC posture; provenance preserved in the
  [Round-9 closing readout](../../throwaway-prototypes/d-full-match/ROUND-9-CLOSING-READOUT.md) and the
  [Round-8.1 closing readout](./round-8-1-closing-readout.md) (sha256, URLs, licenses).
- **D-3 (weapons' second approach):** ✅ **RESOLVED — dynamic hand-bone follow vs static-root-socket.**
  Static socket is the negative-control contrast: it intentionally detaches during the attack swing, making
  the adherence difference visible. Sheathed second-bone fallback was not needed; the static detach reads as
  comparison signal, not a bug. Documented honestly in the readout's limitations table.
- **D-4 (toggle scope):** ✅ **DONE — global-row toggles.** All four layer toggles and both mode switches
  apply row-wide. Per-cell toggling deferred (Q3).
- **Q-skin-3rd-family:** ✅ **Closed — not needed.** Skin carries uv_painted + bone_attached (≥2 met); no
  natural mesh_baked family for skin exists. No action unless the user requests a 3rd.
- **Q3 (per-cell toggling):** Deferred refinement. Global-row scope matches §10.1's side-by-side pattern and
  the existing Showroom row-wide convention.

## 13. Recommended job sequence

1. **Implement WP-0 (Revert) first** — it is the serializing base; nothing else is meaningful until all 8
   cells render the one body and audits assert it. (No separate review job needed pre-implement: this is a
   well-scoped revert against a documented prior state.)
2. **Then the layer work, in one engineer's sequence:** WP-Skin + WP-Gore (verify-existing, fold together) →
   WP-Weapons + WP-Armour (the two new approaches). They serialize on `manifest.json` /
   `EquipmentMeshAttachment.gd`.
3. **WP-Toggle** once the layer apply-paths exist.
4. **WP-Verify** last (audits assert the final shape) — then the user UATs the web export in the Showroom.
5. **A light plan-review pass on D-3** (weapons' second approach) before WP-Weapons is the one place an
   up-front check adds value; the rest is mechanically grounded in existing code.

---

## 14. Round closure

Round 9 is **closed** (commit `7812244`, 2026-06-01). All acceptance criteria
(AC1–AC6, §10) met. The §13.1/§10.1 correction of Round 8.1's body-swap axis
error is complete: the substrate body is locked, the four adhering layers are
breadth-sampled with ≥2 §13.1 approaches each, and the Showroom exposes
independent à-la-carte toggles for user evaluation.

Closing readout:
[`ROUND-9-CLOSING-READOUT.md`](../../throwaway-prototypes/d-full-match/ROUND-9-CLOSING-READOUT.md)

---

### Spec artifact path

`docs/project/phases/render-rnd/round-9-adherence-breadth-spec.md` (this file).
