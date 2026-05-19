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

const START_TURN = 7;
const END_TURN = 12;
const LAND_TURN = 10;
const SLICE_DURATION_SECONDS = 16;

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

function stepToward(from, to, maxDist) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist <= maxDist) return { x: to.x, y: to.y };
  return {
    x: from.x + Math.sign(dx) * Math.min(Math.abs(dx), maxDist),
    y: from.y + Math.sign(dy) * Math.min(Math.abs(dy), maxDist),
  };
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

function makeSnapshot({ turn, characters, crates, airdrops }) {
  return {
    turn,
    characters,
    corpses: [],
    crates,
    airdrops: airdrops.map((drop) => projectAirdrop(drop, turn)),
    evacRevealed: false,
  };
}

function makeCharacterFrame(character, pos, turn) {
  const dead = character.characterId === "char_sprinter" && turn >= LAND_TURN;
  return {
    characterId: character.characterId,
    personaId: character.personaId,
    displayName: character.displayName,
    pos,
    alive: !dead,
    hidden: false,
    diedAtTurn: dead ? LAND_TURN : null,
    extractedAtTurn: null,
    equipped: null,
    hp: null,
  };
}

function buildCharacterPositions(map, characters, drop) {
  const sprinter = characters.find((c) => c.personaId === "sprinter");
  if (!sprinter) throw new Error("Missing sprinter character");

  const sprinterSpawn = map.spawns[sprinter.spawnIndex];
  const sprinterStaging = { x: drop.pos.x - 1, y: drop.pos.y };
  assertWalkable(map, sprinterSpawn, "Sprinter spawn");
  assertWalkable(map, sprinterStaging, "Sprinter staging tile");
  assertWalkable(map, drop.pos, "Airdrop landing tile");

  let sprinterPos = sprinterSpawn;
  const positionsByTurn = new Map();
  for (let turn = 0; turn <= END_TURN; turn += 1) {
    if (turn >= START_TURN && turn < LAND_TURN) {
      sprinterPos = stepToward(sprinterPos, sprinterStaging, 8);
    } else if (turn === LAND_TURN) {
      sprinterPos = stepToward(sprinterPos, drop.pos, 8);
    }
    positionsByTurn.set(turn, { x: sprinterPos.x, y: sprinterPos.y });
  }

  const duelistObserver = { x: drop.pos.x - 5, y: drop.pos.y };
  assertWalkable(map, duelistObserver, "Duelist observer tile");

  return function positionFor(character, turn) {
    if (character.personaId === "sprinter") return positionsByTurn.get(turn);
    if (character.personaId === "duelist" && turn >= 9) return duelistObserver;
    return map.spawns[character.spawnIndex];
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
    7: 0,
    8: 3,
    9: 6,
    10: 11,
    11: 13.5,
    12: 16,
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
        crates: staticCrates,
        airdrops,
      }),
      resolution:
        turn === LAND_TURN
          ? {
              turn,
              moves: [
                {
                  characterId: "char_sprinter",
                  from: { x: firstDrop.pos.x - 1, y: firstDrop.pos.y },
                  to: { ...firstDrop.pos },
                },
              ],
              actions: [],
              deaths: [],
              environmentalDeaths: ["char_sprinter"],
              visibilityUpdates: [],
            }
          : {
              turn,
              moves: [],
              actions: [],
              deaths: [],
              environmentalDeaths: [],
              visibilityUpdates: [],
            },
    });
  }

  const evacZone = {
    x: map.evac.x - 1,
    y: map.evac.y - 1,
    w: 3,
    h: 3,
  };

  const fixture = {
    schemaVersion: 1,
    fixtureId: "prototype-1-reference-airdrop-telefrag",
    contract: {
      snapshotType: "apps/replay/src/lib/reconstruct.ts#EntitySnapshot",
      notes: [
        "Each timeline.frames[].snapshot object follows the EntitySnapshot shape.",
        "Equipment and HP are null because reconstruct.ts treats them as non-derivable from the turn ledger.",
        "Telefrag victims are listed in resolution.environmentalDeaths, not resolution.deaths, and do not create corpses.",
      ],
    },
    source: {
      mapId: "reference",
      mapPath: "maps/reference.json",
      semantics: [
        "Airdrop projection uses the engine/reconstruct lifecycle: pre, telegraphed, landed, spent.",
        "The first drop uses the reference-map landing tile and landsAtTurn.",
        "Sprinter's path is generated from reference-map spawn index 6 to the west-adjacent staging tile, then onto the landing tile on turn 10.",
      ],
    },
    playback: {
      sliceDurationSeconds: SLICE_DURATION_SECONDS,
      startTurn: START_TURN,
      endTurn: END_TURN,
      fpsHint: 60,
      eventTimesSeconds: {
        telegraphBegins: 0,
        victimStartsFinalStep: 9.6,
        airdropImpact: 11,
        redMistPeak: 11.15,
        landedCrateReadable: 13.5,
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
    highlightedEvent: {
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
    },
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
