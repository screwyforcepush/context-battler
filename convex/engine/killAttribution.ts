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
  weapon?: string;
};

export type KillAttributionMove = {
  characterId: string;
  bodyCollision?:
    | { kind: "character"; defenderId: string }
    | { kind: "wall"; wallRectId: string };
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
    moves?: readonly KillAttributionMove[];
    deaths: readonly string[];
  };
};

export type DamageCandidateKind =
  | "attack"
  | "overwatch"
  | "counter"
  | "bodyCollision";

export type DamageCandidate = {
  attackerId: string;
  targetId: string;
  kind: DamageCandidateKind;
  weapon: string | null;
  hit: boolean;
  lethal: boolean;
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

export function buildTargetIdLookup(
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

export function isDamageAction(action: KillAttributionAction): boolean {
  return (
    (action.kind === "attack" ||
      action.kind === "overwatch" ||
      action.kind === "counter") &&
    /^dmg\s+\d+/i.test(action.result)
  );
}

function isDamageCapableAction(
  action: KillAttributionAction,
): action is KillAttributionAction & {
  kind: "attack" | "overwatch" | "counter";
} {
  return (
    action.kind === "attack" ||
    action.kind === "overwatch" ||
    action.kind === "counter"
  );
}

export function collectDamageCandidates(
  turn: KillAttributionTurnRow,
  resolveActionTargetId: (target: string) => string = (target) => target,
): DamageCandidate[] {
  const deathSet = new Set(turn.resolution.deaths);
  const creditedVictims = new Set<string>();
  const candidates: DamageCandidate[] = [];

  const addCandidate = (
    candidate: Omit<DamageCandidate, "lethal">,
    eligibleForLethalCredit: boolean,
  ) => {
    const lethal =
      eligibleForLethalCredit &&
      deathSet.has(candidate.targetId) &&
      !creditedVictims.has(candidate.targetId);
    if (lethal) creditedVictims.add(candidate.targetId);
    candidates.push({ ...candidate, lethal });
  };

  const collidedPairs = new Set<string>();
  for (const move of turn.resolution.moves ?? []) {
    const collision = move.bodyCollision;
    if (collision?.kind !== "character") continue;
    const moverId = move.characterId;
    const defenderId = collision.defenderId;
    const pairKey = [moverId, defenderId].sort().join("|");
    if (collidedPairs.has(pairKey)) continue;
    collidedPairs.add(pairKey);

    const defenderDied = deathSet.has(defenderId);
    const moverDied = deathSet.has(moverId);
    addCandidate(
      {
        attackerId: moverId,
        targetId: defenderId,
        kind: "bodyCollision",
        weapon: null,
        hit: true,
      },
      defenderDied,
    );
    addCandidate(
      {
        attackerId: defenderId,
        targetId: moverId,
        kind: "bodyCollision",
        weapon: null,
        hit: true,
      },
      moverDied,
    );
  }

  for (const action of turn.resolution.actions) {
    if (!isDamageCapableAction(action)) continue;
    const hit = /^dmg\s+\d+/i.test(action.result);
    const targetId = resolveActionTargetId(action.target);
    addCandidate(
      {
        attackerId: action.characterId,
        targetId,
        kind: action.kind,
        weapon: action.weapon ?? null,
        hit,
      },
      hit,
    );
  }

  return candidates;
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

    const candidates = collectDamageCandidates(t, (target) =>
      targetIdLookup.get(target) ?? target,
    );
    for (const candidate of candidates) {
      const creditsKill =
        candidate.kind === "bodyCollision"
          ? candidate.lethal
          : candidate.hit && deathSet.has(candidate.targetId);
      if (!creditsKill) continue;
      killsByCharacter.set(
        candidate.attackerId,
        (killsByCharacter.get(candidate.attackerId) ?? 0) + 1,
      );
    }
  }

  return killsByCharacter;
}
