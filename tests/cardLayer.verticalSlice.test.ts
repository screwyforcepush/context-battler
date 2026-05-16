import { describe, expect, it } from "vitest";

import { PERSONAS_INLINE } from "../convex/_data/personas.js";
import {
  accrueFromMatchRecord,
  createCardRecord,
  listCardRecords,
  seedPresetCards,
  updateCardPromptRecord,
} from "../convex/cards.js";
import { hashHex } from "../convex/engine/hash.js";
import { PERSONA_IDS, titleCase, type PersonaId } from "../convex/engine/types.js";
import { start, startFromCards } from "../convex/matches.js";

type TableName =
  | "cardAccruals"
  | "cards"
  | "characters"
  | "matches"
  | "prompts"
  | "turns"
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

type SortDirection = "asc" | "desc";

class FakeDb {
  private seq = 0;
  readonly tables: Record<TableName, Row[]> = {
    cardAccruals: [],
    cards: [],
    characters: [],
    matches: [],
    prompts: [],
    turns: [],
    worldState: [],
    worldStatic: [],
  };
  readonly inserts: Array<{
    table: TableName;
    id: string;
    value: Record<string, unknown>;
  }> = [];
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
  { rngSeed?: string; reasoningEffort?: "low" | "medium" | "high" },
  string
>(start);
const startFromCardsHandler = handler<
  { cardIds: string[]; rngSeed?: string; reasoningEffort?: "low" | "medium" | "high" },
  string
>(startFromCards);

function rows(ctx: ReturnType<typeof fakeCtx>, table: TableName) {
  return ctx.db.tables[table];
}

function cardRows(ctx: ReturnType<typeof fakeCtx>) {
  return rows(ctx, "cards");
}

function characterRows(ctx: ReturnType<typeof fakeCtx>, matchId: string) {
  return rows(ctx, "characters").filter((row) => row.matchId === matchId);
}

function rowById(ctx: ReturnType<typeof fakeCtx>, table: TableName, id: string) {
  const row = rows(ctx, table).find((candidate) => candidate._id === id);
  if (!row) throw new Error(`missing ${table} row ${id}`);
  return row;
}

function stringField(row: Row, field: string) {
  const value = row[field];
  if (typeof value !== "string") {
    throw new Error(`expected ${field} to be a string`);
  }
  return value;
}

function numberField(row: Row, field: string) {
  const value = row[field];
  if (typeof value !== "number") {
    throw new Error(`expected ${field} to be a number`);
  }
  return value;
}

async function insertTurn(
  ctx: ReturnType<typeof fakeCtx>,
  args: {
    matchId: string;
    turn: number;
    agentRecords?: unknown[];
    resolution: {
      moves?: unknown[];
      actions?: unknown[];
      deaths?: string[];
      environmentalDeaths?: string[];
    };
  },
) {
  await ctx.db.insert("turns", {
    matchId: args.matchId,
    turn: args.turn,
    agentRecords: args.agentRecords ?? [],
    resolution: {
      consumed: [],
      speech: [],
      moves: args.resolution.moves ?? [],
      actions: args.resolution.actions ?? [],
      deaths: args.resolution.deaths ?? [],
      environmentalDeaths: args.resolution.environmentalDeaths ?? [],
      visibilityUpdates: [],
    },
  });
}

function selectedCardRows(ctx: ReturnType<typeof fakeCtx>, cardIds: string[]) {
  return cardIds.map((cardId) => rowById(ctx, "cards", cardId));
}

describe("Phase 13 WP5 Card layer vertical slice", () => {
  it("runs the north-star ownerless Card journey from seeded pool to completed-match accrual", async () => {
    const ctx = fakeCtx();

    await expect(seedPresetCards(ctx, { now: 1000 })).resolves.toEqual({
      inserted: 8,
      existing: 0,
      total: 8,
    });
    expect(cardRows(ctx)).toHaveLength(8);
    for (const personaId of PERSONA_IDS) {
      const preset = cardRows(ctx).find(
        (card) => card.lineagePersonaId === personaId && card.isPreset === true,
      );
      expect(preset).toMatchObject({
        agentName: titleCase(personaId),
        promptHash: hashHex(PERSONAS_INLINE[personaId]),
        lineagePersonaId: personaId,
        progression: { level: 1, xp: 0 },
        prizeUnitsWon: 0,
        matchesPlayed: 0,
        kills: 0,
        deaths: 0,
        wallFaceSlams: 0,
      });
      expect(preset).not.toHaveProperty("ownerId");
      expect(preset).not.toHaveProperty("userId");
      expect(preset).not.toHaveProperty("accountId");
    }

    const ninth = await createCardRecord(ctx, {
      agentName: "Ninth Mind",
      promptText: "Original ninth Card prompt.",
      lineagePersonaId: "rat",
    });
    await expect(listCardRecords(ctx)).resolves.toHaveLength(9);

    const presetIds = cardRows(ctx)
      .filter((card) => card.isPreset === true)
      .map((card) => card._id)
      .slice(0, 7);
    const explicitEight = [ninth.cardId, ...presetIds];
    expect(explicitEight).toHaveLength(8);
    expect(new Set(explicitEight).size).toBe(8);

    const matchId = await startFromCardsHandler(ctx, {
      cardIds: explicitEight,
      rngSeed: "wp5-vertical",
      reasoningEffort: "low",
    });

    const characters = characterRows(ctx, matchId);
    expect(characters).toHaveLength(8);
    expect(characters.map((row) => row.cardId).sort()).toEqual(
      [...explicitEight].sort(),
    );
    for (const character of characters) {
      const card = rowById(ctx, "cards", stringField(character, "cardId"));
      expect(character).toMatchObject({
        personaId: card.lineagePersonaId,
        displayName: card.agentName,
        cardPromptHash: card.promptHash,
      });
      expect(
        rows(ctx, "prompts").find(
          (prompt) =>
            prompt.hash === character.cardPromptHash &&
            prompt.kind === "persona",
        ),
      ).toBeTruthy();
    }

    const ninthCharacter = characters.find(
      (character) => character.cardId === ninth.cardId,
    );
    if (!ninthCharacter) throw new Error("ninth Card character missing");
    expect(ninthCharacter.cardPromptHash).toBe(ninth.promptHash);

    await expect(
      updateCardPromptRecord(ctx, {
        cardId: ninth.cardId,
        promptText: "Updated ninth Card prompt.",
      }),
    ).resolves.toMatchObject({
      cardId: ninth.cardId,
      previousPromptHash: ninth.promptHash,
      promptHash: hashHex("Updated ninth Card prompt."),
      changed: true,
    });
    expect(rowById(ctx, "cards", ninth.cardId)).toMatchObject({
      promptHash: hashHex("Updated ninth Card prompt."),
    });
    expect(rowById(ctx, "characters", ninthCharacter._id)).toMatchObject({
      cardPromptHash: ninth.promptHash,
    });

    const winner = ninthCharacter;
    const killed = characters.find(
      (character) => character.cardId === explicitEight[1],
    );
    const environmental = characters.find(
      (character) => character.cardId === explicitEight[2],
    );
    if (!killed || !environmental) {
      throw new Error("expected killed and environmental Card characters");
    }

    await ctx.db.patch(killed._id, { alive: false, diedAtTurn: 2 });
    await ctx.db.patch(environmental._id, { alive: false, diedAtTurn: 3 });
    await ctx.db.patch(matchId, {
      status: "completed",
      turn: 50,
      completedAt: 2000,
      outcome: {
        extracted: [winner._id],
        lastSurvivor: winner._id,
        pointsByCharacter: [{ id: winner._id, points: 100 }],
      },
    });
    await insertTurn(ctx, {
      matchId,
      turn: 2,
      agentRecords: characters.map((character) => ({
        characterId: character._id,
        personaId: character.personaId,
        displayName: character.displayName,
      })),
      resolution: {
        moves: [
          {
            characterId: winner._id,
            from: { x: 1, y: 1 },
            to: { x: 1, y: 1 },
            blockedBy: "wall",
            bodyCollision: { kind: "wall", wallRectId: "Wall_1_1" },
          },
          {
            characterId: killed._id,
            from: { x: 2, y: 2 },
            to: { x: 2, y: 2 },
            blockedBy: "wall",
          },
        ],
        actions: [
          {
            characterId: winner._id,
            kind: "attack",
            target: stringField(killed, "displayName"),
            result: "dmg 50",
          },
          {
            characterId: winner._id,
            kind: "attack",
            target: environmental._id,
            result: "dmg 1",
          },
        ],
        deaths: [killed._id],
        environmentalDeaths: [environmental._id],
      },
    });

    await expect(
      accrueFromMatchRecord(ctx, { matchId }),
    ).resolves.toMatchObject({
      applied: true,
      cardBackedCharacters: 8,
      cardsPatched: 8,
      status: "applied",
    });

    const selectedCards = selectedCardRows(ctx, explicitEight);
    for (const card of selectedCards) {
      expect(card.matchesPlayed).toBe(1);
      expect(card).not.toHaveProperty("prizePerMatch");
      expect(card).not.toHaveProperty("kd");
    }
    expect(rowById(ctx, "cards", stringField(winner, "cardId"))).toMatchObject({
      prizeUnitsWon: 100,
      matchesPlayed: 1,
      kills: 1,
      deaths: 0,
      wallFaceSlams: 1,
    });
    expect(rowById(ctx, "cards", stringField(killed, "cardId"))).toMatchObject({
      prizeUnitsWon: 0,
      matchesPlayed: 1,
      kills: 0,
      deaths: 1,
      wallFaceSlams: 0,
    });
    expect(rowById(ctx, "cards", stringField(environmental, "cardId"))).toMatchObject({
      prizeUnitsWon: 0,
      matchesPlayed: 1,
      kills: 0,
      deaths: 1,
      wallFaceSlams: 0,
    });

    const totals = selectedCards.reduce(
      (sum, card) => ({
        prizeUnitsWon: sum.prizeUnitsWon + numberField(card, "prizeUnitsWon"),
        kills: sum.kills + numberField(card, "kills"),
        deaths: sum.deaths + numberField(card, "deaths"),
        wallFaceSlams:
          sum.wallFaceSlams + numberField(card, "wallFaceSlams"),
      }),
      { prizeUnitsWon: 0, kills: 0, deaths: 0, wallFaceSlams: 0 },
    );
    expect(totals).toEqual({
      prizeUnitsWon: 100,
      kills: 1,
      deaths: 2,
      wallFaceSlams: 1,
    });
    const winnerCard = rowById(ctx, "cards", stringField(winner, "cardId"));
    expect(
      numberField(winnerCard, "prizeUnitsWon") /
        numberField(winnerCard, "matchesPlayed"),
    ).toBe(100);

    const patchCountAfterFirstAccrual = ctx.db.patches.length;
    await expect(
      accrueFromMatchRecord(ctx, { matchId }),
    ).resolves.toMatchObject({
      applied: false,
      status: "already_accrued",
    });
    expect(ctx.db.patches).toHaveLength(patchCountAfterFirstAccrual);
    expect(rows(ctx, "cardAccruals")).toHaveLength(1);
  });

  it("reasserts the harness path remains closed-union and Card accrual self-guards to no-op", async () => {
    const ctx = fakeCtx();

    const matchId = await startHandler(ctx, {
      rngSeed: "wp5-harness",
      reasoningEffort: "medium",
    });

    const characters = characterRows(ctx, matchId);
    expect(characters).toHaveLength(8);
    expect(new Set(characters.map((character) => character.personaId))).toEqual(
      new Set<PersonaId>(PERSONA_IDS),
    );
    for (const character of characters) {
      expect(character.displayName).toBe(
        titleCase(character.personaId as PersonaId),
      );
      expect(character.cardId).toBeUndefined();
      expect(character.cardPromptHash).toBeUndefined();
    }
    expect(cardRows(ctx)).toEqual([]);
    expect(ctx.scheduler.calls).toEqual([
      { delayMs: 0, fn: expect.anything(), args: { matchId } },
    ]);

    await ctx.db.patch(matchId, {
      status: "completed",
      turn: 50,
      completedAt: 3000,
      outcome: {
        extracted: [],
        pointsByCharacter: [{ id: characters[0]!._id, points: 100 }],
      },
    });
    const patchCountBeforeNoOp = ctx.db.patches.length;
    const insertCountBeforeNoOp = ctx.db.inserts.length;

    await expect(
      accrueFromMatchRecord(ctx, { matchId }),
    ).resolves.toEqual({
      applied: false,
      cardBackedCharacters: 0,
      status: "no_card_characters",
    });
    expect(ctx.db.patches).toHaveLength(patchCountBeforeNoOp);
    expect(ctx.db.inserts).toHaveLength(insertCountBeforeNoOp);
    expect(rows(ctx, "cardAccruals")).toEqual([]);
  });
});
