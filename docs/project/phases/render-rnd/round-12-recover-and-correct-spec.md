# Round 12 — Recover & Correct (Preserve-Then-Extend)

Date: 2026-06-01
Phase: render-rnd
Previous: [`round-11-lock-and-breadth-spec.md`](./round-11-lock-and-breadth-spec.md) · [`ROUND-11-CLOSING-READOUT.md`](../../../../throwaway-prototypes/d-full-match/ROUND-11-CLOSING-READOUT.md)
R10 reference (the looks to recover): [`ROUND-10-CLOSING-READOUT.md`](../../../../throwaway-prototypes/d-full-match/ROUND-10-CLOSING-READOUT.md) + manifest at commit **e42e23b** (R10 final close)
Scope: `throwaway-prototypes/d-full-match/**` only. No Convex / production / apps-replay.
Mental model: [`mental-model.md`](../../spec/mental-model.md) §10.1 (preserve-the-validated-instance), §13 (gore loud by design), §13.1 (locked-body adherence lanes).
Status: **Complete** — implemented commit `24c08a3`, validated GREEN (lint/typecheck/build/test/Godot-audits/web-export), closing readout written. User Showroom UAT pending.

---

## 1. Purpose

Round 11 homogenized the eight personas by **re-deriving each surface layer from its
technique label instead of preserving the specific validated instance** (§10.1: "Locking a
winner preserves the validated *instance*, not just the technique label"). The user reported
four regressions in Showroom UAT: the duelist metal-plate skin washed to flat colour/sheen,
the extreme visceral gore ("wriggly guts") sanitized to small marks, sprinter's missing-limb
corpse gone, and three new armour props that never render. Round 12 **restores trust** by
getting the user back the exact looks they approved in Round 10, then carefully re-applying
Round 11's genuinely-good deltas on top — never rebuilding a validated look from its label.

This is a **recovery**, not a fresh consolidation. The body stays locked to mesh2motion.

## 2. Root cause — diagnosed, traced in source (not a build/serving issue)

`serve.mjs` reads `dist` live with `Cache-Control: no-store`; the user's hard refresh showed the
true Round-11 build. The regressions are real. **Critically, the runtime never lost the
capability — only the manifest data and the audit constants were narrowed.** Traced in
`src/EquipmentMeshAttachment.gd`:

- The skin dispatcher (`_apply_persona_skin`, `match approach:` ~L1132) **still handles**
  `palette_flat`, `toon_cel_shader`, `emissive_trim_shader`, `multi_material_split`,
  `rim_fresnel_shader`. All distinct shader files still exist under
  `shared-harness/art-kit/shaders/`. R11 only stopped *selecting* them in manifest data.
- The corpse dispatcher (`_apply_persona_corpse_skin`, `match approach:` ~L1245) **still
  handles** `viscera_projection`, `dismemberment_baked`, `gore_pool_decal`,
  `charred_burned_texture`, `exposed_bone_decals`, `decay_desaturation`.
- `scripts/verify-scaffold.mjs` actively **enforces** the homogenization through constants
  (`round11SkinApproaches`, `retiredPersonaSkinApproaches`, `round11LiveCorpseApproach`,
  `round11MaximumSmallGoreBodyMarkAxis = 0.12`). These constants must be inverted, or the
  recovered data will fail the audits.

### The Round-10 validated instance table (the look to recover, commit e42e23b)

| Persona | R10 skin `approach` | R10 live corpse `approach` | R11 skin (now) | R11 corpse (now) |
|---|---|---|---|---|
| rat | `palette_flat` | `blood_saturation_overlay` | pattern_texture | small_bone_attached_marks |
| **duelist** | **`pbr_texture_atlas`** (MetalPlates, uv1) | `wound_cluster_decals` | pbr_texture_atlas (uv2 [1,1] washed) | small marks |
| **trader** | **`pattern_texture`** | `gore_pool_decal` | pattern_texture | small marks |
| opportunist | `pattern_texture` | `charred_burned_texture` | pattern_texture | small marks |
| paranoid | `toon_cel_shader` | `exposed_bone_decals` | pbr_texture_atlas | small marks |
| **camper** | `emissive_trim_shader` | **`viscera_projection`** ← wriggly guts | pbr_texture_atlas | small marks |
| **sprinter** | `multi_material_split` | **`dismemberment_baked`** ← limbs missing | pattern_texture | small marks + universal death |
| vulture | `rim_fresnel_shader` | `decay_desaturation` | pbr_texture_atlas | small marks |

R11 collapsed eight distinct skins → two (pbr×4, pattern×4, all through one UV2 shader) and
eight distinct corpses → one (`small_bone_attached_marks`) + a **universal** dismemberment
death applied identically to all eight.

### Per-regression cause

1. **Skin wash-out** — the UV2 full-body shader (`uv2_body_texture.gdshader`) samples `UV2`
   (the whole-body unwrap) at `uv2_scale [1,1]`, so the tileable ambientCG MetalPlates017A
   atlas maps **one tile across the entire body** → plates become body-sized and read as flat
   colour. The *coverage* fix (UV2) destroyed the *richness* it was meant to preserve — a §10.1
   violation (a fix to one property regressed a separately-validated property).
2. **Skin homogenization** — all eight routed through pbr/pattern + the one UV2 shader; param-only
   tints/sheen are exactly the "same body, different colour/sheen" the user rejected.
3. **Gore sanitized** — camper's `viscera_projection` (visceral decal set, larger marks) was
   retired and clamped into the small-mark envelope (`MaximumSmallGoreBodyMarkAxis 0.12`).
4. **Sprinter death lost** — R11 universalized one `dismemberment_baked` (hideBones
   `[thigh_l, lowerarm_r]`, **shrunk** stump decals ~0.18/0.16) and applied it to all eight,
   overwriting sprinter's R10 instance (same bones but **larger** 0.34/0.30 stump gore) and its
   distinctiveness; the live corpse no longer shows the missing limbs (decoupled onto the Death
   trigger only).
5. **Armour props invisible** — the 3 new FBX props ARE in `armourProps[]` and the Showroom
   selector lists them, but `_apply_modular_submesh_armor` applies one uniform `propScale` via
   `_scaled_transform` (scales **origin and basis**), with **no per-prop AABB fit and no bone
   offset**. At `propScale 0.16/0.14` the new props collapse toward the bind-bone origin (inside
   the torso/head) and shrink → buried/invisible. The user's insight: these are the *opposite*
   scale problem from the old props — too small / wrong native unit, not too large.

## 3. Overview — what is being built

A preserve-then-extend recovery across four surface layers plus an anti-homogenization audit
rework, all inside `throwaway-prototypes/d-full-match/**`:

- **Skin**: restore the eight distinct R10 skin instances; fix the duelist atlas to read with
  plate detail *while keeping* full-body UV2 coverage; keep duelist + trader as the two clearly-
  different validated shortlist anchors.
- **Gore**: restore camper's visceral extreme (wriggly guts) and *layer* the amplified small
  marks on top — louder, not sanitized.
- **Death**: restore sprinter's R10 dismemberment instance (larger stump gore, missing limbs),
  de-homogenized from the universal death.
- **Armour**: keep the locked dynamic-bone modular-prop technique and the removed adhering-region;
  make the 3 new props visible via **per-asset fit-normalization** (measured native AABB →
  per-prop fit-scale + a post-scale bone offset), some scaled up, some down.
- **Audits**: invert the R11 homogenization constants and add assertions that **fail on
  homogenization** — distinct per-persona skin params, duelist atlas + tiling preserved, a
  visceral gore treatment present, sprinter's dismemberment present, each new armour prop visible
  with a per-prop fit-scale.

### Preserve (Round 11's genuinely-good deltas — do NOT revert)

- The **UV2 full-body coverage path** for texture-sampled skins (duelist pbr, trader/opportunist
  pattern). Keep UV2; only fix the tiling so detail survives.
- **Small-mark amplification** for live gore — kept as the base/additional layer.
- The **three new CC0 breadth props** and the **armour-asset selector** — kept, made visible.
- **Locked dynamic-bone modular-prop** technique; **adhering-region removed** (UAT-rejected).

## 4. Architecture design

### 4.1 Key insight — recovery is mostly data + targeted code

Because the runtime dispatchers already handle every R10 approach, the bulk of the recovery is
**manifest data** restoring the R10 per-persona instances, plus three targeted code changes:

| Change | Surface | File(s) |
|---|---|---|
| Restore 8 distinct `skin.approach` blocks; duelist atlas keeps 5 PBR maps; set per-texture `uv2_scale` tiling | data | `shared-harness/art-kit/manifest.json` |
| (If tiling alone insufficient) verify/repair UV2 layout or shader sampling | code | `shaders/uv2_body_texture.gdshader` |
| Restore camper `viscera_projection` + layered small marks; restore sprinter R10 dismemberment | data | `manifest.json` |
| Per-asset armour fit: add `fitScale` + `propOffset`; apply post-scale offset | code+data | `EquipmentMeshAttachment.gd`, `manifest.json` |
| Prop native-AABB measurement (body-only method) | code | new `scripts/audit-armour-prop-aabb.gd` (or extend `audit-character-scales.gd`) |
| Invert R11 constants; add anti-homogenization assertions (data-detectable ones in `verify-scaffold.mjs`) | code | `verify-scaffold.mjs`, `audit-modular-submesh-armor.gd`, `audit-skin-bone-attachments.gd`, `audit-adherence-matrix.gd` |

### 4.2 Skin — coverage without wash-out, distinctiveness preserved

- **Texture-sampled skins** (duelist `pbr_texture_atlas`; trader/opportunist `pattern_texture`):
  keep routing through `uv2_body_texture.gdshader` (full-body UV2 coverage — the good R11 delta).
  Fix wash-out by **tiling**: raise `params.uv2_scale` from `[1,1]` so the MetalPlates atlas
  repeats enough times to read as plate detail across the body. Derive a starting value from the
  body UV2 footprint (a tileable ~1m material on a ~1.8m body wants several repeats — start in the
  `[4,4]`–`[8,8]` range) and **validate the final value in the Showroom** (user is the visual
  gate). **Make the tiling technically real, not just numerically higher** (review HIGH): a
  `UV2 * uv2_scale > 1.0` lookup only repeats if the sampled texture's wrap mode is REPEAT. Confirm
  the MetalPlates atlas textures are imported with `repeat_enable`/REPEAT wrap (not CLAMP — which
  would smear the last texel instead of tiling), or set `repeat_enable` explicitly in
  `uv2_body_texture.gdshader`'s sampler. Keep all **5 PBR maps** (albedo/normal/roughness/metallic/
  ao) on the atlas. If tiling alone cannot recover detail (e.g. UV2 islands are degenerate), the
  fallback is to inspect/repair the UV2 unwrap or the shader's UV2 sampling — diagnose, do not
  flatten to a single albedo/tint. **Escalation decision point** (review LOW): if a handful of
  Showroom tiling values still read flat, escalate UV/shader diagnosis as a **separately-scoped**
  task — do **not** collapse to albedo/tint under time pressure.
- **Procedural shaders** (rat `palette_flat`, paranoid `toon_cel`, camper `emissive_trim`,
  sprinter `multi_material_split`, vulture `rim_fresnel`): restore as the R10 per-persona
  instances. These cover the whole body by construction (no UV-atlas dependency — R10 confirmed
  "they adhere perfectly"), so they satisfy §13.1 whole-body coverage with no tiling concern.
- **Distinctiveness**: the eight personas now use structurally different treatments, anchored on
  the duelist (pbr metal) + trader (pattern) shortlist as two clearly-different looks. Param-only
  variation is explicitly insufficient (it is what the user rejected).

### 4.3 Gore — restore the extreme, keep the amplification

- **GROUND TRUTH (verified against e42e23b — read before implementing).** The R10 camper
  `viscera_projection` instance is `corpse.approach: "viscera_projection"` with
  `corpse.params.decals[]` = **7 decals (max axis 0.11, all at/below the 0.12 small-cap)** and an
  `corpse.params.organColor` param. The R10 viscera decals carry **NO `markType` and NO `texture`
  field** — the visceral READ comes from the **`viscera_projection` approach + `organColor` + the
  decal set**, NOT from oversized marks and NOT from `viscera-chest/abdomen` texture names (those
  do not exist in the R10 data). **Do NOT inflate marks past the cap to manufacture "visceral"** —
  that re-derives the look from a size-label (§10.1 sin) and would not match the approved instance.
- **Restore camper verbatim**: set `corpse.approach: "viscera_projection"` and restore the R10
  `params.decals[]` (7 decals) + `organColor` exactly. **Then amplify by COUNT/DENSITY** (more guts
  decals / more small splashes on top), not by enlarging individual marks beyond the small envelope.
- The runtime renders `viscera_projection` and `small_bone_attached_marks` through the same
  projected-mark system (`_apply_corpse_mark_specs`), differing in the decal *set* + saturation, so
  the amplified small-mark layer can sit in the same combined `decals[]` list on top of the viscera.
- Other personas keep R11's amplified small marks as the live-gore base (a preserved delta). The
  visceral extreme must be **present on at least the loud persona (camper)** so gore is not
  sanitized.

### 4.4 Death — sprinter's validated dismemberment

- **GROUND TRUTH (verified against e42e23b).** The R10 sprinter missing-limb look lived at the
  **LIVE corpse path**, `corpse.approach: "dismemberment_baked"`, with
  `corpse.params = { method, hideBones: ["thigh_l","lowerarm_r"], stumpDecals: [0.34×0.28 @thigh_l,
  0.30×0.24 @lowerarm_r], fallbackBoneScale: 0.01 }`. R11 set sprinter's live
  `corpse.approach` to `small_bone_attached_marks` and moved a **shrunk universal** dismemberment
  (~0.18/0.16) onto a separate `corpse.deathTreatment` applied to all 8 — so the live corpse no
  longer shows missing limbs. **The carrier to restore is `corpse.approach`, NOT `deathTreatment`**
  (review HIGH) — the Showroom Gore path applies `corpse` to the live character; `deathTreatment`
  only fires on the death clip.
- Restore sprinter's `corpse.approach: "dismemberment_baked"` with hideBones `[thigh_l, lowerarm_r]`,
  the **larger** R10 stumpDecals (0.34×0.28 thigh, 0.30×0.24 arm), and `fallbackBoneScale: 0.01` —
  verbatim from e42e23b — so the missing-limb corpse renders on the live sprinter again.
- **`assertLiveCorpseGore` must branch per-approach**: it currently requires `small_bone_attached_marks`
  + ≥10 marks + a splash mark, which sprinter's `dismemberment_baked` would fail. Branch the audit so
  a `dismemberment_baked` persona is asserted on hideBones + R10 stump sizing instead (WP-E).
- De-homogenize: sprinter's death is its distinct validated instance, not "the universal death on
  every persona." Other personas keep R11's decoupled `deathTreatment` as an accepted delta (D2), but
  the "sprinter-tested universal" rationale is stripped so it is not presented as the validated
  sprinter look.

### 4.5 Armour — per-asset fit normalization

Replace the single uniform `propScale` model with **per-asset fit**:

1. **Measure**: a Godot audit (`audit-armour-prop-aabb.gd`, or an extension of
   `audit-character-scales.gd`) loads each `armourProps[]` FBX and records its **native AABB**
   (max extent) at import — the same body-only idle-pose measurement discipline §4.2 of Round 10
   used for body scale.
2. **Derive per-prop fit-scale**: `fitScale = targetSlotExtent / nativeMaxExtent`, where the
   target slot extent is the body region the prop covers (chest ≈ torso width, helmet ≈ head
   size). Some new props will scale **up**, some **down** — this is normalization, not a uniform
   shrink. Record per prop (replacing/augmenting `propScale`).
   - **One explicit frame** (review MED — coordinate space): unlike skin tiling (a taste call left
     to UAT), the fit is a **geometric value the audit verifies objectively**, so `targetSlotExtent`
     and `nativeMaxExtent` must be expressed in the **same frame** or the derived scalar is itself a
     guess. The prop's native AABB is measured under a `BoneAttachment3D` socket on a skeleton
     already scaled by `modelScaleMultiplier`(~0.935) under `WORLD_SCALE 0.38`, and `_scaled_transform`
     scales the **source-local** transform. Resolve by measuring the **attached prop's world AABB vs
     the body's world AABB** and solving for the scalar empirically — do not mix import-frame and
     world-frame extents. `propOffset` fixes "buried at origin"; `fitScale` fixes "too small/big" —
     keep the two concerns separate.
   - **Existing-prop regression invariant** (review MED — self-regression): the 3 already-validated
     existing props currently render correctly at `propScale 0.38`. An AABB-**derived** fitScale will
     not generally equal 0.38, so deriving it for them risks silently rescaling a separately-validated
     property (an AC5 violation). **Pin the existing props' effective world size to their current
     validated values and assert it is byte-for-byte unchanged**; **derive** fitScale only for the 3
     NEW props (Armor_Leather, Armor_Black, bucket helmet).
3. **Add a post-scale bone offset**: a new `propOffset: [x,y,z]` field on `armourProps[]` (and the
   per-persona `armorOverlay`), applied **after** scaling in socket space so the prop sits on the
   body *surface* at its slot rather than collapsed at the bind-bone origin (the cause of
   "buried"). Wire it through `_apply_modular_submesh_armor` / `_scaled_transform` (the current
   code scales origin with basis and applies no offset).
4. **Selector**: the Showroom `armour_asset_selector` + `set_armour_prop_selection` already apply a
   chosen prop to live characters across idle/motion/death — verify each new prop is visible and
   fits when selected.
5. **Optional (non-blocking)**: surface the duelist MetalPlates atlas as one armour-material
   candidate (standing user idea), only if it does not block the core fixes.

### 4.6 Audits — fail on homogenization

The verifier flips from *enforcing* homogenization to *forbidding* it. **The audit contract is the
entire point of this review gate — it must be adversarial enough that a re-homogenization FAILS.**

**HIGH — the gate must not pass green without running the checks.** `npm test` runs
`verify-scaffold.mjs && if [ -n "$GODOT_BIN" ]; then <.gd audits>; else echo skipped; fi`. With
`GODOT_BIN` unset (the **default** in this container) the `.gd` audits — including the only
world-space armour-visibility check — are **skipped and the run exits 0**. This is exactly how R11
shipped homogenized with "checks passed" ([[project_godot_audits_skip_silently]]). Two mandatory rules:
1. **Every data-detectable assertion lives in `verify-scaffold.mjs`** (which always runs): distinct
   per-persona skin approaches/params, duelist atlas 5-PBR-maps + `uv2_scale` tiling floor +
   repeat-mode token, camper `corpse.approach == "viscera_projection"` + `organColor` + decal set,
   sprinter `corpse.approach == "dismemberment_baked"` + hideBones + R10 stump sizes, per-new-prop
   `fitScale`/`propOffset` present, existing-prop size unchanged.
2. For genuine runtime visibility (the world-space prop AABB check that needs Godot), **Round-12
   validation FAILS — not "skips" — when `GODOT_BIN` is unset.** "Skipped" must never read as
   "passed." The validation step exports the verified arm64 binary (see §9).

Concrete assertion inversions across `verify-scaffold.mjs`, `audit-modular-submesh-armor.gd`,
`audit-skin-bone-attachments.gd`, **and `audit-adherence-matrix.gd`** (review MED — this audit ALSO
enforces the R11 skin shortlist / small-gore-only / universal deathTreatment / `propScale` and will
block recovery when `GODOT_BIN` is set; invert it too and add it to the WP-E edit list):

- Replace `round11SkinApproaches`/`retiredPersonaSkinApproaches`: the distinct approaches are
  **valid again**; assert per-persona skin params are **not all identical** (distinctiveness),
  duelist `pbr_texture_atlas` keeps its 5 PBR maps **and** `uv2_scale` above the washed `[1,1]`
  (tiling floor) **and** a repeat-mode guarantee, and at least the duelist/trader shortlist are
  structurally different approaches.
- Replace the single `round11LiveCorpseApproach` enforcement: allow per-persona corpse treatments;
  assert the **visceral instance is restored by IDENTITY, not size** — camper
  `corpse.approach == "viscera_projection"` with `organColor` and its decal set present (the R10
  marks are ≤0.11, so a size>cap test would WRONGLY REJECT the approved instance — review HIGH).
  Amplification is asserted by **count/density** (≥ R10 decal count), not by marks exceeding the cap.
  Keep the small-mark base asserting ≥ its minimum count on the other personas.
- Assert **sprinter `corpse.approach == "dismemberment_baked"`** (live corpse) with hideBones
  `[thigh_l, lowerarm_r]` and the R10 stump sizes (0.34×0.28 / 0.30×0.24) — distinct from the shrunk
  universal ~0.18/0.16. **Branch `assertLiveCorpseGore` per-approach** so the small-marks assertions
  don't fail the dismemberment persona.
- Add **armour visibility/fit assertions** (`.gd`, world-space — hard-gated per rule 2 above): for
  each of the 3 new props, select it at runtime, attach to a live body, merge transformed prop-mesh
  world AABBs, and assert **nonzero visible volume**, a sensible prop/body extent ratio for the slot,
  intersection/near-surface proximity to the body AABB, and centre near the intended bone/slot —
  neither buried-tiny nor gigantic. This replaces the weak `propScale ∈ (0,1]` check that let
  invisible props pass. Register any new `.gd` audit in `package.json` + `verify-scaffold.mjs` so it
  cannot be silently skipped.
- Keep the retired-adhering-region assertions (technique stays locked).

## 5. Dependency map / parallelization

```
WP-E (audit contract, RED)  ──defines acceptance──┐
                                                  ▼
   ┌─────────────── manifest.json data pass ──────────────┐
   │  WP-A skin   →  WP-B gore  →  WP-C sprinter death     │   (shared file: sequence or single-owner)
   └──────────────────────────────────────────────────────┘
   WP-D armour code+data (EquipmentMeshAttachment, Showroom, new AABB script) ── parallel to A/B/C ──┘
                                                  ▼
                            WP-E (tighten GREEN) → VALIDATE → web export → user UAT
```

- **WP-A / WP-B / WP-C all edit `manifest.json`.** They touch *different* sections (skin blocks vs
  corpse blocks vs sprinter death), so a single owner doing them as one coordinated manifest pass,
  or a strict A→B→C sequence (or `isolation: worktree` per agent), avoids merge conflict. Do **not**
  run them as concurrent writers on the same file.
- **WP-D is code-path work** (`EquipmentMeshAttachment.gd`, `Showroom.gd`, a new audit script) plus
  its own `armourProps[]` data fields — **independent of the A/B/C persona-block edits** and can run
  in parallel with the manifest pass (different regions of the file / different files; coordinate
  the `armourProps[]` block ownership with WP-A/B/C — assign it to WP-D).
- **WP-E (audits) brackets the work**: author the anti-homogenization assertions **first** as the
  red contract (so "done" is defined before implementation), then A–D implement to green, then a
  final WP-E tightening pass. WP-E depends on the new field shapes (`fitScale`, `propOffset`,
  distinct approaches), so its concrete thresholds finalize last.

## 6. Work package breakdown

Each WP is a UAT vertical slice: a recovered look the user can see in the exported Showroom, with
an audit that fails on its specific homogenization.

### WP-A — Skin recover + coverage-without-wash-out
- **Do**: restore the 8 distinct R10 `skin.approach` blocks in `manifest.json`; keep duelist
  `pbr_texture_atlas` (5 ambientCG MetalPlates maps) and trader/opportunist `pattern_texture` on
  the UV2 shader; set per-texture `uv2_scale` tiling so the atlas reads with plate detail; restore
  rat/paranoid/camper/sprinter/vulture procedural shaders. If tiling alone can't recover detail,
  diagnose/repair UV2 layout or shader sampling (do not flatten).
- **Success**: duelist reads with full plate detail AND full-body coverage; the 8 personas are
  visibly distinct (duelist vs trader = two clearly different looks); diffs against the R10 duelist
  reference; no persona reads as "same body, different colour/sheen."

### WP-B — Gore restore + amplify
- **Do**: restore camper verbatim to `corpse.approach: "viscera_projection"` with its R10
  `params.decals[]` (7 decals, ≤0.11) + `organColor`, then **amplify by count/density** (more guts
  decals + amplified small splashes in the combined `decals[]` list). Do **not** inflate marks past
  the 0.12 cap to fake "visceral" — the R10 instance is ≤0.11 (§4.3 ground truth).
- **Success**: toggling Gore shows wriggly viscera back AND more small marks/splashes on top —
  louder, not sanitized; audit asserts viscera by approach-identity + `organColor`, not size.

### WP-C — Sprinter death restore (LIVE corpse path)
- **Do**: restore sprinter's **`corpse.approach: "dismemberment_baked"`** (NOT `deathTreatment`)
  with hideBones `[thigh_l, lowerarm_r]`, R10 stumpDecals (0.34×0.28 / 0.30×0.24), and
  `fallbackBoneScale: 0.01` — verbatim from e42e23b — and strip the "universal sprinter" rationale.
  Ensure it renders on the **live** sprinter via the Showroom Gore path.
- **Success**: the missing-limb corpse the user approved in R10 renders on the live sprinter; it is
  sprinter's distinct instance; `assertLiveCorpseGore` branches so this approach passes.

### WP-D — Armour new-prop visibility + per-asset fit-scale
- **Do**: add `audit-armour-prop-aabb.gd` measuring each prop's native AABB (body-only method);
  derive + record per-prop `fitScale` and `propOffset` for all `armourProps[]` (some up, some down);
  wire post-scale offset through `_apply_modular_submesh_armor`/`_scaled_transform`; verify the
  Showroom selector renders each new prop visibly. Optional: duelist MetalPlates armour-material
  candidate if non-blocking.
- **Success**: each of the 3 new props (Armor_Leather, Armor_Black, bucket helmet) renders on the
  body at a correct scaled-to-fit size when selected; none buried/oversized; technique stays locked,
  adhering-region stays removed.

### WP-E — Anti-homogenization audit rework
- **Do**: invert the R11 homogenization constants in `verify-scaffold.mjs`, `audit-modular-submesh-armor.gd`,
  `audit-skin-bone-attachments.gd`, **and `audit-adherence-matrix.gd`** (also enforces R11 shortlist/
  small-gore/universal-death/`propScale`). Put **all data-detectable assertions in `verify-scaffold.mjs`**
  (always runs) per §4.6 rule 1; make `GODOT_BIN`-unset a **hard FAIL** for the world-space prop-visibility
  check per §4.6 rule 2. Add assertions: distinct per-persona skin params, duelist atlas 5-PBR-maps +
  tiling floor + repeat-mode, camper viscera by **approach-identity + organColor** (not size), sprinter
  `dismemberment_baked` live corpse + R10 stumps (branch `assertLiveCorpseGore`), per-new-prop
  `fitScale`/`propOffset` + world-AABB visibility, existing-prop size unchanged. Author as the red
  contract first; tighten after A–D land. Register any new `.gd` audit in `package.json` + scaffold.
- **Success**: the suite FAILS on a reintroduced homogenization (all-identical skins, a viscera
  treatment downgraded to small-marks, sprinter's live corpse reverted to small marks, an invisible
  prop, a silently-skipped Godot audit) and PASSES on the recovered data; closing readout diffs each
  recovered look against concrete R10 reference values (not prose) and confirms persona distinctiveness.

## 7. Assignment-level success criteria

1. **Skin recovered + coverage right** — duelist MetalPlates atlas renders with plate detail AND
   whole-body coverage (UV2 kept, tiling fixed, not flattened); 8 personas visibly distinct, duelist
   + trader two clearly-different anchors; verified against the R10 duelist look.
2. **Gore restored + amplified** — visceral "wriggly guts" extreme back AND amplified small marks on
   top; never small-marks-only.
3. **Death restored** — sprinter's R10 dismemberment (missing-limb) corpse restored as its distinct
   instance.
4. **Armour new props visible** — 3 new CC0 props render correctly via the locked dynamic-bone
   modular-prop technique with per-prop fit-scale + offset; selectable in the Showroom selector;
   adhering-region stays removed.
5. **No homogenization** — every recovery preserves the specific validated instance, not the category
   label; a fix to one property does not regress another; closing readout diffs each look vs R10 and
   confirms distinctiveness; audits fail on homogenization.
6. **Verification at the existing boundary** — lint / typecheck / build / test green;
   `npm --prefix throwaway-prototypes/d-full-match test` (Godot audits) green; web export builds;
   audits carry the new anti-homogenization assertions. **No UAT job** — the user UATs the Showroom.
7. **Body locked** — mesh2motion universal; no body substitution; CC0-first; no Convex /
   production / apps-replay touched.

## 8. Decision record (CLOSED — PM-locked at the review gate)

- **D1 — Skin distinctiveness depth → RESTORE ALL EIGHT distinct R10 instances** (5 procedural +
  duelist pbr + trader/opportunist pattern). North Star mandates "variations across other personas";
  the narrower "duelist+trader distinct, vary the rest by params" reading was the failed R11 approach
  and is rejected.
- **D2 — Non-sprinter death → sprinter's instance restored + distinct is the hard req.** Other
  personas keep R11's decoupled `deathTreatment` as an accepted delta, but the "universal
  sprinter-tested" rationale is STRIPPED so it is not presented as the validated sprinter look.
- **D3 — Duelist `uv2_scale` value → left to user Showroom UAT** (user is the visual gate). The audit
  asserts only a tiling **floor** (> washed `[1,1]`) plus a real repeat-mode guarantee, not an exact
  value.
- **D4 — Armour schema → clean `fitScale` + `propOffset` migration** over a `propScale` alias (POC
  posture §10 permits the bump). Existing props are size-pinned/regression-asserted; only the 3 new
  props get a derived fitScale (§4.5).
- **D5 — Review corrections folded in** (this gate): visceral asserted by approach-identity +
  `organColor` (not size); sprinter restored on the **live `corpse.approach`** (not `deathTreatment`);
  all data-detectable assertions in `verify-scaffold.mjs` with `GODOT_BIN`-unset a hard FAIL for the
  world-space prop check; `audit-adherence-matrix.gd` added to the invert list; existing-prop size
  pinned. See §4.2–§4.6 for the source-verified values.

## 9. Recommended job sequence

1. **WP-E (red)** — author the anti-homogenization audit contract first so acceptance is defined.
2. **Parallel**: (a) **manifest-data pass** WP-A → WP-B → WP-C as one coordinated single-owner edit
   (or sequenced / per-agent worktree — never concurrent writers on `manifest.json`); (b) **WP-D**
   armour code + AABB script + `armourProps[]` fields, independent and concurrent.
3. **WP-E (green/tighten)** — finalize thresholds against the landed data.
4. **VALIDATE** — lint / typecheck / build / test, then
   `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix
   throwaway-prototypes/d-full-match test` and `… run build` (web export). The **arm64** Godot 4.6.2
   binary is the verified renderer; `GODOT_BIN` is unset by default in this shell, so the native
   audit scripts are skipped unless it is exported — set it so the Godot AABB/visibility audits run.
   **For Round-12 the world-space prop-visibility audit treats `GODOT_BIN`-unset as a hard FAIL, not a
   skip** (§4.6 rule 2): a green run with the Godot audits skipped is NOT acceptance evidence — the
   binary MUST be exported and the `.gd` audits MUST actually execute before claiming AC4/AC6.
5. **Closing readout** — diff each recovered look against its R10 reference, confirm persona
   distinctiveness, record the per-prop fit-scale/offset table. **No UAT job**; the user UATs the
   exported Showroom.

## 10. References

- [`mental-model.md`](../../spec/mental-model.md) §10.1, §13, §13.1.
- R10 reference: [`ROUND-10-CLOSING-READOUT.md`](../../../../throwaway-prototypes/d-full-match/ROUND-10-CLOSING-READOUT.md); manifest at commit **e42e23b** (final R10 close) / **2c42fee** (R10 implement).
- R11 regression source: commit **c45b03b**; [`ROUND-11-CLOSING-READOUT.md`](../../../../throwaway-prototypes/d-full-match/ROUND-11-CLOSING-READOUT.md); [`round-11-lock-and-breadth-spec.md`](./round-11-lock-and-breadth-spec.md).
- Surface: `shared-harness/art-kit/manifest.json`, `shaders/uv2_body_texture.gdshader`, `src/EquipmentMeshAttachment.gd`, `src/Showroom.gd`, `scripts/verify-scaffold.mjs`, `scripts/audit-modular-submesh-armor.gd`, `scripts/audit-skin-bone-attachments.gd`, `scripts/audit-character-scales.gd`.
