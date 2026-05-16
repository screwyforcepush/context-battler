import { describe, expect, it } from "vitest";
import {
  aggregateCardStats,
  type CardStatsCharacterRow,
  type CardStatsDelta,
  type CardStatsOutcome,
  type CardStatsTurnRow,
} from "../../convex/engine/cardStats.js";
import {
  aggregateRunStats,
  type AggregatorCharacterRow,
  type AggregatorTurnRow,
} from "../../convex/engine/runStats.js";
import type { PersonaId } from "../../convex/engine/types.js";

function cardCharacter(
  opts: Partial<CardStatsCharacterRow> & {
    _id: string;
    cardId: string;
    personaId?: PersonaId;
  },
): CardStatsCharacterRow {
  return {
    _id: opts._id,
    cardId: opts.cardId,
    personaId: opts.personaId ?? "rat",
    displayName: opts.displayName ?? opts._id,
    diedAtTurn: opts.diedAtTurn,
    extractedAtTurn: opts.extractedAtTurn,
  };
}

function roster(): CardStatsCharacterRow[] {
  const personas: PersonaId[] = [
    "rat",
    "duelist",
    "trader",
    "opportunist",
    "paranoid",
    "camper",
    "sprinter",
    "vulture",
  ];
  return personas.map((personaId, i) =>
    cardCharacter({
      _id: `c${i}`,
      cardId: `card-${i}`,
      personaId,
      displayName: `${personaId}-agent`,
    }),
  );
}

function turn(opts: Partial<CardStatsTurnRow> & { turn: number }): CardStatsTurnRow {
  return {
    turn: opts.turn,
    agentRecords: opts.agentRecords ?? [],
    resolution: {
      moves: opts.resolution?.moves ?? [],
      actions: opts.resolution?.actions ?? [],
      deaths: opts.resolution?.deaths ?? [],
      environmentalDeaths: opts.resolution?.environmentalDeaths ?? [],
    },
  };
}

function outcome(pointsByCharacter: Array<{ id: string; points: number }>): CardStatsOutcome {
  return { pointsByCharacter };
}

function byCard(deltas: CardStatsDelta[]): Record<string, CardStatsDelta> {
  return Object.fromEntries(deltas.map((d) => [d.cardId, d]));
}

function requiredCardId(character: CardStatsCharacterRow): string {
  if (character.cardId === undefined) throw new Error("expected Card-backed character");
  return character.cardId;
}

describe("aggregateCardStats", () => {
  it("accrues prizeUnitsWon directly from outcome.pointsByCharacter for sole-survivor and split outcomes", () => {
    const [winner, splitA, splitB] = roster();
    const winnerCardId = requiredCardId(winner!);
    const splitACardId = requiredCardId(splitA!);
    const splitBCardId = requiredCardId(splitB!);

    const soleWinner = byCard(
      aggregateCardStats(
        [],
        [winner!],
        outcome([{ id: winner!._id, points: 100 }]),
      ),
    );
    expect(soleWinner[winnerCardId]!.prizeUnitsWon).toBe(100);

    const split = byCard(
      aggregateCardStats(
        [],
        [splitA!, splitB!],
        outcome([
          { id: splitA!._id, points: 50 },
          { id: splitB!._id, points: 50 },
        ]),
      ),
    );
    expect(split[splitACardId]!.prizeUnitsWon).toBe(50);
    expect(split[splitBCardId]!.prizeUnitsWon).toBe(50);
  });

  it("increments matchesPlayed for every Card-backed character in a completed-match input, including turn-2 death", () => {
    const characters = roster();
    characters[3] = { ...characters[3]!, diedAtTurn: 2 };

    const deltas = aggregateCardStats([], characters, outcome([]));

    expect(deltas).toHaveLength(8);
    for (const delta of deltas) {
      expect(delta.matchesPlayed).toBe(1);
    }
    expect(byCard(deltas)[requiredCardId(characters[3]!)]!.deaths).toBe(1);
  });

  it("credits Card kills through the shared per-character kill attribution rule", () => {
    const characters = roster();
    const turns = [
      turn({
        turn: 6,
        resolution: {
          moves: [],
          deaths: ["c1"],
          actions: [
            { characterId: "c0", kind: "attack", target: "duelist-agent", result: "dmg 60" },
            { characterId: "c2", kind: "overwatch", target: "c1", result: "dmg 50" },
          ],
        },
      }),
    ];

    const deltas = byCard(aggregateCardStats(turns, characters, outcome([])));

    expect(deltas["card-0"]!.kills).toBe(1);
    expect(deltas["card-2"]!.kills).toBe(1);
    expect(deltas["card-1"]!.kills).toBe(0);
  });

  it("credits a Card kill when the victim displayName collides with a different Card lineage alias", () => {
    const characters: CardStatsCharacterRow[] = [
      cardCharacter({
        _id: "killer",
        cardId: "killer-card",
        personaId: "vulture",
        displayName: "Killer",
      }),
      cardCharacter({
        _id: "victim",
        cardId: "victim-card",
        personaId: "duelist",
        displayName: "rat",
        diedAtTurn: 7,
      }),
      cardCharacter({
        _id: "foreign-rat-lineage",
        cardId: "foreign-rat-card",
        personaId: "rat",
        displayName: "Burrower",
      }),
    ];
    const turns = [
      turn({
        turn: 7,
        resolution: {
          moves: [],
          deaths: ["victim"],
          actions: [
            {
              characterId: "killer",
              kind: "attack",
              target: "rat",
              result: "dmg 100",
            },
          ],
        },
      }),
    ];

    const deltas = byCard(aggregateCardStats(turns, characters, outcome([])));

    expect(deltas["killer-card"]!.kills).toBe(1);
    expect(deltas["victim-card"]!.deaths).toBe(1);
    expect(deltas["foreign-rat-card"]!.kills).toBe(0);
    expect(deltas["foreign-rat-card"]!.deaths).toBe(0);
  });

  it("A5 is intentional: environmental deaths increment victim deaths but produce no killer kills", () => {
    const characters = roster();
    characters[4] = { ...characters[4]!, diedAtTurn: 10 };
    const turns = [
      turn({
        turn: 10,
        resolution: {
          moves: [],
          deaths: [],
          environmentalDeaths: ["c4"],
          actions: [
            { characterId: "c0", kind: "attack", target: "c4", result: "dmg 20" },
          ],
        },
      }),
    ];

    const deltas = aggregateCardStats(turns, characters, outcome([]));
    const cards = byCard(deltas);

    expect(cards["card-4"]!.deaths).toBe(1);
    expect(deltas.reduce((sum, d) => sum + d.kills, 0)).toBe(0);
  });

  it("counts wallFaceSlams only from bodyCollision.kind='wall', including blockedBy+bodyCollision and excluding blockedBy-only", () => {
    const characters = roster();
    const turns = [
      turn({
        turn: 8,
        resolution: {
          deaths: [],
          actions: [],
          moves: [
            {
              characterId: "c0",
              from: { x: 1, y: 1 },
              to: { x: 1, y: 1 },
              blockedBy: "wall",
              bodyCollision: { kind: "wall", wallRectId: "Wall_1_2" },
            },
            {
              characterId: "c0",
              from: { x: 2, y: 2 },
              to: { x: 2, y: 2 },
              blockedBy: "wall",
            },
            {
              characterId: "c1",
              from: { x: 3, y: 3 },
              to: { x: 4, y: 3 },
              bodyCollision: { kind: "wall", wallRectId: "Wall_4_3" },
            },
          ],
        },
      }),
    ];

    const deltas = byCard(aggregateCardStats(turns, characters, outcome([])));

    expect(deltas["card-0"]!.wallFaceSlams).toBe(1);
    expect(deltas["card-1"]!.wallFaceSlams).toBe(1);
  });

  it("uses zero deltas for non-Card characters and missing outcome point rows", () => {
    const characters: CardStatsCharacterRow[] = [
      cardCharacter({ _id: "carded", cardId: "carded-card" }),
      { _id: "harness", personaId: "duelist", displayName: "Duelist" },
    ];

    const deltas = aggregateCardStats(
      [],
      characters,
      outcome([{ id: "harness", points: 100 }]),
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      cardId: "carded-card",
      characterId: "carded",
      prizeUnitsWon: 0,
      matchesPlayed: 1,
      kills: 0,
      deaths: 0,
      wallFaceSlams: 0,
    });
  });
});

describe("cardStats/runStats kill-credit agreement", () => {
  it("agrees with runStats per-persona kill credit for the same kill ledger", () => {
    const cardCharacters = roster();
    const cardTurns = [
      turn({
        turn: 12,
        resolution: {
          moves: [],
          deaths: ["c1"],
          actions: [
            { characterId: "c0", kind: "attack", target: "duelist-agent", result: "dmg 30" },
            { characterId: "c2", kind: "counter", target: "c1", result: "dmg 40" },
          ],
        },
      }),
    ];

    const runCharacters: AggregatorCharacterRow[] = cardCharacters.map((c) => ({
      _id: c._id,
      personaId: c.personaId as PersonaId,
      displayName: c.displayName,
      alive: c._id !== "c1",
      diedAtTurn: c._id === "c1" ? 12 : undefined,
    }));
    const runTurns: AggregatorTurnRow[] = [
      {
        turn: 12,
        agentRecords: [],
        resolution: {
          consumed: [],
          speech: [],
          moves: [],
          actions: cardTurns[0]!.resolution.actions,
          deaths: ["c1"],
          environmentalDeaths: [],
          visibilityUpdates: [],
        },
      },
    ];

    const cardDeltas = byCard(aggregateCardStats(cardTurns, cardCharacters, outcome([])));
    const runSummary = aggregateRunStats(runTurns, runCharacters);
    const runKillsByPersona = Object.fromEntries(
      runSummary.perPersona.map((p) => [p.personaId, p.kills]),
    );

    expect(cardDeltas["card-0"]!.kills).toBe(runKillsByPersona.rat);
    expect(cardDeltas["card-2"]!.kills).toBe(runKillsByPersona.trader);
    expect(cardDeltas["card-1"]!.kills).toBe(runKillsByPersona.duelist);
  });
});
