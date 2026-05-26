#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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
  "src/AppState.gd",
  "src/ConvexClient.gd",
  "src/MatchPicker.gd",
  "src/MatchPlayer.gd",
  "src/SceneBuilder.gd",
  "src/EntityRenderer.gd",
  "src/PlaybackClock.gd",
  "src/TimelineHud.gd",
  "src/CameraRig.gd",
  "src/CombatVfx.gd",
  "src/EquipmentMeshAttachment.gd",
  "scripts/export-web.mjs",
  "scripts/serve.mjs",
  "shared-harness/art-kit/manifest.json",
];

const checks = [];

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
  assertIncludes(entityRenderer, "character_scene_for_persona", "EntityRenderer loads persona models from manifest");
  assertIncludes(entityRenderer, "personaId", "EntityRenderer maps snapshot personaId to manifest personaSlot");
  assertIncludes(entityRenderer, "corpse_scene", "EntityRenderer uses manifest corpse asset");
  assertIncludes(entityRenderer, "update_equipment", "EntityRenderer updates equipment attachment from equippedByCharacter");
  assertIncludes(entityRenderer, "equippedByCharacter", "EntityRenderer reads frame equippedByCharacter");
  assertIncludes(entityRenderer, "play_attack_pose", "EntityRenderer exposes attack animation hook");
  assertIncludes(entityRenderer, "mark_lethal_target", "EntityRenderer exposes lethal death hook");
  assertIncludes(entityRenderer, "play_wall_slam", "EntityRenderer exposes wall face-slam hook");
  assertIncludes(entityRenderer, "play_loot_pickup", "EntityRenderer exposes loot animation hook");
  assertIncludes(entityRenderer, "mark_loot_source", "EntityRenderer exposes loot source empty/fade hook");
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
  ]) {
    assertIncludes(equipment, token, `EquipmentMeshAttachment handles ${token}`);
  }
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

if (existsSync(path.join(appDir, "shared-harness/art-kit/manifest.json"))) {
  const manifest = JSON.parse(read("shared-harness/art-kit/manifest.json"));
  assert(manifest.schemaVersion === 2, "d-full-match art manifest uses schemaVersion 2");
  assert(!("source" in manifest), "art manifest has no singleton top-level source");
  assert(!("license" in manifest), "art manifest has no singleton top-level license");
  assert(!("extraction" in manifest), "art manifest has no singleton top-level extraction");
  assert(Array.isArray(manifest.assets), "art manifest exposes assets array");
  const assets = manifest.assets ?? [];
  const personas = new Set();
  const characterSources = new Set();
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
      if (/\.(glb|png)$/i.test(asset.file)) {
        assert(existsSync(path.join(appDir, `${relativePath}.import`)), `Godot import sidecar exists: ${asset.file}`);
      }
    }
    if (asset.category === "character") {
      personas.add(asset.personaSlot);
      characterSources.add(asset.source.creator || asset.source.pageUrl);
      assert("pivotYOffset" in asset, `character asset has pivotYOffset: ${asset.id}`);
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
  for (const persona of ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]) {
    assert(personas.has(persona), `manifest maps persona ${persona}`);
  }
  assert(characterSources.size >= 3, "manifest character assets represent at least 3 source lanes");
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

for (const codeFile of [
  "src/CombatVfx.gd",
  "src/EquipmentMeshAttachment.gd",
  "src/EntityRenderer.gd",
  "src/CameraRig.gd",
  "src/MatchPlayer.gd",
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
  assert(readme.includes("#convex="), "README documents convex hash plumbing");
  assert(readme.includes("NO UAT"), "README documents blind/no-UAT posture");
}

if (existsSync(path.join(appDir, "scripts/export-web.mjs"))) {
  const exportScript = read("scripts/export-web.mjs");
  assert(exportScript.includes("DEFAULT_CONVEX_URL"), "export script accepts build-time default");
  assert(exportScript.includes("__d_full_match_config"), "export script injects runtime config");
  assert(exportScript.includes("d-full-match-custom-loader"), "export script carries custom loader marker");
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
