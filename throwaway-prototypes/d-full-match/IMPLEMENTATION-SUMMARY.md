# Full-Match Godot/WASM Prototype Summary

This tree is throwaway R&D. The Convex replay HTTP contract is the part meant
to survive; this Godot project is only the blind full-match probe.

## Built

- In-Godot match picker calling `/replay/listMatches`.
- Full snapshot loader calling `/replay/exportMatch?matchId=...`.
- Snapshot schema v3 spectacle streams consumed in-renderer:
  `movements[]` for engine-truth waypoint playback and wall face-slams,
  `attacks[]` for attack/death/gore beats, and `loots[]` for pickup/source
  update beats.
- Data-driven 3D scene from `snapshot.map`: walls, cover, evac, crates, and
  airdrops across the five-map pool with no per-map branches.
- Round-4 scale/camera pass: half-size character/crate rendering, tighter
  anchored camera with capped zoom-out, stationary heading preservation, and
  wall-adjacent cosmetic inset.
- Playback clock, play/pause, backward/forward scrub, and 0.5x / 1x / 2x speed.
- Director camera plus anchored follow camera. Anchored cycling includes alive,
  dead, and extracted characters.
- Manifest-driven character/corpse/equipment assets:
  rat = Kenney blocky A; duelist = Robin Lamb hero; trader = Kenney blocky C;
  opportunist = Quaternius astronaut baseline; paranoid = Kenney blocky R;
  camper = Kenney blocky N; sprinter = Kenney blocky H; vulture = Kenney blocky Q.
  Character source lanes: Kenney, Robin Lamb, Quaternius. Weapon/armour/corpse
  R&D placeholders are recorded per asset with license, size, and SHA-256 in
  `shared-harness/art-kit/manifest.json`.
- Equipment mesh-on-equip: all six weapon names and five armour names map through
  manifest metadata to deterministic socket attachments with tier-tinted material
  variation.
- Combat spectacle pass: attack poses oriented attacker-to-target; hit splash,
  miss spray, lethal disintegration chunks, persistent blood pools capped at 64,
  camera punch, wall face-slam dust, and loot pickup flourishes. Environmental
  deaths still use the original red-mist beat.
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

## Blind Review Focus

- Pick a completed match, load it, and confirm turn 1 through final turn plays.
- Confirm turn-1 movements now animate from `movements[].turn == 1`, not from a
  skipped turn-base offset.
- Scrub backward and forward; confirm entities, corpses, crates, airdrops, and
  kill banners return to the scrubbed state.
- Toggle Director/Anchored and cycle all characters, including dead ones.
- Check side panel legibility for equipment, scratchpad, prompt, and speech.
- Watch all five maps for geometry scale, camera framing, and wall/cover
  readability.
- Confirm anchored mode remains ground truth: all entities stay visible.
- Check each persona's model silhouette and each equipped weapon/armour tier for
  readability.
- Check attacks, lethal deaths, wall face-slams, environmental red mist, and loot
  pickups for timing against the kill feed and turn scrubber.

## Technical Ceilings

- Combat bursts use pooled lightweight mesh particles and primitive chunk meshes
  instead of bespoke rigged dismemberment. This keeps the web export budgeted but
  means the gore reads as body-disintegration rather than per-limb authored
  breakage.
- Socket attachment is deterministic offset-based because the R&D models do not
  share a reliable humanoid bone map. The manifest records `attachBone` metadata,
  but the runtime falls back to stable hand/spine offsets.
