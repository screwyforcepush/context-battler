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
  const loop = getLoop(snapshot);

  return {
    update(dt: number) {
      elapsed += dt;
      const loopTime = elapsed % loop.seconds;
      const virtualTurn = loop.startTurn + (loopTime / loop.seconds) * loop.turnSpan;
      const sample = sampleSnapshot(snapshot.frames, virtualTurn);

      updateCharacters(snapshot, characterVisuals, sample, virtualTurn, elapsed);
      updateAirdrop(snapshot.map, airdropVisual, drop, loop, virtualTurn, elapsed);

      const targetPosition = getTargetPosition(snapshot, sample, virtualTurn, drop.pos);
      targetPosition.y += 0.9;
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
  app.scene.ambientLight = new Color(0.075, 0.11, 0.13);
  app.scene.fog.type = FOG_EXP2;
  app.scene.fog.color = new Color(0.012, 0.015, 0.02);
  app.scene.fog.density = 0.018;
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
    color: new Color(1, 0.78, 0.55),
    intensity: 1.55,
    castShadows: true,
    shadowDistance: 34,
  });
  key.setEulerAngles(48, -38, 0);
  app.root.addChild(key);

  const rim = new Entity("cyan-rim-light", app);
  rim.addComponent("light", {
    type: "omni",
    color: new Color(0.0, 0.82, 0.9),
    intensity: 2.1,
    range: 28,
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
}

function createMaterials() {
  const ground = material(
    "ground",
    new Color(0.018, 0.02, 0.026),
    new Color(0.012, 0.048, 0.052),
  );
  const wall = material(
    "wall",
    new Color(0.038, 0.036, 0.046),
    new Color(0.01, 0.035, 0.045),
  );
  const cover = material(
    "cover",
    new Color(0.055, 0.05, 0.044),
    new Color(0.11, 0.06, 0.016),
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
  return { ground, wall, cover, grid, crate, airdrop, beam, red, shock, mist };
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
  }
  for (const rect of map.coverClusters ?? []) {
    addBlock(app, map, rect, 0.54, materials.cover);
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
    const visible =
      character.alive &&
      !vaporized &&
      (character.extractedAtTurn === null ||
        character.extractedAtTurn === undefined ||
        character.extractedAtTurn > virtualTurn);

    visual.root.enabled = visible;
    if (!visible) continue;

    const pos = interpolateCharacterPosition(snapshot.map, sample, characterId);
    pos.y += Math.sin(elapsed * 7 + pos.x) * 0.045;
    visual.root.setPosition(pos);
    visual.root.setEulerAngles(0, Math.sin(elapsed * 1.5 + pos.z) * 8, 0);
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

  update(dt: number): void {
    if (this.followLocked) {
      this.temp.lerp(this.target, this.anchor, clamp(dt * 5.5, 0, 1));
      this.target.copy(this.temp);
    }

    const horizontal = Math.cos(this.pitch) * this.radius;
    const position = new Vec3(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.radius,
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
): Vec3 {
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
