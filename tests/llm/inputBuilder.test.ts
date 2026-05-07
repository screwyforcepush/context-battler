// WP8 — TDD tests for the per-turn agent input builder.
//
// Tests are written FIRST per AOP (Red → Green → Refactor). They lock the
// digest contract that downstream WPs depend on:
//
//   - WP10 (`runMatch.advanceTurn`) calls `buildAgentInput` once per living
//     agent, persists the returned `visibleStateDigest` + `systemPrompt` in
//     the trace per ADR §7, and forwards both into `callDecisionTool` (WP6).
//   - WP15 tuning loop reads token-budget telemetry; if the digest grows
//     beyond the contract, persona signal collapses against the ≤ 1 200-token
//     prompt-economy bound from `mental-model.md` §10.
//
// Token-count proxy. We use **`chars / 4`** as a deterministic, install-free
// proxy for tiktoken token counts (matches `tests/llm/personas.test.ts`).
// Rationale documented inline in `convex/llm/inputBuilder.ts` head-note.
//
// Cross-references:
//   - concept-spec.md §7 (vision example), §8 (per-turn input), §16 (speech),
//     §22 (affordances) — the digest mirrors §7's example structure.
//   - work-packages.md WP8 (lines 217-262) — locks digest-section caps,
//     speech window, and the binding token-budget assertion.
//   - mental-model.md §9 — "concrete actions and targets only, no predicates".
//   - mental-model.md §10 — prompt-economy rule (digest is plain text, not
//     an ASCII tile dump).

import { describe, expect, it } from "vitest";
import {
  buildAgentInput,
  buildVisibleStateDigest,
} from "../../convex/llm/inputBuilder.js";
import { SYSTEM_PROMPT } from "../../convex/llm/systemPrompt.js";
import type {
  CharacterState,
  ChestState,
  CorpseState,
  HeardSpeech,
  LastKnownEntry,
  MatchState,
  PersonaId,
  Tile,
  Wall,
  WorldState,
} from "../../convex/engine/types.js";

// ─── Test fixture helpers (mirror tests/engine/affordances.test.ts) ─────────

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
  lastKnown?: LastKnownEntry[];
}): CharacterState {
  const equipped: CharacterState["equipped"] = {};
  if (opts.weapon)
    equipped.weapon = { category: "weapon", name: opts.weapon };
  if (opts.armour)
    equipped.armour = { category: "armour", name: opts.armour };
  if (opts.consumable)
    equipped.consumable = { category: "consumable", name: opts.consumable };
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.displayName ?? opts.id,
    hp: opts.hp ?? 100,
    maxHp: opts.maxHp ?? 100,
    pos: opts.pos,
    equipped,
    scratchpad: "",
    hidden: opts.hidden ?? false,
    alive: opts.alive ?? true,
    lastKnown: opts.lastKnown ?? [],
  };
}

function makeChest(id: string, pos: Tile): ChestState {
  return { id, pos, contents: null, opened: false, lootTable: "starter" };
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

// ─── Test 1 — Format smoke ──────────────────────────────────────────────────

describe("WP8 — buildVisibleStateDigest format smoke", () => {
  it("produces a digest with all expected sections under 1500 chars for a mid-game 8-agent state", () => {
    // Eight characters arranged in a rough ring around the observer at the
    // map centre — enough visible entities to exercise every section.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      hp: 72,
      weapon: "axe",
      armour: "leather",
      consumable: "heal",
    });
    const others: CharacterState[] = [];
    for (let i = 2; i <= 8; i++) {
      others.push(
        makeCharacter({
          id: `P${i}`,
          displayName: `Player_${i}`,
          pos: { x: 50 + i, y: 50 + i },
        }),
      );
    }
    const state = makeState({
      characters: [me, ...others],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null } },
      turn: 7,
    });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest.length).toBeLessThan(1500);
    expect(digest).toContain("Turn:");
    expect(digest).toContain("You are at");
    expect(digest).toContain("Equipped:");
    expect(digest).toContain("Visible:");
    expect(digest).toContain("Affordances:");
    // Self-HP renders as exact, persona is itself — "72/100 HP".
    expect(digest).toContain("72/100 HP");
  });
});

// ─── Test 2 — Visibility filter ─────────────────────────────────────────────

describe("WP8 — visibility filter", () => {
  it("hidden enemy NOT in digest; living visible enemy IS in digest", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const visibleEnemy = makeCharacter({
      id: "P2",
      displayName: "Player_2",
      pos: { x: 55, y: 50 },
    });
    const hiddenEnemy = makeCharacter({
      id: "P3",
      displayName: "Player_3",
      pos: { x: 53, y: 50 },
      hidden: true,
    });
    const state = makeState({
      characters: [me, visibleEnemy, hiddenEnemy],
    });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).toContain("Player_2");
    expect(digest).not.toContain("Player_3");
  });

  it("wall-blocked enemy NOT in digest", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const blockedEnemy = makeCharacter({
      id: "P2",
      displayName: "Player_2",
      pos: { x: 55, y: 50 },
    });
    // A 2-tile-wide wall directly between P1 and P2.
    const wall: Wall = { x: 52, y: 49, w: 2, h: 3 };
    const state = makeState({
      characters: [me, blockedEnemy],
      world: { walls: [wall] },
    });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).not.toContain("Player_2");
  });

  it("dead enemy NOT in digest as character (corpse path is separate)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const deadEnemy = makeCharacter({
      id: "P2",
      displayName: "Player_2",
      pos: { x: 55, y: 50 },
      alive: false,
    });
    const state = makeState({ characters: [me, deadEnemy] });
    const digest = buildVisibleStateDigest(state, "P1", []);
    // Dead character is excluded from `computeVisibleEntities`'s character
    // emission (vision.ts skips `!alive`); a separate corpse entry would
    // be present only if a `CorpseState` exists in `world.corpses`.
    expect(digest).not.toContain("Player_2");
  });
});

// ─── Test 3 — Visible entity cap ────────────────────────────────────────────

describe("WP8 — visible entity cap (max 8 sorted by Chebyshev)", () => {
  it("12 visible entities → digest lists exactly 8, sorted by distance ascending; closest 8 always win", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // 4 close characters (distance 1..4)
    const closeChars: CharacterState[] = [];
    for (let i = 0; i < 4; i++) {
      closeChars.push(
        makeCharacter({
          id: `C${i}`,
          displayName: `Player_${i + 2}`,
          pos: { x: 50 + (i + 1), y: 50 },
        }),
      );
    }
    // 4 close chests (distance 5..8) — one tile apart on the south column
    const closeChests: ChestState[] = [];
    for (let i = 0; i < 4; i++) {
      closeChests.push(
        makeChest(`chest_${100 + i}`, { x: 50, y: 50 + (i + 5) }),
      );
    }
    // 4 cover tiles further away (distance 10..13). These are the 4 entities
    // that should be DROPPED — closest-8 by Chebyshev dist always win.
    const farCovers: Tile[] = [];
    for (let i = 0; i < 4; i++) {
      farCovers.push({ x: 50 - (i + 10), y: 50 });
    }
    const state = makeState({
      characters: [me, ...closeChars],
      world: { chests: closeChests, coverTiles: farCovers },
    });
    const digest = buildVisibleStateDigest(state, "P1", []);
    // Count the bullets in the Visible: section. The digest renders one
    // bullet per visible entity in the section — extract the section by
    // splitting on the next section header.
    const visibleBlock = extractSection(digest, "Visible:");
    const lines = visibleBlock
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(lines.length).toBe(8);
    // None of the far-cover tiles (distance >= 10) should be present —
    // the closer chests/characters fill the 8 slots.
    for (const cover of farCovers) {
      expect(visibleBlock).not.toContain(`(${cover.x},${cover.y})`);
    }
    // Chebyshev-ascending order: the first listed entity must be at dist 1,
    // not at dist 8. Pull the leading distance from the first bullet.
    const firstLine = lines[0]!;
    const m = firstLine.match(/dist (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(1);
  });
});

// ─── Test 4 — Heard cap ─────────────────────────────────────────────────────

describe("WP8 — heard messages cap (max 5, oldest evicted)", () => {
  it("7 heard speeches → digest lists 5 (the last 5; oldest dropped)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // We add speakers as known characters so displayName resolution works
    // for the rendered lines — but the cap is independent of that.
    const speakers: CharacterState[] = [];
    for (let i = 1; i <= 7; i++) {
      speakers.push(
        makeCharacter({
          id: `S${i}`,
          displayName: `Speaker_${i}`,
          pos: { x: 100, y: 100 }, // out of vision; we only render heard text
          hidden: true, // doesn't matter for heard rendering
        }),
      );
    }
    const heard: HeardSpeech[] = [];
    for (let i = 1; i <= 7; i++) {
      heard.push({ speakerId: `S${i}`, text: `msg-${i}` });
    }
    const state = makeState({ characters: [me, ...speakers] });
    const digest = buildVisibleStateDigest(state, "P1", heard);
    const heardBlock = extractSection(digest, "Heard (last turn):");
    // Oldest entries (msg-1, msg-2) must be dropped; last 5 retained.
    expect(heardBlock).not.toContain("msg-1");
    expect(heardBlock).not.toContain("msg-2");
    for (let i = 3; i <= 7; i++) {
      expect(heardBlock).toContain(`msg-${i}`);
    }
    // Exactly 5 bullets present.
    const heardLines = heardBlock
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(heardLines.length).toBe(5);
  });
});

// ─── Test 5 — Last-known cap ────────────────────────────────────────────────

describe("WP8 — last-known cap (max 3 rendered)", () => {
  it("3 lastKnown entries → all 3 rendered; defensive 4 entries → 3 rendered (oldest dropped)", () => {
    const meWith3: CharacterState = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      lastKnown: [
        { characterId: "PA", pos: { x: 10, y: 10 }, atTurn: 1 },
        { characterId: "PB", pos: { x: 11, y: 11 }, atTurn: 2 },
        { characterId: "PC", pos: { x: 12, y: 12 }, atTurn: 3 },
      ],
    });
    const stateA = makeState({ characters: [meWith3], turn: 5 });
    const digestA = buildVisibleStateDigest(stateA, "P1", []);
    const lastKnownBlockA = extractSection(digestA, "Last-known:");
    const linesA = lastKnownBlockA
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(linesA.length).toBe(3);

    // Defensive: 4 entries despite WP5's cap. The renderer must still emit
    // exactly 3 (drop the oldest by atTurn).
    const meWith4: CharacterState = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      lastKnown: [
        { characterId: "PA", pos: { x: 10, y: 10 }, atTurn: 1 }, // oldest — dropped
        { characterId: "PB", pos: { x: 11, y: 11 }, atTurn: 2 },
        { characterId: "PC", pos: { x: 12, y: 12 }, atTurn: 3 },
        { characterId: "PD", pos: { x: 13, y: 13 }, atTurn: 4 },
      ],
    });
    const stateB = makeState({ characters: [meWith4], turn: 5 });
    const digestB = buildVisibleStateDigest(stateB, "P1", []);
    const lastKnownBlockB = extractSection(digestB, "Last-known:");
    const linesB = lastKnownBlockB
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(linesB.length).toBe(3);
    expect(lastKnownBlockB).not.toContain("PA");
    expect(lastKnownBlockB).toContain("PB");
    expect(lastKnownBlockB).toContain("PC");
    expect(lastKnownBlockB).toContain("PD");
  });
});

// ─── Test 6 — Speech rendering ──────────────────────────────────────────────

describe("WP8 — speech rendering", () => {
  it("[{speakerId:'P5', text:'hi'}] → digest contains Player_5: \"hi\" via displayName lookup", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const speaker = makeCharacter({
      id: "P5",
      displayName: "Player_5",
      pos: { x: 100, y: 100 },
      hidden: true,
    });
    const state = makeState({ characters: [me, speaker] });
    const digest = buildVisibleStateDigest(state, "P1", [
      { speakerId: "P5", text: "hi" },
    ]);
    expect(digest).toContain('Player_5: "hi"');
  });

  it("unresolvable speakerId falls back to the speakerId verbatim", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({ characters: [me] });
    const digest = buildVisibleStateDigest(state, "P1", [
      { speakerId: "ghost-id", text: "boo" },
    ]);
    expect(digest).toContain('ghost-id: "boo"');
  });
});

// ─── Test 7 — Renders whatever WP10 hands you (hearing pre-filter is upstream) ─

describe("WP8 — speech is rendered without re-filtering", () => {
  it("renders every entry passed in heardLastTurn (caller does the hearing-range filter)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 0, y: 0 },
    });
    // Speaker 100 tiles away — well outside hearing range — but we still
    // render them because WP10 (the caller) decides what makes it in.
    const speaker = makeCharacter({
      id: "P9",
      displayName: "Player_9",
      pos: { x: 99, y: 99 },
      hidden: true,
    });
    const state = makeState({ characters: [me, speaker] });
    const digest = buildVisibleStateDigest(state, "P1", [
      { speakerId: "P9", text: "rendered anyway" },
    ]);
    expect(digest).toContain('Player_9: "rendered anyway"');
  });
});

// ─── Test 8 — Evac before/after reveal ──────────────────────────────────────

describe("WP8 — evac section visibility", () => {
  it("evac.revealedAtTurn === null → digest does NOT mention Evac:", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [me],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null } },
      turn: 5,
    });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).not.toContain("Evac:");
  });

  it("evac.revealedAtTurn = 30 → digest includes Evac: section with centre + dist + est turns", () => {
    // Place P1 NW of evac centre so the bearing is computable.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 7, y: 7 },
    });
    const state = makeState({
      characters: [me],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
      turn: 35,
    });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).toContain("Evac:");
    // dist = chebyshev((7,7),(50,50)) = max(43,43) = 43.
    expect(digest).toContain("dist 43");
    // est turns = ceil(43 / 8) = 6 (default movement budget).
    expect(digest).toContain("est 6 turns");
    // Centre rendered as (50,50).
    expect(digest).toContain("(50,50)");
    // Reveal turn rendered.
    expect(digest).toContain("Revealed at turn 30");
  });
});

// ─── Test 9 — System prompt ─────────────────────────────────────────────────

describe("WP8 — SYSTEM_PROMPT", () => {
  it("is non-empty, contains 'decide_turn' tool-name reminder, and ≤ 400 tokens (chars/4 proxy: 1600 chars)", () => {
    expect(typeof SYSTEM_PROMPT).toBe("string");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(SYSTEM_PROMPT).toContain("decide_turn");
    // chars/4 proxy: 400 tokens → 1600 chars upper bound.
    expect(SYSTEM_PROMPT.length).toBeLessThanOrEqual(1600);
  });
});

// ─── Test 10 — Affordances rendering ────────────────────────────────────────

describe("WP8 — affordances rendering", () => {
  it("Affordances section lists movement and actions lines from localAffordances() in schema-aligned vocab (WP10.5)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const enemy = makeCharacter({
      id: "P3",
      displayName: "Player_3",
      pos: { x: 51, y: 51 },
    });
    const state = makeState({ characters: [me, enemy] });
    const digest = buildVisibleStateDigest(state, "P1", []);
    const affBlock = extractSection(digest, "Affordances:");
    // Movement line should mention schema-aligned move literals.
    expect(affBlock).toContain("movement:");
    expect(affBlock).toContain("toward_entity: P3");
    expect(affBlock).toContain("away_from_entity: P3");
    // Actions line should include overwatch (always when alive).
    expect(affBlock).toContain("actions:");
    expect(affBlock).toContain("overwatch");
    // Enemy at dist 1 ≤ default attack range 2 → schema-aligned attack literal.
    expect(affBlock).toContain("attack: P3 (in range)");
  });
});

// ─── Test 11 — Tactical-digest contract (no ASCII grid runs) ────────────────

describe("WP8 — tactical digest is plain text, not an ASCII grid", () => {
  it("digest does NOT contain repeated . or # patterns characteristic of ASCII grids (no 5+-char run)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({ characters: [me] });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).not.toMatch(/\.{5,}/);
    expect(digest).not.toMatch(/#{5,}/);
  });
});

// ─── Test 12 — No grid dump (no 50+ contiguous identical chars) ─────────────

describe("WP8 — no line contains 50+ contiguous identical chars (sanity)", () => {
  it("a populous digest has no 50+ identical-char run on any line", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      hp: 72,
      weapon: "axe",
      armour: "leather",
      consumable: "heal",
    });
    const enemies: CharacterState[] = [];
    for (let i = 2; i <= 8; i++) {
      enemies.push(
        makeCharacter({
          id: `P${i}`,
          displayName: `Player_${i}`,
          pos: { x: 50 + i, y: 50 + i },
        }),
      );
    }
    const state = makeState({ characters: [me, ...enemies] });
    const digest = buildVisibleStateDigest(state, "P1", []);
    for (const line of digest.split("\n")) {
      // Detect any 50+-char run of a single char (other than empty lines).
      expect(line).not.toMatch(/(.)\1{49,}/);
    }
  });
});

// ─── Test 13 — Token-budget proxy (binding) ─────────────────────────────────

describe("WP8 — token budget (binding, ≤ 1200 input tokens via chars/4 proxy)", () => {
  it("system + persona + scratchpad + digest stays under 1200 tokens for a saturated mid-game state", () => {
    // 8 visible entities, 5 heard messages, 3 lastKnown, evac revealed,
    // all affordances. Mirror WP8 acceptance bullet exactly.
    const observerLastKnown: LastKnownEntry[] = [
      { characterId: "Q1", pos: { x: 10, y: 10 }, atTurn: 30 },
      { characterId: "Q2", pos: { x: 12, y: 12 }, atTurn: 31 },
      { characterId: "Q3", pos: { x: 14, y: 14 }, atTurn: 32 },
    ];
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      hp: 72,
      weapon: "axe",
      armour: "leather",
      consumable: "heal",
      lastKnown: observerLastKnown,
    });
    // 4 visible characters at varying distances.
    const enemies: CharacterState[] = [];
    for (let i = 2; i <= 5; i++) {
      enemies.push(
        makeCharacter({
          id: `P${i}`,
          displayName: `Player_${i}`,
          pos: { x: 50 + i, y: 50 + i },
          weapon: "sword",
        }),
      );
    }
    const chests: ChestState[] = [
      makeChest("chest_001", { x: 53, y: 50 }),
      makeChest("chest_002", { x: 54, y: 50 }),
    ];
    const corpses: CorpseState[] = [
      makeCorpse("Player_6", { x: 50, y: 53 }),
      makeCorpse("Player_7", { x: 50, y: 54 }),
    ];
    const state = makeState({
      characters: [me, ...enemies],
      world: {
        chests,
        corpses,
        evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 35,
    });
    // 5 heard messages — each speaker resolves to a displayName via the
    // characters list above, so the rendered Heard: section is realistic.
    const heard: HeardSpeech[] = [
      { speakerId: "P2", text: "Truce at evac?" },
      { speakerId: "P3", text: "Watch your six." },
      { speakerId: "P4", text: "Splitting heading northwest." },
      { speakerId: "P5", text: "Camping the chest." },
      { speakerId: "P2", text: "Last call." },
    ];
    const personaText80 = "Move quietly. Avoid fights. Loot chests. ".repeat(8);
    // 80 tokens proxy ≈ 320 chars; the .repeat(8) above lands ~320 chars.
    const scratchpad500 = "x".repeat(500);

    const built = buildAgentInput(state, "P1", personaText80, heard);
    const total =
      SYSTEM_PROMPT.length +
      personaText80.length +
      scratchpad500.length +
      built.visibleStateDigest.length;
    const approxTokens = Math.ceil(total / 4);
    expect(
      approxTokens,
      `prompt budget exceeded — ${approxTokens} tokens (chars=${total})`,
    ).toBeLessThanOrEqual(1200);
  });
});

// ─── Bonus tests — direction rendering + equipped slot dashes ───────────────

describe("WP8 — direction rendering", () => {
  it("renders 8-octant compass direction relative to observer", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // NE: dx > 0 (east), dy < 0 (north because y grows south)
    const ne = makeCharacter({
      id: "P2",
      displayName: "Player_2",
      pos: { x: 56, y: 44 },
    });
    const state = makeState({ characters: [me, ne] });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).toMatch(/Player_2.*dist 6 NE/);
  });
});

describe("WP8 — equipped slot rendering", () => {
  it("missing slots render as em-dash placeholders", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      weapon: "axe",
    });
    const state = makeState({ characters: [me] });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).toContain("Equipped: axe / — / —");
  });

  it("all slots equipped renders as 'axe / leather / heal'", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      weapon: "axe",
      armour: "leather",
      consumable: "heal",
    });
    const state = makeState({ characters: [me] });
    const digest = buildVisibleStateDigest(state, "P1", []);
    expect(digest).toContain("Equipped: axe / leather / heal");
  });
});

describe("WP8 — buildAgentInput composition", () => {
  it("returns systemPrompt (SYSTEM_PROMPT) and visibleStateDigest", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({ characters: [me] });
    const built = buildAgentInput(state, "P1", "persona text", []);
    expect(built.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(built.visibleStateDigest).toContain("Turn:");
    expect(built.visibleStateDigest).toContain("You are at");
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the body of a section starting at `header`. Returns text from the
 * header line up to the next `^[A-Z][^:\n]*:$` line (a section header) or
 * the end of the digest. Used to scope assertions to one section.
 */
function extractSection(digest: string, header: string): string {
  const lines = digest.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith(header));
  if (startIdx === -1) return "";
  // Find the next section header line (a line ending in ':' that is not a
  // bullet "- ..."). The block ends just before it.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("- ")) continue;
    if (line.trim() === "") continue;
    if (/^[A-Z][^\n]*:$|^[A-Z][^\n]*: /.test(line) && !line.startsWith("- ")) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}
