// WP-C.6 — TDD tests for the rebuilt per-turn agent input (phase-3 ADR §6).
//
// Phase-3 substrate refinement reshapes the digest per North Star §1:
//
//   You: at (X,Y), HP/maxHP, weapon/armour/consumable, in evac zone
//   Last turn (you): <move outcome>, <action outcome>, <damage from whom>, said "..."
//   Visible:
//   - Player_4, dist 7 S [HP~high, holding axe, attacked Player_2]
//   - Chest_005, dist 6 SE [opened]
//   - Corpse_Player_5, dist 9 S [drained]
//   - Cover_32_32, dist 4 SE
//   - Wall_40_34, dist 1 S
//   - Evac, dist 12 SE
//
// Removed sections (vs phase-1 digest): `Affordances:`, `Heard (last turn):`,
// `Last-known:`, `Evac:` — last-turn speech folds into per-Visible
// observation brackets; last-known map memory is the agent's job; the
// system prompt teaches the action grammar (no Affordances band-aid).
//
// Tests are written FIRST per AOP (Red → Green → Refactor). They lock the
// digest contract that runMatch.advanceTurn + the report writer + WP-D's
// replay UI rely on.
//
// Token-count proxy. We use **`chars / 4`** as a deterministic, install-free
// proxy for tiktoken token counts (matches `tests/llm/personas.test.ts`).
//
// Cross-references:
//   - architecture-decisions.md §5 (walls), §6 (per-turn input shape),
//     §7 (system prompt), §9 (wall-blocked move).
//   - work-packages.md WP-C.6 — locks test cases.
//   - concept-spec.md §7 (vision example), §8 (agent input list).

import { describe, expect, it } from "vitest";
import {
  buildAgentInput,
  buildVisibleStateDigest,
  type PrevTurnRow,
} from "../../convex/llm/inputBuilder.js";
import { SYSTEM_PROMPT } from "../../convex/llm/systemPrompt.js";
import { loadPersonas } from "../../convex/llm/personas.js";
import {
  PERSONA_IDS,
  type CharacterState,
  type ChestState,
  type CorpseState,
  type MatchState,
  type MoveDecision,
  type PersonaId,
  type Tile,
  type Wall,
  type WorldState,
} from "../../convex/engine/types.js";

// ─── Test fixture helpers ───────────────────────────────────────────────────

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
    hp: opts.hp ?? 50,
    maxHp: opts.maxHp ?? 50,
    pos: opts.pos,
    equipped,
    scratchpad: "",
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

/** Build a minimal PrevTurnRow shape with sensible defaults; callers
 *  populate the fields they exercise. */
function makePrevTurn(
  partial: Partial<PrevTurnRow["resolution"]> = {},
  opts: { priorMoveByActor?: Record<string, MoveDecision> } = {},
): PrevTurnRow {
  const row: PrevTurnRow = {
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
  if (opts.priorMoveByActor !== undefined) {
    row.priorMoveByActor = opts.priorMoveByActor;
  }
  return row;
}

// ─── Test 1 — You: line, base shape ────────────────────────────────────────

describe("WP-C.1 — You: line", () => {
  it("renders pos, HP/maxHP, equipped slots; no evac suffix before reveal", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 15, y: 15 },
      hp: 42,
      maxHp: 50,
      weapon: "axe",
      armour: "leather",
      consumable: "heal",
    });
    const state = makeState({ characters: [me], turn: 7 });
    const digest = buildVisibleStateDigest(state, "P1", null);

    // You: line carries position, HP, weapon/armour/consumable (slash-joined).
    expect(digest).toMatch(
      /^You: at \(15,15\), 42\/50 HP, axe \/ leather \/ heal/m,
    );
    // No evac suffix when evac is hidden.
    expect(digest).not.toContain("in evac zone");
    expect(digest).not.toContain("not in evac zone");
  });

  it("renders em-dash for missing equipped slots", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const state = makeState({ characters: [me] });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/^You: .*sword \/ — \/ —/m);
  });

  it("'in evac zone' suffix appears iff evac revealed AND observer inside 3x3 zone", () => {
    // Evac centre at (50,50), zone is 3x3 (centre ± 1). Observer at (49,50)
    // is inside.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 49, y: 50 },
    });
    const state = makeState({
      characters: [me],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
      turn: 35,
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toContain("in evac zone");
    expect(digest).not.toContain("not in evac zone");
  });

  it("'not in evac zone' suffix appears iff evac revealed AND observer outside 3x3 zone", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({
      characters: [me],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
      turn: 35,
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toContain("not in evac zone");
  });
});

// ─── Test 2 — Last turn (you) line ──────────────────────────────────────────

describe("WP-C.1 — Last turn (you) line", () => {
  it("turn 1 (no prevTurnRow) → omits the Last turn line", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 5, y: 5 },
    });
    const state = makeState({ characters: [me], turn: 1 });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).not.toContain("Last turn (you):");
  });

  it("renders move outcome from moves[] (no blockedBy)", () => {
    // P1 at (10,10) last turn moved from (7,13) to (10,10) — Chebyshev 3 NE.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      moves: [
        { characterId: "P1", from: { x: 7, y: 13 }, to: { x: 10, y: 10 } },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\): moved 3 NE/);
  });

  it("renders 'moved 3 SW → hit wall' fragment from moves[].blockedBy === 'wall' (ADR §9)", () => {
    // ADR §9 — wall-blocked move emits from === to with blockedBy:"wall".
    // The "3 SW" is the INTENDED direction; we encode that via the position
    // recorded as `from` matches `to` (start === end) but the digest still
    // needs a direction. Per ADR §9: "moved 3 SW → hit wall" means the
    // intended direction was 3 SW; we read it from the DECISION, not the
    // move trace.
    //
    // Compromise contract: when `blockedBy === "wall"`, the digest renders
    // the from→to (which is identity) as a generic "→ hit wall" fragment;
    // direction-from-intent comes from a future enrichment. Phase-3 v1
    // contract accepts "moved 0 → hit wall" or just "→ hit wall" wording.
    //
    // The IMPLEMENTATION choice locked here: when blockedBy==="wall" AND
    // from===to, we render "tried to move → hit wall". The "3 SW" form
    // requires the agent's intended next-step direction which isn't on the
    // moves[] entry — it's on `decision.move`. To keep this test
    // implementation-faithful, we assert the wall-block fragment.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "P1",
          from: { x: 10, y: 10 },
          to: { x: 10, y: 10 },
          blockedBy: "wall",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*hit wall/);
  });

  // ─── WP-F.4 — wall-blocked move outcome carries directional vector ──────
  // North Star §1: `Last turn (you): moved 3 SW → hit wall, ...`. Recovery
  // path: combine moves[].blockedBy === 'wall' with the actor's prior
  // decision.move (carried via PrevTurnRow.priorMoveByActor) to render the
  // INTENT direction. Phase-3 ADR §9.

  it("WP-F.4 — wall block + prior relative move renders 'moved 3 SW → hit wall' (North Star §1)", () => {
    // Engine convention: x→east, y→south. dx=-3, dy=3 ⇒ SW bearing.
    // Chebyshev distance = max(|dx|, |dy|) = 3.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn(
      {
        moves: [
          {
            characterId: "P1",
            from: { x: 10, y: 10 },
            to: { x: 10, y: 10 },
            blockedBy: "wall",
          },
        ],
      },
      {
        priorMoveByActor: {
          P1: { kind: "relative", dx: -3, dy: 3 },
        },
      },
    );
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*moved 3 SW → hit wall/);
  });

  it("WP-F.4 — non-wall move outcome is unchanged when prior decision is present", () => {
    // Successful move with prior relative decision: existing 'moved N <bearing>'
    // wording renders; no 'hit wall' wording.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn(
      {
        moves: [
          { characterId: "P1", from: { x: 7, y: 13 }, to: { x: 10, y: 10 } },
        ],
      },
      {
        priorMoveByActor: {
          P1: { kind: "relative", dx: 3, dy: -3 },
        },
      },
    );
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\): moved 3 NE/);
    expect(digest).not.toContain("hit wall");
  });

  it("WP-F.4 — wall block WITHOUT prior decision falls back to 'tried to move → hit wall'", () => {
    // Defensive fallback: when priorMoveByActor is absent (turn 0 in the
    // chain, missing record, etc.), the directional render is suppressed
    // and the existing wall-block fragment wording is preserved.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      moves: [
        {
          characterId: "P1",
          from: { x: 10, y: 10 },
          to: { x: 10, y: 10 },
          blockedBy: "wall",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*tried to move → hit wall/);
    expect(digest).not.toMatch(/moved \d+ [NESW]/);
  });

  it("WP-F.4 — wall block with non-relative prior move kind falls back to existing wording", () => {
    // toward_entity / toward_object / toward_evac don't carry a (dx,dy)
    // intent vector; the renderer can't compute a bearing, so the existing
    // fallback wording is preserved. Only the relative arm is enriched.
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn(
      {
        moves: [
          {
            characterId: "P1",
            from: { x: 10, y: 10 },
            to: { x: 10, y: 10 },
            blockedBy: "wall",
          },
        ],
      },
      {
        priorMoveByActor: {
          P1: { kind: "toward_entity", targetCharacterId: "P3" },
        },
      },
    );
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*tried to move → hit wall/);
    expect(digest).not.toMatch(/moved \d+ [NESW]/);
  });

  it("WP-F.4 — wall block with prior relative dx=0,dy=-1 renders 'moved 1 N → hit wall'", () => {
    // Single-step cardinal vector. Confirms the bearing helper handles
    // axis-aligned vectors and the chebyshev distance computation matches
    // max(|dx|, |dy|).
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn(
      {
        moves: [
          {
            characterId: "P1",
            from: { x: 10, y: 10 },
            to: { x: 10, y: 10 },
            blockedBy: "wall",
          },
        ],
      },
      {
        priorMoveByActor: {
          P1: { kind: "relative", dx: 0, dy: -1 },
        },
      },
    );
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*moved 1 N → hit wall/);
  });

  it("renders attack action outcome (kind/target/result)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "P1",
          kind: "attack",
          target: "Player_3",
          result: "dmg 7",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*attacked Player_3 \(dmg 7\)/);
  });

  it("renders loot action outcome with chest target", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "P1",
          kind: "loot",
          target: "chest_005",
          result: "opened",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*looted chest_005 \(opened\)/);
  });

  it("renders damage-taken-from with single attacker", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "P3",
          kind: "attack",
          target: "Player_1",
          result: "dmg 12",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/took 12 dmg from Player_3/);
  });

  it("renders damage-taken-from with multiple attackers, comma-joined", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "P3",
          kind: "attack",
          target: "Player_1",
          result: "dmg 12",
        },
        {
          characterId: "P4",
          kind: "attack",
          target: "Player_1",
          result: "dmg 5",
        },
        {
          characterId: "P5",
          kind: "overwatch",
          target: "Player_1",
          result: "dmg 8",
          fromOverwatch: true,
          stance: "defensive",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    // All 3 attackers should appear; HP-level total is 12+5+8=25.
    expect(digest).toMatch(/took 25 dmg/);
    expect(digest).toContain("Player_3");
    expect(digest).toContain("Player_4");
    expect(digest).toContain("Player_5");
  });

  it("renders said \"...\" fragment from speech[]", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      speech: [
        { characterId: "P1", text: "Truce?", heardBy: [] },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Last turn \(you\):.*said "Truce\?"/);
  });

  it("composes all 4 fragments in order: move, action, damage, said", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 10, y: 10 },
    });
    const state = makeState({ characters: [me], turn: 5 });
    const prev = makePrevTurn({
      moves: [
        { characterId: "P1", from: { x: 7, y: 13 }, to: { x: 10, y: 10 } },
      ],
      actions: [
        {
          characterId: "P1",
          kind: "attack",
          target: "Player_3",
          result: "dmg 7",
        },
        {
          characterId: "P4",
          kind: "attack",
          target: "Player_1",
          result: "dmg 5",
        },
      ],
      speech: [
        { characterId: "P1", text: "Hold!", heardBy: [] },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    const lastLine = digest
      .split("\n")
      .find((l) => l.startsWith("Last turn (you):"));
    expect(lastLine).toBeDefined();
    // Order: move comes first, then action, then damage, then said.
    const moveIdx = lastLine!.indexOf("moved");
    const attackIdx = lastLine!.indexOf("attacked");
    const dmgIdx = lastLine!.indexOf("took");
    const saidIdx = lastLine!.indexOf("said");
    expect(moveIdx).toBeGreaterThan(0);
    expect(attackIdx).toBeGreaterThan(moveIdx);
    expect(dmgIdx).toBeGreaterThan(attackIdx);
    expect(saidIdx).toBeGreaterThan(dmgIdx);
  });
});

// ─── Test 3 — Visible: typed-id rendering ──────────────────────────────────

describe("WP-C.1 — Visible bullets — typed-id rendering", () => {
  it("character bullet uses 'Player_N' displayName", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const enemy = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
    });
    const state = makeState({ characters: [me, enemy] });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/- Player_4, dist 5 E/);
  });

  it("chest bullet uses 'Chest_NNN' from objectId", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [me],
      world: { chests: [makeChest("chest_005", { x: 53, y: 50 })] },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/- Chest_005, dist 3 E/);
  });

  it("corpse bullet uses 'Corpse_<displayName>' format", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // Corpse character lives in characters[] (defunct alive=false) so the
    // displayName is resolvable.
    const dead = makeCharacter({
      id: "P5",
      displayName: "Player_5",
      pos: { x: 50, y: 53 },
      alive: false,
    });
    const state = makeState({
      characters: [me, dead],
      world: { corpses: [makeCorpse("P5", { x: 50, y: 53 })] },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/- Corpse_Player_5, dist 3 S/);
  });

  it("cover bullet uses 'Cover_X_Y' positional id", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 28, y: 30 },
    });
    const state = makeState({
      characters: [me],
      world: { coverTiles: [{ x: 32, y: 32 }] },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/- Cover_32_32, dist 4 SE/);
  });

  it("wall bullet uses 'Wall_X_Y' positional id", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 40, y: 35 },
    });
    const wall: Wall = { x: 40, y: 34, w: 1, h: 1 };
    const state = makeState({
      characters: [me],
      world: { walls: [wall] },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/- Wall_40_34, dist 1 N/);
  });
});

// ─── Test 4 — Per-Visible observation brackets ─────────────────────────────

describe("WP-C.1 — Per-Visible observation brackets", () => {
  it("character bullet renders [HP~bucket]", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // hp=45 / maxHp=50 → ratio 0.9 → high
    const enemy = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
      hp: 45,
      maxHp: 50,
    });
    const state = makeState({ characters: [me, enemy] });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/Player_4.*\[HP~high/);
  });

  it("character bullet renders 'holding axe' when armed", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const enemy = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
      weapon: "axe",
    });
    const state = makeState({ characters: [me, enemy] });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/Player_4.*holding axe/);
  });

  it("character bullet renders 'attacked Player_X' from prevTurnRow.actions[]", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const observed = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
    });
    const state = makeState({ characters: [me, observed], turn: 5 });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "P4",
          kind: "attack",
          target: "Player_2",
          result: "dmg 5",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Player_4.*attacked Player_2/);
  });

  it("character bullet renders 'said \"...\"' from prevTurnRow.speech[]", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const observed = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
    });
    const state = makeState({ characters: [me, observed], turn: 5 });
    const prev = makePrevTurn({
      speech: [
        { characterId: "P4", text: "Hold!", heardBy: [] },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    expect(digest).toMatch(/Player_4.*said "Hold!"/);
  });

  it("multiple brackets joined within one bullet", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const observed = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
      hp: 45,
      maxHp: 50,
      weapon: "axe",
    });
    const state = makeState({ characters: [me, observed], turn: 5 });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "P4",
          kind: "attack",
          target: "Player_2",
          result: "dmg 5",
        },
      ],
    });
    const digest = buildVisibleStateDigest(state, "P1", prev);
    const line = digest
      .split("\n")
      .find((l) => l.includes("Player_4") && l.startsWith("- "));
    expect(line).toBeDefined();
    expect(line).toContain("HP~high");
    expect(line).toContain("holding axe");
    expect(line).toContain("attacked Player_2");
  });

  it("opened chest renders [opened] marker", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const opened = makeChest("chest_001", { x: 53, y: 50 }, true);
    const state = makeState({
      characters: [me],
      world: { chests: [opened] },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/Chest_001.*\[opened\]/);
  });

  it("drained corpse (no contents) renders [drained] marker", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const dead = makeCharacter({
      id: "P5",
      displayName: "Player_5",
      pos: { x: 50, y: 53 },
      alive: false,
    });
    const state = makeState({
      characters: [me, dead],
      // contents = {} → drained
      world: { corpses: [makeCorpse("P5", { x: 50, y: 53 }, {})] },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toMatch(/Corpse_Player_5.*\[drained\]/);
  });

  it("non-drained corpse (with gear) does NOT render [drained]; renders gear", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const dead = makeCharacter({
      id: "P5",
      displayName: "Player_5",
      pos: { x: 50, y: 53 },
      alive: false,
    });
    const state = makeState({
      characters: [me, dead],
      world: {
        corpses: [
          makeCorpse("P5", { x: 50, y: 53 }, {
            weapon: { category: "weapon", name: "axe" },
            armour: { category: "armour", name: "leather" },
          }),
        ],
      },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const line = digest
      .split("\n")
      .find((l) => l.includes("Corpse_Player_5"));
    expect(line).toBeDefined();
    expect(line).not.toContain("[drained]");
    expect(line).toContain("axe");
    expect(line).toContain("leather");
  });
});

// ─── Test 5 — Sort order ────────────────────────────────────────────────────

describe("WP-C.1 — Visible sort order (chars → chests/corpses → cover/walls → Evac)", () => {
  it("orders categories per ADR §6", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const enemy = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
    });
    const dead = makeCharacter({
      id: "P5",
      displayName: "Player_5",
      pos: { x: 53, y: 50 },
      alive: false,
    });
    const state = makeState({
      characters: [me, enemy, dead],
      world: {
        chests: [makeChest("chest_002", { x: 52, y: 50 })],
        corpses: [makeCorpse("P5", { x: 53, y: 50 })],
        coverTiles: [{ x: 51, y: 50 }],
        walls: [{ x: 51, y: 51, w: 1, h: 1 }],
        evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 35,
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const lines = digest
      .split("\n")
      .filter((l) => l.startsWith("- "));
    // Indices of representative lines
    const playerIdx = lines.findIndex((l) => l.includes("Player_4"));
    const chestIdx = lines.findIndex((l) => l.includes("Chest_002"));
    const corpseIdx = lines.findIndex((l) => l.includes("Corpse_Player_5"));
    const coverIdx = lines.findIndex((l) => l.includes("Cover_"));
    const wallIdx = lines.findIndex((l) => l.includes("Wall_"));
    const evacIdx = lines.findIndex((l) => l.startsWith("- Evac"));

    expect(playerIdx).toBeGreaterThanOrEqual(0);
    expect(chestIdx).toBeGreaterThan(playerIdx);
    expect(corpseIdx).toBeGreaterThan(playerIdx);
    expect(coverIdx).toBeGreaterThan(chestIdx);
    expect(coverIdx).toBeGreaterThan(corpseIdx);
    expect(wallIdx).toBeGreaterThan(coverIdx);
    expect(evacIdx).toBeGreaterThan(wallIdx);
  });

  it("drained corpses sort AFTER non-drained at equal distance", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const dead1 = makeCharacter({
      id: "P5",
      displayName: "Player_5",
      pos: { x: 53, y: 50 },
      alive: false,
    });
    const dead2 = makeCharacter({
      id: "P6",
      displayName: "Player_6",
      pos: { x: 53, y: 51 },
      alive: false,
    });
    const state = makeState({
      characters: [me, dead1, dead2],
      world: {
        corpses: [
          // P5 drained (at dist 3) + P6 has gear (at dist 3 too)
          makeCorpse("P5", { x: 53, y: 50 }, {}),
          makeCorpse("P6", { x: 53, y: 51 }, {
            weapon: { category: "weapon", name: "sword" },
          }),
        ],
      },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const lines = digest
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const drainedIdx = lines.findIndex((l) => l.includes("Player_5"));
    const lootableIdx = lines.findIndex((l) => l.includes("Player_6"));
    expect(drainedIdx).toBeGreaterThan(lootableIdx);
  });

  it("walls sorted last among cover/walls (per ADR §5)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [me],
      world: {
        // Wall is closer (dist 1) than cover (dist 4); per ADR §5 walls
        // still render LAST.
        walls: [{ x: 51, y: 50, w: 1, h: 1 }],
        coverTiles: [{ x: 54, y: 50 }],
      },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const lines = digest
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const coverIdx = lines.findIndex((l) => l.includes("Cover_"));
    const wallIdx = lines.findIndex((l) => l.includes("Wall_"));
    expect(wallIdx).toBeGreaterThan(coverIdx);
  });

  it("Evac singleton renders only AFTER reveal", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const stateBefore = makeState({
      characters: [me],
      world: { evac: { centre: { x: 60, y: 60 }, revealedAtTurn: null } },
    });
    const digestBefore = buildVisibleStateDigest(stateBefore, "P1", null);
    expect(digestBefore).not.toContain("- Evac");

    const stateAfter = makeState({
      characters: [me],
      world: { evac: { centre: { x: 60, y: 60 }, revealedAtTurn: 30 } },
      turn: 35,
    });
    const digestAfter = buildVisibleStateDigest(stateAfter, "P1", null);
    expect(digestAfter).toMatch(/- Evac, dist 10 SE/);
  });

  it("character ties broken by id ASC", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // Both at dist 5 — id ASC (P3 < P4) means P3 should render first.
    const p4 = makeCharacter({
      id: "P4",
      displayName: "Player_4",
      pos: { x: 55, y: 50 },
    });
    const p3 = makeCharacter({
      id: "P3",
      displayName: "Player_3",
      pos: { x: 45, y: 50 },
    });
    const state = makeState({ characters: [me, p4, p3] });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const lines = digest
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const p3Idx = lines.findIndex((l) => l.includes("Player_3"));
    const p4Idx = lines.findIndex((l) => l.includes("Player_4"));
    expect(p3Idx).toBeLessThan(p4Idx);
  });
});

// ─── Test 6 — VISIBLE_ENTITY_CAP=8 (chars+chests+corpses) ──────────────────

describe("WP-C.1 — VISIBLE_ENTITY_CAP=8 (chars+chests+corpses); cover/walls unbounded", () => {
  it("12 chars+chests → exactly 8 in the chars+chests/corpses tiers", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // 4 close characters at distances 1..4
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
    // 8 close chests at distances 5..12 (south column)
    const closeChests: ChestState[] = [];
    for (let i = 0; i < 8; i++) {
      closeChests.push(
        makeChest(`chest_${100 + i}`, { x: 50, y: 50 + (i + 5) }),
      );
    }
    const state = makeState({
      characters: [me, ...closeChars],
      world: { chests: closeChests },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const lines = digest
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const charLines = lines.filter((l) => l.startsWith("- Player_"));
    const chestLines = lines.filter((l) => l.startsWith("- Chest_"));
    expect(charLines.length + chestLines.length).toBe(8);
    // The 4 chars are closer than every chest (distances 1..4 < 5..12), so
    // all 4 chars + the 4 closest chests (distances 5..8) should appear;
    // chests 9..12 are dropped.
    expect(charLines.length).toBe(4);
    expect(chestLines.length).toBe(4);
  });

  it("cover tiles are unbounded (not capped against the 8-cap)", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // 4 chars filling part of the 8-cap, then 6 cover tiles.
    const closeChars: CharacterState[] = [];
    for (let i = 0; i < 8; i++) {
      closeChars.push(
        makeCharacter({
          id: `C${i}`,
          displayName: `Player_${i + 2}`,
          pos: { x: 50 + (i + 1), y: 50 },
        }),
      );
    }
    const covers: Tile[] = [];
    for (let i = 0; i < 6; i++) {
      covers.push({ x: 50, y: 50 + (i + 9) });
    }
    const state = makeState({
      characters: [me, ...closeChars],
      world: { coverTiles: covers },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const lines = digest
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const coverLines = lines.filter((l) => l.startsWith("- Cover_"));
    // All 6 covers render (cap=12 in vision, unbounded in inputBuilder).
    expect(coverLines.length).toBe(6);
  });
});

// ─── Test 7 — 12-wall safety ceiling (ADR §5) ──────────────────────────────

describe("WP-C.1 — 12-wall safety ceiling (ADR §5)", () => {
  it("emits at most 12 walls even when vision-side emission exceeds", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    // A single wall rectangle spanning 5x5 = 25 wall tiles, all within
    // Chebyshev 20. Vision emits all 25; inputBuilder must cap at 12.
    const wall: Wall = { x: 51, y: 51, w: 5, h: 5 };
    const state = makeState({
      characters: [me],
      world: { walls: [wall] },
    });
    const digest = buildVisibleStateDigest(state, "P1", null);
    const lines = digest
      .split("\n")
      .filter((l) => l.startsWith("- Wall_"));
    expect(lines.length).toBe(12);
  });
});

// ─── Test 8 — Explicit no-deleted-headers assertion ────────────────────────

describe("WP-C.1 — no deleted section headers (Affordances/Heard/Last-known/Evac)", () => {
  // Build a populous mid-game state to maximise the chance of accidental
  // header emission across all branches.
  function populousDigest(): string {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
      weapon: "axe",
      armour: "leather",
      consumable: "heal",
    });
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
    const dead = makeCharacter({
      id: "P6",
      displayName: "Player_6",
      pos: { x: 50, y: 53 },
      alive: false,
    });
    const state = makeState({
      characters: [me, ...enemies, dead],
      world: {
        chests: [
          makeChest("chest_001", { x: 53, y: 50 }),
          makeChest("chest_002", { x: 54, y: 50 }, true),
        ],
        corpses: [makeCorpse("P6", { x: 50, y: 53 })],
        coverTiles: [{ x: 51, y: 51 }],
        walls: [{ x: 49, y: 49, w: 1, h: 1 }],
        evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 35,
    });
    const prev = makePrevTurn({
      actions: [
        {
          characterId: "P1",
          kind: "attack",
          target: "Player_3",
          result: "dmg 7",
        },
      ],
      speech: [
        { characterId: "P1", text: "Hold!", heardBy: [] },
        { characterId: "P4", text: "Coming!", heardBy: [] },
      ],
    });
    return buildVisibleStateDigest(state, "P1", prev);
  }

  it("digest does NOT contain 'Affordances:' as a section header", () => {
    expect(populousDigest()).not.toContain("Affordances:");
  });

  it("digest does NOT contain 'Heard (last turn):' as a section header", () => {
    expect(populousDigest()).not.toContain("Heard (last turn):");
  });

  it("digest does NOT contain 'Last-known:' as a section header", () => {
    expect(populousDigest()).not.toContain("Last-known:");
  });

  it("digest does NOT contain 'Evac:' as a section header (Evac is now a Visible singleton)", () => {
    // The string "Evac" appears inside the Visible singleton bullet;
    // assert that no LINE is exactly "Evac:" (the section header form).
    const digest = populousDigest();
    const headerLine = digest
      .split("\n")
      .find((l) => l.trim() === "Evac:");
    expect(headerLine).toBeUndefined();
  });
});

// ─── Test 9 — Token budget (composed input ≤ 1200 tokens) ──────────────────

describe("WP-C.1 — token budget (≤ 1200 input tokens via chars/4 proxy)", () => {
  it("composed (system + persona + scratchpad + digest) stays under 1200 tokens for at least one synthetic state per persona", () => {
    const personas = loadPersonas();
    for (const id of PERSONA_IDS) {
      // Saturated mid-game state: 4 visible chars, 2 chests, 1 corpse,
      // walls, cover, evac revealed, prevTurn populated.
      const me = makeCharacter({
        id: "P1",
        displayName: "Player_1",
        pos: { x: 50, y: 50 },
        hp: 35,
        maxHp: 50,
        weapon: "axe",
        armour: "leather",
        consumable: "heal",
        personaId: id,
      });
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
      const dead = makeCharacter({
        id: "P6",
        displayName: "Player_6",
        pos: { x: 50, y: 53 },
        alive: false,
      });
      const state = makeState({
        characters: [me, ...enemies, dead],
        world: {
          chests: [
            makeChest("chest_001", { x: 53, y: 50 }, true),
            makeChest("chest_002", { x: 54, y: 50 }),
          ],
          corpses: [makeCorpse("P6", { x: 50, y: 53 })],
          coverTiles: [{ x: 51, y: 51 }, { x: 52, y: 52 }],
          walls: [{ x: 49, y: 49, w: 1, h: 1 }],
          evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
        },
        turn: 35,
      });
      const prev = makePrevTurn({
        moves: [
          { characterId: "P1", from: { x: 47, y: 53 }, to: { x: 50, y: 50 } },
        ],
        actions: [
          {
            characterId: "P1",
            kind: "attack",
            target: "Player_3",
            result: "dmg 7",
          },
          {
            characterId: "P4",
            kind: "attack",
            target: "Player_1",
            result: "dmg 5",
          },
        ],
        speech: [
          { characterId: "P1", text: "Truce?", heardBy: [] },
          { characterId: "P3", text: "Watch your six.", heardBy: [] },
        ],
      });
      const personaText = personas[id];
      const scratchpad500 = "x".repeat(500);
      const built = buildAgentInput(state, "P1", personaText, prev);
      const total =
        built.systemPrompt.length +
        personaText.length +
        scratchpad500.length +
        built.visibleStateDigest.length;
      const approxTokens = Math.ceil(total / 4);
      expect(
        approxTokens,
        `persona "${id}" budget exceeded — ${approxTokens} tokens (chars=${total})`,
      ).toBeLessThanOrEqual(1200);
    }
  });
});

// ─── Test 10 — buildAgentInput composition ──────────────────────────────────

describe("WP-C.1 — buildAgentInput composition", () => {
  it("returns systemPrompt (SYSTEM_PROMPT) and visibleStateDigest", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({ characters: [me] });
    const built = buildAgentInput(state, "P1", "persona text", null);
    expect(built.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(built.visibleStateDigest).toMatch(/^You: at \(50,50\)/m);
  });
});

// ─── Test 11 — Visibility filter retained ──────────────────────────────────

describe("WP-C.1 — visibility filter retained from phase-1", () => {
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
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).toContain("Player_2");
    expect(digest).not.toContain("Player_3");
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
    const digest = buildVisibleStateDigest(state, "P1", null);
    // No corpse exists in world.corpses, so neither character bullet nor
    // corpse bullet appears.
    expect(digest).not.toContain("Player_2");
  });
});

// ─── Test 12 — Plain text, not an ASCII grid ───────────────────────────────

describe("WP-C.1 — tactical digest is plain text, not an ASCII grid", () => {
  it("digest does NOT contain repeated . or # patterns characteristic of ASCII grids", () => {
    const me = makeCharacter({
      id: "P1",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({ characters: [me] });
    const digest = buildVisibleStateDigest(state, "P1", null);
    expect(digest).not.toMatch(/\.{5,}/);
    expect(digest).not.toMatch(/#{5,}/);
  });
});
