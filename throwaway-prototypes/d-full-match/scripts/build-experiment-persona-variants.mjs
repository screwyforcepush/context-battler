#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const sourceGlb = path.join(appRoot, "shared-harness/art-kit/characters/generated/experiment.glb");
const generatedDir = path.join(appRoot, "shared-harness/art-kit/characters/generated");
const runtimeConfigPath = path.join(generatedDir, "experiment_persona_variants.json");
const reportDir = path.join(appRoot, "dist/characters/experiment_variants");
const reportPath = path.join(reportDir, "experiment_persona_variants_report.json");

const JSON_CHUNK = 0x4e4f534a;

const personas = [
  {
    id: "rat",
    label: "rat",
    metalTint: [0.78, 0.82, 0.82],
    metalBrightness: 0.86,
    goreTint: [1.08, 0.82, 0.78],
    goreBrightness: 1.22,
    skinTint: [0.92, 0.84, 0.78],
    skinBrightness: 0.92,
    bloodBoost: 1.42,
    greenBoost: 0.38,
    wetnessBoost: 1.18,
    patternBias: { blood: 1.0, muscle: 0.70, tendon: 0.88, metal: 0.72, patina: 0.58, phase: 0.46, fissure: 0.28 },
    patchBias: ["blood_clot", "tendon_wire", "machine_spike", "blood_clot", "bone_chip"],
  },
  {
    id: "duelist",
    label: "duelist",
    metalTint: [1.15, 1.17, 1.08],
    metalBrightness: 1.22,
    goreTint: [0.98, 0.74, 0.70],
    goreBrightness: 0.90,
    skinTint: [0.96, 0.90, 0.82],
    skinBrightness: 1.02,
    bloodBoost: 0.82,
    greenBoost: 0.54,
    wetnessBoost: 0.86,
    patternBias: { blood: 0.42, muscle: 0.54, tendon: 0.46, metal: 1.0, patina: 0.64, phase: 0.38, fissure: 0.38 },
    patchBias: ["machine_plate", "machine_spike", "green_fissure", "machine_plate", "tendon_wire"],
  },
  {
    id: "trader",
    label: "trader",
    metalTint: [1.18, 0.92, 0.70],
    metalBrightness: 1.02,
    goreTint: [1.03, 0.74, 0.65],
    goreBrightness: 1.06,
    skinTint: [1.06, 0.88, 0.76],
    skinBrightness: 0.98,
    bloodBoost: 1.02,
    greenBoost: 0.68,
    wetnessBoost: 0.98,
    patternBias: { blood: 0.54, muscle: 0.66, tendon: 0.58, metal: 0.78, patina: 1.0, phase: 0.42, fissure: 0.48 },
    patchBias: ["machine_plate", "copper_plate", "bone_chip", "tendon_wire", "green_fissure"],
  },
  {
    id: "opportunist",
    label: "opportunist",
    metalTint: [0.92, 0.96, 0.98],
    metalBrightness: 1.06,
    goreTint: [0.94, 0.64, 0.66],
    goreBrightness: 1.34,
    skinTint: [1.14, 0.98, 0.88],
    skinBrightness: 1.08,
    bloodBoost: 1.34,
    greenBoost: 0.48,
    wetnessBoost: 1.26,
    patternBias: { blood: 0.92, muscle: 1.0, tendon: 0.74, metal: 0.62, patina: 0.42, phase: 0.54, fissure: 0.36 },
    patchBias: ["blood_clot", "blood_smear", "tendon_wire", "machine_spike", "blood_clot"],
  },
  {
    id: "paranoid",
    label: "paranoid",
    metalTint: [0.76, 0.90, 0.92],
    metalBrightness: 0.96,
    goreTint: [0.88, 0.66, 0.68],
    goreBrightness: 0.96,
    skinTint: [0.82, 0.92, 0.88],
    skinBrightness: 0.94,
    bloodBoost: 0.92,
    greenBoost: 1.56,
    wetnessBoost: 1.08,
    patternBias: { blood: 0.46, muscle: 0.52, tendon: 0.62, metal: 0.66, patina: 0.48, phase: 0.92, fissure: 1.0 },
    patchBias: ["green_fissure", "machine_spike", "green_fissure", "tendon_wire", "bone_chip"],
  },
  {
    id: "camper",
    label: "camper",
    metalTint: [0.86, 0.84, 0.78],
    metalBrightness: 0.92,
    goreTint: [1.20, 0.82, 0.70],
    goreBrightness: 1.18,
    skinTint: [1.08, 0.92, 0.82],
    skinBrightness: 0.96,
    bloodBoost: 1.18,
    greenBoost: 0.42,
    wetnessBoost: 1.40,
    patternBias: { blood: 0.78, muscle: 0.88, tendon: 1.0, metal: 0.56, patina: 0.44, phase: 0.50, fissure: 0.30 },
    patchBias: ["tendon_wire", "blood_smear", "blood_clot", "bone_chip", "tendon_wire"],
  },
  {
    id: "sprinter",
    label: "sprinter",
    metalTint: [1.04, 1.08, 1.06],
    metalBrightness: 1.12,
    goreTint: [1.22, 0.70, 0.64],
    goreBrightness: 1.08,
    skinTint: [1.00, 0.84, 0.78],
    skinBrightness: 0.98,
    bloodBoost: 1.08,
    greenBoost: 0.76,
    wetnessBoost: 0.92,
    patternBias: { blood: 0.62, muscle: 0.64, tendon: 0.54, metal: 0.92, patina: 0.52, phase: 0.68, fissure: 0.62 },
    patchBias: ["machine_spike", "green_fissure", "machine_plate", "blood_smear", "machine_spike"],
  },
  {
    id: "vulture",
    label: "vulture",
    metalTint: [0.82, 0.82, 0.76],
    metalBrightness: 0.82,
    goreTint: [0.92, 0.70, 0.58],
    goreBrightness: 0.90,
    skinTint: [1.18, 1.06, 0.82],
    skinBrightness: 1.10,
    bloodBoost: 0.78,
    greenBoost: 0.62,
    wetnessBoost: 0.78,
    patternBias: { blood: 0.36, muscle: 0.48, tendon: 0.70, metal: 0.70, patina: 0.66, phase: 0.34, fissure: 0.46 },
    patchBias: ["bone_chip", "machine_plate", "tendon_wire", "copper_plate", "bone_chip"],
  },
];

const patchAnchors = [
  { bone: "head", offset: [0.045, 0.020, 0.080], rotation: [12, 18, -7], scale: [0.045, 0.010, 0.032] },
  { bone: "neck_01", offset: [-0.030, 0.015, 0.055], rotation: [-18, -6, 20], scale: [0.035, 0.008, 0.026] },
  { bone: "spine_03", offset: [-0.120, 0.045, 0.110], rotation: [12, -26, 8], scale: [0.095, 0.018, 0.050] },
  { bone: "spine_03", offset: [0.105, -0.020, 0.095], rotation: [-8, 31, -14], scale: [0.082, 0.016, 0.044] },
  { bone: "spine_02", offset: [0.090, -0.060, -0.090], rotation: [18, 22, 12], scale: [0.085, 0.014, 0.045] },
  { bone: "upperarm_l", offset: [0.015, -0.105, 0.040], rotation: [8, -12, 72], scale: [0.060, 0.012, 0.030] },
  { bone: "upperarm_r", offset: [-0.015, -0.105, 0.040], rotation: [-8, 14, -72], scale: [0.060, 0.012, 0.030] },
  { bone: "lowerarm_l", offset: [0.020, -0.085, 0.028], rotation: [10, -24, 64], scale: [0.050, 0.010, 0.026] },
  { bone: "lowerarm_r", offset: [-0.020, -0.085, 0.028], rotation: [-10, 24, -64], scale: [0.050, 0.010, 0.026] },
  { bone: "thigh_l", offset: [0.035, -0.155, 0.050], rotation: [12, -18, 40], scale: [0.072, 0.015, 0.036] },
  { bone: "thigh_r", offset: [-0.035, -0.155, 0.050], rotation: [-12, 18, -40], scale: [0.072, 0.015, 0.036] },
  { bone: "calf_l", offset: [0.025, -0.120, 0.030], rotation: [18, 8, 48], scale: [0.055, 0.012, 0.026] },
  { bone: "calf_r", offset: [-0.025, -0.120, 0.030], rotation: [-18, -8, -48], scale: [0.055, 0.012, 0.026] },
];

const patchLooks = {
  blood_clot: {
    material: "wet_blood",
    color: [0.22, 0.012, 0.006, 1.0],
    metallic: 0.0,
    roughness: 0.11,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  blood_smear: {
    material: "wet_blood",
    color: [0.36, 0.018, 0.010, 1.0],
    metallic: 0.0,
    roughness: 0.08,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  tendon_wire: {
    material: "tendon",
    color: [0.34, 0.22, 0.135, 1.0],
    metallic: 0.0,
    roughness: 0.30,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  bone_chip: {
    material: "bone",
    color: [0.62, 0.54, 0.39, 1.0],
    metallic: 0.0,
    roughness: 0.62,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  machine_plate: {
    material: "metal",
    color: [0.18, 0.205, 0.20, 1.0],
    metallic: 0.84,
    roughness: 0.30,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  machine_spike: {
    material: "metal",
    color: [0.18, 0.205, 0.195, 1.0],
    metallic: 0.88,
    roughness: 0.26,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  copper_plate: {
    material: "metal",
    color: [0.35, 0.16, 0.075, 1.0],
    metallic: 0.72,
    roughness: 0.38,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  green_fissure: {
    material: "glitch",
    color: [0.012, 0.19, 0.14, 1.0],
    metallic: 0.0,
    roughness: 0.22,
    emission: [0.0, 0.85, 0.55],
    emissionEnergy: 0.68,
  },
};

async function readGlbJson(filePath) {
  const data = await fs.readFile(filePath);
  if (data.length < 20 || data.toString("ascii", 0, 4) !== "glTF") {
    throw new Error(`Invalid GLB header: ${filePath}`);
  }
  let offset = 12;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = data.subarray(offset, offset + length);
    offset += length;
    if (type === JSON_CHUNK) {
      return JSON.parse(chunk.toString("utf8").replace(/[\u0000\s]+$/g, ""));
    }
  }
  throw new Error(`GLB JSON chunk missing: ${filePath}`);
}

function hash32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rng, amount) {
  return 1 + (rng() * 2 - 1) * amount;
}

function roundNumber(value) {
  return Number(value.toFixed(5));
}

function roundArray(values) {
  return values.map((value) => roundNumber(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function jitterArray(rng, values, amount) {
  return values.map((value) => roundNumber(value + (rng() * 2 - 1) * amount));
}

function choose(rng, values) {
  return values[Math.floor(rng() * values.length) % values.length];
}

function buildSurfaceAlpha(persona, rng) {
  const bias = persona.patternBias || {};
  const alpha = {};
  for (const key of ["blood", "muscle", "tendon", "bone", "metal", "patina", "phase", "fissure", "skinTear"]) {
    const base = bias[key] ?? (key === "bone" ? 0.72 : key === "skinTear" ? 0.84 : 0.68);
    alpha[key] = roundNumber(clamp(base * jitter(rng, 0.34), 0.22, 1.0));
  }
  alpha.bone = roundNumber(clamp((bias.bone ?? 0.70) * jitter(rng, 0.22), 0.36, 1.0));
  alpha.skinTear = roundNumber(clamp((bias.skinTear ?? 0.82) * jitter(rng, 0.18), 0.48, 1.0));
  return alpha;
}

function buildPatchConfig(persona, rng) {
  const availableAnchors = [...patchAnchors];
  const patchCount = 7 + Math.floor(rng() * 4);
  const patches = [];
  for (let i = 0; i < patchCount && availableAnchors.length > 0; i += 1) {
    const anchorIndex = Math.floor(rng() * availableAnchors.length);
    const anchor = availableAnchors.splice(anchorIndex, 1)[0];
    const kind = choose(rng, persona.patchBias || Object.keys(patchLooks));
    const look = patchLooks[kind] || patchLooks.blood_clot;
    const scaleBoost = {
      blood_clot: [1.45, 1.28, 1.34],
      blood_smear: [1.80, 0.72, 1.36],
      tendon_wire: [2.25, 0.50, 0.54],
      bone_chip: [1.36, 0.92, 1.18],
      machine_plate: [1.62, 0.62, 1.32],
      machine_spike: [1.34, 0.44, 0.56],
      copper_plate: [1.54, 0.62, 1.20],
      green_fissure: [1.48, 0.38, 0.92],
    }[kind] || [1.0, 1.0, 1.0];
    const scale = anchor.scale.map((value, scaleIndex) =>
      roundNumber(value * 1.24 * scaleBoost[scaleIndex] * jitter(rng, 0.28)),
    );
    patches.push({
      id: `${persona.id}_${i}`,
      kind,
      bone: anchor.bone,
      offset: jitterArray(rng, anchor.offset, 0.018),
      rotation: jitterArray(rng, anchor.rotation, 16.0),
      scale,
      color: roundArray(look.color),
      metallic: roundNumber(look.metallic),
      roughness: roundNumber(look.roughness),
      emission: roundArray(look.emission),
      emissionEnergy: roundNumber(look.emissionEnergy),
    });
  }
  return patches;
}

function buildVariantConfig(persona, index) {
  const seed = hash32(`experiment:${persona.id}:${index}`);
  const rng = mulberry32(seed);
  return {
    id: persona.id,
    label: persona.label,
    seed,
    sourceModel: "characters/generated/experiment.glb",
    metalTint: roundArray(persona.metalTint),
    metalBrightness: roundNumber(persona.metalBrightness * jitter(rng, 0.045)),
    goreTint: roundArray(persona.goreTint),
    goreBrightness: roundNumber(persona.goreBrightness * jitter(rng, 0.055)),
    skinTint: roundArray(persona.skinTint),
    skinBrightness: roundNumber(persona.skinBrightness * jitter(rng, 0.04)),
    bloodBoost: roundNumber(persona.bloodBoost),
    greenBoost: roundNumber(persona.greenBoost * jitter(rng, 0.07)),
    wetnessBoost: roundNumber(persona.wetnessBoost * jitter(rng, 0.06)),
    metalRoughnessJitter: roundNumber(jitter(rng, 0.14)),
    goreWetnessJitter: roundNumber(jitter(rng, 0.1)),
    phaseSkinJitter: roundNumber(jitter(rng, 0.22)),
    surfaceAlpha: buildSurfaceAlpha(persona, rng),
    uvDrift: {
      x: roundNumber((rng() * 2 - 1) * 0.34),
      y: roundNumber((rng() * 2 - 1) * 0.34),
      scaleX: roundNumber(jitter(rng, 0.18)),
      scaleY: roundNumber(jitter(rng, 0.18)),
    },
    patches: buildPatchConfig(persona, rng),
  };
}

function validateSource(gltf) {
  const stats = {
    nodes: (gltf.nodes || []).length,
    meshes: (gltf.meshes || []).length,
    materials: (gltf.materials || []).length,
    animations: (gltf.animations || []).length,
  };
  const names = [
    ...(gltf.nodes || []).map((entry) => String(entry.name || "")),
    ...(gltf.meshes || []).map((entry) => String(entry.name || "")),
    ...(gltf.materials || []).map((entry) => String(entry.name || "")),
  ];
  const expectedParts = [
    "experiment_reallusion_integrated_head",
    "experiment_reallusion_eyes",
    "experiment_reallusion_teeth",
    "experiment_reallusion_tongue",
  ];
  const missing = expectedParts.filter((part) => !names.some((name) => name.includes(part)));
  const errors = [];
  if (missing.length > 0) errors.push(`missing expected parts: ${missing.join(", ")}`);
  if (stats.meshes !== 6) errors.push(`mesh count ${stats.meshes} != 6`);
  if (stats.materials !== 19) errors.push(`material count ${stats.materials} != 19`);
  if (stats.animations < 80) errors.push(`animation count ${stats.animations} < 80`);
  if (errors.length > 0) {
    throw new Error(`Source experiment GLB failed variant validation: ${errors.join("; ")}`);
  }
  return stats;
}

async function main() {
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  const gltf = await readGlbJson(sourceGlb);
  const sourceStats = validateSource(gltf);
  const variants = personas.map(buildVariantConfig);
  const runtimeConfig = {
    status: "experiment_persona_variant_seed_config",
    sourceModel: "characters/generated/experiment.glb",
    approach:
      "Deterministic seeded material/finish variants. The showroom loads one shared accepted experiment GLB per card and applies these generated controls at instance time, avoiding duplicated animated GLBs.",
    sourceStats,
    variants,
  };
  await fs.writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");
  const report = {
    ...runtimeConfig,
    generatedAt: new Date().toISOString(),
    runtimeConfig: path.relative(appRoot, runtimeConfigPath),
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PASS build-experiment-persona-variants variants=${variants.length}`);
  for (const variant of variants) {
    console.log(
      `PASS ${variant.id} seed=${variant.seed} metal=${variant.metalBrightness} gore=${variant.goreBrightness} green=${variant.greenBoost} patches=${variant.patches.length}`,
    );
  }
  console.log(`runtime=${path.relative(appRoot, runtimeConfigPath)}`);
  console.log(`report=${path.relative(appRoot, reportPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
