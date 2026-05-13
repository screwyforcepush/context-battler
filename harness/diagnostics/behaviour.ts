import type {
  CountMap,
  DrilldownExample,
  SlimAgentRecord,
  SlimTurnRow,
} from "./types.js";
import {
  decisionConsumedItem,
  increment,
  isArmedStancePause,
  isHealAtFullHp,
  isMoveDecision,
  isTrueStationary,
  pushExample,
  rate,
  sortedCountMap,
  turnPhase,
  type TurnPhase,
} from "./helpers.js";

export type ComboDiagnostics = {
  count: number;
  examples: DrilldownExample[];
};

export type BehaviourDiagnostics = {
  totalRecords: number;
  phaseDistribution: Record<TurnPhase, number>;
  useByPersona: Record<string, CountMap>;
  positionByPersonaPhase: Record<string, Record<TurnPhase, CountMap>>;
  actionByPersonaPhase: Record<string, Record<TurnPhase, CountMap>>;
  sayRateByPersona: Record<
    string,
    { total: number; said: number; rate: number }
  >;
  scratchpadChurnByPersona: Record<
    string,
    { total: number; changed: number; rate: number }
  >;
  directionKindByPersona: Record<string, CountMap>;
  distHistogramByDirectionKind: Record<string, CountMap>;
  contextualCombos: Record<string, ComboDiagnostics>;
  crossCuts: {
    persona: Record<
      string,
      {
        total: number;
        phase: CountMap;
        visibility: {
          enemyVisible: number;
          enemyNotVisible: number;
          damagedLastTurn: number;
        };
      }
    >;
    turnPhase: CountMap;
    visibility: CountMap;
    equipment: CountMap;
  };
  sawEnemyAndNoOp: {
    armedStancePause: number;
    trueStationary: number;
    total: number;
  };
  noOpSplit: {
    armedStancePauseCount: number;
    armedStancePauseRate: number;
    trueStationaryCount: number;
    trueStationaryRate: number;
  };
};

const PHASES: TurnPhase[] = ["pre_evac", "evac_revealed", "final"];
const COMBO_KEYS = [
  "move+attack",
  "move+loot",
  "overwatch+attack",
  "counter+attack",
  "overwatch+loot",
  "counter+loot",
  "move:dist=0+action!=none",
  "overwatch/counter+say",
  "move+consume:speed",
  "non-move+consume:speed",
  "consume:heal at full HP",
  "say+action:attack same target",
  "move:toward X+action:attack Y",
  "move:toward X+action:loot X",
  "move:away X+say",
] as const;

export function computeBehaviourDiagnostics(
  rows: SlimTurnRow[],
): BehaviourDiagnostics {
  let totalRecords = 0;
  let armedStancePauseCount = 0;
  let trueStationaryCount = 0;
  let sawEnemyArmedPause = 0;
  let sawEnemyTrueStationary = 0;
  const phaseDistribution = emptyPhaseCounts();
  const useByPersona: Record<string, CountMap> = {};
  const positionByPersonaPhase: Record<string, Record<TurnPhase, CountMap>> = {};
  const actionByPersonaPhase: Record<string, Record<TurnPhase, CountMap>> = {};
  const sayRateByPersona: Record<
    string,
    { total: number; said: number; rate: number }
  > = {};
  const scratchpadChurnByPersona: Record<
    string,
    { total: number; changed: number; rate: number }
  > = {};
  const directionKindByPersona: Record<string, CountMap> = {};
  const distHistogramByDirectionKind: Record<string, CountMap> = {};
  const contextualCombos = emptyCombos();
  const crossCuts: BehaviourDiagnostics["crossCuts"] = {
    persona: {},
    turnPhase: {},
    visibility: {},
    equipment: {},
  };

  for (const turn of rows) {
    const phase = turnPhase(turn.turn);
    phaseDistribution[phase] += turn.agentRecords.length;
    increment(crossCuts.turnPhase, phase, turn.agentRecords.length);

    for (const record of turn.agentRecords) {
      totalRecords += 1;
      ensurePersona(record.personaId, {
        useByPersona,
        positionByPersonaPhase,
        actionByPersonaPhase,
        sayRateByPersona,
        scratchpadChurnByPersona,
        directionKindByPersona,
        crossCuts,
      });
      const personaUse = useByPersona[record.personaId] ?? {};
      useByPersona[record.personaId] = personaUse;
      const personaPositionPhases =
        positionByPersonaPhase[record.personaId] ?? emptyPhaseMaps();
      positionByPersonaPhase[record.personaId] = personaPositionPhases;
      const personaActionPhases =
        actionByPersonaPhase[record.personaId] ?? emptyPhaseMaps();
      actionByPersonaPhase[record.personaId] = personaActionPhases;
      const sayRate = sayRateByPersona[record.personaId] ?? {
        total: 0,
        said: 0,
        rate: 0,
      };
      sayRateByPersona[record.personaId] = sayRate;
      const scratchpadChurn = scratchpadChurnByPersona[record.personaId] ?? {
        total: 0,
        changed: 0,
        rate: 0,
      };
      scratchpadChurnByPersona[record.personaId] = scratchpadChurn;
      const directionKinds = directionKindByPersona[record.personaId] ?? {};
      directionKindByPersona[record.personaId] = directionKinds;
      const personaCut = crossCuts.persona[record.personaId] ?? {
        total: 0,
        phase: {},
        visibility: {
          enemyVisible: 0,
          enemyNotVisible: 0,
          damagedLastTurn: 0,
        },
      };
      crossCuts.persona[record.personaId] = personaCut;

      increment(
        personaUse,
        record.decision.use === null ? "null" : record.decision.use,
      );
      increment(
        personaPositionPhases[phase],
        record.decision.position.kind,
      );
      increment(
        personaActionPhases[phase],
        record.decision.action.kind,
      );

      sayRate.total += 1;
      if (record.decision.say !== null && record.decision.say.trim() !== "") {
        sayRate.said += 1;
      }

      scratchpadChurn.total += 1;
      if (record.scratchpadChanged) {
        scratchpadChurn.changed += 1;
      }

      if (isMoveDecision(record.decision)) {
        const directionKind = record.decision.position.direction.kind;
        increment(directionKinds, directionKind);
        const distHistogram = distHistogramByDirectionKind[directionKind] ?? {};
        distHistogramByDirectionKind[directionKind] = distHistogram;
        increment(
          distHistogram,
          String(record.decision.position.dist),
        );
      }

      personaCut.total += 1;
      increment(personaCut.phase, phase);
      if (record.visibleSummary.enemies > 0) {
        personaCut.visibility.enemyVisible += 1;
        increment(crossCuts.visibility, "enemyVisible");
      } else {
        personaCut.visibility.enemyNotVisible += 1;
        increment(crossCuts.visibility, "enemyNotVisible");
      }
      if (record.damageFeedAudit.incoming > 0) {
        personaCut.visibility.damagedLastTurn += 1;
        increment(crossCuts.visibility, "damagedLastTurn");
      }
      increment(crossCuts.equipment, equipmentKey(record));

      const armedPause = isArmedStancePause(record.decision);
      const trueStationary = isTrueStationary(record.decision);
      if (armedPause) armedStancePauseCount += 1;
      if (trueStationary) trueStationaryCount += 1;
      if (record.visibleSummary.enemies > 0 && armedPause) sawEnemyArmedPause += 1;
      if (record.visibleSummary.enemies > 0 && trueStationary) {
        sawEnemyTrueStationary += 1;
      }

      for (const combo of comboKeysForRecord(turn, record)) {
        const comboData = contextualCombos[combo];
        if (comboData === undefined) continue;
        comboData.count += 1;
        pushExample(comboData.examples, turn, record);
      }
    }
  }

  for (const persona of Object.keys(sayRateByPersona)) {
    const row = sayRateByPersona[persona];
    if (row === undefined) continue;
    row.rate = rate(row.said, row.total);
  }
  for (const persona of Object.keys(scratchpadChurnByPersona)) {
    const row = scratchpadChurnByPersona[persona];
    if (row === undefined) continue;
    row.rate = rate(row.changed, row.total);
  }

  return {
    totalRecords,
    phaseDistribution,
    useByPersona: sortNested(useByPersona),
    positionByPersonaPhase: sortPhaseNested(positionByPersonaPhase),
    actionByPersonaPhase: sortPhaseNested(actionByPersonaPhase),
    sayRateByPersona,
    scratchpadChurnByPersona,
    directionKindByPersona: sortNested(directionKindByPersona),
    distHistogramByDirectionKind: sortNested(distHistogramByDirectionKind),
    contextualCombos,
    crossCuts: {
      persona: crossCuts.persona,
      turnPhase: sortedCountMap(crossCuts.turnPhase),
      visibility: sortedCountMap(crossCuts.visibility),
      equipment: sortedCountMap(crossCuts.equipment),
    },
    sawEnemyAndNoOp: {
      armedStancePause: sawEnemyArmedPause,
      trueStationary: sawEnemyTrueStationary,
      total: sawEnemyArmedPause + sawEnemyTrueStationary,
    },
    noOpSplit: {
      armedStancePauseCount,
      armedStancePauseRate: rate(armedStancePauseCount, totalRecords),
      trueStationaryCount,
      trueStationaryRate: rate(trueStationaryCount, totalRecords),
    },
  };
}

function ensurePersona(
  persona: string,
  stores: {
    useByPersona: Record<string, CountMap>;
    positionByPersonaPhase: Record<string, Record<TurnPhase, CountMap>>;
    actionByPersonaPhase: Record<string, Record<TurnPhase, CountMap>>;
    sayRateByPersona: Record<
      string,
      { total: number; said: number; rate: number }
    >;
    scratchpadChurnByPersona: Record<
      string,
      { total: number; changed: number; rate: number }
    >;
    directionKindByPersona: Record<string, CountMap>;
    crossCuts: BehaviourDiagnostics["crossCuts"];
  },
): void {
  stores.useByPersona[persona] ??= {};
  stores.positionByPersonaPhase[persona] ??= emptyPhaseMaps();
  stores.actionByPersonaPhase[persona] ??= emptyPhaseMaps();
  stores.sayRateByPersona[persona] ??= { total: 0, said: 0, rate: 0 };
  stores.scratchpadChurnByPersona[persona] ??= {
    total: 0,
    changed: 0,
    rate: 0,
  };
  stores.directionKindByPersona[persona] ??= {};
  stores.crossCuts.persona[persona] ??= {
    total: 0,
    phase: {},
    visibility: {
      enemyVisible: 0,
      enemyNotVisible: 0,
      damagedLastTurn: 0,
    },
  };
}

function emptyPhaseCounts(): Record<TurnPhase, number> {
  return { pre_evac: 0, evac_revealed: 0, final: 0 };
}

function emptyPhaseMaps(): Record<TurnPhase, CountMap> {
  return { pre_evac: {}, evac_revealed: {}, final: {} };
}

function emptyCombos(): Record<string, ComboDiagnostics> {
  return Object.fromEntries(
    COMBO_KEYS.map((key) => [key, { count: 0, examples: [] }]),
  );
}

function comboKeysForRecord(
  turn: SlimTurnRow,
  record: SlimAgentRecord,
): string[] {
  const keys: string[] = [];
  const decision = record.decision;
  const action = decision.action;
  const position = decision.position;
  const consumedItem = decisionConsumedItem(turn, record);

  if (position.kind === "move" && action.kind === "attack") {
    keys.push("move+attack");
  }
  if (position.kind === "move" && action.kind === "loot") {
    keys.push("move+loot");
  }
  if (position.kind === "overwatch" && action.kind === "attack") {
    keys.push("overwatch+attack");
  }
  if (position.kind === "counter" && action.kind === "attack") {
    keys.push("counter+attack");
  }
  if (position.kind === "overwatch" && action.kind === "loot") {
    keys.push("overwatch+loot");
  }
  if (position.kind === "counter" && action.kind === "loot") {
    keys.push("counter+loot");
  }
  if (position.kind === "move" && position.dist === 0 && action.kind !== "none") {
    keys.push("move:dist=0+action!=none");
  }
  if (
    (position.kind === "overwatch" || position.kind === "counter") &&
    decision.say !== null &&
    decision.say.trim() !== ""
  ) {
    keys.push("overwatch/counter+say");
  }
  if (consumedItem === "speed" && position.kind === "move") {
    keys.push("move+consume:speed");
  }
  if (consumedItem === "speed" && position.kind !== "move") {
    keys.push("non-move+consume:speed");
  }
  if (isHealAtFullHp(record)) {
    keys.push("consume:heal at full HP");
  }
  if (
    action.kind === "attack" &&
    decision.say !== null &&
    decision.say.toLowerCase().includes(action.targetId.toLowerCase())
  ) {
    keys.push("say+action:attack same target");
  }
  if (
    position.kind === "move" &&
    position.direction.kind === "toward" &&
    action.kind === "attack" &&
    position.direction.targetId !== action.targetId
  ) {
    keys.push("move:toward X+action:attack Y");
  }
  if (
    position.kind === "move" &&
    position.direction.kind === "toward" &&
    action.kind === "loot" &&
    position.direction.targetId === action.targetId
  ) {
    keys.push("move:toward X+action:loot X");
  }
  if (
    position.kind === "move" &&
    position.direction.kind === "away" &&
    decision.say !== null &&
    decision.say.trim() !== ""
  ) {
    keys.push("move:away X+say");
  }

  return keys;
}

function equipmentKey(record: SlimAgentRecord): string {
  const weapon = record.selfEquipment.weapon === null ? "unarmed" : "armed";
  const armour = record.selfEquipment.armour ?? "no_armour";
  const consumable = consumableKey(record.selfEquipment.consumable);
  return `${weapon}|${armour}|${consumable}`;
}

function consumableKey(consumable: SlimAgentRecord["selfEquipment"]["consumable"]): string {
  if (consumable === undefined) return "consumable:unknown";
  if (consumable === null) return "consumable:none";
  return `consumable:${consumable}`;
}

function sortNested<T extends Record<string, CountMap>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, sortedCountMap(value)]),
  ) as T;
}

function sortPhaseNested(
  input: Record<string, Record<TurnPhase, CountMap>>,
): Record<string, Record<TurnPhase, CountMap>> {
  return Object.fromEntries(
    Object.entries(input).map(([persona, phases]) => [
      persona,
      Object.fromEntries(
        PHASES.map((phase) => [phase, sortedCountMap(phases[phase])]),
      ) as Record<TurnPhase, CountMap>,
    ]),
  );
}
