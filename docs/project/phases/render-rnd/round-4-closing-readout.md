# Round-4 Closing Readout — Spectacle-Grade Full-Match Godot/WASM Replay

Round 4 of the render R&D. Substrate ratified in Round 2 (Godot/WASM), full-match playback proven in Round 3. This round extended the snapshot contract with engine-truth event streams (movements/attacks/loots, schemaVersion 2 → 3) and drove a spectacle polish pass on the d-full-match Godot prototype: 8 visually-distinct character models from 4 source lanes, weapon/armour mesh-on-equip, maximalist gore VFX, attack + loot + wall face-slam animations, scale/camera/ground tuning, and environment material polish. Commits `7777026` (WP1 contract) + `d480811` (WP2-4 renderer) + `599ddeb` (completion-review refinement).

Spec: [`round-4-spectacle-spec.md`](./round-4-spectacle-spec.md). Blind-UAT handoff: [`IMPLEMENTATION-SUMMARY.md`](../../../throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md).

---

## 1. What Was Built

Two layers, same throwaway-boundary posture as Round 3:

| Layer | Throwaway? | Location | Purpose |
|---|---|---|---|
| **Snapshot contract extension** (3 event streams + engine waypoints + bodyCollision attribution fix) | **No — escapes throwaway** | `convex/replay/`, `convex/engine/`, `convex/schema.ts`, `tests/` | Engine-truth event streams for any renderer. schemaVersion 3. |
| **Spectacle renderer polish + asset R&D + combat VFX** | **Yes — throwaway** | `throwaway-prototypes/d-full-match/` | Felt-experience probe: waypoint-correct movement, 8 persona models, equipment mesh-on-equip, gore VFX, environment polish. |

### 1a. WP1 — Snapshot Contract Extension (escapes throwaway, commit `7777026`)

**New event streams on `MatchSnapshotJson` (schemaVersion 3):**

| Stream | Shape | Source |
|---|---|---|
| `movements[]` | `{ turn, characterId, fromTile, toTile, path: Tile[], blockedBy?, wallRectId?, bodyCollisionKind? }` | `resolution.moves[]` — engine-emitted waypoint path per substep |
| `attacks[]` | `{ turn, attackerId, targetId, weapon, kind, hit, lethal }` | `resolution.actions[]` (attack/overwatch/counter) + `resolution.moves[]` (bodyCollision pairs, deduplicated by pair-key) |
| `loots[]` | `{ turn, characterId, source, sourceId, item, equipped }` | `resolution.actions[]` where `kind === "loot"` and `result ∈ {"opened","looted"}` |

**Engine plumbing:**
- `MoveTraceEntry.path: Tile[]` captured via seed-then-append in `simulateMovement` (commit adds `pathByMover` init before substep loop, per-substep push inside planned-commit branch).
- `ResolutionTrace.moves[].path` mirrors the engine field. `resolutionValidator` in `convex/schema.ts` carries the non-optional `path` array (forward-only POC posture).
- Both persistence adapters (`convex/runMatch.ts` `adaptResolutionForSchema` + `convex/_internal_runMatch.ts` mirror) forward `path` through to persisted resolutions.

**bodyCollision lethal attribution fix (D14):**
- New `collectDamageCandidates(turn)` helper in `convex/engine/killAttribution.ts` unifies `actions[]`-derived damage rows with bodyCollision-derived rows from `moves[]`.
- Deterministic mover-attribution rule: charger is the killer. Defender→mover damage carries `lethal: true` only in mutual-death (both at 1 HP).
- Fixes the latent "Unknown killed X" bug in `buildKillFeed` for bodyCollision duel deaths.

**Pair-key dedupe:** bodyCollision `attacks[]` events are deduplicated per `[mover, defender].sort().join("|")` pair key, matching the engine's dedup in `resolution.ts:330-352`. A bilateral charge (two `moves[]` entries) produces exactly 2 `attacks[]` events, not 4.

**POC schema wipe:** Convex dev data was wiped via `npx convex dev --once` because historical `turns.resolution.moves[]` rows pre-dated the required `path` field. Acceptable per POC posture (D11).

**Files modified (14):**

| File | Change |
|---|---|
| `convex/replay/snapshotTypes.ts` | `schemaVersion: 3` + 3 new event stream types |
| `convex/replay/snapshot.ts` | Builder mines movements/attacks/loots with pair-key dedupe + `findCrateById` source lookup |
| `convex/engine/movement.ts` | `MoveTraceEntry.path` via `pathByMover` seed-then-append |
| `convex/engine/resolution.ts` | `ResolutionTrace.moves[].path` mirrors engine field |
| `convex/engine/killAttribution.ts` | `collectDamageCandidates` unifies actions + bodyCollision damage |
| `convex/schema.ts` | `resolutionValidator.moves[].path` non-optional |
| `convex/runMatch.ts` | `adaptResolutionForSchema` forwards `path` |
| `convex/_internal_runMatch.ts` | Mirror adapter forwards `path` |
| `docs/project/guides/convex-backend.md` | §2a updated for v3 streams |
| `tests/convex/replaySnapshot.test.ts` | 832+ lines added; full edge-case matrix |
| `tests/convex/http.test.ts` | schemaVersion 3 assertion |
| `tests/engine/movement.test.ts` | Path emission unit tests (wall-slide, wall-bonk, charge) |
| `tests/engine/resolution.test.ts` | Trace-shape verification |
| `tests/integration/persistAdaptParity.test.ts` | New: adapter round-trip parity for `path` |

### 1b. WP2 — Renderer Polish (throwaway, commit `d480811`)

- **Character scale halved:** `CHARACTER_MODEL_SCALE := 0.21` (from ~0.42). `CRATE_MODEL_SCALE := 0.17` proportional.
- **Ground level:** per-model `pivotYOffset` from `manifest.json` applied at instance time. Quaternius mech uses `-0.05`; Kenney, Robin Lamb, and local primitive models use `0` offset (centred pivots).
- **Facing direction:** `EntityRenderer` computes heading from the active `movements[]` path segment. `last_heading_by_character` preserves facing when stationary. Decorative sine rotation removed.
- **Waypoint animation:** `EntityRenderer._tile_along_path` interpolates along the engine's waypoint `path[]` using fractional turn progress. No straight-line through-wall lerp. No pathing logic in renderer.
- **Wall-clip padding:** `SceneBuilder.cosmetic_wall_inset` provides a render-only positional offset for characters adjacent to walls. Engine positions unchanged.
- **Camera:** anchored cam default radius `14.0` (from `26.0`); max anchored zoom-out `32.0` (from `62.0`). Director cam preserved at `26.0` radius / `62.0` max zoom.
- **Schema guard:** `MatchPlayer` rejects non-v3 snapshots before scene configuration, so stale cached v2 payloads fail loudly.
- **Environment polish:** the five manifest PNG textures are wired into two renderer layers: `SceneBuilder._make_materials` applies them to map-level geometry (floor, walls, cover, evac, and the airdrop marker), and `EntityRenderer` separately loads `crate-neon-wear.png` for runtime crate and airdrop entity materials (closed crates + airdrop crates). Texture files: `wall-dark-metal.png`, `floor-neon-dungeon.png`, `cover-hazard-rust.png`, `crate-neon-wear.png`, `evac-crimson-glyph.png`. Procedural `NoiseTexture2D` remains as a fallback path. Lighting baseline (WorldEnvironment + neon-key-light + crimson-rim-light) preserved per scaffold-verify.

### 1c. WP3 — Asset R&D (throwaway, commit `d480811`)

**8 character models from 4 source lanes:**

| Persona | Model | Source | License | Implementer Rationale |
|---|---|---|---|---|
| rat | `rat-kenney-blocky-a.glb` | Kenney Blocky Characters 2.0 (OpenGameArt) | CC0-1.0 | Small blocky scavenger silhouette; reads scrappy rather than heroic |
| duelist | `duelist-robin-lamb-hero.glb` | Robin Lamb Animated Low Poly Hero (OpenGameArt) | CC0-1.0 | Sword-and-shield humanoid gives a clear combat silhouette distinct from blocky set |
| trader | `trader-local-neon-broker.glb` | context-battler local primitive humanoid | CC0-1.0 | Mask, sash, and cyan chest glow move trader out of the Kenney lane toward a cyberpunk broker silhouette |
| opportunist | `opportunist-quaternius-space-mech.glb` | Quaternius Ultimate Space Kit (OpenGameArt) | CC0-1.0 | Non-astronaut Quaternius mech replaces the rejected astronaut baseline; bulky machine limbs read as scavenged cyberpunk muscle |
| paranoid | `paranoid-kenney-blocky-r.glb` | Kenney Blocky Characters 2.0 | CC0-1.0 | High-contrast variant pops when circling walls and cover |
| camper | `camper-kenney-blocky-n.glb` | Kenney Blocky Characters 2.0 | CC0-1.0 | Muted variant; intentionally quieter than duelist and sprinter |
| sprinter | `sprinter-local-crimson-stalker.glb` | context-battler local primitive humanoid | CC0-1.0 | Long limbs, violet visor, and claw blocks favor motion readability and the darker cyberpunk × Diablo brief |
| vulture | `vulture-kenney-blocky-q.glb` | Kenney Blocky Characters 2.0 | CC0-1.0 | Sharper dark variant; distinct scavenger profile from rat |

Source lanes: **Kenney** (4 character models, CC0), **Robin Lamb** (1 character + sword + shield, CC0), **Quaternius** (1 character + environment props, CC0), and **context-battler local primitive humanoids** (2 character models, CC0). The rejected astronaut persona slot has been removed from the manifest mapping; the replaced trader/sprinter Kenney slot files were pruned from the character art-kit.

**Weapon mesh library (6 weapons):**

| WeaponName | File | Tier/DPS | Source |
|---|---|---|---|
| rusty_blade | `rusty-blade-prototype.glb` | 1/low | Generated CC0 primitive |
| dagger | `dagger-prototype.glb` | 1/low | Generated CC0 primitive |
| sword | `sword-robin-lamb-hero.glb` | 2/mid | Robin Lamb Hero pack (CC0) |
| axe | `axe-prototype.glb` | 2/mid | Generated CC0 primitive |
| greatsword | `greatsword-prototype.glb` | 3/high | Generated CC0 primitive |
| warhammer | `warhammer-prototype.glb` | 3/high | Generated CC0 primitive |

**Armour visual variation (5 armour names, 3 visual tiers):**

| Armour | File | Visual Tier | Source |
|---|---|---|---|
| cloth | `cloth-wrap-prototype.glb` | low | Generated CC0 primitive |
| leather | `leather-vest-prototype.glb` | low | Generated CC0 primitive |
| chain | `chain-mail-prototype.glb` | mid | Generated CC0 primitive |
| plate | `plate-harness-prototype.glb` | high | Generated CC0 primitive |
| riot_plate | `riot-plate-robin-lamb-shield.glb` | high | Robin Lamb Hero pack (CC0) |

**Corpse:** `prone-humanoid-prototype.glb` — project-created prone low-poly body replaces the prior flat blob. Gore is left to WP4 VFX.

**Environment props:** Quaternius cover (`cover-quaternius-base-large.glb`), crate (`crate-quaternius-pickup.glb`), evac building (`evac-quaternius-building-l.glb`), plus 5 wired texture assets for floor/wall/cover/crate/evac materials.

**Manifest:** `throwaway-prototypes/d-full-match/shared-harness/art-kit/manifest.json` (schemaVersion 2, per-asset shape). Asset entries carry per-asset `source`, `license`, `sizeBytes`, `sha256`, `notes`, `extraction`. The existing `shared-harness/art-kit/manifest.json` (single-vendor, round-1/2/3) is untouched (D9).

### 1d. WP4 — Combat VFX + Animation (throwaway, commit `d480811`)

**Attack animation:**
- `EntityRenderer.play_attack_pose(attacker_id, target_pos, weapon, hit, lethal)` — oriented attacker → target.
- Weapon-class differentiation via animation flavour (melee swing vs ranged; all weapons are range 2 per engine).
- Impact pose on `hit: true`, recovery/miss on `hit: false`.
- Lethal attacks chain into death via `mark_lethal_target` (corpse mesh swap).

**Gore VFX inventory (maximalist — what landed):**

| Beat | Implementation | Technical Notes |
|---|---|---|
| Blood splash on hit | `_spawn_burst` — up to 96 mesh-instance particles, dark-red → transparent, gravity-biased, ~1s lifetime | Pooled lightweight `SphereMesh` particles, not GPUParticles3D (WebGL2 Compatibility renderer constraint) |
| Blood spray on miss | Same `_spawn_burst`, narrower cone, 44 particles, lighter colour | Miss spray fires on every `hit: false` attack event |
| Persistent blood pools | `CylinderMesh` decal quads at floor level, ring-buffered at 64 max, no decay | Pools accumulate for the rest of the match; ring-buffer evicts oldest when cap hit |
| Dismemberment on lethal | `_spawn_dismemberment` — 5 `BoxMesh` chunks with impulse + gravity + spin, ~1.8s lifetime | Reads as body-disintegration rather than per-limb authored breakage (see technical ceilings) |
| Screen-shake / camera punch | `CameraRig.screen_punch(direction, magnitude)` — direction + magnitude scaled by damage/weapon tier; lethal = 0.105, heavy weapon = 0.075, bodyCollision = 0.065, standard = 0.045 | Damped via `punch_velocity` decay |
| Environmental death red mist | Preserved from round 3 — `_trigger_mist` still wired to `killFeed[kind=="environmental"]` | Telefrag beat unchanged |

**Wall face-slam beat:**
- Fires on every `movements[]` entry with `blockedBy: "wall"`.
- Uses the engine-emitted `wallRectId` to resolve the wall rect and projects the impact to the midpoint of the rect edge facing `fromTile`; missing or unresolved `wallRectId` falls back to the old `fromTile` placement.
- Dust-puff burst (38 particles, warm-brown material), camera nudge (magnitude 0.035 — half normal), `EntityRenderer.play_wall_slam` animation hook.
- Reads as the comedic shareable moment per mental-model §12.

**Loot animation:**
- Pickup flourish: 36 cyan particles + torus ring at looting character position (~0.42s).
- Source visual updates: `EntityRenderer.mark_loot_source(source, sourceId)` signals crate empty/fade, corpse drained, airdrop emptied.
- Equipment swap timing: `EquipmentMeshAttachment.play_loot_swap` visually swaps weapon/armour mesh at the bone/socket when `equippedByCharacter` changes.

**Equipment mesh-on-equip:**
- `EquipmentMeshAttachment.gd` (329 lines) — reads `manifest.json` at configure time; maps `weaponName` → weapon mesh + `handOffset`, `armourName` → armour mesh + `attachBone`.
- `register_character(character_id, persona_slot)` + `update_equipment(character_id, equipped_slots)` per frame.
- Tier-tinted material variation: weapon/armour meshes carry tier-driven emission colour ramp (low = muted, mid = cyan accent, high = crimson glow) so tier is readable at a glance.
- Socket attachment is deterministic offset-based because R&D models lack a shared humanoid bone map. Manifest records `attachBone` metadata, but runtime falls back to stable hand/spine offsets.

**New GDScript files (WP2-4):**

| File | Lines | Role |
|---|---|---|
| `src/CombatVfx.gd` | 441 | Attack/loot/wall-slam VFX consumer; blood splash, pools, dismemberment, screen-shake |
| `src/EquipmentMeshAttachment.gd` | 329 | Manifest-driven weapon/armour mesh attachment + swap |
| `src/EntityRenderer.gd` | +518 lines | Waypoint animator, facing direction, persona model loader, attack/loot/death hooks |
| `src/CameraRig.gd` | +59 lines | Anchored zoom tightening, max zoom cap, screen-punch support |
| `src/SceneBuilder.gd` | +70 lines | Environment textures, cosmetic wall inset, material polish |

---

## 2. What Escapes Throwaway vs. What Is Throwaway

### Escapes throwaway (production code)

| Artifact | Path | Role |
|---|---|---|
| Snapshot contract types (schemaVersion 3) | `convex/replay/snapshotTypes.ts` | `MatchSnapshotJson` + 3 new event stream types |
| Snapshot builder (event mining) | `convex/replay/snapshot.ts` | Mines movements/attacks/loots from `bundle.turns[]` |
| Engine waypoint capture | `convex/engine/movement.ts` | `MoveTraceEntry.path` via `pathByMover` |
| Engine resolution trace | `convex/engine/resolution.ts` | `ResolutionTrace.moves[].path` |
| Kill attribution (bodyCollision fix) | `convex/engine/killAttribution.ts` | `collectDamageCandidates` unified helper |
| Schema validator | `convex/schema.ts` | `resolutionValidator.moves[].path` |
| Persistence adapters | `convex/runMatch.ts`, `convex/_internal_runMatch.ts` | Forward `path` through both adapters |
| Backend guide | `docs/project/guides/convex-backend.md` | §2a documents v3 event streams |
| Unit tests (full matrix) | `tests/convex/replaySnapshot.test.ts` + 3 other test files | 832+ lines of edge-case coverage |

### Throwaway (R&D only, will be deleted)

| Artifact | Path |
|---|---|
| Entire Godot prototype | `throwaway-prototypes/d-full-match/` |

The prototype has zero imports from production code. It consumes the contract via HTTP only. Deleting the `d-full-match/` directory has zero production impact.

---

## 3. New Event Streams — Verification via `/replay/exportMatch`

After generating a fresh match against the schemaVersion 3 deployment:

```bash
set -a; source .env; set +a
CONVEX_HTTP_URL="${CONVEX_URL/.cloud/.site}"

# Verify schemaVersion 3:
MATCH_ID=$(curl -sS "$CONVEX_HTTP_URL/replay/listMatches" | jq -r '.[0].matchId')
curl -sS "$CONVEX_HTTP_URL/replay/exportMatch?matchId=$MATCH_ID" | jq '.schemaVersion'
# → 3

# Inspect movements (wall-slide paths have length > 2):
curl -sS "$CONVEX_HTTP_URL/replay/exportMatch?matchId=$MATCH_ID" | \
  jq '[.movements[] | select(.path | length > 2)] | length'

# Inspect attacks (bodyCollision pairs):
curl -sS "$CONVEX_HTTP_URL/replay/exportMatch?matchId=$MATCH_ID" | \
  jq '[.attacks[] | select(.kind == "bodyCollision")] | length'

# Inspect lethal attacks:
curl -sS "$CONVEX_HTTP_URL/replay/exportMatch?matchId=$MATCH_ID" | \
  jq '[.attacks[] | select(.lethal)] | length'

# Inspect loots by source:
curl -sS "$CONVEX_HTTP_URL/replay/exportMatch?matchId=$MATCH_ID" | \
  jq '[.loots[] | .source] | group_by(.) | map({(.[0]): length}) | add'
```

---

## 4. Architectural Principles — Confirmation

| Principle | §13 Codification | Code Evidence |
|---|---|---|
| **Renderer reads engine-emitted truth; never duplicates engine logic** | Ratified commit `5877c34` | `EntityRenderer._tile_along_path` consumes `movements[].path` verbatim. Scaffold-verify forbidden-token grep (`a_star`, `astar`, `find_path`, `bresenham`, `dijkstra`, `breadth_first_search`, `manual_collision`) passes clean across all `.gd` files. |
| **Spectacle events bump schema** | Ratified commit `5877c34` | `schemaVersion: 3` in `snapshotTypes.ts`. Forward-only, no back-compat shim. |
| **Gore intensity is loud by design** | Ratified commit `5877c34` | `CombatVfx.gd`: 96-particle blood splash, 5-chunk dismemberment, 64-pool persistent blood, screen-shake on every hit, wall face-slam dust burst. Implementer licensed to be operatic — ceiling is WebGL2 budget, not taste. |
| **Render = ground truth, full stop** | §13 (round 3) | No fog, LOS, perception, or ghost code in the renderer. Scaffold-verify confirms banned tokens absent. |
| **Slick is pipeline** | §13 (round 3) | Environment polish via wired PNG material textures, procedural `NoiseTexture2D` fallback, and lighting/postprocess. No hand-modeled bespoke art. |
| **Match-data contract escapes throwaway** | §13 (round 3) | WP1 committed separately (`7777026`) from throwaway WP2-4 (`d480811`). |

---

## 5. Technical Ceilings and Implementer Judgment Calls

The user should evaluate these during visual UAT:

1. **Mesh particles instead of GPUParticles3D.** The Godot Compatibility/WebGL2 renderer constrains particle systems. The implementer chose lightweight `MeshInstance3D` particles (pooled `SphereMesh` bursts, `BoxMesh` dismemberment chunks) over `GPUParticles3D`. This keeps the web export budgeted but means gore reads as body-disintegration rather than per-limb authored breakage.

2. **Socket attachment is offset-based.** R&D character models from 3 different sources do not share a reliable humanoid bone map. Weapon/armour meshes attach via deterministic `handOffset` (from `manifest.json`) rather than runtime bone lookup. Manifest records `attachBone` metadata for future upgrade if a rigging pass standardises the bone map.

3. **Two persona models are local primitive humanoids.** The completion-review refinement moved trader and sprinter out of the Kenney lane and replaced the opportunist astronaut with a Quaternius mech. End state is 4 source lanes with 4/8 Kenney slots. The local primitive trader/sprinter increase silhouette breadth, but they are intentionally rough R&D placeholders rather than final art-direction picks.

4. **Primitive weapon/armour meshes.** 5 of 6 weapons and 4 of 5 armour pieces are project-generated CC0 primitives (simple geometric shapes with tier-tinted materials). Only the sword (Robin Lamb) and riot_plate shield (Robin Lamb) are sourced from an external art pack. This is R&D breadth, not art-direction quality.

5. **Wall-clip cosmetic inset is renderer-side math.** The `cosmetic_wall_inset` helper in `SceneBuilder` computes a small positional offset from wall-rect normals. This is explicitly permitted by the spec (render-position cosmetic, not pathfinding) and excluded from the forbidden-token grep. Engine positions are unchanged.

6. **No audio pipeline.** Sound-emitter stubs are absent. The wall face-slam "faint thud" described in the spec is VFX-only (dust puff + camera nudge) with no audio.

---

## 6. Controls Reminder (for blind visual UAT)

| Control | Action |
|---|---|
| `C` | Toggle Director / Anchored camera |
| `[` / `]` | Cycle previous / next anchor (all characters including dead/extracted) |
| Left mouse drag | Orbit |
| Right mouse drag | Pan (Director mode) |
| Mouse wheel | Zoom (clamped: anchored max = 32, director max = 62) |
| Bottom HUD: Play/Pause | Toggle playback |
| Bottom HUD: Scrub slider | Seek to any turn |
| Bottom HUD: Speed selector | 0.5x / 1x / 2x playback speed |
| `Esc` or Back button | Return to match picker |

---

## 7. Blind Visual UAT Focus Areas

The user should evaluate the following during their visual UAT session:

1. **Waypoint pathing.** Pick a match with wall-slide moves. Confirm characters animate along the engine's waypoint path, not a straight line through walls. Turn on the anchored camera and follow a character through a slide.

2. **Wall face-slam.** Find a turn where a character hits a wall (visible in the kill feed or by scrubbing). Confirm the dust puff and camera nudge fire at the wall contact face, not at the character's start tile. Confirm it reads as comedic, not broken.

3. **Persona model fit.** Cycle through all 8 characters. Judge whether the model-to-archetype mapping reads correctly (scrappy rat, combative duelist, neon broker trader, mech opportunist, guarded paranoid, quiet camper, crimson stalker sprinter, dark vulture). Note which models work and which don't.

4. **Scale and ground level.** Characters and crates should sit flush on the ground (no hover, no buried legs). Models should be roughly half the size of round 3.

5. **Equipment readability.** Watch a character loot a weapon or armour upgrade. Confirm the mesh swaps visibly at the pickup moment. Confirm tier is readable at a glance (low = small/muted, mid = medium/cyan accent, high = large/crimson glow).

6. **Gore intensity.** Watch a lethal attack. Confirm: blood splash at impact, dismemberment chunks flying, persistent blood pool on the floor. Check that pools accumulate through the match without disappearing. Screen-shake should fire on hits. Evaluate whether the intensity level reads as "Diablo operatic" or needs more.

7. **Camera framing.** Confirm the anchored camera is noticeably tighter than round 3. Confirm max zoom-out is capped. Director camera should still have full orbit/pan/zoom.

8. **Environment materials.** Walls, floor, crates, cover, and evac should have cyberpunk × Diablo textures (dark, neon-accented, moody). Lighting baseline (neon key light + crimson rim light) should still be present.

9. **Loot animation.** Watch a crate open or corpse loot. Confirm the cyan pickup flourish fires and the source visually updates (crate empties, corpse darkens).

10. **Facing direction.** Characters should face their movement heading. When stationary, facing should hold from the previous heading (no spinning, no default-north).

11. **Cross-map consistency.** Load matches from different maps in the 5-map pool. Confirm geometry, scale, and camera all work across maps without per-map branches.

---

## 8. Validation Summary

| Check | Result |
|---|---|
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm run build` | Clean |
| `npm test` | 926 passed, 2 skipped |
| `npm --prefix throwaway-prototypes/d-full-match test` | 533 scaffold checks passed |
| `GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm --prefix throwaway-prototypes/d-full-match run build` | Clean Godot web export; new persona `.scn` imports packaged |
| Reviewer grep for pathing logic in renderer | None found (forbidden-token grep in scaffold-verify) |
| Reviewer grep for browsertools/screenshot artefacts | None found (scaffold-verify banned-token check) |
| Reviewer grep for fog/LOS/perception code | None found |

---

## 9. Pre-§10-Gate Posture Reminder

Same as round 3. This round is **pre-§10-gate exploration**:

- The Godot prototype is throwaway. It does not constitute a consumer-render commitment.
- The match-data contract (schemaVersion 3) escapes throwaway and is load-bearing for any future renderer.
- The substrate direction (Godot/WASM) is a directional signal, not a locked-in production decision. The contract is renderer-agnostic (plain HTTP + JSON).
- The subscribe-and-cache live-streaming half (§13 "full form") remains deferred until the player-facing matchmaking surface (§12) is built.

---

## 10. What the Next Render-Era Probe Could Be

Still §10-gated. These are directional possibilities, not commitments:

- **Audio layer.** No audio pipeline exists. The combat beats (blood splash, dismemberment, wall face-slam, loot pickup) are visuals-only. Adding spatial audio would amplify the spectacle.
- **Rigged animation pass.** The current character models are static meshes with pose-based animation (rotation + translation). A rigging pass with Mixamo auto-rigger could add walk cycles, attack swings, and death ragdolls for a significant felt-experience upgrade.
- **Art direction curation.** The 8-model R&D spread is breadth over polish. A curation pass would lock the best 2-3 source lanes and commission/source purpose-fit models per persona.
- **Subscribe-and-cache live playback.** The contract serves completed matches via HTTP fetch. The §13 "full form" subscribes to in-progress matches — requires the player-facing layer (§12) to produce something live to watch.
- **Camera/pacing tuning pass.** The scale, zoom, and speed defaults are implementer-judged starting points. A tuning pass against the user's UAT feedback could refine them.

---

## 11. Decision Trace

Key PM-ratified decisions that shaped this round:

| Decision | Summary |
|---|---|
| D1 | WP1 escapes throwaway as real Convex code (schemaVersion 2→3, forward-only POC, no migration shims). |
| D3 | PM overrode spec's "skip plan-review" recommendation — foundational schema bump + engine modification warranted review. |
| D4 | Blind-UAT discipline confirmed — NO browsertools, NO chromium, NO uat job. |
| D5 | Working-tree `apps/replay` + `convex/llm` modifications out-of-scope (separate Phase 4). |
| D7 | bodyCollision lethal rule = mover-attribution (charger = killer). Mutual-death: both sides `lethal: true`. |
| D9 | Multi-source manifest at new path under `d-full-match/shared-harness/art-kit/`; existing shared-harness manifest untouched. |
| D11 | Convex dev data wiped — acceptable POC schema-wipe for forward-only `path` field. |
| D14 | bodyCollision attribution hole: `defenderDied && moverDied` guard too tight. Fixed to `moverDied` for charger-only death. |
| D18 | WP1 and WP2-4 committed separately; Phase 4 in-flight files excluded from both commits. |
| D20-D24 | Completion review concern resolved via refinement: wall face-slam consumes `wallRectId`, asset breadth now has 4 lanes / max 4 Kenney slots / no astronaut mapping, PNG textures are wired, and schemaVersion guard added. |
