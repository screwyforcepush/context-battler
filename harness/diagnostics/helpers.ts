import type { ParsedDecision, PersonaId } from "../../convex/engine/types.js";
import type {
  CountMap,
  DrilldownExample,
  ResolutionMove,
  SlimAgentRecord,
  SlimTurnRow,
} from "./types.js";

export type TurnPhase = "pre_evac" | "evac_revealed" | "final";

export function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function increment(map: CountMap, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export function sortedCountMap(map: CountMap): CountMap {
  return Object.fromEntries(
    Object.entries(map).sort((a, b) =>
      b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
    ),
  );
}

export function pushExample(
  examples: DrilldownExample[],
  turn: SlimTurnRow,
  record: SlimAgentRecord,
  limit = 5,
): void {
  if (examples.length >= limit) return;
  examples.push(drilldown(turn, record));
}

export function drilldown(
  turn: SlimTurnRow,
  record: SlimAgentRecord,
): DrilldownExample {
  const character = titleCasePersona(record.personaId);
  return {
    matchId: turn.matchId,
    turn: turn.turn,
    characterId: record.characterId,
    personaId: record.personaId,
    url: `#/match/${encodeURIComponent(turn.matchId)}?turn=${turn.turn}&character=${encodeURIComponent(character)}`,
    label: `${character} turn ${turn.turn}`,
  };
}

export function titleCasePersona(personaId: PersonaId | string): string {
  return personaId.length === 0
    ? personaId
    : `${personaId.slice(0, 1).toUpperCase()}${personaId.slice(1)}`;
}

export function turnPhase(turn: number): TurnPhase {
  if (turn === 50) return "final";
  return turn < 30 ? "pre_evac" : "evac_revealed";
}

export function isDamageResult(result: string): boolean {
  return /^dmg \d+$/.test(result);
}

export function isChestTarget(target: string): boolean {
  return /^Chest_-?\d+_-?\d+$/.test(target) || /^chest_\d+$/.test(target);
}

export function isCorpseTarget(target: string): boolean {
  return target.startsWith("Corpse_");
}

export function actualMoveDistance(move: ResolutionMove): number {
  return Math.max(
    Math.abs(move.to.x - move.from.x),
    Math.abs(move.to.y - move.from.y),
  );
}

export function isArmedStancePause(decision: ParsedDecision): boolean {
  return (
    decision.action.kind === "none" &&
    (decision.position.kind === "overwatch" ||
      decision.position.kind === "counter")
  );
}

export function isTrueStationary(decision: ParsedDecision): boolean {
  return (
    decision.action.kind === "none" &&
    decision.position.kind === "move" &&
    decision.position.dist === 0
  );
}

export function decisionConsumedItem(
  turn: SlimTurnRow,
  record: SlimAgentRecord,
): string | null {
  const consumed = turn.resolution.consumed.find(
    (c) => c.characterId === record.characterId,
  );
  if (consumed) return consumed.item.name;
  return record.selfEquipment.consumable ?? null;
}

export function isMoveDecision(
  decision: ParsedDecision,
): decision is ParsedDecision & {
  position: Extract<ParsedDecision["position"], { kind: "move" }>;
} {
  return decision.position.kind === "move";
}
