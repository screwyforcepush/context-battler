export const CARD_MATCH_AGENT_COUNT = 8;
export const CARD_MATCH_AGENT_NAME_MAX_LENGTH = 64;

const RESERVED_PREFIX_PATTERN = /^(Crate|Corpse|Cover|Wall|Evac)_/;
const RESERVED_PLAYER_ID_PATTERN = /^Player_\d+$/;
const RESERVED_CRATE_ID_PATTERN = /^Crate_-?\d+_-?\d+$/;
const LINE_BREAK_PATTERN = /[\n\r\u2028\u2029]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/;

export type CardMatchAgentNameInput = {
  cardId: string;
  agentName: string;
};

export type CardMatchPreparedAgentName = CardMatchAgentNameInput & {
  displayName: string;
  normalisedAgentName: string;
};

export type CardMatchAgentNameIssueReason =
  | "empty"
  | "untrimmed"
  | "multiline"
  | "control_character"
  | "over_max_length"
  | "reserved_crate_id"
  | "reserved_prefix"
  | "reserved_player_id";

export type CardMatchAgentNameValidationError =
  | {
      reason: "invalid_count";
      expected: typeof CARD_MATCH_AGENT_COUNT;
      actual: number;
    }
  | {
      reason: CardMatchAgentNameIssueReason;
      index: number;
      cardId: string;
      agentName: string;
      maxLength?: typeof CARD_MATCH_AGENT_NAME_MAX_LENGTH;
      actualLength?: number;
    }
  | {
      reason: "duplicate_agent_name";
      normalisedAgentName: string;
      indices: number[];
      cardIds: string[];
      agentNames: string[];
    };

export type CardMatchAgentNameValidationResult =
  | { ok: true; entries: CardMatchPreparedAgentName[] }
  | { ok: false; errors: CardMatchAgentNameValidationError[] };

type DuplicateBucket = {
  indices: number[];
  cardIds: string[];
  agentNames: string[];
};

/**
 * Match-local uniqueness key for Card agent names. The validator separately
 * rejects untrimmed names; trimming here makes duplicate diagnostics stable
 * even when an invalid row is compared with its trimmed twin.
 */
export function normaliseCardMatchAgentName(agentName: string): string {
  return agentName.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function disambiguateCardMatchDisplayNames(
  displayNames: ReadonlyArray<string>,
): string[] {
  const reservedOriginals = new Set(displayNames);
  const used = new Set<string>();
  const seen = new Map<string, number>();
  const output: string[] = [];

  for (const displayName of displayNames) {
    const seenCount = seen.get(displayName) ?? 0;
    seen.set(displayName, seenCount + 1);

    if (seenCount === 0 && !used.has(displayName)) {
      used.add(displayName);
      output.push(displayName);
      continue;
    }

    let suffix = seenCount + 1;
    let candidate = `${displayName} (${suffix})`;
    while (used.has(candidate) || reservedOriginals.has(candidate)) {
      suffix += 1;
      candidate = `${displayName} (${suffix})`;
    }

    used.add(candidate);
    output.push(candidate);
  }

  return output;
}

export function validateCardMatchAgentNames(
  rows: ReadonlyArray<CardMatchAgentNameInput>,
): CardMatchAgentNameValidationResult {
  const errors: CardMatchAgentNameValidationError[] = [];

  if (rows.length !== CARD_MATCH_AGENT_COUNT) {
    errors.push({
      reason: "invalid_count",
      expected: CARD_MATCH_AGENT_COUNT,
      actual: rows.length,
    });
  }

  const duplicates = new Map<string, DuplicateBucket>();

  rows.forEach((row, index) => {
    errors.push(...validateSingleAgentName(row, index));

    const normalisedAgentName = normaliseCardMatchAgentName(row.agentName);
    if (normalisedAgentName.length === 0) return;

    const bucket =
      duplicates.get(normalisedAgentName) ??
      { indices: [], cardIds: [], agentNames: [] };
    bucket.indices.push(index);
    bucket.cardIds.push(row.cardId);
    bucket.agentNames.push(row.agentName);
    duplicates.set(normalisedAgentName, bucket);
  });

  for (const [normalisedAgentName, bucket] of duplicates) {
    if (bucket.indices.length <= 1) continue;
    errors.push({
      reason: "duplicate_agent_name",
      normalisedAgentName,
      indices: bucket.indices,
      cardIds: bucket.cardIds,
      agentNames: bucket.agentNames,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const displayNames = disambiguateCardMatchDisplayNames(
    rows.map((row) => row.agentName),
  );
  return {
    ok: true,
    entries: rows.map((row, index) => ({
      cardId: row.cardId,
      agentName: row.agentName,
      displayName: displayNames[index] ?? row.agentName,
      normalisedAgentName: normaliseCardMatchAgentName(row.agentName),
    })),
  };
}

function validateSingleAgentName(
  row: CardMatchAgentNameInput,
  index: number,
): CardMatchAgentNameValidationError[] {
  const errors: CardMatchAgentNameValidationError[] = [];
  const { agentName, cardId } = row;
  const trimmed = agentName.trim();
  const issue = (reason: CardMatchAgentNameIssueReason) => ({
    reason,
    index,
    cardId,
    agentName,
  });

  if (trimmed.length === 0) {
    errors.push(issue("empty"));
    return errors;
  }

  if (trimmed !== agentName) {
    errors.push(issue("untrimmed"));
  }

  if (LINE_BREAK_PATTERN.test(agentName)) {
    errors.push(issue("multiline"));
  }

  if (CONTROL_CHARACTER_PATTERN.test(agentName)) {
    errors.push(issue("control_character"));
  }

  const actualLength = Array.from(agentName).length;
  if (actualLength > CARD_MATCH_AGENT_NAME_MAX_LENGTH) {
    errors.push({
      ...issue("over_max_length"),
      maxLength: CARD_MATCH_AGENT_NAME_MAX_LENGTH,
      actualLength,
    });
  }

  if (RESERVED_CRATE_ID_PATTERN.test(agentName)) {
    errors.push(issue("reserved_crate_id"));
  } else if (RESERVED_PREFIX_PATTERN.test(agentName)) {
    errors.push(issue("reserved_prefix"));
  }

  if (RESERVED_PLAYER_ID_PATTERN.test(agentName)) {
    errors.push(issue("reserved_player_id"));
  }

  return errors;
}
