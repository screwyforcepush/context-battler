#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");

const requiredFiles = [
  "README.md",
  "package.json",
  "project.godot",
  "export_presets.cfg",
  "scenes/MatchPicker.tscn",
  "scenes/MatchPlayer.tscn",
  "scenes/Showroom.tscn",
  "src/AppState.gd",
  "src/ConvexClient.gd",
  "src/MatchPicker.gd",
  "src/MatchPlayer.gd",
  "src/SceneBuilder.gd",
  "src/Showroom.gd",
  "src/EntityRenderer.gd",
  "src/PlaybackClock.gd",
  "src/TimelineHud.gd",
  "src/CameraRig.gd",
  "src/CombatVfx.gd",
  "src/EquipmentMeshAttachment.gd",
  "scripts/export-web.mjs",
  "scripts/serve.mjs",
  "scripts/audit-character-scales.gd",
  "scripts/verify-character-rigs.gd",
  "shared-harness/art-kit/manifest.json",
];

const checks = [];
const showroomPersonas = ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"];
const showroomTriggerKinds = ["idle", "walk", "attack_unarmed", "attack_armed", "loot", "take_hit", "death"];
const equipmentAssetNameLiterals = [
  "rusty_blade",
  "dagger",
  "sword",
  "axe",
  "greatsword",
  "warhammer",
  "cloth",
  "leather",
  "chain",
  "plate",
  "riot_plate",
];

function read(relativePath) {
  return readFileSync(path.join(appDir, relativePath), "utf8");
}

function assert(condition, message) {
  checks.push({ ok: Boolean(condition), message });
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), message);
}

function assertNotIncludes(source, needle, message) {
  assert(!source.toLowerCase().includes(needle.toLowerCase()), message);
}

function assertMatches(source, pattern, message) {
  assert(pattern.test(source), message);
}

function assertNotMatches(source, pattern, message) {
  assert(!pattern.test(source), message);
}

function numericConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*:=\\s*([0-9]+(?:\\.[0-9]+)?)`));
  return match ? Number(match[1]) : Number.NaN;
}

function showroomSyntheticMapWidth(source) {
  const widthLiterals = [...source.matchAll(/["']w["']\s*:\s*([0-9]+)/g)].map((match) => Number(match[1]));
  const widthBindings = [
    ...source.matchAll(/\b(?:const|var)\s+\w*MAP_WIDTH\w*\s*(?::\s*\w+\s*)?(?::=|=)\s*([0-9]+)/gi),
    ...source.matchAll(/\b(?:const|var)\s+\w*SHOWROOM_WIDTH\w*\s*(?::\s*\w+\s*)?(?::=|=)\s*([0-9]+)/gi),
  ].map((match) => Number(match[1]));
  return Math.max(Number.NEGATIVE_INFINITY, ...widthLiterals, ...widthBindings);
}

function sha256(relativePath) {
  return createHash("sha256").update(readFileSync(path.join(appDir, relativePath))).digest("hex");
}

function manifestAssetPath(asset) {
  return path.join("shared-harness/art-kit", asset.file);
}

for (const file of requiredFiles) {
  assert(existsSync(path.join(appDir, file)), `required file exists: ${file}`);
}

if (existsSync(path.join(appDir, "project.godot"))) {
  const project = read("project.godot");
  assert(project.includes('run/main_scene="res://scenes/MatchPicker.tscn"'), "project.godot launches MatchPicker");
  assert(project.includes('AppState="*res://src/AppState.gd"'), "project.godot registers AppState autoload");
  assert(project.includes('ConvexClient="*res://src/ConvexClient.gd"'), "project.godot registers ConvexClient autoload");
  assert(project.includes('config/name="Context Battler Full Match"'), "project.godot uses full-match project name");
}

if (existsSync(path.join(appDir, "src/AppState.gd"))) {
  const appState = read("src/AppState.gd");
  assert(appState.includes("selected_match_id"), "AppState stores selected_match_id");
  assert(appState.includes("snapshot_cache"), "AppState stores snapshot_cache");
  assert(appState.includes("window.location.hash"), "AppState reads URL hash");
  assert(appState.includes("convex"), "AppState parses convex hash parameter");
  assert(appState.includes("__d_full_match_config"), "AppState reads build-time default config");
}

if (existsSync(path.join(appDir, "src/ConvexClient.gd"))) {
  const client = read("src/ConvexClient.gd");
  assert(client.includes("HTTPRequest"), "ConvexClient uses HTTPRequest");
  assert(client.includes("request_completed"), "ConvexClient awaits request_completed");
  assert(client.includes("JSON.parse_string"), "ConvexClient parses JSON responses");
  assert(client.includes("last_error"), "ConvexClient exposes last_error for UI states");
}

if (existsSync(path.join(appDir, "src/MatchPicker.gd"))) {
  const picker = read("src/MatchPicker.gd");
  assert(picker.includes("/replay/listMatches"), "MatchPicker calls listMatches endpoint");
  assert(picker.includes("no completed matches"), "MatchPicker has empty-state copy");
  assert(picker.includes("Retry"), "MatchPicker has retry handling");
  assert(picker.includes("item_activated"), "MatchPicker supports row activation");
  assert(picker.includes("MatchPlayer.tscn"), "MatchPicker routes to MatchPlayer");
  assert(picker.includes("Showroom.tscn"), "MatchPicker routes to Showroom");
  assert(picker.includes("sort_custom"), "MatchPicker sorts loaded rows");
}

if (existsSync(path.join(appDir, "src/MatchPlayer.gd"))) {
  const player = read("src/MatchPlayer.gd");
  assert(player.includes("/replay/exportMatch?matchId="), "MatchPlayer calls exportMatch endpoint");
  assert(player.includes("turnCount"), "MatchPlayer displays turnCount");
  assert(player.includes("get_cached_snapshot"), "MatchPlayer reads snapshot cache");
  assert(player.includes("cache_snapshot"), "MatchPlayer writes snapshot cache");
  assert(player.includes("MatchPicker.tscn"), "MatchPlayer Back button returns to picker");
  assertIncludes(player, "SceneBuilder", "MatchPlayer wires SceneBuilder");
  assertIncludes(player, "EntityRenderer", "MatchPlayer wires EntityRenderer");
  assertIncludes(player, "PlaybackClock", "MatchPlayer wires PlaybackClock");
  assertIncludes(player, "TimelineHud", "MatchPlayer wires TimelineHud");
  assertIncludes(player, "CameraRig", "MatchPlayer wires CameraRig");
  assertIncludes(player, "get_current_turn", "MatchPlayer exposes current_turn getter bridge");
  assertIncludes(player, "anchor_changed", "MatchPlayer connects CameraRig anchor_changed");
  assertIncludes(player, "mode_changed", "MatchPlayer connects CameraRig mode_changed");
  assertIncludes(player, "set_camera_rig", "MatchPlayer passes CameraRig into EntityRenderer for VFX screen punch");
}

if (existsSync(path.join(appDir, "src/SceneBuilder.gd"))) {
  const sceneBuilder = read("src/SceneBuilder.gd");
  for (const token of ["walls", "coverClusters", "evac", "airdrops", "build_from_snapshot"]) {
    assertIncludes(sceneBuilder, token, `SceneBuilder references snapshot.map.${token}`);
  }
  for (const token of ["WorldEnvironment", "neon-key-light", "crimson-rim-light"]) {
    assertIncludes(sceneBuilder, token, `SceneBuilder preserves cyberpunk lighting token ${token}`);
  }
  assertIncludes(sceneBuilder, "map_geometry_root", "SceneBuilder isolates reloadable map geometry under map_geometry_root");
  assertIncludes(sceneBuilder, "_ensure_map_geometry_root", "SceneBuilder creates or reuses the map geometry root");
  assertNotIncludes(sceneBuilder, "for child in get_children()", "SceneBuilder does not clear lighting/environment siblings");
  for (const token of ["staticCrates", "_build_static_crates", "static-crate"]) {
    assertNotIncludes(sceneBuilder, token, `SceneBuilder leaves crate visibility to EntityRenderer (${token})`);
  }
  for (const mapId of ["reference", "split-basin", "crosswind", "market-maze", "faultline", "mapId"]) {
    assertNotIncludes(sceneBuilder, mapId, `SceneBuilder has no per-map branch token ${mapId}`);
  }
  for (const banned of ["fog_enabled", "line_of_sight", "perception", "ghost"]) {
    assertNotIncludes(sceneBuilder, banned, `SceneBuilder avoids banned visual token ${banned}`);
  }
  assertIncludes(sceneBuilder, "cosmetic_wall_inset", "SceneBuilder exposes render-only wall inset helper");
  assertIncludes(sceneBuilder, "NoiseTexture2D", "SceneBuilder uses procedural texture materials");
  assertIncludes(sceneBuilder, "albedo_texture", "SceneBuilder assigns material albedo textures");
  assertIncludes(sceneBuilder, "normal_texture", "SceneBuilder assigns PBR normal textures");
  assertIncludes(sceneBuilder, "metallic", "SceneBuilder assigns PBR metallic values");
  for (const banned of ["a_star", "astar", "find_path", "bresenham", "dijkstra", "breadth_first_search", "manual_collision"]) {
    assertNotIncludes(sceneBuilder, banned, `SceneBuilder avoids renderer pathing token ${banned}`);
  }
}

if (existsSync(path.join(appDir, "src/EntityRenderer.gd"))) {
  const entityRenderer = read("src/EntityRenderer.gd");
  for (const token of ["characters", "corpses", "crates", "airdrops", "sample_turn", "update_to_turn"]) {
    assertIncludes(entityRenderer, token, `EntityRenderer handles ${token}`);
  }
  for (const token of ["telegraphed", "landed", "spent", "opened"]) {
    assertIncludes(entityRenderer, token, `EntityRenderer differentiates ${token} state`);
  }
  assertNotIncludes(entityRenderer, "Astronaut.glb", "EntityRenderer no longer hard-codes the stale astronaut model");
  assertNotIncludes(entityRenderer, "Pickup Crate.glb", "EntityRenderer no longer hard-codes the stale crate model");
  assertNotIncludes(entityRenderer, "speech", "EntityRenderer does not render speech in 3D");
  assertIncludes(entityRenderer, "EquipmentMeshAttachment", "EntityRenderer wires manifest-driven equipment attachment");
  assertIncludes(entityRenderer, "CombatVfx", "EntityRenderer wires CombatVfx event consumer");
  assertIncludes(entityRenderer, "instantiate_persona_character", "EntityRenderer delegates persona model instancing to EquipmentMeshAttachment factory");
  assertMatches(
    entityRenderer,
    /instantiate_persona_character\([\s\S]*CHARACTER_MODEL_SCALE/,
    "EntityRenderer passes CHARACTER_MODEL_SCALE through the persona factory",
  );
  assertIncludes(entityRenderer, "personaId", "EntityRenderer maps snapshot personaId to manifest personaSlot");
  assertIncludes(entityRenderer, "corpse_scene", "EntityRenderer uses manifest corpse asset");
  assertIncludes(entityRenderer, "update_equipment", "EntityRenderer updates equipment attachment from equippedByCharacter");
  assertIncludes(entityRenderer, "equippedByCharacter", "EntityRenderer reads frame equippedByCharacter");
  assertIncludes(entityRenderer, "play_attack_pose", "EntityRenderer exposes attack animation hook");
  assertIncludes(entityRenderer, "mark_lethal_target", "EntityRenderer exposes lethal death hook");
  assertIncludes(entityRenderer, "play_wall_slam", "EntityRenderer exposes wall face-slam hook");
  assertIncludes(entityRenderer, "play_loot_pickup", "EntityRenderer exposes loot animation hook");
  assertIncludes(entityRenderer, "mark_loot_source", "EntityRenderer exposes loot source empty/fade hook");
  const entityActionPhaseStart = numericConstant(entityRenderer, "ACTION_PHASE_START");
  assert(
    entityActionPhaseStart >= 0.55 && entityActionPhaseStart <= 0.8,
    "EntityRenderer defines ACTION_PHASE_START within the action-phase gate range",
  );
  assertIncludes(entityRenderer, "environmental_effects_fired_through_turn", "EntityRenderer gates environmental effects with a fired-through counter");
  assertIncludes(entityRenderer, "_resolved_action_turn_for_value", "EntityRenderer resolves action-phase turns from fractional turn_value");
  assertIncludes(entityRenderer, "_equipment_turn_for_value", "EntityRenderer gates equipment visibility through the action-phase helper");
  assertMatches(
    entityRenderer,
    /fraction\s*>=\s*ACTION_PHASE_START[\s\S]*turn_int\s*-\s*1/,
    "EntityRenderer holds current-turn equipment until ACTION_PHASE_START",
  );
  assertMatches(
    entityRenderer,
    /turn_int\s*>=\s*_end_turn_from_snapshot\(\)[\s\S]*return\s+_end_turn_from_snapshot\(\)/,
    "EntityRenderer clamps equipment visibility at final turn",
  );
  assertNotIncludes(entityRenderer, "last_effect_turn", "EntityRenderer no longer fires red mist directly at floor(turn_value)");
  assertIncludes(entityRenderer, "movements_by_turn_character", "EntityRenderer buckets snapshot.movements by turn and character");
  assertIncludes(entityRenderer, '"movements"', "EntityRenderer reads snapshot.movements");
  assertIncludes(entityRenderer, '"path"', "EntityRenderer consumes movement path waypoints");
  assertIncludes(entityRenderer, "last_heading_by_character", "EntityRenderer preserves stationary character heading");
  assertIncludes(entityRenderer, "_tile_along_path", "EntityRenderer walks engine-emitted waypoint paths");
  assertIncludes(entityRenderer, "var movement_turn := turn_base", "EntityRenderer aligns movement event turn to the visible turn");
  assertNotIncludes(entityRenderer, "turn_base + 1", "EntityRenderer does not skip movement event turn 1 with turn_base + 1 alignment");
  assertIncludes(entityRenderer, "cosmetic_wall_inset", "EntityRenderer applies render-only wall inset");
  assertNotIncludes(entityRenderer, "node.rotation.y = sin(Time.get_ticks_msec", "EntityRenderer removed decorative sine rotation");
  assertMatches(entityRenderer, /CHARACTER_MODEL_SCALE\s*:=\s*0\.21/, "EntityRenderer halves character model scale to 0.21");
  assert((entityRenderer.match(/0\.21/g) ?? []).length === 1, "EntityRenderer keeps 0.21 only in the CHARACTER_MODEL_SCALE declaration");
  assertMatches(entityRenderer, /CRATE_MODEL_SCALE\s*:=\s*0\.17/, "EntityRenderer halves crate model scale to 0.17");
  for (const banned of ["a_star", "astar", "find_path", "bresenham", "dijkstra", "breadth_first_search", "manual_collision"]) {
    assertNotIncludes(entityRenderer, banned, `EntityRenderer avoids renderer pathing token ${banned}`);
  }
}

if (existsSync(path.join(appDir, "src/CombatVfx.gd"))) {
  const combatVfx = read("src/CombatVfx.gd");
  for (const token of [
    '"attacks"',
    '"loots"',
    '"movements"',
    '"blockedBy"',
    '"hit"',
    '"lethal"',
    "play_attack_pose",
    "mark_lethal_target",
    "play_wall_slam",
    "play_loot_pickup",
    "mark_loot_source",
    "screen_punch",
    "persistent-blood-pool",
    "dismemberment-chunk",
  ]) {
    assertIncludes(combatVfx, token, `CombatVfx consumes or emits ${token}`);
  }
  const actionPhaseStart = numericConstant(combatVfx, "ACTION_PHASE_START");
  assert(actionPhaseStart >= 0.55 && actionPhaseStart <= 0.8, "CombatVfx defines ACTION_PHASE_START within the action-phase gate range");
  const wallSlamPhaseStart = numericConstant(combatVfx, "WALL_SLAM_PHASE_START");
  assert(wallSlamPhaseStart >= 0.95 && wallSlamPhaseStart <= 1.0, "CombatVfx gates wall-slams at movement-end");
  assertIncludes(combatVfx, "actions_fired_through_turn", "CombatVfx tracks action VFX with a fired-through gate");
  assertIncludes(combatVfx, "wall_slams_fired_through_turn", "CombatVfx tracks wall-slams with a separate fired-through gate");
  assertIncludes(combatVfx, "_initial_actions_fired_through_turn", "CombatVfx initializes fired-through from playback startTurn");
  assertMatches(
    combatVfx,
    /startTurn[\s\S]*-\s*1/,
    "CombatVfx initializes fired-through from startTurn - 1",
  );
  assertMatches(
    combatVfx,
    /if\s+fraction\s*>=\s*ACTION_PHASE_START[\s\S]*resolved_through\s*=\s*turn_int/,
    "CombatVfx fires action VFX only after ACTION_PHASE_START",
  );
  assertMatches(
    combatVfx,
    /if\s+fraction\s*>=\s*WALL_SLAM_PHASE_START[\s\S]*resolved_through\s*=\s*turn_int/,
    "CombatVfx fires wall-slams only near movement end",
  );
  assertMatches(
    combatVfx,
    /if\s+turn_int\s*>=\s*end_turn[\s\S]*resolved_through\s*=\s*end_turn/,
    "CombatVfx clamps final-turn VFX at playback end",
  );
  assertNotIncludes(combatVfx, "last_triggered_turn", "CombatVfx no longer uses floor-turn last_triggered_turn gate");
  assertNotIncludes(combatVfx, "CylinderMesh", "CombatVfx blood-pool spawn no longer uses circular disk meshes");
  assertIncludes(combatVfx, "QuadMesh", "CombatVfx uses the documented blood-pool alpha fallback mesh");
  assertIncludes(combatVfx, "blood-splatter-alexandrohaibi.png", "CombatVfx uses the sourced splatter alpha texture");
  const poolMatch = combatVfx.match(/MAX_BLOOD_POOLS\s*:=\s*(\d+)/);
  const burstMatch = combatVfx.match(/MAX_PARTICLE_BURST\s*:=\s*(\d+)/);
  assert(poolMatch && Number(poolMatch[1]) <= 64, "CombatVfx caps persistent blood pools at <=64");
  assert(burstMatch && Number(burstMatch[1]) <= 120, "CombatVfx caps per-burst particles at <=120");
}

if (existsSync(path.join(appDir, "src/EquipmentMeshAttachment.gd"))) {
  const equipment = read("src/EquipmentMeshAttachment.gd");
  for (const token of [
    "manifest.json",
    "weaponName",
    "armourName",
    "personaSlot",
    "handOffset",
    "character_scene_for_persona",
    "corpse_scene",
    "environment_scene_for_role",
    "register_character",
    "update_equipment",
    "play_loot_swap",
    "WEAPON_SOCKET_NAME",
    "ARMOUR_SOCKET_NAME",
    "Skeleton3D",
    "AnimationPlayer",
    "BoneAttachment3D",
    "find_bone",
    "scale_multiplier_for_persona",
    "instantiate_persona_character",
    "base_scale",
    "resolve_animation_clip",
    "animation_state_for_character",
    "animation_clip_for_character",
    "has_rigged_animation",
    "play_character_animation",
    "_apply_persona_palette",
    "_palette_material",
  ]) {
    assertIncludes(equipment, token, `EquipmentMeshAttachment handles ${token}`);
  }
  assertNotIncludes(equipment, "CHARACTER_MODEL_SCALE", "EquipmentMeshAttachment receives base scale by parameter");
  assertNotIncludes(equipment, "0.21", "EquipmentMeshAttachment does not duplicate the character base scale literal");
  assertMatches(
    equipment,
    /func\s+instantiate_persona_character\([\s\S]*base_scale:\s*float[\s\S]*\)\s*->\s*Node3D/,
    "EquipmentMeshAttachment exposes persona character factory with base_scale parameter",
  );
  assertMatches(
    equipment,
    /visual\.scale\s*=\s*Vector3\.ONE\s*\*\s*base_scale\s*\*\s*multiplier/,
    "EquipmentMeshAttachment factory applies base scale times per-persona multiplier",
  );
  assertMatches(
    equipment,
    /func\s+resolve_animation_clip\(\s*character_id:\s*String,\s*kind:\s*String\s*\)\s*->\s*Dictionary/,
    "EquipmentMeshAttachment exposes structured animation resolver",
  );
  for (const token of ['"clip"', '"requested_kind"', '"resolved_kind"', '"is_fallback"', '"is_playing"']) {
    assertIncludes(equipment, token, `EquipmentMeshAttachment animation state includes ${token}`);
  }
  assertMatches(
    equipment,
    /"attack_armed"[\s\S]*\["attack_armed",\s*"attack",\s*"generic"\]/,
    "EquipmentMeshAttachment falls back attack_armed through attack/generic",
  );
  assertMatches(
    equipment,
    /"attack_unarmed"[\s\S]*\["attack_unarmed",\s*"attack",\s*"generic"\]/,
    "EquipmentMeshAttachment falls back attack_unarmed through attack/generic",
  );
  assertMatches(
    equipment,
    /"take_hit"[\s\S]*\["take_hit",\s*"generic",\s*"idle"\]/,
    "EquipmentMeshAttachment falls back take_hit through generic/idle",
  );
  assertMatches(
    equipment,
    /"death"[\s\S]*\["death",\s*"take_hit",\s*"generic",\s*"idle"\]/,
    "EquipmentMeshAttachment falls back death through take_hit/generic/idle",
  );
  assertIncludes(equipment, "animation_finished", "EquipmentMeshAttachment uses animation_finished for death pose hold");
  assertIncludes(equipment, "player.pause()", "EquipmentMeshAttachment pauses finished death animation");
  assertNotMatches(equipment, /\bloop_mode\s*=/, "EquipmentMeshAttachment does not assign Animation.loop_mode");
  assertNotIncludes(equipment, "armour_visual", "EquipmentMeshAttachment does not attach floating armour visuals");
}

if (existsSync(path.join(appDir, "src/PlaybackClock.gd"))) {
  const clock = read("src/PlaybackClock.gd");
  for (const token of ["signal turn_changed", "current_turn", "is_playing", "speed", "scrub_to", "set_speed", "get_current_turn"]) {
    assertIncludes(clock, token, `PlaybackClock provides ${token}`);
  }
  for (const multiplier of ["0.5", "1.0", "2.0"]) {
    assertIncludes(clock, multiplier, `PlaybackClock supports ${multiplier}x speed`);
  }
  assertIncludes(clock, "speed = 1.0", "PlaybackClock default speed remains 1.0");
}

if (existsSync(path.join(appDir, "src/TimelineHud.gd"))) {
  const hud = read("src/TimelineHud.gd");
  for (const token of ["HSlider", "Play", "Pause", "0.5x", "1x", "2x", "Turn %d / %d"]) {
    assertIncludes(hud, token, `TimelineHud provides ${token}`);
  }
}

if (existsSync(path.join(appDir, "src/CameraRig.gd"))) {
  const cameraRig = read("src/CameraRig.gd");
  for (const token of ["signal anchor_changed", "signal mode_changed", "MODE_FREE", "MODE_ANCHORED", "cycle_anchor", "KEY_C", "KEY_BRACKETLEFT", "KEY_BRACKETRIGHT"]) {
    assertIncludes(cameraRig, token, `CameraRig provides ${token}`);
  }
  assertIncludes(cameraRig, "lock_free_mode", "CameraRig exposes lock_free_mode for Showroom");
  assertIncludes(cameraRig, "including dead/extracted", "CameraRig documents all-character anchor cycling");
  assertMatches(cameraRig, /DEFAULT_DIRECTOR_RADIUS\s*:=\s*26\.0/, "CameraRig preserves director default radius");
  assertMatches(cameraRig, /DEFAULT_ANCHORED_RADIUS\s*:=\s*14\.0/, "CameraRig tightens anchored default radius");
  assertMatches(cameraRig, /MAX_DIRECTOR_ZOOM\s*:=\s*62\.0/, "CameraRig preserves director zoom-out cap");
  assertMatches(cameraRig, /MAX_ANCHORED_ZOOM\s*:=\s*32\.0/, "CameraRig caps anchored zoom-out");
  assertIncludes(cameraRig, "_max_zoom_for_mode", "CameraRig clamps zoom by active camera mode");
  assertIncludes(cameraRig, "screen_punch", "CameraRig exposes screen_punch for combat VFX");
  for (const banned of ["a_star", "astar", "find_path", "bresenham", "dijkstra", "breadth_first_search", "manual_collision"]) {
    assertNotIncludes(cameraRig, banned, `CameraRig avoids renderer pathing token ${banned}`);
  }
}

if (existsSync(path.join(appDir, "scenes/MatchPlayer.tscn"))) {
  const scene = read("scenes/MatchPlayer.tscn");
  for (const token of ["SceneBuilder", "EntityRenderer", "PlaybackClock", "TimelineHud", "CameraRig"]) {
    assertIncludes(scene, token, `MatchPlayer scene contains ${token}`);
  }
}

if (existsSync(path.join(appDir, "scenes/MatchPicker.tscn"))) {
  const scene = read("scenes/MatchPicker.tscn");
  assertIncludes(scene, "ShowroomButton", "MatchPicker scene contains ShowroomButton");
  assertIncludes(scene, "Showroom", "MatchPicker scene labels Showroom entry point");
}

if (existsSync(path.join(appDir, "scenes/Showroom.tscn"))) {
  const scene = read("scenes/Showroom.tscn");
  for (const token of ["Showroom", "Showroom.gd"]) {
    assertIncludes(scene, token, `Showroom scene contains ${token}`);
  }
}

if (existsSync(path.join(appDir, "src/Showroom.gd"))) {
  const showroom = read("src/Showroom.gd");
  assertIncludes(showroom, "MatchPicker.tscn", "Showroom routes back to MatchPicker");
  assertIncludes(showroom, "EntityRendererScript.CHARACTER_MODEL_SCALE", "Showroom reads CHARACTER_MODEL_SCALE from EntityRenderer");
  assertIncludes(showroom, "instantiate_persona_character", "Showroom instantiates personas through EquipmentMeshAttachment factory");
  assertIncludes(showroom, "build_from_snapshot", "Showroom builds sample environment through SceneBuilder");
  assertIncludes(showroom, "play_character_animation", "Showroom triggers animations through EquipmentMeshAttachment");
  assertIncludes(showroom, "update_equipment", "Showroom applies tier selections through EquipmentMeshAttachment");
  assertIncludes(showroom, '"name"', "Showroom passes equipment slots as dictionaries with name fields");
  assertIncludes(showroom, "Label3D", "Showroom uses Label3D for per-persona labels");
  assertIncludes(showroom, "animation_state_for_character", "Showroom reads animation state through public accessor");
  assertIncludes(showroom, "MODE_FREE", "Showroom configures CameraRig in MODE_FREE");
  assertIncludes(showroom, "lock_free_mode", "Showroom locks CameraRig free mode");
  for (const kind of showroomTriggerKinds) {
    assertIncludes(showroom, `"${kind}"`, `Showroom references animation trigger literal ${kind}`);
  }
  for (const persona of showroomPersonas) {
    assertIncludes(showroom, `"${persona}"`, `Showroom references persona literal ${persona}`);
  }
  const mapWidth = showroomSyntheticMapWidth(showroom);
  assert(Number.isFinite(mapWidth) && mapWidth * 0.38 > 11.2, "Showroom synthetic floor width covers the 8-persona row");
  assertNotIncludes(showroom, "registered_characters", "Showroom does not read EquipmentMeshAttachment private registered_characters");
  assertNotIncludes(showroom, "0.21", "Showroom does not duplicate CHARACTER_MODEL_SCALE literal");
  assertNotMatches(showroom, /\bloop_mode\s*=/, "Showroom does not assign Animation.loop_mode");
  assertNotMatches(showroom, /\bmode\s*=\s*.*MODE_ANCHORED/, "Showroom does not initialize CameraRig in MODE_ANCHORED");
  assertNotIncludes(showroom, "ConvexClient", "Showroom does not use ConvexClient");
  assertNotIncludes(showroom, "/replay", "Showroom does not call replay endpoints");
  for (const assetName of equipmentAssetNameLiterals) {
    assertNotMatches(showroom, new RegExp(`["']${assetName}["']`), `Showroom does not hardcode equipment asset literal ${assetName}`);
  }
}

if (existsSync(path.join(appDir, "shared-harness/art-kit/manifest.json"))) {
  const manifest = JSON.parse(read("shared-harness/art-kit/manifest.json"));
  assert(manifest.schemaVersion === 4, "d-full-match art manifest uses schemaVersion 4");
  assert(!("source" in manifest), "art manifest has no singleton top-level source");
  assert(!("license" in manifest), "art manifest has no singleton top-level license");
  assert(!("extraction" in manifest), "art manifest has no singleton top-level extraction");
  assert(Array.isArray(manifest.assets), "art manifest exposes assets array");
  const assets = manifest.assets ?? [];
  const personas = new Set();
  const characters = [];
  const sourceCounts = new Map();
  const priorSources = new Set(["kenney", "quaternius", "robin-lamb"]);
  let translationOnlyFallbacks = 0;
  const weapons = new Set();
  const armours = new Set();
  const corpseAssets = [];
  const environmentRoles = new Set();
  for (const asset of assets) {
    const relativePath = manifestAssetPath(asset);
    assert(typeof asset.file === "string" && asset.file.length > 0, `manifest asset has file: ${asset.id}`);
    assert(existsSync(path.join(appDir, relativePath)), `manifest asset file exists: ${asset.file}`);
    assert(asset.source && asset.source.pageUrl, `manifest asset has source URL: ${asset.id}`);
    assert(asset.license && asset.license.name && asset.license.url, `manifest asset has license metadata: ${asset.id}`);
    assert(typeof asset.notes === "string" && asset.notes.length > 0, `manifest asset has notes: ${asset.id}`);
    if (existsSync(path.join(appDir, relativePath))) {
      assert(statSync(path.join(appDir, relativePath)).size === asset.sizeBytes, `manifest sizeBytes matches: ${asset.file}`);
      assert(sha256(relativePath) === asset.sha256, `manifest sha256 matches: ${asset.file}`);
      if (/\.(glb|gltf|fbx|png)$/i.test(asset.file)) {
        assert(existsSync(path.join(appDir, `${relativePath}.import`)), `Godot import sidecar exists: ${asset.file}`);
      }
    }
    if (asset.category === "character") {
      personas.add(asset.personaSlot);
      characters.push(asset);
      assert(typeof asset.sourceKey === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(asset.sourceKey), `character asset has normalized sourceKey: ${asset.id}`);
      sourceCounts.set(asset.sourceKey, (sourceCounts.get(asset.sourceKey) ?? 0) + 1);
      assert("pivotYOffset" in asset, `character asset has pivotYOffset: ${asset.id}`);
      assert(
        typeof asset.modelScaleMultiplier === "number" &&
          Number.isFinite(asset.modelScaleMultiplier) &&
          asset.modelScaleMultiplier >= 0.4 &&
          asset.modelScaleMultiplier <= 3.0,
        `character asset has modelScaleMultiplier in [0.4, 3.0]: ${asset.id}`,
      );
      assert(asset.palette && typeof asset.palette === "object", `character asset has palette block: ${asset.id}`);
      for (const channel of ["base", "accent", "emissive"]) {
        assert(typeof asset.palette?.[channel] === "string" && /^#[0-9a-fA-F]{6}$/.test(asset.palette[channel]), `character palette has ${channel}: ${asset.id}`);
      }
      assert(asset.animation && typeof asset.animation === "object", `character asset has animation block: ${asset.id}`);
      assert(typeof asset.animation?.idle === "string" && asset.animation.idle.length > 0, `character animation has idle clip: ${asset.id}`);
      assert(typeof asset.animation?.walk === "string" && asset.animation.walk.length > 0, `character animation has walk clip: ${asset.id}`);
      const notes = String(asset.notes ?? "");
      const attackFallback = /attack-fallback:(translation-only|pose|generic)/.test(notes);
      const lootFallback = /loot-fallback:(translation-only|pose|generic)/.test(notes);
      assert(
        (typeof asset.animation?.attack === "string" && asset.animation.attack.length > 0) || attackFallback,
        `character animation has attack clip or explicit fallback: ${asset.id}`,
      );
      assert(
        (typeof asset.animation?.loot === "string" && asset.animation.loot.length > 0) ||
          (typeof asset.animation?.generic === "string" && asset.animation.generic.length > 0) ||
          lootFallback,
        `character animation has loot/generic clip or explicit fallback: ${asset.id}`,
      );
      if (/attack-fallback:translation-only|motion-fallback:translation-only/.test(notes)) {
        translationOnlyFallbacks += 1;
      }
      if (asset.attachBone == null) {
        assert(/attachBone-fallback:handOffset/.test(notes), `character without attachBone documents handOffset fallback: ${asset.id}`);
      } else {
        assert(typeof asset.attachBone === "string" && asset.attachBone.length > 0, `character attachBone is a string: ${asset.id}`);
      }
    } else if (asset.category === "weapon") {
      weapons.add(asset.weaponName);
      assert(asset.attachBone || asset.handOffset, `weapon asset has socket metadata: ${asset.id}`);
      assert(typeof asset.tier === "number", `weapon asset has tier: ${asset.id}`);
    } else if (asset.category === "armour") {
      armours.add(asset.armourName);
      assert(typeof asset.tier === "number", `armour asset has tier: ${asset.id}`);
    } else if (asset.category === "corpse") {
      corpseAssets.push(asset);
    } else if (asset.category === "environment") {
      environmentRoles.add(asset.environmentRole);
    }
  }
  assert(characters.length === 8, "manifest exposes exactly 8 character assets");
  assert(personas.size === 8, "manifest exposes exactly 8 persona slots");
  for (const persona of ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]) {
    assert(personas.has(persona), `manifest maps persona ${persona}`);
  }
  assert(sourceCounts.size === 8, "manifest character assets expose 8 distinct body sourceKey values");
  for (const sourceKey of priorSources) {
    const familyCount = [...sourceCounts.keys()].filter((key) => key.includes(sourceKey)).length;
    assert(familyCount <= 1, `prior sourceKey reuse cap respected: ${sourceKey}`);
  }
  for (const [sourceKey, count] of sourceCounts) {
    if (!priorSources.has(sourceKey)) {
      assert(count === 1, `new sourceKey is unique: ${sourceKey}`);
    }
  }
  assert(translationOnlyFallbacks <= 1, "manifest documents at most one translation-only motion fallback");
  for (const weapon of ["rusty_blade", "dagger", "sword", "axe", "greatsword", "warhammer"]) {
    assert(weapons.has(weapon), `manifest maps weapon ${weapon}`);
  }
  for (const armour of ["cloth", "leather", "chain", "plate", "riot_plate"]) {
    assert(armours.has(armour), `manifest maps armour ${armour}`);
  }
  assert(corpseAssets.length >= 1, "manifest includes corpse asset");
  for (const role of ["floor", "wall", "cover", "evac", "crate"]) {
    assert(environmentRoles.has(role), `manifest includes environment role ${role}`);
  }
}

if (existsSync(path.join(appDir, "package.json"))) {
  const pkg = JSON.parse(read("package.json"));
  const testScript = String(pkg.scripts?.test ?? "");
  assertIncludes(testScript, "GODOT_BIN", "package test gates character scale audit on GODOT_BIN");
  assertIncludes(testScript, "--path .", "package test runs character scale audit from the Godot project path");
  assertIncludes(testScript, "--headless", "package test invokes Godot headless for character scale audit");
  assertIncludes(testScript, "scripts/audit-character-scales.gd", "package test invokes audit-character-scales.gd");
  assertIncludes(testScript, "--assert", "package test runs character scale audit in assert mode");
  assertIncludes(testScript, "audit-character-scales: skipped (GODOT_BIN unset)", "package test logs clear scale-audit skip when GODOT_BIN is unset");
}

for (const codeFile of [
  "src/CombatVfx.gd",
  "src/EquipmentMeshAttachment.gd",
  "src/EntityRenderer.gd",
  "src/CameraRig.gd",
  "src/MatchPlayer.gd",
  "src/Showroom.gd",
  "scenes/Showroom.tscn",
  "IMPLEMENTATION-SUMMARY.md",
]) {
  if (!existsSync(path.join(appDir, codeFile))) continue;
  const source = read(codeFile);
  for (const banned of ["browsertools", "chromium", "playwright", "puppeteer", "screenshot", "visual uat", "browser-mediated"]) {
    assertNotIncludes(source, banned, `${codeFile} avoids forbidden blind-validation token ${banned}`);
  }
}

if (existsSync(path.join(appDir, "README.md"))) {
  const readme = read("README.md");
  assert(/throwaway/i.test(readme), "README labels prototype throwaway");
  assert(readme.includes("docs/project/phases/render-rnd/full-match-godot-spec.md"), "README links full-match spec");
  assert(readme.includes("round-6-showroom-spec.md"), "README links Round-6 Showroom spec");
  assert(readme.includes("Showroom"), "README documents Showroom mode");
  assert(readme.includes("#convex="), "README documents convex hash plumbing");
  assert(readme.includes("NO UAT"), "README documents blind/no-UAT posture");
}

if (existsSync(path.join(appDir, "IMPLEMENTATION-SUMMARY.md"))) {
  const summary = read("IMPLEMENTATION-SUMMARY.md");
  assertIncludes(summary, "## Showroom Mode", "IMPLEMENTATION-SUMMARY documents Showroom mode");
  assertIncludes(summary, "7 animation triggers", "IMPLEMENTATION-SUMMARY documents Showroom trigger count");
  assertIncludes(summary, "Weapon", "IMPLEMENTATION-SUMMARY documents weapon tier selectors");
  assertIncludes(summary, "Armor", "IMPLEMENTATION-SUMMARY documents armor tier selectors");
  assertIncludes(summary, "free camera", "IMPLEMENTATION-SUMMARY documents Showroom free camera");
  assertIncludes(summary, "modelScaleMultiplier", "IMPLEMENTATION-SUMMARY documents calibrated modelScaleMultiplier table");
  assertIncludes(summary, "no visual checks by implementer", "IMPLEMENTATION-SUMMARY documents blind implementer posture");
}

if (existsSync(path.join(appDir, "scripts/export-web.mjs"))) {
  const exportScript = read("scripts/export-web.mjs");
  assert(exportScript.includes("DEFAULT_CONVEX_URL"), "export script accepts build-time default");
  assert(exportScript.includes("__d_full_match_config"), "export script injects runtime config");
  assert(exportScript.includes("d-full-match-custom-loader"), "export script carries custom loader marker");
}

// Asset-import validity sweep. Round-4 blind-UAT salvage: 10 prototype .glb
// assets had `valid=false` in their .import sidecars because an
// implementer-written GLTF generator emitted malformed baseColorFactor.
// The export still built cleanly because failed imports just produce no
// .scn artifact; the runtime hits "No loader found for resource" at load.
// This check fails the test step before that surfaces in a browser.
function walkImports(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkImports(full));
    } else if (entry.name.endsWith(".import")) {
      found.push(full);
    }
  }
  return found;
}
const artKitDir = path.join(appDir, "shared-harness/art-kit");
if (existsSync(artKitDir)) {
  const imports = walkImports(artKitDir);
  for (const importPath of imports) {
    const source = readFileSync(importPath, "utf8");
    const rel = path.relative(appDir, importPath);
    const validFalse = /^valid\s*=\s*false\s*$/m.test(source);
    const hasPath = /^path\s*=\s*"res:\/\/.godot\/imported\//m.test(source);
    assert(!validFalse, `import not marked valid=false: ${rel}`);
    assert(hasPath, `import has compiled artifact path: ${rel}`);
  }
}

// GDScript runtime-parse smoke. Round-4 blind-UAT salvage: 5 parse errors
// in EntityRenderer.gd (walrus type-inference on Node-typed dispatchers,
// clamp() return inference) were accepted by the editor parser + the
// export-release build, but rejected by the WASM runtime at load(). The
// closure summary's "Godot WebAssembly build clean" was technically true
// but missed this entire class of defect. This invokes godot --headless
// --script to exercise the SAME load() codepath the game uses, catching
// any future drift before the user opens a browser. Skips gracefully if
// the godot binary isn't on this machine.
const godotCandidates = [
  process.env.GODOT_BIN,
  `/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.${os.arch() === "arm64" ? "arm64" : "x86_64"}`,
  "godot4",
  "godot",
].filter(Boolean);
let godotBin = null;
for (const candidate of godotCandidates) {
  if (candidate.includes("/")) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      godotBin = candidate;
      break;
    }
  } else {
    const found = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(candidate)}`], {
      encoding: "utf8",
    });
    if (found.status === 0 && found.stdout.trim()) {
      godotBin = found.stdout.trim();
      break;
    }
  }
}
if (godotBin && existsSync(path.join(appDir, "scripts/verify-gd-parse.gd"))) {
  const parse = spawnSync(
    godotBin,
    ["--headless", "--script", "res://scripts/verify-gd-parse.gd"],
    { cwd: appDir, encoding: "utf8" },
  );
  const stdout = parse.stdout ?? "";
  const stderr = parse.stderr ?? "";
  const combined = `${stdout}\n${stderr}`;
  // verify-gd-parse.gd prints "PASS" or "FAIL"; godot exits nonzero on FAIL.
  // NOTE: native godot's load() uses a more lenient parser than the WASM
  // runtime, so this check catches plain syntax errors but NOT all the
  // walrus type-inference errors that surfaced in round-4 blind UAT. The
  // narrow regex below targets the specific shapes that bit us, complementing
  // this smoke as a known-pattern regression lock.
  const passed = parse.status === 0 && /verify-gd-parse PASS/.test(combined) && !/SCRIPT ERROR|ERROR:/.test(combined);
  if (!passed) {
    console.error("--- godot --script verify-gd-parse.gd output ---");
    console.error(stdout);
    console.error(stderr);
    console.error("--- end godot output ---");
  }
  assert(passed, "all res://src/*.gd scripts parse under godot native loader");
} else {
  console.warn(
    "WARN: godot binary not found — skipping GDScript native-parse smoke. " +
      "Set GODOT_BIN to enable.",
  );
}

if (godotBin && existsSync(path.join(appDir, "scripts/verify-character-rigs.gd"))) {
  const rigCheck = spawnSync(
    godotBin,
    ["--headless", "--script", "res://scripts/verify-character-rigs.gd"],
    { cwd: appDir, encoding: "utf8" },
  );
  const stdout = rigCheck.stdout ?? "";
  const stderr = rigCheck.stderr ?? "";
  const combined = `${stdout}\n${stderr}`;
  const passed = rigCheck.status === 0 && /verify-character-rigs PASS/.test(combined) && !/SCRIPT ERROR|ERROR:/.test(combined);
  if (!passed) {
    console.error("--- godot --script verify-character-rigs.gd output ---");
    console.error(stdout);
    console.error(stderr);
    console.error("--- end godot output ---");
  }
  assert(passed, "all manifest character rigs load and resolve manifest animation clips");
} else {
  console.warn(
    "WARN: godot binary not found — skipping character rig structural check. " +
      "Set GODOT_BIN to enable.",
  );
}

// GDScript walrus-with-null-ternary regression lock. Round-4 blind UAT
// surfaced 3 parse errors of the shape `var X := obj.method(...) if cond
// else null`. The walrus `:=` can't infer the union of <method-return-type>
// and `null`, and the WASM runtime parser rejects the script at load(). The
// fix is always to write `var X: Type = ... if cond else null` instead. This
// regex catches future drift of the same shape. It is intentionally narrow
// — only the exact bite-pattern from this round — so it doesn't false-flag
// every walrus assignment in the codebase. If a different walrus inference
// failure class shows up in a future UAT, add a sibling check rather than
// widening this one.
const walrusNullTernary = /^\s*var\s+\w+\s*:=\s+.*\sif\s+.*\selse\s+null\s*$/m;
const srcDir = path.join(appDir, "src");
if (existsSync(srcDir)) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".gd")) continue;
    const rel = path.join("src", entry.name);
    const source = read(rel);
    let lineNum = 0;
    let offending = null;
    for (const line of source.split("\n")) {
      lineNum += 1;
      if (walrusNullTernary.test(line)) {
        offending = `${rel}:${lineNum}: ${line.trim()}`;
        break;
      }
    }
    assert(
      offending === null,
      offending
        ? `no walrus-with-null-ternary parse-hazard: ${offending}`
        : `no walrus-with-null-ternary parse-hazard: ${rel}`,
    );
  }
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.message}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} scaffold checks failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} scaffold checks passed.`);
