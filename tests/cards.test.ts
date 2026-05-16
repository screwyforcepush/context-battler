import { describe, expect, it } from "vitest";

import { PERSONAS_INLINE } from "../convex/_data/personas.js";
import {
  accrueFromMatch,
  accrueFromMatchRecord,
  createCardRecord,
  getCardRecord,
  listCardRecords,
  seedPresetCards,
  updateCardPromptRecord,
  create,
  get,
  list,
  seedPresets,
  updatePrompt,
} from "../convex/cards.js";
import { hashHex } from "../convex/engine/hash.js";
import { PERSONA_IDS, titleCase, type PersonaId } from "../convex/engine/types.js";
import { getOrCreatePromptByHash } from "../convex/promptHelpers.js";
import schema from "../convex/schema.js";

type TableName =
  | "cards"
  | "cardAccruals"
  | "characters"
  | "matches"
  | "prompts"
  | "turns";
type Row = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

type QueryFilter = {
  field: string;
  value: unknown;
};

type SortDirection = "asc" | "desc";

class FakeDb {
  private seq = 0;
  readonly tables: Record<TableName, Row[]> = {
    cards: [],
    cardAccruals: [],
    characters: [],
    matches: [],
    prompts: [],
    turns: [],
  };
  readonly patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  readonly inserts: Array<{
    table: TableName;
    id: string;
    value: Record<string, unknown>;
  }> = [];
  readonly orderCalls: Array<{ table: TableName; direction: SortDirection }> = [];

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
    this.inserts.push({ table, id: row._id, value });
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
    private readonly sortDirection?: SortDirection,
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
    return new FakeQuery(
      this.db,
      this.table,
      [...this.filters, ...filters],
      this.sortDirection,
    );
  }

  order(direction: SortDirection) {
    this.db.orderCalls.push({ table: this.table, direction });
    return new FakeQuery(this.db, this.table, this.filters, direction);
  }

  async collect() {
    const rows = this.db.tables[this.table].filter((row) =>
      this.filters.every((filter) => row[filter.field] === filter.value),
    );
    if (this.sortDirection === undefined) return rows;
    return [...rows].sort((a, b) => {
      const left = typeof a.turn === "number" ? a.turn : a._creationTime;
      const right = typeof b.turn === "number" ? b.turn : b._creationTime;
      return this.sortDirection === "asc" ? left - right : right - left;
    });
  }

  async unique() {
    const rows = await this.collect();
    if (rows.length > 1) {
      throw new Error(`expected unique row, found ${rows.length}`);
    }
    return rows[0] ?? null;
  }
}

function fakeCtx() {
  return { db: new FakeDb() };
}

function schemaField(table: string, field: string) {
  const tableValidator = (schema as unknown as {
    tables: Record<string, { validator: { json: { value: Record<string, unknown> } } }>;
  }).tables[table];
  if (!tableValidator) throw new Error(`missing schema table ${table}`);
  return tableValidator.validator.json.value[field];
}

function cardRows(ctx: ReturnType<typeof fakeCtx>) {
  return ctx.db.tables.cards;
}

function promptRows(ctx: ReturnType<typeof fakeCtx>) {
  return ctx.db.tables.prompts;
}

function insertCard(
  ctx: ReturnType<typeof fakeCtx>,
  fields: Partial<Row> & { _id?: string } = {},
) {
  const row: Row = {
    _id: fields._id ?? `card_${ctx.db.tables.cards.length + 1}`,
    _creationTime: ctx.db.tables.cards.length + 1,
    agentName: fields.agentName ?? "Card Agent",
    promptHash: fields.promptHash ?? "prompt-hash",
    lineagePersonaId: fields.lineagePersonaId ?? "rat",
    progression: fields.progression ?? { level: 1, xp: 0 },
    prizeUnitsWon: fields.prizeUnitsWon ?? 0,
    matchesPlayed: fields.matchesPlayed ?? 0,
    kills: fields.kills ?? 0,
    deaths: fields.deaths ?? 0,
    wallFaceSlams: fields.wallFaceSlams ?? 0,
    isPreset: fields.isPreset ?? false,
    createdAt: fields.createdAt ?? 1,
  };
  ctx.db.tables.cards.push(row);
  return row;
}

function insertMatch(
  ctx: ReturnType<typeof fakeCtx>,
  fields: Partial<Row> & { _id?: string; status?: string } = {},
) {
  const row: Row = {
    _id: fields._id ?? `match_${ctx.db.tables.matches.length + 1}`,
    _creationTime: ctx.db.tables.matches.length + 1,
    status: fields.status ?? "completed",
    turn: fields.turn ?? 50,
    startedAt: fields.startedAt ?? 1,
    completedAt: fields.completedAt ?? 2,
    mapId: fields.mapId ?? "reference",
    rngSeed: fields.rngSeed ?? "seed",
    outcome: fields.outcome ?? {
      extracted: [],
      pointsByCharacter: [],
    },
  };
  ctx.db.tables.matches.push(row);
  return row;
}

function insertCharacter(
  ctx: ReturnType<typeof fakeCtx>,
  fields: Partial<Row> & {
    _id?: string;
    matchId: string;
    personaId?: PersonaId;
  },
) {
  const {
    _id: providedId,
    matchId,
    personaId,
    ...overrides
  } = fields;
  const row: Row = {
    _id: providedId ?? `character_${ctx.db.tables.characters.length + 1}`,
    _creationTime: ctx.db.tables.characters.length + 1,
    matchId,
    personaId: personaId ?? "rat",
    spawnIndex: fields.spawnIndex ?? 0,
    displayName: fields.displayName ?? "Card Agent",
    hp: fields.hp ?? 50,
    pos: fields.pos ?? { x: 0, y: 0 },
    equipped: fields.equipped ?? {},
    scratchpad: fields.scratchpad ?? "",
    hidden: fields.hidden ?? false,
    alive: fields.alive ?? true,
    lastKnown: fields.lastKnown ?? [],
    ...overrides,
  };
  ctx.db.tables.characters.push(row);
  return row;
}

function insertTurn(
  ctx: ReturnType<typeof fakeCtx>,
  fields: Partial<Row> & { matchId: string; turn: number },
) {
  const row: Row = {
    _id: fields._id ?? `turn_${ctx.db.tables.turns.length + 1}`,
    _creationTime: ctx.db.tables.turns.length + 1,
    matchId: fields.matchId,
    turn: fields.turn,
    agentRecords: fields.agentRecords ?? [],
    resolution: fields.resolution ?? {
      consumed: [],
      speech: [],
      moves: [],
      actions: [],
      deaths: [],
      environmentalDeaths: [],
      visibilityUpdates: [],
    },
  };
  ctx.db.tables.turns.push(row);
  return row;
}

describe("Phase 13 WP1 card schema", () => {
  it("adds ownerless cards/cardAccruals and optional character card trace fields", () => {
    expect(schemaField("cards", "agentName")).toBeTruthy();
    expect(schemaField("cards", "promptHash")).toBeTruthy();
    expect(schemaField("cards", "lineagePersonaId")).toBeTruthy();
    expect(schemaField("cards", "progression")).toBeTruthy();
    expect(schemaField("cards", "prizeUnitsWon")).toBeTruthy();
    expect(schemaField("cards", "matchesPlayed")).toBeTruthy();
    expect(schemaField("cards", "kills")).toBeTruthy();
    expect(schemaField("cards", "deaths")).toBeTruthy();
    expect(schemaField("cards", "wallFaceSlams")).toBeTruthy();
    expect(schemaField("cards", "isPreset")).toBeTruthy();
    expect(schemaField("cards", "createdAt")).toBeTruthy();
    expect(schemaField("cards", "ownerId")).toBeUndefined();
    expect(schemaField("cards", "userId")).toBeUndefined();
    expect(schemaField("cards", "accountId")).toBeUndefined();

    expect(schemaField("cardAccruals", "matchId")).toBeTruthy();
    expect(schemaField("characters", "cardId")).toMatchObject({
      optional: true,
      fieldType: { type: "id", tableName: "cards" },
    });
    expect(schemaField("characters", "cardPromptHash")).toMatchObject({
      optional: true,
      fieldType: { type: "string" },
    });
  });
});

describe("Phase 13 WP1 prompt helper and cards CRUD", () => {
  it("get-or-creates persona prompts idempotently by hash", async () => {
    const ctx = fakeCtx();

    const first = await getOrCreatePromptByHash(ctx, {
      kind: "persona",
      text: "same mind",
    });
    const second = await getOrCreatePromptByHash(ctx, {
      kind: "persona",
      text: "same mind",
    });

    expect(first).toEqual(second);
    expect(promptRows(ctx)).toHaveLength(1);
    expect(promptRows(ctx)[0]).toMatchObject({
      kind: "persona",
      hash: hashHex("same mind"),
      text: "same mind",
    });
  });

  it("seedPresets inserts the exact 8 preset cards once with canonical shape", async () => {
    const ctx = fakeCtx();

    const first = await seedPresetCards(ctx, { now: 123 });
    const second = await seedPresetCards(ctx, { now: 456 });

    expect(first).toEqual({ inserted: 8, existing: 0, total: 8 });
    expect(second).toEqual({ inserted: 0, existing: 8, total: 8 });
    expect(cardRows(ctx)).toHaveLength(8);
    expect(promptRows(ctx)).toHaveLength(8);

    for (const personaId of PERSONA_IDS) {
      const row = cardRows(ctx).find(
        (candidate) => candidate.lineagePersonaId === personaId,
      );
      expect(row).toMatchObject({
        agentName: titleCase(personaId),
        promptHash: hashHex(PERSONAS_INLINE[personaId]),
        lineagePersonaId: personaId,
        progression: { level: 1, xp: 0 },
        prizeUnitsWon: 0,
        matchesPlayed: 0,
        kills: 0,
        deaths: 0,
        wallFaceSlams: 0,
        isPreset: true,
        createdAt: 123,
      });
      expect(row).not.toHaveProperty("ownerId");
      expect(row).not.toHaveProperty("userId");
      expect(row).not.toHaveProperty("accountId");
    }
  });

  it("creates ownerless cards and allows the pool to exceed the 8 presets", async () => {
    const ctx = fakeCtx();
    await seedPresetCards(ctx, { now: 100 });

    const created = await createCardRecord(ctx, {
      agentName: "Ninth Mind",
      promptText: "You are the ninth card.",
      lineagePersonaId: "rat",
    });
    const row = await getCardRecord(ctx, { cardId: created.cardId });
    const listed = await listCardRecords(ctx);

    expect(listed).toHaveLength(9);
    expect(row).toMatchObject({
      _id: created.cardId,
      agentName: "Ninth Mind",
      promptHash: hashHex("You are the ninth card."),
      lineagePersonaId: "rat",
      progression: { level: 1, xp: 0 },
      prizeUnitsWon: 0,
      matchesPlayed: 0,
      kills: 0,
      deaths: 0,
      wallFaceSlams: 0,
      isPreset: false,
    });
    expect(row).not.toHaveProperty("ownerId");
    expect(row).not.toHaveProperty("userId");
    expect(row).not.toHaveProperty("accountId");
  });

  it("updatePrompt get-or-creates text and patches only cards.promptHash", async () => {
    const ctx = fakeCtx();
    const created = await createCardRecord(ctx, {
      agentName: "Mutable",
      promptText: "old prompt",
      lineagePersonaId: "duelist",
    });
    const oldHash = created.promptHash;
    const characterId = await ctx.db.insert("characters", {
      matchId: "match_1",
      personaId: "duelist" satisfies PersonaId,
      spawnIndex: 0,
      displayName: "Mutable",
      hp: 50,
      pos: { x: 0, y: 0 },
      equipped: {},
      scratchpad: "",
      hidden: false,
      alive: true,
      lastKnown: [],
      cardId: created.cardId,
      cardPromptHash: oldHash,
    });

    const trace = await updateCardPromptRecord(ctx, {
      cardId: created.cardId,
      promptText: "new prompt",
    });

    expect(trace).toEqual({
      cardId: created.cardId,
      previousPromptHash: oldHash,
      promptHash: hashHex("new prompt"),
      promptId: expect.any(String),
      changed: true,
    });
    expect(ctx.db.patches).toEqual([
      { id: created.cardId, patch: { promptHash: hashHex("new prompt") } },
    ]);
    expect(await ctx.db.get(characterId)).toMatchObject({
      cardPromptHash: oldHash,
    });
    expect(promptRows(ctx).map((row) => row.hash)).toEqual([
      oldHash,
      hashHex("new prompt"),
    ]);
  });

  it("exports the public Convex card functions", () => {
    expect(create).toBeTruthy();
    expect(accrueFromMatch).toBeTruthy();
    expect(get).toBeTruthy();
    expect(list).toBeTruthy();
    expect(seedPresets).toBeTruthy();
    expect(updatePrompt).toBeTruthy();
  });
});

describe("Phase 13 WP3 card accrual writer", () => {
  it("excludes missing, running, and failed matches before Card writes", async () => {
    const ctx = fakeCtx();
    const card = insertCard(ctx, { _id: "card_a" });
    const running = insertMatch(ctx, { _id: "match_running", status: "running" });
    const failed = insertMatch(ctx, { _id: "match_failed", status: "failed" });
    insertCharacter(ctx, {
      _id: "running_card",
      matchId: running._id,
      cardId: card._id,
    });
    insertCharacter(ctx, {
      _id: "failed_card",
      matchId: failed._id,
      cardId: card._id,
    });

    await expect(
      accrueFromMatchRecord(ctx, { matchId: "missing_match" }),
    ).resolves.toMatchObject({ applied: false, status: "match_missing" });
    await expect(
      accrueFromMatchRecord(ctx, { matchId: running._id }),
    ).resolves.toMatchObject({
      applied: false,
      matchStatus: "running",
      status: "match_not_completed",
    });
    await expect(
      accrueFromMatchRecord(ctx, { matchId: failed._id }),
    ).resolves.toMatchObject({
      applied: false,
      matchStatus: "failed",
      status: "match_not_completed",
    });

    expect(ctx.db.patches).toEqual([]);
    expect(ctx.db.tables.cardAccruals).toHaveLength(0);
  });

  it("no-ops completed harness matches with zero Card patch or sentinel writes", async () => {
    const ctx = fakeCtx();
    const match = insertMatch(ctx, {
      _id: "match_harness",
      outcome: {
        extracted: [],
        pointsByCharacter: [{ id: "harness_a", points: 100 }],
      },
    });
    insertCharacter(ctx, {
      _id: "harness_a",
      matchId: match._id,
      displayName: "Duelist",
      personaId: "duelist",
    });
    insertTurn(ctx, { matchId: match._id, turn: 1 });
    const insertCount = ctx.db.inserts.length;

    await expect(
      accrueFromMatchRecord(ctx, { matchId: match._id }),
    ).resolves.toEqual({
      applied: false,
      cardBackedCharacters: 0,
      status: "no_card_characters",
    });

    expect(ctx.db.patches).toEqual([]);
    expect(ctx.db.tables.cardAccruals).toHaveLength(0);
    expect(ctx.db.inserts).toHaveLength(insertCount);
  });

  it("patches every Card accumulator from aggregateCardStats and inserts an idempotency sentinel", async () => {
    const ctx = fakeCtx();
    const alpha = insertCard(ctx, {
      _id: "card_alpha",
      prizeUnitsWon: 5,
      matchesPlayed: 2,
      kills: 1,
      deaths: 0,
      wallFaceSlams: 4,
    });
    const beta = insertCard(ctx, {
      _id: "card_beta",
      prizeUnitsWon: 1,
      matchesPlayed: 1,
      kills: 0,
      deaths: 2,
      wallFaceSlams: 0,
    });
    const gamma = insertCard(ctx, {
      _id: "card_gamma",
      prizeUnitsWon: 10,
      matchesPlayed: 5,
      kills: 7,
      deaths: 1,
      wallFaceSlams: 2,
    });
    const match = insertMatch(ctx, {
      _id: "match_cards",
      outcome: {
        extracted: ["char_alpha"],
        lastSurvivor: "char_alpha",
        pointsByCharacter: [{ id: "char_alpha", points: 100 }],
      },
    });
    insertCharacter(ctx, {
      _id: "char_alpha",
      matchId: match._id,
      cardId: alpha._id,
      displayName: "Alpha",
      personaId: "rat",
    });
    insertCharacter(ctx, {
      _id: "char_beta",
      matchId: match._id,
      cardId: beta._id,
      displayName: "Beta",
      personaId: "duelist",
      diedAtTurn: 2,
      alive: false,
    });
    insertCharacter(ctx, {
      _id: "char_gamma",
      matchId: match._id,
      cardId: gamma._id,
      displayName: "Gamma",
      personaId: "trader",
      diedAtTurn: 3,
      alive: false,
    });
    insertTurn(ctx, {
      matchId: match._id,
      turn: 3,
      resolution: {
        consumed: [],
        speech: [],
        moves: [],
        actions: [
          {
            characterId: "char_alpha",
            kind: "attack",
            target: "char_gamma",
            result: "dmg 20",
          },
        ],
        deaths: [],
        environmentalDeaths: ["char_gamma"],
        visibilityUpdates: [],
      },
    });
    insertTurn(ctx, {
      matchId: match._id,
      turn: 1,
      resolution: {
        consumed: [],
        speech: [],
        moves: [
          {
            characterId: "char_alpha",
            from: { x: 1, y: 1 },
            to: { x: 1, y: 1 },
            blockedBy: "wall",
            bodyCollision: { kind: "wall", wallRectId: "Wall_1_1" },
          },
          {
            characterId: "char_beta",
            from: { x: 2, y: 2 },
            to: { x: 2, y: 2 },
            blockedBy: "wall",
          },
          {
            characterId: "char_gamma",
            from: { x: 3, y: 3 },
            to: { x: 3, y: 3 },
            bodyCollision: { kind: "wall", wallRectId: "Wall_3_3" },
          },
        ],
        actions: [],
        deaths: [],
        environmentalDeaths: [],
        visibilityUpdates: [],
      },
    });
    insertTurn(ctx, {
      matchId: match._id,
      turn: 2,
      agentRecords: [
        {
          characterId: "char_beta",
          personaId: "duelist",
          displayName: "Beta",
        },
      ],
      resolution: {
        consumed: [],
        speech: [],
        moves: [],
        actions: [
          {
            characterId: "char_alpha",
            kind: "attack",
            target: "Beta",
            result: "dmg 50",
          },
          {
            characterId: "char_gamma",
            kind: "overwatch",
            target: "char_beta",
            result: "dmg 10",
          },
        ],
        deaths: ["char_beta"],
        environmentalDeaths: [],
        visibilityUpdates: [],
      },
    });

    await expect(
      accrueFromMatchRecord(ctx, { matchId: match._id }),
    ).resolves.toMatchObject({
      applied: true,
      cardsPatched: 3,
      status: "applied",
    });

    expect(ctx.db.orderCalls).toContainEqual({ table: "turns", direction: "asc" });
    expect(await ctx.db.get(alpha._id)).toMatchObject({
      prizeUnitsWon: 105,
      matchesPlayed: 3,
      kills: 2,
      deaths: 0,
      wallFaceSlams: 5,
    });
    expect(await ctx.db.get(beta._id)).toMatchObject({
      prizeUnitsWon: 1,
      matchesPlayed: 2,
      kills: 0,
      deaths: 3,
      wallFaceSlams: 0,
    });
    expect(await ctx.db.get(gamma._id)).toMatchObject({
      prizeUnitsWon: 10,
      matchesPlayed: 6,
      kills: 8,
      deaths: 2,
      wallFaceSlams: 3,
    });
    expect(ctx.db.tables.cardAccruals).toMatchObject([{ matchId: match._id }]);

    const patchesAfterFirstRun = ctx.db.patches.length;
    await expect(
      accrueFromMatchRecord(ctx, { matchId: match._id }),
    ).resolves.toMatchObject({
      applied: false,
      status: "already_accrued",
    });
    expect(ctx.db.patches).toHaveLength(patchesAfterFirstRun);
    expect(ctx.db.tables.cardAccruals).toHaveLength(1);
  });
});
