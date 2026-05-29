# Round 8.1 — Targeted Character-Body Touch-Up Spec (v2)

Date: 2026-05-29
Phase: `docs/project/phases/render-rnd/`
Previous: [`round-8-closing-readout.md`](./round-8-closing-readout.md)
North Star Anchor: Render R&D Round 8.1 — download the bespoke CHARACTER PACKS Round 8's research identified but didn't pull, and integrate them as genuinely different character BODIES (not skins on the same body).

## 0. Revision Summary (v1 → v2)

v2 incorporates three plan reviews (A, B, C) that converged on the same blocking issues. Directional design (D1 body-swap, D2 schema shape, D7 no-retargeting, D9 implicit-corpse-fallback) is ratified and unchanged. Specific corrections:

| # | Section | What changed in v2 | Source review |
|---|---|---|---|
| R1 | §3.4, §4.4, §4.3, §6, §9, §11, §14 D6 | **D6 reversed → Path α.** armorOverlay preserved on swapped bodies. `bodyOverride.armourAttachBone` is now REQUIRED when persona has armorOverlay AND bodyOverride. Per-body bone discovery moves from "deferred to Round 9" to in-round engineer work. Persona table reflects: duelist (Quaternius), paranoid (BlackScorp or alternate), vulture (Quaternius) keep their armorOverlay; armor stays where Round 8 applied it. | A-Issue1, B-Med-Round8-Regression, C-Issue1 |
| R2 | §4.3, §10 D3 | **D3 audit math corrected.** Replaced impossible "distinct `bodyOverride.sourcePack` ≥ 4" with: assertion by effective body source category — exactly 1 mesh2motion, ≥4 Quaternius UBC, ≥1 OGA (or rigged-warrior alternate), ≥2 Kenney. Plus distinct effective body GLB file count ≥ 4. | B-High-Verification |
| R3 | §5.2, §11, §14 D10 | **BlackScorp rigging risk surfaced.** Review B verified the OGA page declares the model not rigged. WP-B's first subtask is now "verify rigging by inspecting archive contents BEFORE staging." If unrigged: drop BlackScorp, escalate to rigged CC0 warrior alternate (Kaykit Adventurers candidate, engineer researches at integration time) OR redistribute the slot to Quaternius / Kenney. Explicit failure-matrix entry added. | A-Low-2, B-High-Asset-Fit |
| R4 | §5.1 | **Quaternius mechanism order revised.** quaternius.com demoted to metadata/license verification only (no direct ZIP href confirmed in live HTML per Reviews B & C). Itch session-cookie flow (Mechanism 2) becomes PRIMARY but is reformulated for headless agent: reads `ITCHIO_SESSION` env var; if absent, automatically skips to Mechanism 3 (poly.pizza individual models). No manual browser login step. | B-Med-Download, C-Med-Downloads |
| R5 | §5.3 | **Kenney candidate list corrected.** Kenney Toon Characters is 2D per Review B verification. Recommended 3D rigged candidates restricted to: Mini Characters, Mini Dungeon, Mini Arena, Animated Characters Protagonists. Toon Characters dropped from candidate list. | B-Med-Kenney |
| R6 | §10, §13 | **Research log path corrected.** Round 8.1 findings APPEND to `docs/project/phases/render-rnd/round-8-research-log.md` (the North Star asks for this update). A separate `round-8-1-research-log.md` may exist as a working file but is NOT the required artifact. | B-Med-Docs |
| R7 | §9 | **Schema tightened.** `bodyOverride.armourAttachBone` REQUIRED when persona has armorOverlay AND bodyOverride present (consequence of R1). For implicit corpse fallback (D9), `bodyOverride.animation.death` OR `bodyOverride.deathPoseClip` REQUIRED — `instantiate_persona_corpse` needs a death clip to pose the corpse, idle alone isn't enough. | B-Low-Corpse, A-Med-3 |
| R8 | §4.5 | **Showroom label resolution made explicit.** `Showroom._source_key_for_persona` reads `asset.bodyOverride.sourceKey` (when present) BEFORE falling back to the merged `asset.sourceKey` / root `body.sourceKey`. Avoids collision with future per-persona top-level `sourceKey` for skin or texture provenance. | C-Med-Schema-UI |
| R9 | §10, §13 | **Research log must record which download mechanism actually fired per pack** (1/2/3/4), not just the final URL. Round 9 must not inherit unverified Mechanism-1 assumptions. | A-Med-Download-provenance |

Net verdict per the three reviewers post-v2: implementable. Engineer dispatches WP-A/B/C/D/E per §13 once PM ratifies this v2.

---

## 1. Purpose

Round 8 sourced four ambientCG PBR material textures (Fabric029, Leather001/034B, MetalPlates017A) and three Quaternius rigid armor props, but applied them all to the **same mesh2motion body**. The Showroom therefore "looks pretty similar to before" — the user's exact UAT verbatim.

The user's actual ask: **a completely new set of CHARACTER skins, gore, weapons, armor, etc.** — bespoke humanoid outfits / character bodies from real CC0 packs, not material textures painted over one body.

Round 8.1 fixes that gap by:

1. Downloading the bespoke character packs Round 8's research log identified as targets but flagged "not downloaded by this WP" — `Quaternius-ModularCharacterOutfitsFantasy-CC0`, `OGA-BlackScorp-LowPolyWarrior-CC0` (or a rigged-warrior alternate per R3), and at least one Kenney character pack.
2. Integrating them as **per-persona body sources**, so the Showroom shows genuinely different character body shapes across the eight personas.
3. Preserving Round 8's already-applied CC0 assets (Quaternius weapons + rigid armor props + ambientCG PBR sets + OGA gore decals) wherever they continue to attach to whichever body a persona now uses. **Per R1: modular armor preservation is now an in-round REQUIREMENT, not a deferral — armourAttachBone re-tuned per-body.**

The substrate question this round answers, per mental-model §10: the *next finer breadth axis* after Round 7's body consolidation is the **character body itself**. The user's UAT has just re-opened that axis — Round 8 prematurely consolidated on mesh2motion and applied surface treatments only, when the visible signal the user wants is body shape, silhouette, and outfit variety.

## 2. Overview

Three concurrent download + integration work packages (WP-A, WP-B, WP-C) feed into one shared manifest/scaffold work package (WP-D) and one verification work package (WP-E):

- **WP-A** — Quaternius Modular Character Outfits Fantasy (CC0, ~280MB ZIP). Becomes the body source for 4 personas.
- **WP-B** — OGA BlackScorp Low Poly Warrior (CC0) **or rigged-warrior alternate if BlackScorp ships unrigged** (R3). Becomes the body source for 1 persona.
- **WP-C** — Kenney character pack (CC0). Becomes the body source for 2 personas.
- **WP-D** — Manifest schema bump (v6 → v7) to support per-persona body override; Showroom label updates so the user can identify each cell's body source.
- **WP-E** — Scaffold + audit additions to enforce body-source provenance per persona, plus the existing Round-8 audits regression-checked against the new bodies. **Per R1, armorOverlay regression checks are now in-scope this round, not Round 9.**

One persona stays on mesh2motion as the **control cell** — the regression anchor the user can A/B against the new bodies.

Verification stays at the same boundary as Round 8: lint/typecheck/build/test, `npm --prefix throwaway-prototypes/d-full-match test` (Godot audits), `... run build` (web export). **No UAT job.** The user UATs in the Showroom themselves.

## 3. Body-Swap Strategic Decision (D1 — APPROVED)

> **Decision (D1) — DEFAULT IS BODY SWAP. Different bodies for 7 of 8 personas; mesh2motion retained as 1 control cell.**

All three reviewers ratified this direction (Reviews A/B/C all APPROVED D1). §3 below is unchanged from v1 except for clarifications flagged inline.

### 3.1 The two paths

- **Path (a) — body swap.** Each persona declares a per-persona body GLB. Manifest schema gains a `bodyOverride` block at the asset level that supersedes the root `body` fields. The `EquipmentMeshAttachment._load_manifest` `shared_body.duplicate().merge(persona_asset)` pattern already supports this with a one-line extension (merge `persona_asset.bodyOverride` over `shared_body`).
- **Path (b) — outfits-as-modular-armor.** Keep mesh2motion body, extend Round 8's `modular_submesh` armor path to attach Quaternius outfit pieces. The user has already UATed this approach (it is what Round 8 effectively did with rigid armor props) and rejected the silhouette outcome.

### 3.2 Why path (a) wins

The user's UAT verbatim — *"a completely new set of character skins, gore, weapons, armor, etc."* — names the body itself as the unsatisfied axis. Mental-model §10 calls this out: *"once one axis consolidates (e.g. body model), the next finer axis becomes breadth-able in turn"* — Round 8 attempted skin technique while consolidated on body, the user looked at the result, and re-opened the body axis. Round 7's body consolidation was a §10 step, not a forever commitment; the §10 loop is *meant* to re-open axes when the user's curator-diagnostic (Showroom) says so.

Path (b) repeats Round 8's mistake at higher fidelity. The user has just told us that **silhouette and body shape**, not surface treatments, are what they want to see vary. A wrapping armor mesh on the same body is still the same silhouette.

### 3.3 What the §10 "one variable at a time" discipline requires

§10 says move **one axis** per round. The risk in path (a) is that body shape, outfit, *and* technique mix would all vary at once. The plan addresses this by keeping the technique mappings (skin approach, corpse approach, adherence) on each persona — those are the Round 8 decisions, **carried forward unchanged where they still attach**. The only axis that moves this round is **body source**. (When the body's UV layout differs from mesh2motion, Round 8's UV-painted technique on that persona may degrade visibly; that's expected breadth-sample data, not a regression. See §11 failure modes.)

### 3.4 Animation compatibility — keep each body native, don't retarget

The biggest cost of body swap is animation. mesh2motion clips (`Idle`, `Walk`, `Sword_Attack`, `Punch_Jab`, `Hit_Chest`, `Death01`, `PickUp_Table`) are baked into the mesh2motion skeleton with bones `spine_01/02/03`, `head`, `hand_r/l`, etc. Quaternius UBC and Kenney rigs use different bone conventions (likely `Hips/Spine/Spine1/Head/RightHand/LeftHand` style — see research).

**Decision (D7 — APPROVED): each body brings its own animation clip set, listed in its own `bodyOverride.animation` block.** No cross-body retargeting in Round 8.1. Concretely:

- Quaternius bodies — use the **Universal Animation Library** clips that ship with the pack (Quaternius's stated "compatible with Universal Base Characters" claim). Failing that, ship the Quaternius bodies with a minimum 3-clip set (`idle`, `walk`, `death`) and let `_fallback_chain_for_kind` already in `EquipmentMeshAttachment` collapse missing clips. Vision-faithful animations are not the load-bearing signal this round; **body silhouette + outfit are**.
- BlackScorp warrior (or alternate) — see §5.2; rigging status MUST be verified BEFORE manifest integration (R3).
- Kenney pack — Kenney character packs ship with standard humanoid clips (`Idle`/`Walk`/`Run`/`Attack`/`Die`); these are the canonical anim-clip-rich set.
- mesh2motion control — unchanged.

Godot 4's `SkeletonProfileHumanoid` + `BoneMap` retargeting (research-confirmed feasible, headless-supported) is **explicitly deferred** as Round 9+ work. It is the right substrate for unified animation across bodies, but introducing it in the same round as body swap violates §10's one-variable rule.

**Fallback chain in `EquipmentMeshAttachment.resolve_animation_clip` already handles missing clips** for non-corpse states — the engineer does **not** need to author missing clips per body for every state. A body without a `loot` clip falls back to `generic` then `idle`; the Showroom button just shows the persona idling instead of looting. That is acceptable curation breadth, not a defect.

**EXCEPTION (R7): the implicit-corpse-fallback case (D9) is NOT covered by `idle`-only.** `instantiate_persona_corpse` poses the body on its death pose clip; if no death clip exists on the override body, the corpse cell shows the persona standing upright, which the user will read as a defect. Therefore: when `bodyOverride` is present AND `corpseOverride` is implicit (absent / null), `bodyOverride.animation.death` OR `bodyOverride.deathPoseClip` MUST be declared. See §9.

## 4. Architecture Design

### 4.1 Manifest schema change (D2 — APPROVED)

The current scaffold check at `verify-scaffold.mjs:654` hardcodes:

```js
assert(manifest.body?.file === "characters/camper-mesh2motion-human-base.glb", ...);
```

This *must* be relaxed for per-persona body source variety. The chosen schema design:

```jsonc
{
  "schemaVersion": 7,                        // bump from 6 → 7
  "body": {                                  // root body stays — used as DEFAULT for personas with no override (currently only rat)
    "file": "characters/camper-mesh2motion-human-base.glb",
    "sourceKey": "mesh2motion",
    "modelScaleMultiplier": 0.92918305,
    "targetWorldHeight": 1.7,
    "animation": { "idle": "Idle", "walk": "Walk", ... },
    ...
  },
  "corpseBody": { ... },                     // same as today; can be overridden the same way
  "assets": [
    {
      "id": "character.duelist",
      "category": "character",
      "personaSlot": "duelist",
      "bodyOverride": {                       // NEW field; null or absent means use root body
        "file": "characters/quaternius-ubc-fighter.glb",
        "sourceKey": "quaternius-ubc",
        "sourcePack": "Quaternius-ModularCharacterOutfitsFantasy-CC0",
        "modelScaleMultiplier": 1.00,
        "targetWorldHeight": 1.7,
        "attachBone": "RightHand",
        "armourAttachBone": "Spine",         // REQUIRED here because duelist has armorOverlay (R1/R7)
        "animation": {
          "idle": "Idle",
          "walk": "Walk",
          "death": "Death"                   // REQUIRED because duelist's corpse falls back implicitly (R7)
        }
      },
      "skin": { ... },
      "corpse": { ... },
      "armorOverlay": { ... }                // PRESERVED (R1) — bindBone uses bodyOverride.armourAttachBone
    }
  ]
}
```

`EquipmentMeshAttachment._load_manifest:345` already does:

```gdscript
var character_asset := shared_body.duplicate(true) if not shared_body.is_empty() else (asset as Dictionary).duplicate(true)
character_asset.merge((asset as Dictionary), true)
```

The schema change adds one shim: **before** the merge with the asset, if `asset.bodyOverride` is non-empty, deep-merge `bodyOverride` over `shared_body`. The `merge(.., true)` overrides root keys with asset-level ones, so the existing call also picks up `bodyOverride` keys at the top of the per-persona dictionary. The engineer's implementation choice:

- Option (i): inline `character_asset.merge(asset.bodyOverride, true)` before the `character_asset.merge(asset, true)`.
- Option (ii): treat `bodyOverride` as a sibling top-level block returned from a helper `_resolve_body_for_persona(asset)` that returns merged-body + `attachBone` + `armourAttachBone` + `animation` map.

Either is fine; option (ii) reads more cleanly and isolates the body-swap surface. **Engineer chooses at implement-time.**

### 4.2 Corpse body — also overridable per persona

Currently `corpseBody` is a singleton. The same schema pattern applies: `corpseOverride` at asset level supersedes root `corpseBody`. **Default (D9 — APPROVED with R7 tightening)**: if a persona has `bodyOverride` but no `corpseOverride`, **use the persona's own body GLB paused on its death pose clip** (same pattern as today, just keyed off the persona body instead of the shared mesh2motion body). This avoids authoring a separate corpse GLB per body source — BUT the override body MUST declare a death clip per R7 / §9.

Concretely the corpse path in `instantiate_persona_corpse` already does:

```gdscript
var body_asset := corpse_body_asset.duplicate(true)
if body_asset.is_empty():
    body_asset = persona_asset.duplicate(true)
```

The fix is: when `persona_asset.bodyOverride` is non-empty, prefer the override over the shared `corpse_body_asset`. Recommended: implicit — when `bodyOverride` exists, corpse uses the overridden body unless `corpseOverride` is explicitly declared.

### 4.3 Scaffold check relaxations (D3 — APPROVED with R2 correction)

`verify-scaffold.mjs` lines that **must** change:

- Line 654 — relax `manifest.body.file === "characters/..."` to allow root body OR any non-empty `bodyOverride.file`. Either keep the hardcoded root assertion (root body is still the mesh2motion control) and add per-persona body assertions, or replace the literal assertion with structural checks.
- Lines 656–657 — `modelScaleMultiplier` / `targetWorldHeight` near-equality on root body remains valid; add per-persona near-equality on the persona's effective body.
- Line 660–664 — `expectedBodyAnimationKinds` assert all clip kinds exist on the root body. **Add**: per-persona `bodyOverride.animation` may declare a subset; missing kinds are allowed (fallback chain handles them) but `idle` MUST be present on every body, AND `death` MUST be present when implicit-corpse-fallback applies (R7).
- Line 667 — `manifest.corpseBody?.file === manifest.body?.file` — relax to allow per-persona `corpseOverride` to differ (or implicitly fall back to the body).

**Add new structural assertions (R2 — corrected audit math):**

- Each `character` asset has either (a) no `bodyOverride` (uses root mesh2motion control), OR (b) a `bodyOverride` object with `file`, `sourceKey`, `sourcePack` (CC0 ratified), `modelScaleMultiplier`, `targetWorldHeight`, `attachBone`, `animation.idle` all present.
- **R7:** if a `character` asset has `armorOverlay` AND `bodyOverride`, the `bodyOverride.armourAttachBone` MUST be present (no fallback to root's `spine`, which is mesh2motion-specific).
- **R7:** if a `character` asset has `bodyOverride` and no explicit `corpseOverride`, the `bodyOverride` MUST declare either `animation.death` OR `deathPoseClip` (for implicit-corpse-fallback to work).
- **R2 — body-source category assertions (replaces the impossible "distinct `sourcePack` ≥ 4"):**
  - Exactly 1 persona has no `bodyOverride` (mesh2motion control).
  - ≥ 4 personas have `bodyOverride.sourcePack` matching `Quaternius-ModularCharacterOutfitsFantasy-CC0` (or, on Mechanism-3 degraded path, individual Quaternius poly.pizza packs — engineer documents in research log).
  - ≥ 1 persona has `bodyOverride.sourcePack` matching `OGA-BlackScorp-LowPolyWarrior-CC0` OR the documented rigged-warrior alternate identifier (e.g. `Kaykit-Adventurers-CC0` if BlackScorp falls through per R3).
  - ≥ 2 personas have `bodyOverride.sourcePack` matching `Kenney-<PackName>-CC0` for one CC0 Kenney 3D rigged pack.
  - **Distinct effective body GLB file count ≥ 4** (counts: 1 root mesh2motion + ≥ 3 distinct override files; satisfied even if multiple personas share a single Quaternius variant GLB).
- Every `bodyOverride.file` exists at the manifest path AND has a `.import` sidecar (existing pattern at line 696).
- Every `bodyOverride.sha256` matches the on-disk file (existing pattern at line 694).

### 4.4 New Godot audit — body-source provenance

`scripts/audit-body-source-provenance.gd` (NEW) — loads the manifest, iterates the 8 personas, for each one asserts:

- Resolves the effective body (root or override).
- Loads the body GLB as a `PackedScene`, instantiates it, finds the `Skeleton3D` and `AnimationPlayer`.
- Confirms the `Skeleton3D` exists (non-null) — a body without bones is a misclassified static prop. **(This is the audit BlackScorp must pass — R3.)**
- Confirms the `AnimationPlayer` has the manifest-declared `animation.idle` clip available.
- Confirms the actual root-bone name matches `bodyOverride.attachBone` parent chain (i.e. `attachBone` resolves to a real bone).
- **R7 — if persona has `armorOverlay` AND `bodyOverride`:** confirms `bodyOverride.armourAttachBone` resolves to a real bone on the override skeleton.
- **R7 — if persona has `bodyOverride` and no explicit `corpseOverride`:** confirms the override has either `animation.death` declared AND present on the AnimationPlayer, OR `deathPoseClip` declared.

This guards against the silent-broken-import failure mode where a GLB imports but the skeleton/animation player is missing or unnamed.

Existing audits to **regression-check (R1 — armorOverlay preservation now in-round):**

- `audit-character-scales.gd` — currently asserts `world_h=1.7000` for all 8 personas using root body. Must be parameterized over the effective per-persona body source.
- `audit-skin-bone-attachments.gd` — currently assumes mesh2motion bone names. **Per-persona bone names now vary.** The audit must either (a) read `bodyOverride.attachBone` and validate against the persona's actual skeleton, or (b) be relaxed so it tracks the count of bone-attached marks rather than asserting a specific bone token. Engineer choice.
- `audit-modular-submesh-armor.gd` — armor `bindBone` is per-persona-armorOverlay. **Per R1: armor stays preserved.** The audit must read `bodyOverride.armourAttachBone` and validate the armor's `bindBone` resolves to that bone on the override skeleton. The engineer authors `bodyOverride.armourAttachBone` per body during WP-A/B/C (e.g. Quaternius UBC `Spine`, Quaternius UBC `LeftHand`, BlackScorp `Head` — exact names discovered at integration time from the imported skeleton).
- `audit-mesh2motion-clips.gd` — currently iterates the shared body. Make it iterate only personas whose effective body sourceKey is `mesh2motion` (i.e. the control persona — currently rat per §6 table).

### 4.5 Showroom label changes (D4 — APPROVED with R8 tightening)

`Showroom.gd:_source_key_for_persona` currently returns the persona's asset `sourceKey` or falls back to root body `sourceKey` = `mesh2motion`. The merge at `_load_manifest:345` puts `asset.sourceKey` over `shared_body.sourceKey`, so post-merge the asset's top-level `sourceKey` wins.

**R8: do NOT rely on merge order.** Explicitly read `asset.bodyOverride.sourceKey` BEFORE falling back to the merged top-level `sourceKey`. This insulates the body-source label against a future per-persona top-level `sourceKey` (e.g. for skin/texture provenance). Concrete code change at `Showroom.gd:330–345`:

```gdscript
func _source_key_for_persona(persona: String) -> String:
    var assets = equipment_attachment.get("character_assets_by_persona")
    if typeof(assets) != TYPE_DICTIONARY:
        return "unknown"
    var asset = (assets as Dictionary).get(persona, {})
    if typeof(asset) != TYPE_DICTIONARY:
        return "unknown"
    # R8: explicit body-source-key lookup BEFORE the merged top-level key
    var body_override = (asset as Dictionary).get("bodyOverride", {})
    if typeof(body_override) == TYPE_DICTIONARY and not body_override.is_empty():
        var body_source_key := str((body_override as Dictionary).get("sourceKey", ""))
        if not body_source_key.is_empty():
            return body_source_key
    var source_key := str((asset as Dictionary).get("sourceKey", ""))
    if not source_key.is_empty():
        return source_key
    var manifest = equipment_attachment.get("manifest")
    if typeof(manifest) == TYPE_DICTIONARY:
        var body = (manifest as Dictionary).get("body", {})
        if typeof(body) == TYPE_DICTIONARY:
            return str((body as Dictionary).get("sourceKey", "unknown"))
    return "unknown"
```

**Note (informational, per Review A LOW-2):** current Showroom labels all read `"mesh2motion"` because per-persona assets lack a top-level `sourceKey`. Round 8.1 is the first round labels meaningfully differ — engineer should not be surprised by the visual change.

The persona label format (`Showroom.gd` line ~94) already shows `"%s\n%s" % [persona, source_key]`. **No new UI required.**

**Important regression check post-R8:** `_load_manifest` must NOT strip `bodyOverride` from `character_assets_by_persona[persona]` during the merge. The override block (or at minimum the `sourceKey` field) must remain available on the per-persona asset dict for `Showroom._source_key_for_persona` to read.

## 5. Download Mechanisms — Per Pack

### 5.1 WP-A — Quaternius Modular Character Outfits Fantasy (R4 revised)

Pack page (metadata + license): <https://quaternius.com/packs/modularcharacteroutfitsfantasy.html>
License (confirmed CC0 in pack page and Round-8 research log): CC0-1.0

Mechanism order (most-robust first; engineer escalates on failure):

**Mechanism 1 — quaternius.com metadata / license check (METADATA ONLY, NOT A DOWNLOAD)**

Reviews B and C both confirmed quaternius.com's "Download" button is wired through itch.io, not a direct static ZIP href. Engineer uses quaternius.com ONLY to:
- Confirm license is CC0-1.0 (recorded in research log).
- Read pack metadata (12 outfits / 62 modular parts) for asset selection.
- NOT a download mechanism. **Do not curl-grep for `.zip` hrefs and expect them to resolve — they redirect to itch.io.**

**Mechanism 2 — itch.io session cookie via `ITCHIO_SESSION` env var (PRIMARY)**

Reformulated for headless agent operation (R4). The engineer checks for the presence of an `ITCHIO_SESSION` environment variable in the dispatch environment:

```bash
if [ -z "$ITCHIO_SESSION" ]; then
  echo "ITCHIO_SESSION env var not set; skipping Mechanism 2 to Mechanism 3"
  # automatically skip to Mechanism 3
else
  # fetch CSRF token from the pack page
  CSRF=$(curl -L -s -c /tmp/itchio-cookies.txt \
    https://quaternius.itch.io/modular-character-outfits-fantasy \
    | grep -oE 'csrf_token=[^"]+' | head -1 | cut -d= -f2)

  # POST to download_url with session cookie + CSRF
  DL_URL=$(curl -L -s -X POST \
    -b /tmp/itchio-cookies.txt \
    -H "Cookie: itchio_session=$ITCHIO_SESSION" \
    -H "X-CSRF-Token: $CSRF" \
    https://quaternius.itch.io/modular-character-outfits-fantasy/download_url \
    | jq -r .url)

  curl -L -H "Cookie: itchio_session=$ITCHIO_SESSION" \
    -o /tmp/round-8-1-assets/quaternius-modular-character-outfits-fantasy.zip \
    "$DL_URL"
fi
```

If `ITCHIO_SESSION` env var is **NOT** set, the engineer automatically proceeds to Mechanism 3. **No manual browser login step required.** Per the headless-agent constraint flagged by Review C, this mechanism only fires when the operator has pre-set the session credential via env var; the engineer does not attempt to obtain one interactively.

The engineer must NOT check the session cookie into git or any artifact. The token is operator-supplied and stays in the env var only.

**Mechanism 3 — poly.pizza individual modular pieces (FALLBACK)**

Poly Pizza hosts Quaternius individual models but **not the full pack as one bundle** (research-confirmed). If Mechanism 2 doesn't fire (env var absent) or fails, engineer pulls 4-8 individual Quaternius character GLBs from <https://poly.pizza/search?q=quaternius+character> via direct CDN URLs (`https://poly.pizza/m/<id>` pages each expose a direct download href in their HTML).

Each persona that needs a Quaternius body uses one of these individual GLBs. The user loses the "modular outfit swap on a unified base" affordance but keeps body variety — which is the round's load-bearing goal.

When Mechanism 3 is used, the engineer records `sourcePack: "Quaternius-PolyPizzaIndividual-CC0"` (distinct from the modular-pack identifier) per body in the manifest. Audit assertion §4.3 allows this alternate identifier for the Quaternius slot.

**Mechanism 4 — flag for user (HARD FALLBACK)**

If Mechanisms 2 and 3 both fail, engineer documents the failure mode in the research log and the closing readout, surfaces it to the user, and proceeds with WP-B + WP-C + an expanded BlackScorp/Kenney persona allocation. **DO NOT silently substitute procedural textures** — explicit North Star constraint, Round 7 PROVED that path doesn't deliver.

**Forbidden mechanism — `butler` CLI for downloads.** Research-confirmed: butler is upload/deploy only, has no documented download command. Engineer must not waste cycles on this.

**R9 — research log records which mechanism fired.** Per pack, the research log must record WHICH mechanism actually delivered the asset (1=metadata only / never used for delivery, 2=itch session cookie, 3=poly.pizza, 4=failed). Round 9 must not inherit unverified assumptions about which mechanism works in headless CI.

### 5.2 WP-B — OGA BlackScorp Low Poly Warrior (R3 — rigging risk surfaced)

Source: <https://opengameart.org/content/low-poly-warrior>. License: CC0 1.0 (confirmed in Round-8 research log).

**RIGGING RISK (R3 — surfaced by Review B):** Review B's verification of the OGA page states the model is **not rigged**. The new audit `audit-body-source-provenance.gd` requires `Skeleton3D` + `AnimationPlayer` per persona body, which an unrigged mesh would fail.

This plan does NOT pre-resolve the rigging question (no implementation in plan job — no archive download or inspection). Instead, WP-B's first subtask is verification, with an explicit fail path.

Round 8 already downloaded an archive (`/tmp/round-8-assets/oga-blackscorp-low-poly-warrior.zip` sha256 `7f6ecd8044093b6c8ab2e594224a3524c2510317ae0b8ec6d2cf742877137c04`) but did NOT integrate it — Round 8 flagged "OBJ references a mismatched material filename and generates Godot import errors without manual source repair." Rigging status was not verified in Round 8 either.

**Round 8.1 mechanism:**

1. **Verify rigging FIRST.** Engineer locates or re-downloads the BlackScorp archive (`/tmp/round-8-assets/oga-blackscorp-low-poly-warrior.zip`), unzips, and inspects file contents (GLB/FBX/OBJ structure, presence of skeleton data). Records finding in research log.
2. **Branch on rigging finding:**
   - **(branch i — rigged)** If the archive ships a GLB/FBX with skeleton + animation data, proceed with import. If OBJ+MTL only (Round 8's blocker), repair MTL `map_Kd` references to point at actual texture filenames, then import.
   - **(branch ii — not rigged)** Drop BlackScorp from the persona allocation. Pursue rigged CC0 warrior alternate (research at integration time — known candidate: **Kaykit Adventurers** by Kay Lousberg, CC0 stylized fantasy character pack with rigged warriors at <https://kaylousberg.itch.io/kaykit-adventurers>; engineer verifies CC0 status and rigging at fetch time). If no rigged alternate can be sourced within the round budget, redistribute the BlackScorp slot to a 5th Quaternius body OR a 3rd Kenney variant; document the BlackScorp drop in the closing readout per the North Star "don't silently fall back to procedural" rule.
3. **Whichever body wins the paranoid slot, author `bodyOverride.armourAttachBone` for it** so the paranoid `armorOverlay` (crown/helmet) keeps attaching post-R1. The engineer discovers the head-equivalent bone in Godot at import time and writes it into the manifest.
4. Stage at `art-kit/characters/oga-blackscorp-warrior.glb` (or `art-kit/characters/<alternate>.glb` per branch ii).
5. Generate `.import` sidecar.
6. Update manifest `assets[paranoid].bodyOverride` per §6.

**No Blender required** for branch (i) — Godot 4 handles OBJ/MTL with repaired material references and FBX with embedded textures.

### 5.3 WP-C — Kenney character pack (R5 candidate list corrected)

Engineer picks ONE Kenney character pack from <https://kenney.nl/assets>. Per Review B's verification, Kenney Toon Characters is **2D** and is dropped from the candidate list. Recommended 3D rigged candidates only:

- **Kenney Mini Characters** — clean low-poly stylized humanoids, rigged, with idle/walk/run/attack/die animations. CC0 by default.
- **Kenney Mini Dungeon** — fantasy dungeon-themed Mini character variants. CC0 by default.
- **Kenney Mini Arena** — arena/combat Mini variants. CC0 by default.
- **Kenney Animated Characters Protagonists** — rigged humanoid protagonists. CC0 by default.

Engineer picks ONE pack from the four above, downloads directly via the Kenney.nl "Download" button (which is a direct ZIP URL, no auth):

```bash
curl -L -o /tmp/round-8-1-assets/kenney-mini-characters.zip \
  "https://kenney.nl/media/pages/assets/mini-characters/<some-hash>/<filename>.zip"
```

(Engineer discovers the exact URL by inspecting the Kenney page; URLs are stable.) Kenney character packs ship with a standard humanoid clip set baked into each GLB; the engineer picks 2 variants for 2 different persona body sources.

**`bodyOverride.animation.death` (R7):** Kenney Mini packs typically ship a `Death` or `Die` clip in each character GLB; if missing on a chosen variant, the engineer either picks a different variant from the same pack OR declares an explicit `bodyOverride.deathPoseClip` referencing a frame of the takeHit/fall clip. This is required for implicit-corpse-fallback (D9 / R7).

## 6. Persona–Body Assignment Table (R1 reflects Path α — armor preserved)

This is the **target allocation**; engineer may permute slot identities (which Quaternius outfit goes where, which Kenney variant goes where) based on visible fit at integration time. Constraint: 1 mesh2motion control + 4 Quaternius UBC + 1 OGA BlackScorp (or rigged alternate per R3) + 2 Kenney = 8 personas.

Round 8's `armorOverlay` is **PRESERVED** on duelist, paranoid, vulture (R1, reversing v1's drop default). Per-body `armourAttachBone` re-tuned at integration time.

| Persona      | Round 8 body | Round 8.1 body source                            | Source pack key                                                | armorOverlay? | armourAttachBone (per-body) |
|--------------|--------------|--------------------------------------------------|----------------------------------------------------------------|---------------|------------------------------|
| rat          | mesh2motion  | **mesh2motion (CONTROL)**                        | `mesh2motion`                                                  | none          | n/a (root field `spine`)     |
| duelist      | mesh2motion  | Quaternius UBC + fighter outfit                  | `Quaternius-ModularCharacterOutfitsFantasy-CC0`                | chest plate   | Spine equivalent (engineer discovers at import) |
| trader       | mesh2motion  | Kenney variant 1                                 | `Kenney-<PackName>-CC0`                                        | none          | n/a                          |
| opportunist  | mesh2motion  | Quaternius UBC + rogue outfit                    | `Quaternius-ModularCharacterOutfitsFantasy-CC0`                | none          | n/a                          |
| paranoid     | mesh2motion  | OGA BlackScorp warrior OR rigged alternate (R3)  | `OGA-BlackScorp-LowPolyWarrior-CC0` OR alternate (e.g. Kaykit) | crown/helmet  | Head equivalent              |
| camper       | mesh2motion  | Quaternius UBC + ranger outfit                   | `Quaternius-ModularCharacterOutfitsFantasy-CC0`                | none          | n/a                          |
| sprinter     | mesh2motion  | Kenney variant 2                                 | `Kenney-<PackName>-CC0`                                        | none          | n/a                          |
| vulture      | mesh2motion  | Quaternius UBC + scavenger outfit                | `Quaternius-ModularCharacterOutfitsFantasy-CC0`                | left gauntlet | LeftHand equivalent          |

**Minimums satisfied**: 4 Quaternius + 1 OGA-or-alternate + 2 Kenney + 1 mesh2motion control = 8 personas. Distinct effective body GLB files ≥ 4. armorOverlay preservation: 3/3 Round 8 cells retained (duelist chest, paranoid helmet, vulture gauntlet).

Round 8 weapon/armor/skin/gore decisions per persona are **carried forward**. Notes:

- Quaternius weapons attach to `right_hand` per the weapon asset's `attachBone`. The new bodies expose `bodyOverride.attachBone` (e.g. Quaternius UBC `RightHand`, Kenney `Hand_R`, BlackScorp/alternate `Right.Hand`). The weapon socket logic in `_weapon_socket_for_character` reads `asset.attachBone` — which post-merge becomes the per-persona `bodyOverride.attachBone`. **No weapon-pack changes needed.**
- **R1: Quaternius armorOverlay (duelist `spine_03`, paranoid `head`, vulture `hand_l`) bind bones are mesh2motion-specific.** On body swap, engineer authors `bodyOverride.armourAttachBone` per body so the existing `armorOverlay.bindBone` resolves via the bodyOverride field on the per-persona body skeleton. The `audit-modular-submesh-armor.gd` update at §4.4 enforces this.
- Skin techniques (palette_flat, pbr_texture_atlas, pattern_texture, decal_stickers, toon_cel, emissive_trim, multi_material_split, rim_fresnel) are body-mesh-UV-dependent. On body swap, the UV-painted techniques may render visibly differently (different UV layouts). **This is expected breadth-sample data.** Engineer should NOT re-tune textures per body; the manifest skin block stays as-is, and the visible result becomes part of the curation comparison.

## 7. Dependency Map / Parallelization

```
              ┌──────────────────────┐
              │ WP-D Schema/Manifest │  ◄── single coordination point; depends on WP-A/B/C results
              └─────────┬────────────┘
                        │
   ┌────────────────────┼────────────────────┐
   │                    │                    │
┌──┴──────────┐  ┌──────┴──────┐  ┌──────────┴──┐
│ WP-A        │  │ WP-B        │  │ WP-C        │
│ Quaternius  │  │ BlackScorp  │  │ Kenney      │
│ outfits     │  │ + rigging   │  │ characters  │
│ (LARGEST)   │  │  verify     │  │ (mid)       │
└─────────────┘  └─────────────┘  └─────────────┘
                        │
                  ┌─────┴───────┐
                  │ WP-E Audits │
                  └─────────────┘
```

- **WP-A, WP-B, WP-C run in parallel** (independent downloads, independent body GLB integrations into the art-kit tree).
- **WP-D** depends on all three completing because it edits a single shared file (`manifest.json` + `verify-scaffold.mjs`). To keep parallelism, the engineer may sub-divide WP-D into:
  - WP-D.1 — schema scaffold (introduce `bodyOverride` field handling in `EquipmentMeshAttachment._load_manifest` + `Showroom._source_key_for_persona` per R8); can land FIRST, blocked only on D1/D2 decisions.
  - WP-D.2 — apply per-persona manifest entries; merges in serial after WP-A/B/C.
- **WP-E** depends on WP-D (the new audit scripts validate against the new manifest shape).

## 8. Work Package Breakdown

### WP-A — Quaternius Modular Character Outfits Fantasy

**UAT vertical slice:** the user opens the Showroom and sees 4 personas with distinct Quaternius outfit bodies, each labelled with `quaternius-ubc` source key (or `quaternius-polypizza` on Mechanism-3 fallback), idling visibly. Duelist + vulture armorOverlay still attaches.

**Subtasks:**

1. Verify license CC0 via Mechanism 1 (quaternius.com metadata read). Record in research log.
2. Download pack via Mechanism 2 (itch session cookie if `ITCHIO_SESSION` env var present) → Mechanism 3 (poly.pizza individual models) → Mechanism 4 (flag user). Record sha256 + URL + size + **which mechanism fired (R9)** in research log.
3. Unzip to `/tmp/round-8-1-assets/quaternius-modular-character-outfits-fantasy/` (or per-model directory if Mechanism 3).
4. Identify the Universal Base Characters base mesh + 4 outfits (engineer picks: fighter, rogue, ranger, scavenger or closest equivalents). Note: the pack contains "12 outfits, 62 modular parts" — engineer is NOT integrating all 62 parts; pick 4 coherent character GLBs (base + one outfit fused per character) and ship as 4 separate persona body GLBs at `art-kit/characters/quaternius-ubc-<name>.glb`.
5. **R1:** for duelist + vulture, discover the Spine and LeftHand equivalent bone names from the imported skeleton, author into `bodyOverride.armourAttachBone`.
6. **R7:** confirm each chosen body GLB has a `death` clip; declare `bodyOverride.animation.death` accordingly. If missing, find a variant that has one or set explicit `bodyOverride.deathPoseClip`.
7. Generate `.import` sidecars (Godot auto-creates on first headless import).
8. Update manifest `assets[].bodyOverride` for duelist, opportunist, camper, vulture (per §6 table).
9. Verify Showroom renders each cell with the new body — confirm via `npm --prefix throwaway-prototypes/d-full-match test` (audit scripts).

**Success criteria:**

- 4 GLB files staged under `art-kit/characters/quaternius-ubc-*.glb`, each with sha256/size in manifest and `.import` sidecars.
- Each body GLB instantiates in Godot with a non-null `Skeleton3D` and `AnimationPlayer`.
- Each body GLB has at minimum `idle` and `death` animation clips (or explicit `deathPoseClip` for the latter).
- For duelist + vulture, `bodyOverride.armourAttachBone` is present and resolves to a real bone on the override skeleton.
- Manifest schema 7 validates via `verify-scaffold.mjs`.
- Research log records download URL + sha256 + license confirmation + WHICH mechanism fired (R9) for the pack.

### WP-B — OGA BlackScorp Low Poly Warrior (or rigged alternate per R3)

**UAT vertical slice:** paranoid persona cell in Showroom renders the BlackScorp warrior body (or rigged alternate), labelled with the correct source key. Paranoid armorOverlay (crown/helmet) still attaches.

**Subtasks:**

1. **R3 — verify rigging FIRST.** Locate or re-download the BlackScorp archive (Round 8 has it at `/tmp/round-8-assets/oga-blackscorp-low-poly-warrior.zip`).
2. Unzip; inspect for GLB/FBX (prefer) or OBJ+MTL. **Identify whether the mesh ships with skeleton + animation data.** Record finding in research log.
3. **Branch on rigging finding:**
   - **(i) Rigged**: stage GLB/FBX directly. If OBJ+MTL: repair MTL `map_Kd` references, convert, then stage.
   - **(ii) Not rigged**: drop BlackScorp; pursue Kaykit Adventurers (or other rigged CC0 warrior alternate). Verify CC0 + rigged status of the alternate at fetch time. If neither sourceable: redistribute paranoid to a 5th Quaternius or 3rd Kenney variant.
4. Stage at `art-kit/characters/oga-blackscorp-warrior.glb` (or `art-kit/characters/<alternate>.glb`).
5. **R1:** discover the Head-equivalent bone name from the imported skeleton, author into `bodyOverride.armourAttachBone` so paranoid's armorOverlay (helmet) still attaches.
6. **R7:** confirm the body GLB has a `death` clip; declare `bodyOverride.animation.death`. If missing, set explicit `bodyOverride.deathPoseClip`.
7. Generate `.import` sidecar.
8. Update manifest `assets[paranoid].bodyOverride` per §6 (sourcePack updated to alternate if branch ii fired).

**Success criteria:**

- 1 GLB staged for paranoid persona, rigged (Skeleton3D + AnimationPlayer present).
- `bodyOverride.armourAttachBone` resolves to a real bone; paranoid's crown/helmet armor still attaches.
- `bodyOverride.animation.death` (or `deathPoseClip`) declared and resolvable.
- Renders in Showroom for the paranoid persona.
- Research log records the rigging verification result, repair (if any), which mechanism fired (R9), and the source identifier used.

### WP-C — Kenney character pack (R5 candidates only)

**UAT vertical slice:** trader and sprinter personas in Showroom render distinct Kenney body variants, each labelled `kenney-<packname>` source key.

**Subtasks:**

1. Engineer picks ONE Kenney pack from the R5-approved candidate list (Mini Characters / Mini Dungeon / Mini Arena / Animated Characters Protagonists). Toon Characters is forbidden (2D).
2. Download via direct curl from kenney.nl (no auth required).
3. Unzip; pick 2 distinct character GLBs (different visual variants), each with rigged Skeleton3D + AnimationPlayer + idle/death clips.
4. Stage at `art-kit/characters/kenney-<packname>-<variant>.glb`.
5. **R7:** confirm each chosen variant has `death`; declare `bodyOverride.animation.death` (or set `deathPoseClip`).
6. Generate `.import` sidecars.
7. Update manifest `assets[trader/sprinter].bodyOverride` per §6.

**Success criteria:**

- 2 GLB files staged.
- Each variant is rigged (Skeleton3D + AnimationPlayer) and visibly distinct in Showroom.
- Each declares `idle` + `death` (or `deathPoseClip`).
- Research log records the pack URL + sha256 + Kenney-default-CC0 confirmation + WHICH mechanism fired (R9, expected: direct Kenney.nl download).

### WP-D — Schema bump + manifest update + Showroom labels

**UAT vertical slice:** Showroom shows 8 distinct persona cells, each labelled with its correct body source key.

**Subtasks:**

1. Bump manifest `schemaVersion` from 6 → 7.
2. Add per-persona `bodyOverride` blocks for 7 of 8 personas (rat is mesh2motion control).
3. Update `EquipmentMeshAttachment._load_manifest` to merge `bodyOverride` over `shared_body` before merging persona asset (per §4.1). **Preserve the `bodyOverride` sub-dict on the per-persona asset post-merge** so Showroom's R8 lookup can read `asset.bodyOverride.sourceKey` directly.
4. Update `EquipmentMeshAttachment.instantiate_persona_character` / `instantiate_persona_corpse` to use the per-persona body asset (the current implementation already reads from `character_assets_by_persona`, so this is mostly the merge logic in #3).
5. **R8: update `Showroom._source_key_for_persona`** to read `asset.bodyOverride.sourceKey` explicitly before falling back to the merged top-level `sourceKey` (per §4.5).
6. Update `verify-scaffold.mjs` per §4.3.

**Success criteria:**

- `npm test` passes (root project).
- `npm --prefix throwaway-prototypes/d-full-match test` passes (Godot audits).
- `npm --prefix throwaway-prototypes/d-full-match run build` produces clean web export.
- Showroom labels show 4 distinct source keys across the 8 cells (mesh2motion, quaternius-ubc, oga-blackscorp-or-alternate, kenney-<pack>).

### WP-E — Audit additions + regression checks

**UAT vertical slice:** auditor (`audit-body-source-provenance.gd`) machine-introspects all 8 persona bodies and reports source/skeleton/idle-clip/death-clip/armourAttachBone per cell.

**Subtasks:**

1. New audit `scripts/audit-body-source-provenance.gd` per §4.4 — including R7 armourAttachBone and death-clip assertions.
2. Update `audit-character-scales.gd` to parameterize over per-persona body source.
3. Update `audit-skin-bone-attachments.gd` to either read per-persona attach bones or relax to count-based assertions.
4. **R1: update `audit-modular-submesh-armor.gd`** to read `bodyOverride.armourAttachBone` and validate each persona's `armorOverlay.bindBone` resolves to that bone on the override skeleton. Armor is preserved this round, so this audit must pass.
5. Update `audit-mesh2motion-clips.gd` to iterate only mesh2motion-bodied personas.
6. Wire all new/changed audits into `package.json` test script.

**Success criteria:**

- All audits run and pass against the Round 8.1 manifest.
- The forbidden-token grep (Round-5 discipline at `verify-scaffold.mjs:870`) still passes.
- Audit reports machine-readable per-persona body provenance (sourceKey, sourcePack, sha256, armourAttachBone, death-clip status) printed in headless run output for the closing readout to quote.

## 9. Schema Design — Full Field List for `bodyOverride` (R7 tightening)

```jsonc
{
  "bodyOverride": {
    // REQUIRED:
    "file": "characters/<body-glb-path>.glb",      // relative to art-kit root
    "sourceKey": "quaternius-ubc|oga-blackscorp|kaykit-adventurers|kenney-<pack>",   // short body-source identifier (Showroom label)
    "sourcePack": "<CC0PackIdentifier>",            // long-form identifier matching Round-8 research log conventions
    "modelScaleMultiplier": 1.00,                   // per-body scale tuning (each pack has its own source height)
    "targetWorldHeight": 1.7,                       // shared anchor; effective scale = source_height * CHARACTER_MODEL_SCALE * modelScaleMultiplier
    "attachBone": "RightHand",                      // right-hand bone in this body's skeleton (where weapons attach)
    "animation": {
      "idle": "Idle"                                // REQUIRED — Showroom default state
      // Optional: walk, attack, attack_unarmed, attack_armed, take_hit, loot
      // CONDITIONAL: "death" REQUIRED when persona has no explicit corpseOverride (R7) — see below.
      // Missing OPTIONAL clips fall back via _fallback_chain_for_kind
    },
    // CC0 provenance (required for scaffold check):
    "sizeBytes": 1234567,
    "sha256": "<hex>",
    "source": {
      "title": "...",
      "creator": "...",
      "pageUrl": "https://...",
      "downloadUrl": "https://...",
      "downloadMechanism": "1|2|3|4"               // R9 — REQUIRED — which mechanism delivered the asset
    },
    "license": {
      "spdx": "CC0-1.0",
      "name": "CC0 1.0 Universal / Public Domain",
      "url": "https://creativecommons.org/publicdomain/zero/1.0/",
      "attributionRequired": false,
      "notes": "..."
    },
    "extraction": {
      "sourceArchive": "/tmp/round-8-1-assets/<file>.zip",
      "sourceArchiveSha256": "<hex>",
      "sourceArchivePath": "<path-inside-archive>",
      "selectedOnly": true
    },

    // CONDITIONALLY REQUIRED (R7 — consequence of R1 D6 reversal):
    "armourAttachBone": "Spine",                    // REQUIRED iff persona has armorOverlay AND bodyOverride present.
                                                    // No fallback to root's "spine" — mesh2motion-specific bone name.
                                                    // Engineer discovers per-body equivalent at integration time.

    // CONDITIONALLY REQUIRED (R7 — implicit corpse fallback / D9):
    "deathPoseClip": "Death_Pose"                   // OR "animation.death" must be present, when corpseOverride is implicit (absent / null).
                                                    // Without this, instantiate_persona_corpse has nothing to pose the corpse on.

    // OPTIONAL:
    "pivotYOffset": 0
  },
  "corpseOverride": null|{ ... }                    // null → implicit fallback to persona's own body paused on death clip
                                                    //         (REQUIRES bodyOverride.animation.death or bodyOverride.deathPoseClip per R7)
                                                    // explicit object → separate corpse body GLB
}
```

## 10. Assignment-Level Success Criteria

1. `npm run lint` PASS
2. `npm run typecheck` PASS
3. `npm run build` PASS
4. `npm test` PASS
5. `GODOT_BIN=... npm --prefix throwaway-prototypes/d-full-match test` PASS
6. `GODOT_BIN=... npm --prefix throwaway-prototypes/d-full-match run build` PASS — web export builds cleanly (pck size will grow significantly, that's expected)
7. Round-5 forbidden-token grep at `verify-scaffold.mjs:870` PASS unchanged
8. **R2: Body-source category counts satisfied** — exactly 1 mesh2motion control, ≥ 4 Quaternius UBC (or Quaternius-PolyPizzaIndividual on Mechanism-3 fallback), ≥ 1 OGA BlackScorp (or rigged alternate per R3), ≥ 2 Kenney. **Distinct effective body GLB files ≥ 4.**
9. ≥ 4 personas use Quaternius modular outfits / UBC (or poly.pizza individuals)
10. ≥ 1 persona uses OGA BlackScorp warrior OR documented rigged CC0 warrior alternate
11. ≥ 2 personas use Kenney character variants (3D rigged pack only — Toon Characters excluded)
12. Exactly 1 persona (rat per §6 table) retains mesh2motion as the control
13. **R1: Round 8's already-applied modular armor overlays (duelist chest, paranoid helmet, vulture gauntlet) are PRESERVED.** Per-body `bodyOverride.armourAttachBone` re-tuned so each persona's armor still attaches.
14. Round 8's other CC0 assets (weapons, ambientCG PBR sets, OGA gore decals) are NOT regressed where they continue to attach
15. **R6: Research log update appended as a new "Round 8.1" section in `docs/project/phases/render-rnd/round-8-research-log.md`** records every downloaded pack URL, license, sha256, integrated body GLBs, **R9: which mechanism fired per pack (1/2/3/4)**, and any pack that couldn't be downloaded with explanation. (A separate working file `round-8-1-research-log.md` may exist but is NOT the required artifact.)
16. Closing readout at `docs/project/phases/render-rnd/round-8-1-closing-readout.md` documents the persona-body matrix, the body-swap strategic decision record, BlackScorp rigging outcome (verified rigged / replaced with alternate / dropped), and failure modes encountered
17. The Round 8 closing readout's "Files Changed" list approximate is extended with `art-kit/characters/quaternius-ubc-*.glb`, `art-kit/characters/oga-blackscorp-warrior.glb` (or alternate), `art-kit/characters/kenney-*.glb`, the manifest schema-7 bump, and the new/updated audit scripts

## 11. Failure-Mode Contingencies

| Failure mode | Engineer response |
|---|---|
| Quaternius Mechanism 2 fails (no `ITCHIO_SESSION` env var, or session token rejected) | Automatically proceed to Mechanism 3 (poly.pizza individual models). Pivot manifest to single-piece GLBs instead of modular-outfit assemblies. Document loss-of-modularity in closing readout. Record `downloadMechanism: "3"` in manifest. |
| Quaternius Mechanism 3 also fails (poly.pizza returns no usable rigged Quaternius character GLBs) | Mechanism 4 — flag for user. Proceed with WP-B + WP-C; expand BlackScorp/Kenney allocation to cover the open Quaternius slots within the round budget. Document in closing readout. **Do not silently fall back to procedural authoring.** |
| Quaternius pack downloads but the GLBs ship without animation clips | Use Quaternius's separately-distributed Universal Animation Library (https://quaternius.com/packs/universalanimationlibrary.html). If that also fails, declare `animation.idle` only and use `deathPoseClip` for the implicit-corpse path. Body silhouette is the load-bearing visual. |
| **R3: BlackScorp ships unrigged (no Skeleton3D / no AnimationPlayer)** | Drop BlackScorp; pursue Kaykit Adventurers as the rigged CC0 warrior alternate (verify CC0 + rigging at fetch time). If Kaykit also unavailable / not-CC0, redistribute the paranoid slot to a 5th Quaternius body OR a 3rd Kenney variant. Document the BlackScorp drop and the alternate chosen in closing readout. Audit assertion §4.3 allows the alternate `sourcePack` identifier. |
| **R3 fallback: Kaykit (or other alternate) also fails** | Redistribute paranoid to Quaternius or Kenney. Update manifest `assets[paranoid].bodyOverride.sourcePack` accordingly. Update audit §4.3 to relax the OGA-or-alternate requirement to zero (with documented justification in the manifest's `notes` field and closing readout). |
| BlackScorp won't import cleanly even after MTL repair (texture filenames missing from archive entirely) | Drop the BlackScorp persona swap per R3 fallback path. Do not silently substitute procedural. |
| Kenney pack of choice has no rigged characters | Pick a different Kenney pack from R5's approved list (Mini Characters / Mini Dungeon / Mini Arena / Animated Characters Protagonists). If all four lack rigged variants for the chosen visual style: pick the closest, document. |
| Quaternius UBC bone names differ from weapon `attachBone` literal `right_hand` | Set `bodyOverride.attachBone` to the body's actual right-hand bone name (e.g. `RightHand`, `Hand_R`, `mixamorig:RightHand`). The weapon socket logic reads `asset.attachBone`, so weapons will attach correctly. |
| **R1: armor `bindBone` doesn't resolve on the override body** | Engineer discovers the closest equivalent bone in the override skeleton during integration (e.g. `Spine`, `Head`, `LeftHand`) and writes that into `bodyOverride.armourAttachBone`. If NO equivalent bone exists (extreme rigging mismatch), the engineer documents in closing readout and drops the armor for that single persona — but this is a per-persona escape hatch, not a round-wide default. Recovery direction: re-tune, don't drop. |
| **R7: chosen override body has no death clip and no acceptable frame for `deathPoseClip`** | Pick a different variant from the same pack with a death clip. If no variant in the pack has one: declare an explicit `corpseOverride` referencing the root mesh2motion corpse body (i.e., explicitly mix corpse body with override live body — sacrifices visual coherence but unblocks corpse rendering). Document in closing readout. |
| `audit-skin-bone-attachments.gd` can't be cleanly adapted to per-body bone names within the round budget | Relax to counting-based assertions (e.g. "persona has at least N bone-attached decals", not "decal X attaches to bone Y"). Document the relaxation in closing readout as a Round-9 carryforward. |
| Web export pck grows past acceptable budget for the prototype | Expected (multi-MB body packs). The prototype is throwaway — no size budget. Note actual pck size in closing readout for the user. |
| Showroom layout breaks because new bodies have different default heights | `targetWorldHeight: 1.7` is the shared anchor; per-body `modelScaleMultiplier` re-tunes to match. Engineer adjusts per-body multiplier until audit reports `world_h≈1.7` for all 8 personas. |

## 12. Hard Constraints (carry from North Star)

- ❌ NO UAT / browsertools / chromium / screenshots / headless visual checks. User UATs in Showroom themselves.
- ❌ NO procedural engineer-authored PNG fallbacks for character skin slots. Flag for user instead. Round 7 PROVED that path doesn't deliver.
- ❌ **R1: NO regression to Round 8's already-applied modular armor overlays.** Path α: armor preserved via per-body `bodyOverride.armourAttachBone`. Dropping armor is a per-persona escape hatch under failure-matrix only, not a round default.
- ❌ NO Convex / production code changes. Throwaway boundary preserved.
- ❌ NO contract / schema changes outside the throwaway prototype manifest.
- ❌ NO pathing logic in renderer.
- ❌ NO `butler` CLI download attempts (confirmed non-supported).
- ❌ **R4: NO manual browser login step.** Mechanism 2 is auto-skipped when `ITCHIO_SESSION` env var is absent.

## 13. Dependency / Recommended Job Sequence

```
1. PM review of this v2 plan ── normal PM flow
2. WP-A, WP-B, WP-C run in parallel (3 engineer jobs, all download + integrate)
3. WP-D coordinates the manifest schema + Showroom labels (sequential after the 3 parallel jobs)
4. WP-E audits validate + regression-check (sequential after WP-D)
5. Final review job ── normal review flow
6. Document job ── closing readout AND research log append (R6 — APPEND to round-8-research-log.md, not separate file)
7. NO UAT job ── user UATs in Showroom
```

**Critical sequencing note:** WP-D's schema scaffold (the merge logic in `EquipmentMeshAttachment._load_manifest` + R8 explicit-bodyOverride-sourceKey lookup in `Showroom._source_key_for_persona`) is a small surface and could optionally land BEFORE WP-A/B/C as a no-op enabler (i.e., the schema supports `bodyOverride` but no asset uses it yet — manifest is still effective Round 8). This unblocks WP-A/B/C from depending on each other. Engineer judgment.

**R6 — research log path:** the Round 8.1 research findings APPEND to `docs/project/phases/render-rnd/round-8-research-log.md` as a new "Round 8.1" section. The North Star explicitly requests this update. A separate `round-8-1-research-log.md` may exist as an engineer working file but is NOT the required artifact.

**R9 — research log content requirements:** per-pack records MUST include which download mechanism fired (1/2/3/4), not just the final URL. Round 9 must not inherit unverified assumptions about Mechanism 1 working in headless CI (it does not — Mechanism 1 is metadata-only per R4).

## 14. Ambiguities / Decisions Needing Confirmation Before Implementation (v2 update)

| ID | Decision | Engineer default | Status |
|---|---|---|---|
| D1 | Body swap vs outfits-as-armor | Body swap (path a) — see §3 | **APPROVED** (Reviews A/B/C concurred — body swap aligns with §10 recursive breadth and the user's UAT) |
| D2 | Manifest `bodyOverride` schema design | Per §4.1, §9 (now tightened per R7) | **APPROVED** with R7 tightening (Reviews A/B/C concurred on schema shape; armourAttachBone + death-clip now conditional REQUIRED) |
| D3 | Scaffold relaxation strategy | Add per-persona, keep root assertion (mesh2motion control); replace impossible distinct-`sourcePack`≥4 with category counts per R2 | **APPROVED with R2 correction** (impossible audit math fixed; category-count assertions adopted) |
| D4 | Showroom label format change | Reuse existing `"%s\n%s" % [persona, source_key]` — no UI change; explicit `bodyOverride.sourceKey` lookup per R8 | **APPROVED with R8 tightening** |
| D5 | Persona-body assignment (§6) | Engineer follows table as default | Engineer may permute outfit-slot identity. Allocation totals (1 mesh2motion / 4 Quaternius / 1 OGA-or-alternate / 2 Kenney) are fixed. |
| D6 | armorOverlay on swapped bodies | **REVERSED v1 → v2: PRESERVE armorOverlay via per-body `armourAttachBone` (Path α).** | **REVERSED — Path α ratified** (R1; reversal rationale: North Star "NO regression to Round 8 sourced CC0 assets"; Path β-with-≥3-controls cannot satisfy body-source minimums; engineer authors per-body armourAttachBone at integration time as the cheapest preserve-armor path) |
| D7 | mesh2motion clip retargeting onto Quaternius/Kenney bodies | Deferred to Round 9. Each body uses its own native clips. | **APPROVED** — explicit in §3.4 |
| D8 | Kenney pack selection | Engineer picks from Mini Characters / Mini Dungeon / Mini Arena / Animated Characters Protagonists (R5 — Toon Characters dropped, 2D) | Engineer judgment within the corrected R5 candidate list |
| D9 | Corpse body override default behavior | Implicit fallback to persona body paused on death clip | **APPROVED with R7 tightening** — `bodyOverride.animation.death` OR `deathPoseClip` REQUIRED when corpseOverride is implicit |
| **D10 (NEW)** | BlackScorp rigging risk | WP-B first subtask = verify rigging. Branch on finding (R3): proceed if rigged; if unrigged, Kaykit Adventurers as alternate; if alternate fails, redistribute to Quaternius / Kenney | MED — explicit failure path in §5.2 and §11. Engineer resolves at integration time. |
| **D11 (NEW)** | `ITCHIO_SESSION` env var presence in dispatch environment | If present, Mechanism 2 fires; if absent, auto-skip to Mechanism 3 | LOW — operational. PM may pre-set the env var in the dispatch environment if they want Mechanism 2 used; otherwise Mechanism 3 (poly.pizza) is the de facto path. |

## 15. Mental-Model Cross-Link

- **§10 — Recursive breadth/consolidate.** Round 8 prematurely consolidated on mesh2motion body before the user had ratified body shape. Round 8.1 re-opens the body axis as the next finer breadth-sample. The recursive pattern is intact: body → outfit → skin/technique → material → gore → accessory. Round 8 attempted to compress two of those into one round; Round 8.1 corrects by isolating body as the moving variable and preserving everything else from Round 8 (including modular armor — R1).
- **§13 — Sourced before procedural.** The fix is explicitly **download CC0 packs that already exist**, not generate procedural body meshes. Round 7's lesson holds. R3's BlackScorp fail path is explicitly "find a different rigged CC0 pack" not "generate procedural rigged warrior."
- **§13 — Adherence taxonomy.** Modular armor wrapping (the `modular_submesh` Round-8 win) is mesh2motion-substrate-coupled BY VARIABLE NAME but not by mechanism. Per-body `armourAttachBone` rebinds the mechanism to whichever body's skeleton hosts the persona this round. The taxonomy stays codified in `EquipmentMeshAttachment.gd` as named constants — that knowledge is preserved.
- **§7 — Decision filter.** The body axis directly makes prompt-authored behavior more *legible* — distinct silhouettes per persona means the user can read which persona is doing what at a glance. That is the §5 attribution win. Tactical-realism is not the driver.
- **§10 — POC posture.** Schema bump is fine. Per-persona body override is a forward-only manifest shape. No back-compat shims.

## 16. References

- `docs/project/spec/mental-model.md` §10, §13
- `docs/project/phases/render-rnd/round-8-closing-readout.md`
- `docs/project/phases/render-rnd/round-8-research-log.md` — APPEND target for Round 8.1 research findings (R6)
- `docs/project/phases/render-rnd/round-8-research-applied-spec.md`
- `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json`
- `throwaway-prototypes/d-full-match/src/EquipmentMeshAttachment.gd` (`_load_manifest`, `instantiate_persona_character`, `instantiate_persona_corpse`)
- `throwaway-prototypes/d-full-match/src/Showroom.gd` (`_source_key_for_persona`, `_spawn_persona_station`)
- `throwaway-prototypes/d-full-match/scripts/verify-scaffold.mjs` (relaxations at lines 654, 656, 657, 660, 667; new structural assertions per §4.3 R2)
- `throwaway-prototypes/d-full-match/scripts/audit-*.gd` (regression-check + new `audit-body-source-provenance.gd`)
- Quaternius pack metadata: <https://quaternius.com/packs/modularcharacteroutfitsfantasy.html> (METADATA ONLY per R4)
- Quaternius itch.io download endpoint (Mechanism 2): <https://quaternius.itch.io/modular-character-outfits-fantasy>
- Poly Pizza (Mechanism 3): <https://poly.pizza/search?q=quaternius+character>
- OGA BlackScorp: <https://opengameart.org/content/low-poly-warrior>
- Kaykit Adventurers (R3 alternate candidate): <https://kaylousberg.itch.io/kaykit-adventurers>
- Kenney assets index: <https://kenney.nl/assets>
- Kenney CC0 declaration: <https://kenney.nl/info>
