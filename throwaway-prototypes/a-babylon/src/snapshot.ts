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

  return {
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    map: normalizeMap(value.map),
    frames,
    moneyShot,
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
    return {
      victimId: stringField(value.highlightedEvent, "victimId"),
      dropId: stringField(value.highlightedEvent, "airdropId"),
      landsAtTurn: numberField(value.highlightedEvent, "landTurn"),
      loopStartTurn: optionalNumberField(playback, "startTurn"),
      loopEndTurn: optionalNumberField(playback, "endTurn"),
      loopSeconds: optionalNumberField(playback, "sliceDurationSeconds"),
    };
  }

  throw new Error("snapshot money-shot event is missing or invalid");
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

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`expected number field "${key}"`);
  }
  return value;
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
