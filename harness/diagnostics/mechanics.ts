import type { CountMap, DrilldownExample, SlimTurnRow } from "./types.js";
import {
  actualMoveDistance,
  increment,
  isCrateTarget,
  isCorpseTarget,
  isDamageResult,
  isHealAtFullHp,
  pushExample,
  rate,
  sortedCountMap,
} from "./helpers.js";

export type MechanicsDiagnostics = {
  attackOutcomes: CountMap;
  overwatch: {
    movementTriggered: number;
    defensive: number;
  };
  counter: {
    fired: number;
    primedWithoutIncomingAttack: number;
  };
  loot: {
    crate: {
      seen: number;
      lootActions: number;
      opened: number;
      equipped: number;
      empty: number;
      sameTurnCollision: number;
    };
    corpse: {
      seen: number;
      lootActions: number;
      looted: number;
      drainedRepeat: number;
      noCorpse: number;
    };
  };
  airdrop: {
    telegraphedSeen: number;
    landedSeen: number;
    lootedSpent: number;
    telefrags: number;
  };
  consume: {
    byItem: CountMap;
    wastedSpeedWithoutMovement: number;
    healAtFullHp: number;
  };
  speech: {
    events: number;
    meanTextLength: number;
    heardFanout: number;
    meanHeardFanout: number;
    inboundDelivered: number;
  };
  damageFeedAudit: {
    incoming: number;
    outgoing: number;
    dealtKills: number;
  };
  deaths: number;
  environmentalDeaths: number;
  wallBlockedMoves: number;
  movement: {
    declaredVsActual: {
      compared: number;
      exact: number;
      capped: number;
      overMoved: number;
      examples: Array<
        DrilldownExample & {
          declared: number;
          actual: number;
        }
      >;
    };
  };
};

export function computeMechanicsDiagnostics(
  rows: SlimTurnRow[],
): MechanicsDiagnostics {
  const attackOutcomes: CountMap = {};
  let overwatchMovementTriggered = 0;
  let overwatchDefensive = 0;
  let counterFired = 0;
  let counterPrimedWithoutIncomingAttack = 0;
  let crateSeen = 0;
  let crateLootActions = 0;
  let crateOpened = 0;
  let crateEquipped = 0;
  let crateEmpty = 0;
  let crateSameTurnCollision = 0;
  let airdropTelegraphedSeen = 0;
  let airdropLandedSeen = 0;
  let airdropLootedSpent = 0;
  const airdropIdsByMatch = new Map<string, Set<string>>();
  let corpseSeen = 0;
  let corpseLootActions = 0;
  let corpseLooted = 0;
  let corpseDrainedRepeat = 0;
  let corpseNoCorpse = 0;
  const consumeByItem: CountMap = {};
  let wastedSpeedWithoutMovement = 0;
  let healAtFullHp = 0;
  let speechEvents = 0;
  let speechTextLength = 0;
  let heardFanout = 0;
  let inboundDelivered = 0;
  let incomingDamageFeed = 0;
  let outgoingDamageFeed = 0;
  let dealtKills = 0;
  let deaths = 0;
  let environmentalDeaths = 0;
  let wallBlockedMoves = 0;
  let movementCompared = 0;
  let movementExact = 0;
  let movementCapped = 0;
  let movementOverMoved = 0;
  const movementExamples: MechanicsDiagnostics["movement"]["declaredVsActual"]["examples"] =
    [];

  for (const turn of rows) {
    deaths += turn.resolution.deaths.length;
    environmentalDeaths += turn.resolution.environmentalDeaths?.length ?? 0;
    const movesByCharacter = new Map(
      turn.resolution.moves.map((move) => [move.characterId, move]),
    );
    const counterFires = new Set<string>();
    const airdropIds = airdropIdsForMatch(airdropIdsByMatch, turn.matchId);

    for (const record of turn.agentRecords) {
      for (const id of record.airdropVision?.telegraphedIds ?? []) {
        airdropIds.add(id);
      }
      for (const id of record.airdropVision?.landedIds ?? []) {
        airdropIds.add(id);
      }
    }

    for (const move of turn.resolution.moves) {
      if (move.blockedBy === "wall") wallBlockedMoves += 1;
    }

    for (const action of turn.resolution.actions) {
      if (action.kind === "attack") {
        increment(attackOutcomes, attackOutcomeBucket(action.result));
      } else if (action.kind === "overwatch") {
        if (action.triggeredByMovement === true) overwatchMovementTriggered += 1;
        else overwatchDefensive += 1;
      } else if (action.kind === "counter") {
        if (isDamageResult(action.result)) {
          counterFired += 1;
          counterFires.add(action.characterId);
        }
      } else if (
        action.kind === "loot" &&
        action.result === "opened" &&
        airdropIds.has(action.target)
      ) {
        airdropLootedSpent += 1;
      }
    }

    for (const consumed of turn.resolution.consumed) {
      increment(consumeByItem, consumed.item.name);
      const actual = movesByCharacter.get(consumed.characterId);
      if (
        consumed.item.name === "speed" &&
        (actual === undefined || actualMoveDistance(actual) === 0)
      ) {
        wastedSpeedWithoutMovement += 1;
      }
    }

    for (const speech of turn.resolution.speech) {
      speechEvents += 1;
      speechTextLength += speech.text.length;
      heardFanout += speech.heardBy.length;
    }

    for (const record of turn.agentRecords) {
      crateSeen += record.visibleSummary.crates;
      corpseSeen += record.visibleSummary.corpses;
      airdropTelegraphedSeen += record.airdropVision?.telegraphed ?? 0;
      airdropLandedSeen += record.airdropVision?.landed ?? 0;
      inboundDelivered += record.inboundSpeechCount;
      incomingDamageFeed += record.damageFeedAudit.incoming;
      outgoingDamageFeed += record.damageFeedAudit.outgoing;
      dealtKills += record.damageFeedAudit.dealtKills;
      if (isHealAtFullHp(record)) healAtFullHp += 1;

      if (
        record.decision.position.kind === "counter" &&
        !counterFires.has(record.characterId) &&
        record.damageFeedAudit.incoming === 0
      ) {
        counterPrimedWithoutIncomingAttack += 1;
      }

      if (record.decision.position.kind === "move") {
        const move = movesByCharacter.get(record.characterId);
        if (move !== undefined) {
          const actual = actualMoveDistance(move);
          const declared = record.decision.position.dist;
          movementCompared += 1;
          if (actual === declared) movementExact += 1;
          else if (actual < declared) {
            movementCapped += 1;
            if (movementExamples.length < 5) {
              movementExamples.push({
                ...pushableExample(turn, record),
                declared,
                actual,
              });
            }
          } else movementOverMoved += 1;
        }
      }

      if (record.decision.action.kind === "loot") {
        const target = record.decision.action.targetId;
        if (isCrateTarget(target)) crateLootActions += 1;
        else if (isCorpseTarget(target)) corpseLootActions += 1;
      }

      for (const outcome of record.lootOutcomeFeed) {
        const target = outcome.target ?? "";
        if (isCrateTarget(target)) {
          if (outcome.result === "opened") {
            crateOpened += 1;
            // Only count as equipped when the item was actually adopted
            // (not discarded as a weaker downgrade).
            if (outcome.item !== undefined && outcome.discardedWeaker !== true) {
              crateEquipped += 1;
            }
          } else if (outcome.result === "empty") crateEmpty += 1;
          else if (outcome.result === "already_opened") {
            crateSameTurnCollision += 1;
          }
        } else if (isCorpseTarget(target)) {
          if (outcome.result === "looted") corpseLooted += 1;
          else if (outcome.result === "no_corpse") corpseNoCorpse += 1;
          else if (
            outcome.result === "empty" ||
            outcome.result === "already_opened"
          ) {
            corpseDrainedRepeat += 1;
          }
        }
      }

    }
  }

  return {
    attackOutcomes: sortedCountMap(attackOutcomes),
    overwatch: {
      movementTriggered: overwatchMovementTriggered,
      defensive: overwatchDefensive,
    },
    counter: {
      fired: counterFired,
      primedWithoutIncomingAttack: counterPrimedWithoutIncomingAttack,
    },
    loot: {
      crate: {
        seen: crateSeen,
        lootActions: crateLootActions,
        opened: crateOpened,
        equipped: crateEquipped,
        empty: crateEmpty,
        sameTurnCollision: crateSameTurnCollision,
      },
      corpse: {
        seen: corpseSeen,
        lootActions: corpseLootActions,
        looted: corpseLooted,
        drainedRepeat: corpseDrainedRepeat,
        noCorpse: corpseNoCorpse,
      },
    },
    airdrop: {
      telegraphedSeen: airdropTelegraphedSeen,
      landedSeen: airdropLandedSeen,
      lootedSpent: airdropLootedSpent,
      telefrags: environmentalDeaths,
    },
    consume: {
      byItem: sortedCountMap(consumeByItem),
      wastedSpeedWithoutMovement,
      healAtFullHp,
    },
    speech: {
      events: speechEvents,
      meanTextLength: rate(speechTextLength, speechEvents),
      heardFanout,
      meanHeardFanout: rate(heardFanout, speechEvents),
      inboundDelivered,
    },
    damageFeedAudit: {
      incoming: incomingDamageFeed,
      outgoing: outgoingDamageFeed,
      dealtKills,
    },
    deaths,
    environmentalDeaths,
    wallBlockedMoves,
    movement: {
      declaredVsActual: {
        compared: movementCompared,
        exact: movementExact,
        capped: movementCapped,
        overMoved: movementOverMoved,
        examples: movementExamples,
      },
    },
  };
}

function airdropIdsForMatch(
  byMatch: Map<string, Set<string>>,
  matchId: string,
): Set<string> {
  const existing = byMatch.get(matchId);
  if (existing) return existing;
  const created = new Set<string>();
  byMatch.set(matchId, created);
  return created;
}

function attackOutcomeBucket(result: string): string {
  if (isDamageResult(result)) return "landed";
  if (result === "missed") return "missed";
  if (result === "out_of_range") return "out_of_range";
  if (result === "blocked_by_cover" || result.includes("cover")) {
    return "blocked_by_cover";
  }
  if (result === "no_target") return "no_target";
  return "other";
}

function pushableExample(
  turn: SlimTurnRow,
  record: SlimTurnRow["agentRecords"][number],
): DrilldownExample {
  const examples: DrilldownExample[] = [];
  pushExample(examples, turn, record, 1);
  const example = examples[0];
  if (example === undefined) {
    throw new Error("failed to create drilldown example");
  }
  return example;
}
