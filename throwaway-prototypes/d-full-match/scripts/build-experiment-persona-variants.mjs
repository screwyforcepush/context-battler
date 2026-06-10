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
  },
];

const decorationAnchors = [
  { id: "left_skull", region: "head", bone: "head", offset: [-0.052, 0.034, 0.092], rotation: [-8, -24, 18], scale: 0.92, weight: 1.0 },
  { id: "right_skull", region: "head", bone: "head", offset: [0.050, 0.032, 0.088], rotation: [6, 22, -14], scale: 0.88, weight: 1.0 },
  { id: "left_cheek", region: "head", bone: "head", offset: [-0.060, -0.018, 0.086], rotation: [-4, -18, -18], scale: 0.72, weight: 0.92 },
  { id: "jawline", region: "head", bone: "head", offset: [0.038, -0.064, 0.080], rotation: [18, 12, -30], scale: 0.74, weight: 0.86 },
  { id: "neck_socket", region: "neck", bone: "neck_01", offset: [-0.034, 0.012, 0.058], rotation: [-22, -8, 18], scale: 0.76, weight: 0.9 },
  { id: "sternum_port", region: "chest", bone: "spine_03", offset: [-0.085, 0.018, 0.142], rotation: [8, -18, 12], scale: 1.14, weight: 1.18 },
  { id: "left_rib_socket", region: "chest", bone: "spine_03", offset: [-0.126, -0.034, 0.116], rotation: [-2, -30, 8], scale: 0.98, weight: 1.0 },
  { id: "right_rib_socket", region: "chest", bone: "spine_03", offset: [0.105, -0.038, 0.126], rotation: [-4, 26, -10], scale: 1.02, weight: 1.0 },
  { id: "left_clavicle", region: "shoulder", bone: "clavicle_l", offset: [0.030, 0.040, 0.068], rotation: [10, -18, 30], scale: 0.78, weight: 0.9 },
  { id: "right_clavicle", region: "shoulder", bone: "clavicle_r", offset: [-0.030, 0.040, 0.068], rotation: [-10, 18, -30], scale: 0.78, weight: 0.9 },
  { id: "lower_back_socket", region: "back", bone: "spine_02", offset: [0.082, -0.048, -0.122], rotation: [22, 18, 14], scale: 1.12, weight: 0.78 },
  { id: "spine_socket", region: "back", bone: "spine_03", offset: [-0.060, 0.020, -0.136], rotation: [18, -8, -22], scale: 1.04, weight: 0.82 },
  { id: "pelvis_socket", region: "hip", bone: "spine_01", offset: [0.018, -0.185, 0.106], rotation: [12, 0, 5], scale: 0.86, weight: 0.58 },
  { id: "left_hip_socket", region: "hip", bone: "thigh_l", offset: [0.036, 0.026, 0.082], rotation: [10, -22, 18], scale: 0.78, weight: 0.68 },
  { id: "right_hip_socket", region: "hip", bone: "thigh_r", offset: [-0.036, 0.026, 0.082], rotation: [-10, 22, -18], scale: 0.78, weight: 0.68 },
  { id: "left_shoulder", region: "shoulder", bone: "upperarm_l", offset: [0.030, 0.072, 0.060], rotation: [8, -10, 34], scale: 0.92, weight: 1.02 },
  { id: "right_shoulder", region: "shoulder", bone: "upperarm_r", offset: [-0.030, 0.070, 0.058], rotation: [-8, 12, -34], scale: 0.92, weight: 1.02 },
  { id: "left_bicep", region: "upper_arm", bone: "upperarm_l", offset: [0.034, -0.070, 0.050], rotation: [12, -20, 48], scale: 0.76, weight: 0.82 },
  { id: "right_bicep", region: "upper_arm", bone: "upperarm_r", offset: [-0.034, -0.070, 0.050], rotation: [-12, 20, -48], scale: 0.76, weight: 0.82 },
  { id: "left_forearm", region: "forearm", bone: "lowerarm_l", offset: [0.024, -0.088, 0.040], rotation: [14, -26, 62], scale: 0.78, weight: 0.96 },
  { id: "right_forearm", region: "forearm", bone: "lowerarm_r", offset: [-0.024, -0.088, 0.040], rotation: [-14, 26, -62], scale: 0.78, weight: 0.96 },
  { id: "left_hand", region: "hand", bone: "hand_l", offset: [0.018, -0.028, 0.055], rotation: [24, -8, 16], scale: 0.58, weight: 0.62 },
  { id: "right_hand", region: "hand", bone: "hand_r", offset: [-0.018, -0.028, 0.055], rotation: [-24, 8, -16], scale: 0.58, weight: 0.62 },
  { id: "left_knee", region: "knee", bone: "thigh_l", offset: [0.032, -0.208, 0.070], rotation: [16, -18, 38], scale: 0.84, weight: 0.98 },
  { id: "right_knee", region: "knee", bone: "thigh_r", offset: [-0.032, -0.208, 0.070], rotation: [-16, 18, -38], scale: 0.84, weight: 0.98 },
  { id: "left_calf", region: "leg", bone: "calf_l", offset: [0.024, -0.118, 0.038], rotation: [20, 10, 46], scale: 0.70, weight: 0.8 },
  { id: "right_calf", region: "leg", bone: "calf_r", offset: [-0.024, -0.118, 0.038], rotation: [-20, -10, -46], scale: 0.70, weight: 0.8 },
  { id: "left_foot", region: "foot", bone: "foot_l", offset: [0.020, -0.040, 0.070], rotation: [10, -4, 18], scale: 0.62, weight: 0.52 },
  { id: "right_foot", region: "foot", bone: "foot_r", offset: [-0.020, -0.040, 0.070], rotation: [-10, 4, -18], scale: 0.62, weight: 0.52 },
  { id: "forehead_socket", region: "head", bone: "head", offset: [0.000, 0.064, 0.102], rotation: [-12, 0, 0], scale: 0.70, weight: 0.58 },
  { id: "left_temple", region: "head", bone: "head", offset: [-0.074, 0.018, 0.090], rotation: [0, -38, 10], scale: 0.62, weight: 0.62 },
  { id: "right_temple", region: "head", bone: "head", offset: [0.074, 0.018, 0.090], rotation: [0, 38, -10], scale: 0.62, weight: 0.62 },
  { id: "occipital_port", region: "head", bone: "head", offset: [0.018, 0.032, -0.090], rotation: [12, 178, -14], scale: 0.78, weight: 0.58 },
  { id: "left_throat", region: "neck", bone: "neck_01", offset: [-0.030, -0.020, 0.070], rotation: [-16, -18, 18], scale: 0.62, weight: 0.72 },
  { id: "right_throat", region: "neck", bone: "neck_01", offset: [0.030, -0.020, 0.070], rotation: [-16, 18, -18], scale: 0.62, weight: 0.72 },
  { id: "upper_spine_jack", region: "back", bone: "spine_03", offset: [0.000, 0.070, -0.145], rotation: [18, 0, 180], scale: 0.88, weight: 0.82 },
  { id: "mid_spine_jack", region: "back", bone: "spine_02", offset: [0.000, -0.018, -0.150], rotation: [16, 0, 180], scale: 0.88, weight: 0.82 },
  { id: "lower_spine_jack", region: "back", bone: "spine_01", offset: [0.000, -0.085, -0.130], rotation: [20, 0, 180], scale: 0.78, weight: 0.64 },
  { id: "heart_socket", region: "chest", bone: "spine_03", offset: [-0.048, 0.000, 0.156], rotation: [2, -10, 4], scale: 1.00, weight: 1.10 },
  { id: "right_lung_socket", region: "chest", bone: "spine_03", offset: [0.070, -0.010, 0.150], rotation: [-2, 18, -4], scale: 0.96, weight: 0.98 },
  { id: "left_abdomen", region: "chest", bone: "spine_02", offset: [-0.060, -0.130, 0.130], rotation: [8, -16, 10], scale: 0.90, weight: 0.84 },
  { id: "right_abdomen", region: "chest", bone: "spine_02", offset: [0.060, -0.130, 0.130], rotation: [8, 16, -10], scale: 0.90, weight: 0.84 },
  { id: "left_lat_socket", region: "back", bone: "spine_03", offset: [-0.120, -0.020, -0.110], rotation: [18, -32, 164], scale: 0.86, weight: 0.68 },
  { id: "right_lat_socket", region: "back", bone: "spine_03", offset: [0.120, -0.020, -0.110], rotation: [18, 32, -164], scale: 0.86, weight: 0.68 },
  { id: "left_elbow_socket", region: "forearm", bone: "lowerarm_l", offset: [0.030, 0.010, 0.038], rotation: [18, -32, 70], scale: 0.66, weight: 0.78 },
  { id: "right_elbow_socket", region: "forearm", bone: "lowerarm_r", offset: [-0.030, 0.010, 0.038], rotation: [-18, 32, -70], scale: 0.66, weight: 0.78 },
  { id: "left_wrist_socket", region: "hand", bone: "hand_l", offset: [0.020, 0.014, 0.038], rotation: [18, -14, 22], scale: 0.48, weight: 0.60 },
  { id: "right_wrist_socket", region: "hand", bone: "hand_r", offset: [-0.020, 0.014, 0.038], rotation: [-18, 14, -22], scale: 0.48, weight: 0.60 },
  { id: "left_thigh_front", region: "leg", bone: "thigh_l", offset: [0.028, -0.095, 0.094], rotation: [10, -16, 34], scale: 0.78, weight: 0.78 },
  { id: "right_thigh_front", region: "leg", bone: "thigh_r", offset: [-0.028, -0.095, 0.094], rotation: [-10, 16, -34], scale: 0.78, weight: 0.78 },
  { id: "left_thigh_back", region: "leg", bone: "thigh_l", offset: [0.022, -0.100, -0.070], rotation: [20, 170, 26], scale: 0.72, weight: 0.58 },
  { id: "right_thigh_back", region: "leg", bone: "thigh_r", offset: [-0.022, -0.100, -0.070], rotation: [-20, -170, -26], scale: 0.72, weight: 0.58 },
  { id: "left_shin_front", region: "leg", bone: "calf_l", offset: [0.022, -0.060, 0.060], rotation: [14, -10, 38], scale: 0.62, weight: 0.70 },
  { id: "right_shin_front", region: "leg", bone: "calf_r", offset: [-0.022, -0.060, 0.060], rotation: [-14, 10, -38], scale: 0.62, weight: 0.70 },
  { id: "left_ankle_socket", region: "foot", bone: "foot_l", offset: [0.018, 0.012, 0.052], rotation: [18, -12, 28], scale: 0.50, weight: 0.48 },
  { id: "right_ankle_socket", region: "foot", bone: "foot_r", offset: [-0.018, 0.012, 0.052], rotation: [-18, 12, -28], scale: 0.50, weight: 0.48 },
  { id: "left_orbital_implant", region: "head", bone: "head", offset: [-0.034, 0.034, 0.108], rotation: [-8, -10, 4], scale: 0.58, weight: 0.66 },
  { id: "right_orbital_implant", region: "head", bone: "head", offset: [0.034, 0.034, 0.108], rotation: [-8, 10, -4], scale: 0.58, weight: 0.66 },
  { id: "left_ear_port", region: "head", bone: "head", offset: [-0.086, 0.006, 0.050], rotation: [0, -74, 8], scale: 0.54, weight: 0.56 },
  { id: "right_ear_port", region: "head", bone: "head", offset: [0.086, 0.006, 0.050], rotation: [0, 74, -8], scale: 0.54, weight: 0.56 },
  { id: "crown_shard", region: "head", bone: "head", offset: [-0.016, 0.082, 0.040], rotation: [-22, -4, 16], scale: 0.66, weight: 0.48 },
  { id: "back_skull_socket", region: "head", bone: "head", offset: [-0.034, 0.012, -0.104], rotation: [12, 166, 12], scale: 0.66, weight: 0.50 },
  { id: "left_trap_socket", region: "shoulder", bone: "clavicle_l", offset: [0.056, 0.064, 0.034], rotation: [18, -18, 34], scale: 0.74, weight: 0.82 },
  { id: "right_trap_socket", region: "shoulder", bone: "clavicle_r", offset: [-0.056, 0.064, 0.034], rotation: [-18, 18, -34], scale: 0.74, weight: 0.82 },
  { id: "left_pec_teardown", region: "chest", bone: "spine_03", offset: [-0.104, 0.034, 0.146], rotation: [8, -26, 18], scale: 1.00, weight: 1.06 },
  { id: "right_pec_teardown", region: "chest", bone: "spine_03", offset: [0.104, 0.034, 0.146], rotation: [-8, 26, -18], scale: 1.00, weight: 1.06 },
  { id: "solar_plexus_socket", region: "chest", bone: "spine_02", offset: [0.000, -0.070, 0.148], rotation: [6, 0, -6], scale: 0.96, weight: 0.96 },
  { id: "navel_jack", region: "chest", bone: "spine_02", offset: [0.020, -0.170, 0.118], rotation: [10, 8, 8], scale: 0.76, weight: 0.66 },
  { id: "left_back_rib", region: "back", bone: "spine_03", offset: [-0.082, 0.036, -0.146], rotation: [16, -20, 178], scale: 0.82, weight: 0.74 },
  { id: "right_back_rib", region: "back", bone: "spine_03", offset: [0.082, 0.036, -0.146], rotation: [16, 20, -178], scale: 0.82, weight: 0.74 },
  { id: "left_kidney_cable", region: "back", bone: "spine_02", offset: [-0.088, -0.104, -0.116], rotation: [24, -28, 152], scale: 0.78, weight: 0.60 },
  { id: "right_kidney_cable", region: "back", bone: "spine_02", offset: [0.088, -0.104, -0.116], rotation: [24, 28, -152], scale: 0.78, weight: 0.60 },
  { id: "left_outer_hip_plate", region: "hip", bone: "thigh_l", offset: [0.082, 0.004, 0.034], rotation: [8, -54, 28], scale: 0.70, weight: 0.66 },
  { id: "right_outer_hip_plate", region: "hip", bone: "thigh_r", offset: [-0.082, 0.004, 0.034], rotation: [-8, 54, -28], scale: 0.70, weight: 0.66 },
  { id: "left_upperarm_outer", region: "upper_arm", bone: "upperarm_l", offset: [0.060, -0.038, 0.024], rotation: [8, -46, 58], scale: 0.68, weight: 0.76 },
  { id: "right_upperarm_outer", region: "upper_arm", bone: "upperarm_r", offset: [-0.060, -0.038, 0.024], rotation: [-8, 46, -58], scale: 0.68, weight: 0.76 },
  { id: "left_forearm_inner", region: "forearm", bone: "lowerarm_l", offset: [-0.014, -0.052, 0.050], rotation: [18, 12, 42], scale: 0.62, weight: 0.78 },
  { id: "right_forearm_inner", region: "forearm", bone: "lowerarm_r", offset: [0.014, -0.052, 0.050], rotation: [-18, -12, -42], scale: 0.62, weight: 0.78 },
  { id: "left_knuckle_jack", region: "hand", bone: "hand_l", offset: [0.024, -0.060, 0.032], rotation: [28, -18, 16], scale: 0.42, weight: 0.42 },
  { id: "right_knuckle_jack", region: "hand", bone: "hand_r", offset: [-0.024, -0.060, 0.032], rotation: [-28, 18, -16], scale: 0.42, weight: 0.42 },
  { id: "left_thigh_outer", region: "leg", bone: "thigh_l", offset: [0.070, -0.142, 0.030], rotation: [14, -46, 34], scale: 0.70, weight: 0.72 },
  { id: "right_thigh_outer", region: "leg", bone: "thigh_r", offset: [-0.070, -0.142, 0.030], rotation: [-14, 46, -34], scale: 0.70, weight: 0.72 },
  { id: "left_knee_side", region: "knee", bone: "calf_l", offset: [0.056, 0.020, 0.026], rotation: [18, -48, 46], scale: 0.66, weight: 0.76 },
  { id: "right_knee_side", region: "knee", bone: "calf_r", offset: [-0.056, 0.020, 0.026], rotation: [-18, 48, -46], scale: 0.66, weight: 0.76 },
  { id: "left_calf_back", region: "leg", bone: "calf_l", offset: [0.018, -0.086, -0.044], rotation: [22, 164, 32], scale: 0.58, weight: 0.56 },
  { id: "right_calf_back", region: "leg", bone: "calf_r", offset: [-0.018, -0.086, -0.044], rotation: [-22, -164, -32], scale: 0.58, weight: 0.56 },
  { id: "left_instep_wire", region: "foot", bone: "foot_l", offset: [0.012, -0.092, 0.044], rotation: [10, -8, 18], scale: 0.46, weight: 0.44 },
  { id: "right_instep_wire", region: "foot", bone: "foot_r", offset: [-0.012, -0.092, 0.044], rotation: [-10, 8, -18], scale: 0.46, weight: 0.44 },
  { id: "left_brow_pin", region: "head", bone: "head", offset: [-0.030, 0.056, 0.112], rotation: [-10, -14, 6], scale: 0.48, weight: 0.46 },
  { id: "right_brow_pin", region: "head", bone: "head", offset: [0.030, 0.056, 0.112], rotation: [-10, 14, -6], scale: 0.48, weight: 0.46 },
  { id: "chin_socket", region: "head", bone: "head", offset: [0.006, -0.082, 0.082], rotation: [22, 0, -6], scale: 0.52, weight: 0.42 },
  { id: "nape_port", region: "neck", bone: "neck_01", offset: [0.018, 0.018, -0.060], rotation: [18, 178, -10], scale: 0.58, weight: 0.58 },
  { id: "left_neck_side_socket", region: "neck", bone: "neck_01", offset: [-0.050, 0.004, 0.018], rotation: [4, -58, 16], scale: 0.52, weight: 0.58 },
  { id: "right_neck_side_socket", region: "neck", bone: "neck_01", offset: [0.050, 0.004, 0.018], rotation: [4, 58, -16], scale: 0.52, weight: 0.58 },
  { id: "left_low_rib_front", region: "chest", bone: "spine_02", offset: [-0.108, -0.102, 0.130], rotation: [8, -34, 20], scale: 0.78, weight: 0.74 },
  { id: "right_low_rib_front", region: "chest", bone: "spine_02", offset: [0.108, -0.102, 0.130], rotation: [8, 34, -20], scale: 0.78, weight: 0.74 },
  { id: "left_flank_socket", region: "chest", bone: "spine_02", offset: [-0.126, -0.066, 0.016], rotation: [16, -74, 28], scale: 0.70, weight: 0.64 },
  { id: "right_flank_socket", region: "chest", bone: "spine_02", offset: [0.126, -0.066, 0.016], rotation: [16, 74, -28], scale: 0.70, weight: 0.64 },
  { id: "left_scapula_port", region: "back", bone: "spine_03", offset: [-0.112, 0.036, -0.128], rotation: [18, -30, 168], scale: 0.72, weight: 0.70 },
  { id: "right_scapula_port", region: "back", bone: "spine_03", offset: [0.112, 0.036, -0.128], rotation: [18, 30, -168], scale: 0.72, weight: 0.70 },
  { id: "left_lumbar_side", region: "back", bone: "spine_02", offset: [-0.110, -0.132, -0.092], rotation: [22, -44, 154], scale: 0.66, weight: 0.54 },
  { id: "right_lumbar_side", region: "back", bone: "spine_02", offset: [0.110, -0.132, -0.092], rotation: [22, 44, -154], scale: 0.66, weight: 0.54 },
  { id: "left_glute_port", region: "hip", bone: "thigh_l", offset: [0.036, 0.020, -0.070], rotation: [20, 160, 24], scale: 0.62, weight: 0.46 },
  { id: "right_glute_port", region: "hip", bone: "thigh_r", offset: [-0.036, 0.020, -0.070], rotation: [20, -160, -24], scale: 0.62, weight: 0.46 },
  { id: "left_deltoid_front", region: "shoulder", bone: "upperarm_l", offset: [0.050, 0.050, 0.078], rotation: [4, -34, 52], scale: 0.62, weight: 0.72 },
  { id: "right_deltoid_front", region: "shoulder", bone: "upperarm_r", offset: [-0.050, 0.050, 0.078], rotation: [-4, 34, -52], scale: 0.62, weight: 0.72 },
  { id: "left_deltoid_back", region: "shoulder", bone: "upperarm_l", offset: [0.052, 0.046, -0.032], rotation: [16, -50, 72], scale: 0.60, weight: 0.60 },
  { id: "right_deltoid_back", region: "shoulder", bone: "upperarm_r", offset: [-0.052, 0.046, -0.032], rotation: [-16, 50, -72], scale: 0.60, weight: 0.60 },
  { id: "left_bicep_inner", region: "upper_arm", bone: "upperarm_l", offset: [-0.018, -0.072, 0.054], rotation: [14, 14, 42], scale: 0.54, weight: 0.62 },
  { id: "right_bicep_inner", region: "upper_arm", bone: "upperarm_r", offset: [0.018, -0.072, 0.054], rotation: [-14, -14, -42], scale: 0.54, weight: 0.62 },
  { id: "left_tricep_back", region: "upper_arm", bone: "upperarm_l", offset: [0.026, -0.080, -0.032], rotation: [20, 158, 58], scale: 0.56, weight: 0.54 },
  { id: "right_tricep_back", region: "upper_arm", bone: "upperarm_r", offset: [-0.026, -0.080, -0.032], rotation: [-20, -158, -58], scale: 0.56, weight: 0.54 },
  { id: "left_forearm_outer", region: "forearm", bone: "lowerarm_l", offset: [0.044, -0.070, 0.018], rotation: [16, -48, 62], scale: 0.54, weight: 0.70 },
  { id: "right_forearm_outer", region: "forearm", bone: "lowerarm_r", offset: [-0.044, -0.070, 0.018], rotation: [-16, 48, -62], scale: 0.54, weight: 0.70 },
  { id: "left_palm_socket", region: "hand", bone: "hand_l", offset: [0.006, -0.036, 0.052], rotation: [32, -4, 8], scale: 0.36, weight: 0.34 },
  { id: "right_palm_socket", region: "hand", bone: "hand_r", offset: [-0.006, -0.036, 0.052], rotation: [-32, 4, -8], scale: 0.36, weight: 0.34 },
  { id: "left_quad_plate", region: "leg", bone: "thigh_l", offset: [0.038, -0.168, 0.096], rotation: [10, -22, 34], scale: 0.64, weight: 0.68 },
  { id: "right_quad_plate", region: "leg", bone: "thigh_r", offset: [-0.038, -0.168, 0.096], rotation: [-10, 22, -34], scale: 0.64, weight: 0.68 },
  { id: "left_hamstring_socket", region: "leg", bone: "thigh_l", offset: [0.018, -0.176, -0.064], rotation: [20, 166, 28], scale: 0.58, weight: 0.52 },
  { id: "right_hamstring_socket", region: "leg", bone: "thigh_r", offset: [-0.018, -0.176, -0.064], rotation: [-20, -166, -28], scale: 0.58, weight: 0.52 },
  { id: "left_shin_side", region: "leg", bone: "calf_l", offset: [0.046, -0.112, 0.018], rotation: [18, -48, 40], scale: 0.52, weight: 0.58 },
  { id: "right_shin_side", region: "leg", bone: "calf_r", offset: [-0.046, -0.112, 0.018], rotation: [-18, 48, -40], scale: 0.52, weight: 0.58 },
  { id: "left_heel_port", region: "foot", bone: "foot_l", offset: [0.012, 0.024, -0.026], rotation: [12, 172, 18], scale: 0.38, weight: 0.34 },
  { id: "right_heel_port", region: "foot", bone: "foot_r", offset: [-0.012, 0.024, -0.026], rotation: [-12, -172, -18], scale: 0.38, weight: 0.34 },
];

const decorationAssetPool = [
  { kind: "skull_cog", regions: ["head", "chest", "shoulder", "knee", "back"], weight: 0.74 },
  { kind: "cyborg_eye", regions: ["head", "neck", "chest", "shoulder"], weight: 0.62 },
  { kind: "vent", regions: ["neck", "chest", "back", "hip", "shoulder", "forearm", "knee", "leg"], weight: 0.92 },
  { kind: "gear", regions: ["head", "neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"], weight: 0.9 },
  { kind: "wiring", regions: ["head", "neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hip", "hand", "knee", "leg", "foot"], weight: 1.0 },
  { kind: "intestines", regions: ["chest", "back", "hip"], weight: 0.54 },
  { kind: "bone_splinter", regions: ["head", "neck", "chest", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"], weight: 0.72 },
  { kind: "green_fuse", regions: ["head", "neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hand", "knee", "leg", "foot"], weight: 0.52 },
  { kind: "needle_bundle", regions: ["head", "neck", "chest", "shoulder", "upper_arm", "forearm", "hand", "knee", "leg", "foot"], weight: 0.66 },
  { kind: "jaw_plate", regions: ["head", "neck", "chest"], weight: 0.42 },
  { kind: "processor_chip", regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "hip", "knee"], weight: 0.72 },
  { kind: "circuit_board", regions: ["chest", "back", "shoulder", "upper_arm", "forearm", "hip", "leg"], weight: 0.72 },
  { kind: "ram_stick", regions: ["back", "chest", "upper_arm", "forearm", "leg"], weight: 0.52 },
  { kind: "piston", regions: ["shoulder", "upper_arm", "forearm", "hip", "knee", "leg"], weight: 0.74 },
  { kind: "exhaust_tube", regions: ["neck", "chest", "back", "shoulder", "upper_arm", "leg"], weight: 0.7 },
  { kind: "valve_wheel", regions: ["head", "chest", "back", "shoulder", "hip", "knee"], weight: 0.48 },
  { kind: "saw_blade", regions: ["head", "shoulder", "forearm", "knee", "leg"], weight: 0.44 },
  { kind: "bolt_cluster", regions: ["head", "neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"], weight: 0.7 },
  { kind: "cable_bundle", regions: ["neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg", "foot"], weight: 0.8 },
  { kind: "injector", regions: ["neck", "chest", "shoulder", "upper_arm", "forearm", "leg"], weight: 0.42 },
  { kind: "meat_hook", regions: ["chest", "back", "hip", "shoulder", "upper_arm", "forearm", "knee", "leg"], weight: 0.46 },
  { kind: "clamp", regions: ["head", "neck", "chest", "shoulder", "upper_arm", "forearm", "knee", "leg"], weight: 0.48 },
  { kind: "bio_tube", regions: ["neck", "chest", "back", "hip", "upper_arm", "forearm", "leg"], weight: 0.6 },
  { kind: "coil", regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "knee", "leg"], weight: 0.5 },
  { kind: "rib_spreader", look: "clamp", regions: ["chest", "back", "shoulder"], weight: 0.62, scaleBoost: 1.18 },
  { kind: "spinal_port", look: "processor_chip", regions: ["neck", "back", "chest"], weight: 0.64, scaleBoost: 1.12 },
  { kind: "iron_staple", look: "clamp", regions: ["head", "neck", "chest", "shoulder", "upper_arm", "forearm", "knee", "leg"], weight: 0.70, scaleBoost: 1.08 },
  { kind: "clotted_gore_pin", look: "intestines", regions: ["head", "neck", "chest", "back", "upper_arm", "forearm", "hip", "leg"], weight: 0.72, scaleBoost: 1.18 },
  { kind: "neural_jack", look: "green_fuse", regions: ["head", "neck", "back", "chest", "forearm"], weight: 0.60, scaleBoost: 1.06 },
  { kind: "femur_brace", look: "piston", regions: ["hip", "leg", "knee"], weight: 0.62, scaleBoost: 1.20 },
  { kind: "red_status_led", look: "cyborg_eye", regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "knee"], weight: 0.54, scaleBoost: 0.96 },
  { kind: "copper_tendon", look: "coil", regions: ["neck", "chest", "back", "upper_arm", "forearm", "leg", "foot"], weight: 0.72, scaleBoost: 1.18 },
  { kind: "black_box", look: "processor_chip", regions: ["head", "chest", "back", "shoulder", "hip", "leg"], weight: 0.56, scaleBoost: 1.16 },
  { kind: "razor_fin", look: "saw_blade", regions: ["head", "shoulder", "forearm", "knee", "leg"], weight: 0.50, scaleBoost: 1.12 },
  { kind: "bone_rivet", look: "bone_splinter", regions: ["head", "neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"], weight: 0.62, scaleBoost: 0.98 },
  { kind: "wet_sinew_cable", look: "bio_tube", regions: ["neck", "chest", "back", "hip", "upper_arm", "forearm", "leg"], weight: 0.68, scaleBoost: 1.24 },
  { kind: "servo_eye_cluster", look: "cyborg_eye", regions: ["head", "chest", "back", "shoulder"], weight: 0.42, scaleBoost: 1.12 },
  { kind: "mangled_socket", look: "vent", regions: ["head", "neck", "chest", "back", "shoulder", "hip", "knee", "leg"], weight: 0.66, scaleBoost: 1.22 },
  { kind: "rusted_hinge", look: "valve_wheel", regions: ["shoulder", "upper_arm", "forearm", "hip", "knee", "leg"], weight: 0.58, scaleBoost: 1.12 },
  {
    kind: "scifi_clamp_prop",
    look: "clamp",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_clamp.fbx",
    assetScale: 0.016,
    assetLift: 0.018,
    regions: ["head", "neck", "chest", "shoulder", "forearm", "knee", "leg"],
    weight: 0.54,
  },
  {
    kind: "scifi_light_small_prop",
    look: "green_fuse",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_light_small.fbx",
    assetScale: 0.018,
    assetLift: 0.020,
    regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "hip", "knee", "leg"],
    weight: 0.52,
  },
  {
    kind: "scifi_light_wide_prop",
    look: "green_fuse",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_light_wide.fbx",
    assetScale: 0.014,
    assetLift: 0.018,
    regions: ["chest", "back", "shoulder", "forearm", "hip", "leg"],
    weight: 0.40,
  },
  {
    kind: "scifi_pipe_holder_prop",
    look: "exhaust_tube",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_pipe_holder.fbx",
    assetScale: 0.007,
    assetLift: 0.018,
    regions: ["neck", "chest", "back", "shoulder", "upper_arm", "forearm", "knee", "leg"],
    weight: 0.52,
  },
  {
    kind: "scifi_item_holder_prop",
    look: "piston",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_item_holder.fbx",
    assetScale: 0.014,
    assetLift: 0.018,
    regions: ["chest", "back", "hip", "shoulder", "upper_arm", "forearm", "leg"],
    weight: 0.42,
  },
  {
    kind: "scifi_computer_prop",
    look: "processor_chip",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_computer.fbx",
    assetScale: 0.014,
    assetLift: 0.018,
    regions: ["head", "chest", "back", "hip"],
    weight: 0.36,
  },
  {
    kind: "scifi_cable_prop",
    look: "cable_bundle",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_cable_3.fbx",
    assetScale: 0.006,
    assetLift: 0.018,
    regions: ["neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"],
    weight: 0.58,
  },
  {
    kind: "scifi_vent_wide_prop",
    look: "vent",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_vent_wide.fbx",
    assetScale: 0.016,
    assetLift: 0.018,
    regions: ["neck", "chest", "back", "shoulder", "forearm", "hip", "knee", "leg"],
    weight: 0.50,
  },
  {
    kind: "scifi_round_rail_prop",
    look: "coil",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_rail_round_small.fbx",
    assetScale: 0.004,
    assetLift: 0.016,
    regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "knee"],
    weight: 0.34,
  },
  {
    kind: "scifi_rail_prop",
    look: "piston",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_rail_2.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "shoulder", "upper_arm", "forearm", "hip", "leg"],
    weight: 0.36,
  },
  {
    kind: "scifi_incline_rail_prop",
    look: "piston",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_rail_incline_short_l.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["shoulder", "upper_arm", "forearm", "hip", "knee", "leg"],
    weight: 0.32,
  },
  {
    kind: "scifi_fan_prop",
    look: "gear",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_fan_small.fbx",
    assetScale: 0.016,
    assetLift: 0.018,
    regions: ["head", "chest", "back", "shoulder", "forearm", "knee"],
    weight: 0.42,
    spinMultiplier: 1.3,
  },
  {
    kind: "scifi_access_prop",
    look: "processor_chip",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_access_point.fbx",
    assetScale: 0.016,
    assetLift: 0.018,
    regions: ["head", "neck", "chest", "back", "hip"],
    weight: 0.42,
  },
  {
    kind: "scifi_support_column_prop",
    look: "piston",
    assetFile: "decorations/quaternius-scifi-kitbash/column_metal_support.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"],
    weight: 0.30,
  },
  {
    kind: "scifi_pipe_column_prop",
    look: "exhaust_tube",
    assetFile: "decorations/quaternius-scifi-kitbash/column_pipes.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "chest", "hip", "leg"],
    weight: 0.30,
  },
  {
    kind: "alien_cyclop_growth_prop",
    look: "bio_tube",
    assetFile: "decorations/quaternius-scifi-kitbash/alien_cyclop.fbx",
    assetScale: 0.014,
    assetLift: 0.018,
    regions: ["head", "chest", "back", "hip"],
    weight: 0.28,
  },
  {
    kind: "alien_oculichrysalis_growth_prop",
    look: "intestines",
    assetFile: "decorations/quaternius-scifi-kitbash/alien_oculichrysalis.fbx",
    assetScale: 0.014,
    assetLift: 0.018,
    regions: ["head", "neck", "chest", "back", "hip"],
    weight: 0.28,
  },
  {
    kind: "alien_scolitex_growth_prop",
    look: "wet_sinew_cable",
    assetFile: "decorations/quaternius-scifi-kitbash/alien_scolitex.fbx",
    assetScale: 0.003,
    assetLift: 0.016,
    regions: ["chest", "back", "hip", "leg"],
    weight: 0.20,
  },
  {
    kind: "scifi_cable_1_prop",
    look: "cable_bundle",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_cable_1.fbx",
    assetScale: 0.006,
    assetLift: 0.018,
    regions: ["neck", "chest", "back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"],
    weight: 0.46,
  },
  {
    kind: "scifi_chest_box_prop",
    look: "black_box",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_chest.fbx",
    assetScale: 0.004,
    assetLift: 0.014,
    regions: ["chest", "back", "hip"],
    weight: 0.24,
  },
  {
    kind: "scifi_light_corner_prop",
    look: "red_status_led",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_light_corner.fbx",
    assetScale: 0.012,
    assetLift: 0.018,
    regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "knee"],
    weight: 0.36,
  },
  {
    kind: "scifi_light_floor_prop",
    look: "green_fuse",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_light_floor.fbx",
    assetScale: 0.014,
    assetLift: 0.018,
    regions: ["chest", "back", "shoulder", "hip", "leg"],
    weight: 0.32,
  },
  {
    kind: "scifi_vent_big_prop",
    look: "mangled_socket",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_vent_big.fbx",
    assetScale: 0.012,
    assetLift: 0.016,
    regions: ["chest", "back", "hip", "shoulder", "knee", "leg"],
    weight: 0.34,
  },
  {
    kind: "scifi_vent_small_prop",
    look: "vent",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_vent_small.fbx",
    assetScale: 0.018,
    assetLift: 0.018,
    regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "knee", "leg"],
    weight: 0.42,
  },
  {
    kind: "scifi_rail_3_prop",
    look: "piston",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_rail_3.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "shoulder", "upper_arm", "forearm", "hip", "leg"],
    weight: 0.24,
  },
  {
    kind: "scifi_rail_4_prop",
    look: "piston",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_rail_4.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "shoulder", "upper_arm", "forearm", "hip", "leg"],
    weight: 0.24,
  },
  {
    kind: "scifi_round_rail_big_prop",
    look: "coil",
    assetFile: "decorations/quaternius-scifi-kitbash/prop_rail_round_big.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["head", "chest", "back", "shoulder", "hip", "knee"],
    weight: 0.20,
  },
  {
    kind: "scifi_column_astra_prop",
    look: "black_box",
    assetFile: "decorations/quaternius-scifi-kitbash/column_astra.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "chest", "shoulder", "hip", "leg"],
    weight: 0.22,
  },
  {
    kind: "scifi_column_hollow_prop",
    look: "mangled_socket",
    assetFile: "decorations/quaternius-scifi-kitbash/column_hollow.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "chest", "shoulder", "hip", "leg"],
    weight: 0.22,
  },
  {
    kind: "scifi_support_curve_prop",
    look: "piston",
    assetFile: "decorations/quaternius-scifi-kitbash/column_metal_support_curve.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"],
    weight: 0.24,
  },
  {
    kind: "scifi_column_round_prop",
    look: "coil",
    assetFile: "decorations/quaternius-scifi-kitbash/column_round.fbx",
    assetScale: 0.003,
    assetLift: 0.014,
    regions: ["head", "neck", "chest", "back", "shoulder", "hip", "knee"],
    weight: 0.22,
  },
  {
    kind: "scifi_hanging_cables_prop",
    look: "wet_sinew_cable",
    assetFile: "decorations/quaternius-scifi-kitbash/top_cables_straight_hanging.fbx",
    assetScale: 0.0015,
    assetLift: 0.012,
    regions: ["back", "chest", "hip", "leg"],
    weight: 0.16,
  },
  {
    kind: "space_connector_prop",
    look: "coil",
    assetFile: "decorations/quaternius-space-kitbash/Connector.glb",
    assetScale: 0.09,
    assetLift: 0.018,
    assetTargetSize: 0.105,
    regions: ["neck", "chest", "back", "shoulder", "hip", "knee"],
    weight: 0.42,
  },
  {
    kind: "space_metal_support_prop",
    look: "piston",
    assetFile: "decorations/quaternius-space-kitbash/Metal Support.glb",
    assetScale: 0.09,
    assetLift: 0.016,
    assetTargetSize: 0.115,
    regions: ["back", "shoulder", "upper_arm", "forearm", "hip", "knee", "leg"],
    weight: 0.42,
  },
  {
    kind: "space_antenna_prop",
    look: "needle_bundle",
    assetFile: "decorations/quaternius-space-kitbash/Roof Antenna.glb",
    assetScale: 0.08,
    assetLift: 0.022,
    assetTargetSize: 0.120,
    regions: ["head", "neck", "back", "shoulder", "forearm"],
    weight: 0.24,
  },
  {
    kind: "space_radar_prop",
    look: "cyborg_eye",
    assetFile: "decorations/quaternius-space-kitbash/Roof Radar.glb",
    assetScale: 0.08,
    assetLift: 0.020,
    assetTargetSize: 0.110,
    regions: ["head", "chest", "back", "shoulder", "hip", "knee"],
    weight: 0.0,
    disabled: true,
  },
  {
    kind: "space_keycard_prop",
    look: "circuit_board",
    assetFile: "decorations/quaternius-space-kitbash/Pickup Key Card.glb",
    assetScale: 0.10,
    assetLift: 0.016,
    assetTargetSize: 0.085,
    regions: ["head", "neck", "chest", "back", "upper_arm", "forearm", "hip", "leg"],
    weight: 0.42,
  },
  {
    kind: "space_sphere_prop",
    look: "green_fuse",
    assetFile: "decorations/quaternius-space-kitbash/Pickup Sphere.glb",
    assetScale: 0.10,
    assetLift: 0.018,
    assetTargetSize: 0.090,
    regions: ["head", "neck", "chest", "back", "shoulder", "forearm", "knee"],
    weight: 0.0,
    disabled: true,
  },
  {
    kind: "space_thunder_prop",
    look: "green_fuse",
    assetFile: "decorations/quaternius-space-kitbash/Pickup Thunder.glb",
    assetScale: 0.10,
    assetLift: 0.018,
    assetTargetSize: 0.095,
    regions: ["head", "chest", "back", "shoulder", "forearm", "leg", "foot"],
    weight: 0.0,
    disabled: true,
  },
  {
    kind: "space_solar_panel_prop",
    look: "circuit_board",
    assetFile: "decorations/quaternius-space-kitbash/Solar Panel.glb",
    assetScale: 0.08,
    assetLift: 0.016,
    assetTargetSize: 0.110,
    regions: ["chest", "back", "shoulder", "upper_arm", "forearm", "hip", "leg"],
    weight: 0.42,
  },
  {
    kind: "space_solar_ground_prop",
    look: "circuit_board",
    assetFile: "decorations/quaternius-space-kitbash/Solar Panel Ground.glb",
    assetScale: 0.08,
    assetLift: 0.016,
    assetTargetSize: 0.105,
    regions: ["chest", "back", "shoulder", "hip", "knee", "leg"],
    weight: 0.32,
  },
  {
    kind: "space_solar_structure_prop",
    look: "piston",
    assetFile: "decorations/quaternius-space-kitbash/Solar Panel Structure.glb",
    assetScale: 0.07,
    assetLift: 0.016,
    assetTargetSize: 0.125,
    regions: ["back", "shoulder", "upper_arm", "forearm", "hip", "leg"],
    weight: 0.30,
  },
  {
    kind: "space_bullets_prop",
    look: "bolt_cluster",
    assetFile: "decorations/quaternius-space-kitbash/Bullets Pickup.glb",
    assetScale: 0.10,
    assetLift: 0.016,
    assetTargetSize: 0.090,
    regions: ["chest", "back", "shoulder", "hip", "forearm", "knee", "leg"],
    weight: 0.40,
  },
  {
    kind: "space_health_capsule_prop",
    look: "bio_tube",
    assetFile: "decorations/quaternius-space-kitbash/Pickup Health.glb",
    assetScale: 0.10,
    assetLift: 0.018,
    assetTargetSize: 0.090,
    regions: ["neck", "chest", "back", "shoulder", "hip", "leg"],
    weight: 0.0,
    disabled: true,
  },
  {
    kind: "space_jar_prop",
    look: "intestines",
    assetFile: "decorations/quaternius-space-kitbash/Pickup Jar.glb",
    assetScale: 0.10,
    assetLift: 0.018,
    assetTargetSize: 0.090,
    regions: ["chest", "back", "hip", "leg"],
    weight: 0.0,
    disabled: true,
  },
  {
    kind: "space_geodesic_prop",
    look: "mangled_socket",
    assetFile: "decorations/quaternius-space-kitbash/Geodesic Dome.glb",
    assetScale: 0.08,
    assetLift: 0.018,
    assetTargetSize: 0.105,
    regions: ["head", "chest", "back", "shoulder", "hip", "knee"],
    weight: 0.0,
    disabled: true,
  },
  {
    kind: "space_crate_mini_prop",
    look: "black_box",
    assetFile: "decorations/quaternius-space-kitbash/Pickup Crate.glb",
    assetScale: 0.08,
    assetLift: 0.016,
    assetTargetSize: 0.095,
    regions: ["chest", "back", "shoulder", "hip", "leg"],
    weight: 0.30,
  },
];

const decorationLooks = {
  skull_cog: {
    material: "oily_metal",
    color: [0.17, 0.18, 0.17, 1.0],
    metallic: 0.88,
    roughness: 0.27,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  cyborg_eye: {
    material: "optic",
    color: [0.05, 0.07, 0.07, 1.0],
    metallic: 0.76,
    roughness: 0.20,
    emission: [0.90, 0.035, 0.018],
    emissionEnergy: 1.15,
  },
  vent: {
    material: "blackened_machine",
    color: [0.075, 0.082, 0.082, 1.0],
    metallic: 0.82,
    roughness: 0.34,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  gear: {
    material: "burnished_gear",
    color: [0.24, 0.22, 0.185, 1.0],
    metallic: 0.86,
    roughness: 0.31,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  wiring: {
    material: "rubber_copper_wire",
    color: [0.09, 0.075, 0.062, 1.0],
    metallic: 0.42,
    roughness: 0.46,
    emission: [0.0, 0.45, 0.32],
    emissionEnergy: 0.34,
  },
  intestines: {
    material: "wet_viscera",
    color: [0.43, 0.055, 0.042, 1.0],
    metallic: 0.0,
    roughness: 0.12,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  bone_splinter: {
    material: "bone",
    color: [0.62, 0.54, 0.39, 1.0],
    metallic: 0.0,
    roughness: 0.62,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  green_fuse: {
    material: "glitch_fuse",
    color: [0.015, 0.12, 0.086, 1.0],
    metallic: 0.10,
    roughness: 0.20,
    emission: [0.0, 0.82, 0.52],
    emissionEnergy: 0.72,
  },
  needle_bundle: {
    material: "surgical_spikes",
    color: [0.36, 0.35, 0.31, 1.0],
    metallic: 0.90,
    roughness: 0.24,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  jaw_plate: {
    material: "scraped_jaw_plate",
    color: [0.20, 0.19, 0.165, 1.0],
    metallic: 0.84,
    roughness: 0.29,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  processor_chip: {
    material: "black_pcb",
    color: [0.025, 0.050, 0.044, 1.0],
    metallic: 0.58,
    roughness: 0.28,
    emission: [0.0, 0.62, 0.34],
    emissionEnergy: 0.30,
  },
  circuit_board: {
    material: "burned_circuit_board",
    color: [0.038, 0.095, 0.070, 1.0],
    metallic: 0.48,
    roughness: 0.32,
    emission: [0.0, 0.48, 0.28],
    emissionEnergy: 0.22,
  },
  ram_stick: {
    material: "ram_implant",
    color: [0.036, 0.058, 0.052, 1.0],
    metallic: 0.62,
    roughness: 0.26,
    emission: [0.0, 0.42, 0.30],
    emissionEnergy: 0.18,
  },
  piston: {
    material: "oily_piston",
    color: [0.20, 0.19, 0.165, 1.0],
    metallic: 0.88,
    roughness: 0.24,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  exhaust_tube: {
    material: "black_exhaust",
    color: [0.055, 0.050, 0.044, 1.0],
    metallic: 0.82,
    roughness: 0.40,
    emission: [0.18, 0.035, 0.012],
    emissionEnergy: 0.14,
  },
  valve_wheel: {
    material: "rusted_valve",
    color: [0.25, 0.105, 0.062, 1.0],
    metallic: 0.78,
    roughness: 0.34,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  saw_blade: {
    material: "ragged_saw",
    color: [0.32, 0.31, 0.27, 1.0],
    metallic: 0.92,
    roughness: 0.22,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  bolt_cluster: {
    material: "embedded_bolts",
    color: [0.18, 0.17, 0.145, 1.0],
    metallic: 0.86,
    roughness: 0.30,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  cable_bundle: {
    material: "mixed_cable_bundle",
    color: [0.065, 0.048, 0.040, 1.0],
    metallic: 0.44,
    roughness: 0.48,
    emission: [0.0, 0.54, 0.35],
    emissionEnergy: 0.28,
  },
  injector: {
    material: "infected_injector",
    color: [0.25, 0.24, 0.20, 1.0],
    metallic: 0.74,
    roughness: 0.24,
    emission: [0.80, 0.035, 0.018],
    emissionEnergy: 0.24,
  },
  meat_hook: {
    material: "bloodied_hook",
    color: [0.23, 0.20, 0.17, 1.0],
    metallic: 0.86,
    roughness: 0.27,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  clamp: {
    material: "surgical_clamp",
    color: [0.28, 0.27, 0.24, 1.0],
    metallic: 0.90,
    roughness: 0.20,
    emission: [0.0, 0.0, 0.0],
    emissionEnergy: 0.0,
  },
  bio_tube: {
    material: "flesh_machine_tube",
    color: [0.32, 0.048, 0.040, 1.0],
    metallic: 0.16,
    roughness: 0.16,
    emission: [0.0, 0.35, 0.24],
    emissionEnergy: 0.18,
  },
  coil: {
    material: "copper_induction_coil",
    color: [0.34, 0.16, 0.08, 1.0],
    metallic: 0.78,
    roughness: 0.30,
    emission: [0.0, 0.36, 0.24],
    emissionEnergy: 0.18,
  },
};

const decorationSinkByKind = {
  skull_cog: 0.044,
  gear: 0.040,
  cyborg_eye: 0.046,
  vent: 0.040,
  jaw_plate: 0.044,
  green_fuse: 0.034,
  wiring: 0.030,
  intestines: 0.026,
  needle_bundle: 0.026,
  bone_splinter: 0.030,
  processor_chip: 0.040,
  circuit_board: 0.038,
  ram_stick: 0.034,
  piston: 0.032,
  exhaust_tube: 0.034,
  valve_wheel: 0.040,
  saw_blade: 0.034,
  bolt_cluster: 0.030,
  cable_bundle: 0.030,
  injector: 0.028,
  meat_hook: 0.028,
  clamp: 0.034,
  bio_tube: 0.028,
  coil: 0.032,
};

function anchorSinkBoost(anchor) {
  if (anchor.region === "neck") return 0.014;
  if (anchor.region === "head") return 0.012;
  if (["chest", "back", "hip"].includes(anchor.region)) return 0.010;
  return 0.004;
}

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

function weightedChoice(rng, values, weightKey = "weight") {
  const total = values.reduce((sum, value) => sum + Math.max(0.001, Number(value[weightKey] ?? 1)), 0);
  let cursor = rng() * total;
  for (const value of values) {
    cursor -= Math.max(0.001, Number(value[weightKey] ?? 1));
    if (cursor <= 0) return value;
  }
  return values[values.length - 1];
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

function buildDecorationConfig(persona, rng) {
  const availableAnchors = [...decorationAnchors];
  const decorationCount = 24 + Math.floor(rng() * 10);
  const decorations = [];
  for (let i = 0; i < decorationCount && availableAnchors.length > 0; i += 1) {
    const anchor = weightedChoice(rng, availableAnchors);
    availableAnchors.splice(availableAnchors.indexOf(anchor), 1);
    const enabledAssets = decorationAssetPool.filter((asset) => !asset.disabled);
    const compatibleAssets = enabledAssets.filter((asset) => asset.regions.includes(anchor.region));
    const asset = weightedChoice(rng, compatibleAssets.length > 0 ? compatibleAssets : enabledAssets);
    const kind = asset.kind;
    const look = decorationLooks[asset.look ?? kind] || decorationLooks.gear;
    const embeddedSink = (decorationSinkByKind[kind] ?? 0.036) + anchorSinkBoost(anchor);
    const scaleBoost = Number(asset.scaleBoost ?? 1.0);
    const decoration = {
      id: `${persona.id}_${anchor.id}_${i}`,
      kind,
      anchor: anchor.id,
      region: anchor.region,
      bone: anchor.bone,
      offset: jitterArray(rng, anchor.offset, 0.014),
      rotation: jitterArray(rng, anchor.rotation, 13.0),
      scale: roundNumber(anchor.scale * scaleBoost * jitter(rng, 0.24)),
      embeddedSink: roundNumber(embeddedSink * jitter(rng, 0.16)),
      color: roundArray(look.color),
      metallic: roundNumber(look.metallic),
      roughness: roundNumber(look.roughness),
      emission: roundArray(look.emission),
      emissionEnergy: roundNumber(look.emissionEnergy * jitter(rng, 0.18)),
      socketColor: roundArray([0.18 + rng() * 0.06, 0.018 + rng() * 0.018, 0.012 + rng() * 0.018, 1.0]),
      spin: kind === "gear" || kind === "skull_cog" || kind.includes("fan") || kind.includes("round_rail")
        ? roundNumber((18.0 + rng() * 46.0) * Number(asset.spinMultiplier ?? 1.0))
        : 0.0,
      pulse: look.emissionEnergy > 0.0,
    };
    if (asset.assetFile) {
      decoration.assetFile = asset.assetFile;
      decoration.assetScale = roundNumber(Number(asset.assetScale ?? 0.05) * jitter(rng, 0.18));
      decoration.assetTargetSize = roundNumber(Number(asset.assetTargetSize ?? 0.09) * jitter(rng, 0.14));
      decoration.assetRotation = jitterArray(rng, asset.assetRotation ?? [0, 0, 0], 10.0);
      decoration.assetLift = roundNumber(Number(asset.assetLift ?? 0.016) * jitter(rng, 0.20));
    }
    decorations.push(decoration);
  }
  return decorations;
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
    decorations: buildDecorationConfig(persona, rng),
    uvDrift: {
      x: roundNumber((rng() * 2 - 1) * 0.34),
      y: roundNumber((rng() * 2 - 1) * 0.34),
      scaleX: roundNumber(jitter(rng, 0.18)),
      scaleY: roundNumber(jitter(rng, 0.18)),
    },
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
      `PASS ${variant.id} seed=${variant.seed} metal=${variant.metalBrightness} gore=${variant.goreBrightness} green=${variant.greenBoost} decorations=${variant.decorations.length}`,
    );
  }
  console.log(`runtime=${path.relative(appRoot, runtimeConfigPath)}`);
  console.log(`report=${path.relative(appRoot, reportPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
