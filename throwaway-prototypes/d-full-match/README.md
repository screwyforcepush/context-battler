# Godot WASM Full-Match Replay Prototype

This is a throwaway prototype for the render R&D path. It exists only at
`throwaway-prototypes/d-full-match/` and is not a production renderer.

Spec and assignment anchors:

- [Full-match Godot/WASM renderer spec](../../docs/project/phases/render-rnd/full-match-godot-spec.md)
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
- Equipment tier visualization is sidebar-label-only for v0. No 3D
  equipment tier materials were added.
- Speech is sidebar-log-only. No 3D speech bubbles were added.

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
