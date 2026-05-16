import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { PERSONAS_INLINE } from "./_data/personas.js";
import { getOrCreatePromptByHash } from "./promptHelpers.js";
import { personaIdValidator } from "./schema.js";
import { PERSONA_IDS, titleCase, type PersonaId } from "./engine/types.js";
import {
  aggregateCardStats,
  type CardStatsCharacterRow,
  type CardStatsOutcome,
  type CardStatsTurnRow,
} from "./engine/cardStats.js";

type Progression = { level: number; xp: number };

type CardInsert = {
  agentName: string;
  promptHash: string;
  lineagePersonaId: PersonaId;
  progression: Progression;
  prizeUnitsWon: number;
  matchesPlayed: number;
  kills: number;
  deaths: number;
  wallFaceSlams: number;
  isPreset: boolean;
  createdAt: number;
};

type CardAccumulatorPatch = Pick<
  CardInsert,
  "prizeUnitsWon" | "matchesPlayed" | "kills" | "deaths" | "wallFaceSlams"
>;

type UnknownRow = Record<string, unknown> & { _id: string };

type CardIndexQuery = {
  eq(field: "lineagePersonaId", value: PersonaId): CardIndexQuery;
};

type GenericIndexQuery = {
  eq(field: string, value: unknown): GenericIndexQuery;
};

type CardCollectQuery = {
  collect(): Promise<UnknownRow[]>;
};

type CardUniqueQuery = {
  unique(): Promise<UnknownRow | null>;
};

type CardTableQuery = CardCollectQuery & {
  withIndex(
    indexName: "by_lineage",
    cb: (q: CardIndexQuery) => unknown,
  ): CardCollectQuery;
};

type IndexedTableQuery = CardCollectQuery &
  CardUniqueQuery & {
    order(direction: "asc" | "desc"): CardCollectQuery;
    withIndex(
      indexName: string,
      cb: (q: GenericIndexQuery) => unknown,
    ): IndexedTableQuery;
  };

type CardPersistenceContext = {
  db: {
    query(table: "cards"): unknown;
    query(table: "prompts"): unknown;
    query(table: "cardAccruals" | "characters" | "turns"): unknown;
    query(table: "cardAccruals"): unknown;
    query(table: "characters"): unknown;
    query(table: "matches"): unknown;
    query(table: "turns"): unknown;
    insert(table: "cards", value: CardInsert): Promise<string>;
    insert(
      table: "prompts",
      value: { hash: string; kind: "system" | "persona"; text: string },
    ): Promise<string>;
    insert(table: "cardAccruals", value: { matchId: string }): Promise<string>;
    get(id: string): Promise<UnknownRow | null>;
    patch(
      id: string,
      patch: { promptHash: string } | CardAccumulatorPatch,
    ): Promise<void>;
  };
};

export type CardAccrualResult =
  | { applied: false; status: "already_accrued"; accrualId: string }
  | { applied: false; status: "match_missing" }
  | {
      applied: false;
      status: "match_not_completed";
      matchStatus: string;
    }
  | {
      applied: false;
      status: "no_card_characters";
      cardBackedCharacters: 0;
    }
  | {
      applied: true;
      status: "applied";
      accrualId: string;
      cardsPatched: number;
      cardBackedCharacters: number;
    };

export class CardNotFoundError extends Error {
  constructor(cardId: string) {
    super(`Card not found: ${cardId}`);
    this.name = "CardNotFoundError";
  }
}

function zeroCardFields(args: {
  agentName: string;
  promptHash: string;
  lineagePersonaId: PersonaId;
  isPreset: boolean;
  createdAt: number;
}): CardInsert {
  return {
    agentName: args.agentName,
    promptHash: args.promptHash,
    lineagePersonaId: args.lineagePersonaId,
    progression: { level: 1, xp: 0 },
    prizeUnitsWon: 0,
    matchesPlayed: 0,
    kills: 0,
    deaths: 0,
    wallFaceSlams: 0,
    isPreset: args.isPreset,
    createdAt: args.createdAt,
  };
}

function cardsQuery(ctx: CardPersistenceContext): CardTableQuery {
  return ctx.db.query("cards") as CardTableQuery;
}

function indexedQuery(
  ctx: CardPersistenceContext,
  table: "cardAccruals" | "characters" | "turns",
): IndexedTableQuery {
  return ctx.db.query(table) as IndexedTableQuery;
}

async function findPresetForPersona(
  ctx: CardPersistenceContext,
  personaId: PersonaId,
): Promise<UnknownRow | null> {
  const rows = await cardsQuery(ctx)
    .withIndex("by_lineage", (q) => q.eq("lineagePersonaId", personaId))
    .collect();
  return rows.find((row) => row.isPreset === true) ?? null;
}

function requireCard(row: UnknownRow | null, cardId: string): UnknownRow {
  if (!row) throw new CardNotFoundError(cardId);
  return row;
}

function promptHashOf(card: UnknownRow): string {
  const promptHash = card.promptHash;
  if (typeof promptHash !== "string") {
    throw new Error(`Card ${card._id} has invalid promptHash`);
  }
  return promptHash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(row: UnknownRow, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(row: UnknownRow, field: string): number | undefined {
  const value = row[field];
  return typeof value === "number" ? value : undefined;
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new Error(`Expected ${field} to be a string`);
  }
  return value;
}

function numberField(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== "number") {
    throw new Error(`Expected ${field} to be a number`);
  }
  return value;
}

function recordArray(row: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const value = row[field];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function tileField(row: Record<string, unknown>, field: string): { x: number; y: number } {
  const value = row[field];
  if (!isRecord(value)) throw new Error(`Expected ${field} to be a tile`);
  return { x: numberField(value, "x"), y: numberField(value, "y") };
}

function adaptCardStatsTurns(turnRows: UnknownRow[]): CardStatsTurnRow[] {
  return turnRows.map((turnRow) => {
    const resolution = isRecord(turnRow.resolution) ? turnRow.resolution : {};
    return {
      turn: numberField(turnRow, "turn"),
      agentRecords: recordArray(turnRow, "agentRecords").map((record) => ({
        characterId: stringField(record, "characterId"),
        personaId: stringField(record, "personaId"),
        displayName: optionalString(record as UnknownRow, "displayName"),
      })),
      resolution: {
        moves: recordArray(resolution, "moves").map((move) => ({
          characterId: stringField(move, "characterId"),
          from: tileField(move, "from"),
          to: tileField(move, "to"),
          blockedBy: move.blockedBy === "wall" ? "wall" : undefined,
          bodyCollision: isRecord(move.bodyCollision)
            ? move.bodyCollision.kind === "wall"
              ? {
                  kind: "wall" as const,
                  wallRectId: stringField(move.bodyCollision, "wallRectId"),
                }
              : {
                  kind: "character" as const,
                  defenderId: stringField(move.bodyCollision, "defenderId"),
                }
            : undefined,
        })),
        actions: recordArray(resolution, "actions").map((action) => ({
          characterId: stringField(action, "characterId"),
          kind: stringField(action, "kind"),
          target: stringField(action, "target"),
          result: stringField(action, "result"),
        })),
        deaths: stringArrayField(resolution, "deaths"),
        environmentalDeaths: stringArrayField(resolution, "environmentalDeaths"),
      },
    };
  });
}

function stringArrayField(row: Record<string, unknown>, field: string): string[] {
  const value = row[field];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function adaptCardStatsCharacters(
  characterRows: UnknownRow[],
): CardStatsCharacterRow[] {
  return characterRows.map((character) => ({
    _id: character._id,
    cardId: optionalString(character, "cardId"),
    personaId: optionalString(character, "personaId"),
    displayName: optionalString(character, "displayName"),
    diedAtTurn: optionalNumber(character, "diedAtTurn"),
    extractedAtTurn: optionalNumber(character, "extractedAtTurn"),
  }));
}

function adaptCardStatsOutcome(matchRow: UnknownRow): CardStatsOutcome {
  const outcome = isRecord(matchRow.outcome) ? matchRow.outcome : {};
  return {
    pointsByCharacter: recordArray(outcome, "pointsByCharacter").map((points) => ({
      id: stringField(points, "id"),
      points: numberField(points, "points"),
    })),
  };
}

function accumulatorNumber(card: UnknownRow, field: keyof CardAccumulatorPatch): number {
  return numberField(card, field);
}

async function patchCardAccumulator(
  ctx: CardPersistenceContext,
  delta: CardAccumulatorPatch & { cardId: string },
): Promise<void> {
  const card = requireCard(await ctx.db.get(delta.cardId), delta.cardId);
  await ctx.db.patch(delta.cardId, {
    prizeUnitsWon: accumulatorNumber(card, "prizeUnitsWon") + delta.prizeUnitsWon,
    matchesPlayed: accumulatorNumber(card, "matchesPlayed") + delta.matchesPlayed,
    kills: accumulatorNumber(card, "kills") + delta.kills,
    deaths: accumulatorNumber(card, "deaths") + delta.deaths,
    wallFaceSlams: accumulatorNumber(card, "wallFaceSlams") + delta.wallFaceSlams,
  });
}

export async function seedPresetCards(
  ctx: CardPersistenceContext,
  opts: { now?: number } = {},
): Promise<{ inserted: number; existing: number; total: number }> {
  const createdAt = opts.now ?? Date.now();
  let inserted = 0;
  let existing = 0;

  for (const personaId of PERSONA_IDS) {
    const text = PERSONAS_INLINE[personaId];
    const { hash } = await getOrCreatePromptByHash(ctx, {
      kind: "persona",
      text,
    });
    const preset = await findPresetForPersona(ctx, personaId);
    if (preset) {
      existing += 1;
      continue;
    }

    await ctx.db.insert(
      "cards",
      zeroCardFields({
        agentName: titleCase(personaId),
        promptHash: hash,
        lineagePersonaId: personaId,
        isPreset: true,
        createdAt,
      }),
    );
    inserted += 1;
  }

  return { inserted, existing, total: inserted + existing };
}

export async function createCardRecord(
  ctx: CardPersistenceContext,
  args: {
    agentName: string;
    promptText: string;
    lineagePersonaId: PersonaId;
  },
): Promise<{ cardId: string; promptHash: string; promptId: string }> {
  const { hash, promptId } = await getOrCreatePromptByHash(ctx, {
    kind: "persona",
    text: args.promptText,
  });
  const cardId = await ctx.db.insert(
    "cards",
    zeroCardFields({
      agentName: args.agentName,
      promptHash: hash,
      lineagePersonaId: args.lineagePersonaId,
      isPreset: false,
      createdAt: Date.now(),
    }),
  );
  return { cardId, promptHash: hash, promptId };
}

export async function getCardRecord(
  ctx: CardPersistenceContext,
  args: { cardId: string },
): Promise<UnknownRow | null> {
  return await ctx.db.get(args.cardId);
}

export async function listCardRecords(
  ctx: CardPersistenceContext,
): Promise<UnknownRow[]> {
  return await cardsQuery(ctx).collect();
}

export async function updateCardPromptRecord(
  ctx: CardPersistenceContext,
  args: { cardId: string; promptText: string },
): Promise<{
  cardId: string;
  previousPromptHash: string;
  promptHash: string;
  promptId: string;
  changed: boolean;
}> {
  const card = requireCard(await ctx.db.get(args.cardId), args.cardId);
  const previousPromptHash = promptHashOf(card);
  const { hash, promptId } = await getOrCreatePromptByHash(ctx, {
    kind: "persona",
    text: args.promptText,
  });
  const changed = hash !== previousPromptHash;
  if (changed) {
    await ctx.db.patch(args.cardId, { promptHash: hash });
  }
  return {
    cardId: args.cardId,
    previousPromptHash,
    promptHash: hash,
    promptId,
    changed,
  };
}

export async function accrueFromMatchRecord(
  ctx: CardPersistenceContext,
  args: { matchId: string },
): Promise<CardAccrualResult> {
  const existing = await indexedQuery(ctx, "cardAccruals")
    .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
    .unique();
  if (existing) {
    return {
      applied: false,
      status: "already_accrued",
      accrualId: existing._id,
    };
  }

  const matchRow = await ctx.db.get(args.matchId);
  if (!matchRow) return { applied: false, status: "match_missing" };

  const matchStatus =
    typeof matchRow.status === "string" ? matchRow.status : "unknown";
  if (matchStatus !== "completed") {
    return {
      applied: false,
      status: "match_not_completed",
      matchStatus,
    };
  }

  const characterRows = await indexedQuery(ctx, "characters")
    .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
    .collect();
  const cardBackedCharacters = characterRows.filter(
    (character) => typeof character.cardId === "string",
  );
  if (cardBackedCharacters.length === 0) {
    return {
      applied: false,
      status: "no_card_characters",
      cardBackedCharacters: 0,
    };
  }

  const turnRows = await indexedQuery(ctx, "turns")
    .withIndex("by_match_turn", (q) => q.eq("matchId", args.matchId))
    .order("asc")
    .collect();

  const deltas = aggregateCardStats(
    adaptCardStatsTurns(turnRows),
    adaptCardStatsCharacters(characterRows),
    adaptCardStatsOutcome(matchRow),
  );

  for (const delta of deltas) {
    await patchCardAccumulator(ctx, delta);
  }

  const accrualId = await ctx.db.insert("cardAccruals", {
    matchId: args.matchId,
  });

  return {
    applied: true,
    status: "applied",
    accrualId,
    cardsPatched: deltas.length,
    cardBackedCharacters: cardBackedCharacters.length,
  };
}

export const seedPresets = mutation({
  args: {},
  handler: async (ctx) =>
    await seedPresetCards(ctx as unknown as CardPersistenceContext),
});

export const create = mutation({
  args: {
    agentName: v.string(),
    promptText: v.string(),
    lineagePersonaId: personaIdValidator,
  },
  handler: async (ctx, args) =>
    await createCardRecord(ctx as unknown as CardPersistenceContext, args),
});

export const get = query({
  args: { cardId: v.id("cards") },
  handler: async (ctx, args) =>
    await getCardRecord(ctx as unknown as CardPersistenceContext, args),
});

export const list = query({
  args: {},
  handler: async (ctx) =>
    await listCardRecords(ctx as unknown as CardPersistenceContext),
});

export const updatePrompt = mutation({
  args: {
    cardId: v.id("cards"),
    promptText: v.string(),
  },
  handler: async (ctx, args) =>
    await updateCardPromptRecord(
      ctx as unknown as CardPersistenceContext,
      args,
    ),
});

export const accrueFromMatch = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) =>
    await accrueFromMatchRecord(
      ctx as unknown as CardPersistenceContext,
      args,
    ),
});
