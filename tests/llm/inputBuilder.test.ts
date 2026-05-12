import { describe, expect, it } from "vitest";
import {
  buildAgentInput,
  buildKillFeedLines,
  buildVisibleStateDigest,
  renderDamageEventLines,
  type PrevTurnRow,
} from "../../convex/llm/inputBuilder.js";
import { SYSTEM_PROMPT } from "../../convex/llm/systemPrompt.js";
import { loadPersonas } from "../../convex/llm/personas.js";
import {
  PERSONA_IDS,
  titleCase,
  type CharacterState,
  type ChestState,
  type CorpseState,
  type MatchState,
  type PersonaId,
  type Tile,
  type Wall,
  type WorldState,
} from "../../convex/engine/types.js";

type VisibleObject = Record<string, Record<string, unknown>>;

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    size: { w: 100, h: 100 },
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
  pos: Tile;
  hp?: number;
  maxHp?: number;
  alive?: boolean;
  hidden?: boolean;
  weapon?: "rusty_blade" | "sword" | "axe" | "greatsword";
  armour?: "cloth" | "leather" | "chain" | "plate";
  consumable?: "heal" | "speed";
  personaId?: PersonaId;
  displayName?: string;
  scratchpad?: string;
}): CharacterState {
  const personaId = opts.personaId ?? "rat";
  const equipped: CharacterState["equipped"] = {};
  if (opts.weapon) {
    equipped.weapon = { category: "weapon", name: opts.weapon };
  }
  if (opts.armour) {
    equipped.armour = { category: "armour", name: opts.armour };
  }
  if (opts.consumable) {
    equipped.consumable = { category: "consumable", name: opts.consumable };
  }
  return {
    characterId: opts.id,
    personaId,
    spawnIndex: 0,
    displayName: opts.displayName ?? titleCase(personaId),
    hp: opts.hp ?? 50,
    maxHp: opts.maxHp ?? 50,
    pos: opts.pos,
    equipped,
    scratchpad: opts.scratchpad ?? "",
    hidden: opts.hidden ?? false,
    alive: opts.alive ?? true,
    lastKnown: [],
  };
}

function makeChest(id: string, pos: Tile, opened = false): ChestState {
  return { id, pos, contents: null, opened, lootTable: "starter" };
}

function makeCorpse(
  id: string,
  pos: Tile,
  contents: CorpseState["contents"] = {},
): CorpseState {
  return { characterId: id, pos, contents };
}

function makeState(opts: {
  characters: CharacterState[];
  world?: Partial<WorldState>;
  turn?: number;
}): MatchState {
  return {
    matchId: "test-match",
    turn: opts.turn ?? 1,
    world: makeWorld(opts.world),
    characters: opts.characters,
    rngSeed: "test",
  };
}

function makePrevTurn(
  partial: Partial<PrevTurnRow["resolution"]> = {},
): PrevTurnRow {
  return {
    resolution: {
      consumed: [],
      speech: [],
      moves: [],
      actions: [],
      deaths: [],
      visibilityUpdates: [],
      ...partial,
    },
  };
}

function parseVisible(
  state: MatchState,
  characterId: string,
  prev: PrevTurnRow | null = null,
): VisibleObject {
  return JSON.parse(buildVisibleStateDigest(state, characterId, prev)) as VisibleObject;
}

describe("Phase 6 input builder — composed user message", () => {
  it("pins the exact Status / Current Game State blank-line layout", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 44, y: 53 },
      hp: 35,
      maxHp: 50,
      weapon: "rusty_blade",
      consumable: "speed",
      scratchpad:
        "Armed rusty_blade. Pressure Vulture now. Close to range 2.",
    });
    const state = makeState({ characters: [me], turn: 44 });

    const built = buildAgentInput(
      state,
      "c_duelist",
      "Win direct fights.",
      null,
      1,
    );

    expect(built.composedUserMessage).toMatchInlineSnapshot(`
      "# Duelist
      You adopt Duelist persona:
      Win direct fights.

      ## Status
      📍(44,53)
      ❤️HP: 35/50 HP
      ⚔️weapon: rusty_blade [dmg 10]
      🛡️armour: none
      🧪consumable: speed [+4 move range max dist]
      🗒️scratchpad: Armed rusty_blade. Pressure Vulture now. Close to range 2.

      # Current Game State
      Turn 44, 1/8 players alive

      {}"
    `);
  });

  it("builds the status block, event log, and visible object with persona ids", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 44, y: 53 },
      hp: 35,
      maxHp: 50,
      weapon: "rusty_blade",
      armour: "leather",
      consumable: "speed",
      scratchpad: "Pressure Vulture now.",
    });
    const attacker = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 46, y: 53 },
      weapon: "axe",
    });
    const victim = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 47, y: 53 },
      hp: 0,
      alive: false,
    });
    const state = makeState({
      characters: [me, attacker, victim],
      turn: 44,
      world: { corpses: [makeCorpse("c_rat", { x: 47, y: 53 })] },
    });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "c_duelist",
          from: { x: 42, y: 51 },
          to: { x: 44, y: 53 },
        },
      ],
      actions: [
        {
          characterId: "c_duelist",
          kind: "attack",
          target: "Vulture",
          result: "dmg 10",
          weapon: "rusty_blade",
        },
        {
          characterId: "c_camper",
          kind: "counter",
          target: "Duelist",
          result: "dmg 8",
          weapon: "axe",
        },
        {
          characterId: "c_camper",
          kind: "attack",
          target: "Rat",
          result: "dmg 50",
          weapon: "axe",
        },
      ],
      speech: [
        { characterId: "c_duelist", text: "Hold range.", heardBy: [] },
      ],
      deaths: ["c_rat"],
    });

    const built = buildAgentInput(state, "c_duelist", "Win direct fights.", prev, 3);

    expect(built.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(built.composedUserMessage).toContain("# Duelist");
    expect(built.composedUserMessage).toContain("You adopt Duelist persona:");
    expect(built.composedUserMessage).toContain("## Status");
    expect(built.composedUserMessage).toContain("📍(44,53)");
    expect(built.composedUserMessage).toContain("❤️HP: 35/50 HP");
    expect(built.composedUserMessage).toContain("⚔️weapon: rusty_blade [dmg 10]");
    expect(built.composedUserMessage).toContain("🛡️armour: leather [-3 dmg]");
    expect(built.composedUserMessage).toContain(
      "🧪consumable: speed [+4 move range max dist]",
    );
    expect(built.composedUserMessage).toContain(
      "🗒️scratchpad: Pressure Vulture now.",
    );
    expect(built.composedUserMessage).toContain("# Current Game State");
    expect(built.composedUserMessage).toContain("Turn 44, 3/8 players alive");
    expect(built.composedUserMessage).toContain(
      "You moved 2 SE, attacked Vulture (dmg 10), said \"Hold range.\"",
    );
    expect(built.composedUserMessage).toContain(
      "Camper attacked you with axe (dmg 8)",
    );
    expect(built.composedUserMessage).toContain("Camper killed Rat with axe");

    const visible = JSON.parse(built.visibleStateDigest) as VisibleObject;
    expect(visible.Camper).toMatchObject({
      kind: "character",
      dist: 2,
      bearing: "E",
      hp: "high",
    });
    expect(visible.Corpse_Rat).toMatchObject({
      kind: "corpse",
      drained: true,
    });
  });

  it("returns a minimal fallback shape when the observer is missing", () => {
    const state = makeState({ characters: [] });
    expect(buildAgentInput(state, "missing", "persona", null, 0)).toEqual({
      systemPrompt: SYSTEM_PROMPT,
      visibleStateDigest: "{}",
      composedUserMessage: "{}",
    });
  });
});

describe("Phase 6 input builder — event helpers", () => {
  it("renders incoming damage attribution for attack, overwatch, and counter rows", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 10, y: 10 },
    });
    const camper = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 11, y: 10 },
    });
    const vulture = makeCharacter({
      id: "c_vulture",
      personaId: "vulture",
      displayName: "Vulture",
      pos: { x: 12, y: 10 },
    });
    const trader = makeCharacter({
      id: "c_trader",
      personaId: "trader",
      displayName: "Trader",
      pos: { x: 13, y: 10 },
    });
    const state = makeState({ characters: [me, camper, vulture, trader] });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "c_camper",
          kind: "attack",
          target: "Duelist",
          result: "dmg 5",
          weapon: "axe",
        },
        {
          characterId: "c_vulture",
          kind: "overwatch",
          target: "Duelist",
          result: "dmg 10",
          triggeredByMovement: true,
          weapon: "sword",
        },
        {
          characterId: "c_trader",
          kind: "counter",
          target: "Duelist",
          result: "dmg 7",
        },
      ],
    });

    expect(renderDamageEventLines(prev, state, me)).toEqual([
      "Camper attacked you with axe (dmg 5)",
      "Vulture attacked you with sword (dmg 10)",
      "Trader attacked you with bare hands (dmg 7)",
    ]);
  });

  it("renders kill feed lines from damage rows and death ids", () => {
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 10, y: 10 },
      hp: 0,
      alive: false,
    });
    const vulture = makeCharacter({
      id: "c_vulture",
      personaId: "vulture",
      displayName: "Vulture",
      pos: { x: 11, y: 10 },
    });
    const state = makeState({ characters: [rat, vulture] });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "c_vulture",
          kind: "attack",
          target: "Rat",
          result: "dmg 50",
          weapon: "greatsword",
        },
      ],
      deaths: ["c_rat"],
    });

    expect(buildKillFeedLines(prev, state)).toEqual([
      "Vulture killed Rat with greatsword",
    ]);
  });
});

describe("Phase 6 input builder — visible object", () => {
  it("renders characters, chests, corpses, cover, walls, and evac as keyed JSON", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 50, y: 50 },
    });
    const camper = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 55, y: 50 },
      weapon: "axe",
      armour: "chain",
      consumable: "heal",
    });
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 50, y: 53 },
      alive: false,
    });
    const wall: Wall = { x: 49, y: 51, w: 1, h: 1 };
    const state = makeState({
      characters: [me, camper, rat],
      world: {
        chests: [makeChest("chest_005", { x: 53, y: 50 })],
        corpses: [
          makeCorpse("c_rat", { x: 50, y: 53 }, {
            weapon: { category: "weapon", name: "sword" },
          }),
        ],
        coverTiles: [{ x: 52, y: 52 }],
        walls: [wall],
        evac: { centre: { x: 49, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 35,
    });

    const visible = parseVisible(state, "c_duelist");

    expect(visible.Camper).toMatchObject({
      kind: "character",
      dist: 5,
      bearing: "E",
      hp: "high",
      equipped: { weapon: "axe", armour: "chain", consumable: "heal" },
    });
    expect(visible.Chest_005).toMatchObject({
      kind: "chest",
      dist: 3,
      bearing: "E",
      opened: false,
    });
    expect(visible.Corpse_Rat).toMatchObject({
      kind: "corpse",
      dist: 3,
      bearing: "S",
      drained: false,
    });
    expect(visible.Cover_52_52).toMatchObject({
      kind: "cover",
      dist: 2,
      bearing: "SE",
    });
    expect(visible.Wall_49_51).toMatchObject({
      kind: "wall",
      dist: 1,
      bearing: "SW",
    });
    expect(visible.Evac).toMatchObject({
      kind: "evac",
      dist: 1,
      bearing: "W",
      inZone: true,
    });
  });

  it("filters hidden living characters and dead characters without corpses", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 50, y: 50 },
    });
    const visibleEnemy = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 55, y: 50 },
    });
    const hiddenEnemy = makeCharacter({
      id: "c_vulture",
      personaId: "vulture",
      displayName: "Vulture",
      pos: { x: 53, y: 50 },
      hidden: true,
    });
    const deadWithoutCorpse = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 51, y: 50 },
      alive: false,
    });
    const state = makeState({
      characters: [me, visibleEnemy, hiddenEnemy, deadWithoutCorpse],
    });

    const visible = parseVisible(state, "c_duelist");

    expect(visible.Camper).toBeDefined();
    expect(visible.Vulture).toBeUndefined();
    expect(visible.Rat).toBeUndefined();
    expect(visible.Corpse_Rat).toBeUndefined();
  });

  it("caps visible characters and loot at eight while leaving cover outside the cap", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 50, y: 50 },
    });
    const enemies = PERSONA_IDS.filter((id) => id !== "duelist").map((id, i) =>
      makeCharacter({
        id: `c_${id}`,
        personaId: id,
        displayName: titleCase(id),
        pos: { x: 51 + i, y: 50 },
      }),
    );
    const chests: ChestState[] = [];
    for (let i = 0; i < 6; i++) {
      chests.push(makeChest(`chest_${100 + i}`, { x: 50, y: 55 + i }));
    }
    const state = makeState({
      characters: [me, ...enemies],
      world: {
        chests,
        coverTiles: [{ x: 49, y: 49 }, { x: 48, y: 48 }],
      },
    });

    const visible = parseVisible(state, "c_duelist");
    const values = Object.values(visible);
    const cappedKinds = values.filter((v) =>
      v.kind === "character" || v.kind === "chest" || v.kind === "corpse"
    );
    const covers = values.filter((v) => v.kind === "cover");

    expect(cappedKinds).toHaveLength(8);
    expect(covers).toHaveLength(2);
  });

  it("keeps composed input under the 1200-token proxy for every persona", () => {
    const personas = loadPersonas();
    for (const id of PERSONA_IDS) {
      const me = makeCharacter({
        id: `c_${id}`,
        personaId: id,
        displayName: titleCase(id),
        pos: { x: 50, y: 50 },
        hp: 35,
        weapon: "axe",
        armour: "leather",
        consumable: "heal",
        scratchpad: "x".repeat(500),
      });
      const camper = makeCharacter({
        id: "c_camper_visible",
        personaId: "camper",
        displayName: "Camper",
        pos: { x: 55, y: 50 },
        weapon: "sword",
      });
      const state = makeState({
        characters: [me, camper],
        world: {
          chests: [makeChest("chest_001", { x: 53, y: 50 })],
          coverTiles: [{ x: 51, y: 51 }],
          walls: [{ x: 49, y: 49, w: 1, h: 1 }],
          evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
        },
        turn: 35,
      });
      const built = buildAgentInput(state, me.characterId, personas[id], null, 8);
      const approxTokens = Math.ceil(
        (built.systemPrompt.length + built.composedUserMessage.length) / 4,
      );
      expect(
        approxTokens,
        `persona "${id}" budget exceeded at ${approxTokens} proxy tokens`,
      ).toBeLessThanOrEqual(1200);
    }
  });
});
