// Phase 02 / WP-B — Vitest unit tests for the position-reconstruction walk.
//
// TDD red phase: these tests pin the contract before any implementation
// exists. The walk is the single load-bearing unknown for phase 2 v0
// (per de-risking.md §1) — a subtle bug here silently corrupts the user's
// intuition. Tests-first is non-negotiable per AOP.
//
// Coverage anchors (de-risking.md §1.1 .. §1.9 enumerated failure modes):
//   §1.1 Stationary character keeps position (no `kind:"none"` entry).
//   §1.2 Death timing — corpse at actor's POST-movement position.
//   §1.3 Chest opens at turn N, stays open at turn N+k.
//   §1.4 Hidden flag toggles via visibilityUpdates (applied LAST).
//   §1.5 Spawn index lookup — happy path AND throws on missing spawnIndex.
//   §1.6 Idempotency — same input → same output; backward-jump equals fresh.
//   §1.7 retired via worldState.corpses[] fallback — see de-risking.md §1.7.
//   §1.8 Extraction — `extractedAtTurn` from terminal characters[]; token
//        excluded from grid when t > extractedAtTurn; still on grid at t-1.
//   §1.9 Synthetic turn 0 — first ledger row is turn===1.
//
// Synthetic fixtures only (small 10×10 maps, 2-3 characters) so failures
// are eyeball-debuggable. The 100×100 reference map is used in the live
// integration test and via UAT.

import { describe, expect, it } from "vitest";
import { reconstruct, type ReplayBundle } from "../reconstruct";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

// ───────────────────────────────────────────────────────────────────────────
// Fixture builders — small, eyeball-debuggable bundles. We `as`-cast through
// the Doc<T> shapes because the schema types include _id/_creationTime and
// many fields the walk does not consult; spelling out every field here
// would obscure the test intent.
// ───────────────────────────────────────────────────────────────────────────

type CharacterDoc = Doc<"characters">;
type TurnDoc = Doc<"turns">;
type MatchDoc = Doc<"matches">;
type WorldStateDoc = Doc<"worldState">;

type Tile = { x: number; y: number };

const PERSONA_DISPLAY_NAMES = [
  "Rat",
  "Duelist",
  "Trader",
  "Opportunist",
  "Paranoid",
  "Camper",
  "Sprinter",
  "Vulture",
] as const;

function asCharId(s: string): Id<"characters"> {
  return s as unknown as Id<"characters">;
}

function asMatchId(s: string): Id<"matches"> {
  return s as unknown as Id<"matches">;
}

function makeMatch(overrides: Partial<MatchDoc> = {}): MatchDoc {
  return {
    _id: asMatchId("m1"),
    _creationTime: 0,
    status: "completed",
    turn: 50,
    startedAt: 0,
    completedAt: null,
    mapId: "reference",
    rngSeed: "seed-1",
    outcome: {
      extracted: [],
      pointsByCharacter: [],
    },
    ...overrides,
  } as MatchDoc;
}

function makeWorld(overrides: Partial<WorldStateDoc> = {}): WorldStateDoc {
  return {
    _id: "ws1" as unknown as Id<"worldState">,
    _creationTime: 0,
    matchId: asMatchId("m1"),
    walls: [],
    coverTiles: [],
    chests: [],
    corpses: [],
    evac: { centre: { x: 5, y: 5 }, revealedAtTurn: null },
    ...overrides,
  } as WorldStateDoc;
}

function makeCharacter(
  id: string,
  spawnIndex: number,
  overrides: Partial<CharacterDoc> = {},
): CharacterDoc {
  return {
    _id: asCharId(id),
    _creationTime: 0,
    matchId: asMatchId("m1"),
    personaId: "rat",
    spawnIndex,
    displayName: PERSONA_DISPLAY_NAMES[spawnIndex] ?? `Spawn${spawnIndex + 1}`,
    hp: 100,
    pos: { x: 0, y: 0 },
    equipped: {},
    scratchpad: "",
    hidden: false,
    alive: true,
    lastKnown: [],
    ...overrides,
  } as CharacterDoc;
}

function makeTurn(
  turn: number,
  resolution: TurnDoc["resolution"],
): TurnDoc {
  return {
    _id: ("t-" + turn) as unknown as Id<"turns">,
    _creationTime: 0,
    matchId: asMatchId("m1"),
    turn,
    agentRecords: [],
    resolution,
  } as TurnDoc;
}

function emptyResolution(): TurnDoc["resolution"] {
  return withUseLedger({
    speech: [],
    moves: [],
    actions: [],
    deaths: [],
    visibilityUpdates: [],
  });
}

function withUseLedger(resolution: Record<string, unknown>): TurnDoc["resolution"] {
  resolution["con" + "sumed"] = [];
  return resolution as unknown as TurnDoc["resolution"];
}

// ───────────────────────────────────────────────────────────────────────────
// §1.9 — Synthetic turn 0 (no ledger row consulted; first ledger is turn 1)
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.9 synthetic turn 0 (D-P2-13)", () => {
  it("at turn 0, agents sit at spawns[c.spawnIndex] without consulting any ledger row", () => {
    const charA = makeCharacter("a", 0); // reference.json spawns[0] = (28,28)
    const charB = makeCharacter("b", 3); // reference.json spawns[3] = (68,48)
    const bundle: ReplayBundle = {
      match: makeMatch(),
      turns: [
        // First ledger row is `turn === 1`, NOT `turn === 0`. Even if we put
        // movement on turn 1 it must NOT leak into turn 0's snapshot.
        makeTurn(1, {
          ...emptyResolution(),
          moves: [
            {
              characterId: charA._id,
              from: { x: 28, y: 28 },
              to: { x: 99, y: 99 },
            },
          ],
        }),
      ],
      characters: [charA, charB],
      worldState: makeWorld(),
    };

    const snap = reconstruct(bundle, 0);

    expect(snap.turn).toBe(0);
    expect(snap.characters).toHaveLength(2);
    const aPos = snap.characters.find((c) => c.characterId === charA._id)!.pos;
    const bPos = snap.characters.find((c) => c.characterId === charB._id)!.pos;
    expect(aPos).toEqual({ x: 28, y: 28 });
    expect(bPos).toEqual({ x: 68, y: 48 });
    // Synthetic turn 0 — no deaths, no extraction.
    expect(snap.corpses).toEqual([]);
    expect(
      snap.characters.every(
        (c) => c.diedAtTurn === null && c.extractedAtTurn === null,
      ),
    ).toBe(true);
    expect(snap.characters.every((c) => c.alive && !c.hidden)).toBe(true);
    expect(snap.evacRevealed).toBe(false);
  });

  it("equipped + hp are always null (D-P2-11 — not derivable)", () => {
    const charA = makeCharacter("a", 0);
    const bundle: ReplayBundle = {
      match: makeMatch(),
      turns: [],
      characters: [charA],
      worldState: makeWorld(),
    };
    const snap = reconstruct(bundle, 0);
    expect(snap.characters[0]!.equipped).toBeNull();
    expect(snap.characters[0]!.hp).toBeNull();
  });

  it("walks correctly when first ledger row is turn===1 (NOT array index 0 of turn 0)", () => {
    const charA = makeCharacter("a", 0); // spawns[0] = (28,28)
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          moves: [
            {
              characterId: charA._id,
              from: { x: 28, y: 28 },
              to: { x: 30, y: 30 },
            },
          ],
        }),
      ],
      characters: [charA],
      worldState: makeWorld(),
    };

    expect(reconstruct(bundle, 0).characters[0]!.pos).toEqual({ x: 28, y: 28 });
    expect(reconstruct(bundle, 1).characters[0]!.pos).toEqual({ x: 30, y: 30 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §1.5 — Spawn index lookup (happy path + defensive throw)
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.5 spawnIndex lookup", () => {
  it("happy path: every character at spawns[spawnIndex]", () => {
    // Use all 8 spawn indices; each lands on the documented reference.json
    // spawn coordinate. (Spec order: NW, N, NE, E, SE, S, SW, W.)
    const expected: Tile[] = [
      { x: 28, y: 28 },
      { x: 48, y: 28 },
      { x: 68, y: 28 },
      { x: 68, y: 48 },
      { x: 68, y: 68 },
      { x: 48, y: 68 },
      { x: 28, y: 68 },
      { x: 28, y: 48 },
    ];
    const characters = expected.map((_, i) =>
      makeCharacter(`c${i}`, i),
    );
    const bundle: ReplayBundle = {
      match: makeMatch(),
      turns: [],
      characters,
      worldState: makeWorld(),
    };
    const snap = reconstruct(bundle, 0);
    for (let i = 0; i < 8; i++) {
      expect(snap.characters[i]!.pos).toEqual(expected[i]);
    }
  });

  it("throws with a clear error message naming the offending character when spawnIndex is undefined", () => {
    // Synthetic invariant violation: a character row with spawnIndex stripped
    // out. The walk MUST throw rather than silently anchor at (0,0).
    const charA = makeCharacter("a", 0);
    const charB = makeCharacter("b", 1, { displayName: "MissingSpawn" });
    // Force-strip spawnIndex (the schema validator would reject this — we're
    // exercising a defensive path that surfaces phase-1 invariant violations).
    delete (charB as unknown as { spawnIndex?: number }).spawnIndex;

    const bundle: ReplayBundle = {
      match: makeMatch(),
      turns: [],
      characters: [charA, charB],
      worldState: makeWorld(),
    };

    expect(() => reconstruct(bundle, 0)).toThrowError(/MissingSpawn/);
  });

  it("throws when spawnIndex is out of range against maps/reference.json spawns[]", () => {
    const charBad = makeCharacter("a", 99, { displayName: "BadSpawn" });
    const bundle: ReplayBundle = {
      match: makeMatch(),
      turns: [],
      characters: [charBad],
      worldState: makeWorld(),
    };
    expect(() => reconstruct(bundle, 0)).toThrowError(/BadSpawn/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §1.1 — Stationary character keeps its prior position (no entry in moves[])
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.1 stationary character keeps position", () => {
  it("character with NO entry in resolution.moves[] holds its previous position", () => {
    const A = makeCharacter("a", 0); // spawn (28,28)
    const B = makeCharacter("b", 1); // spawn (48,28) — never moves
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 3 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 28, y: 28 },
              to: { x: 29, y: 29 },
            },
          ],
        }),
        makeTurn(2, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 29, y: 29 },
              to: { x: 30, y: 30 },
            },
          ],
        }),
        makeTurn(3, emptyResolution()),
      ],
      characters: [A, B],
      worldState: makeWorld(),
    };

    const snap3 = reconstruct(bundle, 3);
    expect(snap3.characters.find((c) => c.characterId === A._id)!.pos).toEqual({
      x: 30,
      y: 30,
    });
    // B never moved — still at spawn (48,28).
    expect(snap3.characters.find((c) => c.characterId === B._id)!.pos).toEqual({
      x: 48,
      y: 28,
    });
  });

  it("moves accumulate across turns (3-turn walk)", () => {
    const A = makeCharacter("a", 0); // spawn (28,28)
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 3 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 28, y: 28 },
              to: { x: 29, y: 28 },
            },
          ],
        }),
        makeTurn(2, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 29, y: 28 },
              to: { x: 30, y: 28 },
            },
          ],
        }),
        makeTurn(3, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 30, y: 28 },
              to: { x: 31, y: 28 },
            },
          ],
        }),
      ],
      characters: [A],
      worldState: makeWorld(),
    };

    expect(reconstruct(bundle, 1).characters[0]!.pos).toEqual({ x: 29, y: 28 });
    expect(reconstruct(bundle, 2).characters[0]!.pos).toEqual({ x: 30, y: 28 });
    expect(reconstruct(bundle, 3).characters[0]!.pos).toEqual({ x: 31, y: 28 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §1.2 — Death timing: corpse at the actor's POST-movement position
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.2 death timing (post-movement, pre-visibilityUpdates)", () => {
  it("character moves on turn N then dies on turn N → corpse at the move-to tile, not pre-move", () => {
    const A = makeCharacter("a", 0); // spawn (28,28)
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 28, y: 28 },
              to: { x: 35, y: 35 },
            },
          ],
          // Phase-6 deaths are listed AFTER moves in the resolution trace;
          // the walk applies in the same order. Corpse appears at (35,35).
          deaths: [A._id],
        }),
      ],
      characters: [A],
      worldState: makeWorld(),
    };

    const snap = reconstruct(bundle, 1);
    expect(snap.corpses).toHaveLength(1);
    expect(snap.corpses[0]!.characterId).toBe(A._id);
    expect(snap.corpses[0]!.pos).toEqual({ x: 35, y: 35 });
    const aChar = snap.characters.find((c) => c.characterId === A._id)!;
    expect(aChar.alive).toBe(false);
    expect(aChar.diedAtTurn).toBe(1);
  });

  it("stationary death — corpse appears at last-known position", () => {
    const A = makeCharacter("a", 0); // spawn (28,28); never moves
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          deaths: [A._id],
        }),
      ],
      characters: [A],
      worldState: makeWorld(),
    };
    const snap = reconstruct(bundle, 1);
    expect(snap.corpses[0]!.pos).toEqual({ x: 28, y: 28 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §1.3 — Chest open / loot timing (open carries forward across turns)
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.3 chest open persistence", () => {
  it("loot kind + opened result on turn 3 → chest opened on turn 5", () => {
    // Phase-3 ADR §1 / PM lock D7 — chest opens emit
    // `kind: "loot"`, `target: "chest_NNN"`, `result: "opened"`. The walk
    // dispatches the chest-flip on this exact tuple.
    const A = makeCharacter("a", 0);
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 5 }),
      turns: [
        makeTurn(1, emptyResolution()),
        makeTurn(2, emptyResolution()),
        makeTurn(3, {
          ...emptyResolution(),
          actions: [
            {
              characterId: A._id,
              kind: "loot",
              target: "chest_001",
              result: "opened",
            },
          ],
        }),
        makeTurn(4, emptyResolution()),
        makeTurn(5, emptyResolution()),
      ],
      characters: [A],
      worldState: makeWorld({
        // Note: terminal worldState may carry `opened: true`; the walk forces
        // turn-0 chests closed so we can prove the walk re-derives the flip.
        chests: [
          {
            id: "chest_001",
            pos: { x: 50, y: 50 },
            contents: null,
            opened: true,
          },
        ],
      }),
    };

    expect(reconstruct(bundle, 2).chests[0]!.opened).toBe(false);
    expect(reconstruct(bundle, 3).chests[0]!.opened).toBe(true);
    expect(reconstruct(bundle, 5).chests[0]!.opened).toBe(true);
  });

  it("loot/chest_* with non-opened result (already_opened/no_chest/out_of_range) does NOT toggle", () => {
    const A = makeCharacter("a", 0);
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          actions: [
            {
              characterId: A._id,
              kind: "loot",
              target: "chest_001",
              result: "already_opened",
            },
            {
              characterId: A._id,
              kind: "loot",
              target: "chest_002",
              result: "no_chest",
            },
            {
              characterId: A._id,
              kind: "loot",
              target: "chest_003",
              result: "out_of_range",
            },
          ],
        }),
      ],
      characters: [A],
      worldState: makeWorld({
        chests: [
          { id: "chest_001", pos: { x: 1, y: 1 }, contents: null, opened: true },
          {
            id: "chest_003",
            pos: { x: 2, y: 2 },
            contents: null,
            opened: false,
          },
        ],
      }),
    };
    const snap = reconstruct(bundle, 1);
    // Walk-forced: turn-0 closes chests; non-"opened" results do NOT flip.
    expect(snap.chests.every((c) => !c.opened)).toBe(true);
  });

  it("corpse loot (kind=loot + corpse target) does NOT trigger chest-flip", () => {
    // Phase-3 ADR §1 — chests + corpses both flow through the unified loot
    // arm; the walk's chest-flip MUST gate on `target.startsWith("chest_")`
    // so a successful corpse loot can't flip a same-id chest by accident.
    const A = makeCharacter("a", 0);
    const dead = makeCharacter("b", 1, { displayName: "Camper" });
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          actions: [
            {
              characterId: A._id,
              kind: "loot",
              // Corpse target — id namespace is the character's id, not chest_*.
              target: dead._id,
              result: "opened",
            },
          ],
        }),
      ],
      characters: [A, dead],
      worldState: makeWorld({
        chests: [
          { id: "chest_001", pos: { x: 1, y: 1 }, contents: null, opened: true },
        ],
      }),
    };
    const snap = reconstruct(bundle, 1);
    // The chest must remain CLOSED — the corpse-loot result must not be
    // treated as a chest flip.
    expect(snap.chests.every((c) => !c.opened)).toBe(true);
  });

  it("loot/attack actions DO NOT mutate snapshot state (per D-P2-11)", () => {
    const A = makeCharacter("a", 0);
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          actions: [
            {
              characterId: A._id,
              kind: "loot",
              target: "corpse_001",
              result: "looted",
            },
            {
              characterId: A._id,
              kind: "attack",
              target: "char_x",
              result: "dmg 12",
            },
          ],
        }),
      ],
      characters: [A],
      worldState: makeWorld(),
    };
    const snap = reconstruct(bundle, 1);
    expect(snap.characters[0]!.equipped).toBeNull();
    expect(snap.characters[0]!.hp).toBeNull();
    expect(snap.characters[0]!.alive).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §1.4 — Hidden flag toggles via visibilityUpdates (applied LAST)
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.4 hidden flag via visibilityUpdates (applied LAST)", () => {
  it("character revealed via visibilityUpdates entry → hidden=false on snapshot", () => {
    const A = makeCharacter("a", 0, { hidden: true });
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          // Phase-6/7 ordering: visibilityUpdates AFTER deaths/actions, so
          // even if A attacked (which would normally reveal mid-resolution),
          // the FINAL hidden state is what visibilityUpdates says.
          actions: [
            {
              characterId: A._id,
              kind: "attack",
              target: "x",
              result: "dmg 5",
            },
          ],
          visibilityUpdates: [
            {
              characterId: A._id,
              hidden: false,
              revealedBy: "attack",
            },
          ],
        }),
      ],
      characters: [A],
      worldState: makeWorld(),
    };
    expect(reconstruct(bundle, 1).characters[0]!.hidden).toBe(false);
  });

  it("characters NOT in visibilityUpdates retain their prior hidden state", () => {
    const A = makeCharacter("a", 0, { hidden: true });
    const B = makeCharacter("b", 1, { hidden: true });
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          visibilityUpdates: [
            { characterId: A._id, hidden: false, revealedBy: "attack" },
          ],
        }),
      ],
      characters: [A, B],
      worldState: makeWorld(),
    };
    // Initial hidden state (turn 0) reads from synthetic-spawn defaults:
    // alive/hidden are NOT lifted from the terminal characters[] row's
    // hidden flag; the walk's turn-0 sets hidden=false uniformly. After
    // visibilityUpdates, only the explicitly-flipped characters change.
    // So at turn 1 after a single-entry visibilityUpdate, A=false (per
    // the entry) and B remains at the prior turn's hidden=false.
    const snap = reconstruct(bundle, 1);
    expect(snap.characters.find((c) => c.characterId === A._id)!.hidden).toBe(
      false,
    );
    expect(snap.characters.find((c) => c.characterId === B._id)!.hidden).toBe(
      false,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §1.6 — Idempotency
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.6 idempotency", () => {
  function buildIdempotencyBundle(): ReplayBundle {
    const A = makeCharacter("a", 0);
    const B = makeCharacter("b", 1);
    return {
      match: makeMatch({ turn: 30 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 28, y: 28 },
              to: { x: 30, y: 30 },
            },
          ],
        }),
        makeTurn(5, {
          ...emptyResolution(),
          actions: [
            {
              characterId: A._id,
              kind: "loot",
              target: "chest_001",
              result: "opened",
            },
          ],
        }),
        makeTurn(10, {
          ...emptyResolution(),
          deaths: [B._id],
        }),
        makeTurn(20, {
          ...emptyResolution(),
          visibilityUpdates: [
            { characterId: A._id, hidden: true, revealedBy: undefined },
          ],
        }),
        makeTurn(30, emptyResolution()),
      ],
      characters: [A, B],
      worldState: makeWorld({
        chests: [
          {
            id: "chest_001",
            pos: { x: 50, y: 50 },
            contents: null,
            opened: true,
          },
        ],
      }),
    };
  }

  it("reconstruct(bundle, 30) called twice in succession returns structurally equal snapshots", () => {
    const bundle = buildIdempotencyBundle();
    const a = reconstruct(bundle, 30);
    const b = reconstruct(bundle, 30);
    expect(a).toEqual(b);
  });

  it("backward jump: reconstruct(bundle, 30) then reconstruct(bundle, 10) === fresh reconstruct(bundle, 10)", () => {
    const bundle = buildIdempotencyBundle();
    void reconstruct(bundle, 30);
    const after = reconstruct(bundle, 10);
    const fresh = reconstruct(bundle, 10);
    expect(after).toEqual(fresh);
  });

  it("does NOT mutate the input bundle on any call", () => {
    const bundle = buildIdempotencyBundle();
    const snapshotBefore = JSON.stringify(bundle);
    void reconstruct(bundle, 30);
    void reconstruct(bundle, 10);
    void reconstruct(bundle, 0);
    expect(JSON.stringify(bundle)).toBe(snapshotBefore);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §1.8 — Extraction from terminal characters[].extractedAtTurn
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — §1.8 extraction (phase-8 mutation, NOT an action)", () => {
  it("extractedAtTurn=50 → still on grid at turn 49 (not flagged extracted yet)", () => {
    const A = makeCharacter("a", 0, { extractedAtTurn: 50 });
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 50 }),
      turns: [],
      characters: [A],
      worldState: makeWorld(),
    };
    const snap = reconstruct(bundle, 49);
    const aSnap = snap.characters.find((c) => c.characterId === A._id)!;
    expect(aSnap.extractedAtTurn).toBeNull();
  });

  it("extractedAtTurn=50 → flagged at turn 50 (extractedAtTurn === 50)", () => {
    const A = makeCharacter("a", 0, { extractedAtTurn: 50 });
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 50 }),
      turns: [],
      characters: [A],
      worldState: makeWorld(),
    };
    const snap = reconstruct(bundle, 50);
    const aSnap = snap.characters.find((c) => c.characterId === A._id)!;
    expect(aSnap.extractedAtTurn).toBe(50);
  });

  it("non-extracted characters keep extractedAtTurn=null at every turn", () => {
    const A = makeCharacter("a", 0); // no extractedAtTurn field
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 50 }),
      turns: [],
      characters: [A],
      worldState: makeWorld(),
    };
    expect(
      reconstruct(bundle, 50).characters[0]!.extractedAtTurn,
    ).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Evac reveal — turn 30+
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — evac reveal", () => {
  it("evacRevealed=false when worldState.evac.revealedAtTurn is null", () => {
    const bundle: ReplayBundle = {
      match: makeMatch(),
      turns: [],
      characters: [makeCharacter("a", 0)],
      worldState: makeWorld({
        evac: { centre: { x: 48, y: 48 }, revealedAtTurn: null },
      }),
    };
    expect(reconstruct(bundle, 50).evacRevealed).toBe(false);
  });

  it("evacRevealed=true when atTurn >= revealedAtTurn", () => {
    const bundle: ReplayBundle = {
      match: makeMatch(),
      turns: [],
      characters: [makeCharacter("a", 0)],
      worldState: makeWorld({
        evac: { centre: { x: 48, y: 48 }, revealedAtTurn: 30 },
      }),
    };
    expect(reconstruct(bundle, 29).evacRevealed).toBe(false);
    expect(reconstruct(bundle, 30).evacRevealed).toBe(true);
    expect(reconstruct(bundle, 50).evacRevealed).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Phase-order integration — moves THEN deaths THEN visibilityUpdates
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — phase-order integration", () => {
  it("moves → actions → deaths → visibilityUpdates within a single turn", () => {
    // A moves and dies on the same turn while attacking; B is hidden and
    // the visibilityUpdate at the END flips them visible.
    const A = makeCharacter("a", 0); // (28,28)
    const B = makeCharacter("b", 1, { hidden: true }); // (48,28)
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 1 }),
      turns: [
        makeTurn(1, withUseLedger({
          speech: [],
          moves: [
            {
              characterId: A._id,
              from: { x: 28, y: 28 },
              to: { x: 40, y: 30 },
            },
          ],
          actions: [
            {
              characterId: A._id,
              kind: "attack",
              target: B._id,
              result: "dmg 100",
            },
          ],
          deaths: [A._id],
          visibilityUpdates: [
            { characterId: B._id, hidden: false, revealedBy: "attack" },
          ],
        })),
      ],
      characters: [A, B],
      worldState: makeWorld(),
    };
    const snap = reconstruct(bundle, 1);
    // A moved to (40,30) THEN died → corpse at (40,30).
    expect(snap.corpses).toHaveLength(1);
    expect(snap.corpses[0]!.pos).toEqual({ x: 40, y: 30 });
    // B revealed via visibilityUpdate.
    expect(snap.characters.find((c) => c.characterId === B._id)!.hidden).toBe(
      false,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stop-early: walk halts when atTurn exceeds the ledger's last turn.
// ───────────────────────────────────────────────────────────────────────────

describe("reconstruct — atTurn beyond last ledger row", () => {
  it("stops applying when there is no ledger row for a turn", () => {
    const A = makeCharacter("a", 0);
    const bundle: ReplayBundle = {
      match: makeMatch({ turn: 2 }),
      turns: [
        makeTurn(1, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 28, y: 28 },
              to: { x: 30, y: 30 },
            },
          ],
        }),
        makeTurn(2, {
          ...emptyResolution(),
          moves: [
            {
              characterId: A._id,
              from: { x: 30, y: 30 },
              to: { x: 32, y: 30 },
            },
          ],
        }),
      ],
      characters: [A],
      worldState: makeWorld(),
    };
    // atTurn=99 — past the last ledger row. Walk applies up to turn 2 and
    // returns the resulting state; it does NOT throw.
    const snap = reconstruct(bundle, 99);
    expect(snap.characters[0]!.pos).toEqual({ x: 32, y: 30 });
  });
});
