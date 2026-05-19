import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Rendering/edgesRenderer";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import type {
  EntitySnapshot,
  MapDescriptor,
  Rect,
  ReplaySnapshot,
  SnapshotAirdrop,
  SnapshotCharacter,
  SnapshotCrate,
  Tile,
} from "./types";

const MODEL_ROOT = "/shared-harness/art-kit/";
const WORLD_SCALE = 0.38;
const AGENT_COLORS = [
  new Color3(0.95, 0.1, 0.12),
  new Color3(0.0, 0.9, 0.78),
  new Color3(1.0, 0.68, 0.12),
  new Color3(0.42, 0.95, 0.32),
  new Color3(0.84, 0.28, 1.0),
  new Color3(0.2, 0.52, 1.0),
];

type ModelTemplate = {
  source: string | null;
  instantiate: (name: string) => TransformNode;
};

type Templates = {
  agent: ModelTemplate | null;
  crate: ModelTemplate | null;
};

type CharacterVisual = {
  root: TransformNode;
  accent: Color3;
};

type AirdropVisual = {
  root: TransformNode;
  marker: Mesh;
  beam: Mesh;
  light: PointLight;
};

export type SceneController = {
  scene: Scene;
  setFollowLocked: (locked: boolean) => void;
  isFollowLocked: () => boolean;
};

export async function createTelefragScene(
  engine: AbstractEngine,
  canvas: HTMLCanvasElement,
  snapshot: ReplaySnapshot,
): Promise<SceneController> {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.006, 0.008, 0.012, 1);
  scene.collisionsEnabled = false;

  const materials = createMaterials(scene);
  const targetAnchor = new TransformNode("follow-anchor", scene);
  const camera = createCamera(scene, canvas, snapshot.map, targetAnchor);

  addLighting(scene);
  addPost(scene, camera);
  buildArena(scene, snapshot.map, materials);

  const templates = await loadTemplates(scene);
  const cratePositions = collectCrates(snapshot);
  for (const crate of cratePositions) {
    const root = instantiateCrate(scene, templates, `static-${crate.id}`, materials, 0.85);
    root.position = toScenePosition(snapshot.map, crate.pos, 0.34);
  }

  const characterVisuals = new Map<string, CharacterVisual>();
  const characterIds = collectCharacterIds(snapshot.frames);
  characterIds.forEach((characterId, index) => {
    const accent = AGENT_COLORS[index % AGENT_COLORS.length] ?? AGENT_COLORS[0]!;
    const root = instantiateAgent(scene, templates, characterId, accent, materials);
    characterVisuals.set(characterId, { root, accent });
  });

  const drop = getMoneyShotAirdrop(snapshot);
  const airdropVisual = createAirdrop(scene, templates, drop, snapshot.map, materials);
  const mist = createMist(scene);
  const shockwave = createShockwave(scene, materials);
  const impactLight = new PointLight("impact-light", toScenePosition(snapshot.map, drop.pos, 0.8), scene);
  impactLight.diffuse = new Color3(1, 0.04, 0.02);
  impactLight.specular = new Color3(1, 0.16, 0.08);
  impactLight.intensity = 0;
  impactLight.range = 12;

  let followLocked = true;
  let elapsed = 0;
  let lastVirtualTurn: number | null = null;
  let impactPulse = 0;
  const loop = getLoop(snapshot);

  scene.registerBeforeRender(() => {
    const deltaSeconds = Math.min(engine.getDeltaTime() / 1000, 0.05);
    elapsed += deltaSeconds;
    const loopTime = elapsed % loop.seconds;
    const virtualTurn = loop.startTurn + (loopTime / loop.seconds) * loop.turnSpan;
    const sample = sampleSnapshot(snapshot.frames, virtualTurn);

    updateCharacters(
      snapshot,
      characterVisuals,
      sample,
      virtualTurn,
      elapsed,
      materials,
    );
    updateAirdrop(snapshot.map, airdropVisual, drop, loop, virtualTurn, elapsed);

    const targetPosition = getTargetPosition(snapshot, sample, virtualTurn, drop.pos);
    targetAnchor.position = targetPosition.add(new Vector3(0, 0.9, 0));

    if (lastVirtualTurn !== null && crossedTurn(lastVirtualTurn, virtualTurn, drop.landsAtTurn)) {
      mist.emitter = toScenePosition(snapshot.map, drop.pos, 0.75);
      mist.manualEmitCount = 520;
      mist.start();
      impactPulse = 1;
    }

    impactPulse = Math.max(0, impactPulse - deltaSeconds * 0.9);
    updateImpact(shockwave, impactLight, snapshot.map, drop.pos, impactPulse);
    lastVirtualTurn = virtualTurn;
  });

  return {
    scene,
    setFollowLocked(locked: boolean) {
      followLocked = locked;
      camera.lockedTarget = locked ? targetAnchor : null;
      if (!locked) {
        camera.setTarget(targetAnchor.position.clone());
      }
    },
    isFollowLocked() {
      return followLocked;
    },
  };
}

function createCamera(
  scene: Scene,
  canvas: HTMLCanvasElement,
  map: MapDescriptor,
  targetAnchor: TransformNode,
): ArcRotateCamera {
  const center = toScenePosition(map, { x: map.size.w / 2, y: map.size.h / 2 }, 0.4);
  targetAnchor.position = center;
  const camera = new ArcRotateCamera(
    "director-camera",
    -Math.PI * 0.34,
    Math.PI * 0.34,
    21,
    targetAnchor.position,
    scene,
  );
  camera.lowerRadiusLimit = 7;
  camera.upperRadiusLimit = 34;
  camera.lowerBetaLimit = 0.34;
  camera.upperBetaLimit = Math.PI * 0.48;
  camera.wheelPrecision = 45;
  camera.panningSensibility = 0;
  camera.inertia = 0.72;
  camera.angularSensibilityX = 780;
  camera.angularSensibilityY = 780;
  camera.lockedTarget = targetAnchor;
  camera.attachControl(canvas, true);
  scene.activeCamera = camera;
  return camera;
}

function addLighting(scene: Scene): void {
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.diffuse = new Color3(0.38, 0.44, 0.5);
  ambient.groundColor = new Color3(0.02, 0.01, 0.01);
  ambient.intensity = 0.42;

  const key = new DirectionalLight("key", new Vector3(-0.45, -0.88, 0.22), scene);
  key.diffuse = new Color3(1, 0.78, 0.52);
  key.specular = new Color3(0.8, 0.9, 1);
  key.intensity = 1.35;
}

function addPost(scene: Scene, camera: ArcRotateCamera): void {
  const glow = new GlowLayer("neon-glow", scene, {
    blurKernelSize: 48,
  });
  glow.intensity = 0.74;

  const pipeline = new DefaultRenderingPipeline("post", true, scene, [camera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.26;
  pipeline.bloomWeight = 0.38;
  pipeline.bloomKernel = 48;
  pipeline.fxaaEnabled = true;
  pipeline.chromaticAberrationEnabled = true;
  pipeline.chromaticAberration.aberrationAmount = 5;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.contrast = 1.18;
  pipeline.imageProcessing.exposure = 1.02;
}

function createMaterials(scene: Scene) {
  const ground = material(scene, "ground", new Color3(0.018, 0.02, 0.026), new Color3(0.015, 0.05, 0.055));
  const wall = material(scene, "wall", new Color3(0.038, 0.036, 0.046), new Color3(0.01, 0.03, 0.04));
  const cover = material(scene, "cover", new Color3(0.055, 0.05, 0.044), new Color3(0.09, 0.055, 0.015));
  const grid = material(scene, "grid", new Color3(0.0, 0.45, 0.5), new Color3(0.0, 0.82, 0.78));
  const crate = material(scene, "crate", new Color3(0.16, 0.12, 0.075), new Color3(0.9, 0.34, 0.06));
  const airdrop = material(scene, "airdrop", new Color3(0.2, 0.02, 0.018), new Color3(1.0, 0.02, 0.02));
  const red = material(scene, "red-mist", new Color3(1.0, 0.03, 0.01), new Color3(1.0, 0.01, 0.0), 0.78);
  return { ground, wall, cover, grid, crate, airdrop, red };
}

function material(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive: Color3,
  alpha = 1,
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = diffuse;
  mat.emissiveColor = emissive;
  mat.specularColor = new Color3(0.12, 0.14, 0.16);
  mat.alpha = alpha;
  return mat;
}

function buildArena(
  scene: Scene,
  map: MapDescriptor,
  materials: ReturnType<typeof createMaterials>,
): void {
  const ground = MeshBuilder.CreateGround(
    "arena-floor",
    {
      width: map.size.w * WORLD_SCALE,
      height: map.size.h * WORLD_SCALE,
      subdivisions: 4,
    },
    scene,
  );
  ground.material = materials.ground;

  const gridLines: Vector3[][] = [];
  const halfW = (map.size.w * WORLD_SCALE) / 2;
  const halfH = (map.size.h * WORLD_SCALE) / 2;
  for (let x = 0; x <= map.size.w; x += 5) {
    const sceneX = (x - map.size.w / 2) * WORLD_SCALE;
    gridLines.push([
      new Vector3(sceneX, 0.025, -halfH),
      new Vector3(sceneX, 0.025, halfH),
    ]);
  }
  for (let y = 0; y <= map.size.h; y += 5) {
    const sceneZ = (y - map.size.h / 2) * WORLD_SCALE;
    gridLines.push([
      new Vector3(-halfW, 0.025, sceneZ),
      new Vector3(halfW, 0.025, sceneZ),
    ]);
  }
  const grid = MeshBuilder.CreateLineSystem("neon-grid", { lines: gridLines }, scene);
  grid.color = new Color3(0.0, 0.58, 0.62);
  grid.alpha = 0.28;

  for (const rect of map.walls) {
    addBlock(scene, map, rect, 1.2, materials.wall, new Color4(0.0, 0.9, 0.95, 0.52));
  }

  for (const rect of map.coverClusters ?? []) {
    addBlock(scene, map, rect, 0.55, materials.cover, new Color4(1.0, 0.62, 0.08, 0.55));
  }

  if (map.evac) {
    const evac = MeshBuilder.CreateTorus(
      "evac-ring",
      { diameter: 3.0, thickness: 0.035, tessellation: 72 },
      scene,
    );
    evac.position = toScenePosition(map, map.evac, 0.05);
    evac.rotation.x = Math.PI / 2;
    evac.material = material(scene, "evac", new Color3(0.02, 0.12, 0.06), new Color3(0.25, 1.0, 0.38), 0.86);
  }
}

function addBlock(
  scene: Scene,
  map: MapDescriptor,
  rect: Rect,
  height: number,
  blockMaterial: StandardMaterial,
  edgeColor: Color4,
): Mesh {
  const block = MeshBuilder.CreateBox(
    `block-${rect.x}-${rect.y}`,
    {
      width: rect.w * WORLD_SCALE,
      depth: rect.h * WORLD_SCALE,
      height,
    },
    scene,
  );
  block.position = toScenePosition(
    map,
    { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
    height / 2,
  );
  block.material = blockMaterial;
  block.enableEdgesRendering();
  block.edgesWidth = 2.5;
  block.edgesColor = edgeColor;
  return block;
}

async function loadTemplates(scene: Scene): Promise<Templates> {
  const [agent, crate] = await Promise.all([
    loadTemplate(scene, ["agent.glb", "character.glb", "avatar.glb", "runner.glb", "Astronaut.glb"], ["agent", "character", "avatar", "runner", "astronaut"]),
    loadTemplate(scene, ["airdrop-crate.glb", "supply-crate.glb", "crate.glb", "airdrop.glb", "Pickup Crate.glb"], ["crate", "airdrop", "supply", "pickup"]),
  ]);
  return { agent, crate };
}

async function loadTemplate(
  scene: Scene,
  defaults: string[],
  keywords: string[],
): Promise<ModelTemplate | null> {
  const manifestNames = await discoverModelNames();
  const manifestMatches = manifestNames.filter((name) =>
    keywords.some((keyword) => name.toLowerCase().includes(keyword)),
  );
  const candidates = unique([...manifestMatches, ...defaults]);

  for (const candidate of candidates) {
    for (const normalized of modelNameVariants(candidate)) {
      if (!(await resourceExists(`${MODEL_ROOT}${normalized}`))) continue;
      try {
        const container = await SceneLoader.LoadAssetContainerAsync(MODEL_ROOT, normalized, scene);
        return createTemplateFromContainer(container, `${MODEL_ROOT}${normalized}`);
      } catch (error) {
        console.warn(`Unable to load GLB model ${normalized}; trying next candidate.`, error);
      }
    }
  }
  return null;
}

function createTemplateFromContainer(
  container: AssetContainer,
  source: string,
): ModelTemplate {
  return {
    source,
    instantiate(name: string) {
      const root = new TransformNode(name, container.scene);
      const entries = container.instantiateModelsToScene(
        (sourceName) => `${name}-${sourceName}`,
        false,
        { doNotInstantiate: false },
      );
      for (const node of entries.rootNodes) {
        node.parent = root;
      }
      root.scaling = new Vector3(0.72, 0.72, 0.72);
      return root;
    },
  };
}

async function discoverModelNames(): Promise<string[]> {
  const out: string[] = [];
  try {
    const response = await fetch(`${MODEL_ROOT}manifest.json`, { cache: "no-store" });
    if (response.ok) collectGlbNames(await response.json(), out);
  } catch {
    // The shared art kit does not require a manifest; fixed names are tried below.
  }
  return unique(out);
}

function collectGlbNames(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value.toLowerCase().endsWith(".glb")) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGlbNames(item, out);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectGlbNames(item, out);
  }
}

function modelNameVariants(name: string): string[] {
  const normalized = name
    .replace(/^\/?shared-harness\/art-kit\//, "")
    .replace(/^\/?models\//, "")
    .replace(/^\//, "");
  return unique([normalized, `models/${normalized}`]);
}

async function resourceExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(encodeURI(url), { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function instantiateAgent(
  scene: Scene,
  templates: Templates,
  name: string,
  accent: Color3,
  materials: ReturnType<typeof createMaterials>,
): TransformNode {
  if (templates.agent) {
    const root = templates.agent.instantiate(`agent-${name}`);
    tintModel(root, accent);
    return root;
  }

  const root = new TransformNode(`agent-${name}`, scene);
  const bodyMaterial = material(
    scene,
    `agent-mat-${name}`,
    new Color3(0.052, 0.058, 0.062),
    accent.scale(0.55),
  );

  const body = MeshBuilder.CreateCylinder(
    `${name}-body`,
    { height: 0.88, diameterTop: 0.38, diameterBottom: 0.5, tessellation: 14 },
    scene,
  );
  body.position.y = 0.55;
  body.material = bodyMaterial;
  body.parent = root;

  const head = MeshBuilder.CreateSphere(
    `${name}-head`,
    { diameter: 0.42, segments: 14 },
    scene,
  );
  head.position.y = 1.14;
  head.material = bodyMaterial;
  head.parent = root;

  const visor = MeshBuilder.CreateBox(
    `${name}-visor`,
    { width: 0.36, height: 0.055, depth: 0.04 },
    scene,
  );
  visor.position = new Vector3(0, 1.18, -0.2);
  visor.material = materials.grid;
  visor.parent = root;
  return root;
}

function instantiateCrate(
  scene: Scene,
  templates: Templates,
  name: string,
  materials: ReturnType<typeof createMaterials>,
  size: number,
): TransformNode {
  if (templates.crate) {
    const root = templates.crate.instantiate(`crate-${name}`);
    root.scaling.scaleInPlace(size);
    tintModel(root, new Color3(1, 0.28, 0.04));
    return root;
  }

  const root = new TransformNode(`crate-${name}`, scene);
  const box = MeshBuilder.CreateBox(
    `${name}-box`,
    { width: size, height: size * 0.72, depth: size },
    scene,
  );
  box.position.y = (size * 0.72) / 2;
  box.material = materials.crate;
  box.enableEdgesRendering();
  box.edgesWidth = 3;
  box.edgesColor = new Color4(1, 0.36, 0.04, 0.76);
  box.parent = root;
  return root;
}

function tintModel(root: TransformNode, accent: Color3): void {
  const meshes = root.getChildMeshes();
  for (const mesh of meshes) {
    const source = mesh.material;
    if (source instanceof StandardMaterial) {
      source.emissiveColor = source.emissiveColor.add(accent.scale(0.22));
    }
  }
}

function createAirdrop(
  scene: Scene,
  templates: Templates,
  drop: SnapshotAirdrop,
  map: MapDescriptor,
  materials: ReturnType<typeof createMaterials>,
): AirdropVisual {
  const root = instantiateCrate(scene, templates, `falling-${drop.id}`, materials, 1.25);
  root.position = toScenePosition(map, drop.pos, 13);
  root.rotation.y = Math.PI * 0.25;

  const marker = MeshBuilder.CreateTorus(
    "airdrop-impact-ring",
    { diameter: 2.2, thickness: 0.045, tessellation: 96 },
    scene,
  );
  marker.position = toScenePosition(map, drop.pos, 0.08);
  marker.rotation.x = Math.PI / 2;
  marker.material = materials.airdrop;

  const beam = MeshBuilder.CreateCylinder(
    "airdrop-warning-beam",
    { height: 12, diameter: 0.08, tessellation: 16 },
    scene,
  );
  beam.position = toScenePosition(map, drop.pos, 6);
  beam.material = material(scene, "beam", new Color3(0.15, 0.01, 0.01), new Color3(1, 0, 0), 0.26);

  const light = new PointLight("airdrop-light", toScenePosition(map, drop.pos, 4), scene);
  light.diffuse = new Color3(1, 0.04, 0.02);
  light.specular = new Color3(1, 0.16, 0.08);
  light.range = 14;
  light.intensity = 1.8;

  return { root, marker, beam, light };
}

function createMist(scene: Scene): ParticleSystem {
  const texture = new DynamicTexture("mist-dot", { width: 64, height: 64 }, scene, false);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.42, "rgba(255,90,80,0.72)");
  gradient.addColorStop(1, "rgba(255,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.update();

  const mist = new ParticleSystem("red-mist", 900, scene);
  mist.particleTexture = texture;
  mist.minEmitBox = new Vector3(-0.34, 0.1, -0.34);
  mist.maxEmitBox = new Vector3(0.34, 0.9, 0.34);
  mist.direction1 = new Vector3(-3.2, 0.4, -3.2);
  mist.direction2 = new Vector3(3.2, 3.4, 3.2);
  mist.color1 = new Color4(1.0, 0.02, 0.01, 0.9);
  mist.color2 = new Color4(0.95, 0.22, 0.04, 0.42);
  mist.colorDead = new Color4(0.12, 0.0, 0.0, 0);
  mist.minSize = 0.18;
  mist.maxSize = 0.74;
  mist.minLifeTime = 0.35;
  mist.maxLifeTime = 1.15;
  mist.emitRate = 0;
  mist.targetStopDuration = 0.16;
  mist.gravity = new Vector3(0, -3.2, 0);
  mist.minAngularSpeed = -12;
  mist.maxAngularSpeed = 12;
  mist.blendMode = ParticleSystem.BLENDMODE_ADD;
  return mist;
}

function createShockwave(
  scene: Scene,
  materials: ReturnType<typeof createMaterials>,
): Mesh {
  const ring = MeshBuilder.CreateTorus(
    "impact-shockwave",
    { diameter: 1.2, thickness: 0.025, tessellation: 128 },
    scene,
  );
  ring.rotation.x = Math.PI / 2;
  ring.material = materials.red;
  ring.setEnabled(false);
  return ring;
}

function updateImpact(
  ring: Mesh,
  light: PointLight,
  map: MapDescriptor,
  pos: Tile,
  pulse: number,
): void {
  if (pulse <= 0) {
    ring.setEnabled(false);
    light.intensity = 0;
    return;
  }
  ring.setEnabled(true);
  const inverse = 1 - pulse;
  ring.position = toScenePosition(map, pos, 0.1);
  ring.scaling = new Vector3(1 + inverse * 6.2, 1 + inverse * 6.2, 1 + inverse * 6.2);
  light.position = toScenePosition(map, pos, 0.7 + pulse * 1.8);
  light.intensity = 14 * pulse;
}

function updateCharacters(
  snapshot: ReplaySnapshot,
  visuals: Map<string, CharacterVisual>,
  sample: SnapshotSample,
  virtualTurn: number,
  elapsed: number,
  materials: ReturnType<typeof createMaterials>,
): void {
  for (const [characterId, visual] of visuals.entries()) {
    const character = sampleCharacter(sample, characterId);
    if (!character) {
      visual.root.setEnabled(false);
      continue;
    }

    const vaporized =
      characterId === snapshot.moneyShot.victimId &&
      virtualTurn >= snapshot.moneyShot.landsAtTurn;
    const visible =
      character.alive &&
      !vaporized &&
      (character.extractedAtTurn === null ||
        character.extractedAtTurn === undefined ||
        character.extractedAtTurn > virtualTurn);

    visual.root.setEnabled(visible);
    if (!visible) continue;

    const pos = interpolateCharacterPosition(snapshot.map, sample, characterId);
    visual.root.position = pos.add(new Vector3(0, Math.sin(elapsed * 7 + pos.x) * 0.045, 0));
    visual.root.rotation.y = Math.sin(elapsed * 1.5 + pos.z) * 0.16;

    const spotlight = visual.root.getChildMeshes().find((mesh) => mesh.name.endsWith("-visor"));
    if (spotlight) spotlight.material = materials.grid;
  }
}

function updateAirdrop(
  map: MapDescriptor,
  visual: AirdropVisual,
  drop: SnapshotAirdrop,
  loop: Loop,
  virtualTurn: number,
  elapsed: number,
): void {
  const descentStart = drop.landsAtTurn - 3;
  const groundY = 0.52;
  const scenePos = toScenePosition(map, drop.pos, groundY);

  if (virtualTurn < descentStart - 0.9) {
    visual.root.setEnabled(false);
    visual.marker.setEnabled(false);
    visual.beam.setEnabled(false);
    visual.light.intensity = 0.0;
    return;
  }

  visual.root.setEnabled(true);
  visual.marker.setEnabled(true);
  visual.beam.setEnabled(true);
  const descent = clamp((virtualTurn - descentStart) / Math.max(0.01, drop.landsAtTurn - descentStart), 0, 1);
  const eased = descent * descent * (3 - 2 * descent);
  const y = virtualTurn >= drop.landsAtTurn ? groundY : 13.5 - eased * 12.7;
  visual.root.position = new Vector3(scenePos.x, y, scenePos.z);
  visual.root.rotation.y += 0.012 + (1 - eased) * 0.04;
  visual.root.rotation.x = Math.sin(elapsed * 1.9) * 0.05 * (1 - eased);

  const warningPulse = 0.55 + Math.sin(elapsed * 7.5) * 0.22;
  visual.marker.scaling = new Vector3(1 + warningPulse * 0.08, 1 + warningPulse * 0.08, 1 + warningPulse * 0.08);
  visual.beam.scaling.y = 0.7 + warningPulse * 0.26;
  visual.light.position = new Vector3(scenePos.x, 3.2 + warningPulse, scenePos.z);
  visual.light.intensity = virtualTurn >= loop.startTurn ? 1.1 + warningPulse * 2.2 : 0;
}

function getTargetPosition(
  snapshot: ReplaySnapshot,
  sample: SnapshotSample,
  virtualTurn: number,
  fallback: Tile,
): Vector3 {
  if (virtualTurn >= snapshot.moneyShot.landsAtTurn) {
    return toScenePosition(snapshot.map, fallback, 0.2);
  }
  const pos = interpolateCharacterPosition(snapshot.map, sample, snapshot.moneyShot.victimId);
  return pos.y > 0 ? pos : toScenePosition(snapshot.map, fallback, 0.2);
}

function sampleSnapshot(frames: EntitySnapshot[], turn: number): SnapshotSample {
  const sorted = [...frames].sort((a, b) => a.turn - b.turn);
  let prev = sorted[0]!;
  let next = sorted[sorted.length - 1]!;

  for (let index = 0; index < sorted.length; index += 1) {
    const frame = sorted[index]!;
    if (frame.turn <= turn) prev = frame;
    if (frame.turn >= turn) {
      next = frame;
      break;
    }
  }

  const span = Math.max(0.0001, next.turn - prev.turn);
  return { prev, next, alpha: clamp((turn - prev.turn) / span, 0, 1) };
}

type SnapshotSample = {
  prev: EntitySnapshot;
  next: EntitySnapshot;
  alpha: number;
};

function sampleCharacter(sample: SnapshotSample, characterId: string): SnapshotCharacter | null {
  const current =
    sample.prev.characters.find((character) => character.characterId === characterId) ??
    sample.next.characters.find((character) => character.characterId === characterId);
  return current ?? null;
}

function interpolateCharacterPosition(
  map: MapDescriptor,
  sample: SnapshotSample,
  characterId: string,
): Vector3 {
  const prev = sample.prev.characters.find((character) => character.characterId === characterId);
  const next = sample.next.characters.find((character) => character.characterId === characterId);
  const a = prev?.pos ?? next?.pos;
  const b = next?.pos ?? prev?.pos;
  if (!a || !b) return new Vector3(0, 0, 0);
  const x = a.x + (b.x - a.x) * sample.alpha;
  const y = a.y + (b.y - a.y) * sample.alpha;
  return toScenePosition(map, { x, y }, 0);
}

function crossedTurn(previous: number, current: number, target: number): boolean {
  if (current < previous) {
    return target >= previous || target <= current;
  }
  return previous < target && current >= target;
}

type Loop = {
  startTurn: number;
  endTurn: number;
  turnSpan: number;
  seconds: number;
};

function getLoop(snapshot: ReplaySnapshot): Loop {
  const firstTurn = snapshot.frames[0]?.turn ?? 0;
  const lastTurn = snapshot.frames[snapshot.frames.length - 1]?.turn ?? firstTurn + 14;
  const startTurn = snapshot.moneyShot.loopStartTurn ?? firstTurn;
  const endTurn = snapshot.moneyShot.loopEndTurn ?? lastTurn;
  return {
    startTurn,
    endTurn,
    turnSpan: Math.max(1, endTurn - startTurn),
    seconds: clamp(snapshot.moneyShot.loopSeconds ?? 14, 10, 20),
  };
}

function getMoneyShotAirdrop(snapshot: ReplaySnapshot): SnapshotAirdrop {
  for (const frame of snapshot.frames) {
    const drop = frame.airdrops.find((candidate) => candidate.id === snapshot.moneyShot.dropId);
    if (drop) return drop;
  }
  return {
    id: snapshot.moneyShot.dropId,
    pos: snapshot.map.airdrops?.find((drop) => drop.landsAtTurn === snapshot.moneyShot.landsAtTurn) ?? {
      x: snapshot.map.size.w / 2,
      y: snapshot.map.size.h / 2,
    },
    landsAtTurn: snapshot.moneyShot.landsAtTurn,
    state: "telegraphed",
    looted: false,
  };
}

function collectCharacterIds(frames: EntitySnapshot[]): string[] {
  return unique(
    frames.flatMap((frame) =>
      frame.characters.map((character) => character.characterId),
    ),
  );
}

function collectCrates(snapshot: ReplaySnapshot): SnapshotCrate[] {
  const byId = new Map<string, SnapshotCrate>();
  for (const frame of snapshot.frames) {
    for (const crate of frame.crates) {
      byId.set(crate.id, crate);
    }
  }
  if (byId.size === 0) {
    for (const crate of snapshot.map.crates ?? []) {
      byId.set(`Crate_${crate.x}_${crate.y}`, {
        id: `Crate_${crate.x}_${crate.y}`,
        pos: { x: crate.x, y: crate.y },
        opened: false,
      });
    }
  }
  return Array.from(byId.values()).filter((crate) => crate.id !== snapshot.moneyShot.dropId);
}

function toScenePosition(map: MapDescriptor, tile: Tile, y: number): Vector3 {
  return new Vector3(
    (tile.x - map.size.w / 2) * WORLD_SCALE,
    y,
    (tile.y - map.size.h / 2) * WORLD_SCALE,
  );
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
