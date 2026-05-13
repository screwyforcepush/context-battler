import { describe, expect, it } from "vitest";
import {
  buildAgentInput,
  buildInboundSpeechLines,
  buildKillFeedLines,
  buildOwnSpeechLine,
  buildVisibleStateDigest,
  renderDamageEventLines,
  type PrevTurnRow,
} from "../../convex/llm/inputBuilder.js";
import { buildSystemPrompt } from "../../convex/llm/systemPrompt.js";
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
  const digest = buildVisibleStateDigest(state, characterId, prev);
  expect(digest.startsWith("Vision:\n")).toBe(true);
  return JSON.parse(digest.slice("Vision:\n".length)) as VisibleObject;
}

function visibleKeys(value: Record<string, unknown> | undefined): string[] {
  if (!value) throw new Error("missing Vision entry");
  return Object.keys(value).sort();
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
      📍(44,53) Outside Evac
      ❤️HP: 35/50 HP
      ⚔️weapon: rusty_blade [dmg 10]
      🛡️armour: none
      🧪consumable: speed [+4 move range max dist]
      🗒️scratchpad: Armed rusty_blade. Pressure Vulture now. Close to range 2.

      # Current Game State
      Turn 44, 1/8 players alive

      Vision:
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

    expect(built.systemPrompt).toBe(buildSystemPrompt(44));
    expect(built.composedUserMessage).toContain("# Duelist");
    expect(built.composedUserMessage).toContain("You adopt Duelist persona:");
    expect(built.composedUserMessage).toContain("## Status");
    expect(built.composedUserMessage).toContain("📍(44,53) Outside Evac");
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
      "You moved 2 SE, attacked Vulture (dmg 10)",
    );
    expect(built.composedUserMessage).not.toContain(
      "attacked Vulture (dmg 10), said",
    );
    expect(built.composedUserMessage).toContain("You said \"Hold range.\"");
    expect(built.composedUserMessage).toContain(
      "Camper attacked you with axe (dmg 8)",
    );
    expect(built.composedUserMessage).toContain("Camper killed Rat with axe");

    const visible = JSON.parse(
      built.visibleStateDigest.slice("Vision:\n".length),
    ) as VisibleObject;
    expect(visible.Camper).toMatchObject({
      dist: 2,
      bearing: "E",
      hp: "high",
      armed: true,
    });
    expect(visible.Corpse_Rat).toMatchObject({
      dist: 3,
      bearing: "E",
    });
  });

  it("returns a minimal fallback shape when the observer is missing", () => {
    const state = makeState({ characters: [] });
    expect(buildAgentInput(state, "missing", "persona", null, 0)).toEqual({
      systemPrompt: buildSystemPrompt(1),
      visibleStateDigest: "Vision:\n{}",
      composedUserMessage: "{}",
    });
  });
});

describe("Phase 6 input builder — event helpers", () => {
  it("orders own outcome, damage, own speech, inbound speech, then kill feed", () => {
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
      weapon: "axe",
    });
    const trader = makeCharacter({
      id: "c_trader",
      personaId: "trader",
      displayName: "Trader",
      pos: { x: 12, y: 10 },
    });
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 13, y: 10 },
      hp: 0,
      alive: false,
    });
    const state = makeState({
      characters: [me, camper, trader, rat],
      turn: 12,
    });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "c_duelist",
          from: { x: 9, y: 9 },
          to: { x: 10, y: 10 },
        },
      ],
      actions: [
        {
          characterId: "c_duelist",
          kind: "attack",
          target: "Trader",
          result: "out_of_range",
          weapon: "rusty_blade",
        },
        {
          characterId: "c_camper",
          kind: "attack",
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
        {
          characterId: "c_duelist",
          text: "Hold position.",
          heardBy: ["c_trader"],
        },
        {
          characterId: "c_trader",
          text: "I heard you.",
          heardBy: ["c_duelist"],
        },
      ],
      deaths: ["c_rat"],
    });

    const lines = buildAgentInput(
      state,
      "c_duelist",
      "Win direct fights.",
      prev,
      4,
    ).composedUserMessage.split("\n");
    const start = lines.indexOf("# Current Game State");

    expect(lines.slice(start, start + 8)).toEqual([
      "# Current Game State",
      "Turn 12, 4/8 players alive",
      "You moved 1 SE, attacked Trader (out_of_range)",
      "Camper attacked you with axe (dmg 8)",
      "You said \"Hold position.\"",
      "Trader said \"I heard you.\"",
      "Camper killed Rat with axe",
      "",
    ]);
  });

  it("renders own speech and inbound heard speech as separate JSON-safe feed lines", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 10, y: 10 },
    });
    const trader = makeCharacter({
      id: "c_trader",
      personaId: "trader",
      displayName: "Trader",
      pos: { x: 11, y: 10 },
    });
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 12, y: 10 },
    });
    const state = makeState({ characters: [me, trader, rat] });
    const prev = makePrevTurn({
      speech: [
        {
          characterId: "c_duelist",
          text: "Hold\nrange.",
          heardBy: ["c_trader"],
        },
        {
          characterId: "c_trader",
          text: "Peace \"for now\".",
          heardBy: ["c_duelist"],
        },
        {
          characterId: "c_rat",
          text: "Too far.",
          heardBy: ["c_trader"],
        },
      ],
    });

    expect(buildOwnSpeechLine(prev, "c_duelist")).toBe(
      "You said \"Hold range.\"",
    );
    expect(buildInboundSpeechLines(prev, state, me)).toEqual([
      "Trader said \"Peace \\\"for now\\\".\"",
    ]);

    const built = buildAgentInput(state, "c_duelist", "Win direct fights.", prev, 3);
    expect(built.composedUserMessage).toContain("You said \"Hold range.\"");
    expect(built.composedUserMessage).toContain(
      "Trader said \"Peace \\\"for now\\\".\"",
    );
    expect(built.composedUserMessage).not.toContain("Rat said");
  });

  it("renders loot outcomes with item names and empty markers", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me] });

    expect(
      buildAgentInput(
        state,
        "c_duelist",
        "Win direct fights.",
        makePrevTurn({
          actions: [
            {
              characterId: "c_duelist",
              kind: "loot",
              target: "Chest_53_54",
              result: "opened",
              lootedItem: "speed",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted speed from Chest_53_54");

    expect(
      buildAgentInput(
        state,
        "c_duelist",
        "Win direct fights.",
        makePrevTurn({
          actions: [
            {
              characterId: "c_duelist",
              kind: "loot",
              target: "Corpse_Rat",
              result: "looted",
              lootedItem: "sword",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted sword from Corpse_Rat");

    expect(
      buildAgentInput(
        state,
        "c_duelist",
        "Win direct fights.",
        makePrevTurn({
          actions: [
            {
              characterId: "c_duelist",
              kind: "loot",
              target: "Chest_53_54",
              result: "already_opened",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted nothing from empty Chest_53_54");

    expect(
      buildAgentInput(
        state,
        "c_duelist",
        "Win direct fights.",
        makePrevTurn({
          actions: [
            {
              characterId: "c_duelist",
              kind: "loot",
              target: "Chest_53_54",
              result: "empty",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted nothing from empty Chest_53_54");

    expect(
      buildAgentInput(
        state,
        "c_duelist",
        "Win direct fights.",
        makePrevTurn({
          actions: [
            {
              characterId: "c_duelist",
              kind: "loot",
              target: "Corpse_Rat",
              result: "no_corpse",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted nothing from empty Corpse_Rat");

    expect(
      buildAgentInput(
        state,
        "c_duelist",
        "Win direct fights.",
        makePrevTurn({
          actions: [
            {
              characterId: "c_duelist",
              kind: "loot",
              target: "Corpse_Rat",
              result: "empty",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted nothing from empty Corpse_Rat");
  });

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
  it("renders slim Vision entries for characters, lootables, cover, walls, and outside evac", () => {
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
        chests: [makeChest("Chest_53_50", { x: 53, y: 50 })],
        corpses: [
          makeCorpse("c_rat", { x: 50, y: 53 }, {
            weapon: { category: "weapon", name: "sword" },
          }),
        ],
        coverTiles: [{ x: 52, y: 52 }],
        walls: [wall],
        evac: { centre: { x: 47, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 35,
    });

    const visible = parseVisible(state, "c_duelist");

    for (const [key, value] of Object.entries(visible)) {
      for (const forbidden of [
        "kind",
        "pos",
        "opened",
        "drained",
        "contents",
        "equipped",
        "inZone",
      ]) {
        expect(value, `${key} leaked ${forbidden}`).not.toHaveProperty(
          forbidden,
        );
      }
    }
    expect(visible.Camper).toMatchObject({
      dist: 5,
      bearing: "E",
      hp: "high",
      armed: true,
    });
    expect(visibleKeys(visible.Camper)).toEqual([
      "armed",
      "bearing",
      "dist",
      "hp",
    ]);
    expect(visible.Chest_53_50).toMatchObject({
      dist: 3,
      bearing: "E",
    });
    expect(visibleKeys(visible.Chest_53_50)).toEqual([
      "bearing",
      "dist",
    ]);
    expect(visible.Corpse_Rat).toMatchObject({
      dist: 3,
      bearing: "S",
    });
    expect(visibleKeys(visible.Corpse_Rat)).toEqual([
      "bearing",
      "dist",
    ]);
    expect(visible.Cover_52_52).toMatchObject({
      dist: 2,
      bearing: "SE",
    });
    expect(visibleKeys(visible.Cover_52_52)).toEqual([
      "bearing",
      "dist",
    ]);
    expect(visible.Wall_49_51).toMatchObject({
      dist: 1,
      bearing: "SW",
    });
    expect(visibleKeys(visible.Wall_49_51)).toEqual([
      "bearing",
      "dist",
    ]);
    expect(visible.Evac).toMatchObject({
      dist: 3,
      bearing: "W",
    });
    expect(visibleKeys(visible.Evac)).toEqual(["bearing", "dist"]);
  });

  it("shows unarmed baseline damage and suppresses Evac from Vision inside the zone", () => {
    const me = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 49, y: 50 },
    });
    const state = makeState({
      characters: [me],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
      turn: 35,
    });

    const built = buildAgentInput(state, "c_rat", "Survive.", null, 1);
    expect(built.composedUserMessage).toContain("📍(49,50) Inside Evac");
    expect(built.composedUserMessage).toContain("⚔️weapon: unarmed [dmg 5]");
    const visible = parseVisible(state, "c_rat");
    expect(visible.Evac).toBeUndefined();
  });

  it("renders Outside Evac before reveal and omits Evac from Vision", () => {
    const me = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 49, y: 50 },
    });
    const state = makeState({
      characters: [me],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null } },
      turn: 5,
    });

    const built = buildAgentInput(state, "c_rat", "Survive.", null, 1);
    expect(built.composedUserMessage).toContain("📍(49,50) Outside Evac");
    const visible = parseVisible(state, "c_rat");
    expect(visible.Evac).toBeUndefined();
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
      chests.push(makeChest(`Chest_50_${55 + i}`, { x: 50, y: 55 + i }));
    }
    const state = makeState({
      characters: [me, ...enemies],
      world: {
        chests,
        coverTiles: [{ x: 49, y: 49 }, { x: 48, y: 48 }],
      },
    });

    const visible = parseVisible(state, "c_duelist");
    const keys = Object.keys(visible);
    const cappedKeys = keys.filter((key) =>
      [
        "Rat",
        "Trader",
        "Opportunist",
        "Paranoid",
        "Camper",
        "Sprinter",
        "Vulture",
      ].includes(key) ||
      key.startsWith("Chest_") ||
      key.startsWith("Corpse_")
    );
    const covers = keys.filter((key) => key.startsWith("Cover_"));

    expect(cappedKeys).toHaveLength(8);
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
          chests: [makeChest("Chest_53_50", { x: 53, y: 50 })],
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
