# Round 10 — Adherence-Consolidation Spec (per-layer lane curation from Round-9 UAT)

Date: 2026-06-01
Phase: `docs/project/phases/render-rnd/`
Previous: [`round-9-adherence-breadth-spec.md`](./round-9-adherence-breadth-spec.md) · [`ROUND-9-CLOSING-READOUT.md`](../../../../throwaway-prototypes/d-full-match/ROUND-9-CLOSING-READOUT.md)
North Star Anchor: **Render R&D Round 10 — consolidate the adherence lanes (per-layer curation from Round-9 Showroom UAT)**
Mental-model contract: [`../../spec/mental-model.md`](../../spec/mental-model.md) §10.1 (recursive consolidate-after-breadth), §13 (consumer-render intent), §13.1 (locked body + settled adherence lanes)

---

## 1. Purpose (why this exists)

Round 9 breadth-sampled four independent adhering layers — **skin, gore, weapons, armour** — each with ≥2 §13.1
approaches, on the one locked mesh2motion body, à la carte in the Showroom. The user UAT'd that breadth and gave
clear **per-layer curation signal**. This is the §10.1 loop working as designed: *sample breadth → evaluate
side-by-side → consolidate → reveal the next finer move*. Round 10 is the consolidation half of that loop.

The per-layer reads from UAT (the empirical data this round executes against):

| Layer | UAT signal | Round-10 move |
|---|---|---|
| **Weapons** | dynamic hand-bone is "good"; static root socket "just has it floating there"; weapon pack (low+high) "look good" | **Lock** dynamic-bone; **remove** the static-socket negative control. Axis closing. |
| **Skin** | UV-painted texture reads best (trader `pattern_texture`, duelist `pbr_texture_atlas`, "joints look good"); "body scale might be a bit off"; opportunist `decal_stickers` "has some floating skin or something weird" | **Consolidate** on UV-painted texture; **remove** the bone-pinned decal-sticker skin; **calibrate** body scale. |
| **Gore** | broad adhering gore (duelist/camper/paranoid) "adheres but doesn't fully wrap to skin"; user wants gore as "smaller individual gores"; reads the broad technique as a fit for **armour** | **Re-approach** gore as many small individual marks; **donate** the broad adhering-region technique to armour. |
| **Armour** | modular prop "just sits on the ground static"; "would also work if it had dynamic bone attach" | **Converge** with two body-tracking candidates: (a) modular prop via DYNAMIC bone-follow, (b) the donated broad adhering-region as wrapping coverage. |

This is a recursive §10.1 consolidation: weapons close, skin settles + calibrates, gore re-approaches, armour
converges with a cross-pollinated technique (the §13.1 idea-bank — *techniques whose flaws are someone else's
features* — confirmed empirically). The body stays **LOCKED** (mesh2motion universal, all 8 personas) — no body
substitution, ever (§13.1). Strictly inside `throwaway-prototypes/d-full-match/**`. **No Convex / production /
apps-replay.** Verification boundary unchanged; **no UAT job** — the user UATs in the Showroom.

## 2. Research grounding (2026-06-01, validated)

Perplexity/Godot-docs research confirms each consolidation move is the technically correct one and pins the
honest limitations that become this round's breadth data:

- **Armour "sits on the ground static" is a real, diagnosed bug, not a tuning miss.** The current modular-armour
  path (`_ensure_modular_armor_skin`) parents the prop under the `Skeleton3D` and assigns a **single-bone `Skin`
  with an identity bind**. A single-bone Skin with an identity bind computes an inconsistent skinning matrix and
  renders the rigid prop **at the bind-pose origin** (≈ character/ground origin), *not* at the live posed bone —
  it does not follow animation. The fix is the **same `BoneAttachment3D` mechanism the dynamic weapon socket
  already uses** (`_ensure_dynamic_weapon_socket`): a `BoneAttachment3D` child of the skeleton updates its
  transform from the current posed bone **every frame**. → Armour candidate (a) reuses the proven weapon path.
- **Small individual gore marks adhere better than few broad marks — empirically.** A `QuadMesh`/`Decal` pinned
  to one `BoneAttachment3D` is transformed rigidly by **one** bone, while the underlying skin vertices deform by
  a **weighted blend of several** bones (linear blend skinning). A *large* mark spanning a joint (e.g. across
  the elbow/spine) diverges strongly from the skin and visibly **slides/protrudes**; a *small* mark that stays
  inside a single bone's dominant-influence region moves almost rigidly with that region and **sticks**. → Gore
  as many small marks is the correct re-approach; the broad few-large-marks technique honestly *can't* wrap a
  deforming body — which is exactly why it suits **armour coverage** (a deliberately flat, no-thickness region),
  the §13.1 cross-pollination.
- **Body-scale "slightly off" at a correct nominal height is a known measurement class.** A rig can hit 1.7 m
  total AABB height yet read mis-proportioned because the AABB is measured in **T-pose** (arms-out, non-body
  spread), includes **non-body meshes**, uses a **root/pivot not at the foot plane**, or is judged against an
  **environment not locked to real-world scale**. Robust method: measure **body-only** meshes in a **neutral
  idle frame**, normalize against a **foot plane**, and calibrate the target against environment props of known
  size. → Scale calibration is blind-executable via the existing `audit-character-scales.gd` (refined to
  idle@0 body-only) plus a documented target chosen against the Round-7 environment scale.

## 3. Current-state map (what the runtime/manifest actually does today)

Traced end-to-end so each WP edits a known surface (file:line approximate to commit `7812244`).

- **Manifest** (`shared-harness/art-kit/manifest.json`, schema 8):
  - `body.modelScaleMultiplier = 0.92918305`, `body.targetWorldHeight = 1.7` (mirrored in `corpseBody`). **The
    scale knobs.**
  - Skin `adherenceApproach`: all 8 are `uv_painted` **except `opportunist` = `bone_attached`** (`decal_stickers`
    — the "floating skin"). 7 distinct shader/texture skins + 1 decal skin.
  - Gore (`corpse`): broad bone-pinned decals on **duelist** (`wound_cluster_decals`, 4 large decals ≈0.42×0.30),
    **camper** (`viscera_projection`, 2 large), **paranoid** (`exposed_bone_decals`, 3 large). These are the
    "adheres-but-doesn't-wrap" specs. (rat/opportunist/vulture = `uv_painted` material; trader = floor
    `gore_pool_decal`; sprinter = `mesh_baked` dismemberment — all out of scope of the re-approach.)
  - Weapons: 6 assets, each `attachModes = [dynamic_hand_bone, static_root_socket]`. `round9Adherence.weaponAttachModes`
    declares both. **static is the negative control to remove.**
  - Armour: per-persona `armorOverlay` props (duelist chest→`spine_03`, paranoid helmet→`head`, vulture
    gauntlet→`hand_l`), `adherenceApproach: modular_submesh`. `round9Adherence.armorApproaches` +
    `armorAsPaint{}` declare `modular_submesh_prop` vs `armor_as_paint`.
- **Runtime** (`src/EquipmentMeshAttachment.gd`, 1986 lines):
  - Weapon attach: `_ensure_weapon_socket` → dynamic `BoneAttachment3D` (`_ensure_dynamic_weapon_socket`) or
    static `Node3D` (`_ensure_static_weapon_socket`); `set_weapon_attach_mode` flips `currentWeaponAttachMode`.
  - Skin: `_apply_persona_skin` match on `skin.approach`; `_apply_skin_decal_stickers` is the bone-pinned path
    (calls `_apply_projected_mark`).
  - Gore: `_apply_persona_corpse_skin` match; broad-decal paths (`_apply_corpse_wound_decals`,
    `_apply_corpse_viscera`, `_apply_corpse_exposed_bone`) all iterate `params.decals` → `_apply_corpse_mark_specs`
    → `_apply_projected_mark` (one mark per decal spec). **More/smaller specs = pure data change; the loop already
    handles N marks.**
  - Armour: `_swap_armour` → `_apply_modular_submesh_armor` → `_ensure_modular_armor_skin` (the **single-bone
    Skin** bug); `armor_as_paint` mode shifts body material via `_apply_armour_tier_to_standard_material`.
- **Showroom** (`src/Showroom.gd`): four layer toggles (skin/gore/weapons/armour, all default ON); a **weapon
  attach-mode switch**; an **armour mode switch** (prop↔paint); animation bar; tier rows. Gore already decoupled
  from death.
- **Verification**: `scripts/verify-scaffold.mjs` (1199 lines, JS structural + manifest asserts) + Godot audits
  (`audit-adherence-matrix.gd`, `audit-universal-body.gd`, `audit-character-scales.gd`, `audit-mesh2motion-clips.gd`,
  `verify-character-rigs.gd`, `audit-skin-bone-attachments.gd`, `audit-modular-submesh-armor.gd`, `audit-replay-load.gd`),
  wired in `package.json`.

## 4. Architecture design — the consolidation per layer

All four layers stay on the **one mesh2motion body**, à la carte in the Showroom. The change set is *mostly
deletion + data re-authoring + one proven-mechanism reuse*, not new subsystems.

### 4.1 Weapons — lock dynamic, delete the negative control (axis closing)

**Mechanism:** the winning path (`_ensure_dynamic_weapon_socket`, `BoneAttachment3D` on `hand_r`) becomes the
*sole* path.

- **Manifest:** strip the `static_root_socket` block from every weapon's `attachModes` (leave only
  `dynamic_hand_bone`); remove the static entry from `round9Adherence.weaponAttachModes`. Keep all 6 weapon
  assets unchanged (the confirmed-good pack).
- **Runtime:** retire the static *mode*. `set_weapon_attach_mode` and `WEAPON_ATTACH_STATIC` as a user-selectable
  mode are removed; `_ensure_weapon_socket` always builds the dynamic bone socket. **Keep `_ensure_static_weapon_socket`
  as the internal last-resort fallback** when no hand bone resolves (it is robustness, not a mode) — but it is no
  longer reachable via UI.
- **Showroom:** delete the weapon attach-mode switch and `_set_weapon_attach_static`.

§13.1 family: `bone_attached` (rigid; accepts wrist-clip at extreme bend). Lane: **closed.**

### 4.2 Skin — consolidate on UV-painted texture + calibrate scale

**Mechanism:** UV-painted material/texture on the skinned mesh (`uv_painted`, perfect joint deformation).

- **Remove the bone-pinned decal skin.** Convert `opportunist.skin` from `decal_stickers` (`bone_attached`) to a
  **UV-painted texture** approach in the winning family (`pattern_texture` or `pbr_texture_atlas`) with a CC0
  texture (CC0-first, §10.1; reuse an existing art-kit texture if a fitting one exists, else source one). Drop
  the `_apply_skin_decal_stickers` match case from `_apply_persona_skin` (the helper may be deleted).
- **The other 7 skins are unchanged** — they are already `uv_painted` (shaders/textures). The purely stylistic
  shader looks (`toon_cel`/`emissive_trim`/`multi_material_split`/`rim_fresnel`/`palette_flat`) are a **separate
  later styling axis** (NS AC2) — *do not* rework or remove them here; they already adhere perfectly.
- **Calibrate body scale.** Run `audit-character-scales.gd` (non-assert) to read `source_h / suggested /
  committed / world_h` per persona; refine the measurement to a **neutral idle frame, body-only meshes**, and
  pick a corrected `targetWorldHeight` (and recompute `modelScaleMultiplier`) so the body reads correctly
  **against the Round-7 environment scale** (`WORLD_SCALE 0.38`, wall height 1.15, cover 0.42 world units) and
  the weapon scale. Update **all pinned copies** consistently: `manifest.body.{modelScaleMultiplier,
  targetWorldHeight}`, `manifest.corpseBody.{…}`, `package.json --target-world-height`, and the scaffold
  constants `round8TargetWorldHeight` / `round8BodyModelScaleMultiplier` (rename to `round10*` or keep names —
  engineer's call, but keep them in sync). Joint deformation must stay clean (it is `uv_painted`, so scaling the
  whole body cannot break skinning).

§13.1 family: `uv_painted` (perfect adherence; reads as paint, no thickness — accepted). Lane: **settled.**

> **Blind-calibration note.** The engineer cannot eyeball "looks right." The defensible, blind-executable target
> is *internal consistency*: body height proportional to the known environment/weapon scale, measured body-only
> in idle@0. The engineer commits a principled value and documents the before→after in the closing readout for
> the user's Showroom UAT. If the user still reads it off, it is one more cheap re-calibration — see D-SCALE.

### 4.3 Gore — re-approach as small individual marks; donate the broad region to armour

**Mechanism:** many small `QuadMesh`/`Decal` marks, each pinned to its nearest single dominant bone (minimal
slide), via the existing `_apply_corpse_mark_specs` loop (no code change — pure manifest data).

- **Re-author the three broad-gore specs** (`duelist.corpse`, `camper.corpse`, `paranoid.corpse`) from a few
  large decals into **many small localized marks** (target ≈6–12 marks, each `size` ≈0.05–0.12, distributed
  across `spine_*`/limb bones so each stays within one bone's influence). Keep `adherenceApproach: bone_attached`
  and the existing approach keys (`wound_cluster_decals` etc.) — the *data* changes, the family does not.
- The other gore treatments are unchanged (rat/opportunist/vulture `uv_painted`; trader floor pool; sprinter
  `mesh_baked`). Gore layer still spans all three §13.1 families.

§13.1 family: `bone_attached` (small marks; far less slide than broad). Lane: **re-approached.**

### 4.4 Armour — two body-tracking candidates (dynamic-bone prop + donated adhering-region)

**Mechanism:** two candidates the Showroom mode switch flips between, both body-tracking, with contrasting honest
limitations — *rigid-prop protrusion* vs *region no-thickness*.

**Candidate (a) — `modular_submesh_prop` via DYNAMIC bone-follow (fix the "static on the ground" bug).**
Replace the single-bone-`Skin` bind in `_apply_modular_submesh_armor` with a **`BoneAttachment3D` on the live
bind bone** (`spine_03`/`head`/`hand_l`) — i.e. parent the prop meshes under a `BoneAttachment3D` child of the
skeleton, exactly as `_ensure_dynamic_weapon_socket` does for weapons. `_ensure_modular_armor_skin` (the
identity-Skin injector) is removed/replaced. The prop now tracks the posed bone every frame.
§13.1 family: `bone_attached` (rigid; protrudes/clips — accepted).

**Candidate (b) — `adhering_region` (the donated broad gore technique as armour coverage).**
Add an `armorRegion` block (carrying the **broad few-large-marks** projection specs donated from the old R9
gore on duelist/camper/paranoid) and a new runtime path `_apply_adhering_region_armour` that applies those broad
bone-pinned marks as a flat torso/limb coverage (reusing `_apply_projected_mark`, tracked in a dedicated node
bucket so it clears cleanly). §13.1 family: `bone_attached` flat region (no thickness — accepted).

**Showroom:** the armour mode switch now flips **prop ↔ region** (relabel `_set_armour_render_paint` →
`_set_armour_render_region`, constants `ARMOUR_RENDER_PAINT` → `ARMOUR_RENDER_REGION`). Both candidates are
body-tracking, so the user compares two *tracking* armours rather than tracking-vs-painted.

> **`armor_as_paint` disposition (D-ARM).** The R9 `armor_as_paint` mode (whole-body uv_painted tier shift) is
> **retired from the armour layer** — its "perfect adherence but reads as a coating" role is a *styling/material*
> concern (same family as the deferred skin-shader styling axis), not the **body-tracking coverage** question the
> user is now resolving; §13.1's updated armour lane is "broad adhering-region for coverage." The underlying
> `_apply_armour_tier_to_standard_material` helper **stays** (skin paths use it for tier modulation); only the
> user-facing *mode* is replaced by `adhering_region`. If the user would rather keep paint as a third mode, that
> is a one-switch addition — see D-ARM.

### 4.5 Data-flow summary

```
manifest.json (schema 8 → bump? see D-SCHEMA; NO bodyOverride, body LOCKED)
  body{modelScaleMultiplier, targetWorldHeight}  ── CALIBRATED ──┐
  skin{approach: uv_painted only, opportunist→texture}           │
  corpse{duelist/camper/paranoid → many small marks}             │  _load_manifest
  weapon.attachModes[dynamic_hand_bone] (static removed)         │
  armorOverlay{bindBone}  (prop, now BoneAttachment3D)           │
  armorRegion{broad donated specs}  (NEW, region coverage)       │
        │                                                        ▼
        │                       EquipmentMeshAttachment
        │   _apply_persona_skin      (Skin)   ── uv_painted ONLY
        │   _apply_persona_corpse_…  (Gore)   ── small marks | uv_painted | mesh_baked
        │   _ensure_weapon_socket    (Weapon) ── dynamic_hand_bone ONLY
        │   _swap_armour: prop|region(Armour) ── BoneAttachment3D prop | adhering_region
        ▼
   Showroom: 8 cells × {Skin,Gore,Weapons,Armour} toggles × {armour mode: prop|region} × {anim clips} × {tier}
        ▼
   verify-scaffold.mjs + Godot audits → assert consolidated lanes (single weapon mode, no decal skin,
                                        small-mark gore, prop dynamic-bone + region, calibrated scale)
        ▼
   web export (.pck) → user UAT in Showroom
```

## 5. Dependency map / parallelization

```
        ┌──────────────────────────────────────────────┐
        │ Independent layer WPs — all edit manifest.json │
        │ + EquipmentMeshAttachment.gd (shared files)    │
        └──────────────────────────────────────────────┘
   WP-W (weapons)   WP-S (skin+scale)   WP-G (gore)   WP-A (armour)
   delete-only      data + scale        data re-auth   reuse weapon path + new region
        └──────────────┴───────────────────┴──────────────┘
                              ▼
                   ┌────────────────────────┐
                   │ WP-SR (Showroom UX)    │ ← needs WP-W (drop weapon switch)
                   │                        │   + WP-A (armour mode relabel)
                   └───────────┬────────────┘
                               ▼
                   ┌────────────────────────┐
                   │ WP-V (audits + readout)│ ← asserts the final consolidated shape
                   └────────────────────────┘
```

**Parallelization reality:** the four layer WPs are *conceptually* independent but **all contend on the two
shared files** (`manifest.json`, `EquipmentMeshAttachment.gd`). Recommend a **single engineer executes them in
sequence** (WP-W and WP-G are low-effort delete/data; WP-S carries the scale calibration; WP-A carries the only
real new code — the region path), **or** isolated git worktrees with a disciplined merge. WP-SR depends on WP-W
+ WP-A landing their mode changes; WP-V lands last and asserts the final shape. No revert prerequisite this round
(unlike R9's WP-0) — the R9 base is already correct (locked body, à-la-carte toggles).

## 6. Work-package breakdown (UAT-able vertical slices)

Verification boundary (all WPs): `npm run lint` / `typecheck` / `test` / `build` green; `GODOT_BIN=… npm
--prefix throwaway-prototypes/d-full-match test` (scaffold + Godot audits) green; `… run build` web export
builds. **No UAT job** — the user UATs in the Showroom.

### WP-W — Weapons consolidate (lock dynamic, delete static control)

**UAT slice:** Weapons ON, attack clip — every cell's weapon tracks the hand through the swing; there is **no
weapon attach-mode switch** in the Showroom and no "floating" static option.

**Subtasks:** strip `static_root_socket` from each weapon's `attachModes` and from `round9Adherence.weaponAttachModes`
(§4.1); retire `WEAPON_ATTACH_STATIC` as a mode + `set_weapon_attach_mode` (keep `_ensure_static_weapon_socket`
as internal fallback only); delete the Showroom weapon switch + `_set_weapon_attach_static`.

**Success criteria:** `dynamic_hand_bone` is the sole declared/selectable weapon attach mode; the 6-weapon pack
is retained unchanged; no `static_root_socket` token remains in manifest weapon assets or the Showroom UI; weapons
track the hand on idle/walk/attack/death.

### WP-S — Skin consolidate on UV-painted texture + scale calibration

**UAT slice:** Skin ON — every cell shows a UV-painted skin that deforms cleanly at the joints (no floating/
sliding decal skin on opportunist); the body reads correctly proportioned against the environment.

**Subtasks:** convert `opportunist.skin` → UV-painted texture approach (CC0-first) and drop the `decal_stickers`
match case (§4.2); calibrate `targetWorldHeight` + `modelScaleMultiplier` via the (idle@0, body-only) scale
audit, updating manifest body/corpseBody + `package.json` + scaffold scale constants in sync; confirm the other
7 uv_painted skins are untouched.

**Success criteria:** no skin uses `bone_attached`/`decal_stickers` (skin layer is uv_painted-only); body scale
recalibrated and documented (before→after) with the scale audit green at the new target; joint deformation clean;
the stylistic-shader skins left intact (not the round's concern).

### WP-G — Gore re-approach as small individual marks

**UAT slice:** Gore ON, walk clip — duelist/camper/paranoid show **multiple small** wound marks that track the
body with minimal slide, **not** one broad wrapping patch.

**Subtasks:** re-author `duelist.corpse` / `camper.corpse` / `paranoid.corpse` decal specs into many small marks
(§4.3); preserve the broad specs verbatim for donation to WP-A's `armorRegion`; leave the other 5 gore
treatments unchanged.

**Success criteria:** the three re-approached personas render ≥ N small marks (threshold asserted in WP-V) of
small size; gore layer still spans `bone_attached` + `uv_painted` + `mesh_baked`; the donated broad specs are
available to WP-A.

### WP-A — Armour converge (dynamic-bone prop + donated adhering-region)

**UAT slice:** Armour ON — flip the mode switch: "prop" shows the chest/helmet/gauntlet props **tracking the
body** (no longer ground-stuck) on duelist/paranoid/vulture; "region" shows broad torso/limb coverage on
duelist/camper/paranoid; the difference (rigid protrusion vs flat no-thickness) is visible.

**Subtasks:** replace `_ensure_modular_armor_skin` single-bone-Skin with `BoneAttachment3D` bone-follow in
`_apply_modular_submesh_armor` (reuse the dynamic-weapon-socket mechanism, §4.4a); add `armorRegion` manifest
blocks (donated broad specs) + `_apply_adhering_region_armour` runtime path with its own clear-able node bucket
(§4.4b); relabel the armour mode prop↔region (retire `armor_as_paint` mode per D-ARM, keep the tier-material
helper); update `round9Adherence.armorApproaches` (→ `modular_submesh_prop` + `adhering_region`).

**Success criteria:** prop candidate tracks the bind bone via `BoneAttachment3D` (no ground-stuck single-bone
Skin); region candidate renders broad bone-pinned coverage; both Showroom-toggleable and visibly contrasting;
honest limitations (rigid protrusion / region no-thickness) documented; `armor_as_paint` retired from the layer.

### WP-SR — Showroom à-la-carte UX (consolidated controls)

**UAT slice:** the four layer toggles + the single armour mode switch (prop↔region) compose on every cell while
any clip plays; the weapon switch is gone; nothing halts the animation on toggle.

**Subtasks:** remove the weapon attach-mode switch row; relabel/rewire the armour mode switch to prop↔region;
keep the four layer toggles, tier rows, animation bar, and the gore-decoupled-from-death behaviour; ensure all
re-apply paths stay animation-safe (no `AnimationPlayer` stop/re-instantiate on toggle).

**Success criteria:** consolidated controls present and working through idle + a motion clip + death; per-layer
signal isolatable (e.g. Gore-only + walk); per-cell toggling remains an optional deferred nice-to-have (R9 Q3),
not built.

### WP-V — Audits assert the consolidated lanes + closing readout

**UAT slice:** the audit suite (machine-introspection, §10) asserts the consolidated shape and prints a per-layer
lane summary the readout can quote.

**Subtasks:** update `audit-adherence-matrix.gd` (weapons: dynamic-only + static absent; skin: uv_painted-only,
no decal_stickers; gore: small-mark count threshold on the three personas; armour: prop via BoneAttachment3D +
`adhering_region`, paint retired); update `verify-scaffold.mjs` (relax `skinApproaches.size===8`; drop
`_apply_skin_decal_stickers` required-helper + `static_root_socket`/`armor_as_paint` tokens; add `adhering_region`/
`armorRegion`/dynamic-armour-bone tokens; update scale constants; point readout-token check at the Round-10
readout); repurpose `audit-skin-bone-attachments.gd` (skin marks gone → validate gore small-mark + armour-region
bone attachments) and `audit-modular-submesh-armor.gd` (assert prop uses `BoneAttachment3D`, validate region);
keep `audit-universal-body` / scale / clips / rigs green; write `ROUND-10-CLOSING-READOUT.md` (consolidated lane
per layer + honest-limitations table + open items); update `round9Adherence` references / `package.json` if
audits are renamed.

**Success criteria:** audits assert the four consolidated lanes and a single locked body; suite prints a readable
lane matrix; all gates green incl. web export; readout documents the settled lane per layer and any open items.

## 7. Assignment-level success criteria (maps to NS acceptance criteria)

1. **AC1 (weapons):** `dynamic_hand_bone` is the sole weapon attach technique; `static_root_socket` removed
   (manifest + runtime mode + Showroom switch); weapon pack retained; tracks hand on idle/walk/attack/death.
   ✔ WP-W, WP-V.
2. **AC2 (skin):** skin is uv_painted texture on the skinned body (no decal-sticker/floating skin); body scale
   calibrated; joint deformation clean; stylistic shaders left as a separate later axis. ✔ WP-S, WP-V.
3. **AC3 (gore):** gore renders as many small localized individual marks that track the body (not one broad
   region); the broad technique reassigned to armour. ✔ WP-G, WP-A, WP-V.
4. **AC4 (armour):** two body-tracking candidates compared in the Showroom — (a) modular prop via DYNAMIC
   bone-follow (no longer ground-stuck), (b) broad adhering-region donated from gore; honest per-approach
   limitations documented. ✔ WP-A, WP-SR, WP-V.
5. **AC5 (Showroom):** independent à-la-carte per-layer toggles work through idle + a motion clip + death;
   per-cell toggling optional/deferred. ✔ WP-SR.
6. **AC6 (verification, no UAT job):** lint/typecheck/build/test + Godot audits + web export green; closing
   readout documents the consolidated lane per layer + open items. ✔ WP-V.
7. **AC7 (locked body / scope):** mesh2motion universal for all 8 personas; no body substitution reintroduced;
   CC0-first sourcing; no Convex/production/apps-replay touched. ✔ scope guard on every WP.

## 8. Honest-limitation matrix (to be confirmed by the closing readout — breadth data, not defects)

| Layer | Consolidated lane | Adherence | Honest limitation |
|---|---|---|---|
| Weapons | `dynamic_hand_bone` (BoneAttachment3D) | tracks hand through swing/death | rigid; minor wrist clip at extreme bend |
| Skin | `uv_painted` texture | perfect joint deformation | reads as paint; no thickness (stylistic shaders deferred) |
| Gore | small individual marks (`bone_attached`) | each small mark sticks to its dominant bone | many nodes; per-mark single-bone pin still imperfect at hard joints |
| Armour (a) | `modular_submesh_prop` (BoneAttachment3D) | tracks bind bone every frame | rigid prop protrudes/clips; not multi-bone skinned |
| Armour (b) | `adhering_region` (donated broad marks) | tracks the body as flat coverage | no thickness; reads as a flat region, "metal" bends like skin |

## 9. Ambiguities / decisions needed

- **D-ARM (armor_as_paint disposition) — RECOMMENDED: retire from the armour layer.** The armour mode switch
  becomes prop↔region (two body-tracking candidates, per NS AC4). Paint's whole-body material shift is a styling
  concern, not the coverage question; the tier-material helper stays for skin tier modulation. *Open to the user:*
  keep paint as a third armour mode (would require swapping the binary switch for a 3-way `OptionButton`). **Needs
  PM/user confirmation before WP-A finalizes.**
- **D-SCALE (calibration target).** The engineer is blind; the calibrated `targetWorldHeight` is chosen for
  internal consistency against the locked environment/weapon scale (idle@0, body-only measurement) and documented
  before→after for the user's Showroom UAT. *The exact corrected value is an empirical pick;* if the user still
  reads it off post-UAT, it is a one-line re-calibration. **Confirm whether the user wants a specific reference
  (e.g. body height vs evac-building/cover prop) to anchor against.**
- **D-SCHEMA (schema bump).** Removing static weapon modes + `armor_as_paint` and adding `armorRegion` changes the
  manifest shape. POC posture (§10) is forward-only with breakage acceptable. **Recommend bump `schemaVersion`
  8 → 9** and update all pinned `=== 8` asserts. (Mechanical; flagged so the bump is a named decision, not silent.)
- **Q-region-breadth (which personas carry `armorRegion`).** Donating from the three broad-gore personas
  (duelist/camper/paranoid) gives clean prop-vs-region comparison on duelist/paranoid (which also carry props).
  Sufficient for the side-by-side; widening to more personas is optional. **Default: the three donors.**
- **Q3 (per-cell toggling).** Still deferred (R9 Q3) — global-row toggles match §10.1's side-by-side pattern.
  Not built unless the user asks.

## 10. Recommended job sequence

1. **No revert/review prerequisite** — the R9 base (locked body, à-la-carte toggles, gore-decoupled-from-death)
   is already correct. Confirm **D-ARM** and **D-SCHEMA** with PM/user up front (both shape WP-A and WP-V).
2. **Implement the layer WPs in one engineer's sequence** (they serialize on the two shared files):
   **WP-W** (delete-only, fastest) → **WP-G** (data re-author, hold the broad specs for donation) → **WP-A**
   (the only real new code: dynamic-bone prop + region) → **WP-S** (skin convert + scale calibration).
3. **WP-SR** once WP-W/WP-A mode changes have landed.
4. **WP-V** last — asserts the final consolidated shape, then the user UATs the web export in the Showroom.
5. **A light plan-review pass on WP-A** (the armour dynamic-bone refactor + new region path) is the one place an
   up-front check adds value; the rest is mechanically grounded in existing code + the validated research.

---

### Spec artifact path

`docs/project/phases/render-rnd/round-10-adherence-consolidation-spec.md` (this file).
