type VisibleSummary = {
  enemies: number;
  chests: number;
  corpses: number;
  evacSeen: boolean;
};

type SelfEquipment = {
  weapon: string | null;
  armour: string | null;
  consumable: string | null;
};

type SelfHp = {
  hp: number;
  maxHp: number;
};

type DamageFeedAudit = {
  incoming: number;
  outgoing: number;
  dealtKills: number;
  expectedIncoming: number;
  missingIncoming: number;
  expectedOutgoing: number;
  missingOutgoing: number;
  expectedDealtKills: number;
  missingDealtKills: number;
};

type AgentInputLike = {
  systemPromptHash: string;
  systemPromptText?: string;
  personaPromptHash: string;
  personaPromptText?: string;
  visibleStateDigest: string;
  scratchpadBefore: string;
  composedUserMessage?: string;
  useVariant?: "consumable_or_null" | "null_only";
};

type AgentLlmLike = {
  responseId: string | null;
  callId: string | null;
  rawArguments?: string | null;
  usage: unknown;
  latencyMs: number;
  httpStatus: number | null;
  fellBackToSafeDefault: boolean;
  failureReason?: string;
  validatorFieldErrors?: Record<string, string>;
  httpBodyExcerpt?: string;
  reasoning?: string | null;
  retried?: unknown;
};

type AgentRecordLike = {
  characterId: string;
  personaId: string;
  input: AgentInputLike;
  decision: unknown;
  scratchpadAfter: string;
  llm: AgentLlmLike;
};

type ResolutionActionLike = {
  characterId: string;
  kind: string;
  target: string;
  result: string;
  triggeredByMovement?: boolean;
  weapon?: string;
  lootedItem?: unknown;
};

type ResolutionSpeechLike = {
  characterId: string;
  text: string;
  heardBy: readonly string[];
};

type ResolutionMoveLike = {
  characterId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  blockedBy?: "wall";
  slide?: {
    wallRectId: string;
    axis: "N" | "E" | "S" | "W";
    intent: string;
  };
};

type ResolutionLike = {
  actions: readonly ResolutionActionLike[];
  speech: readonly ResolutionSpeechLike[];
  moves: readonly ResolutionMoveLike[];
  deaths: readonly string[];
};

type TurnRowLike = {
  _id: unknown;
  matchId: unknown;
  turn: number;
  resolution: ResolutionLike;
  agentRecords: readonly AgentRecordLike[];
};

type DamageParticipant = {
  characterId: string;
  personaId?: string;
  displayName?: string;
};

type LootOutcomeResult =
  | "opened"
  | "looted"
  | "already_opened"
  | "empty"
  | "no_corpse";

type LootOutcome = {
  result: LootOutcomeResult;
  item?: string;
  target?: string;
  delivered?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVisibleObject(source: string): Record<string, unknown> | null {
  const trimmed = source.trim();
  if (trimmed.length === 0) return null;

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasPrefix(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix));
}

function isChestEntry(key: string, value: unknown): boolean {
  return (
    hasPrefix(key, ["Chest_", "chest_"]) ||
    (isRecord(value) && value.kind === "chest")
  );
}

function isCorpseEntry(key: string, value: unknown): boolean {
  return (
    key.startsWith("Corpse_") ||
    (isRecord(value) && value.kind === "corpse")
  );
}

function isEvacEntry(key: string, value: unknown): boolean {
  return (
    key === "Evac" ||
    key.startsWith("Evac_") ||
    (isRecord(value) && value.kind === "evac")
  );
}

function isTerrainEntry(key: string, value: unknown): boolean {
  return (
    hasPrefix(key, ["Cover_", "Wall_"]) ||
    (isRecord(value) && (value.kind === "cover" || value.kind === "wall"))
  );
}

function isEnemyEntry(key: string, value: unknown): boolean {
  if (
    isChestEntry(key, value) ||
    isCorpseEntry(key, value) ||
    isEvacEntry(key, value) ||
    isTerrainEntry(key, value)
  ) {
    return false;
  }
  return (
    isRecord(value) &&
    (value.kind === "character" ||
      "hp" in value ||
      "armed" in value ||
      "equipped" in value)
  );
}

function visibleRectKeys(source: string): string[] {
  const visible = parseVisibleObject(source);
  if (!visible) return [];
  return Object.keys(visible)
    .filter((key) => /^(Wall|Cover|Evac)_/.test(key));
}

function insideBearingHere(source: string): boolean {
  const visible = parseVisibleObject(source);
  if (!visible) return false;
  return Object.values(visible).some(
    (value) => isRecord(value) && value.dist === 0 && value.bearing === "here",
  );
}

function extractObserverPos(source: string): { x: number; y: number } | null {
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/📍\((-?\d+),(-?\d+)\)/);
    if (!match) continue;
    const x = Number.parseInt(match[1]!, 10);
    const y = Number.parseInt(match[2]!, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }
  return null;
}

export function summariseVisible(visibleStateDigest: string): VisibleSummary {
  const visible = parseVisibleObject(visibleStateDigest);
  if (!visible) {
    return { enemies: 0, chests: 0, corpses: 0, evacSeen: false };
  }

  let enemies = 0;
  let chests = 0;
  let corpses = 0;
  let evacSeen = false;

  for (const [key, value] of Object.entries(visible)) {
    if (isChestEntry(key, value)) chests += 1;
    else if (isCorpseEntry(key, value)) corpses += 1;
    else if (isEvacEntry(key, value)) evacSeen = true;
    else if (isEnemyEntry(key, value)) enemies += 1;
  }

  return { enemies, chests, corpses, evacSeen };
}

function slotValueFromLine(source: string, labels: readonly string[]): string | null {
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const lower = line.toLowerCase();
    const label = labels.find((candidate) => lower.includes(`${candidate}:`));
    if (!label) continue;
    const start = lower.indexOf(`${label}:`) + label.length + 1;
    const value = line.slice(start).replace(/\s*\[.*$/, "").trim();
    if (
      value.length === 0 ||
      value === "none" ||
      value === "unarmed" ||
      value === "null"
    ) {
      return null;
    }
    return value;
  }
  return null;
}

export function extractSelfEquipment(source: string): SelfEquipment {
  return {
    weapon: slotValueFromLine(source, ["weapon"]),
    armour: slotValueFromLine(source, ["armour", "armor"]),
    consumable: slotValueFromLine(source, ["consumable"]),
  };
}

export function extractSelfHp(source: string): SelfHp | null {
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/hp:\s*(\d+)\s*\/\s*(\d+)\s*hp/i);
    if (!match) continue;
    const hp = Number.parseInt(match[1]!, 10);
    const maxHp = Number.parseInt(match[2]!, 10);
    if (Number.isNaN(hp) || Number.isNaN(maxHp)) return null;
    return { hp, maxHp };
  }
  return null;
}

function personaToDisplayName(personaId: string | undefined): string | null {
  if (!personaId) return null;
  return personaId
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildTargetIdLookup(
  participants: readonly DamageParticipant[],
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const participant of participants) {
    lookup.set(participant.characterId, participant.characterId);
    if (participant.displayName) {
      lookup.set(participant.displayName, participant.characterId);
    }
    if (participant.personaId) {
      lookup.set(participant.personaId, participant.characterId);
      const displayName = personaToDisplayName(participant.personaId);
      if (displayName) lookup.set(displayName, participant.characterId);
    }
  }
  return lookup;
}

function displayNameForParticipant(
  characterId: string,
  participants: readonly DamageParticipant[],
): string {
  const participant = participants.find((entry) => entry.characterId === characterId);
  return (
    participant?.displayName ??
    personaToDisplayName(participant?.personaId) ??
    characterId
  );
}

function weaponName(weapon: string | undefined): string {
  return weapon && weapon.trim().length > 0 ? weapon : "bare hands";
}

function damageAmount(result: string): number | null {
  const match = result.match(/^dmg\s+(\d+)/i);
  if (!match) return null;
  const amount = Number.parseInt(match[1]!, 10);
  return Number.isNaN(amount) ? null : amount;
}

function quoteSpeech(text: string): string {
  return JSON.stringify(text.replace(/\s*\r?\n\s*/g, " ").trim());
}

function isDamageAction(action: ResolutionActionLike): boolean {
  return (
    (action.kind === "attack" ||
      action.kind === "overwatch" ||
      action.kind === "counter") &&
    /^dmg\s+\d+/i.test(action.result)
  );
}

function emptyDamageFeedAudit(): DamageFeedAudit {
  return {
    incoming: 0,
    outgoing: 0,
    dealtKills: 0,
    expectedIncoming: 0,
    missingIncoming: 0,
    expectedOutgoing: 0,
    missingOutgoing: 0,
    expectedDealtKills: 0,
    missingDealtKills: 0,
  };
}

// Same-turn damage involvement helper; projectSlimTurnRows uses cross-turn
// composed-message evidence for the delivery-facing damageFeedAudit field.
export function auditDamageFeed(
  resolution: Pick<ResolutionLike, "actions" | "deaths">,
  characterId: string,
  participants: readonly DamageParticipant[] = [],
): DamageFeedAudit {
  const targetIdLookup = buildTargetIdLookup(participants);
  const deathIds = new Set(resolution.deaths);
  const dealtKillIds = new Set<string>();
  let incoming = 0;
  let outgoing = 0;

  for (const action of resolution.actions) {
    if (!isDamageAction(action)) continue;
    const targetId = targetIdLookup.get(action.target) ?? action.target;
    if (action.characterId === characterId) {
      outgoing += 1;
      if (deathIds.has(targetId)) dealtKillIds.add(targetId);
    } else if (targetId === characterId) {
      incoming += 1;
    }
  }

  return {
    ...emptyDamageFeedAudit(),
    incoming,
    outgoing,
    dealtKills: dealtKillIds.size,
  };
}

export function countInboundSpeech(
  speech: readonly ResolutionSpeechLike[],
  characterId: string,
): number {
  return speech.filter(
    (entry) =>
      entry.characterId !== characterId && entry.heardBy.includes(characterId),
  ).length;
}

function isLootOutcomeResult(result: string): result is LootOutcomeResult {
  return (
    result === "opened" ||
    result === "looted" ||
    result === "already_opened" ||
    result === "empty" ||
    result === "no_corpse"
  );
}

function isLootOutcomeAction(
  action: ResolutionActionLike,
): action is ResolutionActionLike & { result: LootOutcomeResult } {
  return action.kind === "loot" && isLootOutcomeResult(action.result);
}

export function extractLootOutcomes(
  actions: readonly ResolutionActionLike[],
  characterId: string,
): LootOutcome[] {
  return actions
    .filter(
      (action): action is ResolutionActionLike & { result: LootOutcomeResult } =>
        action.characterId === characterId && isLootOutcomeAction(action),
    )
    .map((action) => {
      const base: LootOutcome = { result: action.result, target: action.target };
      if (
        (action.result === "opened" || action.result === "looted") &&
        typeof action.lootedItem === "string" &&
        action.lootedItem.trim().length > 0
      ) {
        return { ...base, item: action.lootedItem };
      }
      return base;
    });
}

type DeliverySignals = {
  damageFeedAudit: DamageFeedAudit;
  inboundSpeechCount: number;
  inboundSpeechExpected: number;
  inboundSpeechMissing: number;
  lootOutcomeFeed: LootOutcome[];
  lootOutcomeExpected: number;
  lootOutcomeMissing: number;
};

function emptyDeliverySignals(): DeliverySignals {
  return {
    damageFeedAudit: emptyDamageFeedAudit(),
    inboundSpeechCount: 0,
    inboundSpeechExpected: 0,
    inboundSpeechMissing: 0,
    lootOutcomeFeed: [],
    lootOutcomeExpected: 0,
    lootOutcomeMissing: 0,
  };
}

function cloneDeliverySignals(signal: DeliverySignals): DeliverySignals {
  return {
    damageFeedAudit: { ...signal.damageFeedAudit },
    inboundSpeechCount: signal.inboundSpeechCount,
    inboundSpeechExpected: signal.inboundSpeechExpected,
    inboundSpeechMissing: signal.inboundSpeechMissing,
    lootOutcomeFeed: signal.lootOutcomeFeed.map((entry) => ({ ...entry })),
    lootOutcomeExpected: signal.lootOutcomeExpected,
    lootOutcomeMissing: signal.lootOutcomeMissing,
  };
}

function participantsForRows(
  ...rows: Array<TurnRowLike | null | undefined>
): DamageParticipant[] {
  const byCharacter = new Map<string, DamageParticipant>();
  for (const row of rows) {
    for (const record of row?.agentRecords ?? []) {
      if (byCharacter.has(record.characterId)) continue;
      byCharacter.set(record.characterId, {
        characterId: record.characterId,
        personaId: record.personaId,
      });
    }
  }
  return [...byCharacter.values()];
}

function expectedLootFragment(action: ResolutionActionLike): string | null {
  if (!isLootOutcomeAction(action)) return null;
  if (
    action.result === "empty" ||
    action.result === "already_opened" ||
    action.result === "no_corpse"
  ) {
    return `looted nothing from empty ${action.target}`;
  }
  if (
    (action.result === "opened" || action.result === "looted") &&
    typeof action.lootedItem === "string" &&
    action.lootedItem.trim().length > 0
  ) {
    return `looted ${action.lootedItem} from ${action.target}`;
  }
  return action.result ? `looted ${action.target} (${action.result})` : `looted ${action.target}`;
}

function buildDeliverySignals(
  previousRow: TurnRowLike | null,
  currentRow: TurnRowLike,
): Map<string, DeliverySignals> {
  const signalsByCharacter = new Map<string, DeliverySignals>();
  const currentRecords = new Map(
    currentRow.agentRecords.map((record) => [record.characterId, record]),
  );

  for (const record of currentRow.agentRecords) {
    signalsByCharacter.set(record.characterId, emptyDeliverySignals());
  }

  if (!previousRow) return signalsByCharacter;

  const participants = participantsForRows(previousRow, currentRow);
  const targetIdLookup = buildTargetIdLookup(participants);
  const deaths = new Set(previousRow.resolution.deaths);

  for (const speech of previousRow.resolution.speech) {
    const speaker = displayNameForParticipant(speech.characterId, participants);
    const expectedLine = `${speaker} said ${quoteSpeech(speech.text)}`;
    for (const listenerId of speech.heardBy) {
      if (listenerId === speech.characterId) continue;
      const listenerRecord = currentRecords.get(listenerId);
      const listenerSignals = signalsByCharacter.get(listenerId);
      if (!listenerRecord || !listenerSignals) continue;

      listenerSignals.inboundSpeechExpected += 1;
      if (listenerRecord.input.composedUserMessage?.includes(expectedLine) === true) {
        listenerSignals.inboundSpeechCount += 1;
      } else {
        listenerSignals.inboundSpeechMissing += 1;
      }
    }
  }

  for (const action of previousRow.resolution.actions) {
    if (isLootOutcomeAction(action)) {
      const actorRecord = currentRecords.get(action.characterId);
      const actorSignals = signalsByCharacter.get(action.characterId);
      const expected = expectedLootFragment(action);
      if (!actorRecord || !actorSignals || !expected) continue;

      actorSignals.lootOutcomeExpected += 1;
      const delivered =
        actorRecord.input.composedUserMessage?.includes(expected) === true;
      const outcome = extractLootOutcomes([action], action.characterId)[0];
      if (outcome) {
        const deliveredOutcome: LootOutcome = {
          result: outcome.result,
          ...(outcome.target !== undefined ? { target: outcome.target } : {}),
          ...(delivered && outcome.item !== undefined
            ? { item: outcome.item }
            : {}),
          delivered,
        };
        actorSignals.lootOutcomeFeed.push(deliveredOutcome);
      }
      if (!delivered) {
        actorSignals.lootOutcomeMissing += 1;
      }
      continue;
    }

    if (!isDamageAction(action)) continue;

    const damage = damageAmount(action.result);
    if (damage === null) continue;

    const attackerName = displayNameForParticipant(
      action.characterId,
      participants,
    );
    const victimId = targetIdLookup.get(action.target) ?? action.target;
    const victimName = displayNameForParticipant(victimId, participants);
    const expectedDamageLine = `${attackerName} attacked you with ${weaponName(
      action.weapon,
    )} (dmg ${damage})`;
    const victimRecord = currentRecords.get(victimId);
    const victimSignals = signalsByCharacter.get(victimId);
    const attackerSignals = signalsByCharacter.get(action.characterId);

    if (victimRecord && victimSignals) {
      const delivered =
        victimRecord.input.composedUserMessage?.includes(expectedDamageLine) ===
        true;
      victimSignals.damageFeedAudit.expectedIncoming += 1;
      if (delivered) victimSignals.damageFeedAudit.incoming += 1;
      else victimSignals.damageFeedAudit.missingIncoming += 1;

      if (attackerSignals) {
        attackerSignals.damageFeedAudit.expectedOutgoing += 1;
        if (delivered) attackerSignals.damageFeedAudit.outgoing += 1;
        else attackerSignals.damageFeedAudit.missingOutgoing += 1;
      }
    }

    if (deaths.has(victimId) && attackerSignals) {
      const expectedKillLine = `${attackerName} killed ${victimName} with ${weaponName(
        action.weapon,
      )}`;
      attackerSignals.damageFeedAudit.expectedDealtKills += 1;
      if (
        currentRecords
          .get(action.characterId)
          ?.input.composedUserMessage?.includes(expectedKillLine) === true
      ) {
        attackerSignals.damageFeedAudit.dealtKills += 1;
      } else {
        attackerSignals.damageFeedAudit.missingDealtKills += 1;
      }
    }
  }

  return signalsByCharacter;
}

function slimInput(input: AgentInputLike) {
  return {
    systemPromptHash: input.systemPromptHash,
    personaPromptHash: input.personaPromptHash,
    ...(input.useVariant !== undefined ? { useVariant: input.useVariant } : {}),
  };
}

function slimLlm(llm: AgentLlmLike) {
  return {
    responseId: llm.responseId,
    callId: llm.callId,
    usage: llm.usage,
    latencyMs: llm.latencyMs,
    httpStatus: llm.httpStatus,
    fellBackToSafeDefault: llm.fellBackToSafeDefault,
    ...(llm.failureReason !== undefined
      ? { failureReason: llm.failureReason }
      : {}),
    ...(llm.validatorFieldErrors !== undefined
      ? { validatorFieldErrors: llm.validatorFieldErrors }
      : {}),
    ...(typeof llm.retried === "boolean" ? { retried: llm.retried } : {}),
  };
}

export function projectSlimTurnRow<Row extends TurnRowLike>(
  row: Row,
  deliverySignalsByCharacter?: ReadonlyMap<string, DeliverySignals>,
) {
  const fallbackSignals = deliverySignalsByCharacter ?? buildDeliverySignals(null, row);

  return {
    _id: row._id,
    matchId: row.matchId,
    turn: row.turn,
    resolution: row.resolution,
    agentRecords: row.agentRecords.map((record) => {
      const source = record.input.composedUserMessage ?? "";
      const visibleSource =
        source.length > 0 ? source : record.input.visibleStateDigest;
      const selfHp = extractSelfHp(source);
      const observerPos = extractObserverPos(source) ?? { x: 0, y: 0 };
      const signals =
        fallbackSignals.get(record.characterId) ?? emptyDeliverySignals();
      const clonedSignals = cloneDeliverySignals(signals);

      return {
        characterId: record.characterId,
        personaId: record.personaId,
        decision: record.decision,
        scratchpadAfter: record.scratchpadAfter,
        scratchpadChanged:
          record.input.scratchpadBefore !== record.scratchpadAfter,
        visibleSummary: summariseVisible(record.input.visibleStateDigest),
        visibleRectKeys: visibleRectKeys(visibleSource),
        insideBearingHere: insideBearingHere(visibleSource),
        observerPos,
        selfEquipment: extractSelfEquipment(source),
        ...(selfHp !== null ? { selfHp } : {}),
        ...clonedSignals,
        input: slimInput(record.input),
        llm: slimLlm(record.llm),
      };
    }),
  };
}

export function projectSlimTurnRows<Row extends TurnRowLike>(
  rows: readonly Row[],
) {
  return rows.map((row, index) => {
    const previousRow: Row | null = index > 0 ? rows[index - 1]! : null;
    return projectSlimTurnRow(row, buildDeliverySignals(previousRow, row));
  });
}

export type {
  DamageFeedAudit,
  DamageParticipant,
  LootOutcome,
  SelfEquipment,
  SelfHp,
  VisibleSummary,
};
