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
  baseScaling: Vector3;
};

type AirdropVisual = {
  root: TransformNode;
  marker: Mesh;
  beam: Mesh;
  light: PointLight;
};

type PostFx = {
  glow: GlowLayer;
  pipeline: DefaultRenderingPipeline;
  baseGlow: number;
  baseBloom: number;
  baseAberration: number;
  baseExposure: number;
};

type DuelState = {
  attackerId: string;
  defenderId: string;
  winnerId: string;
  loserId: string;
  startTurn: number;
  exchangeTurn: number;
  killTurn: number;
  endTurn: number;
  corpsePos: Tile | null;
};

type DuelVisual = {
  state: DuelState;
  clashTrace: Mesh;
  counterTrace: Mesh;
  killTrace: Mesh;
  impactRing: Mesh;
  corpsePool: Mesh;
  corpseRing: Mesh;
  corpseLight: PointLight;
  flare: PointLight;
  sparks: ParticleSystem;
  blood: ParticleSystem;
  smoke: ParticleSystem;
  flarePulse: number;
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
  const postFx = addPost(scene, camera);
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
    characterVisuals.set(characterId, { root, accent, baseScaling: root.scaling.clone() });
  });

  const duelState = resolveDuel(snapshot);
  const duelVisual = duelState ? createDuelVisual(scene, snapshot.map, duelState, materials) : null;
  const drop = getMoneyShotAirdrop(snapshot);
  const airdropVisual = createAirdrop(scene, templates, drop, snapshot.map, materials);
  const mist = createMist(scene);
  const telefragSmoke = createTelefragSmoke(scene);
  const telefragSparks = createTelefragSparks(scene);
  const shockwave = createShockwave(scene, materials);
  const telefragCloud = createTelefragCloud(scene, materials);
  const impactLight = new PointLight("impact-light", toScenePosition(snapshot.map, drop.pos, 0.8), scene);
  impactLight.diffuse = new Color3(1, 0.04, 0.02);
  impactLight.specular = new Color3(1, 0.16, 0.08);
  impactLight.intensity = 0;
  impactLight.range = 12;

  let followLocked = true;
  let elapsed = 0;
  let lastVirtualTurn: number | null = null;
  let impactPulse = 0;
  let killCameraPulse = 0;
  let telefragCameraPulse = 0;
  const loop = getLoop(snapshot);
  const baseCameraRadius = camera.radius;
  const baseCameraBeta = camera.beta;

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
      duelState,
    );
    if (duelVisual) {
      updateDuelVisual(duelVisual, snapshot.map, sample, virtualTurn, elapsed, deltaSeconds);
    }
    updateAirdrop(snapshot.map, airdropVisual, drop, loop, virtualTurn, elapsed);

    if (lastVirtualTurn !== null) {
      if (duelVisual && crossedTurn(lastVirtualTurn, virtualTurn, duelVisual.state.exchangeTurn)) {
        triggerDuelExchange(duelVisual, snapshot.map, sample);
      }
      if (duelVisual && crossedTurn(lastVirtualTurn, virtualTurn, duelVisual.state.killTurn)) {
        triggerDuelKill(duelVisual, snapshot.map, sample);
        killCameraPulse = 1;
      }
      if (crossedTurn(lastVirtualTurn, virtualTurn, drop.landsAtTurn)) {
        const dropImpact = toScenePosition(snapshot.map, drop.pos, 0.75);
        triggerParticleBurst(mist, dropImpact, 820);
        triggerParticleBurst(telefragSmoke, toScenePosition(snapshot.map, drop.pos, 0.5), 360);
        triggerParticleBurst(telefragSparks, toScenePosition(snapshot.map, drop.pos, 0.9), 180);
        impactPulse = 1;
        telefragCameraPulse = 1;
      }
    }

    killCameraPulse = Math.max(0, killCameraPulse - deltaSeconds * 1.45);
    telefragCameraPulse = Math.max(0, telefragCameraPulse - deltaSeconds * 1.05);
    impactPulse = Math.max(0, impactPulse - deltaSeconds * 0.36);
    const targetPosition = getTargetPosition(snapshot, sample, virtualTurn, drop.pos, duelState);
    const shake = cameraShakeOffset(elapsed, Math.max(killCameraPulse, telefragCameraPulse * 1.1));
    targetAnchor.position = targetPosition.add(new Vector3(0, 0.9, 0)).add(shake);
    updatePostFx(postFx, killCameraPulse, telefragCameraPulse, impactPulse);
    updateCameraDirector(
      camera,
      followLocked,
      baseCameraRadius,
      baseCameraBeta,
      virtualTurn,
      duelState,
      snapshot.moneyShot.landsAtTurn,
      killCameraPulse,
      telefragCameraPulse,
      deltaSeconds,
    );
    updateImpact(shockwave, telefragCloud, impactLight, snapshot.map, drop.pos, impactPulse);
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

function addPost(scene: Scene, camera: ArcRotateCamera): PostFx {
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

  return {
    glow,
    pipeline,
    baseGlow: glow.intensity,
    baseBloom: pipeline.bloomWeight,
    baseAberration: pipeline.chromaticAberration.aberrationAmount,
    baseExposure: pipeline.imageProcessing.exposure,
  };
}

function createMaterials(scene: Scene) {
  const ground = material(scene, "ground", new Color3(0.018, 0.02, 0.026), new Color3(0.015, 0.05, 0.055));
  const wall = material(scene, "wall", new Color3(0.038, 0.036, 0.046), new Color3(0.01, 0.03, 0.04));
  const cover = material(scene, "cover", new Color3(0.055, 0.05, 0.044), new Color3(0.09, 0.055, 0.015));
  const grid = material(scene, "grid", new Color3(0.0, 0.45, 0.5), new Color3(0.0, 0.82, 0.78));
  const crate = material(scene, "crate", new Color3(0.16, 0.12, 0.075), new Color3(0.9, 0.34, 0.06));
  const airdrop = material(scene, "airdrop", new Color3(0.2, 0.02, 0.018), new Color3(1.0, 0.02, 0.02));
  const red = material(scene, "red-mist", new Color3(1.0, 0.03, 0.01), new Color3(1.0, 0.01, 0.0), 0.78);
  const telefragCloud = material(scene, "telefrag-cloud", new Color3(0.8, 0.02, 0.01), new Color3(1.0, 0.0, 0.0), 0.34);
  const duelTrace = material(scene, "duel-trace", new Color3(1.0, 0.76, 0.22), new Color3(1.0, 0.55, 0.08), 0.92);
  const duelCounter = material(scene, "duel-counter-trace", new Color3(0.18, 0.82, 1.0), new Color3(0.05, 0.72, 1.0), 0.82);
  const duelBlood = material(scene, "duel-blood", new Color3(0.5, 0.005, 0.0), new Color3(1.0, 0.0, 0.0), 0.78);
  const corpse = material(scene, "corpse-marker", new Color3(0.08, 0.0, 0.0), new Color3(0.72, 0.0, 0.0), 0.86);
  return { ground, wall, cover, grid, crate, airdrop, red, telefragCloud, duelTrace, duelCounter, duelBlood, corpse };
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
  const texture = createRadialParticleTexture(scene, "mist-dot", [
    [0, "rgba(255,255,255,1)"],
    [0.36, "rgba(255,66,58,0.76)"],
    [0.7, "rgba(140,0,0,0.38)"],
    [1, "rgba(255,0,0,0)"],
  ]);

  const mist = new ParticleSystem("red-mist", 1400, scene);
  mist.particleTexture = texture;
  mist.minEmitBox = new Vector3(-0.48, 0.08, -0.48);
  mist.maxEmitBox = new Vector3(0.48, 1.2, 0.48);
  mist.direction1 = new Vector3(-4.4, 0.35, -4.4);
  mist.direction2 = new Vector3(4.4, 4.2, 4.4);
  mist.color1 = new Color4(1.0, 0.02, 0.01, 0.9);
  mist.color2 = new Color4(0.95, 0.14, 0.04, 0.5);
  mist.colorDead = new Color4(0.12, 0.0, 0.0, 0);
  mist.minSize = 0.18;
  mist.maxSize = 0.95;
  mist.minLifeTime = 0.65;
  mist.maxLifeTime = 2.45;
  mist.emitRate = 0;
  mist.targetStopDuration = 0.34;
  mist.gravity = new Vector3(0, -3.2, 0);
  mist.minAngularSpeed = -12;
  mist.maxAngularSpeed = 12;
  mist.blendMode = ParticleSystem.BLENDMODE_ADD;
  return mist;
}

function createTelefragSmoke(scene: Scene): ParticleSystem {
  const texture = createRadialParticleTexture(scene, "telefrag-smoke-dot", [
    [0, "rgba(255,210,190,0.64)"],
    [0.44, "rgba(116,24,20,0.34)"],
    [1, "rgba(16,10,10,0)"],
  ]);

  const smoke = new ParticleSystem("telefrag-smoke", 900, scene);
  smoke.particleTexture = texture;
  smoke.minEmitBox = new Vector3(-0.62, 0.05, -0.62);
  smoke.maxEmitBox = new Vector3(0.62, 0.95, 0.62);
  smoke.direction1 = new Vector3(-1.6, 0.15, -1.6);
  smoke.direction2 = new Vector3(1.6, 2.4, 1.6);
  smoke.color1 = new Color4(0.42, 0.07, 0.045, 0.48);
  smoke.color2 = new Color4(0.08, 0.075, 0.07, 0.3);
  smoke.colorDead = new Color4(0.02, 0.0, 0.0, 0);
  smoke.minSize = 0.7;
  smoke.maxSize = 2.1;
  smoke.minLifeTime = 1.05;
  smoke.maxLifeTime = 3.1;
  smoke.emitRate = 0;
  smoke.targetStopDuration = 0.38;
  smoke.gravity = new Vector3(0, -0.2, 0);
  smoke.minAngularSpeed = -1.6;
  smoke.maxAngularSpeed = 1.6;
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  return smoke;
}

function createTelefragSparks(scene: Scene): ParticleSystem {
  const sparks = new ParticleSystem("telefrag-sparks", 500, scene);
  sparks.particleTexture = createRadialParticleTexture(scene, "telefrag-spark-dot", [
    [0, "rgba(255,255,220,1)"],
    [0.34, "rgba(255,96,24,0.92)"],
    [1, "rgba(255,0,0,0)"],
  ]);
  sparks.minEmitBox = new Vector3(-0.18, 0.25, -0.18);
  sparks.maxEmitBox = new Vector3(0.18, 1.05, 0.18);
  sparks.direction1 = new Vector3(-6.0, 0.1, -6.0);
  sparks.direction2 = new Vector3(6.0, 5.2, 6.0);
  sparks.color1 = new Color4(1.0, 0.9, 0.42, 1);
  sparks.color2 = new Color4(1.0, 0.05, 0.0, 0.72);
  sparks.colorDead = new Color4(0.22, 0.0, 0.0, 0);
  sparks.minSize = 0.06;
  sparks.maxSize = 0.22;
  sparks.minLifeTime = 0.12;
  sparks.maxLifeTime = 0.58;
  sparks.emitRate = 0;
  sparks.targetStopDuration = 0.08;
  sparks.gravity = new Vector3(0, -6.0, 0);
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  return sparks;
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

function createTelefragCloud(
  scene: Scene,
  materials: ReturnType<typeof createMaterials>,
): Mesh {
  const cloud = MeshBuilder.CreateSphere(
    "telefrag-red-cloud",
    { diameter: 1.35, segments: 24 },
    scene,
  );
  cloud.material = materials.telefragCloud;
  cloud.setEnabled(false);
  return cloud;
}

function updateImpact(
  ring: Mesh,
  cloud: Mesh,
  light: PointLight,
  map: MapDescriptor,
  pos: Tile,
  pulse: number,
): void {
  if (pulse <= 0) {
    ring.setEnabled(false);
    cloud.setEnabled(false);
    light.intensity = 0;
    return;
  }
  ring.setEnabled(true);
  cloud.setEnabled(true);
  const inverse = 1 - pulse;
  ring.position = toScenePosition(map, pos, 0.1);
  ring.scaling = new Vector3(1 + inverse * 6.2, 1 + inverse * 6.2, 1 + inverse * 6.2);
  cloud.position = toScenePosition(map, pos, 0.82 + Math.sin(inverse * Math.PI) * 0.22);
  cloud.scaling = new Vector3(0.62 + inverse * 2.2, 0.32 + inverse * 0.72, 0.62 + inverse * 2.2);
  cloud.visibility = pulse * 0.72;
  light.position = toScenePosition(map, pos, 0.7 + pulse * 1.8);
  light.intensity = 14 * pulse;
}

function createDuelVisual(
  scene: Scene,
  map: MapDescriptor,
  state: DuelState,
  materials: ReturnType<typeof createMaterials>,
): DuelVisual {
  const clashTrace = createTraceBeam(scene, "duel-clash-trace", materials.duelTrace);
  const counterTrace = createTraceBeam(scene, "duel-counter-trace", materials.duelCounter);
  const killTrace = createTraceBeam(scene, "duel-kill-trace", materials.duelBlood, 0.11);

  const impactRing = MeshBuilder.CreateTorus(
    "duel-kill-ring",
    { diameter: 0.75, thickness: 0.022, tessellation: 80 },
    scene,
  );
  impactRing.rotation.x = Math.PI / 2;
  impactRing.material = materials.duelBlood;
  impactRing.setEnabled(false);

  const corpsePos = state.corpsePos ?? { x: map.size.w / 2, y: map.size.h / 2 };
  const corpsePool = MeshBuilder.CreateCylinder(
    "duel-corpse-pool",
    { height: 0.018, diameter: 1.28, tessellation: 72 },
    scene,
  );
  corpsePool.position = toScenePosition(map, corpsePos, 0.035);
  corpsePool.material = materials.corpse;
  corpsePool.setEnabled(false);

  const corpseRing = MeshBuilder.CreateTorus(
    "duel-corpse-ring",
    { diameter: 1.65, thickness: 0.03, tessellation: 96 },
    scene,
  );
  corpseRing.position = toScenePosition(map, corpsePos, 0.08);
  corpseRing.rotation.x = Math.PI / 2;
  corpseRing.material = materials.duelBlood;
  corpseRing.setEnabled(false);

  const corpseLight = new PointLight("duel-corpse-light", toScenePosition(map, corpsePos, 0.45), scene);
  corpseLight.diffuse = new Color3(1.0, 0.02, 0.0);
  corpseLight.specular = new Color3(1.0, 0.24, 0.06);
  corpseLight.range = 6;
  corpseLight.intensity = 0;

  const flare = new PointLight("duel-flare", toScenePosition(map, corpsePos, 1.2), scene);
  flare.diffuse = new Color3(1.0, 0.42, 0.12);
  flare.specular = new Color3(1.0, 0.76, 0.38);
  flare.range = 9;
  flare.intensity = 0;

  return {
    state,
    clashTrace,
    counterTrace,
    killTrace,
    impactRing,
    corpsePool,
    corpseRing,
    corpseLight,
    flare,
    sparks: createDuelSparks(scene),
    blood: createDuelBlood(scene),
    smoke: createDuelSmoke(scene),
    flarePulse: 0,
  };
}

function createTraceBeam(
  scene: Scene,
  name: string,
  beamMaterial: StandardMaterial,
  width = 0.07,
): Mesh {
  const beam = MeshBuilder.CreateBox(name, { width, height: width, depth: 1 }, scene);
  beam.material = beamMaterial;
  beam.setEnabled(false);
  return beam;
}

function createDuelSparks(scene: Scene): ParticleSystem {
  const sparks = new ParticleSystem("duel-impact-sparks", 600, scene);
  sparks.particleTexture = createRadialParticleTexture(scene, "duel-spark-dot", [
    [0, "rgba(255,255,220,1)"],
    [0.45, "rgba(255,176,40,0.92)"],
    [1, "rgba(255,0,0,0)"],
  ]);
  sparks.minEmitBox = new Vector3(-0.06, -0.06, -0.06);
  sparks.maxEmitBox = new Vector3(0.06, 0.06, 0.06);
  sparks.direction1 = new Vector3(-4.2, -0.3, -4.2);
  sparks.direction2 = new Vector3(4.2, 3.4, 4.2);
  sparks.color1 = new Color4(1.0, 0.9, 0.32, 1);
  sparks.color2 = new Color4(1.0, 0.16, 0.02, 0.72);
  sparks.colorDead = new Color4(0.2, 0.0, 0.0, 0);
  sparks.minSize = 0.045;
  sparks.maxSize = 0.2;
  sparks.minLifeTime = 0.1;
  sparks.maxLifeTime = 0.55;
  sparks.emitRate = 0;
  sparks.targetStopDuration = 0.08;
  sparks.gravity = new Vector3(0, -5.4, 0);
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  return sparks;
}

function createDuelBlood(scene: Scene): ParticleSystem {
  const blood = new ParticleSystem("duel-blood-burst", 700, scene);
  blood.particleTexture = createRadialParticleTexture(scene, "duel-blood-dot", [
    [0, "rgba(255,245,240,0.95)"],
    [0.32, "rgba(255,20,12,0.78)"],
    [1, "rgba(120,0,0,0)"],
  ]);
  blood.minEmitBox = new Vector3(-0.08, -0.05, -0.08);
  blood.maxEmitBox = new Vector3(0.08, 0.08, 0.08);
  blood.direction1 = new Vector3(-3.4, -0.1, -3.4);
  blood.direction2 = new Vector3(3.4, 2.7, 3.4);
  blood.color1 = new Color4(1.0, 0.0, 0.0, 0.92);
  blood.color2 = new Color4(0.55, 0.0, 0.0, 0.55);
  blood.colorDead = new Color4(0.08, 0.0, 0.0, 0);
  blood.minSize = 0.12;
  blood.maxSize = 0.58;
  blood.minLifeTime = 0.22;
  blood.maxLifeTime = 0.92;
  blood.emitRate = 0;
  blood.targetStopDuration = 0.11;
  blood.gravity = new Vector3(0, -4.0, 0);
  blood.minAngularSpeed = -7;
  blood.maxAngularSpeed = 7;
  blood.blendMode = ParticleSystem.BLENDMODE_ADD;
  return blood;
}

function createDuelSmoke(scene: Scene): ParticleSystem {
  const smoke = new ParticleSystem("duel-corpse-smoke", 600, scene);
  smoke.particleTexture = createRadialParticleTexture(scene, "duel-smoke-dot", [
    [0, "rgba(255,180,150,0.5)"],
    [0.5, "rgba(80,24,24,0.3)"],
    [1, "rgba(8,8,8,0)"],
  ]);
  smoke.minEmitBox = new Vector3(-0.3, 0.04, -0.3);
  smoke.maxEmitBox = new Vector3(0.3, 0.18, 0.3);
  smoke.direction1 = new Vector3(-0.45, 0.25, -0.45);
  smoke.direction2 = new Vector3(0.45, 1.15, 0.45);
  smoke.color1 = new Color4(0.3, 0.06, 0.04, 0.32);
  smoke.color2 = new Color4(0.06, 0.05, 0.05, 0.22);
  smoke.colorDead = new Color4(0.0, 0.0, 0.0, 0);
  smoke.minSize = 0.45;
  smoke.maxSize = 1.45;
  smoke.minLifeTime = 0.75;
  smoke.maxLifeTime = 1.9;
  smoke.emitRate = 0;
  smoke.targetStopDuration = 0.12;
  smoke.gravity = new Vector3(0, 0.08, 0);
  smoke.minAngularSpeed = -1.2;
  smoke.maxAngularSpeed = 1.2;
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  return smoke;
}

function updateDuelVisual(
  visual: DuelVisual,
  map: MapDescriptor,
  sample: SnapshotSample,
  virtualTurn: number,
  elapsed: number,
  deltaSeconds: number,
): void {
  const { state } = visual;
  const winner = interpolateCharacterPosition(map, sample, state.winnerId).add(new Vector3(0, 0.82, 0));
  const loser = getDuelCorpsePosition(map, state).add(new Vector3(0, 0.58, 0));
  const attacker = interpolateCharacterPosition(map, sample, state.attackerId).add(new Vector3(0, 0.82, 0));
  const defender = interpolateCharacterPosition(map, sample, state.defenderId).add(new Vector3(0, 0.82, 0));
  const exchangePulse = turnPulse(virtualTurn, state.exchangeTurn, 0.56);
  const counterTurn = state.exchangeTurn + Math.max(0.2, (state.killTurn - state.exchangeTurn) * 0.48);
  const counterPulse = turnPulse(virtualTurn, counterTurn, 0.48);
  const killPulse = turnPulse(virtualTurn, state.killTurn, 0.72);

  setTraceBeam(visual.clashTrace, attacker, defender, exchangePulse);
  setTraceBeam(visual.counterTrace, defender, attacker, counterPulse * 0.85);
  setTraceBeam(visual.killTrace, winner, loser, killPulse);

  const corpseGround = getDuelCorpsePosition(map, state);
  const afterKill = virtualTurn >= state.killTurn - 0.18 || killPulse > 0.2;
  const corpseFade = Math.max(
    clamp((virtualTurn - state.killTurn) / 0.55, 0, 1),
    killPulse * 0.62,
  );
  visual.corpsePool.setEnabled(afterKill);
  visual.corpseRing.setEnabled(afterKill);
  if (afterKill) {
    const pulse = 0.08 + Math.sin(elapsed * 5.4) * 0.035;
    visual.corpsePool.position = corpseGround.add(new Vector3(0, 0.05, 0));
    visual.corpsePool.visibility = clamp(0.42 + corpseFade * 0.58, 0, 1);
    visual.corpsePool.scaling = new Vector3(0.4 + corpseFade * 1.45, 1, 0.28 + corpseFade * 1.05);
    visual.corpseRing.position = corpseGround.add(new Vector3(0, 0.13, 0));
    visual.corpseRing.visibility = clamp(0.54 + killPulse * 0.46, 0, 1);
    visual.corpseRing.scaling = new Vector3(1.05 + corpseFade * 0.34 + pulse, 1.05 + corpseFade * 0.34 + pulse, 1.05 + corpseFade * 0.34 + pulse);
    visual.corpseRing.rotation.z += 0.012;
    visual.smoke.emitter = corpseGround.add(new Vector3(0, 0.18, 0));
    visual.smoke.emitRate = 10 + corpseFade * 18;
    if (!visual.smoke.isStarted()) visual.smoke.start();
  } else {
    visual.smoke.emitRate = 0;
  }

  if (killPulse > 0.01) {
    visual.impactRing.setEnabled(true);
    visual.impactRing.visibility = clamp(0.45 + killPulse * 0.55, 0, 1);
    visual.impactRing.position = corpseGround.add(new Vector3(0, 0.18, 0));
    visual.impactRing.scaling = new Vector3(1.35 + (1 - killPulse) * 4.8, 1.35 + (1 - killPulse) * 4.8, 1.35 + (1 - killPulse) * 4.8);
  } else {
    visual.impactRing.setEnabled(false);
  }

  visual.flarePulse = Math.max(0, visual.flarePulse - deltaSeconds * 1.8);
  visual.flare.position = corpseGround.add(new Vector3(0, 1.0 + visual.flarePulse * 0.9, 0));
  visual.flare.intensity = visual.flarePulse * 12;
  visual.corpseLight.position = corpseGround.add(new Vector3(0, 0.46, 0));
  visual.corpseLight.intensity = afterKill ? 0.75 + Math.sin(elapsed * 4.2) * 0.24 + visual.flarePulse * 4 : 0;
}

function triggerDuelExchange(visual: DuelVisual, map: MapDescriptor, sample: SnapshotSample): void {
  const attacker = interpolateCharacterPosition(map, sample, visual.state.attackerId).add(new Vector3(0, 0.82, 0));
  const defender = interpolateCharacterPosition(map, sample, visual.state.defenderId).add(new Vector3(0, 0.82, 0));
  triggerParticleBurst(visual.sparks, Vector3.Center(attacker, defender), 105);
  visual.flarePulse = Math.max(visual.flarePulse, 0.45);
}

function triggerDuelKill(visual: DuelVisual, map: MapDescriptor, sample: SnapshotSample): void {
  const loser = interpolateCharacterPosition(map, sample, visual.state.loserId).add(new Vector3(0, 0.82, 0));
  const corpse = getDuelCorpsePosition(map, visual.state).add(new Vector3(0, 0.45, 0));
  const impact = Vector3.Center(loser, corpse).add(new Vector3(0, 0.18, 0));
  triggerParticleBurst(visual.sparks, impact, 170);
  triggerParticleBurst(visual.blood, impact, 320);
  triggerParticleBurst(visual.smoke, getDuelCorpsePosition(map, visual.state).add(new Vector3(0, 0.18, 0)), 140);
  visual.flarePulse = 1;
}

function triggerParticleBurst(system: ParticleSystem, emitter: Vector3, count: number): void {
  system.emitter = emitter;
  system.manualEmitCount = count;
  system.start();
}

function updateCharacters(
  snapshot: ReplaySnapshot,
  visuals: Map<string, CharacterVisual>,
  sample: SnapshotSample,
  virtualTurn: number,
  elapsed: number,
  materials: ReturnType<typeof createMaterials>,
  duel: DuelState | null,
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
    const duelDeathFall =
      duel !== null &&
      characterId === duel.loserId &&
      virtualTurn >= duel.killTurn &&
      virtualTurn < duel.killTurn + 0.78;
    const visible =
      (character.alive || duelDeathFall) &&
      !vaporized &&
      (character.extractedAtTurn === null ||
        character.extractedAtTurn === undefined ||
        character.extractedAtTurn > virtualTurn);

    visual.root.setEnabled(visible);
    if (!visible) continue;

    const pos = interpolateCharacterPosition(snapshot.map, sample, characterId);
    visual.root.scaling = visual.baseScaling.clone();
    visual.root.rotation.x = 0;
    visual.root.rotation.z = 0;

    if (duelDeathFall && duel) {
      const fall = clamp((virtualTurn - duel.killTurn) / 0.78, 0, 1);
      const corpse = getDuelCorpsePosition(snapshot.map, duel);
      visual.root.position = lerpVector3(pos, corpse, fall).add(new Vector3(0, 0.04 + (1 - fall) * 0.28, 0));
      visual.root.rotation.x = fall * Math.PI * 0.5;
      visual.root.rotation.z = -fall * 0.86;
      visual.root.rotation.y = Math.sin(elapsed * 12) * 0.2;
      visual.root.scaling = new Vector3(visual.baseScaling.x, visual.baseScaling.y * (1 - fall * 0.38), visual.baseScaling.z);
    } else {
      visual.root.position = pos.add(new Vector3(0, Math.sin(elapsed * 7 + pos.x) * 0.045, 0));
      visual.root.rotation.y = Math.sin(elapsed * 1.5 + pos.z) * 0.16;
    }

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
  duel: DuelState | null,
): Vector3 {
  if (
    duel &&
    virtualTurn >= duel.startTurn - 0.28 &&
    virtualTurn <= duel.killTurn + 1.1
  ) {
    const winner = interpolateCharacterPosition(snapshot.map, sample, duel.winnerId);
    const loser = getDuelCorpsePosition(snapshot.map, duel);
    return Vector3.Center(winner, loser);
  }
  if (virtualTurn >= snapshot.moneyShot.landsAtTurn) {
    return toScenePosition(snapshot.map, fallback, 0.2);
  }
  const character = sampleCharacter(sample, snapshot.moneyShot.victimId);
  if (!character) return toScenePosition(snapshot.map, fallback, 0.2);
  const pos = interpolateCharacterPosition(snapshot.map, sample, snapshot.moneyShot.victimId);
  return pos;
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
    seconds: clamp(snapshot.moneyShot.loopSeconds ?? 14, 10, 36),
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

function resolveDuel(snapshot: ReplaySnapshot): DuelState | null {
  const duel = snapshot.duel;
  if (!duel) return null;

  const firstTurn = snapshot.frames[0]?.turn ?? 0;
  const first = duel.participantIds[0];
  const second = duel.participantIds[1];
  const attackerId = duel.attackerId ?? duel.winnerId ?? first;
  const defenderId = duel.defenderId ?? duel.loserId ?? second;
  const winnerId = duel.winnerId ?? attackerId;
  const loserId = duel.loserId ?? defenderId;
  if (!attackerId || !defenderId || !winnerId || !loserId || winnerId === loserId) {
    return null;
  }

  const startTurn = duel.startTurn ?? firstTurn + 1;
  const killTurn = duel.killTurn ?? duel.endTurn ?? startTurn + 2;
  const exchangeTurn = duel.exchangeTurn ?? startTurn + Math.max(0.4, (killTurn - startTurn) * 0.52);
  const endTurn = duel.endTurn ?? killTurn;
  return {
    attackerId,
    defenderId,
    winnerId,
    loserId,
    startTurn,
    exchangeTurn,
    killTurn,
    endTurn,
    corpsePos: findCorpsePosition(snapshot, loserId) ?? findCharacterTileAtTurn(snapshot, loserId, killTurn),
  };
}

function findCorpsePosition(snapshot: ReplaySnapshot, characterId: string): Tile | null {
  const sorted = [...snapshot.frames].sort((a, b) => a.turn - b.turn);
  for (const frame of sorted) {
    const corpse = frame.corpses.find((candidate) => candidate.characterId === characterId);
    if (corpse) return corpse.pos;
  }
  return null;
}

function findCharacterTileAtTurn(snapshot: ReplaySnapshot, characterId: string, turn: number): Tile | null {
  const sorted = [...snapshot.frames].sort((a, b) => Math.abs(a.turn - turn) - Math.abs(b.turn - turn));
  for (const frame of sorted) {
    const character = frame.characters.find((candidate) => candidate.characterId === characterId);
    if (character) return character.pos;
  }
  return null;
}

function getDuelCorpsePosition(map: MapDescriptor, duel: DuelState): Vector3 {
  return toScenePosition(map, duel.corpsePos ?? { x: map.size.w / 2, y: map.size.h / 2 }, 0);
}

function setTraceBeam(beam: Mesh, start: Vector3, end: Vector3, pulse: number): void {
  if (pulse <= 0.02) {
    beam.setEnabled(false);
    return;
  }
  const length = Vector3.Distance(start, end);
  if (length <= 0.01) {
    beam.setEnabled(false);
    return;
  }
  beam.setEnabled(true);
  beam.position = Vector3.Center(start, end);
  beam.scaling = new Vector3(1 + pulse * 1.5, 1 + pulse * 1.5, length);
  beam.lookAt(end);
}

function updatePostFx(postFx: PostFx, killPulse: number, telefragPulse: number, impactPulse: number): void {
  const strongest = Math.max(killPulse * 0.7, telefragPulse, impactPulse * 0.85);
  postFx.glow.intensity = postFx.baseGlow + strongest * 0.72;
  postFx.pipeline.bloomWeight = postFx.baseBloom + strongest * 0.42;
  postFx.pipeline.chromaticAberration.aberrationAmount = postFx.baseAberration + strongest * 21;
  postFx.pipeline.imageProcessing.exposure = postFx.baseExposure + strongest * 0.16;
}

function updateCameraDirector(
  camera: ArcRotateCamera,
  followLocked: boolean,
  baseRadius: number,
  baseBeta: number,
  virtualTurn: number,
  duel: DuelState | null,
  telefragTurn: number,
  killPulse: number,
  telefragPulse: number,
  deltaSeconds: number,
): void {
  if (!followLocked) return;
  const duelWindow =
    duel !== null &&
    virtualTurn >= duel.startTurn - 0.3 &&
    virtualTurn <= duel.killTurn + 1.15;
  const telefragWindow = Math.abs(virtualTurn - telefragTurn) <= 1.25;
  const radiusPull =
    (duelWindow ? 4.8 : 0) +
    (telefragWindow ? 2.4 : 0) +
    killPulse * 4.2 +
    telefragPulse * 3.4;
  const desiredRadius = clamp(baseRadius - radiusPull, 8.2, baseRadius);
  const desiredBeta = clamp(baseBeta - killPulse * 0.035 + telefragPulse * 0.025, 0.34, Math.PI * 0.48);
  const blend = clamp(deltaSeconds * 4.4, 0, 1);
  camera.radius += (desiredRadius - camera.radius) * blend;
  camera.beta += (desiredBeta - camera.beta) * blend;
}

function cameraShakeOffset(elapsed: number, pulse: number): Vector3 {
  if (pulse <= 0.01) return Vector3.Zero();
  const strength = pulse * pulse;
  return new Vector3(
    Math.sin(elapsed * 71.0) * 0.1 * strength,
    Math.sin(elapsed * 93.0) * 0.045 * strength,
    Math.cos(elapsed * 83.0) * 0.1 * strength,
  );
}

function turnPulse(turn: number, center: number, width: number): number {
  return clamp(1 - Math.abs(turn - center) / Math.max(width, 0.001), 0, 1);
}

function lerpVector3(a: Vector3, b: Vector3, t: number): Vector3 {
  return a.scale(1 - t).add(b.scale(t));
}

function createRadialParticleTexture(
  scene: Scene,
  name: string,
  stops: Array<[number, string]>,
): DynamicTexture {
  const texture = new DynamicTexture(name, { width: 64, height: 64 }, scene, false);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
  for (const [stop, color] of stops) {
    gradient.addColorStop(stop, color);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.update();
  return texture;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
