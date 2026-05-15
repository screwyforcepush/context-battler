// Phase 6 live integration tests against the real Azure Responses deployment.
//
// Skipped by default. Run with:
//   set -a; source .env; set +a
//   VITEST_LLM=1 npm test -- tests/llm/integration.test.ts 2>&1 | tee /tmp/phase6-live-azure-iter2.log
//
// This file intentionally exercises the iter-2 per-turn contract only:
// `use`, `position`, `action`, `say`, and `scratchpad`.

import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import type {
  CharacterState,
  MatchState,
  PersonaId,
  Tile,
  UseVariant,
  WorldState,
} from "../../convex/engine/types.js";
import { titleCase } from "../../convex/engine/types.js";
import { callDecisionTool } from "../../convex/llm/azure.js";
import { parseDecision } from "../../convex/llm/decisionTool.js";
import { buildAgentInput } from "../../convex/llm/inputBuilder.js";

loadDotenv();

const SHOULD_RUN = !!process.env.VITEST_LLM;

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  const world: WorldState = {
    size: { w: 100, h: 100 },
    walls: [],
    coverClusters: [],
    coverTiles: [
      { x: 11, y: 10 },
      { x: 10, y: 11 },
    ],
    crates: [
      {
        id: "Crate_14_10",
        pos: { x: 14, y: 10 },
        contents: { category: "weapon", name: "sword" },
        opened: false,
      },
    ],
    airdrops: [],
    corpses: [],
    evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null },
    ...overrides,
  };
  if (world.coverClusters.length === 0 && world.coverTiles.length > 0) {
    world.coverClusters = world.coverTiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      w: 1,
      h: 1,
    }));
  }
  return world;
}

function makeCharacter(opts: {
  id: string;
  personaId: PersonaId;
  pos: Tile;
  weapon?: "rusty_blade" | "sword" | "axe" | "greatsword";
  armour?: "cloth" | "leather" | "chain" | "plate";
  consumable?: "heal" | "speed";
  scratchpad?: string;
}): CharacterState {
  const equipped: CharacterState["equipped"] = {};
  if (opts.weapon) equipped.weapon = { category: "weapon", name: opts.weapon };
  if (opts.armour) equipped.armour = { category: "armour", name: opts.armour };
  if (opts.consumable) {
    equipped.consumable = { category: "consumable", name: opts.consumable };
  }

  return {
    characterId: opts.id,
    personaId: opts.personaId,
    spawnIndex: 0,
    displayName: titleCase(opts.personaId),
    hp: 50,
    maxHp: 50,
    pos: opts.pos,
    equipped,
    scratchpad: opts.scratchpad ?? "",
    hidden: false,
    alive: true,
    lastKnown: [],
  };
}

function makeIntegrationInput(useVariant: UseVariant) {
  const actor = makeCharacter({
    id: "c_duelist",
    personaId: "duelist",
    pos: { x: 10, y: 10 },
    weapon: "rusty_blade",
    armour: "leather",
    consumable: useVariant === "consumable_or_null" ? "speed" : undefined,
    scratchpad: "Turn 9. Camper is east. Crate_14_10 is reachable.",
  });
  const enemy = makeCharacter({
    id: "c_camper",
    personaId: "camper",
    pos: { x: 15, y: 10 },
    weapon: "axe",
    armour: "cloth",
  });
  const state: MatchState = {
    matchId: `live-iter2-${useVariant}`,
    turn: 9,
    world: makeWorld(),
    characters: [actor, enemy],
    rngSeed: "phase6-live-integration",
  };
  const personaPrompt = [
    "You prefer direct pressure and decisive attacks.",
    "Use the visible ids exactly as written when targeting enemies or loot.",
  ].join(" ");
  const built = buildAgentInput(state, actor.characterId, personaPrompt, null, 2);

  return {
    systemPrompt: built.systemPrompt,
    personaPrompt,
    scratchpad: actor.scratchpad,
    visibleStateDigest: built.visibleStateDigest,
    composedUserMessage: built.composedUserMessage,
    playerName: actor.displayName,
    useVariant,
    reasoningEffort: "low" as const,
    maxOutputTokens: 1200,
  };
}

function expectIter2DecisionSurface(value: Record<string, unknown>) {
  expect(Object.keys(value).sort()).toEqual([
    "action",
    "position",
    "say",
    "scratchpad",
    "use",
  ]);
  expect(value).not.toHaveProperty("primary");
  expect(value).not.toHaveProperty("move");
  expect(value).not.toHaveProperty("overwatch_stance");
  expect(value).not.toHaveProperty("consume");
  expect(value).not.toHaveProperty("scratchpad_update");
}

describe.skipIf(!SHOULD_RUN)("Phase 6 Azure live integration (VITEST_LLM=1)", () => {
  it.each([
    "consumable_or_null",
    "null_only",
  ] as const satisfies readonly UseVariant[])(
    "round-trips an iter-2 decision for useVariant=%s",
    async (useVariant) => {
      const input = makeIntegrationInput(useVariant);
      const result = await callDecisionTool(input);

      process.stdout.write(
        [
          `[phase6 live] useVariant=${useVariant}`,
          `latencyMs=${result.raw.latencyMs}`,
          `httpStatus=${result.raw.httpStatus ?? "<none>"}`,
          `fellBack=${result.fellBackToSafeDefault}`,
          `failureReason=${result.failureReason ?? "<none>"}`,
          `rawArguments=${result.rawArguments ?? "<null>"}`,
        ].join(" ") + "\n",
      );

      if (result.fellBackToSafeDefault) {
        throw new Error(
          `wrapper fell back; failureReason=${result.failureReason}, httpStatus=${result.raw.httpStatus}, rawArguments=${result.rawArguments}`,
        );
      }

      expect(result.failureReason).toBeUndefined();
      expect(result.callId).not.toBeNull();
      expect(result.rawArguments).not.toBeNull();
      expect(result.raw.responseId).not.toBeNull();
      expect(result.raw.httpStatus).toBe(200);

      const raw = JSON.parse(result.rawArguments!) as Record<string, unknown>;
      expectIter2DecisionSurface(raw);

      const parsed = parseDecision(result.rawArguments!, { useVariant });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expectIter2DecisionSurface(
          parsed.decision as unknown as Record<string, unknown>,
        );
        if (useVariant === "null_only") {
          expect(parsed.decision.use).toBeNull();
        }
      }
    },
    90_000,
  );
});
