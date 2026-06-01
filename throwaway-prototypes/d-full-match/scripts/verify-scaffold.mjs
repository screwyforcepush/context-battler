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
  "ROUND-11-CLOSING-READOUT.md",
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
  ["_apply_skin_pbr_texture_atlas", "_apply_skin_pbr_texture"],
  ["_apply_skin_pattern_texture"],
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

const round11CharacterModelScale = 1.0;
const round11ScalePins = scalePinsFromManifestBody();
const round11BodyModelScaleMultiplier = round11ScalePins.modelScaleMultiplier;
const round11TargetWorldHeight = round11ScalePins.targetWorldHeight;
const round11AdherenceFamilies = ["bone_attached", "mesh_baked", "uv_painted"];
const round11MinimumModularArmorOverlays = 3;
const round11LiveCorpseApproach = "small_bone_attached_marks";
const round11DeathTreatmentApproach = "dismemberment_baked";
const round11DeathTreatmentMethod = "bone_hide";
const round11MinimumSmallGoreMarks = 10;
const round11MaximumSmallGoreBodyMarkAxis = 0.12;
const round11RequiredLiveCorpseMarkType = "splash";
const retiredLiveCorpseApproaches = ["blood_saturation_overlay", "charred_burned_texture", "decay_desaturation", "gore_pool_decal"];
const mesh2motionGoreBones = ["spine_01", "spine_02", "spine_03", "upperarm_l", "lowerarm_r", "thigh_l", "head", "hand_l", "hand_r"];
const universalBodyFile = "characters/camper-mesh2motion-human-base.glb";
const universalBodySourceKey = "mesh2motion";
const weaponAttachModes = ["dynamic_hand_bone"];
const retiredWeaponAttachModes = ["static_root_socket"];
const armourRenderModes = ["modular_submesh_prop"];
const retiredArmourRenderModes = ["armor_as_paint", "adhering" + "_region"];
const armourPropScaleDefault = 0.38;
const round11MinimumArmourPropCatalogCount = 6;
const round11ArmourPropCatalogIds = [
  "armour_prop.existing.quaternius_metal_cuirass",
  "armour_prop.existing.quaternius_crown_helmet",
  "armour_prop.existing.quaternius_left_gauntlet",
  "armour_prop.round11.quaternius_leather_cuirass",
  "armour_prop.round11.quaternius_black_cuirass",
  "armour_prop.round11.oga_bucket_helmet",
];
const round11StagedArmourPropIds = [
  "armour_prop.round11.quaternius_leather_cuirass",
  "armour_prop.round11.quaternius_black_cuirass",
  "armour_prop.round11.oga_bucket_helmet",
];
const retiredArmourRegionTokens = [
  "adhering" + "_region",
  "armor" + "Region",
  "armor" + "_region" + "_nodes_by_character",
  "uses" + "Armour" + "Region",
  "_" + "armour" + "_region" + "_tint",
  "ARMOUR_RENDER" + "_REGION",
  ["round", "10", "Armor", "Region", "Personas"].join(""),
];
const retiredArmourRegionOwnedFiles = [
  "shared-harness/art-kit/manifest.json",
  "src/EquipmentMeshAttachment.gd",
  "src/Showroom.gd",
  "scripts/verify-scaffold.mjs",
  "scripts/audit-adherence-matrix.gd",
  "scripts/audit-modular-submesh-armor.gd",
  "scripts/audit-skin-bone-attachments.gd",
];
const round11SkinApproaches = [
  "pbr_texture_atlas",
  "pattern_texture",
];
const retiredPersonaSkinApproaches = [
  "palette_flat",
  "toon_cel_shader",
  "emissive_trim_shader",
  "multi_material_split",
  "rim_fresnel_shader",
];
const round11Uv2SkinShaderTokens = ["uv2_body_texture", "UV2"];

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

function assertRetiredArmourRegionTokensAbsent(relativePath, source) {
  for (const token of retiredArmourRegionTokens) {
    assertNotIncludes(source, token, `${relativePath} omits retired flat armour token`);
  }
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

function assertCc0License(block, context) {
  assert(block?.license && typeof block.license === "object", `${context}.license is declared`);
  assert(block?.license?.spdx === "CC0-1.0", `${context}.license.spdx is CC0-1.0`);
  assert(typeof block?.license?.url === "string" && block.license.url.includes("creativecommons.org/publicdomain/zero/1.0"), `${context}.license.url records CC0`);
  assert(block?.license?.attributionRequired === false, `${context}.license.attributionRequired is false`);
}

function assertArmourPropCatalogEntry(prop, context) {
  assert(prop && typeof prop === "object" && !Array.isArray(prop), `${context} is an object`);
  assert(typeof prop?.id === "string" && prop.id.startsWith("armour_prop."), `${context}.id is a stable armour_prop id`);
  assert(typeof prop?.name === "string" && prop.name.length > 0, `${context}.name is declared`);
  assert(typeof prop?.slot === "string" && prop.slot.length > 0, `${context}.slot is declared`);
  assert(prop?.approach === "modular_submesh_prop", `${context}.approach is modular_submesh_prop`);
  assert(prop?.adherenceApproach === "bone_attached", `${context}.adherenceApproach is bone_attached`);
  assert(typeof prop?.file === "string" && prop.file.startsWith("armour/"), `${context}.file lives under armour/`);
  assertArtKitPath(prop?.file, `${context}.file`);
  assertArtKitImportSidecar(prop?.file, `${context}.file`);
  assert(typeof prop?.bindBone === "string" && prop.bindBone.length > 0, `${context}.bindBone is declared`);
  assert(
    Number.isFinite(Number(prop?.propScale)) && Number(prop.propScale) > 0 && Number(prop.propScale) <= 1,
    `${context}.propScale is a positive body-fit scale <= 1`,
  );
  assert(prop?.source && typeof prop.source === "object" && typeof prop.source.pageUrl === "string" && prop.source.pageUrl.length > 0, `${context}.source.pageUrl is declared`);
  assert(typeof prop?.source?.creator === "string" && prop.source.creator.length > 0, `${context}.source.creator is declared`);
  assertCc0License(prop, context);
  assert(typeof prop?.sha256 === "string" && /^[a-f0-9]{64}$/.test(prop.sha256), `${context}.sha256 is a hex digest`);
  if (typeof prop?.file === "string" && isSafeRelativeArtKitPath(prop.file)) {
    const relativePath = artKitRelativePath(prop.file);
    if (existsSync(path.join(appDir, relativePath))) {
      assert(sha256(relativePath) === prop.sha256, `${context}.sha256 matches file content`);
    }
  }
  for (const [index, companion] of (Array.isArray(prop?.companionFiles) ? prop.companionFiles : []).entries()) {
    const companionContext = `${context}.companionFiles[${index}]`;
    assert(typeof companion?.file === "string" && companion.file.length > 0, `${companionContext}.file is declared`);
    assertArtKitPath(companion?.file, `${companionContext}.file`);
    assertArtKitImportSidecar(companion?.file, `${companionContext}.file`);
    assert(typeof companion?.sha256 === "string" && /^[a-f0-9]{64}$/.test(companion.sha256), `${companionContext}.sha256 is a hex digest`);
    if (typeof companion?.file === "string" && isSafeRelativeArtKitPath(companion.file)) {
      const relativePath = artKitRelativePath(companion.file);
      if (existsSync(path.join(appDir, relativePath))) {
        assert(sha256(relativePath) === companion.sha256, `${companionContext}.sha256 matches file content`);
      }
    }
  }
}

function assertAdherenceApproach(block, context, coverage) {
  const approach = typeof block?.adherenceApproach === "string" ? block.adherenceApproach : "";
  assert(round11AdherenceFamilies.includes(approach), `${context}.adherenceApproach is one of ${round11AdherenceFamilies.join(", ")}`);
  if (round11AdherenceFamilies.includes(approach)) {
    coverage.add(approach);
  }
}

function addAdherenceFamily(block, coverage) {
  const approach = typeof block?.adherenceApproach === "string" ? block.adherenceApproach : "";
  if (round11AdherenceFamilies.includes(approach)) {
    coverage.add(approach);
  }
}

function assertLiveCorpseGore(asset) {
  const corpse = asset?.corpse ?? {};
  assert(corpse.approach === round11LiveCorpseApproach, `${asset.id}.corpse uses locked live gore approach ${round11LiveCorpseApproach}`);
  assert(corpse.adherenceApproach === "bone_attached", `${asset.id}.corpse live gore is bone_attached`);
  for (const retired of retiredLiveCorpseApproaches) {
    assert(corpse.approach !== retired, `${asset.id}.corpse omits retired live gore approach ${retired}`);
  }
  const decals = Array.isArray(corpse?.params?.decals) ? corpse.params.decals : [];
  assert(decals.length >= round11MinimumSmallGoreMarks, `${asset.id}.corpse has at least ${round11MinimumSmallGoreMarks} live gore marks`);
  assert(
    decals.some((decal) => decal?.markType === round11RequiredLiveCorpseMarkType),
    `${asset.id}.corpse includes a ${round11RequiredLiveCorpseMarkType} live gore mark`,
  );
  for (let i = 0; i < decals.length; i += 1) {
    const decal = decals[i];
    const context = `${asset.id}.corpse.params.decals[${i}]`;
    const size = Array.isArray(decal?.size) ? decal.size : [];
    const x = Number(size[0]);
    const y = Number(size[1]);
    assert(Number.isFinite(x) && Number.isFinite(y), `${context} declares body mark x/y size`);
    assert(
      Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= round11MaximumSmallGoreBodyMarkAxis && Math.abs(y) <= round11MaximumSmallGoreBodyMarkAxis,
      `${context} body mark x/y stays <= ${round11MaximumSmallGoreBodyMarkAxis}`,
    );
    assert(typeof decal?.bone === "string" && mesh2motionGoreBones.includes(decal.bone), `${context} pins to a valid mesh2motion bone`);
    assert(decal?.projection !== "floor", `${context} is not floor-projected`);
  }
}

function assertCorpseDeathTreatment(asset, adherenceCoverage, layerCoverage) {
  const deathTreatment = asset?.corpse?.deathTreatment;
  const context = `${asset.id}.corpse.deathTreatment`;
  assert(deathTreatment && typeof deathTreatment === "object" && !Array.isArray(deathTreatment), `${context} is declared`);
  assert(deathTreatment?.approach === round11DeathTreatmentApproach, `${context}.approach is ${round11DeathTreatmentApproach}`);
  assert(deathTreatment?.adherenceApproach === "mesh_baked", `${context}.adherenceApproach is mesh_baked`);
  assertSourcePack(deathTreatment, context);
  assertAdherenceApproach(deathTreatment, context, adherenceCoverage);
  addAdherenceFamily(deathTreatment, layerCoverage);
  assert(deathTreatment?.params && typeof deathTreatment.params === "object", `${context}.params is declared`);
  const params = deathTreatment?.params ?? {};
  assert(params.method === round11DeathTreatmentMethod, `${context}.params.method is ${round11DeathTreatmentMethod}`);
  const hideBones = Array.isArray(params.hideBones) ? params.hideBones : [];
  assert(hideBones.length > 0, `${context}.params.hideBones is non-empty`);
  for (const [index, bone] of hideBones.entries()) {
    assert(mesh2motionGoreBones.includes(bone), `${context}.params.hideBones[${index}] is a valid mesh2motion bone`);
  }
  const stumpDecals = Array.isArray(params.stumpDecals) ? params.stumpDecals : [];
  assert(stumpDecals.length > 0, `${context}.params.stumpDecals is non-empty`);
  assert(Number(params.fallbackBoneScale) === 0.01, `${context}.params.fallbackBoneScale is 0.01`);
  for (let i = 0; i < stumpDecals.length; i += 1) {
    const decal = stumpDecals[i];
    const decalContext = `${context}.params.stumpDecals[${i}]`;
    assert(typeof decal?.bone === "string" && mesh2motionGoreBones.includes(decal.bone), `${decalContext} pins to a valid mesh2motion bone`);
    assert(decal?.projection !== "floor", `${decalContext} is mesh-baked/body attached, not floor-projected`);
  }
  for (const ref of collectNestedParamPaths(params, `${context}.params`)) {
    assertArtKitPath(ref.value, ref.trail);
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

for (const file of retiredArmourRegionOwnedFiles) {
  if (existsSync(path.join(appDir, file))) {
    assertRetiredArmourRegionTokensAbsent(file, read(file));
  }
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
  assertNear(numericConstant(entityRenderer, "CHARACTER_MODEL_SCALE"), round11CharacterModelScale, 0.000001, "EntityRenderer preserves standard character model scale");
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
    "armor_overlay_nodes_by_character",
    "_apply_modular_submesh_armor",
    "_clear_modular_submesh_armor",
    "_ensure_dynamic_armour_socket",
    "propScale",
    "_armour_prop_scale",
    "_scaled_transform",
    "set_armour_prop_selection",
    "currentArmourPropSelection",
    "armour_prop_catalog_by_id",
    "_selected_armour_prop_for_character",
    "_normalized_armour_prop_selection",
    "adherence_bone_attached",
    "adherence_mesh_baked",
    "adherence_uv_painted",
    "set_armour_render_mode",
    "apply_neutral_body_material",
    "dynamic_hand_bone",
    "static_root_socket",
    "WEAPON_SOCKET_FALLBACK_STATIC",
    "modular_submesh_prop",
    "small_bone_attached_marks",
    ...round11Uv2SkinShaderTokens,
  ]) {
    assertIncludes(equipment, token, `EquipmentMeshAttachment handles ${token}`);
  }
  assertMatches(
    equipment,
    /"pbr_texture_atlas"[\s\S]*_apply_skin_pbr_texture[\s\S]*_uv2_body_texture_material/,
    "EquipmentMeshAttachment routes pbr_texture_atlas through the UV2 body texture material",
  );
  assertMatches(
    equipment,
    /"pattern_texture"[\s\S]*_apply_skin_pattern_texture[\s\S]*_uv2_body_texture_material/,
    "EquipmentMeshAttachment routes pattern_texture through the UV2 body texture material",
  );
  assertMatches(
    equipment,
    /mesh\.transform\s*=\s*_scaled_transform\(\s*local_transform,\s*prop_scale\s*\)/,
    "EquipmentMeshAttachment folds propScale into each child mesh transform",
  );
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
  assertIncludes(showroom, "AdherenceLayersBar", "Showroom exposes the Round-11 adherence layer toggle row");
  assertIncludes(showroom, '"%sLayerToggle"', "Showroom names layer toggles predictably");
  for (const token of ['"skin"', '"gore"', '"weapons"', '"armour"']) {
    assertIncludes(showroom, token, `Showroom exposes layer token ${token}`);
  }
  for (const token of ["set_armour_render_mode", "apply_neutral_body_material"]) {
    assertIncludes(showroom, token, `Showroom calls ${token} when layer state changes`);
  }
  for (const token of ["ARMOUR_RENDER_PROP", "modular_submesh_prop"]) {
    assertIncludes(showroom, token, `Showroom keeps single armour prop token ${token}`);
  }
  for (const token of ["OptionButton", "ArmourAssetSelector", "armourProps", "set_armour_prop_selection"]) {
    assertIncludes(showroom, token, `Showroom exposes Round-11 armour asset selector token ${token}`);
  }
  assertNotIncludes(showroom, "ArmourModeSwitch", "Showroom removes the retired armour mode switch");
  assertNotIncludes(showroom, "_set_armour_render_" + "region", "Showroom removes the retired armour mode handler");
  assertNotIncludes(showroom, "ARMOUR_RENDER" + "_REGION", "Showroom removes the retired armour mode constant");
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
  assert(manifest.schemaVersion === 10, "d-full-match art manifest uses schemaVersion 10");
  assert(!("source" in manifest), "art manifest has no singleton top-level source");
  assert(!("license" in manifest), "art manifest has no singleton top-level license");
  assert(!("extraction" in manifest), "art manifest has no singleton top-level extraction");
  assert(manifest.body && typeof manifest.body === "object", "art manifest exposes root body block");
  assert(manifest.body?.sourceKey === universalBodySourceKey, 'manifest.body.sourceKey is "mesh2motion"');
  assert(manifest.body?.file === universalBodyFile, "manifest.body.file is the shared mesh2motion body");
  assert(manifest.body?.armourAttachBone === "spine", 'manifest.body.armourAttachBone preserves reserved value "spine"');
  assert(Number.isFinite(manifest.body?.modelScaleMultiplier), "manifest.body modelScaleMultiplier declares numeric locked-body scale source");
  assert(Number.isFinite(manifest.body?.targetWorldHeight), "manifest.body targetWorldHeight declares numeric locked-body scale source");
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
  assertNear(Number(manifest.corpseBody?.modelScaleMultiplier), round11BodyModelScaleMultiplier, 0.000001, "manifest.corpseBody modelScaleMultiplier mirrors body scale");
  assertNear(Number(manifest.corpseBody?.targetWorldHeight), round11TargetWorldHeight, 0.000001, "manifest.corpseBody targetWorldHeight mirrors body target");
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
  const accessoryPersonas = new Set();
  const effectiveBodyFiles = new Set();
  const effectiveBodySourceKeys = new Set();
  const forbiddenBodySubstitutionKey = "body" + "Override";
  const weapons = new Set();
  const armours = new Set();
  const corpseAssets = [];
  const environmentRoles = new Set();
  assert(Array.isArray(manifest.armourProps), "manifest exposes top-level Round-11 armourProps catalog");
  const armourProps = Array.isArray(manifest.armourProps) ? manifest.armourProps : [];
  const armourPropById = new Map();
  assert(
    armourProps.length >= round11MinimumArmourPropCatalogCount,
    `manifest armourProps catalog has at least ${round11MinimumArmourPropCatalogCount} entries`,
  );
  for (const [index, prop] of armourProps.entries()) {
    assertArmourPropCatalogEntry(prop, `manifest.armourProps[${index}]`);
    if (typeof prop?.id === "string") {
      assert(!armourPropById.has(prop.id), `manifest armourProps id is unique: ${prop.id}`);
      armourPropById.set(prop.id, prop);
    }
  }
  for (const propId of round11ArmourPropCatalogIds) {
    assert(armourPropById.has(propId), `manifest armourProps catalog includes ${propId}`);
  }
  const draftPath = path.join(appDir, "shared-harness/art-kit/armour/ROUND-11-ARMOUR-PROVENANCE-DRAFT.json");
  if (existsSync(draftPath)) {
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    const draftProps = new Map((Array.isArray(draft.armourProps) ? draft.armourProps : []).map((prop) => [prop.id, prop]));
    for (const propId of round11StagedArmourPropIds) {
      const active = armourPropById.get(propId);
      const staged = draftProps.get(propId);
      assert(Boolean(staged), `Round-11 provenance draft contains ${propId}`);
      assert(Boolean(active), `active manifest contains staged armour prop ${propId}`);
      if (active && staged) {
        assert(active.file === staged.file, `active armour prop file matches provenance draft: ${propId}`);
        assert(active.sha256 === staged.sha256, `active armour prop sha256 matches provenance draft: ${propId}`);
        assert(Number(active.propScale) === Number(staged.propScale), `active armour prop propScale matches provenance draft: ${propId}`);
        assert(active.source?.pageUrl === staged.source?.pageUrl, `active armour prop source.pageUrl matches provenance draft: ${propId}`);
        assert(active.license?.spdx === staged.license?.spdx, `active armour prop license.spdx matches provenance draft: ${propId}`);
      }
    }
  }
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
      assert(asset.skin?.adherenceApproach === "uv_painted", `Round-11 skin uses uv_painted adherence: ${asset.id}`);
      assert(asset.skin?.approach !== "decal_stickers", `Round-11 skin removes decal_stickers approach: ${asset.id}`);
      assert(asset.skin?.adherenceApproach !== "bone_attached", `Round-11 skin removes bone_attached skin family: ${asset.id}`);
      assert(round11SkinApproaches.includes(asset.skin?.approach), `Round-11 skin approach is in the pbr/pattern shortlist: ${asset.id}`);
      for (const retiredSkin of retiredPersonaSkinApproaches) {
        assert(asset.skin?.approach !== retiredSkin, `Round-11 persona skin omits retired approach ${retiredSkin}: ${asset.id}`);
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
      assertLiveCorpseGore(asset);
      assertCorpseDeathTreatment(asset, adherenceApproachCoverage, layerAdherenceCoverage.gore);
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
          assert(
            Number.isFinite(Number(asset.armorOverlay?.propScale)) && Number(asset.armorOverlay.propScale) > 0 && Number(asset.armorOverlay.propScale) <= 1,
            `character armorOverlay declares positive propScale no larger than body fit scale: ${asset.id}`,
          );
          assert(typeof asset.armorOverlay?.catalogPropId === "string" && armourPropById.has(asset.armorOverlay.catalogPropId), `character armorOverlay links to armourProps catalog: ${asset.id}`);
          if (typeof asset.armorOverlay?.file === "string") {
            assert(asset.armorOverlay.file.startsWith("armour/"), `character armorOverlay file lives under armour/: ${asset.id}`);
            assertArtKitPath(asset.armorOverlay.file, `${asset.id}.armorOverlay.file`);
            assertArtKitImportSidecar(asset.armorOverlay.file, `${asset.id}.armorOverlay.file`);
          }
        }
      }
      if (asset.hasOwnProperty("armor" + "Region")) {
        assert(false, `character omits retired flat armour block: ${asset.id}`);
      }
    } else if (asset.category === "weapon") {
      weapons.add(asset.weaponName);
      assert(asset.attachBone || asset.handOffset, `weapon asset has socket metadata: ${asset.id}`);
      assert(typeof asset.tier === "number", `weapon asset has tier: ${asset.id}`);
      assert(Array.isArray(asset.attachModes), `weapon asset declares Round-11 attachModes: ${asset.id}`);
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
  assert(declaredArmourModes.size === armourRenderModes.length, "manifest adherence metadata declares modular prop armour mode only");
  for (const mode of armourRenderModes) {
    assert(declaredArmourModes.has(mode), `manifest adherence metadata declares armour mode ${mode}`);
    manifestArmourModes.add(mode);
  }
  for (const mode of retiredArmourRenderModes) {
    assert(!declaredArmourModes.has(mode), `manifest adherence metadata omits retired armour mode ${mode}`);
  }
  assertNear(Number(manifest.round9Adherence?.armourPropScaleDefault), armourPropScaleDefault, 0.000001, "manifest records Round-11 armour propScale default");
  assert(!("armorAsPaint" in manifest), "manifest omits retired armorAsPaint approach");
  assert(effectiveBodyFiles.size === 1 && effectiveBodyFiles.has(universalBodyFile), "manifest character effective body files are the single mesh2motion root body");
  assert(
    effectiveBodySourceKeys.size === 1 && effectiveBodySourceKeys.has(universalBodySourceKey),
    "manifest character effective body source keys are the single mesh2motion root source",
  );
  assert(!skinApproaches.has("decal_stickers"), "manifest exposes no decal_stickers skin approach");
  assert(
    skinApproaches.size === round11SkinApproaches.length && round11SkinApproaches.every((approach) => skinApproaches.has(approach)),
    `manifest persona skin selection is exactly ${round11SkinApproaches.join(" + ")}`,
  );
  for (const retiredSkin of retiredPersonaSkinApproaches) {
    assert(!skinApproaches.has(retiredSkin), `manifest persona skin selection omits retired skin approach ${retiredSkin}`);
  }
  assert(
    corpseApproaches.size === 1 && corpseApproaches.has(round11LiveCorpseApproach),
    `manifest live corpse.approach is locked to ${round11LiveCorpseApproach}`,
  );
  assert(
    armorOverlayPersonas.size >= round11MinimumModularArmorOverlays,
    `manifest has at least ${round11MinimumModularArmorOverlays} non-null modular armorOverlay entries`,
  );
  for (const family of round11AdherenceFamilies) {
    assert(adherenceApproachCoverage.has(family), `manifest adherenceApproach union covers ${family}`);
  }
  assert(layerAdherenceCoverage.skin.size === 1 && layerAdherenceCoverage.skin.has("uv_painted"), "skin layer is consolidated on uv_painted adherence");
  assert(
    layerAdherenceCoverage.gore.size === 2 && layerAdherenceCoverage.gore.has("bone_attached") && layerAdherenceCoverage.gore.has("mesh_baked"),
    "gore layer is locked to live bone_attached marks plus mesh_baked death treatment",
  );
  assert(layerAdherenceCoverage.weapons.size === 1 && layerAdherenceCoverage.weapons.has("dynamic_hand_bone"), "weapons layer is dynamic_hand_bone only");
  assert(layerAdherenceCoverage.armour.has("bone_attached"), "armour layer uses body-tracking bone_attached props");
  console.log(
    `Round-11 A1 adherence matrix: skin=${[...layerAdherenceCoverage.skin].join(",")} gore=${[...layerAdherenceCoverage.gore].join(",")} weapons=${[...layerAdherenceCoverage.weapons].join(",")} armour=${[...declaredArmourModes].join(",")}`,
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
  assertNear(numericCliArg(testScript, "--target-world-height"), round11TargetWorldHeight, 0.000001, "package test passes synchronized locked-body target world height");
  assertNear(numericCliArg(testScript, "--character-model-scale"), round11CharacterModelScale, 0.000001, "package test passes synchronized locked-body character model scale");
  assertIncludes(testScript, "audit-character-scales: skipped (GODOT_BIN unset)", "package test logs clear scale-audit skip when GODOT_BIN is unset");
  assertIncludes(testScript, "Godot audits: skipped (GODOT_BIN unset)", "package test logs clear Godot audit skip when GODOT_BIN is unset");
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
  for (const token of ["adherenceApproach", "sourcePack", "armorOverlay", "modular_submesh_prop"]) {
    assertIncludes(auditSkinBoneAttachments, token, `skin/bone attachment audit validates ${token}`);
  }
  assertIncludes(auditSkinBoneAttachments, "_retired_armour_apply_method", "skin/bone attachment audit rejects retired flat armour runtime method");
  assertIncludes(auditSkinBoneAttachments, "adherence_coverage", "skin/bone attachment audit tracks adherenceApproach coverage");
  assertIncludes(auditSkinBoneAttachments, "BASE_SCALE := 1.0", "skin/bone attachment audit uses standard base scale");
  assertIncludes(auditSkinBoneAttachments, "SKIN_SHORTLIST_APPROACHES", "skin/bone attachment audit enforces Round-11 skin shortlist");
  assertIncludes(auditSkinBoneAttachments, "UV2_BODY_SHADER_TOKEN", "skin/bone attachment audit enforces UV2 body shader coverage");
  assertIncludes(auditSkinBoneAttachments, "MESH2MOTION_MARK_BONES", "skin/bone attachment audit validates marks against mesh2motion bones");
  assertIncludes(auditSkinBoneAttachments, "MIN_LIVE_GORE_MARKS", "skin/bone attachment audit enforces live gore mark count");
  assertIncludes(auditSkinBoneAttachments, "MAX_SMALL_BODY_MARK_XY", "skin/bone attachment audit enforces small gore mark dimensions");
  assertIncludes(auditSkinBoneAttachments, "SMALL_BONE_ATTACHED_MARKS", "skin/bone attachment audit locks live gore approach");
  assertIncludes(auditSkinBoneAttachments, "DEATH_TREATMENT_APPROACH", "skin/bone attachment audit validates corpse deathTreatment");
  assertIncludes(auditSkinBoneAttachments, "RETIRED_LIVE_CORPSE_APPROACHES", "skin/bone attachment audit rejects retired live gore controls");
  assertIncludes(auditSkinBoneAttachments, "_apply_skin_decal_stickers", "skin/bone attachment audit rejects retired skin decal helper if present");
  assertNotIncludes(auditSkinBoneAttachments, "bodyOverride", "skin/bone attachment audit avoids bodyOverride-tolerant branches");
}

if (existsSync(path.join(appDir, "scripts/audit-modular-submesh-armor.gd"))) {
  const auditModularArmor = read("scripts/audit-modular-submesh-armor.gd");
  for (const token of ["armorOverlay", "armourProps", "modular_submesh_prop", "sourcePack", "armour/", "armor_overlay_nodes_by_character", "bindBone", "BoneAttachment3D", "set_armour_prop_selection"]) {
    assertIncludes(auditModularArmor, token, `modular armor audit validates Round-11 ${token}`);
  }
  assertIncludes(auditModularArmor, "MIN_MODULAR_ARMOR_OVERLAYS", "modular armor audit enforces minimum non-null overlays");
  assertIncludes(auditModularArmor, "MIN_ARMOUR_PROP_CATALOG_ENTRIES", "modular armor audit enforces Round-11 armourProps breadth count");
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
    "RETIRED_ARMOUR_PAINT",
    "EXPECTED_SCHEMA_VERSION := 10",
    "last_applied_skin_approach",
    "last_applied_corpse_approach",
    "weaponSocketKind",
    "usesModularArmour",
    "SMALL_BONE_ATTACHED_MARKS",
    "DEATH_TREATMENT_APPROACH",
    "RETIRED_LIVE_CORPSE_APPROACHES",
  ]) {
    assertIncludes(auditAdherenceMatrix, token, `adherence-matrix audit validates ${token}`);
  }
  assertIncludes(auditAdherenceMatrix, "_retired_armour_block_key", "adherence-matrix audit rejects retired flat armour manifest block");
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

if (existsSync(path.join(appDir, "ROUND-11-CLOSING-READOUT.md"))) {
  const readout = read("ROUND-11-CLOSING-READOUT.md");
  for (const token of [
    "Consolidated Lane Matrix",
    "Honest Limitations",
    "dynamic_hand_bone",
    "modular_submesh_prop",
    "small_bone_attached_marks",
    "dismemberment_baked",
    "uv_painted",
    "uv2_body_texture",
    "BoneAttachment3D",
    "propScale",
    "armourProps",
  ]) {
    assertIncludes(readout, token, `Round-11 closing readout documents ${token}`);
  }
  const scaleEvidenceSection = markdownSectionMatchingHeading(readout, /\b(?:scale|calibration|evidence)\b/i);
  assert(scaleEvidenceSection.length > 0, "Round-11 closing readout includes a scale calibration/evidence section");
  for (const token of ["propScale", "body-fit"]) {
    assertIncludes(scaleEvidenceSection, token, `Round-11 scale calibration/evidence section documents ${token}`);
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
