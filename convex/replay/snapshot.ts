import type { Doc } from "../_generated/dataModel.js";
import { findCrateById } from "../engine/airdrops.js";
import {
  buildTargetIdLookup,
  collectDamageCandidates,
} from "../engine/killAttribution.js";
import {
  ARMOUR,
  CONSUMABLES,
  WEAPONS,
  type ArmourName,
  type ConsumableName,
  type EquippedSlots,
  type ItemRef,
  type MapDescriptor,
  type Tile,
  type WeaponName,
  type WorldState,
} from "../engine/types.js";
import { normaliseCorpseTargetId } from "../llm/idNormalisation.js";
import { reconstruct, type ReplayBundle } from "./reconstruct.js";
import type {
  MatchSnapshotJson,
  MatchSummary,
  MatchWithCharacters,
  Rect,
} from "./snapshotTypes.js";

const SECONDS_PER_TURN = 0.6;
const FPS_HINT = 60;

type TurnRow = ReplayBundle["turns"][number];
type AgentRecord = TurnRow["agentRecords"][number];
type StatusSnapshot = { equipped: EquippedSlots; hp: number };
type SnapshotMoveTrace = TurnRow["resolution"]["moves"][number] & {
  path: Tile[];
};

export function buildMatchSnapshot(
  bundle: ReplayBundle,
  mapDescriptor: MapDescriptor,
): MatchSnapshotJson {
  const turnCount = bundle.match.turn;
  const turnRowByTurn = new Map<number, TurnRow>(
    bundle.turns.map((turn) => [turn.turn, turn]),
  );
  const extractedAtTurnById = new Map<string, number>();
  for (const character of bundle.characters) {
    if (character.extractedAtTurn !== undefined) {
      extractedAtTurnById.set(character._id, character.extractedAtTurn);
    }
  }
  const lastSeenStatus = new Map<string, StatusSnapshot>();
  for (const character of bundle.characters) {
    lastSeenStatus.set(character._id, {
      equipped: copyEquipped(character.equipped),
      hp: character.hp,
    });
  }
  const inactiveCharacterIds = new Set<string>();

  const frames: MatchSnapshotJson["timeline"]["frames"] = [];
  for (let t = 1; t <= turnCount; t++) {
    const row = turnRowByTurn.get(t);
    if (row) {
      for (const record of row.agentRecords) {
        if (inactiveCharacterIds.has(record.characterId)) continue;
        lastSeenStatus.set(record.characterId, {
          equipped: copyEquipped(record.input.status.equipped),
          hp: record.input.status.hp,
        });
      }
    }

    const equippedByCharacter: Record<string, EquippedSlots | null> = {};
    const hpByCharacter: Record<string, number> = {};
    for (const character of bundle.characters) {
      const status = lastSeenStatus.get(character._id);
      equippedByCharacter[character._id] = status
        ? copyEquipped(status.equipped)
        : null;
      hpByCharacter[character._id] = status?.hp ?? character.hp;
    }

    frames.push({
      turn: t,
      timeSeconds: (t - 1) * SECONDS_PER_TURN,
      snapshot: reconstruct(bundle, t),
      equippedByCharacter,
      hpByCharacter,
    });

    if (row) {
      for (const characterId of row.resolution.deaths) {
        inactiveCharacterIds.add(characterId);
      }
      for (const characterId of row.resolution.environmentalDeaths ?? []) {
        inactiveCharacterIds.add(characterId);
      }
    }
    for (const [characterId, extractedAtTurn] of extractedAtTurnById) {
      if (extractedAtTurn <= t) inactiveCharacterIds.add(characterId);
    }
  }

  return {
    schemaVersion: 3,
    source: {
      matchId: bundle.match._id,
      mapId: bundle.match.mapId,
      completedAt: completedAt(bundle.match),
      rngSeed: bundle.match.rngSeed,
    },
    playback: {
      turnCount,
      secondsPerTurn: SECONDS_PER_TURN,
      sliceDurationSeconds: turnCount * SECONDS_PER_TURN,
      fpsHint: FPS_HINT,
      startTurn: 1,
      endTurn: turnCount,
    },
    map: projectMap(bundle, mapDescriptor),
    characters: projectCharacters(bundle, mapDescriptor),
    timeline: { frames },
    movements: buildMovements(bundle.turns),
    attacks: buildAttacks(bundle),
    loots: buildLoots(bundle),
    killFeed: buildKillFeed(bundle),
    speechLog: buildSpeechLog(bundle.turns),
    agentTraces: buildAgentTraces(bundle.turns),
    outcome: {
      extracted: bundle.match.outcome.extracted,
      lastSurvivor: bundle.match.outcome.lastSurvivor ?? null,
      pointsByCharacter: bundle.match.outcome.pointsByCharacter,
    },
  };
}

export function summariseMatch(
  match: Doc<"matches">,
  characters: Array<Doc<"characters">>,
): MatchSummary;
export function summariseMatch(joined: MatchWithCharacters): MatchSummary;
export function summariseMatch(
  matchOrJoined: Doc<"matches"> | MatchWithCharacters,
  characters?: Array<Doc<"characters">>,
): MatchSummary {
  const match = isJoinedMatch(matchOrJoined)
    ? matchOrJoined.match
    : matchOrJoined;
  const characterRows = isJoinedMatch(matchOrJoined)
    ? matchOrJoined.characters
    : characters ?? [];
  return {
    matchId: match._id,
    completedAt: completedAt(match),
    mapId: match.mapId,
    characterIds: characterRows.map((character) => character._id),
    characterCount: characterRows.length,
    turnCount: match.turn,
    outcome: {
      extractedCount: match.outcome.extracted.length,
      lastSurvivor: match.outcome.lastSurvivor ?? null,
    },
  };
}

export function summariseJoinedMatch(joined: MatchWithCharacters): MatchSummary {
  return summariseMatch(joined);
}

function isJoinedMatch(
  value: Doc<"matches"> | MatchWithCharacters,
): value is MatchWithCharacters {
  return "match" in value && "characters" in value;
}

function completedAt(match: Doc<"matches">): number {
  return match.completedAt ?? match._creationTime;
}

function projectMap(
  bundle: ReplayBundle,
  mapDescriptor: MapDescriptor,
): MatchSnapshotJson["map"] {
  const world = bundle.worldState;
  return {
    size: mapDescriptor.size,
    walls: world?.walls ?? mapDescriptor.walls,
    coverClusters: world?.coverClusters ?? mapDescriptor.coverClusters,
    evac: {
      centre: world?.evac.centre ?? mapDescriptor.evac,
      zone: evacZone(mapDescriptor.evac),
      revealedAtTurn: world?.evac.revealedAtTurn ?? null,
    },
    staticCrates: (world?.crates ?? []).map((crate) => ({
      id: crate.id,
      pos: { x: crate.pos.x, y: crate.pos.y },
      contents: crate.contents,
    })),
    airdrops: (world?.airdrops ?? []).map((drop) => ({
      id: drop.id,
      pos: { x: drop.pos.x, y: drop.pos.y },
      landsAtTurn: drop.landsAtTurn,
      contents: drop.contents,
    })),
  };
}

function evacZone(centre: Tile): Rect {
  return { x: centre.x - 1, y: centre.y - 1, w: 3, h: 3 };
}

function projectCharacters(
  bundle: ReplayBundle,
  mapDescriptor: MapDescriptor,
): MatchSnapshotJson["characters"] {
  return bundle.characters.map((character) => {
    const promptHashes = promptHashesForCharacter(bundle.turns, character._id);
    const spawn = mapDescriptor.spawns[character.spawnIndex] ?? character.pos;
    return {
      characterId: character._id,
      personaId: character.personaId,
      displayName: character.displayName,
      spawnIndex: character.spawnIndex,
      spawn: { x: spawn.x, y: spawn.y },
      cardId: character.cardId ?? null,
      prompts: {
        system:
          promptHashes.system === null
            ? null
            : bundle.promptsLookup?.system[promptHashes.system] ?? null,
        persona:
          promptHashes.persona === null
            ? null
            : bundle.promptsLookup?.persona[promptHashes.persona] ?? null,
      },
    };
  });
}

function buildMovements(
  turns: TurnRow[],
): MatchSnapshotJson["movements"] {
  return turns.flatMap((turn) =>
    snapshotMoves(turn).map((move) => {
      const event: MatchSnapshotJson["movements"][number] = {
        turn: turn.turn,
        characterId: move.characterId,
        fromTile: copyTile(move.from),
        toTile: copyTile(move.to),
        path: move.path.map(copyTile),
      };
      if (move.blockedBy !== undefined) event.blockedBy = move.blockedBy;
      if (move.bodyCollision !== undefined) {
        event.bodyCollisionKind = move.bodyCollision.kind;
        if (move.bodyCollision.kind === "wall") {
          event.wallRectId = move.bodyCollision.wallRectId;
        }
      }
      return event;
    }),
  );
}

function buildAttacks(bundle: ReplayBundle): MatchSnapshotJson["attacks"] {
  const targetIdLookup = buildTargetIdLookup(bundle.turns, bundle.characters);
  const characterIds = new Set<string>(
    bundle.characters.map((character) => character._id),
  );

  return bundle.turns.flatMap((turn) =>
    collectDamageCandidates(turn, (target) => targetIdLookup.get(target) ?? target)
      .filter((candidate) => characterIds.has(candidate.targetId))
      .map((candidate) => ({
        turn: turn.turn,
        attackerId: candidate.attackerId,
        targetId: candidate.targetId,
        weapon: weaponForSnapshot(candidate.weapon),
        kind: candidate.kind,
        hit: candidate.hit,
        lethal: candidate.lethal,
      })),
  );
}

function buildLoots(bundle: ReplayBundle): MatchSnapshotJson["loots"] {
  const world = bundle.worldState as WorldState | null;
  if (!world) return [];
  const characters = bundle.characters.map((character) => ({
    characterId: character._id,
    displayName: character.displayName,
  }));

  const loots: MatchSnapshotJson["loots"] = [];
  for (const turn of bundle.turns) {
    for (const action of turn.resolution.actions) {
      if (action.kind !== "loot") continue;
      if (action.result !== "opened" && action.result !== "looted") continue;
      const item = itemRefForLootedItem(action.lootedItem);
      if (!item) continue;

      if (action.result === "opened") {
        const crate = findCrateById(world, action.target, turn.turn);
        if (!crate) continue;
        loots.push({
          turn: turn.turn,
          characterId: action.characterId,
          source: crate.source === "static" ? "crate" : "airdrop",
          sourceId: action.target,
          item,
          equipped: action.discardedWeaker !== true,
        });
        continue;
      }

      const sourceId = normaliseCorpseSourceId(action.target, characters, world);
      if (!sourceId) continue;
      loots.push({
        turn: turn.turn,
        characterId: action.characterId,
        source: "corpse",
        sourceId,
        item,
        equipped: action.discardedWeaker !== true,
      });
    }
  }
  return loots;
}

function promptHashesForCharacter(
  turns: TurnRow[],
  characterId: string,
): { system: string | null; persona: string | null } {
  for (const turn of turns) {
    const record = turn.agentRecords.find(
      (candidate) => candidate.characterId === characterId,
    );
    if (record) {
      return {
        system: record.input.systemPromptHash,
        persona: record.input.personaPromptHash,
      };
    }
  }
  return { system: null, persona: null };
}

function buildKillFeed(bundle: ReplayBundle): MatchSnapshotJson["killFeed"] {
  const targetIdLookup = buildTargetIdLookup(bundle.turns, bundle.characters);
  const displayNameById = new Map<string, string>(
    bundle.characters.map((character) => [character._id, character.displayName]),
  );
  const feed: MatchSnapshotJson["killFeed"] = [];

  for (const row of bundle.turns) {
    const environmentalDeathSet = new Set<string>(
      row.resolution.environmentalDeaths ?? [],
    );
    const candidates = collectDamageCandidates(
      row,
      (target) => targetIdLookup.get(target) ?? target,
    );
    for (const victimId of row.resolution.deaths) {
      if (environmentalDeathSet.has(victimId)) continue;
      const candidate = candidates.find(
        (candidate) => candidate.lethal && candidate.targetId === victimId,
      );
      const killerId = candidate?.attackerId ?? null;
      const weapon = weaponForSnapshot(candidate?.weapon ?? null);
      feed.push({
        turn: row.turn,
        victimId,
        killerId,
        weapon,
        kind: "duel",
        text: formatKillLine(
          displayNameById.get(killerId ?? "") ?? null,
          displayNameById.get(victimId) ?? victimId,
          weapon,
        ),
      });
    }

    for (const victimId of environmentalDeathSet) {
      feed.push({
        turn: row.turn,
        victimId,
        killerId: null,
        weapon: null,
        kind: "environmental",
        text: `${displayNameById.get(victimId) ?? victimId} died to the arena`,
      });
    }
  }

  return feed;
}

function formatKillLine(
  killerName: string | null,
  victimName: string,
  weapon: string | null,
): string {
  const attacker = killerName ?? "Unknown";
  return `${attacker} killed ${victimName} with ${weapon ?? "bare hands"}`;
}

function buildSpeechLog(turns: TurnRow[]): MatchSnapshotJson["speechLog"] {
  return turns.flatMap((turn) =>
    turn.resolution.speech.map((speech) => ({
      turn: turn.turn,
      characterId: speech.characterId,
      text: speech.text,
      heardBy: [...speech.heardBy],
    })),
  );
}

function buildAgentTraces(turns: TurnRow[]): MatchSnapshotJson["agentTraces"] {
  return turns.flatMap((turn) =>
    turn.agentRecords.map((record) => ({
      turn: turn.turn,
      characterId: record.characterId,
      scratchpadBefore: record.input.scratchpadBefore,
      scratchpadAfter: record.scratchpadAfter,
      decisionSay: decisionSay(record),
      reasoning: record.llm.reasoning ?? null,
    })),
  );
}

function decisionSay(record: AgentRecord): string | null {
  return record.decision.say;
}

function snapshotMoves(turn: TurnRow): SnapshotMoveTrace[] {
  return turn.resolution.moves as SnapshotMoveTrace[];
}

function copyTile(tile: Tile): Tile {
  return { x: tile.x, y: tile.y };
}

function weaponForSnapshot(weapon: string | null): WeaponName | null {
  return weapon !== null && weapon in WEAPONS ? (weapon as WeaponName) : null;
}

function itemRefForLootedItem(item: string | undefined): ItemRef | null {
  if (item === undefined) return null;
  if (item in WEAPONS) return { category: "weapon", name: item as WeaponName };
  if (item in ARMOUR) return { category: "armour", name: item as ArmourName };
  if (item in CONSUMABLES) {
    return { category: "consumable", name: item as ConsumableName };
  }
  return null;
}

function normaliseCorpseSourceId(
  target: string,
  characters: ReadonlyArray<{ characterId: string; displayName: string }>,
  world: WorldState,
): string | null {
  const resolved = normaliseCorpseTargetId(target, characters);
  if (resolved) return resolved;
  if (!target.startsWith("Corpse_")) return null;
  const directId = target.slice("Corpse_".length);
  return world.corpses.some((corpse) => corpse.characterId === directId)
    ? directId
    : null;
}

function copyEquipped(equipped: EquippedSlots): EquippedSlots {
  return {
    ...(equipped.weapon ? { weapon: { ...equipped.weapon } } : {}),
    ...(equipped.armour ? { armour: { ...equipped.armour } } : {}),
    ...(equipped.consumable ? { consumable: { ...equipped.consumable } } : {}),
  };
}
