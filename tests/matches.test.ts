import { describe, expect, it } from "vitest";

import {
  start,
  startFromCards,
} from "../convex/matches.js";
import { hashHex } from "../convex/engine/hash.js";
import { makeRng } from "../convex/engine/loot.js";
import {
  assignPersonasToSpawns,
  expandMap,
  getMapDescriptor,
} from "../convex/engine/map.js";
import {
  CHARACTER_MAX_HP,
  PERSONA_IDS,
  type MapDescriptor,
  type PersonaId,
  type Tile,
  type Wall,
} from "../convex/engine/types.js";
import referenceMapJson from "../maps/reference.json" with { type: "json" };

type TableName =
  | "cards"
  | "characters"
  | "matches"
  | "prompts"
  | "worldState"
  | "worldStatic";

type Row = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

type QueryFilter = {
  field: string;
  value: unknown;
};

class FakeDb {
  private seq = 0;
  readonly tables: Record<TableName, Row[]> = {
    cards: [],
    characters: [],
    matches: [],
    prompts: [],
    worldState: [],
    worldStatic: [],
  };
  readonly patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  query(table: TableName) {
    return new FakeQuery(this, table);
  }

  async insert(table: TableName, value: Record<string, unknown>) {
    this.seq += 1;
    const row = {
      _id: `${table}_${this.seq}`,
      _creationTime: this.seq,
      ...value,
    };
    this.tables[table].push(row);
    return row._id;
  }

  async get(id: string) {
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }

  async patch(id: string, patch: Record<string, unknown>) {
    const row = await this.get(id);
    if (!row) throw new Error(`missing row ${id}`);
    this.patches.push({ id, patch });
    Object.assign(row, patch);
  }
}

class FakeQuery {
  constructor(
    private readonly db: FakeDb,
    private readonly table: TableName,
    private readonly filters: QueryFilter[] = [],
  ) {}

  withIndex(
    _indexName: string,
    cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ) {
    const filters: QueryFilter[] = [];
    const q = {
      eq(field: string, value: unknown) {
        filters.push({ field, value });
        return q;
      },
    };
    cb(q);
    return new FakeQuery(this.db, this.table, [...this.filters, ...filters]);
  }

  async collect() {
    return this.db.tables[this.table].filter((row) =>
      this.filters.every((filter) => row[filter.field] === filter.value),
    );
  }

  async unique() {
    const rows = await this.collect();
    if (rows.length > 1) {
      throw new Error(`expected unique row, found ${rows.length}`);
    }
    return rows[0] ?? null;
  }
}

class FakeScheduler {
  readonly calls: Array<{ delayMs: number; fn: unknown; args: unknown }> = [];

  async runAfter(delayMs: number, fn: unknown, args: unknown) {
    this.calls.push({ delayMs, fn, args });
  }
}

function fakeCtx() {
  return { db: new FakeDb(), scheduler: new FakeScheduler() };
}

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as { _handler: (ctx: ReturnType<typeof fakeCtx>, args: TArgs) => Promise<TResult> })
    ._handler;
}

const startHandler = handler<
  {
    rngSeed?: string;
    reasoningEffort?: "low" | "medium" | "high";
    mapId?: string;
  },
  string
>(start);
const startFromCardsHandler = handler<
  {
    cardIds: string[];
    rngSeed?: string;
    reasoningEffort?: "low" | "medium" | "high";
    mapId?: string;
  },
  string
>(startFromCards);

const CARD_NAMES = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Gamma",
  "Helix",
] as const;

function insertPrompt(ctx: ReturnType<typeof fakeCtx>, text: string) {
  return ctx.db.insert("prompts", {
    hash: hashHex(text),
    kind: "persona",
    text,
  });
}

async function insertCard(
  ctx: ReturnType<typeof fakeCtx>,
  args: {
    cardId?: string;
    agentName: string;
    promptText: string;
    lineagePersonaId: PersonaId;
  },
) {
  await insertPrompt(ctx, args.promptText);
  const cardId = await ctx.db.insert("cards", {
    agentName: args.agentName,
    promptHash: hashHex(args.promptText),
    lineagePersonaId: args.lineagePersonaId,
    progression: { level: 1, xp: 0 },
    prizeUnitsWon: 0,
    matchesPlayed: 0,
    kills: 0,
    deaths: 0,
    wallFaceSlams: 0,
    isPreset: false,
    createdAt: 100,
  });
  if (args.cardId !== undefined) {
    const row = await ctx.db.get(cardId);
    if (!row) throw new Error(`inserted card missing: ${cardId}`);
    row._id = args.cardId;
    return args.cardId;
  }
  return cardId;
}

async function seedCards(
  ctx: ReturnType<typeof fakeCtx>,
  overrides: Partial<Record<number, { agentName?: string; lineagePersonaId?: PersonaId }>> = {},
) {
  const cardIds: string[] = [];
  for (let index = 0; index < 8; index++) {
    cardIds.push(
      await insertCard(ctx, {
        cardId: `card_${index}`,
        agentName: overrides[index]?.agentName ?? CARD_NAMES[index]!,
        promptText: `prompt ${index}`,
        lineagePersonaId:
          overrides[index]?.lineagePersonaId ?? PERSONA_IDS[index]!,
      }),
    );
  }
  return cardIds;
}

function rows(ctx: ReturnType<typeof fakeCtx>, table: TableName) {
  return ctx.db.tables[table];
}

function rowWithoutMetadata(row: Row | undefined) {
  if (!row) throw new Error("expected row");
  const { _id, _creationTime, matchId: _matchId, ...rest } = row;
  return rest;
}

function characters(ctx: ReturnType<typeof fakeCtx>) {
  return rows(ctx, "characters");
}

function cardSnapshot(ctx: ReturnType<typeof fakeCtx>) {
  return rows(ctx, "cards").map((row) => ({ ...row }));
}

async function expectRejectsWithMessage(
  promise: Promise<unknown>,
  message: string,
) {
  await expect(promise).rejects.toThrow(message);
}

function expectedWorldRows(descriptor: MapDescriptor, rngSeed: string) {
  const world = expandMap(descriptor, rngSeed);
  return {
    worldStatic: {
      walls: world.walls,
      coverClusters: world.coverClusters,
      coverTiles: world.coverTiles,
    },
    worldState: {
      crates: world.crates.map((crate) => ({
        id: crate.id,
        pos: crate.pos,
        contents: crate.contents,
        opened: crate.opened,
      })),
      airdrops: world.airdrops.map((drop) => ({
        id: drop.id,
        pos: drop.pos,
        landsAtTurn: drop.landsAtTurn,
        contents: drop.contents,
        looted: drop.looted,
      })),
      corpses: [],
      evac: {
        centre: world.evac.centre,
        revealedAtTurn: world.evac.revealedAtTurn,
      },
    },
    characters: assignPersonasToSpawns(rngSeed, PERSONA_IDS).map(
      ({ personaId, spawnIndex }) => {
        const spawn = descriptor.spawns[spawnIndex];
        if (!spawn) {
          throw new Error(`missing spawn ${spawnIndex} in reference descriptor`);
        }
        return {
          personaId,
          spawnIndex,
          displayName: personaId.slice(0, 1).toUpperCase() + personaId.slice(1),
          hp: CHARACTER_MAX_HP,
          pos: { x: spawn.x, y: spawn.y },
          equipped: {},
          scratchpad: "",
          hidden: false,
          alive: true,
          lastKnown: [],
        };
      },
    ),
  };
}

function expectedReferenceWorldRows(rngSeed: string) {
  return legacyReferenceWorldRows(rngSeed);
}

type RawMapDescriptor = MapDescriptor & { _comment?: string };

function legacyReferenceDescriptor(): MapDescriptor {
  const parsed = JSON.parse(JSON.stringify(referenceMapJson)) as RawMapDescriptor;
  return {
    size: parsed.size,
    walls: parsed.walls,
    coverClusters: parsed.coverClusters,
    crates: parsed.crates,
    airdrops: parsed.airdrops,
    spawns: parsed.spawns,
    evac: parsed.evac,
  };
}

function legacyRectToTiles(rect: Wall): Tile[] {
  const tiles: Tile[] = [];
  for (let dx = 0; dx < rect.w; dx++) {
    for (let dy = 0; dy < rect.h; dy++) {
      tiles.push({ x: rect.x + dx, y: rect.y + dy });
    }
  }
  return tiles;
}

function legacyAssignPersonasToSpawns(
  rngSeed: string,
): Array<{ personaId: PersonaId; spawnIndex: number }> {
  const indices = Array.from({ length: PERSONA_IDS.length }, (_, i) => i);
  const rng = makeRng(`${rngSeed}:spawnAssign`);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const safeJ = j > i ? i : j;
    const tmp = indices[i] as number;
    indices[i] = indices[safeJ] as number;
    indices[safeJ] = tmp;
  }
  return PERSONA_IDS.map((personaId, i) => ({
    personaId,
    spawnIndex: indices[i] as number,
  }));
}

function legacyReferenceWorldRows(rngSeed: string) {
  const descriptor = legacyReferenceDescriptor();
  const coverTiles = descriptor.coverClusters.flatMap(legacyRectToTiles);
  const crates = descriptor.crates.map((crate) => ({
    id: `Crate_${crate.x}_${crate.y}`,
    pos: { x: crate.x, y: crate.y },
    contents: { ...crate.contents },
    opened: false,
  }));
  const airdrops = descriptor.airdrops.map((drop) => ({
    id: `Crate_${drop.x}_${drop.y}`,
    pos: { x: drop.x, y: drop.y },
    landsAtTurn: drop.landsAtTurn,
    contents: { ...drop.contents },
    looted: false,
  }));

  return {
    worldStatic: {
      walls: descriptor.walls,
      coverClusters: descriptor.coverClusters,
      coverTiles,
    },
    worldState: {
      crates,
      airdrops,
      corpses: [],
      evac: {
        centre: { x: descriptor.evac.x, y: descriptor.evac.y },
        revealedAtTurn: null,
      },
    },
    characters: legacyAssignPersonasToSpawns(rngSeed).map(
      ({ personaId, spawnIndex }) => {
        const spawn = descriptor.spawns[spawnIndex];
        if (!spawn) {
          throw new Error(`missing spawn ${spawnIndex} in legacy descriptor`);
        }
        return {
          personaId,
          spawnIndex,
          displayName: personaId.slice(0, 1).toUpperCase() + personaId.slice(1),
          hp: CHARACTER_MAX_HP,
          pos: { x: spawn.x, y: spawn.y },
          equipped: {},
          scratchpad: "",
          hidden: false,
          alive: true,
          lastKnown: [],
        };
      },
    ),
  };
}

describe("matches.start harness path", () => {
  it("defaults absent mapId to the byte-identical reference scaffold", async () => {
    const rngSeed = "phase14-default-reference-parity";
    const expected = expectedReferenceWorldRows(rngSeed);
    const ctx = fakeCtx();

    const matchId = await startHandler(ctx, { rngSeed });

    expect(matchId).toBe("matches_1");
    expect(rows(ctx, "matches")).toMatchObject([
      {
        _id: matchId,
        status: "pending",
        turn: 0,
        mapId: "reference",
        rngSeed,
        outcome: { extracted: [], pointsByCharacter: [] },
      },
    ]);
    expect(rowWithoutMetadata(rows(ctx, "worldStatic")[0])).toEqual(
      expected.worldStatic,
    );
    expect(rowWithoutMetadata(rows(ctx, "worldState")[0])).toEqual(
      expected.worldState,
    );
    expect(characters(ctx).map(rowWithoutMetadata)).toEqual(
      expected.characters,
    );
  });

  it("rejects unknown map ids before writing match rows", async () => {
    const ctx = fakeCtx();

    await expectRejectsWithMessage(
      startHandler(ctx, {
        rngSeed: "phase14-unknown-map",
        mapId: "missing-map",
      }),
      'Unknown map id "missing-map"',
    );

    expect(rows(ctx, "matches")).toEqual([]);
    expect(rows(ctx, "worldStatic")).toEqual([]);
    expect(rows(ctx, "worldState")).toEqual([]);
    expect(characters(ctx)).toEqual([]);
    expect(ctx.scheduler.calls).toEqual([]);
  });

  it("expands and records an explicit non-reference map id", async () => {
    const rngSeed = "phase14-explicit-split-basin";
    const descriptor = getMapDescriptor("split-basin");
    const expected = expectedWorldRows(descriptor, rngSeed);
    const ctx = fakeCtx();

    const matchId = await startHandler(ctx, {
      rngSeed,
      mapId: "split-basin",
    });

    expect(rows(ctx, "matches")).toMatchObject([
      {
        _id: matchId,
        mapId: "split-basin",
        rngSeed,
      },
    ]);
    expect(rowWithoutMetadata(rows(ctx, "worldStatic")[0])).toEqual(
      expected.worldStatic,
    );
    expect(rowWithoutMetadata(rows(ctx, "worldState")[0])).toEqual(
      expected.worldState,
    );
    expect(characters(ctx).map(rowWithoutMetadata)).toEqual(
      expected.characters,
    );
  });

  it("preserves the existing seeded persona-to-spawn mapping and character shape", async () => {
    const ctx = fakeCtx();

    const matchId = await startHandler(ctx, {
      rngSeed: "wp2-seed",
      reasoningEffort: "medium",
    });

    expect(matchId).toBe("matches_1");
    expect(rows(ctx, "matches")).toHaveLength(1);
    expect(rows(ctx, "worldStatic")).toHaveLength(1);
    expect(rows(ctx, "worldState")).toHaveLength(1);
    expect(characters(ctx)).toHaveLength(8);
    expect(characters(ctx).map((row) => ({
      personaId: row.personaId,
      spawnIndex: row.spawnIndex,
      displayName: row.displayName,
      cardId: row.cardId,
      cardPromptHash: row.cardPromptHash,
      hp: row.hp,
    }))).toEqual([
      {
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
      {
        personaId: "duelist",
        spawnIndex: 2,
        displayName: "Duelist",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
      {
        personaId: "trader",
        spawnIndex: 5,
        displayName: "Trader",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
      {
        personaId: "opportunist",
        spawnIndex: 3,
        displayName: "Opportunist",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
      {
        personaId: "paranoid",
        spawnIndex: 7,
        displayName: "Paranoid",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
      {
        personaId: "camper",
        spawnIndex: 4,
        displayName: "Camper",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
      {
        personaId: "sprinter",
        spawnIndex: 6,
        displayName: "Sprinter",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
      {
        personaId: "vulture",
        spawnIndex: 1,
        displayName: "Vulture",
        cardId: undefined,
        cardPromptHash: undefined,
        hp: CHARACTER_MAX_HP,
      },
    ]);
    expect(ctx.scheduler.calls).toEqual([
      {
        delayMs: 0,
        fn: expect.anything(),
        args: { matchId },
      },
    ]);
    expect(rows(ctx, "cards")).toEqual([]);
  });
});

describe("matches.startFromCards", () => {
  it("rejects unknown map ids before writing Card-backed match rows", async () => {
    const ctx = fakeCtx();
    const cardIds = await seedCards(ctx);

    await expectRejectsWithMessage(
      startFromCardsHandler(ctx, {
        cardIds,
        rngSeed: "phase14-card-unknown-map",
        mapId: "missing-map",
      }),
      'Unknown map id "missing-map"',
    );

    expect(rows(ctx, "matches")).toEqual([]);
    expect(characters(ctx)).toEqual([]);
    expect(ctx.scheduler.calls).toEqual([]);
  });

  it("rejects card selections that are not exactly 8 distinct ids", async () => {
    const ctx = fakeCtx();
    const cardIds = await seedCards(ctx);

    await expectRejectsWithMessage(
      startFromCardsHandler(ctx, { cardIds: cardIds.slice(0, 7) }),
      "matches.startFromCards: expected exactly 8 cardIds, received 7",
    );
    await expectRejectsWithMessage(
      startFromCardsHandler(ctx, { cardIds: [...cardIds, "card_8"] }),
      "matches.startFromCards: expected exactly 8 cardIds, received 9",
    );
    await expectRejectsWithMessage(
      startFromCardsHandler(ctx, {
        cardIds: [...cardIds.slice(0, 7), cardIds[0]!],
      }),
      "matches.startFromCards: duplicate cardIds are not allowed",
    );
  });

  it("rejects unknown Card ids before writing match rows", async () => {
    const ctx = fakeCtx();
    const cardIds = await seedCards(ctx);

    await expectRejectsWithMessage(
      startFromCardsHandler(ctx, {
        cardIds: [...cardIds.slice(0, 7), "missing_card"],
      }),
      "matches.startFromCards: unknown card id missing_card",
    );

    expect(rows(ctx, "matches")).toEqual([]);
    expect(rows(ctx, "characters")).toEqual([]);
    expect(ctx.scheduler.calls).toEqual([]);
  });

  it("rejects agentName validation issues from the shared helper", async () => {
    const cases: Array<{
      label: string;
      overrides: Partial<Record<number, { agentName: string }>>;
      message: string;
    }> = [
      {
        label: "duplicate names",
        overrides: { 1: { agentName: "alpha" } },
        message: "duplicate_agent_name",
      },
      {
        label: "reserved prefix",
        overrides: { 0: { agentName: "Wall_1_1" } },
        message: "reserved_prefix",
      },
      {
        label: "reserved Player_N name",
        overrides: { 0: { agentName: "Player_7" } },
        message: "reserved_player_id",
      },
      {
        label: "unsafe charset",
        overrides: { 0: { agentName: "Line\nBreak" } },
        message: "multiline",
      },
    ];

    for (const testCase of cases) {
      const ctx = fakeCtx();
      const cardIds = await seedCards(ctx, testCase.overrides);

      await expectRejectsWithMessage(
        startFromCardsHandler(ctx, { cardIds }),
        testCase.message,
      );
      expect(rows(ctx, "matches"), testCase.label).toEqual([]);
      expect(ctx.scheduler.calls, testCase.label).toEqual([]);
    }
  });

  it("rejects Cards whose pinned prompt hash has no corresponding prompt row", async () => {
    const ctx = fakeCtx();
    const cardIds = await seedCards(ctx);
    ctx.db.tables.prompts = ctx.db.tables.prompts.filter(
      (row) => row.hash !== hashHex("prompt 3"),
    );

    await expectRejectsWithMessage(
      startFromCardsHandler(ctx, { cardIds }),
      `matches.startFromCards: prompt row missing for card card_3 hash ${hashHex("prompt 3")}`,
    );

    expect(rows(ctx, "matches")).toEqual([]);
    expect(characters(ctx)).toEqual([]);
    expect(ctx.scheduler.calls).toEqual([]);
  });

  it("creates a Card-backed match with deterministic card-to-spawn shuffle and pinned prompt hashes", async () => {
    const ctx = fakeCtx();
    const baselineCtx = fakeCtx();
    await startHandler(baselineCtx, {
      rngSeed: "wp2-seed",
      reasoningEffort: "high",
    });
    const cardIds = await seedCards(ctx, {
      0: { lineagePersonaId: "vulture" },
      1: { lineagePersonaId: "rat" },
    });
    const beforeCards = cardSnapshot(ctx);

    const matchId = await startFromCardsHandler(ctx, {
      cardIds,
      rngSeed: "wp2-seed",
      reasoningEffort: "high",
    });

    expect(matchId).toBe("matches_17");
    expect(rows(ctx, "matches")).toMatchObject([
      {
        _id: matchId,
        status: "pending",
        turn: 0,
        mapId: "reference",
        rngSeed: "wp2-seed",
        reasoningEffort: "high",
        outcome: { extracted: [], pointsByCharacter: [] },
      },
    ]);
    expect(rows(ctx, "worldStatic")).toHaveLength(1);
    expect(rows(ctx, "worldState")).toHaveLength(1);
    expect(rowWithoutMetadata(rows(ctx, "worldStatic")[0])).toEqual(
      rowWithoutMetadata(rows(baselineCtx, "worldStatic")[0]),
    );
    expect(rowWithoutMetadata(rows(ctx, "worldState")[0])).toEqual(
      rowWithoutMetadata(rows(baselineCtx, "worldState")[0]),
    );
    expect(characters(ctx)).toHaveLength(8);
    expect(characters(ctx).map((row) => ({
      cardId: row.cardId,
      cardPromptHash: row.cardPromptHash,
      personaId: row.personaId,
      spawnIndex: row.spawnIndex,
      displayName: row.displayName,
      hp: row.hp,
      equipped: row.equipped,
      scratchpad: row.scratchpad,
      hidden: row.hidden,
      alive: row.alive,
      lastKnown: row.lastKnown,
    }))).toEqual([
      {
        cardId: "card_0",
        cardPromptHash: hashHex("prompt 0"),
        personaId: "vulture",
        spawnIndex: 0,
        displayName: "Alpha",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
      {
        cardId: "card_1",
        cardPromptHash: hashHex("prompt 1"),
        personaId: "rat",
        spawnIndex: 2,
        displayName: "Bravo",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
      {
        cardId: "card_2",
        cardPromptHash: hashHex("prompt 2"),
        personaId: "trader",
        spawnIndex: 5,
        displayName: "Charlie",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
      {
        cardId: "card_3",
        cardPromptHash: hashHex("prompt 3"),
        personaId: "opportunist",
        spawnIndex: 3,
        displayName: "Delta",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
      {
        cardId: "card_4",
        cardPromptHash: hashHex("prompt 4"),
        personaId: "paranoid",
        spawnIndex: 7,
        displayName: "Echo",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
      {
        cardId: "card_5",
        cardPromptHash: hashHex("prompt 5"),
        personaId: "camper",
        spawnIndex: 4,
        displayName: "Foxtrot",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
      {
        cardId: "card_6",
        cardPromptHash: hashHex("prompt 6"),
        personaId: "sprinter",
        spawnIndex: 6,
        displayName: "Gamma",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
      {
        cardId: "card_7",
        cardPromptHash: hashHex("prompt 7"),
        personaId: "vulture",
        spawnIndex: 1,
        displayName: "Helix",
        hp: CHARACTER_MAX_HP,
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      },
    ]);
    expect(ctx.scheduler.calls).toEqual([
      {
        delayMs: 0,
        fn: expect.anything(),
        args: { matchId },
      },
    ]);
    expect(cardSnapshot(ctx)).toEqual(beforeCards);
  });

  it("pins character.cardPromptHash even if the Card prompt later changes", async () => {
    const ctx = fakeCtx();
    const cardIds = await seedCards(ctx);
    const originalHash = hashHex("prompt 0");

    await startFromCardsHandler(ctx, { cardIds, rngSeed: "wp2-seed" });
    await insertPrompt(ctx, "updated prompt 0");
    await ctx.db.patch("card_0", { promptHash: hashHex("updated prompt 0") });

    expect(characters(ctx).find((row) => row.cardId === "card_0")).toMatchObject({
      cardPromptHash: originalHash,
    });
  });

  it("accepts valid agent names from the shared helper", async () => {
    const ctx = fakeCtx();
    const cardIds = await seedCards(ctx);

    await expect(
      startFromCardsHandler(ctx, { cardIds, rngSeed: "valid-names" }),
    ).resolves.toEqual(expect.any(String));

    expect(characters(ctx).map((row) => row.displayName)).toEqual(CARD_NAMES);
  });
});
