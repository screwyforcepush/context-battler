import { describe, expect, it } from "vitest";
import {
  normaliseCharacterTargetId,
  normaliseCorpseTargetId,
  resolveTypedEntity,
} from "../../convex/llm/idNormalisation.js";
import type {
  CharacterState,
  ChestState,
  CorpseState,
  MatchState,
  PersonaId,
  Tile,
  WorldState,
} from "../../convex/engine/types.js";

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    size: { w: 120, h: 120 },
    walls: [],
    coverTiles: [],
    chests: [],
    corpses: [],
    evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null },
    ...overrides,
  };
}

function makeCharacter(opts: {
  id: string;
  displayName: string;
  pos: Tile;
  alive?: boolean;
  hidden?: boolean;
  personaId?: PersonaId;
}): CharacterState {
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.displayName,
    hp: opts.alive === false ? 0 : 50,
    maxHp: 50,
    pos: opts.pos,
    equipped: {},
    scratchpad: "",
    hidden: opts.hidden ?? false,
    alive: opts.alive ?? true,
    lastKnown: [],
  };
}

function makeChest(id: string, pos: Tile): ChestState {
  return { id, pos, contents: null, opened: false, lootTable: "starter" };
}

function makeCorpse(characterId: string, pos: Tile): CorpseState {
  return { characterId, pos, contents: {} };
}

function makeState(opts: {
  characters: CharacterState[];
  world?: Partial<WorldState>;
}): MatchState {
  return {
    matchId: "test-match",
    turn: 31,
    world: makeWorld(opts.world),
    characters: opts.characters,
    rngSeed: "test-seed",
  };
}

function makeVisibleFixture(): MatchState {
  const observer = makeCharacter({
    id: "opaque_observer_id",
    displayName: "Rat",
    pos: { x: 50, y: 50 },
    personaId: "rat",
  });
  const camper = makeCharacter({
    id: "opaque_character_camper",
    displayName: "Camper",
    pos: { x: 54, y: 50 },
    personaId: "camper",
  });
  const deadVulture = makeCharacter({
    id: "opaque_character_vulture",
    displayName: "Vulture",
    pos: { x: 58, y: 51 },
    alive: false,
    personaId: "vulture",
  });

  return makeState({
    characters: [observer, camper, deadVulture],
    world: {
      chests: [makeChest("chest_006", { x: 56, y: 50 })],
      corpses: [makeCorpse("opaque_character_vulture", { x: 58, y: 50 })],
      coverTiles: [{ x: 54, y: 42 }],
      walls: [{ x: 64, y: 30, w: 1, h: 1 }],
      evac: { centre: { x: 52, y: 52 }, revealedAtTurn: 30 },
    },
  });
}

describe("resolveTypedEntity", () => {
  it("resolves every visible typed target namespace with tile and stop range", () => {
    const state = makeVisibleFixture();
    const observerId = "opaque_observer_id";

    expect(resolveTypedEntity(state, observerId, "Camper")).toEqual({
      kind: "character",
      tile: { x: 54, y: 50 },
      stopAtRange: 2,
      engineRef: { characterId: "opaque_character_camper" },
    });
    expect(resolveTypedEntity(state, observerId, "Chest_006")).toEqual({
      kind: "chest",
      tile: { x: 56, y: 50 },
      stopAtRange: 2,
      engineRef: { chestId: "chest_006" },
    });
    expect(resolveTypedEntity(state, observerId, "chest_006")).toEqual({
      kind: "chest",
      tile: { x: 56, y: 50 },
      stopAtRange: 2,
      engineRef: { chestId: "chest_006" },
    });
    expect(resolveTypedEntity(state, observerId, "Corpse_Vulture")).toEqual({
      kind: "corpse",
      tile: { x: 58, y: 50 },
      stopAtRange: 2,
    });
    expect(resolveTypedEntity(state, observerId, "Cover_54_42")).toEqual({
      kind: "cover",
      tile: { x: 54, y: 42 },
      stopAtRange: 0,
    });
    expect(resolveTypedEntity(state, observerId, "Wall_64_30")).toEqual({
      kind: "wall",
      tile: { x: 64, y: 30 },
      stopAtRange: 1,
    });
    expect(resolveTypedEntity(state, observerId, "Evac")).toEqual({
      kind: "evac",
      tile: { x: 52, y: 52 },
      stopAtRange: 0,
    });
  });

  it("bridges persona display ids to opaque engine character ids", () => {
    const state = makeVisibleFixture();
    expect(
      resolveTypedEntity(state, "opaque_observer_id", "Camper")?.engineRef,
    ).toEqual({ characterId: "opaque_character_camper" });
  });

  it("normalises character and corpse persona ids directly", () => {
    const state = makeVisibleFixture();
    expect(normaliseCharacterTargetId("Camper", state.characters)).toBe(
      "opaque_character_camper",
    );
    expect(normaliseCorpseTargetId("Corpse_Vulture", state.characters)).toBe(
      "opaque_character_vulture",
    );
  });

  it("returns null for unknown, malformed, hidden, dead, unrevealed, and out-of-vision targets", () => {
    const observer = makeCharacter({
      id: "opaque_observer_id",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
      personaId: "rat",
    });
    const hidden = makeCharacter({
      id: "opaque_character_paranoid",
      displayName: "Paranoid",
      pos: { x: 55, y: 50 },
      hidden: true,
      personaId: "paranoid",
    });
    const dead = makeCharacter({
      id: "opaque_character_trader",
      displayName: "Trader",
      pos: { x: 56, y: 50 },
      alive: false,
      personaId: "trader",
    });
    const far = makeCharacter({
      id: "opaque_character_sprinter",
      displayName: "Sprinter",
      pos: { x: 80, y: 50 },
      personaId: "sprinter",
    });
    const deadFar = makeCharacter({
      id: "opaque_character_opportunist",
      displayName: "Opportunist",
      pos: { x: 81, y: 50 },
      alive: false,
      personaId: "opportunist",
    });
    const state = makeState({
      characters: [observer, hidden, dead, far, deadFar],
      world: {
        chests: [makeChest("chest_099", { x: 80, y: 50 })],
        corpses: [makeCorpse("opaque_character_9", { x: 82, y: 50 })],
        coverTiles: [{ x: 80, y: 50 }],
        walls: [{ x: 80, y: 51, w: 1, h: 1 }],
        evac: { centre: { x: 52, y: 52 }, revealedAtTurn: null },
      },
    });

    for (const targetId of [
      "Random_42",
      "Cover_foo_bar",
      "Paranoid",
      "Trader",
      "Sprinter",
      "Chest_099",
      "Corpse_Opportunist",
      "Cover_80_50",
      "Wall_80_51",
      "Evac",
    ]) {
      expect(
        resolveTypedEntity(state, "opaque_observer_id", targetId),
        targetId,
      ).toBeNull();
    }
  });

  it("dispatches Corpse_Vulture as a corpse id, not a character id", () => {
    const state = makeVisibleFixture();
    const resolved = resolveTypedEntity(
      state,
      "opaque_observer_id",
      "Corpse_Vulture",
    );

    expect(resolved).toEqual({
      kind: "corpse",
      tile: { x: 58, y: 50 },
      stopAtRange: 2,
    });
  });
});
