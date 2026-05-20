#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const mapPath = path.join(repoRoot, "maps/reference.json");
const outPath = path.join(repoRoot, "throwaway-prototypes/shared-harness/replay-snapshot.json");

const PERSONAS = [
  "rat",
  "duelist",
  "trader",
  "opportunist",
  "paranoid",
  "camper",
  "sprinter",
  "vulture",
];

const START_TURN = 1;
const END_TURN = 12;
const LAND_TURN = 10;
const DUEL_START_TURN = 2;
const DUEL_EXCHANGE_TURN = 3;
const DUEL_KILL_TURN = 4;
const DUEL_KILLER_ID = "char_sprinter";
const DUEL_VICTIM_ID = "char_vulture";
const DUEL_CORPSE_TILE = { x: 34, y: 56 };
const SLICE_DURATION_SECONDS = 30;

function titleCase(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function crateId(pos) {
  return `Crate_${pos.x}_${pos.y}`;
}

function expandRectTiles(rect) {
  const tiles = [];
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function containsTile(rect, tile) {
  return (
    tile.x >= rect.x &&
    tile.x < rect.x + rect.w &&
    tile.y >= rect.y &&
    tile.y < rect.y + rect.h
  );
}

function assertWalkable(map, tile, label) {
  if (
    tile.x < 0 ||
    tile.y < 0 ||
    tile.x >= map.size.w ||
    tile.y >= map.size.h
  ) {
    throw new Error(`${label} is outside the map: ${JSON.stringify(tile)}`);
  }
  const blocker = map.walls.find((wall) => containsTile(wall, tile));
  if (blocker) {
    throw new Error(
      `${label} overlaps wall ${JSON.stringify(blocker)}: ${JSON.stringify(tile)}`,
    );
  }
}

function projectAirdrop(drop, turn) {
  if (drop.looted) {
    return {
      id: drop.id,
      pos: drop.pos,
      landsAtTurn: drop.landsAtTurn,
      state: "spent",
      looted: true,
    };
  }
  if (turn < drop.landsAtTurn - 3) {
    return {
      id: drop.id,
      pos: drop.pos,
      landsAtTurn: drop.landsAtTurn,
      state: "pre",
      looted: false,
    };
  }
  if (turn <= drop.landsAtTurn) {
    return {
      id: drop.id,
      pos: drop.pos,
      landsAtTurn: drop.landsAtTurn,
      state: "telegraphed",
      looted: false,
      countdown: drop.landsAtTurn - turn,
    };
  }
  return {
    id: drop.id,
    pos: drop.pos,
    landsAtTurn: drop.landsAtTurn,
    state: "landed",
    looted: false,
  };
}

function makeSnapshot({ turn, characters, corpses, crates, airdrops }) {
  return {
    turn,
    characters,
    corpses,
    crates,
    airdrops: airdrops.map((drop) => projectAirdrop(drop, turn)),
    evacRevealed: false,
  };
}

function makeCharacterFrame(character, pos, turn) {
  const telefragged =
    character.characterId === "char_sprinter" && turn >= LAND_TURN;
  const duelKilled =
    character.characterId === DUEL_VICTIM_ID && turn >= DUEL_KILL_TURN;
  const diedAtTurn = telefragged
    ? LAND_TURN
    : duelKilled
      ? DUEL_KILL_TURN
      : null;
  return {
    characterId: character.characterId,
    personaId: character.personaId,
    displayName: character.displayName,
    pos,
    alive: diedAtTurn === null,
    hidden: false,
    diedAtTurn,
    extractedAtTurn: null,
    equipped: null,
    hp: null,
  };
}

function buildCharacterPositions(map, characters, drop) {
  const sprinter = characters.find((c) => c.personaId === "sprinter");
  if (!sprinter) throw new Error("Missing sprinter character");
  const vulture = characters.find((c) => c.personaId === "vulture");
  if (!vulture) throw new Error("Missing vulture character");

  const sprinterSpawn = map.spawns[sprinter.spawnIndex];
  const sprinterStaging = { x: drop.pos.x - 1, y: drop.pos.y };
  const vultureSpawn = map.spawns[vulture.spawnIndex];
  assertWalkable(map, sprinterSpawn, "Sprinter spawn");
  assertWalkable(map, sprinterStaging, "Sprinter staging tile");
  assertWalkable(map, drop.pos, "Airdrop landing tile");
  assertWalkable(map, vultureSpawn, "Vulture spawn");

  const sprinterPath = new Map([
    [0, sprinterSpawn],
    [1, sprinterSpawn],
    [2, { x: 28, y: 60 }],
    [3, { x: 30, y: 56 }],
    [4, { x: 34, y: 54 }],
    [5, { x: 42, y: 52 }],
    [6, sprinterStaging],
    [7, sprinterStaging],
    [8, sprinterStaging],
    [9, sprinterStaging],
    [10, drop.pos],
    [11, drop.pos],
    [12, drop.pos],
  ]);
  const vulturePath = new Map([
    [0, vultureSpawn],
    [1, vultureSpawn],
    [2, { x: 28, y: 56 }],
    [3, { x: 32, y: 56 }],
    [4, DUEL_CORPSE_TILE],
  ]);
  for (const [turn, pos] of sprinterPath) {
    assertWalkable(map, pos, `Sprinter scripted path turn ${turn}`);
  }
  for (const [turn, pos] of vulturePath) {
    assertWalkable(map, pos, `Vulture scripted path turn ${turn}`);
  }
  assertWalkable(map, DUEL_CORPSE_TILE, "Duel corpse tile");

  return function positionFor(character, turn) {
    if (character.personaId === "sprinter") {
      return sprinterPath.get(turn) ?? drop.pos;
    }
    if (character.personaId === "vulture" && turn >= DUEL_KILL_TURN) {
      return DUEL_CORPSE_TILE;
    }
    if (character.personaId === "vulture") {
      return vulturePath.get(turn) ?? vultureSpawn;
    }
    return map.spawns[character.spawnIndex];
  };
}

function corpseFramesForTurn(turn) {
  if (turn < DUEL_KILL_TURN) return [];
  return [{ characterId: DUEL_VICTIM_ID, pos: { ...DUEL_CORPSE_TILE } }];
}

function sameTile(a, b) {
  return a.x === b.x && a.y === b.y;
}

function movesForTurn({ turn, characters, positionFor }) {
  if (turn <= START_TURN) return [];
  const moves = [];
  for (const character of characters) {
    const from = positionFor(character, turn - 1);
    const to = positionFor(character, turn);
    if (!sameTile(from, to)) {
      moves.push({
        characterId: character.characterId,
        from: { ...from },
        to: { ...to },
      });
    }
  }
  return moves;
}

function actionsForTurn(turn) {
  if (turn === DUEL_EXCHANGE_TURN) {
    return [
      {
        characterId: DUEL_KILLER_ID,
        kind: "attack",
        target: "Vulture",
        result: "dmg 20",
      },
      {
        characterId: DUEL_VICTIM_ID,
        kind: "attack",
        target: "Sprinter",
        result: "dmg 12",
      },
    ];
  }
  if (turn === DUEL_KILL_TURN) {
    return [
      {
        characterId: DUEL_KILLER_ID,
        kind: "attack",
        target: "Vulture",
        result: "dmg 50",
      },
    ];
  }
  return [];
}

function makeResolution({ turn, characters, positionFor }) {
  return {
    turn,
    moves: movesForTurn({ turn, characters, positionFor }),
    actions: actionsForTurn(turn),
    deaths: turn === DUEL_KILL_TURN ? [DUEL_VICTIM_ID] : [],
    environmentalDeaths: turn === LAND_TURN ? ["char_sprinter"] : [],
    visibilityUpdates: [],
  };
}

async function main() {
  const map = JSON.parse(await readFile(mapPath, "utf8"));
  const firstDropDescriptor = map.airdrops.find((drop) => drop.landsAtTurn === LAND_TURN);
  if (!firstDropDescriptor) {
    throw new Error(`reference map has no airdrop for turn ${LAND_TURN}`);
  }

  const staticCrates = map.crates.map((crate) => ({
    id: crateId(crate),
    pos: { x: crate.x, y: crate.y },
    opened: false,
  }));

  const airdrops = map.airdrops.map((drop) => ({
    id: crateId(drop),
    pos: { x: drop.x, y: drop.y },
    landsAtTurn: drop.landsAtTurn,
    looted: false,
  }));
  const firstDrop = airdrops.find((drop) => drop.landsAtTurn === LAND_TURN);

  const characters = PERSONAS.map((personaId, spawnIndex) => {
    const spawn = map.spawns[spawnIndex];
    return {
      characterId: `char_${personaId}`,
      personaId,
      displayName: titleCase(personaId),
      spawnIndex,
      spawn: { x: spawn.x, y: spawn.y },
    };
  });
  const positionFor = buildCharacterPositions(map, characters, firstDrop);

  const turnFrameTimes = {
    1: 0,
    2: 3,
    3: 6,
    4: 9,
    5: 12,
    6: 15,
    7: 18,
    8: 21,
    9: 24,
    10: 27,
    11: 28.5,
    12: 30,
  };

  const frames = [];
  for (let turn = START_TURN; turn <= END_TURN; turn += 1) {
    const frameCharacters = characters.map((character) =>
      makeCharacterFrame(character, positionFor(character, turn), turn),
    );
    frames.push({
      turn,
      timeSeconds: turnFrameTimes[turn],
      snapshot: makeSnapshot({
        turn,
        characters: frameCharacters,
        corpses: corpseFramesForTurn(turn),
        crates: staticCrates,
        airdrops,
      }),
      resolution: makeResolution({ turn, characters, positionFor }),
    });
  }

  const evacZone = {
    x: map.evac.x - 1,
    y: map.evac.y - 1,
    w: 3,
    h: 3,
  };

  const duelEvent = {
    kind: "duel",
    startTurn: DUEL_START_TURN,
    exchangeTurn: DUEL_EXCHANGE_TURN,
    killTurn: DUEL_KILL_TURN,
    endTurn: DUEL_KILL_TURN,
    participantIds: [DUEL_KILLER_ID, DUEL_VICTIM_ID],
    killerId: DUEL_KILLER_ID,
    killerDisplayName: "Sprinter",
    victimId: DUEL_VICTIM_ID,
    victimDisplayName: "Vulture",
    corpseTile: { ...DUEL_CORPSE_TILE },
    killFeedLine: "Sprinter killed Vulture in a brutal duel",
    traceContract: {
      deaths: [DUEL_VICTIM_ID],
      environmentalDeaths: [],
      corpseCreated: true,
    },
  };

  const airdropTelefragEvent = {
    kind: "airdrop-telefrag",
    airdropId: firstDrop.id,
    landTurn: LAND_TURN,
    victimId: "char_sprinter",
    victimDisplayName: "Sprinter",
    landingTile: firstDrop.pos,
    stagingTile: { x: firstDrop.pos.x - 1, y: firstDrop.pos.y },
    killFeedLine: "Sprinter got telefragged by crate spawn",
    traceContract: {
      deaths: [],
      environmentalDeaths: ["char_sprinter"],
      corpseCreated: false,
    },
  };

  const fixture = {
    schemaVersion: 1,
    fixtureId: "prototype-2-reference-duel-airdrop-telefrag",
    contract: {
      snapshotType: "apps/replay/src/lib/reconstruct.ts#EntitySnapshot",
      notes: [
        "Each timeline.frames[].snapshot object follows the EntitySnapshot shape.",
        "Equipment and HP are null because reconstruct.ts treats them as non-derivable from the turn ledger.",
        "The duel victim is listed in resolution.deaths and creates a corpse in snapshot.corpses.",
        "Telefrag victims are listed in resolution.environmentalDeaths, not resolution.deaths, and do not create corpses.",
        "highlightedEvent remains the legacy airdrop telefrag object; highlightedEvents is the additive event list.",
      ],
    },
    source: {
      mapId: "reference",
      mapPath: "maps/reference.json",
      semantics: [
        "Airdrop projection uses the engine/reconstruct lifecycle: pre, telegraphed, landed, spent.",
        "The first drop uses the reference-map landing tile and landsAtTurn.",
        "Sprinter and Vulture use fixed walkable reference-map tiles for a canned ordinary-death duel.",
        "Sprinter survives the duel, walks to the west-adjacent staging tile, then steps onto the airdrop landing tile on turn 10.",
      ],
    },
    playback: {
      sliceDurationSeconds: SLICE_DURATION_SECONDS,
      startTurn: START_TURN,
      endTurn: END_TURN,
      fpsHint: 60,
      eventTimesSeconds: {
        duelStarts: 3,
        duelFirstClash: 6,
        duelKillingBlow: 9,
        duelCorpseReadable: 9.2,
        survivorHeadsToDrop: 12,
        telegraphBegins: 18,
        victimStartsFinalStep: 26.1,
        airdropImpact: 27,
        redMistPeak: 27.15,
        landedCrateReadable: 28.5,
      },
    },
    map: {
      size: map.size,
      walls: map.walls,
      coverClusters: map.coverClusters,
      coverTileCount: map.coverClusters.reduce(
        (sum, cluster) => sum + expandRectTiles(cluster).length,
        0,
      ),
      evac: {
        centre: map.evac,
        zone: evacZone,
        revealedAtTurn: 30,
      },
      staticCrates: map.crates.map((crate) => ({
        id: crateId(crate),
        pos: { x: crate.x, y: crate.y },
        contents: crate.contents,
      })),
      airdrops: map.airdrops.map((drop) => ({
        id: crateId(drop),
        pos: { x: drop.x, y: drop.y },
        landsAtTurn: drop.landsAtTurn,
        contents: drop.contents,
      })),
    },
    characters,
    highlightedEvent: airdropTelefragEvent,
    highlightedEvents: [duelEvent, airdropTelefragEvent],
    timeline: {
      frames,
    },
  };

  await writeFile(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
