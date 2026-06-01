#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");

const requiredFiles = [
  "README.md",
  "ROUND-9-CLOSING-READOUT.md",
  "ROUND-10-CLOSING-READOUT.md",
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
  "scripts/audit-mesh2motion-clips.gd",
  "scripts/verify-character-rigs.gd",
  "scripts/audit-replay-load.gd",
  "scripts/audit-skin-bone-attachments.gd",
  "scripts/audit-modular-submesh-armor.gd",
  "scripts/audit-universal-body.gd",
  "scripts/audit-adherence-matrix.gd",
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
const expectedBodyAnimationKinds = ["idle", "walk", "attack", "attack_unarmed", "attack_armed", "take_hit", "death", "loot"];
const expectedCharacterForbiddenKeys = [
  "sourceKey",
  "file",
  "modelScaleMultiplier",
  "pivotYOffset",
  "attachBone",
  "animation",
  "source",
  "license",
  "extraction",
  "sha256",
  "sizeBytes",
  "palette",
];
const expectedSkinHelperGroups = [
  ["_apply_skin_palette_flat"],
  ["_apply_skin_pbr_texture_atlas", "_apply_skin_pbr_texture"],
  ["_apply_skin_pattern_texture"],
  ["_apply_skin_toon_cel"],
  ["_apply_skin_emissive_trim"],
  ["_apply_skin_multi_material"],
  ["_apply_skin_rim_fresnel"],
];
const expectedCorpseHelperGroups = [
  ["_apply_corpse_blood_saturation"],
  ["_apply_corpse_wound_cluster_decals", "_apply_corpse_wound_decals"],
  ["_apply_corpse_gore_pool"],
  ["_apply_corpse_charred_burned_texture", "_apply_corpse_charred"],
  ["_apply_corpse_exposed_bone_decals", "_apply_corpse_exposed_bone"],
  ["_apply_corpse_viscera_projection", "_apply_corpse_viscera"],
  ["_apply_corpse_dismemberment_baked", "_apply_corpse_dismemberment"],
  ["_apply_corpse_decay_desaturation", "_apply_corpse_decay"],
];

function scalePinsFromManifestBody() {
  const manifestPath = path.join(appDir, "shared-harness/art-kit/manifest.json");
  if (!existsSync(manifestPath)) {
    return { modelScaleMultiplier: Number.NaN, targetWorldHeight: Number.NaN };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return {
    modelScaleMultiplier: Number(manifest?.body?.modelScaleMultiplier),
    targetWorldHeight: Number(manifest?.body?.targetWorldHeight),
  };
}

const round10CharacterModelScale = 1.0;
const round10ScalePins = scalePinsFromManifestBody();
const round10BodyModelScaleMultiplier = round10ScalePins.modelScaleMultiplier;
const round10TargetWorldHeight = round10ScalePins.targetWorldHeight;
const round10AdherenceFamilies = ["bone_attached", "mesh_baked", "uv_painted"];
const round10MinimumModularArmorOverlays = 3;
const round10ArmorRegionPersonas = ["duelist", "camper", "paranoid"];
const round10SmallGorePersonas = ["duelist", "camper", "paranoid"];
const round10MinimumSmallGoreMarks = 6;
const round10MaximumSmallGoreBodyMarkAxis = 0.12;
const universalBodyFile = "characters/camper-mesh2motion-human-base.glb";
const universalBodySourceKey = "mesh2motion";
const weaponAttachModes = ["dynamic_hand_bone"];
const retiredWeaponAttachModes = ["static_root_socket"];
const armourRenderModes = ["modular_submesh_prop", "adhering_region"];
const retiredArmourRenderModes = ["armor_as_paint"];
const round10UvPaintedSkinApproaches = [
  "palette_flat",
  "pbr_texture_atlas",
  "pattern_texture",
  "toon_cel_shader",
  "emissive_trim_shader",
  "multi_material_split",
  "rim_fresnel_shader",
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

function assertAnyIncludes(source, needles, message) {
  assert(needles.some((needle) => source.includes(needle)), message);
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

function assertNear(actual, expected, tolerance, message) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ~= ${expected}`);
}

function escapeRegExp(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numericCliArg(source, flag) {
  const match = source.match(new RegExp(`${escapeRegExp(flag)}\\s+(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)`, "i"));
  return match ? Number(match[1]) : Number.NaN;
}

function markdownSectionMatchingHeading(source, headingPattern) {
  const headings = [...source.matchAll(/^##\s+.*$/gim)];
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i][0];
    if (!headingPattern.test(heading)) continue;
    const start = headings[i].index ?? 0;
    const end = i + 1 < headings.length ? headings[i + 1].index ?? source.length : source.length;
    return source.slice(start, end);
  }
  return "";
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

function artKitRelativePath(relativePath) {
  return path.join("shared-harness/art-kit", relativePath);
}

function isSafeRelativeArtKitPath(relativePath) {
  return (
    typeof relativePath === "string" &&
    relativePath.length > 0 &&
    !relativePath.startsWith("res://") &&
    !path.isAbsolute(relativePath) &&
    !relativePath.split(/[\\/]+/).includes("..")
  );
}

function assertArtKitPath(relativePath, context) {
  assert(isSafeRelativeArtKitPath(relativePath), `${context} is an art-kit-relative path: ${relativePath}`);
  if (!isSafeRelativeArtKitPath(relativePath)) return;
  const fullPath = path.join(appDir, artKitRelativePath(relativePath));
  assert(existsSync(fullPath), `${context} exists: ${relativePath}`);
  if (/\.png$/i.test(relativePath)) {
    assert(existsSync(`${fullPath}.import`), `${context} has Godot import sidecar: ${relativePath}`);
  }
}

function assertArtKitImportSidecar(relativePath, context) {
  if (!isSafeRelativeArtKitPath(relativePath)) return;
  if (!/\.(glb|gltf|fbx|png)$/i.test(relativePath)) return;
  const fullPath = path.join(appDir, artKitRelativePath(relativePath));
  assert(existsSync(`${fullPath}.import`), `${context} has Godot import sidecar: ${relativePath}`);
}

function sourcePackLabel(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && typeof value.name === "string") {
    return value.name.trim();
  }
  return "";
}

function assertSourcePack(block, context) {
  assert(sourcePackLabel(block?.sourcePack).length > 0, `${context}.sourcePack is declared`);
}

function assertAdherenceApproach(block, context, coverage) {
  const approach = typeof block?.adherenceApproach === "string" ? block.adherenceApproach : "";
  assert(round10AdherenceFamilies.includes(approach), `${context}.adherenceApproach is one of ${round10AdherenceFamilies.join(", ")}`);
  if (round10AdherenceFamilies.includes(approach)) {
    coverage.add(approach);
  }
}

function addAdherenceFamily(block, coverage) {
  const approach = typeof block?.adherenceApproach === "string" ? block.adherenceApproach : "";
  if (round10AdherenceFamilies.includes(approach)) {
    coverage.add(approach);
  }
}

function modeSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((value) => value?.mode).filter((mode) => typeof mode === "string" && mode.length > 0));
}

function collectNestedParamPaths(value, trail = "params") {
  const found = [];
  if (typeof value === "string") {
    if (/\.(png|gdshader)$/i.test(value)) {
      found.push({ value, trail });
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      found.push(...collectNestedParamPaths(value[i], `${trail}[${i}]`));
    }
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      found.push(...collectNestedParamPaths(nested, `${trail}.${key}`));
    }
  }
  return found;
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
  assertIncludes(sceneBuilder, "const WORLD_SCALE := 0.38", "SceneBuilder preserves Round-7 tile world scale");
  assertIncludes(sceneBuilder, "const WALL_COSMETIC_INSET_WORLD := 0.09", "SceneBuilder preserves Round-7 wall inset");
  assertIncludes(sceneBuilder, '_build_rects(map_data.get("walls", []), 1.15, mat_wall, "wall")', "SceneBuilder preserves Round-7 wall height");
  assertIncludes(sceneBuilder, '_build_rects(map_data.get("coverClusters", []), 0.42, mat_cover, "cover")', "SceneBuilder preserves Round-7 cover height");
  assertIncludes(sceneBuilder, "mesh.size = Vector3(float(size.get(\"w\", 100)) * WORLD_SCALE, 0.08, float(size.get(\"h\", 100)) * WORLD_SCALE)", "SceneBuilder preserves Round-7 floor slab height");
  assertIncludes(sceneBuilder, "Vector3(float(zone.get(\"w\", 3)) * WORLD_SCALE, 0.04, float(zone.get(\"h\", 3)) * WORLD_SCALE)", "SceneBuilder preserves Round-7 evac zone height");
  assertIncludes(sceneBuilder, "Vector3(0.46, 0.08, 0.46)", "SceneBuilder preserves Round-7 airdrop marker geometry");
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
  assertIncludes(entityRenderer, "instantiate_persona_corpse", "EntityRenderer uses persona corpse factory for Round-7 corpse path");
  assertNotIncludes(entityRenderer, "corpse_scene", "EntityRenderer no longer caches a standalone manifest corpse scene");
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
  assertNear(numericConstant(entityRenderer, "CHARACTER_MODEL_SCALE"), round10CharacterModelScale, 0.000001, "EntityRenderer preserves standard character model scale");
  assertMatches(entityRenderer, /CRATE_MODEL_SCALE\s*:=\s*0\.17/, "EntityRenderer halves crate model scale to 0.17");
  assertMatches(entityRenderer, /AIRDROP_CRATE_MODEL_SCALE\s*:=\s*0\.21/, "EntityRenderer keeps airdrop crate scale decoupled at Round-7 size");
  assertMatches(entityRenderer, /CORPSE_MODEL_SCALE\s*:=\s*CHARACTER_MODEL_SCALE/, "EntityRenderer keeps corpse scale coupled to character scale");
  const spawnCrates = entityRenderer.match(/func _spawn_crates\(\) -> void:([\s\S]*?)\n\nfunc _spawn_airdrops\(\) -> void:/)?.[1] ?? "";
  assert(spawnCrates.length > 0, "EntityRenderer exposes _spawn_crates body for scale audit");
  assertNotIncludes(spawnCrates, "CHARACTER_MODEL_SCALE", "_spawn_crates does not reference character scale");
  assertIncludes(spawnCrates, "Vector3.ONE * CRATE_MODEL_SCALE", "_spawn_crates uses crate scale on all fallback axes");
  const spawnAirdrops = entityRenderer.match(/func _spawn_airdrops\(\) -> void:([\s\S]*?)\n\nfunc _spawn_mist\(\) -> void:/)?.[1] ?? "";
  assert(spawnAirdrops.length > 0, "EntityRenderer exposes _spawn_airdrops body for scale audit");
  assertNotIncludes(spawnAirdrops, "CHARACTER_MODEL_SCALE", "_spawn_airdrops does not reference character scale");
  assertIncludes(spawnAirdrops, "Vector3.ONE * AIRDROP_CRATE_MODEL_SCALE", "_spawn_airdrops uses airdrop scale on all fallback axes");
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
    "body",
    "corpseBody",
    "weaponName",
    "armourName",
    "personaSlot",
    "handOffset",
    "character_scene_for_persona",
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
    "_apply_persona_skin",
    "_apply_persona_corpse_skin",
    "instantiate_persona_corpse",
    "apply_corpse_skin_to_live_character",
    "restore_persona_skin_to_live_character",
    "_apply_projected_mark",
    "Decal.new(",
    "QuadMesh.new(",
    "_palette_material",
    "armorOverlay",
    "armorRegion",
    "armor_overlay_nodes_by_character",
    "armor_region_nodes_by_character",
    "_apply_modular_submesh_armor",
    "_clear_modular_submesh_armor",
    "_apply_adhering_region_armour",
    "_clear_adhering_region_armour",
    "_ensure_dynamic_armour_socket",
    "ARMOUR_RENDER_REGION",
    "adherence_bone_attached",
    "adherence_mesh_baked",
    "adherence_uv_painted",
    "set_armour_render_mode",
    "apply_neutral_body_material",
    "dynamic_hand_bone",
    "static_root_socket",
    "WEAPON_SOCKET_FALLBACK_STATIC",
    "modular_submesh_prop",
    "adhering_region",
  ]) {
    assertIncludes(equipment, token, `EquipmentMeshAttachment handles ${token}`);
  }
  assertMatches(
    equipment,
    /const\s+WEAPON_SOCKET_FALLBACK_STATIC\s*:=\s*"static_root_socket"/,
    "EquipmentMeshAttachment keeps static_root_socket only as the internal fallback token",
  );
  assertNotIncludes(equipment, "func set_weapon_attach_mode", "EquipmentMeshAttachment has no public weapon attach-mode setter");
  assertNotIncludes(equipment, "armor_as_paint", "EquipmentMeshAttachment has no user-facing armor_as_paint mode token");
  assertNotIncludes(equipment, "_apply_skin_decal_stickers", "EquipmentMeshAttachment retired bone-pinned decal sticker skin helper");
  assertNotIncludes(equipment, '"decal_stickers"', "EquipmentMeshAttachment no longer matches decal_stickers skin approach");
  for (const helperGroup of expectedSkinHelperGroups) {
    assertAnyIncludes(equipment, helperGroup, `EquipmentMeshAttachment includes skin helper ${helperGroup.join(" or ")}`);
  }
  for (const helperGroup of expectedCorpseHelperGroups) {
    assertAnyIncludes(equipment, helperGroup, `EquipmentMeshAttachment includes corpse helper ${helperGroup.join(" or ")}`);
  }
  assertNotIncludes(equipment, "_apply_persona_palette", "EquipmentMeshAttachment retired old _apply_persona_palette token");
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
  assertNotIncludes(equipment, "bodyOverride", "EquipmentMeshAttachment has no bodyOverride body-substitution branch");
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
  assertIncludes(showroom, "AdherenceLayersBar", "Showroom exposes the Round-10 adherence layer toggle row");
  assertIncludes(showroom, '"%sLayerToggle"', "Showroom names layer toggles predictably");
  for (const token of ['"skin"', '"gore"', '"weapons"', '"armour"']) {
    assertIncludes(showroom, token, `Showroom exposes layer token ${token}`);
  }
  for (const token of ["set_armour_render_mode", "apply_neutral_body_material"]) {
    assertIncludes(showroom, token, `Showroom calls ${token} when layer state changes`);
  }
  for (const token of ["ARMOUR_RENDER_PROP", "ARMOUR_RENDER_REGION", "ArmourModeSwitch", "_set_armour_render_region", "modular_submesh_prop", "adhering_region"]) {
    assertIncludes(showroom, token, `Showroom exposes Round-10 armour prop/region switch token ${token}`);
  }
  assertNotIncludes(showroom, "set_weapon_attach_mode", "Showroom has no weapon attach-mode switch API call");
  assertNotIncludes(showroom, "WeaponAttach", "Showroom has no weapon attach-mode switch UI token");
  assertNotIncludes(showroom, "static_root_socket", "Showroom has no static_root_socket weapon mode token");
  assertNotIncludes(showroom, "armor_as_paint", "Showroom has no armor_as_paint armour mode token");
  assertNotIncludes(showroom, "ARMOUR_RENDER_PAINT", "Showroom retired the armour paint render constant");
  assertIncludes(showroom, "_reapply_showroom_layers", "Showroom routes layer/tier/mode changes through one reapply path");
  assertIncludes(showroom, "apply_corpse_skin_to_live_character", "Showroom Gore toggle applies corpse skin variants");
  assertIncludes(showroom, "restore_persona_skin_to_live_character", "Showroom non-death triggers restore persona skins");
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
  const triggerAnimationBody = showroom.match(/func _trigger_animation\(kind: String\) -> void:([\s\S]*?)\n\nfunc /)?.[1] ?? "";
  assert(triggerAnimationBody.length > 0, "Showroom exposes _trigger_animation body");
  assertNotIncludes(triggerAnimationBody, "apply_corpse_skin_to_live_character", "Showroom death clip is decoupled from gore application");
  assertNotIncludes(triggerAnimationBody, "restore_persona_skin_to_live_character", "Showroom animation triggers do not force skin restoration");
  assertNotMatches(showroom, /\bmode\s*=\s*.*MODE_ANCHORED/, "Showroom does not initialize CameraRig in MODE_ANCHORED");
  assertNotIncludes(showroom, "ConvexClient", "Showroom does not use ConvexClient");
  assertNotIncludes(showroom, "/replay", "Showroom does not call replay endpoints");
  for (const assetName of equipmentAssetNameLiterals) {
    assertNotMatches(showroom, new RegExp(`["']${assetName}["']`), `Showroom does not hardcode equipment asset literal ${assetName}`);
  }
}

if (existsSync(path.join(appDir, "shared-harness/art-kit/manifest.json"))) {
  const manifest = JSON.parse(read("shared-harness/art-kit/manifest.json"));
  assert(manifest.schemaVersion === 9, "d-full-match art manifest uses schemaVersion 9");
  assert(!("source" in manifest), "art manifest has no singleton top-level source");
  assert(!("license" in manifest), "art manifest has no singleton top-level license");
  assert(!("extraction" in manifest), "art manifest has no singleton top-level extraction");
  assert(manifest.body && typeof manifest.body === "object", "art manifest exposes root body block");
  assert(manifest.body?.sourceKey === universalBodySourceKey, 'manifest.body.sourceKey is "mesh2motion"');
  assert(manifest.body?.file === universalBodyFile, "manifest.body.file is the shared mesh2motion body");
  assert(manifest.body?.armourAttachBone === "spine", 'manifest.body.armourAttachBone preserves reserved value "spine"');
  assert(Number.isFinite(manifest.body?.modelScaleMultiplier), "manifest.body modelScaleMultiplier declares numeric Round-10 scale source");
  assert(Number.isFinite(manifest.body?.targetWorldHeight), "manifest.body targetWorldHeight declares numeric Round-10 scale source");
  assertArtKitPath(manifest.body?.file, "manifest.body.file");
  assert(manifest.body?.animation && typeof manifest.body.animation === "object", "manifest.body exposes animation block");
  for (const clipKind of expectedBodyAnimationKinds) {
    assert(
      typeof manifest.body?.animation?.[clipKind] === "string" && manifest.body.animation[clipKind].length > 0,
      `manifest.body.animation has ${clipKind} clip`,
    );
  }
  assert(manifest.corpseBody && typeof manifest.corpseBody === "object", "art manifest exposes root corpseBody block");
  assert(manifest.corpseBody?.file === manifest.body?.file, "manifest.corpseBody uses the shared mesh2motion body file");
  assert(typeof manifest.corpseBody?.deathPoseClip === "string" && manifest.corpseBody.deathPoseClip.length > 0, "manifest.corpseBody has deathPoseClip");
  assertNear(Number(manifest.corpseBody?.modelScaleMultiplier), round10BodyModelScaleMultiplier, 0.000001, "manifest.corpseBody modelScaleMultiplier mirrors body scale");
  assertNear(Number(manifest.corpseBody?.targetWorldHeight), round10TargetWorldHeight, 0.000001, "manifest.corpseBody targetWorldHeight mirrors body target");
  assert(Array.isArray(manifest.assets), "art manifest exposes assets array");
  const assets = manifest.assets ?? [];
  const personas = new Set();
  const characters = [];
  const skinApproaches = new Set();
  const corpseApproaches = new Set();
  const adherenceApproachCoverage = new Set();
  const layerAdherenceCoverage = {
    skin: new Set(),
    gore: new Set(),
    weapons: new Set(),
    armour: new Set(),
  };
  const manifestWeaponAttachModes = new Set();
  const manifestArmourModes = new Set();
  const armorOverlayDeclaredPersonas = new Set();
  const armorOverlayPersonas = new Set();
  const armorRegionPersonas = new Set();
  const accessoryPersonas = new Set();
  const effectiveBodyFiles = new Set();
  const effectiveBodySourceKeys = new Set();
  const forbiddenBodySubstitutionKey = "body" + "Override";
  const weapons = new Set();
  const armours = new Set();
  const corpseAssets = [];
  const environmentRoles = new Set();
  for (const asset of assets) {
    if (asset.category !== "character") {
      const relativePath = manifestAssetPath(asset);
      assert(typeof asset.file === "string" && asset.file.length > 0, `manifest asset has file: ${asset.id}`);
      assert(existsSync(path.join(appDir, relativePath)), `manifest asset file exists: ${asset.file}`);
      assert(asset.source && asset.source.pageUrl, `manifest asset has source URL: ${asset.id}`);
      assert(asset.license && asset.license.name && asset.license.url, `manifest asset has license metadata: ${asset.id}`);
      if (existsSync(path.join(appDir, relativePath))) {
        assert(statSync(path.join(appDir, relativePath)).size === asset.sizeBytes, `manifest sizeBytes matches: ${asset.file}`);
        assert(sha256(relativePath) === asset.sha256, `manifest sha256 matches: ${asset.file}`);
        if (/\.(glb|gltf|fbx|png)$/i.test(asset.file)) {
          assert(existsSync(path.join(appDir, `${relativePath}.import`)), `Godot import sidecar exists: ${asset.file}`);
        }
      }
    }
    assert(typeof asset.notes === "string" && asset.notes.length > 0, `manifest asset has notes: ${asset.id}`);
    if (asset.category === "character") {
      personas.add(asset.personaSlot);
      characters.push(asset);
      assert(typeof asset.personaSlot === "string" && asset.personaSlot.length > 0, `character has personaSlot: ${asset.id}`);
      for (const forbiddenKey of expectedCharacterForbiddenKeys) {
        assert(!(forbiddenKey in asset), `Round-7 character omits per-character ${forbiddenKey}: ${asset.id}`);
      }
      assert(!(forbiddenBodySubstitutionKey in asset), `manifest forbids bodyOverride key: ${asset.id}`);
      const effectiveBody = manifest.body;
      if (effectiveBody?.file) {
        effectiveBodyFiles.add(effectiveBody.file);
      }
      if (effectiveBody?.sourceKey) {
        effectiveBodySourceKeys.add(effectiveBody.sourceKey);
      }
      assert(effectiveBody?.file === universalBodyFile, `character resolves to universal mesh2motion body file: ${asset.id}`);
      assert(effectiveBody?.sourceKey === universalBodySourceKey, `character resolves to universal mesh2motion sourceKey: ${asset.id}`);
      assert(asset.skin && typeof asset.skin === "object", `character has skin block: ${asset.id}`);
      assert(typeof asset.skin?.approach === "string" && asset.skin.approach.length > 0, `character skin has approach: ${asset.id}`);
      assertAdherenceApproach(asset.skin, `${asset.id}.skin`, adherenceApproachCoverage);
      addAdherenceFamily(asset.skin, layerAdherenceCoverage.skin);
      assert(asset.skin?.adherenceApproach === "uv_painted", `Round-10 skin uses uv_painted adherence: ${asset.id}`);
      assert(asset.skin?.approach !== "decal_stickers", `Round-10 skin removes decal_stickers approach: ${asset.id}`);
      assert(asset.skin?.adherenceApproach !== "bone_attached", `Round-10 skin removes bone_attached skin family: ${asset.id}`);
      if (asset.personaSlot === "opportunist") {
        assert(round10UvPaintedSkinApproaches.includes(asset.skin?.approach), "opportunist skin approach is in the UV-painted family");
        assert(asset.skin?.adherenceApproach === "uv_painted", "opportunist skin adherence is uv_painted");
      }
      assertSourcePack(asset.skin, `${asset.id}.skin`);
      assert(typeof asset.skin?.rationale === "string" && asset.skin.rationale.length > 0, `character skin has rationale: ${asset.id}`);
      assert(asset.skin?.params && typeof asset.skin.params === "object", `character skin has params: ${asset.id}`);
      if (typeof asset.skin?.approach === "string" && asset.skin.approach.length > 0) {
        skinApproaches.add(asset.skin.approach);
      }
      for (const ref of collectNestedParamPaths(asset.skin?.params, `${asset.id}.skin.params`)) {
        assertArtKitPath(ref.value, ref.trail);
      }
      assert("accessories" in asset, `character declares accessories field: ${asset.id}`);
      if (asset.accessories != null) {
        accessoryPersonas.add(asset.personaSlot);
        assert(typeof asset.accessories === "object" && Array.isArray(asset.accessories.items), `character accessories has items array: ${asset.id}`);
        for (const item of asset.accessories.items ?? []) {
          if (item && typeof item.file === "string") {
            assertArtKitPath(item.file, `${asset.id}.accessories.items.file`);
          }
        }
      }
      assert(asset.corpse && typeof asset.corpse === "object", `character has corpse block: ${asset.id}`);
      assert(typeof asset.corpse?.approach === "string" && asset.corpse.approach.length > 0, `character corpse has approach: ${asset.id}`);
      assertAdherenceApproach(asset.corpse, `${asset.id}.corpse`, adherenceApproachCoverage);
      addAdherenceFamily(asset.corpse, layerAdherenceCoverage.gore);
      assertSourcePack(asset.corpse, `${asset.id}.corpse`);
      assert(typeof asset.corpse?.rationale === "string" && asset.corpse.rationale.length > 0, `character corpse has rationale: ${asset.id}`);
      assert(asset.corpse?.params && typeof asset.corpse.params === "object", `character corpse has params: ${asset.id}`);
      if (typeof asset.corpse?.approach === "string" && asset.corpse.approach.length > 0) {
        corpseApproaches.add(asset.corpse.approach);
      }
      for (const ref of collectNestedParamPaths(asset.corpse?.params, `${asset.id}.corpse.params`)) {
        assertArtKitPath(ref.value, ref.trail);
      }
      if (round10SmallGorePersonas.includes(asset.personaSlot)) {
        const decals = Array.isArray(asset.corpse?.params?.decals) ? asset.corpse.params.decals : [];
        assert(decals.length >= round10MinimumSmallGoreMarks, `${asset.id}.corpse has at least ${round10MinimumSmallGoreMarks} small gore marks`);
        let maxBodyMarkX = Number.NEGATIVE_INFINITY;
        let maxBodyMarkY = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < decals.length; i += 1) {
          const decal = decals[i];
          const size = Array.isArray(decal?.size) ? decal.size : [];
          const x = Number(size[0]);
          const y = Number(size[1]);
          assert(Number.isFinite(x) && Number.isFinite(y), `${asset.id}.corpse.params.decals[${i}] declares body mark x/y size`);
          maxBodyMarkX = Math.max(maxBodyMarkX, x);
          maxBodyMarkY = Math.max(maxBodyMarkY, y);
          assert(typeof decal?.bone === "string" && decal.bone.length > 0, `${asset.id}.corpse.params.decals[${i}] pins to a body bone`);
        }
        assert(
          Number.isFinite(maxBodyMarkX) &&
            Number.isFinite(maxBodyMarkY) &&
            maxBodyMarkX <= round10MaximumSmallGoreBodyMarkAxis &&
            maxBodyMarkY <= round10MaximumSmallGoreBodyMarkAxis,
          `${asset.id}.corpse small gore body marks stay <= ${round10MaximumSmallGoreBodyMarkAxis} on x/y (${maxBodyMarkX}x${maxBodyMarkY})`,
        );
      }
      assert("armorOverlay" in asset, `character declares armorOverlay field: ${asset.id}`);
      if ("armorOverlay" in asset) {
        armorOverlayDeclaredPersonas.add(asset.personaSlot);
        if (asset.armorOverlay != null) {
          armorOverlayPersonas.add(asset.personaSlot);
          assert(typeof asset.armorOverlay === "object" && !Array.isArray(asset.armorOverlay), `character armorOverlay is object when non-null: ${asset.id}`);
          assertAdherenceApproach(asset.armorOverlay, `${asset.id}.armorOverlay`, adherenceApproachCoverage);
          layerAdherenceCoverage.armour.add("bone_attached");
          assert(
            asset.armorOverlay?.adherenceApproach === "bone_attached",
            `character armorOverlay uses bone_attached adherence: ${asset.id}`,
          );
          assert(
            asset.armorOverlay?.approach === "modular_submesh_prop",
            `character armorOverlay declares modular_submesh_prop approach: ${asset.id}`,
          );
          assertSourcePack(asset.armorOverlay, `${asset.id}.armorOverlay`);
          assert(typeof asset.armorOverlay?.file === "string" && asset.armorOverlay.file.length > 0, `character armorOverlay has file: ${asset.id}`);
          if (typeof asset.armorOverlay?.file === "string") {
            assert(asset.armorOverlay.file.startsWith("armour/"), `character armorOverlay file lives under armour/: ${asset.id}`);
            assertArtKitPath(asset.armorOverlay.file, `${asset.id}.armorOverlay.file`);
            assertArtKitImportSidecar(asset.armorOverlay.file, `${asset.id}.armorOverlay.file`);
          }
        }
      }
      if ("armorRegion" in asset) {
        if (asset.armorRegion != null) {
          armorRegionPersonas.add(asset.personaSlot);
          assert(typeof asset.armorRegion === "object" && !Array.isArray(asset.armorRegion), `character armorRegion is object when non-null: ${asset.id}`);
          assert(asset.armorRegion?.approach === "adhering_region", `character armorRegion uses adhering_region approach: ${asset.id}`);
          assertAdherenceApproach(asset.armorRegion, `${asset.id}.armorRegion`, adherenceApproachCoverage);
          layerAdherenceCoverage.armour.add("bone_attached");
          assert(asset.armorRegion?.adherenceApproach === "bone_attached", `character armorRegion uses bone_attached adherence: ${asset.id}`);
          assertSourcePack(asset.armorRegion, `${asset.id}.armorRegion`);
          const decals = Array.isArray(asset.armorRegion?.params?.decals) ? asset.armorRegion.params.decals : [];
          assert(decals.length > 0, `character armorRegion declares donated projection decals: ${asset.id}`);
          for (let i = 0; i < decals.length; i += 1) {
            const decal = decals[i];
            assert(typeof decal?.bone === "string" && decal.bone.length > 0, `${asset.id}.armorRegion.params.decals[${i}] pins to a body bone`);
          }
          for (const ref of collectNestedParamPaths(asset.armorRegion?.params, `${asset.id}.armorRegion.params`)) {
            assertArtKitPath(ref.value, ref.trail);
          }
        }
      }
    } else if (asset.category === "weapon") {
      weapons.add(asset.weaponName);
      assert(asset.attachBone || asset.handOffset, `weapon asset has socket metadata: ${asset.id}`);
      assert(typeof asset.tier === "number", `weapon asset has tier: ${asset.id}`);
      assert(Array.isArray(asset.attachModes), `weapon asset declares Round-10 attachModes: ${asset.id}`);
      const assetAttachModes = modeSet(asset.attachModes);
      assert(assetAttachModes.size === weaponAttachModes.length, `weapon asset has dynamic-only attachModes: ${asset.id}`);
      for (const mode of weaponAttachModes) {
        assert(assetAttachModes.has(mode), `weapon asset supports ${mode}: ${asset.id}`);
      }
      for (const mode of retiredWeaponAttachModes) {
        assert(!assetAttachModes.has(mode), `weapon asset omits retired attach mode ${mode}: ${asset.id}`);
      }
      for (const modeBlock of asset.attachModes ?? []) {
        if (typeof modeBlock?.mode === "string") {
          manifestWeaponAttachModes.add(modeBlock.mode);
          layerAdherenceCoverage.weapons.add(modeBlock.mode);
        }
        assert(modeBlock?.adherenceApproach === "bone_attached", `weapon attach mode uses bone_attached adherence: ${asset.id}.${modeBlock?.mode}`);
      }
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
    assert(armorOverlayDeclaredPersonas.has(persona), `manifest declares armorOverlay for persona ${persona}`);
  }
  for (const persona of round10ArmorRegionPersonas) {
    assert(armorRegionPersonas.has(persona), `manifest maps Round-10 armorRegion donor persona ${persona}`);
  }
  assert(manifest.round9Adherence && typeof manifest.round9Adherence === "object", "manifest declares adherence metadata");
  assert(manifest.round9Adherence?.lockedBody?.file === universalBodyFile, "adherence metadata locks the mesh2motion body file");
  assert(manifest.round9Adherence?.lockedBody?.sourceKey === universalBodySourceKey, "adherence metadata locks the mesh2motion source key");
  const declaredWeaponModes = modeSet(manifest.round9Adherence?.weaponAttachModes);
  assert(declaredWeaponModes.size === weaponAttachModes.length, "manifest adherence metadata declares dynamic-only weapon attach modes");
  for (const mode of weaponAttachModes) {
    assert(declaredWeaponModes.has(mode), `manifest adherence metadata declares weapon attach mode ${mode}`);
    assert(manifestWeaponAttachModes.has(mode), `manifest weapon assets cover attach mode ${mode}`);
  }
  for (const mode of retiredWeaponAttachModes) {
    assert(!declaredWeaponModes.has(mode), `manifest adherence metadata omits retired weapon attach mode ${mode}`);
    assert(!manifestWeaponAttachModes.has(mode), `manifest weapon assets omit retired weapon attach mode ${mode}`);
  }
  const declaredArmourModes = modeSet(manifest.round9Adherence?.armorApproaches);
  assert(declaredArmourModes.size === armourRenderModes.length, "manifest adherence metadata declares prop/region armour modes only");
  for (const mode of armourRenderModes) {
    assert(declaredArmourModes.has(mode), `manifest adherence metadata declares armour mode ${mode}`);
    manifestArmourModes.add(mode);
  }
  for (const mode of retiredArmourRenderModes) {
    assert(!declaredArmourModes.has(mode), `manifest adherence metadata omits retired armour mode ${mode}`);
  }
  assert(!("armorAsPaint" in manifest), "manifest omits retired armorAsPaint approach");
  assert(effectiveBodyFiles.size === 1 && effectiveBodyFiles.has(universalBodyFile), "manifest character effective body files are the single mesh2motion root body");
  assert(
    effectiveBodySourceKeys.size === 1 && effectiveBodySourceKeys.has(universalBodySourceKey),
    "manifest character effective body source keys are the single mesh2motion root source",
  );
  assert(!skinApproaches.has("decal_stickers"), "manifest exposes no decal_stickers skin approach");
  assert(corpseApproaches.size === 8, "manifest exposes 8 distinct corpse.approach values");
  assert(
    armorOverlayPersonas.size >= round10MinimumModularArmorOverlays,
    `manifest has at least ${round10MinimumModularArmorOverlays} non-null modular armorOverlay entries`,
  );
  for (const family of round10AdherenceFamilies) {
    assert(adherenceApproachCoverage.has(family), `manifest adherenceApproach union covers ${family}`);
  }
  assert(layerAdherenceCoverage.skin.size === 1 && layerAdherenceCoverage.skin.has("uv_painted"), "skin layer is consolidated on uv_painted adherence");
  assert(layerAdherenceCoverage.gore.has("uv_painted") && layerAdherenceCoverage.gore.has("bone_attached") && layerAdherenceCoverage.gore.has("mesh_baked"), "gore layer covers uv_painted, bone_attached, and mesh_baked approaches");
  assert(layerAdherenceCoverage.weapons.size === 1 && layerAdherenceCoverage.weapons.has("dynamic_hand_bone"), "weapons layer is dynamic_hand_bone only");
  assert(layerAdherenceCoverage.armour.has("bone_attached"), "armour layer uses body-tracking bone_attached prop/region approaches");
  console.log(
    `Round-10 adherence matrix: skin=${[...layerAdherenceCoverage.skin].join(",")} gore=${[...layerAdherenceCoverage.gore].join(",")} weapons=${[...layerAdherenceCoverage.weapons].join(",")} armour=${[...declaredArmourModes].join(",")}`,
  );
  assert(accessoryPersonas.size === 0 || accessoryPersonas.size < characters.length, "accessories are null for all personas or not coupled 1:1 to all skins");
  for (const weapon of ["rusty_blade", "dagger", "sword", "axe", "greatsword", "warhammer"]) {
    assert(weapons.has(weapon), `manifest maps weapon ${weapon}`);
  }
  for (const armour of ["cloth", "leather", "chain", "plate", "riot_plate"]) {
    assert(armours.has(armour), `manifest maps armour ${armour}`);
  }
  assert(corpseAssets.length === 0, "manifest no longer includes standalone corpse assets");
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
  assertIncludes(testScript, "scripts/audit-mesh2motion-clips.gd", "package test invokes audit-mesh2motion-clips.gd");
  assertIncludes(testScript, "scripts/verify-character-rigs.gd", "package test invokes verify-character-rigs.gd");
  assertIncludes(testScript, "scripts/audit-universal-body.gd", "package test invokes audit-universal-body.gd");
  assertIncludes(testScript, "scripts/audit-adherence-matrix.gd", "package test invokes audit-adherence-matrix.gd");
  assertNotIncludes(testScript, "audit-body-source-provenance", "package test no longer invokes the old body-source provenance audit");
  assertIncludes(testScript, "scripts/audit-replay-load.gd", "package test invokes audit-replay-load.gd");
  assertIncludes(testScript, "scripts/audit-skin-bone-attachments.gd", "package test invokes audit-skin-bone-attachments.gd");
  assertIncludes(testScript, "scripts/audit-modular-submesh-armor.gd", "package test invokes audit-modular-submesh-armor.gd");
  assertIncludes(testScript, "--assert", "package test runs character scale audit in assert mode");
  assertNear(numericCliArg(testScript, "--target-world-height"), round10TargetWorldHeight, 0.000001, "package test passes synchronized Round-10 target world height");
  assertNear(numericCliArg(testScript, "--character-model-scale"), round10CharacterModelScale, 0.000001, "package test passes synchronized Round-10 character model scale");
  assertIncludes(testScript, "audit-character-scales: skipped (GODOT_BIN unset)", "package test logs clear scale-audit skip when GODOT_BIN is unset");
  assertIncludes(testScript, "Round-10 Godot audits: skipped (GODOT_BIN unset)", "package test logs clear Round-10 audit skip when GODOT_BIN is unset");
  assertIncludes(testScript, "audit-universal-body", "package test logs or runs universal-body audit");
  assertIncludes(testScript, "audit-adherence-matrix", "package test logs or runs adherence-matrix audit");
}

if (existsSync(path.join(appDir, "scripts/audit-character-scales.gd"))) {
  const auditCharacterScales = read("scripts/audit-character-scales.gd");
  assertIncludes(auditCharacterScales, "--target-world-height", "character scale audit accepts target world height");
  assertIncludes(auditCharacterScales, "--character-model-scale", "character scale audit accepts explicit character model scale");
  assertIncludes(auditCharacterScales, "ENTITY_RENDERER_PATH", "character scale audit can parse EntityRenderer scale");
  assertIncludes(auditCharacterScales, "source_height * character_model_scale * committed", "character scale audit computes effective world height");
}

if (existsSync(path.join(appDir, "scripts/audit-skin-bone-attachments.gd"))) {
  const auditSkinBoneAttachments = read("scripts/audit-skin-bone-attachments.gd");
  for (const token of ["adherenceApproach", "sourcePack", "armorOverlay", "armorRegion", "adhering_region", "modular_submesh_prop"]) {
    assertIncludes(auditSkinBoneAttachments, token, `skin/bone attachment audit validates Round-10 ${token}`);
  }
  assertIncludes(auditSkinBoneAttachments, "adherence_coverage", "skin/bone attachment audit tracks adherenceApproach coverage");
  assertIncludes(auditSkinBoneAttachments, "BASE_SCALE := 1.0", "skin/bone attachment audit uses Round-10 standard base scale");
  assertIncludes(auditSkinBoneAttachments, "MESH2MOTION_MARK_BONES", "skin/bone attachment audit validates marks against mesh2motion bones");
  assertIncludes(auditSkinBoneAttachments, "MIN_DONOR_GORE_MARKS", "skin/bone attachment audit enforces donor gore mark count");
  assertIncludes(auditSkinBoneAttachments, "MAX_SMALL_BODY_MARK_XY", "skin/bone attachment audit enforces small gore mark dimensions");
  assertIncludes(auditSkinBoneAttachments, "_apply_skin_decal_stickers", "skin/bone attachment audit rejects retired skin decal helper if present");
  assertNotIncludes(auditSkinBoneAttachments, "bodyOverride", "skin/bone attachment audit avoids bodyOverride-tolerant branches");
}

if (existsSync(path.join(appDir, "scripts/audit-modular-submesh-armor.gd"))) {
  const auditModularArmor = read("scripts/audit-modular-submesh-armor.gd");
  for (const token of ["armorOverlay", "modular_submesh_prop", "sourcePack", "armour/", "armor_overlay_nodes_by_character", "bindBone", "BoneAttachment3D"]) {
    assertIncludes(auditModularArmor, token, `modular armor audit validates Round-10 ${token}`);
  }
  assertIncludes(auditModularArmor, "MIN_MODULAR_ARMOR_OVERLAYS", "modular armor audit enforces minimum non-null overlays");
  assertIncludes(auditModularArmor, "MESH2MOTION_ARMOR_BIND_BONES", "modular armor audit validates bindBone against mesh2motion bones");
  assertIncludes(auditModularArmor, "_ensure_modular_armor_skin", "modular armor audit rejects retired Skin-bind helper if present");
  assertNotIncludes(auditModularArmor, "bodyOverride", "modular armor audit avoids bodyOverride-tolerant branches");
}

if (existsSync(path.join(appDir, "scripts/audit-universal-body.gd"))) {
  const auditUniversalBody = read("scripts/audit-universal-body.gd");
  for (const token of ["UNIVERSAL_BODY_FILE", universalBodyFile, "UNIVERSAL_SOURCE_KEY", universalBodySourceKey, "PERSONAS", "REQUIRED_SHARED_CLIPS", "Skeleton3D"]) {
    assertIncludes(auditUniversalBody, token, `universal-body audit validates ${token}`);
  }
  assertNotIncludes(auditUniversalBody, "bodyOverride", "universal-body audit avoids bodyOverride-tolerant branches");
  for (const retiredBodyPackToken of ["Quaternius-PolyPizzaIndividual-CC0", "Kaykit-Adventurers-CC0", "Kenney-"]) {
    assertNotIncludes(auditUniversalBody, retiredBodyPackToken, `universal-body audit has no Round-8.1 foreign body pack token ${retiredBodyPackToken}`);
  }
}

if (existsSync(path.join(appDir, "scripts/audit-adherence-matrix.gd"))) {
  const auditAdherenceMatrix = read("scripts/audit-adherence-matrix.gd");
  for (const token of [
    "WEAPON_DYNAMIC",
    "RETIRED_WEAPON_STATIC",
    "ARMOUR_PROP",
    "ARMOUR_REGION",
    "RETIRED_ARMOUR_PAINT",
    "EXPECTED_SCHEMA_VERSION := 9",
    "last_applied_skin_approach",
    "last_applied_corpse_approach",
    "weaponSocketKind",
    "usesArmourRegion",
    "usesModularArmour",
  ]) {
    assertIncludes(auditAdherenceMatrix, token, `adherence-matrix audit validates ${token}`);
  }
  assertNotIncludes(auditAdherenceMatrix, "bodyOverride", "adherence-matrix audit avoids bodyOverride-tolerant branches");
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
  const blindValidationTokens = [
    "browser" + "tools",
    "chrom" + "ium",
    "play" + "wright",
    "pupp" + "eteer",
    "screen" + "shot",
    "visual" + " uat",
    "browser" + "-mediated",
    "headless" + " visual",
  ];
  for (const banned of blindValidationTokens) {
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

if (existsSync(path.join(appDir, "ROUND-10-CLOSING-READOUT.md"))) {
  const readout = read("ROUND-10-CLOSING-READOUT.md");
  for (const token of [
    "Consolidated Lane Matrix",
    "Honest Limitations",
    "dynamic_hand_bone",
    "modular_submesh_prop",
    "adhering_region",
    "small localized",
    "uv_painted",
    "BoneAttachment3D",
  ]) {
    assertIncludes(readout, token, `Round-10 closing readout documents ${token}`);
  }
  const scaleEvidenceSection = markdownSectionMatchingHeading(readout, /\b(?:scale|calibration|evidence)\b/i);
  assert(scaleEvidenceSection.length > 0, "Round-10 closing readout includes a scale calibration/evidence section");
  for (const token of ["targetWorldHeight", "modelScaleMultiplier"]) {
    assertIncludes(scaleEvidenceSection, token, `Round-10 scale calibration/evidence section documents ${token}`);
  }
}

if (existsSync(path.join(appDir, "IMPLEMENTATION-SUMMARY.md"))) {
  const summary = read("IMPLEMENTATION-SUMMARY.md");
  assertIncludes(summary, "## Showroom Mode", "IMPLEMENTATION-SUMMARY documents Showroom mode");
  assertIncludes(summary, "7 animation triggers", "IMPLEMENTATION-SUMMARY documents Showroom trigger count");
  assertIncludes(summary, "Weapon", "IMPLEMENTATION-SUMMARY documents weapon tier selectors");
  assertIncludes(summary, "Armor", "IMPLEMENTATION-SUMMARY documents armor tier selectors");
  assertIncludes(summary, "free camera", "IMPLEMENTATION-SUMMARY documents Showroom free camera");
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
const godotBin = process.env.GODOT_BIN || null;
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
