# Round-6 Showroom Spec — Plan Review

> **Reviewer:** Review Architect (read-only assessment).
> **Spec under review:** [`round-6-showroom-spec.md`](./round-6-showroom-spec.md)
> **Decision Record source:** D1–D8 (Outcome🧭Steward).
> **Verdict at the foot.** No code modified.

---

## Review Summary

- **Overall: CHANGES_REQUESTED.** Architecture is sound and faithful
  to the north star + §10 curator-diagnostic framing. Two material
  defects in the spec must be addressed before WP-A implement begins,
  plus a handful of clarifications. The defects are concrete and
  small; they are not a rethink, just a contract tightening so the
  engineer doesn't reproduce a spec-seeded bug.

- **What is solid:**
  - Factory extraction into `EquipmentMeshAttachment.instantiate_persona_character`
    is the right pillar-6 call. Code-trace confirms only one site in
    EntityRenderer (`_instance_or_capsule` at line 673) currently
    applies `CHARACTER_MODEL_SCALE`, so the substrate consolidation is
    clean and replay-path regression risk is structurally low.
  - Deterministic AABB-median calibration with `[0.4, 3.0]` clamp +
    ±15% post-scale band is a defensible numerical substitute for the
    user's visual judgement — and stays well inside the
    blind-assignment hard constraint.
  - Fallback chains for new clip kinds (`attack_armed → attack →
    generic`, `take_hit → generic → idle`, `death → take_hit →
    generic → idle`) honor the Round-5 manifest-driven contract
    additively; verify-character-rigs.gd already enforces clip-resolve
    only when manifest declares the key.
  - Per-character `ClipLabel` surfacing fallback resolutions IS the
    curator-diagnostic signal §10 calls for. Strong call.
  - Gore-exclusion from Take hit / Death is the right read of the
    user's verbatim ask and protects the asset/anim curation focus.
  - Scope boundary held: nothing in the spec sneaks Convex/HTTP/
    snapshot-schema work or new character packs.

- **What is risky or unclear:**
  1. **Synthetic-map dimensions are wrong** in the spec example —
     proposed `{w:14, h:8}` floor (5.32 × 3.04 world units) is
     narrower than the proposed character row (11.2 units wide). The
     engineer will reproduce the spec example and find characters
     standing on empty air outside the floor patch. **(High.)**
  2. **Death-clip "force loop-off at play time only" is not
     achievable as specified.** `animation.loop_mode = ANIMATION_LOOP_NONE`
     mutates the cached Animation resource — that *is* the cached
     AnimationLibrary. The spec contradicts itself in §3.2.2 by
     advocating a play-time-only override that the proposed mechanism
     can't deliver. Real options (animation_finished + pause; clone
     resource; explicit seek) all viable but spec must pick one or
     punt to engineer explicitly. **(High.)**
  3. Factory extraction has a constraint the spec under-specifies:
     `CHARACTER_MODEL_SCALE := 0.21` constant declaration must remain
     in `EntityRenderer.gd` to keep `verify-scaffold.mjs:209`
     passing, even if the multiplication site moves to
     `EquipmentMeshAttachment`. Engineer may not realise the
     declaration-vs-application split is load-bearing. **(Medium.)**
  4. AABB measurement timing/pose is not specified — bind pose vs.
     animated frame vs. first-idle-frame produce different AABBs and
     the methodology must lock one for comparability. **(Medium.)**
  5. Tier→manifest-asset mapping in §3.2.5 picks by name; manifest
     already carries numeric `tier` per weapon/armour. Engineer should
     filter by manifest `tier` field, not hardcode names. **(Medium.)**

---

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|----------|------|-------------|----------|----------------|
| **High** | WP-B / sample environment | Synthetic-map dims `{w:14, h:8}` produce a 5.32×3.04 world-unit floor (`SceneBuilder.WORLD_SCALE = 0.38`). Spec lays 8 personas in a row at `i*1.6 - 5.6` spanning ±5.6 (11.2 units wide). Characters will float beyond the floor patch on both sides; cover/wall placement will also be off. Spec example will not work as written. | `SceneBuilder.gd:3` `WORLD_SCALE := 0.38`; spec §3.2.1 step 4 (`i * 1.6 - 5.6`); spec §3.2.4 (`"size": {"w": 14, "h": 8}`). | Pick one: (a) widen synthetic map to `{w:32, h:12}` (floor 12.16×4.56 — comfortably > 11.2-unit row); (b) derive row positions via `scene_builder.tile_to_world({"x": 4+i*3, "y": 6})` so they share the projection; (c) compress spacing to ~0.66 units to fit the narrow map (poor — characters cluster too tight for the §10 side-by-side intent). Recommend **(a)** — widest readable spread is the curator's whole point. |
| **High** | WP-B / death animation | §3.2.2 says "force-overrides `animation.loop_mode = ANIMATION_LOOP_NONE` before playing … only at play time, not by mutating the cached AnimationLibrary." But `animation.loop_mode` *is* a property of the cached Animation resource — there is no play-time-only loop-mode override in Godot 4. Either the mutation IS shared with the replay path (which the spec specifically says it shouldn't be), or the proposed mechanism is non-functional. | Spec §3.2.2 "Edge — Death pose hold" paragraph; Godot 4 `Animation.loop_mode` is resource-level. Note also Q4 in §7 hand-waves this. | Pick one of: (a) `player.animation_finished.connect(func(_n): if _n == death_clip: player.pause())` — clean, no resource mutation, survives replay-path coexistence; (b) duplicate the Animation resource once at Showroom startup, mutate the copy's `loop_mode`, register under a Showroom-only name; (c) `player.play(); await player.animation_finished; player.seek(player.current_animation_length, true); player.pause()`. Recommend **(a)** — minimal moving parts. Update §3.2.2 + §7 Q4 with the chosen mechanism. |
| **Med** | WP-A / factory extraction | If the engineer moves `CHARACTER_MODEL_SCALE` multiplication into `EquipmentMeshAttachment.instantiate_persona_character`, they may also remove the constant declaration from `EntityRenderer.gd`. That would break `verify-scaffold.mjs:209` (`/CHARACTER_MODEL_SCALE\s*:=\s*0\.21/` lock). Spec §3.1.4 only says "base constant stays unchanged" — not "stays declared in EntityRenderer.gd." | `verify-scaffold.mjs:209`; spec §3.1.4 + §3.1.6. | Tighten §3.1.6 to: "The `CHARACTER_MODEL_SCALE := 0.21` declaration MUST remain in `EntityRenderer.gd` (Round-5 scaffold lock). The factory in `EquipmentMeshAttachment` reads it via `const CHARACTER_MODEL_SCALE = preload(\"res://src/EntityRenderer.gd\").CHARACTER_MODEL_SCALE` or via a `get_character_model_scale()` accessor exposed by EntityRenderer." Either is fine; pick one and call it out so the engineer doesn't free-form. |
| **Med** | WP-A / calibration methodology | AABB of an instantiated PackedScene depends on **which pose the rig sits in at instantiation**: bind/T-pose, first idle keyframe, or paused at frame-0. Different choices yield different `source_height`. Spec §3.1.4 walks "MeshInstance3D descendants" but never specifies whether to `AnimationPlayer.stop()` first, advance one frame, or take the static bind-pose AABB. Reviewers cannot reproduce the engineer's numbers without this. | Spec §3.1.4 step 1–3. | Lock the methodology: "Instantiate the PackedScene, do NOT call any AnimationPlayer methods, walk `MeshInstance3D` descendants and merge `mesh_instance.get_aabb()` transformed by `mesh_instance.global_transform` (against an unscaled instance — Y axis of the world-space AABB is the comparable apparent-height metric)." Engineer commits the script so reviewers can re-run on a future pack swap. |
| **Med** | WP-B / tier→asset mapping | §3.2.5 suggests `rusty_blade/sword/greatsword` by name for weapon Low/Mid/High. But the manifest already carries `asset.tier: number` (verify-scaffold:414 + :417 asserts type=number). Hardcoding names couples the showroom to manifest naming and silently breaks if the engineer renames or re-tiers an asset. | Spec §3.2.5 table + Q3; `verify-scaffold.mjs:414` + `:417`. | Change §3.2.5 to: "Build the tier→asset map at Showroom startup by filtering `weapon_assets_by_name` / `armour_assets_by_name` by `asset.tier`. Pick a representative per tier (engineer picks deterministically — e.g. lowest sha256 prefix or first-in-manifest-order — and documents the choice in IMPLEMENTATION-SUMMARY)." This makes the selectors substrate-driven, not name-driven. |
| **Med** | WP-B / private-state accessor coherence | §3.2.6 example code reads `equipment_attachment.registered_characters.get(showroom_id, {})` directly, then the very next paragraph says "rather than letting the Showroom poke private state directly." Example and prescription contradict. Engineer copying the example reproduces the substrate smell. | Spec §3.2.6 example block vs. closing paragraph. | Replace the example `_process` block with the accessor call: `var state := equipment_attachment.animation_state_for_character(showroom_id); clip_label.text = _clip_label_text(showroom_id, state.clipName, state.isFallback)`. Keep the prescription paragraph; drop the contradiction. |
| **Low** | WP-B / CameraRig button noise | `CameraRig._make_controls()` adds a `CanvasLayer` with Director / `[` / `]` buttons at hardcoded position (16, 88). These will render in the Showroom and overlap with the new UI bar. Spec §3.2.7 says they're no-ops with empty characters but doesn't mention they're *visible*. | `CameraRig.gd:195-214`; spec §3.2.7. | Either (a) accept as benign visual noise (engineer doesn't touch CameraRig — preserves cleanest substrate), or (b) add an optional `set_controls_visible(bool)` method on CameraRig and call `camera_rig.set_controls_visible(false)` from Showroom. Recommend (a) for round 6 (minimal CameraRig diff); revisit if user flags it as clutter. |
| **Low** | WP-A / paranoid weapon attachment under multiplier | Opportunist uses `attachBone-fallback:handOffset` (Quaternius mech, no hand bone) → `_ensure_weapon_socket` returns a `Node3D` parented to the character ROOT at offset `(0.15, 0.31, -0.10)`, NOT inside the scaled `visual`. When opportunist gets a scale multiplier ≠ 1.0, the weapon will sit at the same root-space offset while the body grows/shrinks — misalignment. **This was already true pre-Round-6** for any character whose visual scale could change; Round-6 only makes it visible. | `EquipmentMeshAttachment.gd:280-295` (`_ensure_weapon_socket` fallback path); manifest line 182 (opportunist `attachBone-fallback:handOffset`). | Document as a known curator-diagnostic signal: "Personas using handOffset-fallback weapon sockets will show weapon-body misalignment under scale multipliers ≠ 1.0. This is expected and a signal that the source pack lacks a hand bone — pack-swap territory, not Round-6 scope." Add to §3.3 out-of-scope and §3.1.5 verification notes. Opportunist's multiplier is likely to stay near 1.0 anyway. |
| **Low** | WP-B / Showroom forbidden-token grep coverage | §WP-B.11 scaffold-verify list mentions forbidden-token grep on `src/Showroom.gd` but the existing `verify-scaffold.mjs:452-465` only sweeps a fixed list of code files (EntityRenderer, CombatVfx, EquipmentMeshAttachment, CameraRig, MatchPlayer, IMPLEMENTATION-SUMMARY). Adding Showroom.gd requires a code change in verify-scaffold.mjs, not just a "Showroom.gd appears in requiredFiles" assertion. Spec implies but doesn't make this explicit. | Spec §WP-B.11 + `verify-scaffold.mjs:452-465`. | Spell it out in §WP-B.11: "Add `src/Showroom.gd` and `scenes/Showroom.tscn` to the forbidden-token sweep loop in verify-scaffold.mjs:452." (One-line code edit, but the spec must call it out.) |
| **Low** | WP-A / ±15% post-scale band assertion implementation | §3.1.5 + §WP-A.6 say "scaffold-verify asserts that … the product aabb_source_height_y * modelScaleMultiplier is within ±15% of the median across all 8 personas." But verify-scaffold.mjs is Node.js — it can't compute AABBs. The only way is to (a) run the audit script under headless Godot during verify-scaffold and parse its output, or (b) the audit script writes a JSON sidecar at commit time and verify-scaffold reads it. Spec mentions (a) at §3.1.5 last bullet but doesn't pick. | Spec §3.1.5 final paragraph + §3.1.6 "Optional" bullet. | Pick **(b)** — audit script writes `audit-character-scales.json` alongside the script, committed; verify-scaffold reads it and asserts ±15% band against the committed manifest multipliers. Reasons: (a) requires GODOT_BIN at every CI run (already optional); (b) keeps verify-scaffold purely Node.js, fast, deterministic, and the sidecar JSON is itself a reviewable artifact when a multiplier changes. |
| **Low** | WP-A / manifest schemaVersion bump | Q1 recommends 3→4. Verify-scaffold.mjs:348 hard-asserts `schemaVersion === 3`. `MatchPlayer.gd:73` hard-asserts the *replay snapshot* `schemaVersion === 3` — these are SEPARATE versions (manifest schemaVersion vs. snapshot schemaVersion). Bumping manifest does NOT bump snapshot, so MatchPlayer is unaffected. Spec is correct but the distinction is subtle — worth a note so the engineer doesn't accidentally chase the snapshot constant. | `verify-scaffold.mjs:348` (manifest); `MatchPlayer.gd:71-78` (snapshot — distinct). | Add to §3.1.6: "Manifest schemaVersion bump is local to the art kit (`verify-scaffold.mjs:348`). It is NOT the replay snapshot schemaVersion (`MatchPlayer.gd:73`) — those are independent. Do not touch the snapshot version." |

---

## Spec / Guide Deviations

- **North-star alignment: PASS.** Showroom is correctly framed as
  curator-diagnostic, not player-facing. Mental-model §10's
  "Breadth needs a dedicated viewing surface" bullet is honored
  end-to-end.
- **§13 honest substrate: PASS.** Per-asset multiplier on manifest
  is the substrate fix; uniform-scale-with-prompt-teaching
  alternative correctly rejected.
- **Pillar-6 (single source of truth): PASS** assuming factory
  extraction is taken (D2). Pass-through-persona is documented as
  acceptable fallback; either honors the principle.
- **§10 "diagnostics target building agents first": PASS.** ClipLabel
  fallback-tag is exactly the building-agent ergonomic.
- **Blind-assignment (D4 discipline): PASS.** AABB-median calibration
  is deterministic and headless; no browsertools/chromium/screenshot
  surface anywhere in the spec.
- **POC posture (D3 schema wipe acceptable): PASS.** Manifest
  schemaVersion bump 3→4 ratified by Q1.
- **§13 sourced-not-modeled: PASS.** No new asset authoring; reuses
  Round-5 packs.

No deviations from north star or guides. The high-severity issues
above are *contract-tightening* issues — the spec's *intent*
matches the guides; its *example code* contradicts the intent and
must be reconciled.

---

## Decision Notes

The 8 open questions in §7, with reviewer recommendations:

| Q | Question | Spec recommendation | Reviewer decision |
|---|---|---|---|
| Q1 | Bump manifest schemaVersion 3→4? | Yes (POC posture, signal-of-change) | **Ratify YES.** Add the note from "Low" issue above clarifying this is manifest version, not snapshot version. |
| Q2 | Factory extraction vs pass-persona-through? | Factory (single source of truth, pillar 6) | **Ratify FACTORY.** Tighten §3.1.6 with the constant-stays-in-EntityRenderer constraint (Med issue above). |
| Q3 | Tier→asset mapping by name? | Engineer picks names | **Amend.** Map by manifest `asset.tier` field, not by name (Med issue above). |
| Q4 | Death-clip loop override safety in replay? | Hand-waved — "engineer verifies headless" | **Amend.** Spec mechanism (`animation.loop_mode = ANIMATION_LOOP_NONE` at play time only) is not achievable in Godot 4. Switch to `animation_finished` + `player.pause()` (High issue above). |
| Q5 | Row vs grid? | Row (1.6-unit spacing) | **Ratify ROW** with the synthetic-map dimension fix (High issue above). |
| Q6 | Gore on Take hit / Death? | No (curation surface, not gore eval; matches user's verbatim ask) | **Ratify NO.** Decision is well-reasoned and matches user feedback. |
| Q7 | Spacing tied to multipliers? | Fixed (anomalous widths = curator signal) | **Ratify FIXED.** Acceptable given `[0.4, 3.0]` clamp. |
| Q8 | Keyboard shortcuts? | Optional polish | **Defer to engineer.** No reviewer concern either way. |

---

## Required Spec Amendments Before WP-A Implement

In priority order:

1. **§3.2.1 step 4 + §3.2.4** — Fix the synthetic-map dimensions /
   row-layout math so characters stand on the floor patch. Pick
   `{w:32, h:12}` or compute positions via `tile_to_world`. (High #1.)
2. **§3.2.2 "Edge — Death pose hold" + §7 Q4** — Replace the
   loop_mode-mutation mechanism with `animation_finished` →
   `player.pause()`. (High #2.)
3. **§3.1.6** — Add explicit constraint: `CHARACTER_MODEL_SCALE`
   constant declaration stays in `EntityRenderer.gd`; factory in
   `EquipmentMeshAttachment` reads it via the chosen accessor.
   (Med #3.)
4. **§3.1.4** — Lock the AABB measurement methodology (bind-pose,
   no AnimationPlayer.play, world-space AABB from
   `mesh_instance.global_transform * mesh_instance.get_aabb()`).
   (Med #4.)
5. **§3.2.5** — Map tier→asset by manifest `asset.tier` field, not
   by name. (Med #5.)
6. **§3.2.6** — Update the `_process` example to use
   `animation_state_for_character` accessor; drop the
   private-state poke. (Med #6.)
7. **§3.1.5 + §WP-A.6** — Pick implementation for the ±15% band
   check: audit script writes `audit-character-scales.json` sidecar;
   verify-scaffold reads it (no GODOT_BIN dependency at verify
   time). (Low.)
8. **§3.1.6 / §WP-B.11** — Add note distinguishing manifest
   schemaVersion (this round) from snapshot schemaVersion
   (untouched); add forbidden-token grep extension to cover
   `src/Showroom.gd`. (Low.)
9. **§3.3 + §3.1.5** — Document that handOffset-fallback weapon
   sockets (opportunist Quaternius mech) will show weapon-body
   misalignment under non-1.0 multipliers; known signal, not a
   regression. (Low.)

---

## Verdict

**CHANGES_REQUESTED** — amend spec items (1)–(6) at minimum before
dispatching WP-A. Items (7)–(9) are nice-to-have but small enough
the engineer can resolve them inline during implementation.

Architecture, scope, and substrate decisions are all sound; the
spec is one ratification pass away from being implementable.
