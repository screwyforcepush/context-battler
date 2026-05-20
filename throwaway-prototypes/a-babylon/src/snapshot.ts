import { fallbackSnapshot } from "./fallbackSnapshot";
import type { EntitySnapshot, MapDescriptor, ReplaySnapshot } from "./types";

const SNAPSHOT_URL = "/shared-harness/replay-snapshot.json";

export type SnapshotLoadResult = {
  snapshot: ReplaySnapshot;
  source: "shared-harness" | "fallback";
  warning: string | null;
};

export async function loadReplaySnapshot(): Promise<SnapshotLoadResult> {
  try {
    const response = await fetch(SNAPSHOT_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const parsed = normalizeSnapshot(await response.json());
    return {
      snapshot: parsed,
      source: "shared-harness",
      warning: null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      snapshot: fallbackSnapshot,
      source: "fallback",
      warning: `Unable to load ${SNAPSHOT_URL}: ${detail}. Rendering the built-in fallback snapshot so this prototype remains inspectable while the shared harness is absent.`,
    };
  }
}

function normalizeSnapshot(value: unknown): ReplaySnapshot {
  if (!isRecord(value)) {
    throw new Error("snapshot root is not an object");
  }

  if (!isRecord(value.map)) {
    throw new Error("snapshot.map is missing or invalid");
  }

  const frameValues = extractFrameValues(value);
  const frames = frameValues.map((frameValue, index) =>
    normalizeFrame(frameValue, index),
  );
  const moneyShot = normalizeMoneyShot(value);
  const duel = normalizeDuel(value);

  return {
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    map: normalizeMap(value.map),
    frames,
    moneyShot,
    ...(duel ? { duel } : {}),
  };
}

function extractFrameValues(value: Record<string, unknown>): unknown[] {
  if (Array.isArray(value.frames) && value.frames.length > 0) {
    return value.frames;
  }

  if (isRecord(value.timeline) && Array.isArray(value.timeline.frames)) {
    const frames = value.timeline.frames.map((frame) => {
      if (isRecord(frame) && isRecord(frame.snapshot)) return frame.snapshot;
      return frame;
    });
    if (frames.length > 0) return frames;
  }

  throw new Error("snapshot frames must be a non-empty array");
}

function normalizeMoneyShot(value: Record<string, unknown>): ReplaySnapshot["moneyShot"] {
  if (isRecord(value.moneyShot)) {
    return {
      victimId: stringField(value.moneyShot, "victimId"),
      dropId: stringField(value.moneyShot, "dropId"),
      landsAtTurn: numberField(value.moneyShot, "landsAtTurn"),
      loopStartTurn: optionalNumberField(value.moneyShot, "loopStartTurn"),
      loopEndTurn: optionalNumberField(value.moneyShot, "loopEndTurn"),
      loopSeconds: optionalNumberField(value.moneyShot, "loopSeconds"),
    };
  }

  if (isRecord(value.highlightedEvent)) {
    const playback = isRecord(value.playback) ? value.playback : {};
    return normalizeHighlightedAirdrop(value.highlightedEvent, playback);
  }

  const highlightedAirdrop = highlightedEvents(value).find(isAirdropEvent);
  if (highlightedAirdrop) {
    const playback = isRecord(value.playback) ? value.playback : {};
    return normalizeHighlightedAirdrop(highlightedAirdrop, playback);
  }

  throw new Error("snapshot money-shot event is missing or invalid");
}

function normalizeHighlightedAirdrop(
  event: Record<string, unknown>,
  playback: Record<string, unknown>,
): ReplaySnapshot["moneyShot"] {
  return {
    victimId: stringField(event, "victimId"),
    dropId: stringField(event, "airdropId"),
    landsAtTurn: numberField(event, "landTurn"),
    loopStartTurn: optionalNumberField(playback, "startTurn"),
    loopEndTurn: optionalNumberField(playback, "endTurn"),
    loopSeconds: optionalNumberField(playback, "sliceDurationSeconds"),
  };
}

function normalizeDuel(value: Record<string, unknown>): ReplaySnapshot["duel"] {
  const event = highlightedEvents(value).find(isDuelEvent);
  if (!event) return undefined;

  const attackerId = firstStringField(event, ["attackerId", "killerId", "actorId"]);
  const defenderId = firstStringField(event, ["defenderId", "targetId", "victimId"]);
  const winnerId = firstStringField(event, ["winnerId", "killerId"]);
  const loserId = firstStringField(event, ["loserId", "victimId"]);
  const participantIds = collectParticipantIds(event, [
    attackerId,
    defenderId,
    winnerId,
    loserId,
  ]);
  const playback = normalizeDuelPlayback(event, value);

  return {
    kind: "duel",
    eventId: firstStringField(event, ["eventId", "id"]),
    sourceKind: optionalStringField(event, "kind"),
    participantIds,
    attackerId,
    defenderId,
    winnerId,
    loserId,
    startTurn: firstNumberField(event, ["startTurn", "turn"]),
    exchangeTurn: firstNumberField(event, ["exchangeTurn"]),
    killTurn: firstNumberField(event, ["killTurn", "deathTurn"]),
    endTurn: firstNumberField(event, ["endTurn", "killTurn", "deathTurn", "turn"]),
    ...(playback ? { playback } : {}),
  };
}

function normalizeDuelPlayback(
  event: Record<string, unknown>,
  root: Record<string, unknown>,
): NonNullable<ReplaySnapshot["duel"]>["playback"] {
  const eventPlayback = isRecord(event.playback) ? event.playback : {};
  const rootPlayback = isRecord(root.playback) ? root.playback : {};
  const eventTimesSeconds =
    numberRecord(eventPlayback.eventTimesSeconds) ??
    duelEventTimesSeconds(rootPlayback.eventTimesSeconds);

  const playback = {
    startTurn: firstNumberField(eventPlayback, ["startTurn", "loopStartTurn"]),
    endTurn: firstNumberField(eventPlayback, ["endTurn", "loopEndTurn"]),
    loopSeconds: firstNumberField(eventPlayback, [
      "loopSeconds",
      "sliceDurationSeconds",
    ]),
    ...(eventTimesSeconds ? { eventTimesSeconds } : {}),
  };

  if (
    playback.startTurn === undefined &&
    playback.endTurn === undefined &&
    playback.loopSeconds === undefined &&
    playback.eventTimesSeconds === undefined
  ) {
    return undefined;
  }

  return playback;
}

function highlightedEvents(value: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(value.highlightedEvents)) return [];
  return value.highlightedEvents.filter(isRecord);
}

function isAirdropEvent(event: Record<string, unknown>): boolean {
  const kind = optionalStringField(event, "kind");
  return (
    kind === "airdrop-telefrag" ||
    (typeof event.airdropId === "string" &&
      typeof event.victimId === "string" &&
      typeof event.landTurn === "number")
  );
}

function isDuelEvent(event: Record<string, unknown>): boolean {
  return (
    optionalStringField(event, "kind")?.toLowerCase().includes("duel") ?? false
  );
}

function collectParticipantIds(
  event: Record<string, unknown>,
  candidates: Array<string | undefined>,
): string[] {
  const ids = new Set<string>();

  for (const id of stringArrayField(event, "participantIds")) {
    ids.add(id);
  }

  if (Array.isArray(event.participants)) {
    for (const participant of event.participants) {
      if (typeof participant === "string" && participant.length > 0) {
        ids.add(participant);
      } else if (isRecord(participant)) {
        const id = firstStringField(participant, ["characterId", "id"]);
        if (id) ids.add(id);
      }
    }
  }

  for (const id of candidates) {
    if (id) ids.add(id);
  }

  return [...ids];
}

function normalizeMap(map: Record<string, unknown>): MapDescriptor {
  const normalized: Record<string, unknown> = { ...map };

  if (!Array.isArray(normalized.crates) && Array.isArray(normalized.staticCrates)) {
    normalized.crates = normalized.staticCrates
      .filter(isRecord)
      .map((crate) => {
        const pos = isRecord(crate.pos) ? crate.pos : crate;
        return {
          x: numberField(pos, "x"),
          y: numberField(pos, "y"),
          contents: crate.contents,
        };
      });
  }

  if (isRecord(normalized.evac) && isRecord(normalized.evac.centre)) {
    normalized.evac = {
      x: numberField(normalized.evac.centre, "x"),
      y: numberField(normalized.evac.centre, "y"),
    };
  }

  return normalized as MapDescriptor;
}

function normalizeFrame(value: unknown, index: number): EntitySnapshot {
  if (!isRecord(value)) {
    throw new Error(`frames[${index}] is not an object`);
  }
  if (!Array.isArray(value.characters)) {
    throw new Error(`frames[${index}].characters must be an array`);
  }
  if (!Array.isArray(value.corpses)) {
    throw new Error(`frames[${index}].corpses must be an array`);
  }
  if (!Array.isArray(value.crates)) {
    throw new Error(`frames[${index}].crates must be an array`);
  }
  if (!Array.isArray(value.airdrops)) {
    throw new Error(`frames[${index}].airdrops must be an array`);
  }

  return {
    turn: numberField(value, "turn"),
    characters: value.characters as EntitySnapshot["characters"],
    corpses: value.corpses as EntitySnapshot["corpses"],
    crates: value.crates as EntitySnapshot["crates"],
    airdrops: value.airdrops as EntitySnapshot["airdrops"],
    evacRevealed: Boolean(value.evacRevealed),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`expected string field "${key}"`);
  }
  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstStringField(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = optionalStringField(record, key);
    if (value) return value;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`expected number field "${key}"`);
  }
  return value;
}

function firstNumberField(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function optionalNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`expected optional number field "${key}"`);
  }
  return value;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  if (entries.length === 0) return undefined;

  return Object.fromEntries(entries);
}

function duelEventTimesSeconds(value: unknown): Record<string, number> | undefined {
  const eventTimesSeconds = numberRecord(value);
  if (!eventTimesSeconds) return undefined;

  const duelEntries = Object.entries(eventTimesSeconds).filter(([key]) =>
    key.toLowerCase().includes("duel"),
  );
  return duelEntries.length > 0 ? Object.fromEntries(duelEntries) : eventTimesSeconds;
}
