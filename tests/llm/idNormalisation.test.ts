import { describe, expect, it } from "vitest";
import {
  normaliseCharacterTargetId,
  normaliseCorpseTargetId,
  parsePositionId,
  resolveTypedEntity,
  visibleTargetIds,
} from "../../convex/llm/idNormalisation.js";
import type {
  CharacterState,
  ChestState,
  CorpseState,
  MatchState,
  PersonaId,
  Tile,
  Wall,
  WorldState,
} from "../../convex/engine/types.js";

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  const world: WorldState = {
    size: { w: 120, h: 120 },
    walls: [],
    coverClusters: [],
    coverTiles: [],
    chests: [],
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

function tilesForRect(rect: Wall): Tile[] {
  const tiles: Tile[] = [];
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
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
      chests: [makeChest("Chest_56_50", { x: 56, y: 50 })],
      corpses: [makeCorpse("opaque_character_vulture", { x: 58, y: 50 })],
      coverClusters: [{ x: 54, y: 42, w: 1, h: 1 }],
      coverTiles: [{ x: 54, y: 42 }],
      walls: [{ x: 64, y: 30, w: 1, h: 1 }],
      evac: { centre: { x: 52, y: 52 }, revealedAtTurn: 30 },
    },
  });
}

describe("parsePositionId", () => {
  it("parses multi-tile rect keys and single-tile keys", () => {
    expect(parsePositionId("Wall_18_18_to_23_18", "Wall")).toEqual({
      kind: "rect",
      rect: { x: 18, y: 18, w: 6, h: 1 },
    });
    expect(parsePositionId("Cover_42_42_to_43_43", "Cover")).toEqual({
      kind: "rect",
      rect: { x: 42, y: 42, w: 2, h: 2 },
    });
    expect(parsePositionId("Evac_47_47_to_49_49", "Evac")).toEqual({
      kind: "rect",
      rect: { x: 47, y: 47, w: 3, h: 3 },
    });
    expect(parsePositionId("Wall_30_60", "Wall")).toEqual({
      kind: "single",
      tile: { x: 30, y: 60 },
      rect: { x: 30, y: 60, w: 1, h: 1 },
    });
  });

  it("rejects malformed and inverted rect ids", () => {
    expect(parsePositionId("Wall_18_18_to_17_18", "Wall")).toBeNull();
    expect(parsePositionId("Wall_18_x_to_23_18", "Wall")).toBeNull();
    expect(parsePositionId("Cover_18_18_to_23_18", "Wall")).toBeNull();
  });
});

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
    expect(resolveTypedEntity(state, observerId, "Chest_56_50")).toEqual({
      kind: "chest",
      tile: { x: 56, y: 50 },
      stopAtRange: 2,
      engineRef: { chestId: "Chest_56_50" },
    });
    expect(resolveTypedEntity(state, observerId, "chest_legacy")).toBeNull();
    expect(resolveTypedEntity(state, observerId, "Corpse_Vulture")).toEqual({
      kind: "corpse",
      tile: { x: 58, y: 50 },
      stopAtRange: 2,
    });
    expect(resolveTypedEntity(state, observerId, "Cover_54_42")).toEqual({
      kind: "cover",
      tile: { x: 54, y: 42 },
      stopAtRange: 0,
      rect: { x: 54, y: 42, w: 1, h: 1 },
    });
    expect(resolveTypedEntity(state, observerId, "Wall_64_30")).toEqual({
      kind: "wall",
      tile: { x: 64, y: 30 },
      stopAtRange: 1,
      rect: { x: 64, y: 30, w: 1, h: 1 },
    });
    expect(resolveTypedEntity(state, observerId, "Evac_51_51_to_53_53")).toEqual({
      kind: "evac",
      tile: { x: 51, y: 51 },
      stopAtRange: 0,
      rect: { x: 51, y: 51, w: 3, h: 3 },
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
        chests: [makeChest("Chest_80_50", { x: 80, y: 50 })],
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
      "Chest_80_50",
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

  it("resolves rect ids to nearest tiles and includes the canonical rect for wall, cover, and evac", () => {
    const observer = makeCharacter({
      id: "opaque_observer_id",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
      personaId: "rat",
    });
    const wall: Wall = { x: 55, y: 48, w: 6, h: 1 };
    const cover: Wall = { x: 47, y: 54, w: 3, h: 3 };
    const state = makeState({
      characters: [observer],
      world: {
        walls: [wall],
        coverClusters: [cover],
        coverTiles: tilesForRect(cover),
        evac: { centre: { x: 80, y: 80 }, revealedAtTurn: 30 },
      },
    });

    expect(
      resolveTypedEntity(state, "opaque_observer_id", "Wall_55_48_to_60_48"),
    ).toEqual({
      kind: "wall",
      tile: { x: 55, y: 48 },
      stopAtRange: 1,
      rect: wall,
    });
    expect(
      resolveTypedEntity(state, "opaque_observer_id", "Cover_47_54_to_49_56"),
    ).toEqual({
      kind: "cover",
      tile: { x: 49, y: 54 },
      stopAtRange: 0,
      rect: cover,
    });
    expect(
      resolveTypedEntity(state, "opaque_observer_id", "Evac_79_79_to_81_81"),
    ).toEqual({
      kind: "evac",
      tile: { x: 79, y: 79 },
      stopAtRange: 0,
      rect: { x: 79, y: 79, w: 3, h: 3 },
    });
  });

  it("accepts single-tile rect ids only when the world has a matching 1x1 rect", () => {
    const observer = makeCharacter({
      id: "opaque_observer_id",
      displayName: "Rat",
      pos: { x: 30, y: 59 },
      personaId: "rat",
    });
    const single = makeState({
      characters: [observer],
      world: { walls: [{ x: 30, y: 60, w: 1, h: 1 }] },
    });
    const multi = makeState({
      characters: [observer],
      world: { walls: [{ x: 30, y: 60, w: 2, h: 1 }] },
    });

    expect(resolveTypedEntity(single, "opaque_observer_id", "Wall_30_60")).toEqual({
      kind: "wall",
      tile: { x: 30, y: 60 },
      stopAtRange: 1,
      rect: { x: 30, y: 60, w: 1, h: 1 },
    });
    expect(resolveTypedEntity(multi, "opaque_observer_id", "Wall_30_60")).toBeNull();
    expect(
      resolveTypedEntity(multi, "opaque_observer_id", "Wall_30_60_to_31_60"),
    ).toEqual({
      kind: "wall",
      tile: { x: 30, y: 60 },
      stopAtRange: 1,
      rect: { x: 30, y: 60, w: 2, h: 1 },
    });
  });

  it("rejects hallucinated rect ids that do not match a visible world rect", () => {
    const observer = makeCharacter({
      id: "opaque_observer_id",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
      personaId: "rat",
    });
    const state = makeState({
      characters: [observer],
      world: {
        walls: [{ x: 55, y: 48, w: 6, h: 1 }],
        coverClusters: [{ x: 47, y: 54, w: 3, h: 3 }],
        coverTiles: tilesForRect({ x: 47, y: 54, w: 3, h: 3 }),
        evac: { centre: { x: 80, y: 80 }, revealedAtTurn: 30 },
      },
    });

    expect(
      resolveTypedEntity(state, "opaque_observer_id", "Wall_56_48_to_60_48"),
    ).toBeNull();
    expect(
      resolveTypedEntity(state, "opaque_observer_id", "Cover_47_54_to_49_55"),
    ).toBeNull();
    expect(
      resolveTypedEntity(state, "opaque_observer_id", "Evac_78_79_to_80_81"),
    ).toBeNull();
  });

  it("emits canonical rect target ids for visible walls, cover, and evac without per-tile or bare Evac ids", () => {
    const observer = makeCharacter({
      id: "opaque_observer_id",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
      personaId: "rat",
    });
    const cover: Wall = { x: 47, y: 50, w: 2, h: 2 };
    const state = makeState({
      characters: [observer],
      world: {
        walls: [{ x: 55, y: 50, w: 3, h: 1 }],
        coverClusters: [cover],
        coverTiles: tilesForRect(cover),
        evac: { centre: { x: 80, y: 80 }, revealedAtTurn: 30 },
      },
    });

    const ids = visibleTargetIds(state, "opaque_observer_id");

    expect(ids.has("Wall_55_50_to_57_50")).toBe(true);
    expect(ids.has("Cover_47_50_to_48_51")).toBe(true);
    expect(ids.has("Evac_79_79_to_81_81")).toBe(true);
    expect(ids.has("Wall_55_50")).toBe(false);
    expect(ids.has("Wall_56_50")).toBe(false);
    expect(ids.has("Wall_57_50")).toBe(false);
    expect(ids.has("Cover_47_50")).toBe(false);
    expect(ids.has("Cover_48_51")).toBe(false);
    expect(ids.has("Evac")).toBe(false);
  });
});
