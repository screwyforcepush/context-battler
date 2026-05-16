// Shared kill-attribution helper for runStats/cardStats.
//
// The engine trace records weapon/counter deaths in `resolution.deaths`.
// Environmental, wall, and telefrag deaths live outside that array and are
// intentionally not kill credit. This helper attributes the existing runStats
// rule at per-characterId granularity so callers can bucket it however they
// need: per persona for substrate diagnostics, per Card for product stats.

export type KillAttributionAction = {
  characterId: string;
  kind: string;
  target: string;
  result: string;
};

export type KillAttributionAgentRecord = {
  characterId: string;
  personaId?: string;
  displayName?: string;
};

export type KillAttributionCharacterRow = {
  _id: string;
  personaId?: string;
  displayName?: string;
};

export type KillAttributionTurnRow = {
  agentRecords?: readonly KillAttributionAgentRecord[];
  resolution: {
    actions: readonly KillAttributionAction[];
    deaths: readonly string[];
  };
};

function titleCaseAlias(id: string): string {
  return id.slice(0, 1).toUpperCase() + id.slice(1);
}

const ALIAS_PRECEDENCE = {
  persona: 1,
  displayName: 2,
  characterId: 3,
} as const;

type AliasPrecedence =
  (typeof ALIAS_PRECEDENCE)[keyof typeof ALIAS_PRECEDENCE];

function addAlias(
  lookup: Map<string, string>,
  aliasPrecedence: Map<string, AliasPrecedence>,
  alias: string | undefined,
  id: string,
  precedence: AliasPrecedence,
): void {
  if (alias === undefined) return;
  if (alias.trim().length === 0) return;
  const existingPrecedence = aliasPrecedence.get(alias);
  if (existingPrecedence !== undefined && existingPrecedence > precedence) {
    return;
  }
  lookup.set(alias, id);
  aliasPrecedence.set(alias, precedence);
}

function addParticipantAliases(
  lookup: Map<string, string>,
  aliasPrecedence: Map<string, AliasPrecedence>,
  participant: KillAttributionAgentRecord,
): void {
  addAlias(
    lookup,
    aliasPrecedence,
    participant.characterId,
    participant.characterId,
    ALIAS_PRECEDENCE.characterId,
  );
  if (participant.personaId !== undefined) {
    addAlias(
      lookup,
      aliasPrecedence,
      participant.personaId,
      participant.characterId,
      ALIAS_PRECEDENCE.persona,
    );
    addAlias(
      lookup,
      aliasPrecedence,
      titleCaseAlias(participant.personaId),
      participant.characterId,
      ALIAS_PRECEDENCE.persona,
    );
  }
  // Card agent names are free-form; they must beat legacy persona aliases.
  addAlias(
    lookup,
    aliasPrecedence,
    participant.displayName,
    participant.characterId,
    ALIAS_PRECEDENCE.displayName,
  );
}

function buildTargetIdLookup(
  turns: readonly KillAttributionTurnRow[],
  characters: readonly KillAttributionCharacterRow[],
): Map<string, string> {
  const lookup = new Map<string, string>();
  const aliasPrecedence = new Map<string, AliasPrecedence>();
  for (const c of characters) {
    addParticipantAliases(lookup, aliasPrecedence, {
      characterId: c._id,
      personaId: c.personaId,
      displayName: c.displayName,
    });
  }
  for (const t of turns) {
    for (const record of t.agentRecords ?? []) {
      addParticipantAliases(lookup, aliasPrecedence, record);
    }
  }
  return lookup;
}

function isDamageAction(action: KillAttributionAction): boolean {
  return (
    (action.kind === "attack" ||
      action.kind === "overwatch" ||
      action.kind === "counter") &&
    /^dmg\s+\d+/i.test(action.result)
  );
}

export function attributeKillsByCharacter(
  turns: readonly KillAttributionTurnRow[],
  characters: readonly KillAttributionCharacterRow[],
): Map<string, number> {
  const targetIdLookup = buildTargetIdLookup(turns, characters);
  const killsByCharacter = new Map<string, number>();

  for (const t of turns) {
    const deathSet = new Set(t.resolution.deaths);
    if (deathSet.size === 0) continue;

    for (const action of t.resolution.actions) {
      if (!isDamageAction(action)) continue;
      const targetId = deathSet.has(action.target)
        ? action.target
        : targetIdLookup.get(action.target) ?? action.target;
      if (!deathSet.has(targetId)) continue;
      killsByCharacter.set(
        action.characterId,
        (killsByCharacter.get(action.characterId) ?? 0) + 1,
      );
    }
  }

  return killsByCharacter;
}
