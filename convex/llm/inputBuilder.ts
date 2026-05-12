import { chebyshev } from "../engine/distance.js";
import { computeVisibleEntities } from "../engine/vision.js";
import {
  ARMOUR,
  CONSUMABLES,
  WEAPONS,
  type CharacterState,
  type CorpseState,
  type EquippedSlots,
  type ItemRef,
  type MatchState,
  type Position,
  type Tile,
  type VisibleEntity,
} from "../engine/types.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

const VISIBLE_ENTITY_CAP = 8;
const WALL_CAP = 12;
const EVAC_HALF_SIZE = 1;

export type PrevTurnRow = {
  resolution: {
    consumed: ReadonlyArray<{ characterId: string; item: string }>;
    speech: ReadonlyArray<{
      characterId: string;
      text: string;
      heardBy: ReadonlyArray<string>;
    }>;
    moves: ReadonlyArray<{
      characterId: string;
      from: Tile;
      to: Tile;
      blockedBy?: "wall";
    }>;
    actions: ReadonlyArray<{
      characterId: string;
      kind: string;
      target: string;
      result: string;
      triggeredByMovement?: boolean;
      weapon?: string;
    }>;
    deaths: ReadonlyArray<string>;
    visibilityUpdates: ReadonlyArray<{
      characterId: string;
      hidden: boolean;
      revealedBy?: string;
    }>;
  };
  priorPositionByActor?: Readonly<Record<string, Position>>;
};

type VisibleJsonValue =
  | string
  | number
  | boolean
  | null
  | VisibleJsonValue[]
  | { [key: string]: VisibleJsonValue };

function compassDirection(from: Tile, to: Tile): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return "";
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const normalised = (angleDeg + 360) % 360;
  const compass = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const;
  const sector = Math.floor((normalised + 22.5) / 45) % 8;
  return compass[sector] ?? "";
}

function resolveDisplayName(state: MatchState, characterId: string): string {
  const c = state.characters.find(
    (candidate) => candidate.characterId === characterId,
  );
  return c?.displayName ?? characterId;
}

function renderCharacterTypedId(state: MatchState, characterId: string): string {
  return resolveDisplayName(state, characterId);
}

function renderChestId(objectId: string): string {
  const m = /^chest_(\d+)$/.exec(objectId);
  if (!m) return objectId;
  return `Chest_${m[1]}`;
}

function corpseDrained(contents: CorpseState["contents"]): boolean {
  return !contents.weapon && !contents.armour && !contents.consumable;
}

function parseDamageResult(result: string): number | null {
  const match = /^dmg (\d+)$/.exec(result);
  if (!match) return null;
  return Number(match[1]);
}

function itemName(item: ItemRef | undefined): string | null {
  return item?.name ?? null;
}

function renderWeaponSlot(actor: CharacterState): string {
  const weapon = actor.equipped.weapon;
  if (!weapon || weapon.category !== "weapon") return "none";
  const stats = WEAPONS[weapon.name];
  return `${weapon.name} [dmg ${stats.damage}]`;
}

function renderArmourSlot(actor: CharacterState): string {
  const armour = actor.equipped.armour;
  if (!armour || armour.category !== "armour") return "none";
  const stats = ARMOUR[armour.name];
  return `${armour.name} [-${stats.reduction} dmg]`;
}

function renderConsumableSlot(actor: CharacterState): string {
  const consumable = actor.equipped.consumable;
  if (!consumable || consumable.category !== "consumable") return "none";
  const effect = CONSUMABLES[consumable.name];
  const label =
    effect.effect === "speed_override"
      ? `+${effect.value - 8} move range max dist`
      : `heal ${effect.value}% max HP`;
  return `${consumable.name} [${label}]`;
}

function renderMoveFragment(prev: PrevTurnRow, characterId: string): string | null {
  const entry = prev.resolution.moves.find((m) => m.characterId === characterId);
  if (!entry) return null;
  if (entry.blockedBy === "wall") return "tried to move and hit wall";
  const dist = chebyshev(entry.from, entry.to);
  if (dist === 0) return null;
  const dir = compassDirection(entry.from, entry.to);
  return dir ? `moved ${dist} ${dir}` : `moved ${dist}`;
}

function renderActionFragment(prev: PrevTurnRow, characterId: string): string | null {
  const entry = prev.resolution.actions.find(
    (a) => a.characterId === characterId && (a.kind === "attack" || a.kind === "loot"),
  );
  if (!entry) return null;
  const target = entry.target || "";
  const result = entry.result || "";
  if (entry.kind === "attack") {
    return result ? `attacked ${target} (${result})` : `attacked ${target}`;
  }
  return result ? `looted ${target} (${result})` : `looted ${target}`;
}

function renderSaidFragment(prev: PrevTurnRow, characterId: string): string | null {
  const entry = prev.resolution.speech.find((s) => s.characterId === characterId);
  if (!entry) return null;
  return `said "${entry.text}"`;
}

export function buildOwnOutcomeLine(
  _state: MatchState,
  characterId: string,
  prev: PrevTurnRow | null,
): string | null {
  if (!prev) return null;
  const fragments: string[] = [];
  const move = renderMoveFragment(prev, characterId);
  if (move) fragments.push(move);
  const action = renderActionFragment(prev, characterId);
  if (action) fragments.push(action);
  const said = renderSaidFragment(prev, characterId);
  if (said) fragments.push(said);
  if (fragments.length === 0) return null;
  return `You ${fragments.join(", ")}`;
}

export function buildLastTurnLine(
  state: MatchState,
  characterId: string,
  prev: PrevTurnRow | null,
): string | null {
  return buildOwnOutcomeLine(state, characterId, prev);
}

export function renderDamageEventLines(
  prev: PrevTurnRow | null,
  state: MatchState,
  observer: CharacterState,
): string[] {
  if (!prev) return [];
  const lines: string[] = [];
  for (const action of prev.resolution.actions) {
    if (
      action.kind !== "attack" &&
      action.kind !== "overwatch" &&
      action.kind !== "counter"
    ) {
      continue;
    }
    if (action.target !== observer.displayName) continue;
    const damage = parseDamageResult(action.result);
    if (damage === null) continue;
    const attacker = renderCharacterTypedId(state, action.characterId);
    const weapon =
      action.weapon && action.weapon.trim() !== "" ? action.weapon : "bare hands";
    lines.push(`${attacker} attacked you with ${weapon} (dmg ${damage})`);
  }
  return lines;
}

function resolveVictimFromTraceTarget(
  state: MatchState,
  target: string,
): CharacterState | null {
  return (
    state.characters.find((c) => c.displayName === target) ??
    state.characters.find((c) => c.characterId === target) ??
    null
  );
}

export function buildKillFeedLines(
  prev: PrevTurnRow | null,
  state: MatchState,
): string[] {
  if (!prev || prev.resolution.deaths.length === 0) return [];
  const deathIds = new Set(prev.resolution.deaths);
  const lines: string[] = [];
  const emittedVictims = new Set<string>();

  for (const action of prev.resolution.actions) {
    if (
      action.kind !== "attack" &&
      action.kind !== "overwatch" &&
      action.kind !== "counter"
    ) {
      continue;
    }
    if (parseDamageResult(action.result) === null) continue;
    const victim = resolveVictimFromTraceTarget(state, action.target);
    if (!victim || !deathIds.has(victim.characterId)) continue;
    if (emittedVictims.has(victim.characterId)) continue;
    emittedVictims.add(victim.characterId);
    const killer = renderCharacterTypedId(state, action.characterId);
    const weapon =
      action.weapon && action.weapon.trim() !== "" ? action.weapon : "bare hands";
    lines.push(`${killer} killed ${victim.displayName} with ${weapon}`);
  }

  return lines;
}

type VisibleEntry = {
  tier: 1 | 2 | 3 | 4 | 5;
  dist: number;
  drained: boolean;
  key: string;
  value: { [key: string]: VisibleJsonValue };
};

function visibleComparator(a: VisibleEntry, b: VisibleEntry): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.dist !== b.dist) return a.dist - b.dist;
  if (a.drained !== b.drained) return a.drained ? 1 : -1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function baseVisibleValue(kind: string, observer: CharacterState, pos: Tile) {
  const dist = chebyshev(observer.pos, pos);
  const bearing = compassDirection(observer.pos, pos);
  return {
    kind,
    pos: { x: pos.x, y: pos.y },
    dist,
    ...(bearing ? { bearing } : {}),
  };
}

function visibleEntryFor(
  entity: VisibleEntity,
  state: MatchState,
  observer: CharacterState,
): VisibleEntry {
  switch (entity.kind) {
    case "character": {
      const character = state.characters.find(
        (c) => c.characterId === entity.characterId,
      );
      const key = character?.displayName ?? entity.characterId;
      return {
        tier: 1,
        dist: chebyshev(observer.pos, entity.pos),
        drained: false,
        key,
        value: {
          ...baseVisibleValue("character", observer, entity.pos),
          hp: entity.hpBucket,
          equipped: {
            weapon: entity.weapon ?? null,
            armour: itemName(character?.equipped.armour),
            consumable: itemName(character?.equipped.consumable),
          },
        },
      };
    }
    case "chest": {
      const key = renderChestId(entity.objectId);
      const chest = state.world.chests.find((c) => c.id === entity.objectId);
      return {
        tier: 2,
        dist: chebyshev(observer.pos, entity.pos),
        drained: false,
        key,
        value: {
          ...baseVisibleValue("chest", observer, entity.pos),
          opened: entity.opened,
          contents: chest?.contents
            ? { [chest.contents.category]: chest.contents.name }
            : null,
        },
      };
    }
    case "corpse": {
      const name = resolveDisplayName(state, entity.objectId);
      const key = `Corpse_${name}`;
      const drained = corpseDrained(entity.contents);
      return {
        tier: 2,
        dist: chebyshev(observer.pos, entity.pos),
        drained,
        key,
        value: {
          ...baseVisibleValue("corpse", observer, entity.pos),
          contents: {
            weapon: itemName(entity.contents.weapon),
            armour: itemName(entity.contents.armour),
            consumable: itemName(entity.contents.consumable),
          },
          drained,
        },
      };
    }
    case "cover": {
      const key = `Cover_${entity.pos.x}_${entity.pos.y}`;
      return {
        tier: 3,
        dist: chebyshev(observer.pos, entity.pos),
        drained: false,
        key,
        value: baseVisibleValue("cover", observer, entity.pos),
      };
    }
    case "wall": {
      const key = `Wall_${entity.pos.x}_${entity.pos.y}`;
      return {
        tier: 4,
        dist: chebyshev(observer.pos, entity.pos),
        drained: false,
        key,
        value: baseVisibleValue("wall", observer, entity.pos),
      };
    }
  }
}

function observerInEvacZone(state: MatchState, observer: CharacterState): boolean {
  const evac = state.world.evac;
  if (evac.revealedAtTurn === null) return false;
  return (
    Math.abs(observer.pos.x - evac.centre.x) <= EVAC_HALF_SIZE &&
    Math.abs(observer.pos.y - evac.centre.y) <= EVAC_HALF_SIZE
  );
}

function buildVisibleObject(
  state: MatchState,
  observer: CharacterState,
): Record<string, VisibleJsonValue> {
  const { visible } = computeVisibleEntities(state, observer.characterId);
  const charAndLoot: VisibleEntry[] = [];
  const cover: VisibleEntry[] = [];
  const walls: VisibleEntry[] = [];

  for (const entity of visible) {
    const entry = visibleEntryFor(entity, state, observer);
    if (entry.tier <= 2) charAndLoot.push(entry);
    else if (entry.tier === 3) cover.push(entry);
    else walls.push(entry);
  }

  const entries = [
    ...charAndLoot.sort(visibleComparator).slice(0, VISIBLE_ENTITY_CAP),
    ...cover.sort(visibleComparator),
    ...walls.sort(visibleComparator).slice(0, WALL_CAP),
  ];

  if (state.world.evac.revealedAtTurn !== null) {
    entries.push({
      tier: 5,
      dist: chebyshev(observer.pos, state.world.evac.centre),
      drained: false,
      key: "Evac",
      value: {
        ...baseVisibleValue("evac", observer, state.world.evac.centre),
        inZone: observerInEvacZone(state, observer),
      },
    });
  }

  const out: Record<string, VisibleJsonValue> = {};
  for (const entry of entries.sort(visibleComparator)) {
    out[entry.key] = entry.value;
  }
  return out;
}

export function buildVisibleStateDigest(
  state: MatchState,
  characterId: string,
  _prev: PrevTurnRow | null,
): string {
  const observer = state.characters.find((c) => c.characterId === characterId);
  if (!observer) return "{}";
  return JSON.stringify(buildVisibleObject(state, observer), null, 2);
}

function renderStatusBlock(observer: CharacterState): string {
  return [
    "## Status",
    `📍(${observer.pos.x},${observer.pos.y})`,
    `❤️HP: ${observer.hp}/${observer.maxHp} HP`,
    `⚔️weapon: ${renderWeaponSlot(observer)}`,
    `🛡️armour: ${renderArmourSlot(observer)}`,
    `🧪consumable: ${renderConsumableSlot(observer)}`,
    `🗒️scratchpad: ${observer.scratchpad}`,
  ].join("\n");
}

export function buildAgentInput(
  state: MatchState,
  characterId: string,
  personaPromptText: string,
  prev: PrevTurnRow | null,
  aliveCount: number,
): {
  systemPrompt: string;
  visibleStateDigest: string;
  composedUserMessage: string;
} {
  const observer = state.characters.find((c) => c.characterId === characterId);
  if (!observer) {
    return {
      systemPrompt: SYSTEM_PROMPT,
      visibleStateDigest: "{}",
      composedUserMessage: "{}",
    };
  }

  const visibleStateDigest = buildVisibleStateDigest(state, characterId, prev);
  const events = [
    buildOwnOutcomeLine(state, characterId, prev),
    ...renderDamageEventLines(prev, state, observer),
    ...buildKillFeedLines(prev, state),
  ].filter((line): line is string => typeof line === "string" && line.length > 0);

  const composedUserMessage = [
    `# ${observer.displayName}`,
    `You adopt ${observer.displayName} persona:`,
    personaPromptText,
    "",
    renderStatusBlock(observer),
    "",
    "# Current Game State",
    `Turn ${state.turn}, ${aliveCount}/8 players alive`,
    ...events,
    "",
    visibleStateDigest,
  ].join("\n");

  return {
    systemPrompt: SYSTEM_PROMPT,
    visibleStateDigest,
    composedUserMessage,
  };
}

export function isCorpseDrained(contents: CorpseState["contents"]): boolean {
  return corpseDrained(contents);
}

export type { EquippedSlots, ItemRef };
