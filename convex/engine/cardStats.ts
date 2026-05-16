// Phase 13 WP3 — pure per-Card stat aggregation.
//
// This module mirrors runStats' engine boundary: plain row-shaped inputs, no
// Convex imports, and no generated types. The writer layer is responsible for
// calling it only for completed Card matches and for applying the returned
// deltas idempotently.

import { attributeKillsByCharacter } from "./killAttribution.js";

type Tile = { x: number; y: number };

export type CardStatsAction = {
  characterId: string;
  kind: string;
  target: string;
  result: string;
};

export type CardStatsMove = {
  characterId: string;
  from: Tile;
  to: Tile;
  blockedBy?: "wall";
  bodyCollision?:
    | { kind: "character"; defenderId: string }
    | { kind: "wall"; wallRectId: string };
};

export type CardStatsTurnRow = {
  turn: number;
  agentRecords?: Array<{ characterId: string; personaId?: string; displayName?: string }>;
  resolution: {
    moves: CardStatsMove[];
    actions: CardStatsAction[];
    deaths: string[];
    environmentalDeaths?: string[];
  };
};

export type CardStatsCharacterRow = {
  _id: string;
  cardId?: string;
  personaId?: string;
  displayName?: string;
  diedAtTurn?: number;
  extractedAtTurn?: number;
};

export type CardStatsOutcome = {
  pointsByCharacter: Array<{ id: string; points: number }>;
};

export type CardStatsDelta = {
  cardId: string;
  characterId: string;
  prizeUnitsWon: number;
  matchesPlayed: number;
  kills: number;
  deaths: number;
  wallFaceSlams: number;
};

function pointsByCharacter(outcome: CardStatsOutcome): Map<string, number> {
  const points = new Map<string, number>();
  for (const row of outcome.pointsByCharacter) {
    points.set(row.id, (points.get(row.id) ?? 0) + row.points);
  }
  return points;
}

function wallFaceSlamsByCharacter(turns: readonly CardStatsTurnRow[]): Map<string, number> {
  const slams = new Map<string, number>();
  for (const turn of turns) {
    for (const move of turn.resolution.moves) {
      if (move.bodyCollision?.kind !== "wall") continue;
      slams.set(move.characterId, (slams.get(move.characterId) ?? 0) + 1);
    }
  }
  return slams;
}

export function aggregateCardStats(
  turns: CardStatsTurnRow[],
  characters: CardStatsCharacterRow[],
  outcome: CardStatsOutcome,
): CardStatsDelta[] {
  const points = pointsByCharacter(outcome);
  const kills = attributeKillsByCharacter(turns, characters);
  const wallFaceSlams = wallFaceSlamsByCharacter(turns);

  return characters.flatMap((character) => {
    if (character.cardId === undefined) return [];
    return [
      {
        cardId: character.cardId,
        characterId: character._id,
        prizeUnitsWon: points.get(character._id) ?? 0,
        matchesPlayed: 1,
        kills: kills.get(character._id) ?? 0,
        deaths: character.diedAtTurn !== undefined ? 1 : 0,
        wallFaceSlams: wallFaceSlams.get(character._id) ?? 0,
      },
    ];
  });
}
