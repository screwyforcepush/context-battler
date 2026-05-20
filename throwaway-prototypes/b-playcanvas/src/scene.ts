import {
  Application,
  BLEND_ADDITIVE,
  BLEND_NONE,
  BLEND_NORMAL,
  CameraComponent,
  CameraFrame,
  Color,
  ContainerResource,
  Entity,
  FOG_EXP2,
  RenderComponent,
  StandardMaterial,
  TONEMAP_ACES,
  Vec3,
} from "playcanvas";
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
  new Color(0.95, 0.1, 0.12),
  new Color(0.0, 0.9, 0.78),
  new Color(1.0, 0.68, 0.12),
  new Color(0.42, 0.95, 0.32),
  new Color(0.84, 0.28, 1.0),
  new Color(0.2, 0.52, 1.0),
];

type RenderPrimitive =
  | "box"
  | "capsule"
  | "cone"
  | "cylinder"
  | "plane"
  | "sphere"
  | "torus";

type Templates = {
  agent: ContainerResource | null;
  crate: ContainerResource | null;
};

type Materials = ReturnType<typeof createMaterials>;

type CharacterVisual = {
  root: Entity;
  accent: Color;
};

type AirdropVisual = {
  root: Entity;
  marker: Entity;
  beam: Entity;
  light: Entity;
};

type RawDuelMetadata = {
  participantIds?: string[];
  attackerId?: string;
  defenderId?: string;
  winnerId?: string;
  loserId?: string;
  killerId?: string;
  victimId?: string;
  startTurn?: number;
  exchangeTurn?: number;
  killTurn?: number;
  endTurn?: number;
  corpseTile?: Tile;
};

type SnapshotWithDuel = ReplaySnapshot & {
  duel?: RawDuelMetadata;
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
  clashTrace: Entity;
  counterTrace: Entity;
  killTrace: Entity;
  impactRing: Entity;
  corpsePool: Entity;
  corpseRing: Entity;
  corpseLight: Entity;
  flare: Entity;
  sparks: SimpleBurst;
  blood: SimpleBurst;
  smoke: SimpleBurst;
  flarePulse: number;
};

type BurstParticle = {
  entity: Entity;
  velocity: Vec3;
  life: number;
  age: number;
  baseScale: number;
  spin: Vec3;
  gravity: number;
};

type BurstConfig = {
  speedMin: number;
  speedMax: number;
  riseMin: number;
  riseMax: number;
  lifeMin: number;
  lifeMax: number;
  scaleMin: number;
  scaleMax: number;
  gravity: number;
};

type SimpleBurst = {
  trigger: (position: Vec3, config: BurstConfig) => void;
  update: (dt: number) => void;
};

export type SceneController = {
  update: (dt: number) => void;
  setFollowLocked: (locked: boolean) => void;
  isFollowLocked: () => boolean;
};

export async function createTelefragScene(
  app: Application,
  canvas: HTMLCanvasElement,
  snapshot: ReplaySnapshot,
): Promise<SceneController> {
  configureScene(app);
  const materials = createMaterials();
  const orbit = createCamera(app, canvas, snapshot.map);
  const postFrame = orbit.camera.camera ? addPost(app, orbit.camera.camera) : null;

  addLighting(app);
  buildArena(app, snapshot.map, materials);

  const templates = await loadTemplates(app);
  for (const crate of collectCrates(snapshot)) {
    const root = instantiateCrate(app, templates, `static-${crate.id}`, materials, 0.8);
    root.setPosition(toScenePosition(snapshot.map, crate.pos, 0.38));
  }

  const characterVisuals = new Map<string, CharacterVisual>();
  collectCharacterIds(snapshot.frames).forEach((characterId, index) => {
    const accent = AGENT_COLORS[index % AGENT_COLORS.length] ?? AGENT_COLORS[0]!;
    const root = instantiateAgent(app, templates, characterId, accent, materials);
    characterVisuals.set(characterId, { root, accent });
  });

  const drop = getMoneyShotAirdrop(snapshot);
  const airdropVisual = createAirdrop(app, templates, drop, snapshot.map, materials);
  const mist = createMist(app, materials.mist);
  const duelState = resolveDuel(snapshot);
  const duelVisual = duelState ? createDuelVisual(app, snapshot.map, duelState, materials) : null;
  const shockwave = addPrimitive(app, app.root, "impact-shockwave", "torus", materials.shock);
  shockwave.enabled = false;
  const impactCloud = addPrimitive(app, app.root, "impact-red-cloud", "sphere", materials.red);
  impactCloud.enabled = false;

  const impactLight = new Entity("impact-light", app);
  impactLight.addComponent("light", {
    type: "omni",
    color: new Color(1, 0.04, 0.02),
    intensity: 0,
    range: 16,
  });
  impactLight.setPosition(toScenePosition(snapshot.map, drop.pos, 0.8));
  app.root.addChild(impactLight);

  let elapsed = 0;
  let lastVirtualTurn: number | null = null;
  let impactPulse = 0;
  let killCameraPulse = 0;
  const loop = getLoop(snapshot);

  return {
    update(dt: number) {
      elapsed += dt;
      const loopTime = elapsed % loop.seconds;
      const virtualTurn = loop.startTurn + (loopTime / loop.seconds) * loop.turnSpan;
      const sample = sampleSnapshot(snapshot.frames, virtualTurn);

      if (lastVirtualTurn !== null && duelVisual) {
        if (crossedTurn(lastVirtualTurn, virtualTurn, duelVisual.state.exchangeTurn)) {
          triggerDuelExchange(duelVisual, snapshot.map, sample);
          killCameraPulse = Math.max(killCameraPulse, 0.42);
        }
        if (crossedTurn(lastVirtualTurn, virtualTurn, duelVisual.state.killTurn)) {
          triggerDuelKill(duelVisual, snapshot.map, sample);
          killCameraPulse = 1;
        }
      }

      updateCharacters(snapshot, characterVisuals, sample, virtualTurn, elapsed, duelState);
      if (duelVisual) {
        updateDuelVisual(duelVisual, snapshot.map, sample, virtualTurn, elapsed, dt);
      }
      updateAirdrop(snapshot.map, airdropVisual, drop, loop, virtualTurn, elapsed);

      killCameraPulse = Math.max(0, killCameraPulse - dt * 1.55);
      const targetPosition = getTargetPosition(snapshot, sample, virtualTurn, drop.pos, duelState);
      targetPosition.y += 0.9;
      const shake = cameraShakeOffset(elapsed, Math.max(killCameraPulse, impactPulse * 0.72));
      targetPosition.x += shake.x;
      targetPosition.y += shake.y;
      targetPosition.z += shake.z;
      orbit.updateAnchor(targetPosition);

      if (lastVirtualTurn !== null && crossedTurn(lastVirtualTurn, virtualTurn, drop.landsAtTurn)) {
        mist.trigger(toScenePosition(snapshot.map, drop.pos, 0.72));
        impactPulse = 1;
      }
      const impactWindow = virtualTurn - drop.landsAtTurn;
      if (impactWindow >= 0 && impactWindow <= 0.75) {
        impactPulse = Math.max(impactPulse, 1 - impactWindow / 0.75);
      }

      impactPulse = Math.max(0, impactPulse - dt * 0.32);
      updateImpact(
        shockwave,
        impactCloud,
        materials.shock,
        impactLight,
        snapshot.map,
        drop.pos,
        impactPulse,
      );
      mist.update(dt);
      const duelWindow =
        duelState !== null &&
        virtualTurn >= duelState.startTurn - 0.25 &&
        virtualTurn <= duelState.killTurn + 1.25;
      orbit.setPunch(
        Math.max(killCameraPulse, impactPulse * 0.64),
        (duelWindow ? 2.9 : 0) + killCameraPulse * 3.8 + impactPulse * 2.2,
      );
      orbit.update(dt);
      if (postFrame) postFrame.update();
      lastVirtualTurn = virtualTurn;
    },
    setFollowLocked(locked: boolean) {
      orbit.setFollowLocked(locked);
    },
    isFollowLocked() {
      return orbit.isFollowLocked();
    },
  };
}

function configureScene(app: Application): void {
  app.scene.ambientLight = new Color(0.09, 0.12, 0.135);
  app.scene.fog.type = FOG_EXP2;
  app.scene.fog.color = new Color(0.008, 0.014, 0.02);
  app.scene.fog.density = 0.023;
}

function createCamera(
  app: Application,
  canvas: HTMLCanvasElement,
  map: MapDescriptor,
): OrbitRig {
  const camera = new Entity("director-camera", app);
  camera.addComponent("camera", {
    clearColor: new Color(0.006, 0.008, 0.012),
    fov: 48,
    nearClip: 0.08,
    farClip: 160,
  });
  app.root.addChild(camera);

  const center = toScenePosition(map, { x: map.size.w / 2, y: map.size.h / 2 }, 0.8);
  return new OrbitRig(camera, canvas, center);
}

function addPost(app: Application, camera: CameraComponent): CameraFrame | null {
  try {
    camera.toneMapping = TONEMAP_ACES;
    const frame = new CameraFrame(app, camera);
    frame.rendering.toneMapping = TONEMAP_ACES;
    frame.rendering.samples = 2;
    frame.rendering.sharpness = 0.12;
    frame.bloom.intensity = 0.065;
    frame.bloom.blurLevel = 9;
    frame.grading.enabled = true;
    frame.grading.brightness = 0.98;
    frame.grading.contrast = 1.18;
    frame.grading.saturation = 1.08;
    frame.grading.tint = new Color(0.92, 0.98, 1);
    frame.vignette.intensity = 0.42;
    frame.vignette.inner = 0.42;
    frame.vignette.outer = 1.35;
    frame.vignette.color = new Color(0.0, 0.0, 0.0);
    frame.fringing.intensity = 3.5;
    frame.update();
    frame.enabled = true;
    return frame;
  } catch (error) {
    console.warn("PlayCanvas CameraFrame post stack failed; continuing without it.", error);
    return null;
  }
}

function addLighting(app: Application): void {
  const key = new Entity("key-light", app);
  key.addComponent("light", {
    type: "directional",
    color: new Color(1, 0.82, 0.58),
    intensity: 1.62,
    castShadows: true,
    shadowDistance: 34,
  });
  key.setEulerAngles(48, -38, 0);
  app.root.addChild(key);

  const rim = new Entity("cyan-rim-light", app);
  rim.addComponent("light", {
    type: "omni",
    color: new Color(0.0, 0.82, 0.9),
    intensity: 2.55,
    range: 32,
  });
  rim.setPosition(-10, 6, -11);
  app.root.addChild(rim);

  const infernal = new Entity("red-rim-light", app);
  infernal.addComponent("light", {
    type: "omni",
    color: new Color(1, 0.08, 0.02),
    intensity: 1.45,
    range: 24,
  });
  infernal.setPosition(8, 5, 9);
  app.root.addChild(infernal);

  const topWash = new Entity("wall-top-wash", app);
  topWash.addComponent("light", {
    type: "omni",
    color: new Color(0.22, 0.82, 1.0),
    intensity: 1.25,
    range: 34,
  });
  topWash.setPosition(0, 7.4, 0);
  app.root.addChild(topWash);
}

function createMaterials() {
  const ground = material(
    "ground",
    new Color(0.009, 0.011, 0.016),
    new Color(0.006, 0.025, 0.032),
  );
  const wall = material(
    "wall",
    new Color(0.06, 0.068, 0.084),
    new Color(0.025, 0.065, 0.082),
    1,
    false,
    1.05,
  );
  const wallTop = material(
    "wall-top-rim",
    new Color(0.18, 0.205, 0.22),
    new Color(0.08, 0.38, 0.42),
    1,
    false,
    1.35,
  );
  const wallEdge = material(
    "wall-cyan-edge",
    new Color(0.02, 0.34, 0.38),
    new Color(0.0, 0.95, 0.92),
    0.82,
    true,
    3.4,
  );
  const cover = material(
    "cover",
    new Color(0.055, 0.047, 0.062),
    new Color(0.13, 0.045, 0.055),
    1,
    false,
    1.0,
  );
  const coverTop = material(
    "cover-top",
    new Color(0.135, 0.11, 0.12),
    new Color(0.38, 0.12, 0.07),
    1,
    false,
    1.25,
  );
  const coverEdge = material(
    "cover-neon-edge",
    new Color(0.42, 0.08, 0.03),
    new Color(1.0, 0.28, 0.04),
    0.84,
    true,
    3.2,
  );
  const grid = material(
    "grid",
    new Color(0.0, 0.46, 0.5),
    new Color(0.0, 1.0, 0.86),
    0.34,
    true,
    2.2,
  );
  const crate = material(
    "crate",
    new Color(0.16, 0.12, 0.075),
    new Color(0.9, 0.34, 0.06),
    1,
    false,
    1.2,
  );
  const airdrop = material(
    "airdrop",
    new Color(0.2, 0.02, 0.018),
    new Color(1.0, 0.02, 0.02),
    0.82,
    true,
    3.0,
  );
  const beam = material(
    "beam",
    new Color(0.12, 0.01, 0.01),
    new Color(1, 0, 0),
    0.34,
    true,
    4.0,
  );
  const red = material(
    "red-mist",
    new Color(1.0, 0.03, 0.01),
    new Color(1.0, 0.01, 0.0),
    0.78,
    true,
    5.4,
  );
  const shock = material(
    "shockwave",
    new Color(1.0, 0.03, 0.01),
    new Color(1.0, 0.01, 0.0),
    0.78,
    true,
    6.0,
  );
  const mist = material(
    "mist-particle",
    new Color(1.0, 0.06, 0.02),
    new Color(1.0, 0.02, 0.0),
    0.72,
    true,
    5.8,
  );
  const duelTrace = material(
    "duel-trace",
    new Color(1.0, 0.76, 0.26),
    new Color(1.0, 0.56, 0.04),
    0.9,
    true,
    4.8,
  );
  const duelCounter = material(
    "duel-counter-trace",
    new Color(0.12, 0.82, 1.0),
    new Color(0.0, 0.72, 1.0),
    0.78,
    true,
    4.2,
  );
  const duelBlood = material(
    "duel-blood",
    new Color(0.8, 0.01, 0.0),
    new Color(1.0, 0.0, 0.0),
    0.82,
    true,
    5.2,
  );
  const duelSpark = material(
    "duel-spark",
    new Color(1.0, 0.84, 0.36),
    new Color(1.0, 0.58, 0.04),
    0.78,
    true,
    5.4,
  );
  const duelSmoke = material(
    "duel-smoke",
    new Color(0.32, 0.045, 0.036),
    new Color(0.2, 0.035, 0.028),
    0.42,
    true,
    1.4,
  );
  const corpse = material(
    "duel-corpse-pool",
    new Color(0.38, 0.005, 0.004),
    new Color(0.68, 0.0, 0.0),
    0.66,
    true,
    2.4,
  );
  return {
    ground,
    wall,
    wallTop,
    wallEdge,
    cover,
    coverTop,
    coverEdge,
    grid,
    crate,
    airdrop,
    beam,
    red,
    shock,
    mist,
    duelTrace,
    duelCounter,
    duelBlood,
    duelSpark,
    duelSmoke,
    corpse,
  };
}

function material(
  name: string,
  diffuse: Color,
  emissive: Color,
  alpha = 1,
  additive = false,
  emissiveIntensity = 0.8,
): StandardMaterial {
  const mat = new StandardMaterial();
  mat.name = name;
  mat.diffuse = diffuse;
  mat.emissive = emissive;
  mat.emissiveIntensity = emissiveIntensity;
  mat.opacity = alpha;
  mat.blendType = alpha < 1 ? (additive ? BLEND_ADDITIVE : BLEND_NORMAL) : BLEND_NONE;
  mat.depthWrite = alpha >= 0.98 && !additive;
  mat.useMetalness = true;
  mat.metalness = 0.18;
  mat.gloss = 0.66;
  mat.update();
  return mat;
}

function buildArena(app: Application, map: MapDescriptor, materials: Materials): void {
  const floor = addPrimitive(app, app.root, "arena-floor", "box", materials.ground);
  floor.setPosition(0, -0.035, 0);
  floor.setLocalScale(map.size.w * WORLD_SCALE, 0.07, map.size.h * WORLD_SCALE);

  const halfW = (map.size.w * WORLD_SCALE) / 2;
  const halfH = (map.size.h * WORLD_SCALE) / 2;
  for (let x = 0; x <= map.size.w; x += 5) {
    const sceneX = (x - map.size.w / 2) * WORLD_SCALE;
    const line = addPrimitive(app, app.root, `grid-x-${x}`, "box", materials.grid);
    line.setPosition(sceneX, 0.018, 0);
    line.setLocalScale(0.018, 0.03, halfH * 2);
  }
  for (let y = 0; y <= map.size.h; y += 5) {
    const sceneZ = (y - map.size.h / 2) * WORLD_SCALE;
    const line = addPrimitive(app, app.root, `grid-y-${y}`, "box", materials.grid);
    line.setPosition(0, 0.019, sceneZ);
    line.setLocalScale(halfW * 2, 0.03, 0.018);
  }

  for (const rect of map.walls) {
    addBlock(app, map, rect, 1.16, materials.wall);
    addBlockTop(app, map, rect, 1.16, materials.wallTop, "wall-top");
    addTopEdgeStrips(app, map, rect, 1.16, materials.wallEdge, "wall-edge", 0.045);
  }
  for (const rect of map.coverClusters ?? []) {
    addBlock(app, map, rect, 0.54, materials.cover);
    addBlockTop(app, map, rect, 0.54, materials.coverTop, "cover-top");
    addTopEdgeStrips(app, map, rect, 0.54, materials.coverEdge, "cover-edge", 0.04);
  }

  if (map.evac) {
    const evac = addPrimitive(app, app.root, "evac-ring", "torus", materials.grid);
    evac.setPosition(toScenePosition(map, map.evac, 0.06));
    evac.setLocalScale(4.2, 0.08, 4.2);
  }
}

function addBlock(
  app: Application,
  map: MapDescriptor,
  rect: Rect,
  height: number,
  blockMaterial: StandardMaterial,
): Entity {
  const block = addPrimitive(app, app.root, `block-${rect.x}-${rect.y}`, "box", blockMaterial);
  block.setPosition(
    toScenePosition(map, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, height / 2),
  );
  block.setLocalScale(rect.w * WORLD_SCALE, height, rect.h * WORLD_SCALE);
  return block;
}

function addBlockTop(
  app: Application,
  map: MapDescriptor,
  rect: Rect,
  height: number,
  blockMaterial: StandardMaterial,
  prefix: string,
): Entity {
  const cap = addPrimitive(app, app.root, `${prefix}-${rect.x}-${rect.y}`, "box", blockMaterial);
  cap.setPosition(
    toScenePosition(map, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, height + 0.028),
  );
  cap.setLocalScale(rect.w * WORLD_SCALE + 0.035, 0.052, rect.h * WORLD_SCALE + 0.035);
  return cap;
}

function addTopEdgeStrips(
  app: Application,
  map: MapDescriptor,
  rect: Rect,
  height: number,
  edgeMaterial: StandardMaterial,
  prefix: string,
  thickness: number,
): void {
  const xCenter = rect.x + rect.w / 2;
  const yCenter = rect.y + rect.h / 2;
  const topY = height + 0.066;
  const longScale = rect.w * WORLD_SCALE + thickness * 1.5;
  const tallScale = rect.h * WORLD_SCALE + thickness * 1.5;

  const north = addPrimitive(app, app.root, `${prefix}-n-${rect.x}-${rect.y}`, "box", edgeMaterial);
  north.setPosition(toScenePosition(map, { x: xCenter, y: rect.y }, topY));
  north.setLocalScale(longScale, thickness, thickness);

  const south = addPrimitive(app, app.root, `${prefix}-s-${rect.x}-${rect.y}`, "box", edgeMaterial);
  south.setPosition(toScenePosition(map, { x: xCenter, y: rect.y + rect.h }, topY));
  south.setLocalScale(longScale, thickness, thickness);

  const west = addPrimitive(app, app.root, `${prefix}-w-${rect.x}-${rect.y}`, "box", edgeMaterial);
  west.setPosition(toScenePosition(map, { x: rect.x, y: yCenter }, topY));
  west.setLocalScale(thickness, thickness, tallScale);

  const east = addPrimitive(app, app.root, `${prefix}-e-${rect.x}-${rect.y}`, "box", edgeMaterial);
  east.setPosition(toScenePosition(map, { x: rect.x + rect.w, y: yCenter }, topY));
  east.setLocalScale(thickness, thickness, tallScale);
}

async function loadTemplates(app: Application): Promise<Templates> {
  const [agent, crate] = await Promise.all([
    loadContainer(app, "Astronaut.glb"),
    loadContainer(app, "Pickup Crate.glb"),
  ]);
  return { agent, crate };
}

async function loadContainer(
  app: Application,
  filename: string,
): Promise<ContainerResource | null> {
  return new Promise((resolve) => {
    const url = `${MODEL_ROOT}${encodeURIComponent(filename)}`;
    app.assets.loadFromUrlAndFilename(url, filename, "container", (error, asset) => {
      if (error || !asset?.resource) {
        console.warn(`Unable to load GLB model ${filename}; using procedural fallback.`, error);
        resolve(null);
        return;
      }
      resolve(asset.resource as ContainerResource);
    });
  });
}

function instantiateAgent(
  app: Application,
  templates: Templates,
  name: string,
  accent: Color,
  materials: Materials,
): Entity {
  const root = new Entity(`agent-${name}`, app);
  app.root.addChild(root);

  if (templates.agent) {
    const model = templates.agent.instantiateRenderEntity({
      castShadows: true,
      receiveShadows: true,
    });
    model.name = `${name}-astronaut`;
    model.setLocalScale(0.44, 0.44, 0.44);
    model.setLocalPosition(0, 0, 0);
    root.addChild(model);
    tintModel(model, accent);
  }

  const body = addPrimitive(app, root, `${name}-fallback-body`, "capsule", agentMaterial(name, accent));
  body.setLocalPosition(0, 0.62, 0);
  body.setLocalScale(0.48, 0.5, 0.48);

  const visor = addPrimitive(app, root, `${name}-visor`, "box", materials.grid);
  visor.setLocalPosition(0, 1.18, -0.28);
  visor.setLocalScale(0.42, 0.055, 0.08);

  const halo = addPrimitive(app, root, `${name}-halo`, "torus", accentMaterial(`${name}-halo`, accent));
  halo.setLocalPosition(0, 0.05, 0);
  halo.setLocalScale(1.04, 0.05, 1.04);
  return root;
}

function instantiateCrate(
  app: Application,
  templates: Templates,
  name: string,
  materials: Materials,
  size: number,
): Entity {
  const root = new Entity(`crate-${name}`, app);
  app.root.addChild(root);

  if (templates.crate) {
    const model = templates.crate.instantiateRenderEntity({
      castShadows: true,
      receiveShadows: true,
    });
    model.name = `${name}-pickup-crate`;
    model.setLocalScale(size * 0.62, size * 0.62, size * 0.62);
    root.addChild(model);
    tintModel(model, new Color(1, 0.28, 0.04));
  } else {
    const box = addPrimitive(app, root, `${name}-box`, "box", materials.crate);
    box.setLocalPosition(0, 0.3 * size, 0);
    box.setLocalScale(size, size * 0.72, size);
  }

  const ring = addPrimitive(app, root, `${name}-crate-ring`, "torus", materials.airdrop);
  ring.setLocalPosition(0, 0.06, 0);
  ring.setLocalScale(size * 1.08, 0.05, size * 1.08);
  return root;
}

function createAirdrop(
  app: Application,
  templates: Templates,
  drop: SnapshotAirdrop,
  map: MapDescriptor,
  materials: Materials,
): AirdropVisual {
  const root = instantiateCrate(app, templates, `falling-${drop.id}`, materials, 1.25);
  root.setPosition(toScenePosition(map, drop.pos, 13));
  root.setEulerAngles(0, 25, 0);

  const marker = addPrimitive(app, app.root, "airdrop-impact-ring", "torus", materials.airdrop);
  marker.setPosition(toScenePosition(map, drop.pos, 0.08));
  marker.setLocalScale(2.2, 0.06, 2.2);

  const beam = addPrimitive(app, app.root, "airdrop-warning-beam", "cylinder", materials.beam);
  beam.setPosition(toScenePosition(map, drop.pos, 6));
  beam.setLocalScale(0.08, 12, 0.08);

  const light = new Entity("airdrop-light", app);
  light.addComponent("light", {
    type: "omni",
    color: new Color(1, 0.04, 0.02),
    intensity: 1.8,
    range: 14,
  });
  light.setPosition(toScenePosition(map, drop.pos, 4));
  app.root.addChild(light);

  return { root, marker, beam, light };
}

function tintModel(root: Entity, accent: Color): void {
  const renders = root.findComponents("render") as RenderComponent[];
  for (const render of renders) {
    for (const meshInstance of render.meshInstances) {
      if (meshInstance.material instanceof StandardMaterial) {
        const clone = meshInstance.material.clone();
        clone.emissive = new Color(accent.r * 0.28, accent.g * 0.28, accent.b * 0.28);
        clone.emissiveIntensity = 1.25;
        clone.update();
        meshInstance.material = clone;
      }
    }
  }
}

function updateCharacters(
  snapshot: ReplaySnapshot,
  visuals: Map<string, CharacterVisual>,
  sample: SnapshotSample,
  virtualTurn: number,
  elapsed: number,
  duel: DuelState | null,
): void {
  for (const [characterId, visual] of visuals.entries()) {
    const character = sampleCharacter(sample, characterId);
    if (!character) {
      visual.root.enabled = false;
      continue;
    }

    const vaporized =
      characterId === snapshot.moneyShot.victimId &&
      virtualTurn >= snapshot.moneyShot.landsAtTurn;
    const duelDeathFall =
      duel !== null &&
      characterId === duel.loserId &&
      virtualTurn >= duel.killTurn &&
      virtualTurn < duel.killTurn + 0.84;
    const visible =
      (character.alive || duelDeathFall) &&
      !vaporized &&
      (character.extractedAtTurn === null ||
        character.extractedAtTurn === undefined ||
        character.extractedAtTurn > virtualTurn);

    visual.root.enabled = visible;
    if (!visible) continue;

    const pos = interpolateCharacterPosition(snapshot.map, sample, characterId);
    let pitch = 0;
    const yaw = Math.sin(elapsed * 1.5 + pos.z) * 8;
    let roll = 0;

    if (duelDeathFall && duel) {
      const fall = clamp((virtualTurn - duel.killTurn) / 0.84, 0, 1);
      const corpse = getDuelCorpsePosition(snapshot.map, duel);
      const fallen = lerpVec3(pos, corpse, fall);
      fallen.y += 0.05 + (1 - fall) * 0.3;
      visual.root.setPosition(fallen);
      visual.root.setEulerAngles(82 * fall, yaw, -48 * fall);
      continue;
    }

    if (duel) {
      const attacker = interpolateCharacterPosition(snapshot.map, sample, duel.attackerId);
      const defender = interpolateCharacterPosition(snapshot.map, sample, duel.defenderId);
      const winner = interpolateCharacterPosition(snapshot.map, sample, duel.winnerId);
      const loser = getDuelCorpsePosition(snapshot.map, duel);
      const exchangePulse = turnPulse(virtualTurn, duel.exchangeTurn, 0.42);
      const killPulse = turnPulse(virtualTurn, duel.killTurn, 0.52);

      if (characterId === duel.attackerId && exchangePulse > 0.01) {
        const direction = directionBetween(attacker, defender);
        pos.x += direction.x * exchangePulse * 0.32;
        pos.z += direction.z * exchangePulse * 0.32;
        pitch -= exchangePulse * 7;
      }
      if (characterId === duel.defenderId && exchangePulse > 0.01) {
        const direction = directionBetween(attacker, defender);
        pos.x -= direction.x * exchangePulse * 0.24;
        pos.z -= direction.z * exchangePulse * 0.24;
        roll += exchangePulse * 10;
      }
      if (characterId === duel.winnerId && killPulse > 0.01) {
        const direction = directionBetween(winner, loser);
        pos.x += direction.x * killPulse * 0.4;
        pos.z += direction.z * killPulse * 0.4;
        pitch -= killPulse * 10;
      }
      if (characterId === duel.loserId && virtualTurn < duel.killTurn && killPulse > 0.01) {
        const direction = directionBetween(winner, loser);
        pos.x -= direction.x * killPulse * 0.34;
        pos.z -= direction.z * killPulse * 0.34;
        pos.y += killPulse * 0.18;
        roll += killPulse * 16;
      }
    }

    pos.y += Math.sin(elapsed * 7 + pos.x) * 0.045;
    visual.root.setPosition(pos);
    visual.root.setEulerAngles(pitch, yaw, roll);
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
    visual.root.enabled = false;
    visual.marker.enabled = false;
    visual.beam.enabled = false;
    setLightIntensity(visual.light, 0);
    return;
  }

  visual.root.enabled = true;
  visual.marker.enabled = true;
  visual.beam.enabled = true;
  const descent = clamp((virtualTurn - descentStart) / Math.max(0.01, drop.landsAtTurn - descentStart), 0, 1);
  const eased = descent * descent * (3 - 2 * descent);
  const y = virtualTurn >= drop.landsAtTurn ? groundY : 13.5 - eased * 12.7;
  visual.root.setPosition(scenePos.x, y, scenePos.z);
  visual.root.setEulerAngles(
    Math.sin(elapsed * 1.9) * 6 * (1 - eased),
    elapsed * (85 + (1 - eased) * 120),
    Math.sin(elapsed * 1.2) * 4 * (1 - eased),
  );

  const warningPulse = 0.55 + Math.sin(elapsed * 7.5) * 0.22;
  const markerScale = 2.2 + warningPulse * 0.2;
  visual.marker.setLocalScale(markerScale, 0.06, markerScale);
  visual.beam.setLocalScale(0.08 + warningPulse * 0.02, 8.5 + warningPulse * 3.2, 0.08 + warningPulse * 0.02);
  visual.light.setPosition(scenePos.x, 3.2 + warningPulse, scenePos.z);
  setLightIntensity(visual.light, virtualTurn >= loop.startTurn ? 1.1 + warningPulse * 2.2 : 0);
}

function updateImpact(
  ring: Entity,
  cloud: Entity,
  shockMaterial: StandardMaterial,
  light: Entity,
  map: MapDescriptor,
  pos: Tile,
  pulse: number,
): void {
  if (pulse <= 0) {
    ring.enabled = false;
    cloud.enabled = false;
    shockMaterial.opacity = 0;
    shockMaterial.update();
    setLightIntensity(light, 0);
    return;
  }

  ring.enabled = true;
  cloud.enabled = true;
  const inverse = 1 - pulse;
  const scale = 1.2 + inverse * 8.4;
  ring.setPosition(toScenePosition(map, pos, 0.12));
  ring.setLocalScale(scale, 0.1, scale);
  cloud.setPosition(toScenePosition(map, pos, 0.62 + pulse * 0.35));
  cloud.setLocalScale(1.2 + inverse * 2.8, 0.42 + pulse * 0.32, 1.2 + inverse * 2.8);
  shockMaterial.opacity = 0.82 * pulse;
  shockMaterial.emissiveIntensity = 4 + pulse * 8;
  shockMaterial.update();
  light.setPosition(toScenePosition(map, pos, 0.7 + pulse * 1.8));
  setLightIntensity(light, 14 * pulse);
}

function createDuelVisual(
  app: Application,
  map: MapDescriptor,
  state: DuelState,
  materials: Materials,
): DuelVisual {
  const clashTrace = addPrimitive(app, app.root, "duel-clash-trace", "box", materials.duelTrace);
  const counterTrace = addPrimitive(app, app.root, "duel-counter-trace", "box", materials.duelCounter);
  const killTrace = addPrimitive(app, app.root, "duel-kill-trace", "box", materials.duelBlood);
  clashTrace.enabled = false;
  counterTrace.enabled = false;
  killTrace.enabled = false;

  const corpsePos = getDuelCorpsePosition(map, state);
  const impactRing = addPrimitive(app, app.root, "duel-kill-ring", "torus", materials.duelBlood);
  impactRing.enabled = false;
  const corpsePool = addPrimitive(app, app.root, "duel-corpse-pool", "cylinder", materials.corpse);
  corpsePool.setPosition(corpsePos.x, corpsePos.y + 0.04, corpsePos.z);
  corpsePool.enabled = false;
  const corpseRing = addPrimitive(app, app.root, "duel-corpse-ring", "torus", materials.duelBlood);
  corpseRing.setPosition(corpsePos.x, corpsePos.y + 0.08, corpsePos.z);
  corpseRing.enabled = false;

  const corpseLight = new Entity("duel-corpse-light", app);
  corpseLight.addComponent("light", {
    type: "omni",
    color: new Color(1, 0.02, 0.0),
    intensity: 0,
    range: 6,
  });
  corpseLight.setPosition(corpsePos.x, 0.45, corpsePos.z);
  app.root.addChild(corpseLight);

  const flare = new Entity("duel-kill-flare", app);
  flare.addComponent("light", {
    type: "omni",
    color: new Color(1, 0.55, 0.18),
    intensity: 0,
    range: 8,
  });
  flare.setPosition(corpsePos.x, 1.1, corpsePos.z);
  app.root.addChild(flare);

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
    sparks: createSimpleBurst(app, "duel-spark", materials.duelSpark, 56),
    blood: createSimpleBurst(app, "duel-blood", materials.duelBlood, 72),
    smoke: createSimpleBurst(app, "duel-smoke", materials.duelSmoke, 34),
    flarePulse: 0,
  };
}

function updateDuelVisual(
  visual: DuelVisual,
  map: MapDescriptor,
  sample: SnapshotSample,
  virtualTurn: number,
  elapsed: number,
  dt: number,
): void {
  const { state } = visual;
  const attacker = elevated(interpolateCharacterPosition(map, sample, state.attackerId), 0.9);
  const defender = elevated(interpolateCharacterPosition(map, sample, state.defenderId), 0.9);
  const winner = elevated(interpolateCharacterPosition(map, sample, state.winnerId), 0.9);
  const corpseGround = getDuelCorpsePosition(map, state);
  const loser = elevated(corpseGround, 0.58);

  const exchangePulse = turnPulse(virtualTurn, state.exchangeTurn, 0.54);
  const counterTurn = state.exchangeTurn + Math.max(0.2, (state.killTurn - state.exchangeTurn) * 0.5);
  const counterPulse = turnPulse(virtualTurn, counterTurn, 0.44);
  const killPulse = turnPulse(virtualTurn, state.killTurn, 0.66);

  setTraceBeam(visual.clashTrace, attacker, defender, exchangePulse, 0.07);
  setTraceBeam(visual.counterTrace, defender, attacker, counterPulse * 0.82, 0.055);
  setTraceBeam(visual.killTrace, winner, loser, killPulse, 0.11);

  const afterKill = virtualTurn >= state.killTurn - 0.16 || killPulse > 0.15;
  const corpseFade = Math.max(
    clamp((virtualTurn - state.killTurn) / 0.62, 0, 1),
    killPulse * 0.62,
  );
  visual.corpsePool.enabled = afterKill;
  visual.corpseRing.enabled = afterKill;
  if (afterKill) {
    const poolPulse = 0.08 + Math.sin(elapsed * 5.2) * 0.026;
    visual.corpsePool.setPosition(corpseGround.x, corpseGround.y + 0.045, corpseGround.z);
    visual.corpsePool.setLocalScale(0.46 + corpseFade * 1.45, 0.03, 0.32 + corpseFade * 1.05);
    visual.corpseRing.setPosition(corpseGround.x, corpseGround.y + 0.13, corpseGround.z);
    visual.corpseRing.setLocalScale(1.05 + corpseFade * 0.36 + poolPulse, 0.055, 1.05 + corpseFade * 0.36 + poolPulse);
    visual.corpseRing.rotateLocal(0, 38 * dt, 0);
  }

  if (killPulse > 0.02) {
    visual.impactRing.enabled = true;
    visual.impactRing.setPosition(corpseGround.x, corpseGround.y + 0.18, corpseGround.z);
    const scale = 1.15 + (1 - killPulse) * 4.4;
    visual.impactRing.setLocalScale(scale, 0.08, scale);
  } else {
    visual.impactRing.enabled = false;
  }

  visual.flarePulse = Math.max(0, visual.flarePulse - dt * 1.7);
  visual.flare.setPosition(corpseGround.x, 1.0 + visual.flarePulse * 0.9, corpseGround.z);
  setLightIntensity(visual.flare, visual.flarePulse * 11);
  visual.corpseLight.setPosition(corpseGround.x, 0.45, corpseGround.z);
  setLightIntensity(
    visual.corpseLight,
    afterKill ? 0.7 + Math.sin(elapsed * 4.4) * 0.22 + visual.flarePulse * 3.2 : 0,
  );

  visual.sparks.update(dt);
  visual.blood.update(dt);
  visual.smoke.update(dt);
}

function triggerDuelExchange(visual: DuelVisual, map: MapDescriptor, sample: SnapshotSample): void {
  const attacker = elevated(interpolateCharacterPosition(map, sample, visual.state.attackerId), 0.88);
  const defender = elevated(interpolateCharacterPosition(map, sample, visual.state.defenderId), 0.88);
  visual.sparks.trigger(centerVec3(attacker, defender), {
    speedMin: 2.2,
    speedMax: 5.4,
    riseMin: 0.25,
    riseMax: 2.6,
    lifeMin: 0.18,
    lifeMax: 0.52,
    scaleMin: 0.035,
    scaleMax: 0.16,
    gravity: -5.2,
  });
  visual.flarePulse = Math.max(visual.flarePulse, 0.45);
}

function triggerDuelKill(visual: DuelVisual, map: MapDescriptor, sample: SnapshotSample): void {
  const loser = elevated(interpolateCharacterPosition(map, sample, visual.state.loserId), 0.75);
  const corpse = elevated(getDuelCorpsePosition(map, visual.state), 0.38);
  const impact = centerVec3(loser, corpse);
  visual.sparks.trigger(impact, {
    speedMin: 3.0,
    speedMax: 6.8,
    riseMin: 0.2,
    riseMax: 3.2,
    lifeMin: 0.16,
    lifeMax: 0.62,
    scaleMin: 0.045,
    scaleMax: 0.2,
    gravity: -5.8,
  });
  visual.blood.trigger(impact, {
    speedMin: 1.7,
    speedMax: 4.4,
    riseMin: 0.12,
    riseMax: 2.5,
    lifeMin: 0.28,
    lifeMax: 0.96,
    scaleMin: 0.12,
    scaleMax: 0.46,
    gravity: -4.1,
  });
  visual.smoke.trigger(elevated(getDuelCorpsePosition(map, visual.state), 0.16), {
    speedMin: 0.25,
    speedMax: 1.25,
    riseMin: 0.35,
    riseMax: 1.45,
    lifeMin: 0.75,
    lifeMax: 1.9,
    scaleMin: 0.32,
    scaleMax: 1.18,
    gravity: 0.08,
  });
  visual.flarePulse = 1;
}

function createSimpleBurst(
  app: Application,
  name: string,
  particleMaterial: StandardMaterial,
  count: number,
): SimpleBurst {
  const particles: BurstParticle[] = [];
  for (let index = 0; index < count; index += 1) {
    const entity = addParticlePrimitive(app, app.root, `${name}-${index}`, "sphere", particleMaterial);
    entity.enabled = false;
    particles.push({
      entity,
      velocity: new Vec3(),
      life: 1,
      age: 1,
      baseScale: 0.1,
      spin: new Vec3(),
      gravity: -3,
    });
  }

  let origin = new Vec3();
  let burstSeed = 0;

  return {
    trigger(position: Vec3, config: BurstConfig) {
      origin = position.clone();
      burstSeed += 1;
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]!;
        const angle = seeded(index, burstSeed) * Math.PI * 2;
        const radialSpeed = config.speedMin + seeded(index + 13, burstSeed) * (config.speedMax - config.speedMin);
        particle.velocity.set(
          Math.cos(angle) * radialSpeed,
          config.riseMin + seeded(index + 29, burstSeed) * (config.riseMax - config.riseMin),
          Math.sin(angle) * radialSpeed,
        );
        particle.life = config.lifeMin + seeded(index + 43, burstSeed) * (config.lifeMax - config.lifeMin);
        particle.age = -seeded(index + 59, burstSeed) * 0.06;
        particle.baseScale = config.scaleMin + seeded(index + 71, burstSeed) * (config.scaleMax - config.scaleMin);
        particle.gravity = config.gravity;
        particle.spin.set(
          -260 + seeded(index + 83, burstSeed) * 520,
          -260 + seeded(index + 97, burstSeed) * 520,
          -260 + seeded(index + 109, burstSeed) * 520,
        );
        particle.entity.enabled = true;
        particle.entity.setPosition(origin);
      }
    },
    update(dt: number) {
      for (const particle of particles) {
        if (!particle.entity.enabled) continue;
        particle.age += dt;
        if (particle.age >= particle.life) {
          particle.entity.enabled = false;
          continue;
        }
        if (particle.age < 0) continue;
        const t = particle.age / particle.life;
        particle.entity.setPosition(
          origin.x + particle.velocity.x * particle.age,
          origin.y + particle.velocity.y * particle.age + particle.gravity * particle.age * particle.age * 0.5,
          origin.z + particle.velocity.z * particle.age,
        );
        const scale = particle.baseScale * (0.35 + (1 - t) * 1.45);
        particle.entity.setLocalScale(scale, scale, scale);
        particle.entity.rotateLocal(particle.spin.x * dt, particle.spin.y * dt, particle.spin.z * dt);
      }
    },
  };
}

type MistParticle = {
  entity: Entity;
  velocity: Vec3;
  life: number;
  age: number;
  baseScale: number;
  spin: Vec3;
};

function createMist(app: Application, mistMaterial: StandardMaterial) {
  const particles: MistParticle[] = [];
  for (let index = 0; index < 120; index += 1) {
    const entity = addPrimitive(app, app.root, `mist-${index}`, "sphere", mistMaterial);
    entity.enabled = false;
    particles.push({
      entity,
      velocity: new Vec3(),
      life: 1,
      age: 1,
      baseScale: 0.1,
      spin: new Vec3(),
    });
  }

  let origin = new Vec3();
  let burstSeed = 0;

  return {
    trigger(position: Vec3) {
      origin = position.clone();
      burstSeed += 1;
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]!;
        const angle = seeded(index, burstSeed) * Math.PI * 2;
        const radiusNoise = seeded(index + 17, burstSeed);
        const speed = 2.2 + radiusNoise * 4.3;
        particle.velocity.set(
          Math.cos(angle) * speed,
          0.65 + seeded(index + 29, burstSeed) * 3.7,
          Math.sin(angle) * speed,
        );
        particle.life = 1.1 + seeded(index + 43, burstSeed) * 1.7;
        particle.age = -seeded(index + 59, burstSeed) * 0.12;
        particle.baseScale = 0.18 + seeded(index + 71, burstSeed) * 0.46;
        particle.spin.set(
          -220 + seeded(index + 83, burstSeed) * 440,
          -220 + seeded(index + 97, burstSeed) * 440,
          -220 + seeded(index + 109, burstSeed) * 440,
        );
        particle.entity.enabled = true;
        particle.entity.setPosition(origin);
      }
    },
    update(dt: number) {
      for (const particle of particles) {
        if (!particle.entity.enabled) continue;
        particle.age += dt;
        if (particle.age >= particle.life) {
          particle.entity.enabled = false;
          continue;
        }
        if (particle.age < 0) continue;
        const t = particle.age / particle.life;
        const fall = -2.8 * particle.age * particle.age;
        particle.entity.setPosition(
          origin.x + particle.velocity.x * particle.age,
          origin.y + particle.velocity.y * particle.age + fall,
          origin.z + particle.velocity.z * particle.age,
        );
        const fadeScale = particle.baseScale * (0.25 + (1 - t) * 1.65);
        particle.entity.setLocalScale(fadeScale, fadeScale, fadeScale);
        particle.entity.rotateLocal(particle.spin.x * dt, particle.spin.y * dt, particle.spin.z * dt);
      }
    },
  };
}

class OrbitRig {
  readonly camera: Entity;
  private readonly canvas: HTMLCanvasElement;
  private readonly target = new Vec3();
  private readonly anchor = new Vec3();
  private readonly temp = new Vec3();
  private yaw = -0.68;
  private pitch = 0.54;
  private radius = 21;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private followLocked = true;
  private punch = 0;
  private radiusPull = 0;

  constructor(camera: Entity, canvas: HTMLCanvasElement, initialTarget: Vec3) {
    this.camera = camera;
    this.canvas = canvas;
    this.target.copy(initialTarget);
    this.anchor.copy(initialTarget);
    this.attachInput();
    this.update(0);
  }

  updateAnchor(position: Vec3): void {
    this.anchor.copy(position);
  }

  setFollowLocked(locked: boolean): void {
    this.followLocked = locked;
    if (!locked) {
      this.target.copy(this.anchor);
    }
  }

  isFollowLocked(): boolean {
    return this.followLocked;
  }

  setPunch(pulse: number, radiusPull: number): void {
    this.punch = clamp(pulse, 0, 1);
    this.radiusPull = Math.max(0, radiusPull);
  }

  update(dt: number): void {
    if (this.followLocked) {
      this.temp.lerp(this.target, this.anchor, clamp(dt * 5.5, 0, 1));
      this.target.copy(this.temp);
    }

    const currentRadius = clamp(this.radius - this.radiusPull, 7, 34);
    const horizontal = Math.cos(this.pitch) * currentRadius;
    const position = new Vec3(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * currentRadius + this.punch * 0.18,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.setPosition(position);
    this.camera.lookAt(this.target);
  }

  private attachInput(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.yaw -= dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.0045, 0.28, 1.24);
    });

    this.canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(event.pointerId);
    });

    this.canvas.addEventListener("pointercancel", () => {
      this.dragging = false;
    });

    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.radius = clamp(this.radius + event.deltaY * 0.018, 7, 34);
      },
      { passive: false },
    );
  }
}

function getTargetPosition(
  snapshot: ReplaySnapshot,
  sample: SnapshotSample,
  virtualTurn: number,
  fallback: Tile,
  duel: DuelState | null,
): Vec3 {
  if (
    duel &&
    virtualTurn >= duel.startTurn - 0.28 &&
    virtualTurn <= duel.killTurn + 1.15
  ) {
    const winner = interpolateCharacterPosition(snapshot.map, sample, duel.winnerId);
    const loser = getDuelCorpsePosition(snapshot.map, duel);
    return centerVec3(winner, loser);
  }
  if (virtualTurn >= snapshot.moneyShot.landsAtTurn) {
    return toScenePosition(snapshot.map, fallback, 0.2);
  }
  const victim = sampleCharacter(sample, snapshot.moneyShot.victimId);
  if (!victim) return toScenePosition(snapshot.map, fallback, 0.2);
  return interpolateCharacterPosition(snapshot.map, sample, snapshot.moneyShot.victimId);
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
): Vec3 {
  const prev = sample.prev.characters.find((character) => character.characterId === characterId);
  const next = sample.next.characters.find((character) => character.characterId === characterId);
  const a = prev?.pos ?? next?.pos;
  const b = next?.pos ?? prev?.pos;
  if (!a || !b) return new Vec3();
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
    seconds: clamp(snapshot.moneyShot.loopSeconds ?? 14, 10, 35),
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

function resolveDuel(snapshot: ReplaySnapshot): DuelState | null {
  const duel = (snapshot as SnapshotWithDuel).duel;
  if (!duel) return null;

  const participants = Array.isArray(duel.participantIds)
    ? duel.participantIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  const first = participants[0];
  const second = participants[1];
  const attackerId = firstString(duel.attackerId, duel.killerId, duel.winnerId, first);
  const defenderId = firstString(duel.defenderId, duel.loserId, duel.victimId, second);
  const winnerId = firstString(duel.winnerId, duel.killerId, attackerId);
  const loserId = firstString(duel.loserId, duel.victimId, defenderId);
  if (!attackerId || !defenderId || !winnerId || !loserId || winnerId === loserId) {
    return null;
  }

  const firstTurn = snapshot.frames[0]?.turn ?? 0;
  const startTurn = finiteNumber(duel.startTurn) ? duel.startTurn : firstTurn + 1;
  const killTurn = finiteNumber(duel.killTurn)
    ? duel.killTurn
    : finiteNumber(duel.endTurn)
      ? duel.endTurn
      : startTurn + 2;
  const exchangeTurn = finiteNumber(duel.exchangeTurn)
    ? duel.exchangeTurn
    : startTurn + Math.max(0.4, (killTurn - startTurn) * 0.52);
  const endTurn = finiteNumber(duel.endTurn) ? duel.endTurn : killTurn;

  return {
    attackerId,
    defenderId,
    winnerId,
    loserId,
    startTurn,
    exchangeTurn,
    killTurn,
    endTurn,
    corpsePos: duel.corpseTile ?? findCorpsePosition(snapshot, loserId) ?? findCharacterTileAtTurn(snapshot, loserId, killTurn),
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

function addPrimitive(
  app: Application,
  parent: Entity,
  name: string,
  type: RenderPrimitive,
  renderMaterial: StandardMaterial,
): Entity {
  const entity = new Entity(name, app);
  entity.addComponent("render", {
    type,
    material: renderMaterial,
    castShadows: true,
    receiveShadows: true,
  });
  parent.addChild(entity);
  return entity;
}

function addParticlePrimitive(
  app: Application,
  parent: Entity,
  name: string,
  type: RenderPrimitive,
  renderMaterial: StandardMaterial,
): Entity {
  const entity = new Entity(name, app);
  entity.addComponent("render", {
    type,
    material: renderMaterial,
    castShadows: false,
    receiveShadows: false,
  });
  parent.addChild(entity);
  return entity;
}

function agentMaterial(name: string, accent: Color): StandardMaterial {
  return material(
    `agent-mat-${name}`,
    new Color(0.052, 0.058, 0.062),
    new Color(accent.r * 0.58, accent.g * 0.58, accent.b * 0.58),
    0.92,
    false,
    1.4,
  );
}

function accentMaterial(name: string, accent: Color): StandardMaterial {
  return material(
    name,
    new Color(accent.r * 0.24, accent.g * 0.24, accent.b * 0.24),
    accent,
    0.72,
    true,
    3.2,
  );
}

function getDuelCorpsePosition(map: MapDescriptor, duel: DuelState): Vec3 {
  return toScenePosition(map, duel.corpsePos ?? { x: map.size.w / 2, y: map.size.h / 2 }, 0);
}

function setTraceBeam(beam: Entity, start: Vec3, end: Vec3, pulse: number, width: number): void {
  if (pulse <= 0.02) {
    beam.enabled = false;
    return;
  }

  const length = distanceVec3(start, end);
  if (length <= 0.01) {
    beam.enabled = false;
    return;
  }

  beam.enabled = true;
  beam.setPosition(centerVec3(start, end));
  const flareWidth = width * (0.75 + pulse * 1.9);
  beam.setLocalScale(flareWidth, flareWidth, length);
  beam.lookAt(end);
}

function cameraShakeOffset(elapsed: number, pulse: number): Vec3 {
  if (pulse <= 0.01) return new Vec3();
  const strength = pulse * pulse;
  return new Vec3(
    Math.sin(elapsed * 71) * 0.1 * strength,
    Math.sin(elapsed * 93) * 0.045 * strength,
    Math.cos(elapsed * 83) * 0.1 * strength,
  );
}

function turnPulse(turn: number, center: number, width: number): number {
  return clamp(1 - Math.abs(turn - center) / Math.max(width, 0.001), 0, 1);
}

function elevated(position: Vec3, height: number): Vec3 {
  return new Vec3(position.x, position.y + height, position.z);
}

function centerVec3(a: Vec3, b: Vec3): Vec3 {
  return new Vec3((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return new Vec3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

function directionBetween(from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length <= 0.0001) return new Vec3();
  return new Vec3(dx / length, 0, dz / length);
}

function distanceVec3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function setLightIntensity(entity: Entity, intensity: number): void {
  if (entity.light) entity.light.intensity = intensity;
}

function toScenePosition(map: MapDescriptor, tile: Tile, y: number): Vec3 {
  return new Vec3(
    (tile.x - map.size.w / 2) * WORLD_SCALE,
    y,
    (tile.y - map.size.h / 2) * WORLD_SCALE,
  );
}

function seeded(index: number, salt: number): number {
  const raw = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
