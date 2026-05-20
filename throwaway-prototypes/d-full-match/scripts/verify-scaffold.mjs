#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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
  "scripts/export-web.mjs",
  "scripts/serve.mjs",
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
}

if (existsSync(path.join(appDir, "src/EntityRenderer.gd"))) {
  const entityRenderer = read("src/EntityRenderer.gd");
  for (const token of ["characters", "corpses", "crates", "airdrops", "sample_turn", "update_to_turn"]) {
    assertIncludes(entityRenderer, token, `EntityRenderer handles ${token}`);
  }
  for (const token of ["telegraphed", "landed", "spent", "opened"]) {
    assertIncludes(entityRenderer, token, `EntityRenderer differentiates ${token} state`);
  }
  assertIncludes(entityRenderer, "Astronaut.glb", "EntityRenderer uses astronaut model");
  assertIncludes(entityRenderer, "Pickup Crate.glb", "EntityRenderer uses crate model");
  assertNotIncludes(entityRenderer, "speech", "EntityRenderer does not render speech in 3D");
}

if (existsSync(path.join(appDir, "src/PlaybackClock.gd"))) {
  const clock = read("src/PlaybackClock.gd");
  for (const token of ["signal turn_changed", "current_turn", "is_playing", "speed", "scrub_to", "set_speed", "get_current_turn"]) {
    assertIncludes(clock, token, `PlaybackClock provides ${token}`);
  }
  for (const multiplier of ["0.5", "1.0", "2.0"]) {
    assertIncludes(clock, multiplier, `PlaybackClock supports ${multiplier}x speed`);
  }
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
}

if (existsSync(path.join(appDir, "scenes/MatchPlayer.tscn"))) {
  const scene = read("scenes/MatchPlayer.tscn");
  for (const token of ["SceneBuilder", "EntityRenderer", "PlaybackClock", "TimelineHud", "CameraRig"]) {
    assertIncludes(scene, token, `MatchPlayer scene contains ${token}`);
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
