import { chebyshev } from "../engine/distance.js";
import {
  computeVisibleEntities,
  nearestTileOfRect,
} from "../engine/vision.js";
import {
  ARMOUR,
  CHARACTER_MAX_HP,
  CONSUMABLES,
  MIN_DAMAGE_FLOOR,
  WEAPONS,
  type CharacterState,
  type CorpseState,
  type EquippedSlots,
  type ItemRef,
  type MatchState,
  type Position,
  type Tile,
  type UseVariant,
  type VisibleEntity,
  type Wall,
} from "../engine/types.js";
import { buildSystemPrompt } from "./systemPrompt.js";

const VISIBLE_ENTITY_CAP = 8;
const COVER_CAP = 12;
const WALL_CAP = 12;
const EVAC_HALF_SIZE = 1;

// Engine vision intentionally still emits spent entries; this projection filters affordance-spent entities.
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
      slide?: {
        wallRectId: string;
        axis: "N" | "E" | "S" | "W";
        intent: string;
      };
      bodyCollision?:
        | { kind: "character"; defenderId: string }
        | { kind: "wall"; wallRectId: string };
    }>;
    actions: ReadonlyArray<{
      characterId: string;
      kind: string;
      target: string;
      result: string;
      triggeredByMovement?: boolean;
      weapon?: string;
      lootedItem?: string;
      discardedWeaker?: boolean;
    }>;
    deaths: ReadonlyArray<string>;
    environmentalDeaths: ReadonlyArray<string>;
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

function bearingOrHere(from: Tile, to: Tile): string {
  const bearing = compassDirection(from, to);
  return bearing === "" ? "here" : bearing;
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

function renderCrateId(objectId: string): string {
  return objectId;
}

function corpseDrained(contents: CorpseState["contents"]): boolean {
  return !contents.weapon && !contents.armour && !contents.consumable;
}

function crateSpentById(state: MatchState, objectId: string): boolean {
  const crate = state.world.crates.find((c) => c.id === objectId);
  if (crate?.opened === true) return true;
  const airdrop = state.world.airdrops.find((drop) => drop.id === objectId);
  return airdrop?.looted === true;
}

function corpseDrainedById(state: MatchState, objectId: string): boolean {
  const corpse = state.world.corpses.find((c) => c.characterId === objectId);
  return corpse ? corpseDrained(corpse.contents) : false;
}

function parseDamageResult(result: string): number | null {
  const match = /^dmg (\d+)$/.exec(result);
  if (!match) return null;
  return Number(match[1]);
}

function renderWeaponSlot(equipped: EquippedSlots): string {
  const weapon = equipped.weapon;
  if (!weapon || weapon.category !== "weapon") {
    return `unarmed [dmg ${MIN_DAMAGE_FLOOR}]`;
  }
  const stats = WEAPONS[weapon.name];
  return `${weapon.name} [dmg ${stats.dps}]`;
}

function renderArmourSlot(equipped: EquippedSlots): string {
  const armour = equipped.armour;
  if (!armour || armour.category !== "armour") return "none";
  const stats = ARMOUR[armour.name];
  return `${armour.name} [-${Math.round(stats.reductionPct * 100)}% dmg]`;
}

function renderConsumableSlot(equipped: EquippedSlots): string {
  const consumable = equipped.consumable;
  if (!consumable || consumable.category !== "consumable") return "none";
  const effect = CONSUMABLES[consumable.name];
  const label =
    effect.effect === "speed_override"
      ? `+${effect.value - 8} move range max dist`
      : `heal ${effect.value}% max HP`;
  return `${consumable.name} [${label}]`;
}

function renderSlideTarget(state: MatchState, rawTargetId: string): string {
  if (rawTargetId.startsWith("Corpse_")) {
    const ownerId = rawTargetId.slice("Corpse_".length);
    return `Corpse_${renderCharacterTypedId(state, ownerId)}`;
  }
  if (
    rawTargetId.startsWith("Wall_") ||
    rawTargetId.startsWith("Cover_") ||
    rawTargetId.startsWith("Evac_") ||
    rawTargetId.startsWith("Crate_")
  ) {
    return rawTargetId;
  }
  return renderCharacterTypedId(state, rawTargetId);
}

function renderSlideFragment(
  state: MatchState,
  slide: NonNullable<PrevTurnRow["resolution"]["moves"][number]["slide"]>,
): string {
  const prefix = `hugged ${slide.wallRectId} ${slide.axis}`;
  if (slide.intent === "NE" || slide.intent === "SE" || slide.intent === "SW" || slide.intent === "NW") {
    return prefix;
  }
  if (slide.intent.startsWith("toward ")) {
    const targetId = slide.intent.slice("toward ".length);
    return `${prefix} toward ${renderSlideTarget(state, targetId)}`;
  }
  if (slide.intent.startsWith("away ")) {
    const targetId = slide.intent.slice("away ".length);
    return `${prefix} away from ${renderSlideTarget(state, targetId)}`;
  }
  return prefix;
}

function renderBodyCollisionFragment(
  state: MatchState,
  bodyCollision: NonNullable<
    PrevTurnRow["resolution"]["moves"][number]["bodyCollision"]
  >,
): string {
  if (bodyCollision.kind === "character") {
    return `charged into ${renderCharacterTypedId(
      state,
      bodyCollision.defenderId,
    )} (dmg 1, took 1)`;
  }
  return `tried to move and hit ${bodyCollision.wallRectId} (took 1)`;
}

function joinMoveFragments(
  fragments: Array<{ kind: "movement" | "slide" | "collision"; text: string }>,
): string {
  let rendered = fragments[0]?.text ?? "";
  for (let i = 1; i < fragments.length; i += 1) {
    const prev = fragments[i - 1]!;
    const current = fragments[i]!;
    const separator =
      prev.kind === "slide" && current.kind === "collision" ? "; " : ", ";
    rendered += `${separator}${current.text}`;
  }
  return rendered;
}

function renderMoveFragment(
  state: MatchState,
  prev: PrevTurnRow,
  characterId: string,
): string | null {
  const entry = prev.resolution.moves.find((m) => m.characterId === characterId);
  if (!entry) return null;
  const dist = chebyshev(entry.from, entry.to);
  const fragments: Array<{
    kind: "movement" | "slide" | "collision";
    text: string;
  }> = [];
  if (dist > 0 && (!entry.slide || entry.bodyCollision)) {
    const dir = compassDirection(entry.from, entry.to);
    fragments.push({
      kind: "movement",
      text: dir ? `moved ${dist} ${dir}` : `moved ${dist}`,
    });
  }
  if (entry.slide) {
    fragments.push({ kind: "slide", text: renderSlideFragment(state, entry.slide) });
  }
  if (entry.bodyCollision) {
    fragments.push({
      kind: "collision",
      text: renderBodyCollisionFragment(state, entry.bodyCollision),
    });
  }
  if (fragments.length > 0) return joinMoveFragments(fragments);
  if (entry.blockedBy === "wall") return "tried to move and hit wall";
  return null;
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
  if (result === "empty" || result === "already_opened" || result === "no_corpse") {
    return `looted nothing from empty ${target}`;
  }
  if (
    (result === "opened" || result === "looted") &&
    entry.lootedItem &&
    entry.lootedItem.trim().length > 0
  ) {
    if (entry.discardedWeaker === true) {
      return `discarded ${entry.lootedItem} from ${target} (downgrade — kept existing)`;
    }
    return `looted ${entry.lootedItem} from ${target}`;
  }
  return result ? `looted ${target} (${result})` : `looted ${target}`;
}

function quoteSpeech(text: string): string {
  return JSON.stringify(text.replace(/\s*\r?\n\s*/g, " ").trim());
}

export function buildOwnSpeechLine(
  prev: PrevTurnRow | null,
  characterId: string,
): string | null {
  if (!prev) return null;
  const entry = prev.resolution.speech.find((s) => s.characterId === characterId);
  if (!entry) return null;
  return `You said ${quoteSpeech(entry.text)}`;
}

export function buildInboundSpeechLines(
  prev: PrevTurnRow | null,
  state: MatchState,
  observer: CharacterState,
): string[] {
  if (!prev) return [];
  const lines: string[] = [];
  for (const speech of prev.resolution.speech) {
    if (speech.characterId === observer.characterId) continue;
    if (!speech.heardBy.includes(observer.characterId)) continue;
    const speaker = renderCharacterTypedId(state, speech.characterId);
    lines.push(`${speaker} said ${quoteSpeech(speech.text)}`);
  }
  return lines;
}

export function buildOwnOutcomeLine(
  state: MatchState,
  characterId: string,
  prev: PrevTurnRow | null,
): string | null {
  if (!prev) return null;
  const fragments: string[] = [];
  const move = renderMoveFragment(state, prev, characterId);
  if (move) fragments.push(move);
  const action = renderActionFragment(prev, characterId);
  if (action) fragments.push(action);
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
  for (const move of prev.resolution.moves) {
    const bodyCollision = move.bodyCollision;
    if (bodyCollision?.kind !== "character") continue;
    if (bodyCollision.defenderId !== observer.characterId) continue;
    const charger = renderCharacterTypedId(state, move.characterId);
    lines.push(`${charger} charged into you (dmg 1)`);
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
  if (
    !prev ||
    (prev.resolution.deaths.length === 0 &&
      prev.resolution.environmentalDeaths.length === 0)
  ) {
    return [];
  }
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

  for (const move of prev.resolution.moves) {
    const bodyCollision = move.bodyCollision;
    if (bodyCollision?.kind !== "character") continue;
    const victim = state.characters.find(
      (c) => c.characterId === bodyCollision.defenderId,
    );
    if (!victim || !deathIds.has(victim.characterId)) continue;
    if (emittedVictims.has(victim.characterId)) continue;
    emittedVictims.add(victim.characterId);
    const killer = renderCharacterTypedId(state, move.characterId);
    lines.push(`${killer} killed ${victim.displayName} with bare hands`);
  }

  for (const victimId of prev.resolution.environmentalDeaths) {
    const victim = renderCharacterTypedId(state, victimId);
    lines.push(`${victim} got telefragged by crate spawn`);
  }

  return lines;
}

type VisibleEntry = {
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  dist: number;
  key: string;
  value: { [key: string]: VisibleJsonValue };
};

function visibleComparator(a: VisibleEntry, b: VisibleEntry): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.dist !== b.dist) return a.dist - b.dist;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function baseVisibleValue(observer: CharacterState, pos: Tile) {
  const dist = chebyshev(observer.pos, pos);
  const bearing = compassDirection(observer.pos, pos);
  return {
    dist,
    ...(bearing ? { bearing } : {}),
  };
}

function rectKey(prefix: "Wall" | "Cover" | "Evac", rect: Wall): string {
  const x2 = rect.x + rect.w - 1;
  const y2 = rect.y + rect.h - 1;
  if (rect.w === 1 && rect.h === 1) return `${prefix}_${rect.x}_${rect.y}`;
  return `${prefix}_${rect.x}_${rect.y}_to_${x2}_${y2}`;
}

function rectVisibleValue(observer: CharacterState, rect: Wall, shape: string) {
  const nearest = nearestTileOfRect(observer.pos, rect);
  return {
    dist: chebyshev(observer.pos, nearest),
    bearing: bearingOrHere(observer.pos, nearest),
    shape,
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
        key,
        value: {
          ...baseVisibleValue(observer, entity.pos),
          hp: entity.hpBucket,
          armed: Boolean(entity.weapon ?? character?.equipped.weapon),
        },
      };
    }
    case "crate": {
      const key = renderCrateId(entity.objectId);
      return {
        tier: 2,
        dist: chebyshev(observer.pos, entity.pos),
        key,
        value: baseVisibleValue(observer, entity.pos),
      };
    }
    case "airdrop": {
      const key = renderCrateId(entity.objectId);
      return {
        tier: 0,
        dist: chebyshev(observer.pos, entity.pos),
        key,
        value: {
          ...baseVisibleValue(observer, entity.pos),
          countdown: entity.countdown,
        },
      };
    }
    case "corpse": {
      const name = resolveDisplayName(state, entity.objectId);
      const key = `Corpse_${name}`;
      return {
        tier: 2,
        dist: chebyshev(observer.pos, entity.pos),
        key,
        value: baseVisibleValue(observer, entity.pos),
      };
    }
    case "cover_rect": {
      const nearest = nearestTileOfRect(observer.pos, entity.rect);
      const key = rectKey("Cover", entity.rect);
      return {
        tier: 3,
        dist: chebyshev(observer.pos, nearest),
        key,
        value: rectVisibleValue(observer, entity.rect, entity.shape),
      };
    }
    case "wall_rect": {
      const nearest = nearestTileOfRect(observer.pos, entity.rect);
      const key = rectKey("Wall", entity.rect);
      return {
        tier: 4,
        dist: chebyshev(observer.pos, nearest),
        key,
        value: rectVisibleValue(observer, entity.rect, entity.shape),
      };
    }
    case "evac_rect": {
      const nearest = nearestTileOfRect(observer.pos, entity.rect);
      const key = rectKey("Evac", entity.rect);
      return {
        tier: 5,
        dist: chebyshev(observer.pos, nearest),
        key,
        value: rectVisibleValue(observer, entity.rect, entity.shape),
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
  const airdrops: VisibleEntry[] = [];
  const charAndLoot: VisibleEntry[] = [];
  const cover: VisibleEntry[] = [];
  const walls: VisibleEntry[] = [];
  const evac: VisibleEntry[] = [];

  for (const entity of visible) {
    if (entity.kind === "crate" && crateSpentById(state, entity.objectId)) {
      continue;
    }
    if (entity.kind === "corpse" && corpseDrainedById(state, entity.objectId)) {
      continue;
    }
    const entry = visibleEntryFor(entity, state, observer);
    if (entry.tier === 0) airdrops.push(entry);
    else if (entry.tier <= 2) charAndLoot.push(entry);
    else if (entry.tier === 3) cover.push(entry);
    else if (entry.tier === 4) walls.push(entry);
    else evac.push(entry);
  }

  const entries = [
    ...airdrops.sort(visibleComparator),
    ...charAndLoot.sort(visibleComparator).slice(0, VISIBLE_ENTITY_CAP),
    ...cover.sort(visibleComparator).slice(0, COVER_CAP),
    ...walls.sort(visibleComparator).slice(0, WALL_CAP),
    ...evac.sort(visibleComparator),
  ];

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
  if (!observer) return "Vision:\n{}";
  return `Vision:\n${JSON.stringify(buildVisibleObject(state, observer), null, 2)}`;
}

export type AgentInputStatus = {
  hp: number;
  pos: Tile;
  equipped: EquippedSlots;
  insideEvac: boolean;
};

export type PersistedAgentInput = {
  systemPromptHash: string;
  personaPromptHash: string;
  visibleStateDigest: string;
  scratchpadBefore: string;
  useVariant?: UseVariant;
  status: AgentInputStatus;
  narrativeLines: string[];
  aliveCount: number;
};

export type PromptsLookup = {
  systemText(hash: string): string;
  personaText(hash: string): string;
};

export class MissingPromptHashError extends Error {
  constructor(kind: "system" | "persona", hash: string) {
    super(`Missing ${kind} prompt text for hash ${hash}`);
    this.name = "MissingPromptHashError";
  }
}

function requirePromptText(
  kind: "system" | "persona",
  hash: string,
  text: unknown,
): string {
  if (typeof text !== "string") {
    throw new MissingPromptHashError(kind, hash);
  }
  return text;
}

export function renderStatusBlock(args: {
  hp: number;
  maxHp: number;
  pos: Tile;
  equipped: EquippedSlots;
  insideEvac: boolean;
  scratchpad: string;
}): string {
  const evacStatus = args.insideEvac ? "Inside Evac" : "Outside Evac";
  return [
    "## Status",
    `📍(${args.pos.x},${args.pos.y}) ${evacStatus}`,
    `❤️HP: ${args.hp}/${args.maxHp} HP`,
    `⚔️weapon: ${renderWeaponSlot(args.equipped)}`,
    `🛡️armour: ${renderArmourSlot(args.equipped)}`,
    `🧪consumable: ${renderConsumableSlot(args.equipped)}`,
    `🗒️scratchpad: ${args.scratchpad}`,
  ].join("\n");
}

function statusFromObserver(
  state: MatchState,
  observer: CharacterState,
): AgentInputStatus {
  return {
    hp: observer.hp,
    pos: { x: observer.pos.x, y: observer.pos.y },
    equipped: { ...observer.equipped },
    insideEvac: observerInEvacZone(state, observer),
  };
}

export function recomposeUserMessage(args: {
  input: PersistedAgentInput;
  turn: number;
  displayName: string;
  prompts: PromptsLookup;
}): string {
  requirePromptText(
    "system",
    args.input.systemPromptHash,
    args.prompts.systemText(args.input.systemPromptHash),
  );
  const personaPromptText = requirePromptText(
    "persona",
    args.input.personaPromptHash,
    args.prompts.personaText(args.input.personaPromptHash),
  );

  return [
    `# ${args.displayName}`,
    `You adopt ${args.displayName} persona:`,
    personaPromptText,
    "",
    renderStatusBlock({
      hp: args.input.status.hp,
      maxHp: CHARACTER_MAX_HP,
      pos: args.input.status.pos,
      equipped: args.input.status.equipped,
      insideEvac: args.input.status.insideEvac,
      scratchpad: args.input.scratchpadBefore,
    }),
    "",
    "# Current Game State",
    `Turn ${args.turn}, ${args.input.aliveCount}/8 players alive`,
    ...args.input.narrativeLines,
    "",
    args.input.visibleStateDigest,
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
  status: AgentInputStatus;
  narrativeLines: string[];
  aliveCount: number;
  composedUserMessage: string;
} {
  const observer = state.characters.find((c) => c.characterId === characterId);
  if (!observer) {
    const systemPrompt = buildSystemPrompt(state.turn);
    return {
      systemPrompt,
      visibleStateDigest: "Vision:\n{}",
      status: {
        hp: 0,
        pos: { x: 0, y: 0 },
        equipped: {},
        insideEvac: false,
      },
      narrativeLines: [],
      aliveCount,
      composedUserMessage: "{}",
    };
  }

  const systemPrompt = buildSystemPrompt(state.turn);
  const visibleStateDigest = buildVisibleStateDigest(state, characterId, prev);
  const status = statusFromObserver(state, observer);
  const events = [
    buildOwnOutcomeLine(state, characterId, prev),
    ...renderDamageEventLines(prev, state, observer),
    buildOwnSpeechLine(prev, characterId),
    ...buildInboundSpeechLines(prev, state, observer),
    ...buildKillFeedLines(prev, state),
  ].filter((line): line is string => typeof line === "string" && line.length > 0);

  const composedUserMessage = [
    `# ${observer.displayName}`,
    `You adopt ${observer.displayName} persona:`,
    personaPromptText,
    "",
    renderStatusBlock({
      ...status,
      maxHp: observer.maxHp,
      scratchpad: observer.scratchpad,
    }),
    "",
    "# Current Game State",
    `Turn ${state.turn}, ${aliveCount}/8 players alive`,
    ...events,
    "",
    visibleStateDigest,
  ].join("\n");

  return {
    systemPrompt,
    visibleStateDigest,
    status,
    narrativeLines: events,
    aliveCount,
    composedUserMessage,
  };
}

export function isCorpseDrained(contents: CorpseState["contents"]): boolean {
  return corpseDrained(contents);
}

export type { EquippedSlots, ItemRef };
