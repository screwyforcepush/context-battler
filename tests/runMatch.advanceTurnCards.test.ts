import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Doc } from "../convex/_generated/dataModel.js";
import { hashHex } from "../convex/engine/hash.js";
import {
  CHARACTER_MAX_HP,
  SAFE_DEFAULT_DECISION,
  type PersonaId,
} from "../convex/engine/types.js";
import { loadPersonas } from "../convex/llm/personas.js";
import type { CallResult } from "../convex/llm/azure.js";

vi.mock("../convex/llm/azure.js", () => ({
  callDecisionTool: vi.fn(),
}));

const { advanceTurn } = await import("../convex/runMatch.js");
const { callDecisionTool } = await import("../convex/llm/azure.js");

const advanceTurnHandler = (
  advanceTurn as unknown as {
    _handler: (ctx: FakeAdvanceTurnCtx, args: { matchId: string }) => Promise<null>;
  }
)._handler;
const mockedCallDecisionTool = vi.mocked(callDecisionTool);

type PersistTurnArgs = {
  matchId: string;
  turn: number;
  terminal: boolean;
  agentRecords: Array<{
    characterId: string;
    input: { personaPromptHash: string; systemPromptHash: string };
  }>;
  promptTexts: Array<{ kind: "system" | "persona"; hash: string; text: string }>;
};

class FakeScheduler {
  readonly calls: Array<{ delayMs: number; fnName: string; args: unknown }> = [];

  async runAfter(delayMs: number, fn: unknown, args: unknown) {
    this.calls.push({
      delayMs,
      fnName: getFunctionName(fn as never),
      args,
    });
  }
}

class FakeAdvanceTurnCtx {
  readonly scheduler = new FakeScheduler();
  readonly promptLookupCalls: string[][] = [];
  readonly persistedTurns: PersistTurnArgs[] = [];
  readonly failures: Array<{ matchId: string; turn: number; reason: string }> = [];

  constructor(
    readonly data: {
      match: Doc<"matches">;
      characters: Doc<"characters">[];
      promptsByHash?: Map<string, string>;
      priorTurn?: unknown;
      world?: Doc<"worldState">;
      worldStatic?: Doc<"worldStatic">;
    },
  ) {}

  async runQuery(fn: unknown, args: Record<string, unknown>) {
    const name = getFunctionName(fn as never);
    if (name === "matches:get") return this.data.match;
    if (name === "_internal_runMatch:charactersByMatch") return this.data.characters;
    if (name === "_internal_runMatch:worldByMatch") {
      return this.data.world ?? worldRow(this.data.match._id);
    }
    if (name === "_internal_runMatch:worldStaticByMatch") {
      return this.data.worldStatic ?? worldStaticRow(this.data.match._id);
    }
    if (name === "_internal_runMatch:turnByMatchTurn") {
      return this.data.priorTurn ?? null;
    }
    if (name === "_internal_runMatch:personaPromptsByHashes") {
      const hashes = args.hashes as string[];
      this.promptLookupCalls.push([...hashes]);
      return hashes.map((hash) => {
        const text = this.data.promptsByHash?.get(hash);
        if (text === undefined) {
          throw new Error(
            `runMatch.advanceTurn: persona prompt missing for cardPromptHash ${hash}`,
          );
        }
        return { hash, text };
      });
    }
    throw new Error(`unexpected query ${name}`);
  }

  async runMutation(fn: unknown, args: Record<string, unknown>) {
    const name = getFunctionName(fn as never);
    if (name === "_internal_runMatch:persistTurn") {
      this.persistedTurns.push(args as PersistTurnArgs);
      return null;
    }
    if (name === "_internal_runMatch:markFailed") {
      this.failures.push(
        args as { matchId: string; turn: number; reason: string },
      );
      return null;
    }
    if (name === "_internal_runMatch:markRunning") return null;
    throw new Error(`unexpected mutation ${name}`);
  }
}

function mockLlmSuccesses() {
  mockedCallDecisionTool.mockImplementation(async () => {
    const index = mockedCallDecisionTool.mock.calls.length;
    return {
      decision: SAFE_DEFAULT_DECISION,
      callId: `call_${index}`,
      rawArguments: JSON.stringify(SAFE_DEFAULT_DECISION),
      fellBackToSafeDefault: false,
      raw: {
        responseId: `resp_${index}`,
        usage: null,
        latencyMs: 1,
        httpStatus: 200,
        retried: false,
        reasoning: null,
      },
    } satisfies CallResult;
  });
}

function matchRow(overrides: Partial<Doc<"matches">> = {}): Doc<"matches"> {
  return {
    _id: "match_wp4" as Doc<"matches">["_id"],
    _creationTime: 0,
    status: "running",
    turn: 49,
    startedAt: 0,
    completedAt: null,
    mapId: "reference",
    rngSeed: "wp4-seed",
    outcome: { extracted: [], pointsByCharacter: [] },
    ...overrides,
  } as Doc<"matches">;
}

type CharacterRowOverrides = Omit<
  Partial<Doc<"characters">>,
  "_id" | "personaId" | "displayName" | "spawnIndex"
> & {
    _id: string;
    personaId: PersonaId;
    displayName: string;
    spawnIndex: number;
  };

function characterRow(overrides: CharacterRowOverrides): Doc<"characters"> {
  return {
    _creationTime: 0,
    matchId: "match_wp4",
    hp: CHARACTER_MAX_HP,
    pos: { x: 10 + overrides.spawnIndex, y: 10 },
    equipped: {},
    scratchpad: "",
    hidden: false,
    alive: true,
    lastKnown: [],
    ...overrides,
  } as unknown as Doc<"characters">;
}

function worldRow(matchId: string): Doc<"worldState"> {
  return {
    _id: "world_wp4",
    _creationTime: 0,
    matchId,
    crates: [],
    airdrops: [],
    corpses: [],
    evac: { centre: { x: 48, y: 48 }, revealedAtTurn: null },
  } as unknown as Doc<"worldState">;
}

function worldStaticRow(matchId: string): Doc<"worldStatic"> {
  return {
    _id: "world_static_wp4",
    _creationTime: 0,
    matchId,
    walls: [],
    coverClusters: [],
    coverTiles: [],
  } as unknown as Doc<"worldStatic">;
}

beforeEach(() => {
  mockedCallDecisionTool.mockReset();
  mockLlmSuccesses();
});

describe("Phase 13 WP4 advanceTurn Card prompt branch", () => {
  it("loads each distinct pinned cardPromptHash once and sends pinned prompt text to the LLM", async () => {
    const pinnedPromptText = "Pinned Card prompt, not the Rat persona.";
    const pinnedHash = hashHex(pinnedPromptText);
    const match = matchRow();
    const ctx = new FakeAdvanceTurnCtx({
      match,
      characters: [
        characterRow({
          _id: "char_alpha",
          personaId: "rat",
          displayName: "Alpha",
          spawnIndex: 0,
          cardId: "card_alpha" as Doc<"cards">["_id"],
          cardPromptHash: pinnedHash,
        }),
        characterRow({
          _id: "char_beta",
          personaId: "duelist",
          displayName: "Beta",
          spawnIndex: 1,
          cardId: "card_beta" as Doc<"cards">["_id"],
          cardPromptHash: pinnedHash,
        }),
      ],
      promptsByHash: new Map([[pinnedHash, pinnedPromptText]]),
    });

    await advanceTurnHandler(ctx, { matchId: match._id });

    expect(ctx.promptLookupCalls).toEqual([[pinnedHash]]);
    expect(
      mockedCallDecisionTool.mock.calls.map(([args]) => args.personaPrompt),
    ).toEqual([pinnedPromptText, pinnedPromptText]);
    expect(pinnedPromptText).not.toBe(loadPersonas().rat);
    const persisted = ctx.persistedTurns[0]!;
    expect(persisted.terminal).toBe(true);
    expect(
      persisted.agentRecords.map((record) => record.input.personaPromptHash),
    ).toEqual([pinnedHash, pinnedHash]);
    expect(persisted.promptTexts).toContainEqual({
      kind: "persona",
      hash: pinnedHash,
      text: pinnedPromptText,
    });
    expect(ctx.scheduler.calls).toEqual([
      {
        delayMs: 0,
        fnName: "runs:aggregate",
        args: { matchId: match._id },
      },
      {
        delayMs: 0,
        fnName: "cards:accrueFromMatch",
        args: { matchId: match._id },
      },
    ]);
  });

  it("keeps harness characters on the existing loadPersonas fallback and still schedules card accrual for the self-guard", async () => {
    const personas = loadPersonas();
    const match = matchRow();
    const ctx = new FakeAdvanceTurnCtx({
      match,
      characters: [
        characterRow({
          _id: "char_rat",
          personaId: "rat",
          displayName: "Rat",
          spawnIndex: 0,
        }),
      ],
    });

    await advanceTurnHandler(ctx, { matchId: match._id });

    expect(ctx.promptLookupCalls).toEqual([]);
    expect(mockedCallDecisionTool.mock.calls[0]?.[0].personaPrompt).toBe(
      personas.rat,
    );
    expect(ctx.persistedTurns[0]?.agentRecords[0]?.input.personaPromptHash).toBe(
      hashHex(personas.rat),
    );
    expect(ctx.scheduler.calls.map((call) => call.fnName)).toEqual([
      "runs:aggregate",
      "cards:accrueFromMatch",
    ]);
  });

  it("fails the turn clearly when a Card character's pinned prompt row is missing", async () => {
    const missingPromptText = "Missing pinned Card prompt.";
    const missingHash = hashHex(missingPromptText);
    const match = matchRow();
    const ctx = new FakeAdvanceTurnCtx({
      match,
      characters: [
        characterRow({
          _id: "char_alpha",
          personaId: "rat",
          displayName: "Alpha",
          spawnIndex: 0,
          cardId: "card_alpha" as Doc<"cards">["_id"],
          cardPromptHash: missingHash,
        }),
      ],
      promptsByHash: new Map(),
    });

    await advanceTurnHandler(ctx, { matchId: match._id });

    expect(mockedCallDecisionTool).not.toHaveBeenCalled();
    expect(ctx.persistedTurns).toEqual([]);
    expect(ctx.scheduler.calls).toEqual([]);
    expect(ctx.failures).toEqual([
      {
        matchId: match._id,
        turn: 50,
        reason: `runMatch.advanceTurn: persona prompt missing for cardPromptHash ${missingHash}`,
      },
    ]);
  });

  it("fails before prompt lookup or LLM calls if malformed data has more than 8 distinct cardPromptHash values", async () => {
    const match = matchRow();
    const characters = Array.from({ length: 9 }, (_, index) =>
      characterRow({
        _id: `char_${index}`,
        personaId: "rat",
        displayName: `Card ${index}`,
        spawnIndex: index,
        cardId: `card_${index}` as Doc<"cards">["_id"],
        cardPromptHash: hashHex(`prompt ${index}`),
      }),
    );
    const ctx = new FakeAdvanceTurnCtx({ match, characters });

    await advanceTurnHandler(ctx, { matchId: match._id });

    expect(ctx.promptLookupCalls).toEqual([]);
    expect(mockedCallDecisionTool).not.toHaveBeenCalled();
    expect(ctx.persistedTurns).toEqual([]);
    expect(ctx.failures).toEqual([
      {
        matchId: match._id,
        turn: 50,
        reason:
          "runMatch.advanceTurn: expected at most 8 distinct cardPromptHash values, received 9",
      },
    ]);
  });
});
