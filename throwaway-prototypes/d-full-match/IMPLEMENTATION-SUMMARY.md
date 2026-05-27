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
  rat = KayKit rogue; duelist = Robin Lamb hero; trader = interglactic simple
  character; opportunist = Quaternius mech; paranoid = GDQuest Mannequiny;
  camper = Mesh2Motion human base; sprinter = XCVG animated humanoid;
  vulture = styloo robot. The manifest is schemaVersion 3 and records sourceKey,
  license, size, SHA-256, palette, and clip names per persona.
- Rigged animation pass: EntityRenderer selects idle, walk, attack, and loot or
  generic clips from the manifest and EquipmentMeshAttachment plays them through
  each character's AnimationPlayer. Whole-body attack/loot poses are bypassed
  when a rigged clip resolves.
- Equipment pipeline: weapons still attach through manifest hand metadata,
  preferring BoneAttachment3D when an attach bone resolves. Armour no longer
  spawns a separate wearable mesh; armour tiers modify the character material
  with metallic, emissive, and color-ramp changes.
- Combat spectacle pass: attack clips/poses orient attacker-to-target; hit
  splash, miss spray, lethal disintegration chunks, persistent splatter-textured
  blood pools capped at 64, camera punch, wall face-slam dust placed at the
  `wallRectId` contact face, and loot pickup flourishes. Environmental deaths
  still use the original red-mist beat.
- Round-5 WP-A timing fix: action VFX, loot/equipment swaps, and environmental
  red mist now wait for `ACTION_PHASE_START = 0.65` instead of firing at the
  integer turn boundary. Fired-through counters initialize from `startTurn - 1`,
  reset on backward scrub, and clamp at `endTurn` so final-turn events are not
  stranded by the playback clock. Wall face-slams use the chosen movement-end
  semantic, `WALL_SLAM_PHASE_START = 0.95`; direct dead-stop wall hits can be a
  delayed stationary slam because the snapshot path is `[from]`, while wall-slide
  or partial-contact traces align the slam with the path end.
- Scene material reconciliation: the five manifest PNG textures are now loaded
  by renderer code for floor, walls, cover, evac, airdrop/crate markers, and
  actual crate materials; procedural noise remains a fallback path. Round 5 adds
  generated normal-map noise and metallic/roughness values for PBR language.
- Forward-only replay guard: `MatchPlayer` rejects non-v3 snapshots before scene
  configuration so stale cached v2 data fails loudly.
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
- Check each persona's sourced character lane, palette, and rigged idle/walk/
  attack/loot motion. The active manifest has eight distinct sourceKeys and no
  local primitive character slots.
- Check each equipped weapon and armour tier for readability. Armour should read
  as a material tier on the character, not as a separate floating body piece.
- Check attacks, lethal deaths, equipment swaps, environmental red mist, and loot
  pickups for move-then-action timing against the kill feed and turn scrubber.
  Wall face-slams should land near movement end at the wall contact face, not at
  the character's start tile.

## Technical Ceilings

- Combat bursts use pooled lightweight mesh particles and primitive chunk meshes
  instead of bespoke rigged dismemberment. This keeps the web export budgeted but
  means gore still reads as body-disintegration rather than per-limb authored
  breakage.
- Blood pools use the web-compatible QuadMesh plus alpha splatter fallback, not
  Godot Decal nodes. This preserves the pipeline-language read while avoiding
  compatibility risk in the current export target.
- Socket attachment is still mixed quality because the sampled packs do not
  share a reliable humanoid bone map. The manifest records `attachBone` metadata,
  and the runtime falls back to stable hand offsets when a bone is missing.
- Trader uses jump as its attack/generic action clip because that CC0 source
  only ships idle, walk, and jump. It is still rigged limb motion, but it is a
  clear candidate for replacement if that lane is kept.
