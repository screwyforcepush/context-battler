export type Tile = {
  x: number;
  y: number;
};

export type Rect = Tile & {
  w: number;
  h: number;
};

export type MapCrate = Tile & {
  contents?: unknown;
};

export type MapAirdrop = Tile & {
  landsAtTurn: number;
  contents?: unknown;
};

export type MapDescriptor = {
  size: {
    w: number;
    h: number;
  };
  walls: Rect[];
  coverClusters?: Rect[];
  coverTiles?: Tile[];
  crates?: MapCrate[];
  airdrops?: MapAirdrop[];
  spawns?: Tile[];
  evac?: Tile;
};

export type SnapshotCharacter = {
  characterId: string;
  personaId?: string;
  displayName: string;
  pos: Tile;
  alive: boolean;
  hidden?: boolean;
  diedAtTurn?: number | null;
  extractedAtTurn?: number | null;
  equipped?: null | unknown;
  hp?: null | number;
};

export type SnapshotCorpse = {
  characterId: string;
  pos: Tile;
};

export type SnapshotCrate = {
  id: string;
  pos: Tile;
  opened: boolean;
};

export type SnapshotAirdrop = {
  id: string;
  pos: Tile;
  landsAtTurn: number;
  state: "pre" | "telegraphed" | "landed" | "spent";
  looted: boolean;
  countdown?: number;
};

export type EntitySnapshot = {
  turn: number;
  characters: SnapshotCharacter[];
  corpses: SnapshotCorpse[];
  crates: SnapshotCrate[];
  airdrops: SnapshotAirdrop[];
  evacRevealed: boolean;
};

export type MoneyShot = {
  victimId: string;
  dropId: string;
  landsAtTurn: number;
  loopStartTurn?: number;
  loopEndTurn?: number;
  loopSeconds?: number;
};

export type ReplaySnapshot = {
  metadata?: Record<string, unknown>;
  map: MapDescriptor;
  frames: EntitySnapshot[];
  moneyShot: MoneyShot;
};
