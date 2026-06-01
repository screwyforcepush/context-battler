# Godot WASM Full-Match Replay Prototype

This is a throwaway prototype for the render R&D path. It exists only at
`throwaway-prototypes/d-full-match/` and is not a production renderer.

Spec and assignment anchors:

- [Full-match Godot/WASM renderer spec](../../docs/project/phases/render-rnd/full-match-godot-spec.md)
- [Round-6 Showroom spec](../../docs/project/phases/render-rnd/round-6-showroom-spec.md)
- [Mental model section 10 and 13](../../docs/project/spec/mental-model.md)
- Assignment: full-match Godot/WASM replay probe, WP1 through WP4

## Scope

Built here:

- Godot web project scaffold with `MatchPicker.tscn` as `run/main_scene`.
- `AppState` and `ConvexClient` autoloads.
- Match picker that calls `GET /replay/listMatches`, sorts loaded rows
  descending by completion time, handles empty/error/retry states, and
  routes to the player on row activation.
- Match player that calls `GET /replay/exportMatch?matchId=...`, caches
  snapshots by match id, builds the map from `snapshot.map`, and plays
  `timeline.frames` from turn 1 to the final turn.
- SceneBuilder, EntityRenderer, PlaybackClock, TimelineHud, and CameraRig.
  The scene renders all characters, corpses, crates, airdrops, environmental
  death mist, walls, cover, and evac from the snapshot contract.
- Director camera and anchored camera. Anchored mode cycles every character
  in the match, including dead/extracted entries.
- Play/pause, scrub slider, and 0.5x / 1x / 2x speed selector.
- Cyberpunk-register-style web loader adapted from `c-godot-wasm`.
- Kill feed overlay script that reads `snapshot.killFeed`, listens for
  `PlaybackClock.turn_changed`, and shows top-right replay banners for the
  current turn window.
- Side panel script that reads the snapshot, `PlaybackClock`, and
  `CameraRig` signals. FREE mode is a compact Director summary; ANCHORED
  mode shows Identity, Equipment, Scratchpad, Prompt, and Speech tabs.
- Showroom mode from the home screen's `Showroom` button. It displays all 8
  personas side by side on the locked Mesh2Motion body, exposes 7 animation
  triggers, four adherence layer toggles, Weapon/Armor tier selectors, and an
  Armour mode switch for modular prop vs adhering region.
- Root `modelScaleMultiplier` values in the art manifest keep the locked
  Mesh2Motion character/corpse body at the calibrated apparent height.

Not built here: visual UAT, browsertools, Chromium, screenshots, UAT
artifacts, live subscription, fog/LOS/perception overlays, or 3D speech
bubbles. NO UAT.

## Controls And Panels

`C` toggles FREE/ANCHORED camera mode and `[` / `]` cycle the anchored
character. The left mouse button orbits, right mouse pans in Director mode,
and the wheel zooms. `Esc` returns to the picker. The bottom timeline has
Play/Pause, scrub, and speed controls.

- FREE mode: compact Director summary with map id, current turn, and alive
  count.
- ANCHORED mode: right-edge sections for Identity, Equipment, Scratchpad,
  Prompt, and Speech.
- Equipment tiers render through attached weapon meshes and the Round-10 armour
  prop/region paths; the sidebar mirrors the same snapshot equipment state.
- Speech is sidebar-log-only. No 3D speech bubbles were added.

## Showroom

Use the home screen's `Showroom` button to open the Round-10 curation surface.
The showroom has 7 animation triggers: idle, walk, attack unarmed, attack
armed, loot, take hit, and death. Weapon and Armor rows provide None, Low, Mid,
and High tier selectors that update all 8 personas together. Skin, Gore,
Weapons, and Armour layer toggles remain independent; the weapon attach mode is
consolidated on dynamic hand-bone follow, and Armour mode compares modular prop
against adhering region. The camera stays in free camera mode for orbit, pan,
and zoom around the lineup; `Esc` or Back returns to the picker.

The lineup uses the shared manifest factory and the single locked Mesh2Motion
body rather than a second character-loading path. The blind posture remains
NO UAT; the implementer does not perform visual checks.

## Convex URL

The runtime Convex base URL comes from the page hash:

```text
http://127.0.0.1:8063/#convex=https://your-deployment.convex.cloud
```

If the hash is absent, the exported HTML supplies a build-time default via
`window.__d_full_match_config.defaultConvexUrl`. Set it when exporting:

```bash
DEFAULT_CONVEX_URL=https://your-deployment.convex.cloud npm run build
```

If neither is set, the GDScript fallback is `http://127.0.0.1:3210`.
Client-side CORS code is intentionally absent; the browser enforces CORS,
and WP1 owns the HTTP action headers.

## Commands

```bash
npm test
npm run build
npm run serve -- --host 0.0.0.0 --port 8063 --gzip
```

`npm run build` requires Godot 4.6.2 plus matching Web export templates,
same as `c-godot-wasm`. You can point the script at a binary explicitly:

```bash
GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.x86_64 npm run build
```

The export writes `window.__d_full_match_ready`,
`window.__d_full_match_state`, and `window.__d_full_match_ready_at` for
non-visual readiness checks.
