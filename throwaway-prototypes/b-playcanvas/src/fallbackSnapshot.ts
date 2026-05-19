import type {
  EntitySnapshot,
  MapDescriptor,
  ReplaySnapshot,
  SnapshotAirdrop,
  SnapshotCharacter,
  SnapshotCrate,
} from "./types";

const referenceMap: MapDescriptor = {
  size: { w: 100, h: 100 },
  walls: [
    { x: 0, y: 0, w: 100, h: 1 },
    { x: 0, y: 99, w: 100, h: 1 },
    { x: 0, y: 1, w: 1, h: 98 },
    { x: 99, y: 1, w: 1, h: 98 },
    { x: 18, y: 18, w: 6, h: 1 },
    { x: 24, y: 18, w: 1, h: 6 },
    { x: 76, y: 18, w: 6, h: 1 },
    { x: 75, y: 18, w: 1, h: 6 },
    { x: 18, y: 76, w: 6, h: 1 },
    { x: 24, y: 76, w: 1, h: 5 },
    { x: 76, y: 76, w: 6, h: 1 },
    { x: 75, y: 76, w: 1, h: 5 },
    { x: 35, y: 30, w: 5, h: 1 },
    { x: 60, y: 30, w: 5, h: 1 },
    { x: 35, y: 70, w: 5, h: 1 },
    { x: 60, y: 70, w: 5, h: 1 },
    { x: 30, y: 35, w: 1, h: 5 },
    { x: 30, y: 60, w: 1, h: 5 },
    { x: 69, y: 35, w: 1, h: 5 },
    { x: 69, y: 60, w: 1, h: 5 },
    { x: 44, y: 40, w: 4, h: 1 },
    { x: 52, y: 40, w: 4, h: 1 },
    { x: 44, y: 56, w: 4, h: 1 },
    { x: 52, y: 56, w: 4, h: 1 },
    { x: 40, y: 44, w: 1, h: 4 },
    { x: 56, y: 44, w: 1, h: 4 },
    { x: 40, y: 52, w: 1, h: 4 },
    { x: 56, y: 52, w: 1, h: 4 },
    { x: 12, y: 48, w: 4, h: 1 },
    { x: 84, y: 48, w: 4, h: 1 },
    { x: 48, y: 12, w: 1, h: 4 },
    { x: 48, y: 84, w: 1, h: 4 },
  ],
  coverClusters: [
    { x: 42, y: 42, w: 2, h: 2 },
    { x: 53, y: 42, w: 2, h: 2 },
    { x: 42, y: 53, w: 2, h: 2 },
    { x: 53, y: 53, w: 2, h: 2 },
    { x: 22, y: 46, w: 3, h: 3 },
    { x: 73, y: 46, w: 3, h: 3 },
    { x: 46, y: 22, w: 3, h: 3 },
    { x: 46, y: 73, w: 3, h: 3 },
    { x: 32, y: 32, w: 2, h: 2 },
    { x: 65, y: 65, w: 2, h: 2 },
  ],
  crates: [
    { x: 14, y: 14 },
    { x: 85, y: 14 },
    { x: 14, y: 85 },
    { x: 85, y: 85 },
    { x: 33, y: 33 },
    { x: 66, y: 33 },
    { x: 47, y: 46 },
    { x: 49, y: 52 },
    { x: 33, y: 66 },
    { x: 66, y: 66 },
    { x: 53, y: 54 },
    { x: 50, y: 25 },
  ],
  airdrops: [
    { x: 50, y: 50, landsAtTurn: 10 },
    { x: 25, y: 75, landsAtTurn: 20 },
    { x: 75, y: 25, landsAtTurn: 30 },
    { x: 48, y: 48, landsAtTurn: 40 },
  ],
  spawns: [
    { x: 28, y: 28 },
    { x: 48, y: 28 },
    { x: 68, y: 28 },
    { x: 68, y: 48 },
    { x: 68, y: 68 },
    { x: 48, y: 68 },
    { x: 28, y: 68 },
    { x: 28, y: 48 },
  ],
  evac: { x: 48, y: 48 },
};

const crates: SnapshotCrate[] = (referenceMap.crates ?? []).map((crate) => ({
  id: `Crate_${crate.x}_${crate.y}`,
  pos: { x: crate.x, y: crate.y },
  opened: false,
}));

function airdropForTurn(turn: number): SnapshotAirdrop {
  const landsAtTurn = 10;
  if (turn < landsAtTurn - 3) {
    return {
      id: "Crate_50_50",
      pos: { x: 50, y: 50 },
      landsAtTurn,
      state: "pre",
      looted: false,
    };
  }
  if (turn <= landsAtTurn) {
    return {
      id: "Crate_50_50",
      pos: { x: 50, y: 50 },
      landsAtTurn,
      state: "telegraphed",
      looted: false,
      countdown: landsAtTurn - turn,
    };
  }
  return {
    id: "Crate_50_50",
    pos: { x: 50, y: 50 },
    landsAtTurn,
    state: "landed",
    looted: false,
  };
}

function victimPos(turn: number): { x: number; y: number } {
  if (turn <= 4) return { x: 43 + turn, y: 54 - turn * 0.4 };
  if (turn <= 7) return { x: 47 + (turn - 4), y: 52 - (turn - 4) * 0.66 };
  return { x: 50, y: 50 };
}

function spectatorPos(turn: number): { x: number; y: number } {
  return {
    x: 45 + Math.min(turn, 10) * 0.16,
    y: 45 - Math.sin(turn * 0.6) * 0.8,
  };
}

function character(
  characterId: string,
  displayName: string,
  pos: { x: number; y: number },
  alive = true,
  diedAtTurn: number | null = null,
): SnapshotCharacter {
  return {
    characterId,
    personaId: displayName.toLowerCase(),
    displayName,
    pos,
    alive,
    hidden: false,
    diedAtTurn,
    extractedAtTurn: null,
    equipped: null,
    hp: null,
  };
}

function frame(turn: number): EntitySnapshot {
  const victimAlive = turn < 10;
  return {
    turn,
    characters: [
      character("victim_vulture", "Vulture", victimPos(turn), victimAlive, victimAlive ? null : 10),
      character("observer_duelist", "Duelist", spectatorPos(turn)),
      character("rat_witness", "Rat", { x: 55 - Math.cos(turn * 0.35) * 1.2, y: 58 }),
      character("sprinter_witness", "Sprinter", { x: 58, y: 46 + Math.sin(turn * 0.4) * 1.4 }),
    ],
    corpses: [],
    crates,
    airdrops: [airdropForTurn(turn)],
    evacRevealed: turn >= 9,
  };
}

export const fallbackSnapshot: ReplaySnapshot = {
  metadata: {
    source: "built-in fallback",
    note: "Used only when public/shared-harness/replay-snapshot.json is absent.",
  },
  map: referenceMap,
  frames: Array.from({ length: 15 }, (_, turn) => frame(turn)),
  moneyShot: {
    victimId: "victim_vulture",
    dropId: "Crate_50_50",
    landsAtTurn: 10,
    loopStartTurn: 0,
    loopEndTurn: 14,
    loopSeconds: 14,
  },
};
