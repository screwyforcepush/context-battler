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

function addAlias(lookup: Map<string, string>, alias: string | undefined, id: string): void {
  if (alias === undefined) return;
  if (alias.trim().length === 0) return;
  lookup.set(alias, id);
}

function addParticipantAliases(
  lookup: Map<string, string>,
  participant: KillAttributionAgentRecord,
): void {
  addAlias(lookup, participant.characterId, participant.characterId);
  if (participant.personaId !== undefined) {
    addAlias(lookup, participant.personaId, participant.characterId);
    addAlias(lookup, titleCaseAlias(participant.personaId), participant.characterId);
  }
  addAlias(lookup, participant.displayName, participant.characterId);
}

function buildTargetIdLookup(
  turns: readonly KillAttributionTurnRow[],
  characters: readonly KillAttributionCharacterRow[],
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const c of characters) {
    addParticipantAliases(lookup, {
      characterId: c._id,
      personaId: c.personaId,
      displayName: c.displayName,
    });
  }
  for (const t of turns) {
    for (const record of t.agentRecords ?? []) {
      addParticipantAliases(lookup, record);
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
      const targetId = targetIdLookup.get(action.target) ?? action.target;
      if (!deathSet.has(targetId)) continue;
      killsByCharacter.set(
        action.characterId,
        (killsByCharacter.get(action.characterId) ?? 0) + 1,
      );
    }
  }

  return killsByCharacter;
}
