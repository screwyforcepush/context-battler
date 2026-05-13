type VisibleSummary = {
  enemies: number;
  chests: number;
  corpses: number;
  evacSeen: boolean;
};

type SelfEquipment = {
  weapon: string | null;
  armour: string | null;
};

type DamageFeedAudit = {
  incoming: number;
  outgoing: number;
  dealtKills: number;
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

type ResolutionLike = {
  actions: readonly ResolutionActionLike[];
  speech: readonly ResolutionSpeechLike[];
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
  return key === "Evac" || (isRecord(value) && value.kind === "evac");
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
  };
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

function isDamageAction(action: ResolutionActionLike): boolean {
  return (
    (action.kind === "attack" ||
      action.kind === "overwatch" ||
      action.kind === "counter") &&
    /^dmg\s+\d+/i.test(action.result)
  );
}

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

  return { incoming, outgoing, dealtKills: dealtKillIds.size };
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
      const base: LootOutcome = { result: action.result };
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

export function projectSlimTurnRow<Row extends TurnRowLike>(row: Row) {
  const participants = row.agentRecords.map((record) => ({
    characterId: record.characterId,
    personaId: record.personaId,
  }));

  return {
    _id: row._id,
    matchId: row.matchId,
    turn: row.turn,
    resolution: row.resolution,
    agentRecords: row.agentRecords.map((record) => ({
      characterId: record.characterId,
      personaId: record.personaId,
      decision: record.decision,
      scratchpadAfter: record.scratchpadAfter,
      scratchpadChanged:
        record.input.scratchpadBefore !== record.scratchpadAfter,
      visibleSummary: summariseVisible(record.input.visibleStateDigest),
      selfEquipment: extractSelfEquipment(
        record.input.composedUserMessage ?? "",
      ),
      damageFeedAudit: auditDamageFeed(
        row.resolution,
        record.characterId,
        participants,
      ),
      inboundSpeechCount: countInboundSpeech(
        row.resolution.speech,
        record.characterId,
      ),
      lootOutcomeFeed: extractLootOutcomes(
        row.resolution.actions,
        record.characterId,
      ),
      input: slimInput(record.input),
      llm: slimLlm(record.llm),
    })),
  };
}

export function projectSlimTurnRows<Row extends TurnRowLike>(
  rows: readonly Row[],
) {
  return rows.map(projectSlimTurnRow);
}

export type {
  DamageFeedAudit,
  DamageParticipant,
  LootOutcome,
  SelfEquipment,
  VisibleSummary,
};
