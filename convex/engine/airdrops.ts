import type { AirdropState, CrateState, ItemRef, Tile, WorldState } from "./types.js";

export type AirdropProjectionState =
  | "pre"
  | "telegraphed"
  | "landed"
  | "spent";

export type CrateLookup =
  | {
      source: "static";
      id: string;
      pos: Tile;
      opened: boolean;
      contents: ItemRef | null;
      crate: CrateState;
    }
  | {
      source: "airdrop";
      id: string;
      pos: Tile;
      opened: boolean;
      contents: ItemRef | null;
      airdrop: AirdropState;
    };

export type NavigableCrateTarget = {
  id: string;
  pos: Tile;
  source: "static" | "airdrop";
};

export function airdropProjectionState(
  airdrop: AirdropState,
  turn: number,
): AirdropProjectionState {
  if (airdrop.looted) return "spent";
  if (turn < airdrop.landsAtTurn - 3) return "pre";
  if (turn <= airdrop.landsAtTurn) return "telegraphed";
  return "landed";
}

export function airdropCountdown(
  airdrop: AirdropState,
  turn: number,
): number | null {
  return airdropProjectionState(airdrop, turn) === "telegraphed"
    ? airdrop.landsAtTurn - turn
    : null;
}

export function worldAirdrops(world: WorldState): AirdropState[] {
  return world.airdrops ?? [];
}

export function findCrateById(
  world: WorldState,
  id: string,
  turn: number,
): CrateLookup | null {
  const crate = world.crates.find((candidate) => candidate.id === id);
  if (crate) {
    return {
      source: "static",
      id: crate.id,
      pos: crate.pos,
      opened: crate.opened,
      contents: crate.contents,
      crate,
    };
  }

  const airdrop = worldAirdrops(world).find((candidate) => candidate.id === id);
  if (!airdrop) return null;
  if (airdrop.looted) {
    return {
      source: "airdrop",
      id: airdrop.id,
      pos: airdrop.pos,
      opened: true,
      contents: null,
      airdrop,
    };
  }
  if (turn <= airdrop.landsAtTurn) return null;
  return {
    source: "airdrop",
    id: airdrop.id,
    pos: airdrop.pos,
    opened: false,
    contents: airdrop.contents,
    airdrop,
  };
}

export function findNavigableCrateById(
  world: WorldState,
  id: string,
  turn: number,
): NavigableCrateTarget | null {
  const crate = world.crates.find((candidate) => candidate.id === id);
  if (crate) {
    return {
      source: "static",
      id: crate.id,
      pos: crate.pos,
    };
  }

  const airdrop = worldAirdrops(world).find((candidate) => candidate.id === id);
  if (!airdrop) return null;
  const state = airdropProjectionState(airdrop, turn);
  if (state === "telegraphed") {
    return {
      source: "airdrop",
      id: airdrop.id,
      pos: airdrop.pos,
    };
  }
  if (state === "landed") {
    return {
      source: "airdrop",
      id: airdrop.id,
      pos: airdrop.pos,
    };
  }
  return null;
}
