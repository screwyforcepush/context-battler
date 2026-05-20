# Full-Match Godot/WASM Prototype Summary

This tree is throwaway R&D. The Convex replay HTTP contract is the part meant
to survive; this Godot project is only the blind full-match probe.

## Built

- In-Godot match picker calling `/replay/listMatches`.
- Full snapshot loader calling `/replay/exportMatch?matchId=...`.
- Data-driven 3D scene from `snapshot.map`: walls, cover, evac, crates, and
  airdrops across the five-map pool with no per-map branches.
- Playback clock, play/pause, backward/forward scrub, and 0.5x / 1x / 2x speed.
- Director camera plus anchored follow camera. Anchored cycling includes alive,
  dead, and extracted characters.
- Right-side panel: Director summary in FREE mode; anchored Identity,
  Equipment, Scratchpad, Prompt, and Speech sections.
- Top-right FPS-style kill feed rebuilt from `snapshot.killFeed`, including
  scrub-backward cleanup.
- Sidebar-only speech. There are no 3D speech bubbles.
- Ground-truth render. There is no fog, LOS filtering, ghost marker, or
  perception overlay code.

## Controls

- `C`: toggle Director / Anchored.
- `[` and `]`: previous / next anchor.
- Left mouse drag: orbit.
- Right mouse drag: pan in Director mode.
- Mouse wheel: zoom.
- Bottom HUD: Play/Pause, scrub slider, speed selector.
- `Esc` or Back: return to picker.

## Differs From `c-godot-wasm`

- `c-godot-wasm` plays a fixed scripted duel/telefrag slice from a local
  fixture. This prototype loads real completed-match snapshots over Convex
  HTTP and plays the whole match.
- Camera work is functional and scrubbable rather than a hand-timed kill-cam.
- Sidebar and kill feed are driven by contract fields, not scripted metadata.
- The visual polish baseline is reused at the pipeline level: dark arena,
  neon lighting/materials, custom loader, and red environmental-death mist.

## Blind UAT Focus

- Pick a completed match, load it, and confirm turn 1 through final turn plays.
- Scrub backward and forward; confirm entities, corpses, crates, airdrops, and
  kill banners return to the scrubbed state.
- Toggle Director/Anchored and cycle all characters, including dead ones.
- Check side panel legibility for equipment, scratchpad, prompt, and speech.
- Watch all five maps for geometry scale, camera framing, and wall/cover
  readability.
- Confirm anchored mode remains ground truth: all entities stay visible.
