import { describe, expect, it } from "vitest";
import type { Doc, Id, TableNames } from "../../convex/_generated/dataModel.js";
import { getMapDescriptor, MAP_IDS, expandMap } from "../../convex/engine/map.js";
import type { ItemRef, MapDescriptor, PersonaId, Tile } from "../../convex/engine/types.js";
import { buildMatchSnapshot, summariseMatch } from "../../convex/replay/snapshot.js";
import type { ReplayBundle, ReplayWorldState } from "../../convex/replay/reconstruct.js";

const CHARACTER_IDS = ["char_alpha", "char_beta", "char_gamma"] as const;
const PERSONAS: PersonaId[] = ["rat", "duelist", "trader"];

type SnapshotMovement = {
  turn: number;
  characterId: string;
  fromTile: Tile;
  toTile: Tile;
  path: Tile[];
  blockedBy?: "wall";
  wallRectId?: string;
  bodyCollisionKind?: "character" | "wall";
};

type SnapshotAttack = {
  turn: number;
  attackerId: string;
  targetId: string;
  weapon: string | null;
  kind: "attack" | "overwatch" | "counter" | "bodyCollision";
  hit: boolean;
  lethal: boolean;
};

type SnapshotLoot = {
  turn: number;
  characterId: string;
  source: "crate" | "airdrop" | "corpse";
  sourceId: string;
  item: ItemRef;
  equipped: boolean;
};

type SnapshotV3 = Omit<ReturnType<typeof buildMatchSnapshot>, "schemaVersion"> & {
  schemaVersion: number;
  movements: SnapshotMovement[];
  attacks: SnapshotAttack[];
  loots: SnapshotLoot[];
};

type MoveTraceFixture = {
  characterId: string;
  from: Tile;
  to: Tile;
  path: Tile[];
  blockedBy?: "wall";
  slide?: {
    wallRectId: string;
    axis: "N" | "E" | "S" | "W";
    intent: string;
  };
  bodyCollision?:
    | { kind: "character"; defenderId: string }
    | { kind: "wall"; wallRectId: string };
};

type ActionTraceFixture = {
  characterId: string;
  kind: "attack" | "loot" | "overwatch" | "counter";
  target: string;
  result: string;
  weapon?: string;
  lootedItem?: string;
  triggeredByMovement?: boolean;
  discardedWeaker?: boolean;
};

function id<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

function tile(x: number, y: number): Tile {
  return { x, y };
}

function weapon(
  name: "rusty_blade" | "axe" | "greatsword",
): Extract<ItemRef, { category: "weapon" }> {
  return { category: "weapon", name };
}

function armour(name: "cloth" | "plate"): Extract<ItemRef, { category: "armour" }> {
  return { category: "armour", name };
}

function equipped(name: "rusty_blade" | "axe" | "greatsword") {
  return { weapon: weapon(name), armour: armour("cloth") };
}

function character(index: number, descriptor: MapDescriptor): Doc<"characters"> {
  const characterId = CHARACTER_IDS[index]!;
  return {
    _id: id<"characters">(characterId),
    _creationTime: index,
    matchId: id<"matches">("match_1"),
    personaId: PERSONAS[index]!,
    spawnIndex: index,
    displayName: ["Alpha", "Beta", "Gamma"][index]!,
    hp: index === 1 ? 0 : 50,
    pos: descriptor.spawns[index]!,
    equipped: equipped(index === 0 ? "greatsword" : "rusty_blade"),
    scratchpad: "",
    hidden: false,
    alive: index !== 1,
    diedAtTurn: index === 1 ? 3 : undefined,
    extractedAtTurn: undefined,
    lastKnown: [],
  } as unknown as Doc<"characters">;
}

function record(
  turn: number,
  characterId: string,
  status: { hp?: number; item?: "rusty_blade" | "axe" | "greatsword" } = {},
): Doc<"turns">["agentRecords"][number] {
  const hp = status.hp ?? 50;
  const item = status.item ?? "rusty_blade";
  return {
    characterId: id<"characters">(characterId),
    personaId: PERSONAS[CHARACTER_IDS.indexOf(characterId as typeof CHARACTER_IDS[number])] ?? "rat",
    input: {
      systemPromptHash: "system_hash",
      personaPromptHash: `${characterId}_persona_hash`,
      visibleStateDigest: "digest",
      scratchpadBefore: `before ${characterId} t${turn}`,
      status: {
        hp,
        pos: { x: 10 + turn, y: 20 + turn },
        equipped: equipped(item),
        insideEvac: false,
      },
      narrativeLines: [],
      aliveCount: 3,
    },
    decision: {
      use: null,
      position: { kind: "move", direction: { kind: "N" }, dist: 0 },
      action: { kind: "none" },
      say: turn === 2 && characterId === "char_alpha" ? "come closer" : null,
      scratchpad: null,
    },
    scratchpadAfter: `after ${characterId} t${turn}`,
    llm: {
      responseId: null,
      callId: null,
      rawArguments: null,
      usage: null,
      latencyMs: 1,
      httpStatus: null,
      fellBackToSafeDefault: false,
      reasoning: `reason ${characterId} t${turn}`,
    },
  } as unknown as Doc<"turns">["agentRecords"][number];
}

function turn(
  turnNumber: number,
  overrides: Partial<Doc<"turns">["resolution"]> = {},
  records: Doc<"turns">["agentRecords"] = CHARACTER_IDS.map((characterId) =>
    record(turnNumber, characterId),
  ),
): Doc<"turns"> {
  return {
    _id: id<"turns">(`turn_${turnNumber}`),
    _creationTime: turnNumber,
    matchId: id<"matches">("match_1"),
    turn: turnNumber,
    agentRecords: records,
    resolution: {
      consumed: [],
      speech: [],
      moves: [],
      actions: [],
      deaths: [],
      environmentalDeaths: [],
      visibilityUpdates: [],
      ...overrides,
    },
  } as unknown as Doc<"turns">;
}

function traceResolution({
  moves,
  actions,
  deaths,
  environmentalDeaths,
}: {
  moves?: MoveTraceFixture[];
  actions?: ActionTraceFixture[];
  deaths?: string[];
  environmentalDeaths?: string[];
}): Partial<Doc<"turns">["resolution"]> {
  const resolution: Partial<Doc<"turns">["resolution"]> = {};
  if (moves) {
    resolution.moves = moves as unknown as Doc<"turns">["resolution"]["moves"];
  }
  if (actions) {
    resolution.actions = actions as unknown as Doc<"turns">["resolution"]["actions"];
  }
  if (deaths) {
    resolution.deaths = deaths.map((characterId) => id<"characters">(characterId));
  }
  if (environmentalDeaths) {
    resolution.environmentalDeaths = environmentalDeaths.map((characterId) =>
      id<"characters">(characterId),
    );
  }
  return resolution;
}

function bundleWithTrace(
  turnNumber: number,
  trace: Parameters<typeof traceResolution>[0],
  worldPatch: Partial<ReplayWorldState> = {},
): ReplayBundle {
  const base = bundleForMap();
  base.turns = [turn(turnNumber, traceResolution(trace))];
  base.match = { ...base.match, turn: turnNumber } as Doc<"matches">;
  base.worldState = { ...base.worldState, ...worldPatch } as ReplayWorldState;
  return base;
}

function v3Snapshot(bundle: ReplayBundle = bundleForMap()): SnapshotV3 {
  return buildMatchSnapshot(bundle, getMapDescriptor("reference")) as unknown as SnapshotV3;
}

function snapshotWithTrace(
  turnNumber: number,
  trace: Parameters<typeof traceResolution>[0],
  worldPatch: Partial<ReplayWorldState> = {},
): SnapshotV3 {
  return v3Snapshot(bundleWithTrace(turnNumber, trace, worldPatch));
}

function attacksFor(snapshot: SnapshotV3, kind?: SnapshotAttack["kind"]): SnapshotAttack[] {
  return (snapshot.attacks ?? []).filter(
    (attack) => kind === undefined || attack.kind === kind,
  );
}

function attackFor(
  snapshot: SnapshotV3,
  attackerId: string,
  targetId: string,
  kind?: SnapshotAttack["kind"],
): SnapshotAttack | undefined {
  return attacksFor(snapshot, kind).find(
    (attack) => attack.attackerId === attackerId && attack.targetId === targetId,
  );
}

function bundleForMap(mapId = "reference"): ReplayBundle {
  const descriptor = getMapDescriptor(mapId);
  const world = expandMap(descriptor, "test-seed");
  const characters = CHARACTER_IDS.map((_, index) => character(index, descriptor));
  const turns: Doc<"turns">[] = [
    turn(1),
    turn(
      2,
      {
        speech: [
          {
            characterId: id<"characters">("char_alpha"),
            text: "come closer",
            heardBy: [id<"characters">("char_beta")],
          },
        ],
      },
    ),
    turn(
      3,
      {
        actions: [
          {
            characterId: id<"characters">("char_alpha"),
            kind: "attack",
            target: "Beta",
            result: "dmg 60",
            weapon: "greatsword",
          },
        ],
        deaths: [id<"characters">("char_beta")],
      },
      [
        record(3, "char_alpha", { item: "greatsword" }),
        record(3, "char_beta", { hp: 7, item: "axe" }),
        record(3, "char_gamma", { item: "rusty_blade" }),
      ],
    ),
    turn(4, {
      environmentalDeaths: [id<"characters">("char_gamma")],
    }),
    turn(5, {}, [record(5, "char_alpha", { item: "greatsword" })]),
    turn(6, {}, [record(6, "char_alpha", { item: "greatsword" })]),
    turn(7, {}, [record(7, "char_alpha", { item: "greatsword" })]),
  ];

  return {
    match: {
      _id: id<"matches">("match_1"),
      _creationTime: 0,
      status: "completed",
      turn: 7,
      startedAt: 100,
      completedAt: 200,
      mapId,
      rngSeed: "test-seed",
      outcome: {
        extracted: [id<"characters">("char_alpha")],
        pointsByCharacter: [
          { id: id<"characters">("char_alpha"), points: 100 },
          { id: id<"characters">("char_beta"), points: 0 },
        ],
      },
    } as unknown as Doc<"matches">,
    turns,
    characters,
    worldState: {
      _id: id<"worldState">("world_1"),
      _creationTime: 0,
      matchId: id<"matches">("match_1"),
      ...world,
    } as unknown as ReplayWorldState,
    promptsLookup: {
      system: { system_hash: "system prompt" },
      persona: {
        char_alpha_persona_hash: "alpha prompt",
        char_beta_persona_hash: "beta prompt",
        char_gamma_persona_hash: "gamma prompt",
      },
    },
  };
}

describe("buildMatchSnapshot", () => {
  it("conforms to the canonical timeline.frames container shape", () => {
    const snapshot = buildMatchSnapshot(bundleForMap(), getMapDescriptor("reference"));

    expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot).toHaveProperty("source");
    expect(snapshot).toHaveProperty("playback");
    expect(snapshot).toHaveProperty("map");
    expect(snapshot).toHaveProperty("characters");
    expect(snapshot).toHaveProperty("timeline.frames");
    expect(snapshot).toHaveProperty("movements");
    expect(snapshot).toHaveProperty("attacks");
    expect(snapshot).toHaveProperty("loots");
    expect(snapshot).toHaveProperty("killFeed");
    expect(snapshot).toHaveProperty("speechLog");
    expect(snapshot).toHaveProperty("agentTraces");
    expect(snapshot).toHaveProperty("outcome");
    expect(snapshot.timeline.frames).toHaveLength(7);
    expect(snapshot.timeline.frames[0]?.turn).toBe(1);
    expect(snapshot.timeline.frames.at(-1)?.turn).toBe(7);
  });

  it("attributes attack kills through the shared target alias lookup", () => {
    const snapshot = buildMatchSnapshot(bundleForMap(), getMapDescriptor("reference"));

    expect(snapshot.killFeed).toContainEqual(
      expect.objectContaining({
        turn: 3,
        victimId: "char_beta",
        killerId: "char_alpha",
        weapon: "greatsword",
        kind: "duel",
      }),
    );
  });

  it("attributes overwatch and counter damage actions, not only attacks", () => {
    const base = bundleForMap();
    base.turns = [
      turn(1, {
        actions: [
          {
            characterId: id<"characters">("char_alpha"),
            kind: "overwatch",
            target: "char_beta",
            result: "dmg 50",
          },
          {
            characterId: id<"characters">("char_gamma"),
            kind: "counter",
            target: "Alpha",
            result: "dmg 50",
          },
        ],
        deaths: [id<"characters">("char_beta"), id<"characters">("char_alpha")],
      }),
    ];
    base.match = { ...base.match, turn: 1 } as Doc<"matches">;

    const snapshot = buildMatchSnapshot(base, getMapDescriptor("reference"));

    expect(snapshot.killFeed).toContainEqual(
      expect.objectContaining({ victimId: "char_beta", killerId: "char_alpha" }),
    );
    expect(snapshot.killFeed).toContainEqual(
      expect.objectContaining({ victimId: "char_alpha", killerId: "char_gamma" }),
    );
  });

  it("projects environmental deaths without kill credit", () => {
    const snapshot = buildMatchSnapshot(bundleForMap(), getMapDescriptor("reference"));

    expect(snapshot.killFeed).toContainEqual(
      expect.objectContaining({
        turn: 4,
        victimId: "char_gamma",
        killerId: null,
        kind: "environmental",
      }),
    );
  });

  it("merges per-turn equipment and hp from agent input status", () => {
    const snapshot = buildMatchSnapshot(bundleForMap(), getMapDescriptor("reference"));
    const frame = snapshot.timeline.frames.find((candidate) => candidate.turn === 3);

    expect(frame?.equippedByCharacter.char_beta?.weapon?.name).toBe("axe");
    expect(frame?.hpByCharacter.char_beta).toBe(7);
  });

  it("carries dead characters' last-seen equipment and hp forward", () => {
    const snapshot = buildMatchSnapshot(bundleForMap(), getMapDescriptor("reference"));
    const frame = snapshot.timeline.frames.find((candidate) => candidate.turn === 7);

    expect(frame?.equippedByCharacter.char_beta?.weapon?.name).toBe("axe");
    expect(frame?.hpByCharacter.char_beta).toBe(7);
  });

  it("propagates outcome fields and coerces absent lastSurvivor to null", () => {
    const base = bundleForMap();
    const withoutSurvivor = buildMatchSnapshot(base, getMapDescriptor("reference"));
    const withSurvivor = buildMatchSnapshot(
      {
        ...base,
        match: {
          ...base.match,
          outcome: {
            ...base.match.outcome,
            lastSurvivor: id<"characters">("char_alpha"),
          },
        } as Doc<"matches">,
      },
      getMapDescriptor("reference"),
    );

    expect(withoutSurvivor.outcome.extracted).toEqual(["char_alpha"]);
    expect(withoutSurvivor.outcome.lastSurvivor).toBeNull();
    expect(withoutSurvivor.outcome.pointsByCharacter[0]).toEqual({
      id: "char_alpha",
      points: 100,
    });
    expect(withSurvivor.outcome.lastSurvivor).toBe("char_alpha");
  });

  it.each(MAP_IDS)("projects map geometry for %s", (mapId) => {
    const descriptor = getMapDescriptor(mapId);
    const snapshot = buildMatchSnapshot(bundleForMap(mapId), descriptor);

    expect(snapshot.map.walls).toHaveLength(descriptor.walls.length);
    expect(snapshot.map.coverClusters).toHaveLength(descriptor.coverClusters.length);
    expect(snapshot.map.evac.zone).toEqual({
      x: descriptor.evac.x - 1,
      y: descriptor.evac.y - 1,
      w: 3,
      h: 3,
    });
  });

  it("WP1-01 movements[] emits one event per move in a multi-move turn", () => {
    const alphaPath = [tile(1, 1), tile(2, 1), tile(3, 1)];
    const betaPath = [tile(5, 5), tile(5, 6)];
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from: alphaPath[0]!,
          to: alphaPath.at(-1)!,
          path: alphaPath,
        },
        {
          characterId: "char_beta",
          from: betaPath[0]!,
          to: betaPath.at(-1)!,
          path: betaPath,
        },
      ],
    });

    expect(snapshot.movements ?? []).toHaveLength(2);
    expect(snapshot.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          turn: 1,
          characterId: "char_alpha",
          fromTile: alphaPath[0],
          toTile: alphaPath.at(-1),
          path: alphaPath,
        }),
        expect.objectContaining({
          turn: 1,
          characterId: "char_beta",
          fromTile: betaPath[0],
          toTile: betaPath.at(-1),
          path: betaPath,
        }),
      ]),
    );
  });

  it("WP1-02 movements[] preserves the exact wall-slide waypoint path", () => {
    const slidePath = [tile(8, 8), tile(9, 8), tile(9, 9)];
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from: slidePath[0]!,
          to: slidePath.at(-1)!,
          path: slidePath,
          slide: { wallRectId: "Wall_9_9", axis: "E", intent: "SE" },
        },
      ],
    });

    const movement = (snapshot.movements ?? []).find(
      (candidate) => candidate.characterId === "char_alpha",
    );
    expect(movement).toEqual(
      expect.objectContaining({
        fromTile: slidePath[0],
        toTile: slidePath.at(-1),
        path: slidePath,
      }),
    );
  });

  it("WP1-03 movements[] marks wall-blocked face-slams with wall bodyCollision data", () => {
    const from = tile(6, 5);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          blockedBy: "wall",
          bodyCollision: { kind: "wall", wallRectId: "Wall_6_5" },
        },
      ],
    });

    const movement = (snapshot.movements ?? []).find(
      (candidate) => candidate.characterId === "char_alpha",
    );
    expect(movement).toEqual(
      expect.objectContaining({
        fromTile: from,
        toTile: from,
        path: [from],
        blockedBy: "wall",
        wallRectId: "Wall_6_5",
        bodyCollisionKind: "wall",
      }),
    );
  });

  it("WP1-04 movements[] marks character-collision charges without wallRectId", () => {
    const from = tile(4, 4);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          bodyCollision: { kind: "character", defenderId: "char_beta" },
        },
      ],
    });

    const movement = (snapshot.movements ?? []).find(
      (candidate) => candidate.characterId === "char_alpha",
    );
    expect(movement).toEqual(
      expect.objectContaining({
        fromTile: from,
        toTile: from,
        path: [from],
        bodyCollisionKind: "character",
      }),
    );
    expect(movement).not.toHaveProperty("wallRectId");
  });

  it("WP1-05 attacks[] records a non-lethal weapon attack hit", () => {
    const snapshot = snapshotWithTrace(1, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "attack",
          target: "char_beta",
          result: "dmg 10",
          weapon: "axe",
        },
      ],
    });

    expect(attackFor(snapshot, "char_alpha", "char_beta", "attack")).toEqual(
      expect.objectContaining({
        turn: 1,
        weapon: "axe",
        hit: true,
        lethal: false,
      }),
    );
  });

  it("WP1-06 attacks[] marks a lethal weapon attack", () => {
    const snapshot = snapshotWithTrace(1, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "attack",
          target: "char_beta",
          result: "dmg 60",
          weapon: "greatsword",
        },
      ],
      deaths: ["char_beta"],
    });

    expect(attackFor(snapshot, "char_alpha", "char_beta", "attack")).toEqual(
      expect.objectContaining({
        weapon: "greatsword",
        hit: true,
        lethal: true,
      }),
    );
  });

  it("WP1-07 attacks[] gives multi-attacker lethal credit to one deterministic winner", () => {
    const snapshot = snapshotWithTrace(1, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "attack",
          target: "char_beta",
          result: "dmg 35",
          weapon: "axe",
        },
        {
          characterId: "char_gamma",
          kind: "attack",
          target: "char_beta",
          result: "dmg 35",
          weapon: "greatsword",
        },
      ],
      deaths: ["char_beta"],
    });

    const betaAttacks = (snapshot.attacks ?? []).filter(
      (attack) => attack.targetId === "char_beta",
    );
    expect(betaAttacks).toHaveLength(2);
    expect(betaAttacks.filter((attack) => attack.lethal)).toEqual([
      expect.objectContaining({ attackerId: "char_alpha" }),
    ]);
  });

  it("WP1-08 attacks[] records overwatch hits", () => {
    const snapshot = snapshotWithTrace(1, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "overwatch",
          target: "char_beta",
          result: "dmg 10",
          triggeredByMovement: true,
        },
      ],
    });

    expect(attackFor(snapshot, "char_alpha", "char_beta", "overwatch")).toEqual(
      expect.objectContaining({
        kind: "overwatch",
        hit: true,
        lethal: false,
      }),
    );
  });

  it("WP1-09 attacks[] records counter hits", () => {
    const snapshot = snapshotWithTrace(1, {
      actions: [
        {
          characterId: "char_beta",
          kind: "counter",
          target: "char_alpha",
          result: "dmg 10",
        },
      ],
    });

    expect(attackFor(snapshot, "char_beta", "char_alpha", "counter")).toEqual(
      expect.objectContaining({
        kind: "counter",
        hit: true,
        lethal: false,
      }),
    );
  });

  it("WP1-10 attacks[] records out-of-range counters as non-hit non-lethal events", () => {
    const snapshot = snapshotWithTrace(1, {
      actions: [
        {
          characterId: "char_beta",
          kind: "counter",
          target: "char_alpha",
          result: "out_of_range",
        },
      ],
    });

    expect(attackFor(snapshot, "char_beta", "char_alpha", "counter")).toEqual(
      expect.objectContaining({
        kind: "counter",
        hit: false,
        lethal: false,
      }),
    );
  });

  it("WP1-11 attacks[] emits null weapon for unarmed regular attacks", () => {
    const snapshot = snapshotWithTrace(1, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "attack",
          target: "char_beta",
          result: "dmg 5",
        },
      ],
    });

    expect(attackFor(snapshot, "char_alpha", "char_beta", "attack")).toEqual(
      expect.objectContaining({
        weapon: null,
        hit: true,
        lethal: false,
      }),
    );
  });

  it("WP1-12 attacks[] emits exactly two bodyCollision events for one character pair", () => {
    const from = tile(4, 4);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          bodyCollision: { kind: "character", defenderId: "char_beta" },
        },
      ],
    });

    const collisions = attacksFor(snapshot, "bodyCollision");
    expect(collisions).toHaveLength(2);
    expect(collisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attackerId: "char_alpha",
          targetId: "char_beta",
          weapon: null,
          hit: true,
          lethal: false,
        }),
        expect.objectContaining({
          attackerId: "char_beta",
          targetId: "char_alpha",
          weapon: null,
          hit: true,
          lethal: false,
        }),
      ]),
    );
  });

  it("WP1-13 attacks[] dedupes bilateral bodyCollision moves to exactly two events", () => {
    const alphaFrom = tile(4, 4);
    const betaFrom = tile(5, 4);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from: alphaFrom,
          to: alphaFrom,
          path: [alphaFrom],
          bodyCollision: { kind: "character", defenderId: "char_beta" },
        },
        {
          characterId: "char_beta",
          from: betaFrom,
          to: betaFrom,
          path: [betaFrom],
          bodyCollision: { kind: "character", defenderId: "char_alpha" },
        },
      ],
    });

    const collisions = attacksFor(snapshot, "bodyCollision");
    expect(collisions).toHaveLength(2);
    expect(new Set(collisions.map((attack) => `${attack.attackerId}->${attack.targetId}`))).toEqual(
      new Set(["char_alpha->char_beta", "char_beta->char_alpha"]),
    );
  });

  it("WP1-14 attacks[] marks the charging mover side lethal for bodyCollision kills", () => {
    const from = tile(4, 4);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          bodyCollision: { kind: "character", defenderId: "char_beta" },
        },
      ],
      deaths: ["char_beta"],
    });

    expect(attackFor(snapshot, "char_alpha", "char_beta", "bodyCollision")).toEqual(
      expect.objectContaining({ lethal: true }),
    );
    expect(attackFor(snapshot, "char_beta", "char_alpha", "bodyCollision")).toEqual(
      expect.objectContaining({ lethal: false }),
    );
  });

  it("WP1-15 attacks[] marks both bodyCollision directions lethal for mutual deaths", () => {
    const from = tile(4, 4);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          bodyCollision: { kind: "character", defenderId: "char_beta" },
        },
      ],
      deaths: ["char_alpha", "char_beta"],
    });

    expect(attackFor(snapshot, "char_alpha", "char_beta", "bodyCollision")).toEqual(
      expect.objectContaining({ lethal: true }),
    );
    expect(attackFor(snapshot, "char_beta", "char_alpha", "bodyCollision")).toEqual(
      expect.objectContaining({ lethal: true }),
    );
  });

  it("WP1-16 attacks[] emits no attack for wall-bonk bodyCollision moves", () => {
    const from = tile(6, 5);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          blockedBy: "wall",
          bodyCollision: { kind: "wall", wallRectId: "Wall_6_5" },
        },
      ],
    });

    expect(snapshot.attacks).toEqual([]);
  });

  it("WP1-17 loots[] records successful crate pickups", () => {
    const crate = {
      id: "Crate_10_10",
      pos: tile(10, 10),
      contents: weapon("axe"),
      opened: false,
    };
    const snapshot = snapshotWithTrace(
      2,
      {
        actions: [
          {
            characterId: "char_alpha",
            kind: "loot",
            target: crate.id,
            result: "opened",
            lootedItem: "axe",
          },
        ],
      },
      { crates: [crate], airdrops: [], corpses: [] },
    );

    expect(snapshot.loots).toEqual([
      {
        turn: 2,
        characterId: "char_alpha",
        source: "crate",
        sourceId: "Crate_10_10",
        item: weapon("axe"),
        equipped: true,
      },
    ]);
  });

  it("WP1-18 loots[] records successful airdrop pickups using the airdrop source", () => {
    const drop = {
      id: "Crate_20_20",
      pos: tile(20, 20),
      landsAtTurn: 1,
      contents: armour("plate"),
      looted: false,
    };
    const snapshot = snapshotWithTrace(
      3,
      {
        actions: [
          {
            characterId: "char_alpha",
            kind: "loot",
            target: drop.id,
            result: "opened",
            lootedItem: "plate",
          },
        ],
      },
      { crates: [], airdrops: [drop], corpses: [] },
    );

    expect(snapshot.loots).toEqual([
      {
        turn: 3,
        characterId: "char_alpha",
        source: "airdrop",
        sourceId: "Crate_20_20",
        item: armour("plate"),
        equipped: true,
      },
    ]);
  });

  it("WP1-19 loots[] records successful corpse pickups with corpse character id", () => {
    const corpse = {
      characterId: id<"characters">("char_beta"),
      pos: tile(5, 5),
      contents: { weapon: weapon("axe") },
    };
    const snapshot = snapshotWithTrace(
      2,
      {
        actions: [
          {
            characterId: "char_alpha",
            kind: "loot",
            target: "Corpse_char_beta",
            result: "looted",
            lootedItem: "axe",
          },
        ],
      },
      { corpses: [corpse] },
    );

    expect(snapshot.loots).toEqual([
      {
        turn: 2,
        characterId: "char_alpha",
        source: "corpse",
        sourceId: "char_beta",
        item: weapon("axe"),
        equipped: true,
      },
    ]);
  });

  it("WP1-20 loots[] marks discarded weaker pickups as not equipped", () => {
    const crate = {
      id: "Crate_11_11",
      pos: tile(11, 11),
      contents: weapon("rusty_blade"),
      opened: false,
    };
    const snapshot = snapshotWithTrace(
      2,
      {
        actions: [
          {
            characterId: "char_alpha",
            kind: "loot",
            target: crate.id,
            result: "opened",
            lootedItem: "rusty_blade",
            discardedWeaker: true,
          },
        ],
      },
      { crates: [crate], airdrops: [], corpses: [] },
    );

    expect(snapshot.loots).toEqual([
      {
        turn: 2,
        characterId: "char_alpha",
        source: "crate",
        sourceId: "Crate_11_11",
        item: weapon("rusty_blade"),
        equipped: false,
      },
    ]);
  });

  it("WP1-21 loots[] emits no event for drained corpse attempts", () => {
    const snapshot = snapshotWithTrace(2, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "loot",
          target: "Corpse_char_beta",
          result: "empty",
        },
      ],
    });

    expect(snapshot.loots).toEqual([]);
  });

  it("WP1-22 loots[] emits no event for empty or already-opened crates", () => {
    const snapshot = snapshotWithTrace(2, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "loot",
          target: "Crate_12_12",
          result: "empty",
        },
        {
          characterId: "char_beta",
          kind: "loot",
          target: "Crate_12_12",
          result: "already_opened",
        },
      ],
    });

    expect(snapshot.loots).toEqual([]);
  });

  it("WP1-23 loots[] emits no event for out-of-range loot attempts", () => {
    const snapshot = snapshotWithTrace(2, {
      actions: [
        {
          characterId: "char_alpha",
          kind: "loot",
          target: "Crate_12_12",
          result: "out_of_range",
        },
      ],
    });

    expect(snapshot.loots).toEqual([]);
  });

  it("WP1-24 killFeed credits bodyCollision duel deaths to the charging mover display name", () => {
    const from = tile(4, 4);
    const snapshot = snapshotWithTrace(1, {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          bodyCollision: { kind: "character", defenderId: "char_beta" },
        },
      ],
      deaths: ["char_beta"],
    });

    const killLine = snapshot.killFeed.find(
      (entry) => entry.turn === 1 && entry.victimId === "char_beta",
    );
    expect(killLine).toEqual(
      expect.objectContaining({
        killerId: "char_alpha",
        weapon: null,
        kind: "duel",
      }),
    );
    expect(killLine?.text).toContain("Alpha killed Beta");
    expect(killLine?.text).not.toContain("Unknown");
  });

  it("WP1-25 killFeed credits charger-only bodyCollision deaths to the surviving defender", () => {
    const from = tile(4, 4);
    const trace = {
      moves: [
        {
          characterId: "char_alpha",
          from,
          to: from,
          path: [from],
          bodyCollision: { kind: "character", defenderId: "char_beta" },
        },
      ],
      deaths: ["char_alpha"],
    } satisfies Parameters<typeof traceResolution>[0];
    const bundle = bundleWithTrace(1, trace);
    bundle.turns = [
      turn(1, traceResolution(trace), [
        record(1, "char_alpha", { hp: 1 }),
        record(1, "char_beta", { hp: 50 }),
        record(1, "char_gamma", { hp: 50 }),
      ]),
    ];
    const snapshot = v3Snapshot(bundle);

    expect(attackFor(snapshot, "char_beta", "char_alpha", "bodyCollision")).toEqual(
      expect.objectContaining({ lethal: true }),
    );
    expect(attackFor(snapshot, "char_alpha", "char_beta", "bodyCollision")).toEqual(
      expect.objectContaining({ lethal: false }),
    );

    const killLine = snapshot.killFeed.find(
      (entry) => entry.turn === 1 && entry.victimId === "char_alpha",
    );
    expect(killLine).toEqual(
      expect.objectContaining({
        killerId: "char_beta",
        weapon: null,
        kind: "duel",
      }),
    );
    expect(killLine?.text).toContain("Beta killed Alpha");
    expect(killLine?.text).not.toContain("Unknown");
  });
});

describe("summariseMatch", () => {
  it("keeps character ids joined into the completed-match summary", () => {
    const bundle = bundleForMap();
    const summary = summariseMatch({
      match: bundle.match,
      characters: bundle.characters,
    });

    expect(summary.characterIds).toEqual(CHARACTER_IDS);
    expect(summary.characterIds).toHaveLength(summary.characterCount);
    expect(summary.completedAt).toBe(200);
  });
});
