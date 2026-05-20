import { describe, expect, it } from "vitest";
import type { Doc, Id, TableNames } from "../../convex/_generated/dataModel.js";
import { getMapDescriptor, MAP_IDS, expandMap } from "../../convex/engine/map.js";
import type { ItemRef, MapDescriptor, PersonaId } from "../../convex/engine/types.js";
import { buildMatchSnapshot, summariseMatch } from "../../convex/replay/snapshot.js";
import type { ReplayBundle, ReplayWorldState } from "../../convex/replay/reconstruct.js";

const CHARACTER_IDS = ["char_alpha", "char_beta", "char_gamma"] as const;
const PERSONAS: PersonaId[] = ["rat", "duelist", "trader"];

function id<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

function weapon(name: "rusty_blade" | "axe" | "greatsword"): ItemRef {
  return { category: "weapon", name };
}

function armour(name: "cloth" | "plate"): ItemRef {
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

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot).toHaveProperty("source");
    expect(snapshot).toHaveProperty("playback");
    expect(snapshot).toHaveProperty("map");
    expect(snapshot).toHaveProperty("characters");
    expect(snapshot).toHaveProperty("timeline.frames");
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
