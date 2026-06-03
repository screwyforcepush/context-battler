import { describe, expect, it } from "vitest";
import {
  buildAgentInput,
  buildInboundSpeechLines,
  buildKillFeedLines,
  buildOwnOutcomeLine,
  buildOwnSpeechLine,
  buildVisibleStateDigest,
  MissingPromptHashError,
  recomposeUserMessage,
  renderDamageEventLines,
  type PrevTurnRow,
} from "../../convex/llm/inputBuilder.js";
import { buildSystemPrompt } from "../../convex/llm/systemPrompt.js";
import { loadPersonas } from "../../convex/llm/personas.js";
import {
  PERSONA_IDS,
  titleCase,
  type AirdropState,
  type CharacterState,
  type CrateState,
  type CorpseState,
  type MatchState,
  type PersonaId,
  type Tile,
  type Wall,
  type WorldState,
} from "../../convex/engine/types.js";

type VisibleObject = Record<string, Record<string, unknown>>;

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  const world: WorldState = {
    size: { w: 100, h: 100 },
    walls: [],
    coverClusters: [],
    coverTiles: [],
    crates: [],
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

function makeCrate(id: string, pos: Tile, opened = false): CrateState {
  return { id, pos, contents: null, opened };
}

function makeAirdrop(
  landsAtTurn: number,
  pos: Tile = { x: 50, y: 50 },
  looted = false,
): AirdropState {
  return {
    id: `Crate_${pos.x}_${pos.y}`,
    pos,
    landsAtTurn,
    contents: { category: "armour", name: "leather" },
    looted,
  };
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
      environmentalDeaths: [],
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
      world: {
        corpses: [
          makeCorpse("c_rat", { x: 47, y: 53 }, {
            weapon: { category: "weapon", name: "sword" },
          }),
        ],
      },
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
    expect(built.composedUserMessage).toContain("🛡️armour: leather [-10% dmg]");
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
            status: {
              hp: 0,
              pos: { x: 0, y: 0 },
              equipped: {},
              insideEvac: false,
            },
            narrativeLines: [],
            aliveCount: 0,
            composedUserMessage: "{}",
          });
        });

        it("recomposes the persisted slim input byte-equal to the runtime user message", () => {
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
          const camper = makeCharacter({
            id: "c_camper",
            personaId: "camper",
            displayName: "Camper",
            pos: { x: 46, y: 53 },
            weapon: "axe",
          });
          const rat = makeCharacter({
            id: "c_rat",
            personaId: "rat",
            displayName: "Rat",
            pos: { x: 47, y: 53 },
            hp: 0,
            alive: false,
          });
          const state = makeState({
            characters: [me, camper, rat],
            turn: 44,
            world: {
              corpses: [
                makeCorpse("c_rat", { x: 47, y: 53 }, {
                  weapon: { category: "weapon", name: "sword" },
                }),
              ],
            },
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
          const personaPromptText = "Win direct fights.";
          const built = buildAgentInput(
            state,
            "c_duelist",
            personaPromptText,
            prev,
            3,
          );

          const recomposed = recomposeUserMessage({
            input: {
              systemPromptHash: "sys-hash",
              personaPromptHash: "persona-hash",
              visibleStateDigest: built.visibleStateDigest,
              scratchpadBefore: me.scratchpad,
              status: built.status,
              narrativeLines: built.narrativeLines,
              aliveCount: built.aliveCount,
            },
            turn: 44,
            displayName: "Duelist",
            prompts: {
              systemText: () => built.systemPrompt,
              personaText: () => personaPromptText,
            },
          });

          expect(recomposed).toBe(built.composedUserMessage);
          expect(recomposed).toContain("Turn 44, 3/8 players alive");
          const lines = recomposed.split("\n");
          const gameStateStart = lines.indexOf("# Current Game State");
          expect(lines.slice(gameStateStart + 1, gameStateStart + 7)).toEqual([
            "Turn 44, 3/8 players alive",
            "You moved 2 SE, attacked Vulture (dmg 10)",
            "Camper attacked you with axe (dmg 8)",
            "You said \"Hold range.\"",
            "Camper killed Rat with axe",
            "",
          ]);
        });

        it("throws fatally when recomposition cannot resolve a prompt hash", () => {
          const input = {
            systemPromptHash: "missing-system",
            personaPromptHash: "persona-hash",
            visibleStateDigest: "Vision:\n{}",
            scratchpadBefore: "",
            status: {
              hp: 50,
              pos: { x: 1, y: 2 },
              equipped: {},
              insideEvac: false,
            },
            narrativeLines: [],
            aliveCount: 8,
          };

          expect(() =>
            recomposeUserMessage({
              input,
              turn: 7,
              displayName: "Rat",
              prompts: {
                systemText: () => undefined as unknown as string,
                personaText: () => "Survive.",
              },
            }),
          ).toThrow(MissingPromptHashError);
        });

        it("requires turn at the type boundary for byte-equal recomposition", () => {
          const shouldNotCompile = false;
          if (shouldNotCompile) {
            // @ts-expect-error D11: turn is mandatory, not optional.
            recomposeUserMessage({
              input: {
                systemPromptHash: "system-hash",
                personaPromptHash: "persona-hash",
                visibleStateDigest: "Vision:\n{}",
                scratchpadBefore: "",
                status: {
                  hp: 50,
                  pos: { x: 1, y: 1 },
                  equipped: {},
                  insideEvac: false,
                },
                narrativeLines: [],
                aliveCount: 8,
              },
              displayName: "Rat",
              prompts: {
                systemText: () => "system",
                personaText: () => "persona",
              },
            });
          }

          expect(shouldNotCompile).toBe(false);
        });
      });

describe("Phase 6 input builder — event helpers", () => {
  it.each([
    {
      name: "compass slide",
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      slide: {
        wallRectId: "Wall_18_18_to_23_18",
        axis: "E" as const,
        intent: "NE",
      },
      expected: "You hugged Wall_18_18_to_23_18 E",
    },
    {
      name: "character target projection",
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      slide: {
        wallRectId: "Wall_18_18_to_23_18",
        axis: "E" as const,
        intent: "toward opaque_character_camper",
      },
      expected: "You hugged Wall_18_18_to_23_18 E toward Camper",
    },
    {
      name: "corpse target projection",
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      slide: {
        wallRectId: "Wall_18_18_to_23_18",
        axis: "E" as const,
        intent: "toward Corpse_opaque_character_camper",
      },
      expected: "You hugged Wall_18_18_to_23_18 E toward Corpse_Camper",
    },
    {
      name: "rect target pass-through",
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      slide: {
        wallRectId: "Wall_18_18_to_23_18",
        axis: "E" as const,
        intent: "toward Wall_30_60_to_34_60",
      },
      expected:
        "You hugged Wall_18_18_to_23_18 E toward Wall_30_60_to_34_60",
    },
    {
      name: "away target projection",
      from: { x: 5, y: 5 },
      to: { x: 4, y: 5 },
      slide: {
        wallRectId: "Wall_18_18_to_23_18",
        axis: "W" as const,
        intent: "away opaque_character_camper",
      },
      expected: "You hugged Wall_18_18_to_23_18 W away from Camper",
    },
    {
      name: "aggregate delta divergence",
      from: { x: 5, y: 5 },
      to: { x: 7, y: 4 },
      slide: {
        wallRectId: "Wall_18_18_to_23_18",
        axis: "E" as const,
        intent: "NE",
      },
      expected: "You hugged Wall_18_18_to_23_18 E",
    },
  ])("renders slide outcome lines using slide.axis: $name", (row) => {
    const me = makeCharacter({
      id: "opaque_character_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: row.to,
    });
    const camper = makeCharacter({
      id: "opaque_character_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me, camper] });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "opaque_character_duelist",
          from: row.from,
          to: row.to,
          slide: row.slide,
        },
      ],
    });

    expect(buildOwnOutcomeLine(state, "opaque_character_duelist", prev)).toBe(
      row.expected,
    );
  });

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

  it("renders body-collision charge outcome and defender damage feed lines", () => {
    const charger = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 10, y: 10 },
    });
    const defender = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 11, y: 10 },
    });
    const state = makeState({ characters: [charger, defender], turn: 9 });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "c_camper",
          from: { x: 10, y: 10 },
          to: { x: 10, y: 10 },
          bodyCollision: { kind: "character", defenderId: "c_duelist" },
        },
      ],
    });

    expect(buildOwnOutcomeLine(state, "c_camper", prev)).toBe(
      "You charged into Duelist (dmg 1, took 1)",
    );
    expect(renderDamageEventLines(prev, state, defender)).toEqual([
      "Camper charged into you (dmg 1)",
    ]);
    expect(renderDamageEventLines(prev, state, charger)).toEqual([]);
    expect(
      buildAgentInput(state, "c_duelist", "Win direct fights.", prev, 2)
        .composedUserMessage,
    ).toContain("Camper charged into you (dmg 1)");
  });

  it("renders partial movement plus wall bump in one outcome line", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 7, y: 5 },
    });
    const state = makeState({ characters: [me] });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "c_duelist",
          from: { x: 5, y: 5 },
          to: { x: 7, y: 5 },
          bodyCollision: { kind: "wall", wallRectId: "Wall_8_5" },
        },
      ],
    });

    expect(buildOwnOutcomeLine(state, "c_duelist", prev)).toBe(
      "You moved 2 E, tried to move and hit Wall_8_5 (took 1)",
    );
  });

  it("renders slide plus wall bump without dropping either fragment", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 7, y: 5 },
    });
    const state = makeState({ characters: [me] });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "c_duelist",
          from: { x: 5, y: 5 },
          to: { x: 7, y: 5 },
          slide: {
            wallRectId: "Wall_6_4",
            axis: "E",
            intent: "NE",
          },
          bodyCollision: { kind: "wall", wallRectId: "Wall_8_5" },
        },
      ],
    });

    expect(buildOwnOutcomeLine(state, "c_duelist", prev)).toBe(
      "You moved 2 E, hugged Wall_6_4 E; tried to move and hit Wall_8_5 (took 1)",
    );
  });

  it("keeps successful slide-only outcomes free of bump damage text", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 6, y: 5 },
    });
    const state = makeState({ characters: [me] });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "c_duelist",
          from: { x: 5, y: 5 },
          to: { x: 6, y: 5 },
          slide: {
            wallRectId: "Wall_18_18_to_23_18",
            axis: "E",
            intent: "NE",
          },
        },
      ],
    });

    const outcome = buildOwnOutcomeLine(state, "c_duelist", prev);
    expect(outcome).toBe("You hugged Wall_18_18_to_23_18 E");
    expect(outcome).not.toContain("took 1");
    expect(outcome).not.toContain("hit Wall_");
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
              target: "Crate_53_54",
              result: "opened",
              lootedItem: "speed",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted speed from Crate_53_54");

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
              target: "Crate_53_54",
              result: "already_opened",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted nothing from empty Crate_53_54");

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
              target: "Crate_53_54",
              result: "empty",
            },
          ],
        }),
        1,
      ).composedUserMessage,
    ).toContain("You looted nothing from empty Crate_53_54");

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

  it("uses action kill-feed attribution before lethal charge fallback", () => {
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
    const camper = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 9, y: 10 },
    });
    const state = makeState({ characters: [rat, vulture, camper] });
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
      moves: [
        {
          characterId: "c_camper",
          from: { x: 9, y: 10 },
          to: { x: 9, y: 10 },
          bodyCollision: { kind: "character", defenderId: "c_rat" },
        },
      ],
      deaths: ["c_rat"],
    });

    expect(buildKillFeedLines(prev, state)).toEqual([
      "Vulture killed Rat with greatsword",
    ]);
  });

  it("falls back to bare-hands kill feed for lethal body-collision charges", () => {
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 10, y: 10 },
      hp: 0,
      alive: false,
    });
    const camper = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 9, y: 10 },
    });
    const state = makeState({ characters: [rat, camper] });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "c_camper",
          from: { x: 9, y: 10 },
          to: { x: 9, y: 10 },
          bodyCollision: { kind: "character", defenderId: "c_rat" },
        },
      ],
      deaths: ["c_rat"],
    });

    expect(buildKillFeedLines(prev, state)).toEqual([
      "Camper killed Rat with bare hands",
    ]);
  });

  it("WP-D — emits a pure telefrag kill-feed line despite zero weapon deaths", () => {
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
      hp: 0,
      alive: false,
    });
    const duelist = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 48, y: 50 },
    });
    const state = makeState({ characters: [rat, duelist] });
    const prev = makePrevTurn({
      deaths: [],
      environmentalDeaths: ["c_rat"],
    });

    expect(buildKillFeedLines(prev, state)).toEqual([
      "Rat got telefragged by crate spawn",
    ]);
  });

  it("WP-D — orders weapon kills, charge kills, then telefrag lines", () => {
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 10, y: 10 },
      hp: 0,
      alive: false,
    });
    const trader = makeCharacter({
      id: "c_trader",
      personaId: "trader",
      displayName: "Trader",
      pos: { x: 12, y: 10 },
      hp: 0,
      alive: false,
    });
    const camper = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 50, y: 50 },
      hp: 0,
      alive: false,
    });
    const vulture = makeCharacter({
      id: "c_vulture",
      personaId: "vulture",
      displayName: "Vulture",
      pos: { x: 11, y: 10 },
    });
    const duelist = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 13, y: 10 },
    });
    const state = makeState({
      characters: [rat, trader, camper, vulture, duelist],
    });
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
      moves: [
        {
          characterId: "c_duelist",
          from: { x: 13, y: 10 },
          to: { x: 13, y: 10 },
          bodyCollision: { kind: "character", defenderId: "c_trader" },
        },
      ],
      deaths: ["c_rat", "c_trader"],
      environmentalDeaths: ["c_camper"],
    });

    expect(buildKillFeedLines(prev, state)).toEqual([
      "Vulture killed Rat with greatsword",
      "Duelist killed Trader with bare hands",
      "Camper got telefragged by crate spawn",
    ]);
  });

  it("WP-D — telefrag takes precedence over same-turn attack in the kill feed", () => {
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
      hp: 0,
      alive: false,
    });
    const vulture = makeCharacter({
      id: "c_vulture",
      personaId: "vulture",
      displayName: "Vulture",
      pos: { x: 49, y: 50 },
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
      deaths: [],
      environmentalDeaths: ["c_rat"],
    });

    expect(buildKillFeedLines(prev, state)).toEqual([
      "Rat got telefragged by crate spawn",
    ]);
  });

  it("WP-D — next input keeps a telefragged character out of Vision while carrying the feed line", () => {
    const duelist = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 49, y: 50 },
    });
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
      hp: 0,
      alive: false,
    });
    const state = makeState({ characters: [duelist, rat], turn: 11 });
    const prev = makePrevTurn({
      environmentalDeaths: ["c_rat"],
    });

    const built = buildAgentInput(
      state,
      "c_duelist",
      "Win direct fights.",
      prev,
      1,
    );
    const visible = JSON.parse(
      built.visibleStateDigest.slice("Vision:\n".length),
    ) as VisibleObject;

    expect(built.narrativeLines).toContain(
      "Rat got telefragged by crate spawn",
    );
    expect(visible.Rat).toBeUndefined();
    expect(visible.Corpse_Rat).toBeUndefined();
    expect(built.composedUserMessage).toContain("Turn 11, 1/8 players alive");
  });
});

describe("Phase 6 input builder — visible object", () => {
  it("serializes multi-tile terrain and evac as rect keys with nearest-tile bearings", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 50, y: 50 },
    });
    const ewWall: Wall = { x: 44, y: 50, w: 4, h: 1 };
    const nsWall: Wall = { x: 54, y: 52, w: 1, h: 4 };
    const coverPatch: Wall = { x: 48, y: 47, w: 2, h: 2 };
    const state = makeState({
      characters: [me],
      world: {
        walls: [ewWall, nsWall],
        coverClusters: [coverPatch],
        coverTiles: [
          { x: 48, y: 47 },
          { x: 49, y: 47 },
          { x: 48, y: 48 },
          { x: 49, y: 48 },
        ],
        evac: { centre: { x: 80, y: 80 }, revealedAtTurn: 30 },
      },
      turn: 35,
    });

    const visible = parseVisible(state, "c_duelist");

    expect(visible.Wall_44_50_to_47_50).toEqual({
      dist: 3,
      bearing: "W",
      shape: "E-W line",
    });
    expect(visible.Wall_54_52_to_54_55).toEqual({
      dist: 4,
      bearing: "SE",
      shape: "N-S line",
    });
    expect(visible.Cover_48_47_to_49_48).toEqual({
      dist: 2,
      bearing: "NW",
      shape: "patch",
    });
    expect(visible.Evac_79_79_to_81_81).toEqual({
      dist: 29,
      bearing: "SE",
      shape: "patch",
    });
  });

  it("uses bearing here when the observer is inside a cover patch", () => {
    const me = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 43, y: 43 },
    });
    const coverPatch: Wall = { x: 42, y: 42, w: 3, h: 3 };
    const state = makeState({
      characters: [me],
      world: {
        coverClusters: [coverPatch],
        coverTiles: [
          { x: 42, y: 42 },
          { x: 43, y: 42 },
          { x: 44, y: 42 },
          { x: 42, y: 43 },
          { x: 43, y: 43 },
          { x: 44, y: 43 },
          { x: 42, y: 44 },
          { x: 43, y: 44 },
          { x: 44, y: 44 },
        ],
      },
    });

    const visible = parseVisible(state, "c_camper");

    expect(visible.Cover_42_42_to_44_44).toEqual({
      dist: 0,
      bearing: "here",
      shape: "patch",
    });
  });

  it("preserves point-keying for characters, crates, and corpses", () => {
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
      pos: { x: 52, y: 50 },
    });
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 53, y: 50 },
      alive: false,
    });
    const state = makeState({
      characters: [me, camper, rat],
      world: {
        crates: [makeCrate("Crate_51_50", { x: 51, y: 50 })],
        corpses: [
          makeCorpse("c_rat", { x: 53, y: 50 }, {
            weapon: { category: "weapon", name: "sword" },
          }),
        ],
      },
    });

    const visible = parseVisible(state, "c_duelist");

    expect(visible.Camper).toMatchObject({ dist: 2, bearing: "E" });
    expect(visible.Crate_51_50).toMatchObject({ dist: 1, bearing: "E" });
    expect(visible.Corpse_Rat).toMatchObject({ dist: 3, bearing: "E" });
    expect(Object.keys(visible).filter((key) => key.includes("_to_"))).toEqual(
      [],
    );
  });

  it("keeps non-wall entities out of Vision when LOS is fully blocked", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 10, y: 10 },
    });
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 14, y: 11 },
      alive: false,
    });
    const state = makeState({
      characters: [me, rat],
      world: {
        walls: [{ x: 12, y: 8, w: 1, h: 5 }],
        crates: [makeCrate("Crate_14_10", { x: 14, y: 10 })],
        corpses: [
          makeCorpse("c_rat", { x: 14, y: 11 }, {
            weapon: { category: "weapon", name: "sword" },
          }),
        ],
        coverClusters: [{ x: 14, y: 8, w: 1, h: 5 }],
        coverTiles: [
          { x: 14, y: 8 },
          { x: 14, y: 9 },
          { x: 14, y: 10 },
          { x: 14, y: 11 },
          { x: 14, y: 12 },
        ],
      },
    });

    const visible = parseVisible(state, "c_duelist");

    expect(visible.Crate_14_10).toBeUndefined();
    expect(visible.Corpse_Rat).toBeUndefined();
    expect(visible.Cover_14_8_to_14_12).toBeUndefined();
  });

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
        crates: [makeCrate("Crate_53_50", { x: 53, y: 50 })],
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
    expect(visible.Crate_53_50).toMatchObject({
      dist: 3,
      bearing: "E",
    });
    expect(visibleKeys(visible.Crate_53_50)).toEqual([
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
      shape: "single",
    });
    expect(visibleKeys(visible.Cover_52_52)).toEqual([
      "bearing",
      "dist",
      "shape",
    ]);
    expect(visible.Wall_49_51).toMatchObject({
      dist: 1,
      bearing: "SW",
      shape: "single",
    });
    expect(visibleKeys(visible.Wall_49_51)).toEqual([
      "bearing",
      "dist",
      "shape",
    ]);
    expect(visible.Evac_46_49_to_48_51).toMatchObject({
      dist: 2,
      bearing: "W",
      shape: "patch",
    });
    expect(visibleKeys(visible.Evac_46_49_to_48_51)).toEqual([
      "bearing",
      "dist",
      "shape",
    ]);
  });

  it("shows unarmed baseline damage and emits here-bearing Evac inside the zone", () => {
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
    expect(visible.Evac_49_49_to_51_51).toEqual({
      dist: 0,
      bearing: "here",
      shape: "patch",
    });
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

  it("drops spent crates from Vision once opened", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [me],
      world: {
        crates: [
          makeCrate("Crate_52_50", { x: 52, y: 50 }, true),
          makeCrate("Crate_53_50", { x: 53, y: 50 }, false),
        ],
      },
    });

    const visible = parseVisible(state, "c_duelist");

    expect(visible.Crate_52_50).toBeUndefined();
    expect(visible.Crate_53_50).toBeDefined();
  });

  it("WP-C BC-3 — renders airdrop countdown 3,2,1,0 in Vision for every telegraph turn", () => {
    const me = makeCharacter({
      id: "c_duelist",
      displayName: "Duelist",
      pos: { x: 1, y: 1 },
      personaId: "duelist",
    });
    const state = makeState({
      characters: [me],
      world: {
        walls: [{ x: 2, y: 2, w: 70, h: 1 }],
        airdrops: [makeAirdrop(10, { x: 50, y: 50 })],
      },
    });

    for (const [turn, countdown] of [
      [7, 3],
      [8, 2],
      [9, 1],
      [10, 0],
    ] as const) {
      const atTurn = { ...state, turn };
      const visible = parseVisible(atTurn, "c_duelist");
      expect(visible.Crate_50_50).toMatchObject({ spawnsIn: countdown });
    }
  });

  it("WP-C BC-3 — landed airdrop looks like a normal crate and spent airdrop is absent from Vision", () => {
    const me = makeCharacter({
      id: "c_duelist",
      displayName: "Duelist",
      pos: { x: 49, y: 50 },
      personaId: "duelist",
    });
    const landed = makeState({
      characters: [me],
      turn: 11,
      world: {
        airdrops: [makeAirdrop(10, { x: 50, y: 50 })],
      },
    });
    const landedVisible = parseVisible(landed, "c_duelist");
    expect(landedVisible.Crate_50_50).toMatchObject({
      dist: 1,
      bearing: "E",
    });
    expect(landedVisible.Crate_50_50).not.toHaveProperty("spawnsIn");

    const spent = makeState({
      characters: [me],
      turn: 11,
      world: {
        airdrops: [makeAirdrop(10, { x: 50, y: 50 }, true)],
      },
    });
    expect(parseVisible(spent, "c_duelist").Crate_50_50).toBeUndefined();
  });

  it("drops drained corpses from Vision once contents exhausted", () => {
    const me = makeCharacter({
      id: "c_duelist",
      personaId: "duelist",
      displayName: "Duelist",
      pos: { x: 50, y: 50 },
    });
    const rat = makeCharacter({
      id: "c_rat",
      personaId: "rat",
      displayName: "Rat",
      pos: { x: 52, y: 50 },
      alive: false,
    });
    const camper = makeCharacter({
      id: "c_camper",
      personaId: "camper",
      displayName: "Camper",
      pos: { x: 53, y: 50 },
      alive: false,
    });
    const state = makeState({
      characters: [me, rat, camper],
      world: {
        corpses: [
          makeCorpse("c_rat", { x: 52, y: 50 }, {}),
          makeCorpse("c_camper", { x: 53, y: 50 }, {
            weapon: { category: "weapon", name: "sword" },
          }),
        ],
      },
    });

    const visible = parseVisible(state, "c_duelist");

    expect(visible.Corpse_Rat).toBeUndefined();
    expect(visible.Corpse_Camper).toBeDefined();
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
    const crates: CrateState[] = [];
    for (let i = 0; i < 6; i++) {
      crates.push(makeCrate(`Crate_50_${55 + i}`, { x: 50, y: 55 + i }));
    }
    const state = makeState({
      characters: [me, ...enemies],
      world: {
        crates,
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
      key.startsWith("Crate_") ||
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
          crates: [makeCrate("Crate_53_50", { x: 53, y: 50 })],
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
