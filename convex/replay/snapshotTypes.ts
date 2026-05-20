import type { Doc, Id } from "../_generated/dataModel.js";
import type { EquippedSlots, ItemRef, PersonaId, Wall } from "../engine/types.js";
import type { EntitySnapshot, Tile } from "./reconstruct.js";

export type Rect = { x: number; y: number; w: number; h: number };

export type MatchSnapshotJson = {
  schemaVersion: 2;
  source: {
    matchId: string;
    mapId: string;
    completedAt: number;
    rngSeed: string;
  };
  playback: {
    turnCount: number;
    secondsPerTurn: number;
    sliceDurationSeconds: number;
    fpsHint: number;
    startTurn: 1;
    endTurn: number;
  };
  map: {
    size: { w: number; h: number };
    walls: Wall[];
    coverClusters: Wall[];
    evac: { centre: Tile; zone: Rect; revealedAtTurn: number | null };
    staticCrates: Array<{ id: string; pos: Tile; contents: ItemRef | null }>;
    airdrops: Array<{
      id: string;
      pos: Tile;
      landsAtTurn: number;
      contents: ItemRef;
    }>;
  };
  characters: Array<{
    characterId: string;
    personaId: PersonaId;
    displayName: string;
    spawnIndex: number;
    spawn: Tile;
    cardId: string | null;
    prompts: { system: string | null; persona: string | null };
  }>;
  timeline: {
    frames: Array<{
      turn: number;
      timeSeconds: number;
      snapshot: EntitySnapshot;
      equippedByCharacter: Record<string, EquippedSlots | null>;
      hpByCharacter: Record<string, number>;
    }>;
  };
  killFeed: Array<{
    turn: number;
    victimId: string;
    killerId: string | null;
    weapon: string | null;
    kind: "duel" | "environmental";
    text: string;
  }>;
  speechLog: Array<{
    turn: number;
    characterId: string;
    text: string;
    heardBy: string[];
  }>;
  agentTraces: Array<{
    turn: number;
    characterId: string;
    scratchpadBefore: string;
    scratchpadAfter: string;
    decisionSay: string | null;
    reasoning: string | null;
  }>;
  outcome: {
    extracted: Array<Id<"characters">>;
    lastSurvivor: Id<"characters"> | null;
    pointsByCharacter: Array<{ id: Id<"characters">; points: number }>;
  };
};

export type MatchSummary = {
  matchId: string;
  completedAt: number;
  mapId: string;
  characterIds: string[];
  characterCount: number;
  turnCount: number;
  outcome: {
    extractedCount: number;
    lastSurvivor: string | null;
  };
};

export type MatchWithCharacters = {
  match: Doc<"matches">;
  characters: Array<Doc<"characters">>;
};

