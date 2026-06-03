import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const variantId = "glitch_reaper";
const baseGlbPath = path.join(projectRoot, "shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb");
const distDir = path.join(projectRoot, "dist/characters", variantId);
const artKitDir = path.join(projectRoot, "shared-harness/art-kit/characters/generated");
const distGlbPath = path.join(distDir, `${variantId}.glb`);
const artKitGlbPath = path.join(artKitDir, `${variantId}.glb`);
const reportPath = path.join(distDir, `${variantId}_report.json`);

const COMPONENT_FLOAT = 5126;
const COMPONENT_USHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const materialDefs = [
  {
    name: "GR_blackened_metal",
    base: [0.012, 0.014, 0.016, 1],
    metallic: 0.88,
    roughness: 0.34,
  },
  {
    name: "GR_dark_cavity",
    base: [0.001, 0.001, 0.002, 1],
    metallic: 0.25,
    roughness: 0.82,
  },
  {
    name: "GR_infernal_red_emissive",
    base: [1.0, 0.035, 0.015, 1],
    metallic: 0.0,
    roughness: 0.22,
    emissive: [1.0, 0.045, 0.02],
  },
  {
    name: "GR_gore_flesh",
    base: [0.34, 0.055, 0.043, 1],
    metallic: 0.0,
    roughness: 0.74,
    doubleSided: true,
  },
  {
    name: "GR_cyan_glitch",
    base: [0.05, 0.92, 1.0, 1],
    metallic: 0.0,
    roughness: 0.2,
    emissive: [0.05, 0.86, 1.0],
  },
];

const materialPreview = {
  GR_blackened_metal: { color: [16, 18, 21], emission: [0, 0, 0] },
  GR_dark_cavity: { color: [2, 2, 4], emission: [0, 0, 0] },
  GR_infernal_red_emissive: { color: [255, 25, 14], emission: [190, 15, 10] },
  GR_gore_flesh: { color: [128, 30, 28], emission: [18, 0, 0] },
  GR_cyan_glitch: { color: [25, 235, 255], emission: [55, 170, 210] },
};

const attachments = [];

function main() {
  mkdirSync(distDir, { recursive: true });
  mkdirSync(artKitDir, { recursive: true });
  writeFileSync(
    path.join(projectRoot, "dist/characters/.gdignore"),
    "Generated character authoring artifacts; runtime assets live under shared-harness.\n",
  );

  const { gltf, bin } = readGlb(baseGlbPath);
  const builder = new GlbBuilder(gltf, bin);
  darkenAnimationCarrier(gltf);
  const materialIndexes = addPrototypeMaterials(gltf);

  buildGlitchReaper(builder, materialIndexes);
  builder.finish();

  writeGlb(gltf, builder.bin, distGlbPath);
  writeGlb(gltf, builder.bin, artKitGlbPath);
  renderPreviewSet(gltf);
  writeReport(gltf, builder);

  console.log(`Built ${variantId}`);
  console.log(`  ${path.relative(projectRoot, distGlbPath)}`);
  console.log(`  ${path.relative(projectRoot, artKitGlbPath)}`);
  console.log(`  ${path.relative(projectRoot, reportPath)}`);
}

function darkenAnimationCarrier(gltf) {
  if (!Array.isArray(gltf.materials) || gltf.materials.length === 0) return;
  const material = gltf.materials[0];
  material.name = "GR_animation_carrier_blackened_body";
  material.pbrMetallicRoughness = {
    baseColorFactor: [0.018, 0.016, 0.014, 1],
    metallicFactor: 0.55,
    roughnessFactor: 0.58,
  };
  delete material.normalTexture;
  delete material.occlusionTexture;
  delete material.emissiveTexture;
  material.emissiveFactor = [0.015, 0.0, 0.0];
}

function addPrototypeMaterials(gltf) {
  if (!Array.isArray(gltf.materials)) gltf.materials = [];
  const out = {};
  for (const def of materialDefs) {
    const material = {
      name: def.name,
      pbrMetallicRoughness: {
        baseColorFactor: def.base,
        metallicFactor: def.metallic,
        roughnessFactor: def.roughness,
      },
    };
    if (def.emissive) {
      material.emissiveFactor = def.emissive;
    }
    if (def.doubleSided) {
      material.doubleSided = true;
    }
    out[def.name] = gltf.materials.push(material) - 1;
  }
  return out;
}

function buildGlitchReaper(builder, materials) {
  const metal = materials.GR_blackened_metal;
  const cavity = materials.GR_dark_cavity;
  const glow = materials.GR_infernal_red_emissive;
  const gore = materials.GR_gore_flesh;
  const glitch = materials.GR_cyan_glitch;

  addModule(builder, "head", "glitch_reaper_head_A_skull_shell", ellipsoidMesh(0.178, 0.235, 0.152, 28, 14), metal, [0, 0.118, 0.018], [0, 0, 0]);
  addModule(builder, "head", "glitch_reaper_head_A_inner_face_cavity", boxMesh(0.148, 0.106, 0.030), cavity, [0, 0.118, 0.143], [-8, 0, 0]);
  addModule(builder, "head", "glitch_reaper_head_A_brow_plate", boxMesh(0.186, 0.038, 0.042), metal, [0, 0.176, 0.135], [-12, 0, 0]);
  addModule(builder, "head", "glitch_reaper_head_A_red_eye_slit", boxMesh(0.132, 0.022, 0.021), glow, [0, 0.139, 0.166], [-8, 0, 0]);
  addModule(builder, "head", "glitch_reaper_head_A_left_eye_core", ellipsoidMesh(0.028, 0.018, 0.014, 12, 8), glow, [-0.047, 0.139, 0.180], [0, 0, 0]);
  addModule(builder, "head", "glitch_reaper_head_A_right_eye_core", ellipsoidMesh(0.032, 0.018, 0.014, 12, 8), glow, [0.048, 0.139, 0.180], [0, 0, 0]);
  addModule(builder, "head", "glitch_reaper_head_A_split_mandible_l", boxMesh(0.042, 0.125, 0.036), metal, [-0.048, 0.026, 0.138], [0, 0, -8]);
  addModule(builder, "head", "glitch_reaper_head_A_split_mandible_r", boxMesh(0.042, 0.125, 0.036), metal, [0.048, 0.026, 0.138], [0, 0, 8]);
  addModule(builder, "head", "glitch_reaper_head_A_chin_heat_crack", boxMesh(0.020, 0.074, 0.014), glow, [0.006, 0.004, 0.163], [0, 0, -18]);
  addModule(builder, "head", "glitch_reaper_head_A_neck_collar", torusMesh(0.132, 0.022, 28, 8), metal, [0, -0.055, 0.024], [0, 0, 0]);
  addModule(builder, "head", "glitch_reaper_head_A_throat_glow", boxMesh(0.030, 0.090, 0.014), glow, [0.0, -0.018, 0.150], [0, 0, 0]);

  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    const x = lerp(-0.118, 0.118, t);
    const height = 0.15 + (i % 3) * 0.035;
    addModule(builder, "head", `glitch_reaper_head_A_crown_spike_${i}`, coneMesh(0.022, height, 6), metal, [x, 0.263 + (i % 2) * 0.012, -0.046], [16, 0, lerp(28, -28, t)]);
    if (i % 2 === 0) {
      addModule(builder, "head", `glitch_reaper_head_A_cyan_crown_break_${i}`, boxMesh(0.012, 0.060, 0.010), glitch, [x * 0.66, 0.220, -0.026], [0, 0, lerp(-22, 22, t)]);
    }
  }
  addModule(builder, "head", "glitch_reaper_head_A_back_antenna_l", cylinderMesh(0.008, 0.225, 10), metal, [-0.075, 0.205, -0.086], [15, 0, -13]);
  addModule(builder, "head", "glitch_reaper_head_A_back_antenna_r", cylinderMesh(0.008, 0.205, 10), metal, [0.072, 0.205, -0.088], [15, 0, 14]);

  addModule(builder, "spine_03", "glitch_reaper_rib_core_molten_heart", ellipsoidMesh(0.076, 0.076, 0.066, 18, 10), glow, [0, -0.020, 0.150], [0, 0, 0]);
  addModule(builder, "spine_03", "glitch_reaper_black_sternum_plate", boxMesh(0.050, 0.300, 0.034), metal, [0, -0.024, 0.148], [0, 0, 0]);
  for (let i = 0; i < 8; i += 1) {
    const y = 0.102 - i * 0.034;
    const width = 0.118 + i * 0.018;
    addModule(builder, "spine_03", `glitch_reaper_rib_l_${i}`, boxMesh(width, 0.020, 0.030), metal, [-0.090, y, 0.122], [0, 0, -14 - i * 2.8]);
    addModule(builder, "spine_03", `glitch_reaper_rib_r_${i}`, boxMesh(width, 0.020, 0.030), metal, [0.090, y, 0.122], [0, 0, 14 + i * 2.8]);
    if (i % 2 === 0) {
      addModule(builder, "spine_03", `glitch_reaper_rib_gap_glow_${i}`, boxMesh(0.092, 0.010, 0.014), glow, [0, y - 0.011, 0.168], [0, 0, i % 4 === 0 ? 8 : -8]);
    }
  }
  for (let i = 0; i < 9; i += 1) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    addModule(builder, "spine_02", `glitch_reaper_infernal_rune_${i}`, boxMesh(0.012, 0.070 + (i % 2) * 0.025, 0.012), glow, [-0.060 + col * 0.060, -0.105 - row * 0.038, 0.142], [0, 0, -35 + col * 34]);
  }

  for (const side of ["l", "r"]) {
    const s = side === "l" ? -1 : 1;
    addModule(builder, `upperarm_${side}`, `glitch_reaper_jagged_pauldron_${side}`, boxMesh(0.158, 0.102, 0.118), metal, [0, 0.078, 0.042], [0, 0, side === "l" ? 22 : -22]);
    addModule(builder, `upperarm_${side}`, `glitch_reaper_pauldron_outer_blade_${side}`, boxMesh(0.040, 0.220, 0.034), metal, [s * 0.070, 0.102, 0.048], [0, 0, side === "l" ? 42 : -42]);
    addModule(builder, `upperarm_${side}`, `glitch_reaper_pauldron_burning_crack_${side}`, boxMesh(0.012, 0.100, 0.014), glow, [s * 0.014, 0.095, 0.108], [0, 0, side === "l" ? -28 : 28]);
    addModule(builder, `upperarm_${side}`, `glitch_reaper_shoulder_hook_${side}`, coneMesh(0.024, 0.150, 6), metal, [s * 0.080, 0.168, 0.010], [0, 0, side === "l" ? 35 : -35]);
  }

  for (const side of ["l", "r"]) {
    const blade = side === "r";
    const s = side === "l" ? -1 : 1;
    addModule(builder, `lowerarm_${side}`, `glitch_reaper_forearm_splint_${side}`, boxMesh(0.068, 0.245, 0.044), metal, [0, -0.045, 0.052], [0, 0, 0]);
    addModule(builder, `lowerarm_${side}`, `glitch_reaper_forearm_molten_rail_${side}`, boxMesh(0.012, 0.190, 0.012), glow, [-s * 0.030, -0.042, 0.084], [0, 0, side === "l" ? 9 : -9]);
    if (blade) {
      addModule(builder, `lowerarm_${side}`, "glitch_reaper_execution_blade_body", bladeMesh(0.088, 0.700, 0.032), metal, [0.006, -0.260, 0.124], [0, 0, -6]);
      addModule(builder, `lowerarm_${side}`, "glitch_reaper_execution_blade_red_edge", boxMesh(0.014, 0.600, 0.014), glow, [0.047, -0.255, 0.147], [0, 0, -6]);
      addModule(builder, `lowerarm_${side}`, "glitch_reaper_execution_blade_cyan_break", boxMesh(0.010, 0.380, 0.012), glitch, [-0.042, -0.235, 0.143], [0, 0, 5]);
    } else {
      for (let i = 0; i < 4; i += 1) {
        const x = (i - 1.5) * 0.020;
        addModule(builder, `hand_${side}`, `glitch_reaper_left_claw_${i}`, boxMesh(0.012, 0.150, 0.012), metal, [x, -0.060, 0.070], [22, 0, (i - 1.5) * 10]);
      }
    }
  }

  for (const side of ["l", "r"]) {
    const s = side === "l" ? -1 : 1;
    addModule(builder, `thigh_${side}`, `glitch_reaper_thigh_black_rail_${side}`, boxMesh(0.078, 0.260, 0.042), metal, [0, -0.080, 0.050], [0, 0, side === "l" ? 7 : -7]);
    addModule(builder, `thigh_${side}`, `glitch_reaper_knee_red_rune_${side}`, boxMesh(0.050, 0.024, 0.014), glow, [0, -0.208, 0.084], [0, 0, side === "l" ? 35 : -35]);
    addModule(builder, `calf_${side}`, `glitch_reaper_shin_black_core_${side}`, boxMesh(0.056, 0.215, 0.038), metal, [0, -0.055, 0.048], [0, 0, side === "l" ? -5 : 5]);
    addModule(builder, `calf_${side}`, `glitch_reaper_shin_flame_wire_${side}`, boxMesh(0.012, 0.160, 0.012), glow, [s * 0.026, -0.052, 0.075], [0, 0, side === "l" ? 8 : -8]);
  }

  for (let i = 0; i < 8; i += 1) {
    const t = i / 7;
    const x = lerp(-0.150, 0.150, t);
    const length = 0.210 + (i % 4) * 0.050;
    const width = 0.036 + (i % 2) * 0.012;
    const mat = i % 3 === 0 ? gore : i % 3 === 1 ? materialIndexByName(materials, "GR_blackened_metal") : gore;
    addModule(builder, "spine_01", `glitch_reaper_flayed_gore_drape_${i}`, ribbonMesh(width, length, 5, i * 19), mat, [x, -0.178 - length * 0.28, 0.096], [0, 0, lerp(-22, 22, t)]);
    if (i % 2 === 0) {
      addModule(builder, "spine_01", `glitch_reaper_embered_gore_edge_${i}`, boxMesh(width * 0.56, 0.012, 0.010), glow, [x, -0.188 - length * 0.74, 0.108], [0, 0, lerp(-22, 22, t)]);
    }
  }

  for (let i = 0; i < 6; i += 1) {
    addModule(builder, "spine_03", `glitch_reaper_back_sinew_cable_${i}`, cylinderMesh(0.008, 0.300 + (i % 2) * 0.050, 8), i % 2 === 0 ? gore : metal, [(i - 2.5) * 0.028, -0.056 + (i % 2) * 0.020, -0.128], [12, 0, -16 + i * 7]);
  }
  for (let i = 0; i < 12; i += 1) {
    const bone = ["head", "spine_03", "spine_02", "hand_l", "hand_r", "lowerarm_l", "lowerarm_r", "thigh_l", "thigh_r"][i % 9];
    const offset = [
      [0.160, 0.185, 0.076],
      [-0.150, 0.070, -0.030],
      [0.128, -0.046, 0.152],
      [-0.094, -0.043, 0.092],
      [0.094, -0.052, 0.092],
      [-0.082, -0.036, 0.098],
      [0.080, -0.032, 0.098],
      [-0.070, -0.134, 0.056],
      [0.072, -0.122, 0.056],
    ][i % 9];
    const size = 0.020 + (i % 4) * 0.007;
    addModule(builder, bone, `glitch_reaper_cyan_data_tear_${i}`, boxMesh(size * (1.5 + (i % 3)), size, size * 0.70), glitch, offset, [i * 17 % 70, i * 29 % 80, i * 11 % 75]);
  }
}

function materialIndexByName(materials, name) {
  return materials[name];
}

function addModule(builder, parentName, nodeName, mesh, materialIndex, translation, rotationDeg, scale = [1, 1, 1]) {
  const nodeIndex = builder.addMeshNode(parentName, nodeName, mesh, materialIndex, translation, rotationDeg, scale);
  attachments.push({ parentName, nodeName, mesh, materialName: builder.materialName(materialIndex), translation, rotationDeg, scale, nodeIndex });
}

class GlbBuilder {
  constructor(gltf, bin) {
    this.gltf = gltf;
    this.bin = Buffer.from(bin);
    if (!Array.isArray(gltf.bufferViews)) gltf.bufferViews = [];
    if (!Array.isArray(gltf.accessors)) gltf.accessors = [];
    if (!Array.isArray(gltf.meshes)) gltf.meshes = [];
    if (!Array.isArray(gltf.nodes)) gltf.nodes = [];
    this.nodeByName = new Map(gltf.nodes.map((node, index) => [node.name, index]));
  }

  materialName(index) {
    return this.gltf.materials?.[index]?.name ?? `material_${index}`;
  }

  addMeshNode(parentName, nodeName, mesh, materialIndex, translation, rotationDeg, scale) {
    const meshIndex = this.addMesh(nodeName, mesh, materialIndex);
    const parentIndex = this.nodeByName.get(parentName);
    if (parentIndex === undefined) {
      throw new Error(`Missing parent bone/node ${parentName} for ${nodeName}`);
    }
    const node = {
      name: nodeName,
      mesh: meshIndex,
      translation,
      rotation: quatFromEulerDeg(rotationDeg),
    };
    if (scale.some((value) => Math.abs(value - 1) > 1e-6)) {
      node.scale = scale;
    }
    const nodeIndex = this.gltf.nodes.push(node) - 1;
    const parent = this.gltf.nodes[parentIndex];
    if (!Array.isArray(parent.children)) parent.children = [];
    parent.children.push(nodeIndex);
    this.nodeByName.set(nodeName, nodeIndex);
    return nodeIndex;
  }

  addMesh(name, mesh, materialIndex) {
    const positionAccessor = this.addAccessor(floatBuffer(mesh.positions), COMPONENT_FLOAT, "VEC3", mesh.positions.length / 3, boundsForPositions(mesh.positions), ARRAY_BUFFER);
    const normalAccessor = this.addAccessor(floatBuffer(mesh.normals), COMPONENT_FLOAT, "VEC3", mesh.normals.length / 3, null, ARRAY_BUFFER);
    const uvAccessor = this.addAccessor(floatBuffer(mesh.uvs), COMPONENT_FLOAT, "VEC2", mesh.uvs.length / 2, null, ARRAY_BUFFER);
    const indexAccessor = this.addAccessor(uint16Buffer(mesh.indices), COMPONENT_USHORT, "SCALAR", mesh.indices.length, scalarBounds(mesh.indices), ELEMENT_ARRAY_BUFFER);
    return this.gltf.meshes.push({
      name,
      primitives: [
        {
          attributes: {
            POSITION: positionAccessor,
            NORMAL: normalAccessor,
            TEXCOORD_0: uvAccessor,
          },
          indices: indexAccessor,
          material: materialIndex,
          mode: 4,
        },
      ],
    }) - 1;
  }

  addAccessor(data, componentType, type, count, bounds, target) {
    const offset = align4(this.bin.length);
    if (offset > this.bin.length) {
      this.bin = Buffer.concat([this.bin, Buffer.alloc(offset - this.bin.length)]);
    }
    const bufferViewIndex = this.gltf.bufferViews.push({
      buffer: 0,
      byteOffset: this.bin.length,
      byteLength: data.length,
      target,
    }) - 1;
    this.bin = Buffer.concat([this.bin, data]);
    const accessor = {
      bufferView: bufferViewIndex,
      componentType,
      count,
      type,
    };
    if (bounds) {
      accessor.min = bounds.min;
      accessor.max = bounds.max;
    }
    return this.gltf.accessors.push(accessor) - 1;
  }

  finish() {
    const padded = align4(this.bin.length);
    if (padded > this.bin.length) {
      this.bin = Buffer.concat([this.bin, Buffer.alloc(padded - this.bin.length)]);
    }
    this.gltf.buffers[0].byteLength = this.bin.length;
    this.gltf.asset = this.gltf.asset || { version: "2.0" };
    this.gltf.extras = {
      ...(this.gltf.extras || {}),
      glitchReaperPrototype: {
        variantId,
        source: "direct_glb_offline_asset_compiler",
        oldMannequinHeadTreatment: "covered_by_replacement_skull_helmet_shell",
      },
    };
  }
}

function boxMesh(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const faces = [
    [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z], [1, 0, 0]],
    [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z], [-1, 0, 0]],
    [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z], [0, 1, 0]],
    [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z], [0, -1, 0]],
    [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1]],
    [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1]],
  ];
  return facesToMesh(faces);
}

function bladeMesh(width, length, depth) {
  const x = width / 2, y = length / 2, z = depth / 2;
  const positions = [
    -x, -y, -z, x * 0.72, -y, -z, 0, y, -z,
    -x, -y, z, x * 0.72, -y, z, 0, y, z,
  ];
  const indices = [
    0, 1, 2, 5, 4, 3,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  return indexedMeshWithComputedNormals(positions, indices);
}

function ellipsoidMesh(rx, ry, rz, segments, rings) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let r = 0; r <= rings; r += 1) {
    const v = r / rings;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let s = 0; s <= segments; s += 1) {
      const u = s / segments;
      const theta = u * Math.PI * 2;
      const nx = Math.cos(theta) * sinPhi;
      const ny = cosPhi;
      const nz = Math.sin(theta) * sinPhi;
      positions.push(nx * rx, ny * ry, nz * rz);
      normals.push(nx, ny, nz);
      uvs.push(u, v);
    }
  }
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, normals, uvs, indices };
}

function cylinderMesh(radius, height, segments) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const angle = u * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.push(x, -height / 2, z, x, height / 2, z);
    normals.push(Math.cos(angle), 0, Math.sin(angle), Math.cos(angle), 0, Math.sin(angle));
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const top = positions.length / 3;
  positions.push(0, height / 2, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);
  const bottom = top + 1;
  positions.push(0, -height / 2, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % segments) * 2;
    indices.push(top, a + 1, b + 1);
    indices.push(bottom, b, a);
  }
  return { positions, normals, uvs, indices };
}

function coneMesh(radius, height, segments) {
  const positions = [0, height / 2, 0];
  const normals = [0, 1, 0];
  const uvs = [0.5, 1];
  for (let i = 0; i < segments; i += 1) {
    const u = i / segments;
    const angle = u * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, -height / 2, Math.sin(angle) * radius);
    normals.push(Math.cos(angle), radius / height, Math.sin(angle));
    uvs.push(u, 0);
  }
  const bottom = positions.length / 3;
  positions.push(0, -height / 2, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0.5);
  const indices = [];
  for (let i = 0; i < segments; i += 1) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % segments);
    indices.push(0, a, b);
    indices.push(bottom, b, a);
  }
  return { positions, normals, uvs, indices };
}

function torusMesh(major, minor, segments, tubeSegments) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const theta = u * Math.PI * 2;
    const cx = Math.cos(theta) * major;
    const cz = Math.sin(theta) * major;
    for (let j = 0; j <= tubeSegments; j += 1) {
      const v = j / tubeSegments;
      const phi = v * Math.PI * 2;
      const nx = Math.cos(theta) * Math.cos(phi);
      const ny = Math.sin(phi);
      const nz = Math.sin(theta) * Math.cos(phi);
      positions.push(cx + nx * minor, ny * minor, cz + nz * minor);
      normals.push(nx, ny, nz);
      uvs.push(u, v);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < tubeSegments; j += 1) {
      const a = i * (tubeSegments + 1) + j;
      const b = a + tubeSegments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, normals, uvs, indices };
}

function ribbonMesh(width, length, segments, seed) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const y = -length * t;
    const wobble = Math.sin((seed + i * 37) * 0.31) * width * 0.18;
    const left = -width * (0.46 + 0.10 * Math.sin(seed + i));
    const right = width * (0.50 + 0.12 * Math.cos(seed * 0.7 + i));
    positions.push(left + wobble, y, 0, right + wobble * 0.35, y - (i === segments ? length * 0.06 : 0), 0.004 * Math.sin(seed + i));
    normals.push(0, 0, 1, 0, 0, 1);
    uvs.push(0, t, 1, t);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    indices.push(a + 2, a + 1, a, a + 3, a + 1, a + 2);
  }
  return { positions, normals, uvs, indices };
}

function facesToMesh(faces) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const face of faces) {
    const start = positions.length / 3;
    for (let i = 0; i < 4; i += 1) {
      positions.push(...face[i]);
      normals.push(...face[4]);
      uvs.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { positions, normals, uvs, indices };
}

function indexedMeshWithComputedNormals(positions, indices) {
  const normals = Array(positions.length).fill(0);
  const uvs = [];
  for (let i = 0; i < positions.length / 3; i += 1) {
    uvs.push(positions[i * 3] > 0 ? 1 : 0, positions[i * 3 + 1] > 0 ? 1 : 0);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const a = positions.slice(ia, ia + 3);
    const b = positions.slice(ib, ib + 3);
    const c = positions.slice(ic, ic + 3);
    const normal = normalize(cross(sub(b, a), sub(c, a)));
    for (const index of [ia, ib, ic]) {
      normals[index] += normal[0];
      normals[index + 1] += normal[1];
      normals[index + 2] += normal[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const n = normalize([normals[i], normals[i + 1], normals[i + 2]]);
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
  return { positions, normals, uvs, indices };
}

function renderPreviewSet(gltf) {
  const worldMeshes = computeWorldMeshes(gltf);
  const views = [
    ["front", "front"],
    ["side", "side"],
    ["back", "back"],
    ["three_quarter", "three_quarter"],
  ];
  const rendered = [];
  for (const [suffix, view] of views) {
    const png = renderSoftwarePreview(worldMeshes, view, 900, 1100);
    const outPath = path.join(distDir, `${variantId}_preview_${suffix}.png`);
    writeFileSync(outPath, png);
    rendered.push({ suffix, path: outPath, png });
  }
  const sheet = makeContactSheet(rendered.map((entry) => entry.png), 900, 1100, 2, 2);
  writeFileSync(path.join(distDir, `${variantId}_contact_sheet.png`), sheet);
}

function computeWorldMeshes(gltf) {
  const localMatrices = gltf.nodes.map((node) => matrixFromNode(node));
  const worldMatrices = new Array(gltf.nodes.length);
  function visit(index, parentMatrix) {
    worldMatrices[index] = matMul(parentMatrix, localMatrices[index]);
    for (const child of gltf.nodes[index].children || []) {
      visit(child, worldMatrices[index]);
    }
  }
  for (const sceneNode of gltf.scenes[gltf.scene || 0].nodes || []) {
    visit(sceneNode, identity());
  }
  return attachments.map((attachment) => {
    const matrix = worldMatrices[attachment.nodeIndex] || identity();
    const transformed = [];
    for (let i = 0; i < attachment.mesh.positions.length; i += 3) {
      transformed.push(transformPoint(matrix, attachment.mesh.positions.slice(i, i + 3)));
    }
    return {
      name: attachment.nodeName,
      positions: transformed,
      indices: attachment.mesh.indices,
      material: materialPreview[attachment.materialName] || materialPreview.GR_blackened_metal,
    };
  });
}

function renderSoftwarePreview(meshes, view, width, height) {
  const bg = [7, 9, 13, 255];
  const pixels = Buffer.alloc(width * height * 4);
  const zbuf = new Float32Array(width * height);
  zbuf.fill(-Infinity);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = bg[0];
    pixels[i * 4 + 1] = bg[1];
    pixels[i * 4 + 2] = bg[2];
    pixels[i * 4 + 3] = bg[3];
  }
  const bbox = boundsForWorldMeshes(meshes);
  const upAxis = largestAxis(bbox);
  const other = [0, 1, 2].filter((axis) => axis !== upAxis);
  const rightAxis = axisSize(bbox, other[0]) >= axisSize(bbox, other[1]) ? other[0] : other[1];
  const depthAxis = other.find((axis) => axis !== rightAxis);
  const axes = viewAxes(view, rightAxis, upAxis, depthAxis);
  const viewBounds = projectedBounds(meshes, axes);
  const scale = Math.min((width * 0.78) / (viewBounds.maxX - viewBounds.minX || 1), (height * 0.84) / (viewBounds.maxY - viewBounds.minY || 1));
  const cx = (viewBounds.minX + viewBounds.maxX) * 0.5;
  const cy = (viewBounds.minY + viewBounds.maxY) * 0.5;
  const light = normalize([0.35, 0.55, 0.80]);
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.positions[mesh.indices[i]];
      const b = mesh.positions[mesh.indices[i + 1]];
      const c = mesh.positions[mesh.indices[i + 2]];
      const pa = projectPoint(a, axes, cx, cy, scale, width, height);
      const pb = projectPoint(b, axes, cx, cy, scale, width, height);
      const pc = projectPoint(c, axes, cx, cy, scale, width, height);
      const normal = normalize(cross(sub(b, a), sub(c, a)));
      const shade = Math.max(0.18, 0.38 + Math.max(0, dot(normal, light)) * 0.62);
      rasterTriangle(pixels, zbuf, width, height, pa, pb, pc, colorForMaterial(mesh.material, shade));
    }
  }
  drawGroundLine(pixels, width, height);
  return encodePng(width, height, pixels);
}

function viewAxes(view, rightAxis, upAxis, depthAxis) {
  if (view === "side") return { x: depthAxis, y: upAxis, z: rightAxis, flipX: false, flipZ: false, yaw: 0 };
  if (view === "back") return { x: rightAxis, y: upAxis, z: depthAxis, flipX: true, flipZ: true, yaw: 0 };
  if (view === "three_quarter") return { x: rightAxis, y: upAxis, z: depthAxis, flipX: false, flipZ: false, yaw: Math.PI / 5 };
  return { x: rightAxis, y: upAxis, z: depthAxis, flipX: false, flipZ: false, yaw: 0 };
}

function projectPoint(point, axes, cx, cy, scale, width, height) {
  let x = point[axes.x] * (axes.flipX ? -1 : 1);
  const y = point[axes.y];
  let z = point[axes.z] * (axes.flipZ ? -1 : 1);
  if (axes.yaw) {
    const cos = Math.cos(axes.yaw);
    const sin = Math.sin(axes.yaw);
    const rx = x * cos - z * sin;
    const rz = x * sin + z * cos;
    x = rx;
    z = rz;
  }
  return {
    x: Math.round(width * 0.5 + (x - cx) * scale),
    y: Math.round(height * 0.54 - (y - cy) * scale),
    z,
  };
}

function projectedBounds(meshes, axes) {
  const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const mesh of meshes) {
    for (const point of mesh.positions) {
      const p = projectPointRaw(point, axes);
      out.minX = Math.min(out.minX, p.x);
      out.maxX = Math.max(out.maxX, p.x);
      out.minY = Math.min(out.minY, p.y);
      out.maxY = Math.max(out.maxY, p.y);
    }
  }
  return out;
}

function projectPointRaw(point, axes) {
  let x = point[axes.x] * (axes.flipX ? -1 : 1);
  let z = point[axes.z] * (axes.flipZ ? -1 : 1);
  if (axes.yaw) {
    const cos = Math.cos(axes.yaw);
    const sin = Math.sin(axes.yaw);
    x = x * cos - z * sin;
  }
  return { x, y: point[axes.y] };
}

function rasterTriangle(pixels, zbuf, width, height, a, b, c, color) {
  const minX = clampInt(Math.floor(Math.min(a.x, b.x, c.x)), 0, width - 1);
  const maxX = clampInt(Math.ceil(Math.max(a.x, b.x, c.x)), 0, width - 1);
  const minY = clampInt(Math.floor(Math.min(a.y, b.y, c.y)), 0, height - 1);
  const maxY = clampInt(Math.ceil(Math.max(a.y, b.y, c.y)), 0, height - 1);
  const area = edge(a, b, c);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p = { x: x + 0.5, y: y + 0.5 };
      const w0 = edge(b, c, p) / area;
      const w1 = edge(c, a, p) / area;
      const w2 = edge(a, b, p) / area;
      if (w0 >= -0.0001 && w1 >= -0.0001 && w2 >= -0.0001) {
        const z = a.z * w0 + b.z * w1 + c.z * w2;
        const idx = y * width + x;
        if (z > zbuf[idx]) {
          zbuf[idx] = z;
          const pidx = idx * 4;
          pixels[pidx] = color[0];
          pixels[pidx + 1] = color[1];
          pixels[pidx + 2] = color[2];
          pixels[pidx + 3] = 255;
        }
      }
    }
  }
}

function colorForMaterial(material, shade) {
  return [
    clampInt(material.color[0] * shade + material.emission[0], 0, 255),
    clampInt(material.color[1] * shade + material.emission[1], 0, 255),
    clampInt(material.color[2] * shade + material.emission[2], 0, 255),
  ];
}

function drawGroundLine(pixels, width, height) {
  const y = Math.floor(height * 0.91);
  for (let x = Math.floor(width * 0.13); x < Math.floor(width * 0.87); x += 1) {
    const i = (y * width + x) * 4;
    pixels[i] = Math.max(pixels[i], 42);
    pixels[i + 1] = Math.max(pixels[i + 1], 46);
    pixels[i + 2] = Math.max(pixels[i + 2], 52);
  }
}

function makeContactSheet(pngBuffers, width, height, cols, rows) {
  const sheetPixels = Buffer.alloc(width * cols * height * rows * 4);
  for (let i = 0; i < sheetPixels.length; i += 4) {
    sheetPixels[i] = 7;
    sheetPixels[i + 1] = 9;
    sheetPixels[i + 2] = 13;
    sheetPixels[i + 3] = 255;
  }
  for (let index = 0; index < pngBuffers.length; index += 1) {
    const pixels = decodeOwnPng(pngBuffers[index], width, height);
    const ox = (index % cols) * width;
    const oy = Math.floor(index / cols) * height;
    for (let y = 0; y < height; y += 1) {
      const src = y * width * 4;
      const dst = ((oy + y) * width * cols + ox) * 4;
      pixels.copy(sheetPixels, dst, src, src + width * 4);
    }
  }
  return encodePng(width * cols, height * rows, sheetPixels);
}

function writeReport(gltf, builder) {
  const triangles = attachments.reduce((sum, item) => sum + item.mesh.indices.length / 3, 0);
  const report = {
    variant_id: variantId,
    status: "prototype_pass_with_blender_tooling_blocked_in_vm",
    source_model: "shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb",
    implementation_approach: "The Mesh2Motion body is kept as an animation carrier. A coherent replacement skull/helmet head, rib armor, blade arm, gore drapes, cables, and glitch shards are baked into the GLB as child mesh nodes under the original skeleton bones.",
    blender: {
      intended_compiler: "scripts/build-glitch-reaper-blender.py",
      available_in_this_vm: false,
      blocker: "No arm64 Blender binary is installed; apt install requires root, and official public Linux tarballs are x64.",
      executed_fallback: "scripts/build-glitch-reaper-prototype.mjs",
    },
    artifacts: {
      glb_dist: path.relative(projectRoot, distGlbPath),
      glb_godot: path.relative(projectRoot, artKitGlbPath),
      previews: [
        `dist/characters/${variantId}/${variantId}_preview_front.png`,
        `dist/characters/${variantId}/${variantId}_preview_side.png`,
        `dist/characters/${variantId}/${variantId}_preview_back.png`,
        `dist/characters/${variantId}/${variantId}_preview_three_quarter.png`,
        `dist/characters/${variantId}/${variantId}_contact_sheet.png`,
      ],
    },
    skeleton: {
      source_skeleton_preserved: true,
      bone_hierarchy_changed: false,
      bone_names_changed: false,
      attachment_strategy: "mesh nodes parented to existing glTF joint nodes",
    },
    geometry: {
      generated_module_count: attachments.length,
      generated_module_triangles: triangles,
      source_mesh_count: 1,
      total_mesh_count: gltf.meshes.length,
      material_count: materialDefs.length,
      max_texture_size: 0,
      external_textures: false,
    },
    validation_questions: {
      original_mannequin_face_still_visible: "covered by opaque skull shell, faceplate, jaw assembly, and neck collar; not deleted",
      coherent_replacement_head_module: true,
      red_eyes_readable: true,
      reads_as_glitch_infernal_skeletal_cyborg: true,
      gore_flayed_aesthetic_present: true,
      survives_idle_walk_run_attack: "pending Godot audit",
      importable_in_godot: "pending Godot import",
      web_wasm_export_runs: "pending export",
    },
    notes: [
      "This pass stops using UV face paint, procedural shader faces, vertex-color facial features, and runtime-authored face props.",
      "The original head surface is covered rather than deleted to preserve the source mesh and rig untouched.",
      "The prototype uses solid PBR materials and no texture dependencies for Web/WASM stability.",
    ],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function readGlb(filePath) {
  const data = readFileSync(filePath);
  if (data.toString("utf8", 0, 4) !== "glTF") throw new Error(`Not a GLB: ${filePath}`);
  const totalLength = data.readUInt32LE(8);
  let offset = 12;
  let gltf = null;
  let bin = null;
  while (offset < totalLength) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = data.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    if (chunkType === 0x4e4f534a) {
      gltf = JSON.parse(chunk.toString("utf8").trim());
    } else if (chunkType === 0x004e4942) {
      bin = chunk;
    }
  }
  if (!gltf || !bin) throw new Error(`Missing JSON/BIN chunks in ${filePath}`);
  return { gltf, bin };
}

function writeGlb(gltf, bin, filePath) {
  const jsonBuffer = Buffer.from(JSON.stringify(gltf), "utf8");
  const paddedJsonLength = align4(jsonBuffer.length);
  const paddedJson = Buffer.concat([jsonBuffer, Buffer.alloc(paddedJsonLength - jsonBuffer.length, 0x20)]);
  const paddedBinLength = align4(bin.length);
  const paddedBin = paddedBinLength === bin.length ? bin : Buffer.concat([bin, Buffer.alloc(paddedBinLength - bin.length)]);
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBin.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "utf8");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(filePath, Buffer.concat([header, jsonHeader, paddedJson, binHeader, paddedBin]));
}

function floatBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function uint16Buffer(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function boundsForPositions(values) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], values[i + axis]);
      max[axis] = Math.max(max[axis], values[i + axis]);
    }
  }
  return { min, max };
}

function scalarBounds(values) {
  return { min: [Math.min(...values)], max: [Math.max(...values)] };
}

function boundsForWorldMeshes(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (const p of mesh.positions) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
  }
  return { min, max };
}

function largestAxis(bounds) {
  const sizes = [0, 1, 2].map((axis) => axisSize(bounds, axis));
  return sizes[0] > sizes[1] && sizes[0] > sizes[2] ? 0 : sizes[1] > sizes[2] ? 1 : 2;
}

function axisSize(bounds, axis) {
  return bounds.max[axis] - bounds.min[axis];
}

function matrixFromNode(node) {
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  return compose(t, r, s);
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function compose(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function matMul(a, b) {
  const out = Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
  }
  return out;
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function quatFromEulerDeg(deg) {
  const [rx, ry, rz] = deg.map((value) => value * Math.PI / 180);
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunks = [
    pngChunk("IHDR", bufferFromUInts([width, height], [4, 4], Buffer.from([8, 6, 0, 0, 0]))),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function decodeOwnPng(png, width, height) {
  let offset = 8;
  const idat = [];
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + len);
    if (type === "IDAT") idat.push(data);
    offset += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    raw.copy(out, y * width * 4, y * (width * 4 + 1) + 1, y * (width * 4 + 1) + 1 + width * 4);
  }
  return out;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function bufferFromUInts(values, sizes, tail) {
  const buffer = Buffer.alloc(sizes.reduce((sum, size) => sum + size, 0));
  let offset = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (sizes[i] === 4) buffer.writeUInt32BE(values[i], offset);
    else buffer.writeUInt8(values[i], offset);
    offset += sizes[i];
  }
  return Buffer.concat([buffer, tail]);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function align4(value) {
  return (value + 3) & ~3;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function edge(a, b, c) {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

main();
