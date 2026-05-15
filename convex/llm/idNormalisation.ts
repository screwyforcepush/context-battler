import type { MatchState, Tile, Wall } from "../engine/types.js";
import {
  computeVisibleEntities,
  nearestTileOfRect,
} from "../engine/vision.js";
import {
  airdropProjectionState,
  findNavigableCrateById,
} from "../engine/airdrops.js";

// Phase-6 — character target id normalisation at the validator boundary.
//
// The agent acts on `Visible.id`, which is now the persona display name
// (`Camper`, `Duelist`, etc.). The validator + resolver compare against
// `CharacterState.characterId`, which in production is a Convex opaque
// `_id`. This helper bridges those id spaces at one boundary: callers
// normalise once, then pass the engine-side identifier through.
//
// Strategy:
//   1. If `targetId` exactly matches a character's engine `characterId`,
//      return it unchanged (test-fixture path; production agents act on
//      the persona displayName so they do not hit this branch).
//   2. Otherwise, if `targetId` matches a character's `displayName`
//      (e.g. "Camper"), return that character's engine `characterId`.
//   3. Otherwise return null. The caller treats null as "target not a
//      known character".

/**
 * Normalise a character target id emitted by the LLM into its engine
 * `characterId`. Returns null when the id does not match any character
 * in `characters` (live-or-dead — liveness is the caller's check).
 *
 * The check matches `characterId` first to keep test fixtures working
 * (test characters are typically created with `characterId === "A"` etc.
 * rather than a real Convex Id), then falls back to `displayName` so
 * production persona names from the LLM resolve to the engine id.
 */
export function normaliseCharacterTargetId(
  targetId: string,
  characters: ReadonlyArray<{ characterId: string; displayName: string }>,
): string | null {
  if (!targetId) return null;
  const byId = characters.find((c) => c.characterId === targetId);
  if (byId) return byId.characterId;
  const byName = characters.find((c) => c.displayName === targetId);
  if (byName) return byName.characterId;
  return null;
}

// ─── Phase-3 WP-G.1 — Corpse_<displayName> typed-id normalisation ──────────
//
// The digest renders corpse bullets as `Corpse_<displayName>`; with the
// phase-6 persona-id flip that means ids such as `Corpse_Camper`.
// Normalisation keeps the typed visible id as the model contract while
// resolving the corpse owner's engine id for movement and loot dispatch.
//
// Strategy mirrors `normaliseCharacterTargetId`:
//   1. Strip the `Corpse_` prefix to get the inner display id.
//   2. Resolve the inner id via `normaliseCharacterTargetId` —
//      direct-`characterId` first (test fixtures whose characterId equals
//      the displayName), then `displayName` lookup (production: the
//      engine `characterId` is a Convex Id and the LLM-facing literal is
//      the dead character's `displayName`).
//   3. Return the engine `characterId` so the caller can look up the
//      corpse via `corpse.characterId === resolved` directly (the corpse's
//      `characterId` field is bound at corpse-formation time per
//      `convex/runMatch.ts:200` to `c._id`).
//
// Returns null when the prefix doesn't match (caller's existing namespace
// branches handle the rejection path) OR when the inner id doesn't
// resolve to a known character.

/**
 * Normalise a `Corpse_<displayName>` typed-id (e.g. `Corpse_Camper`) into
 * the engine `characterId` of the corpse owner.
 *
 * Returns the engine `characterId` (which equals `corpse.characterId` for
 * the matching corpse), or `null` when:
 *   - `targetId` does not have the `Corpse_` prefix (caller dispatches by
 *     namespace), OR
 *   - the inner `<displayName>` does not resolve to any character in
 *     `characters`.
 *
 * Caller responsibility: liveness/corpse-existence checks are NOT done
 * here — the resolved `characterId` is just an id-space bridge. Callers
 * still look up `state.world.corpses.find(c => c.characterId === resolved)`
 * to confirm the corpse actually exists.
 */
export function normaliseCorpseTargetId(
  targetId: string,
  characters: ReadonlyArray<{ characterId: string; displayName: string }>,
): string | null {
  if (!targetId) return null;
  if (!targetId.startsWith("Corpse_")) return null;
  const inner = targetId.slice("Corpse_".length);
  if (!inner) return null;
  return normaliseCharacterTargetId(inner, characters);
}

export type ResolvedEntity = {
  kind: "character" | "crate" | "corpse" | "cover" | "wall" | "evac";
  tile: Tile;
  stopAtRange: number;
  rect?: Wall;
  engineRef?: { characterId?: string; crateId?: string };
};

export const TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV =
  "TELEGRAPHED_CRATE_STOP_AT_RANGE";

export type TelegraphedCrateStopAtRange = 0 | 2;

export type ResolveTypedEntityOptions = {
  telegraphedCrateStopAtRange?: TelegraphedCrateStopAtRange;
};

type StopAtRangeContext = {
  state: MatchState;
  targetId?: string;
  options?: ResolveTypedEntityOptions;
};

const DEFAULT_TELEGRAPHED_CRATE_STOP_AT_RANGE: TelegraphedCrateStopAtRange = 0;

const STOP_AT_RANGE = {
  character: () => 2,
  crate: (context: StopAtRangeContext) => crateStopAtRange(context),
  corpse: () => 2,
  cover: () => 0,
  wall: () => 1,
  evac: () => 0,
} satisfies Record<
  ResolvedEntity["kind"],
  (context: StopAtRangeContext) => number
>;

function parseTelegraphedCrateStopAtRange(
  value: string | undefined,
): TelegraphedCrateStopAtRange | null {
  if (value === "0") return 0;
  if (value === "2") return 2;
  return null;
}

function configuredTelegraphedCrateStopAtRange(
  options: ResolveTypedEntityOptions | undefined,
): TelegraphedCrateStopAtRange {
  if (options?.telegraphedCrateStopAtRange !== undefined) {
    return options.telegraphedCrateStopAtRange;
  }

  const envValue =
    typeof process === "undefined"
      ? undefined
      : process.env[TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV];
  return (
    parseTelegraphedCrateStopAtRange(envValue) ??
    DEFAULT_TELEGRAPHED_CRATE_STOP_AT_RANGE
  );
}

function crateStopAtRange({
  state,
  targetId,
  options,
}: StopAtRangeContext): number {
  const airdrop = targetId
    ? state.world.airdrops.find((candidate) => candidate.id === targetId)
    : undefined;
  if (airdrop && airdropProjectionState(airdrop, state.turn) === "telegraphed") {
    return configuredTelegraphedCrateStopAtRange(options);
  }
  return 2;
}

function stopAtRangeFor(
  kind: ResolvedEntity["kind"],
  context: StopAtRangeContext,
): number {
  return STOP_AT_RANGE[kind](context);
}

function copyTile(tile: Tile): Tile {
  return { x: tile.x, y: tile.y };
}

function observerPos(state: MatchState, observerId: string): Tile {
  const observer = state.characters.find((c) => c.characterId === observerId);
  return observer ? copyTile(observer.pos) : { x: 0, y: 0 };
}

function isCrateId(targetId: string): boolean {
  return /^Crate_-?\d+_-?\d+$/.test(targetId);
}

function formatRectId(prefix: "Cover" | "Wall" | "Evac", rect: Wall): string {
  const x2 = rect.x + rect.w - 1;
  const y2 = rect.y + rect.h - 1;
  if (rect.w === 1 && rect.h === 1) return `${prefix}_${rect.x}_${rect.y}`;
  return `${prefix}_${rect.x}_${rect.y}_to_${x2}_${y2}`;
}

function evacRect(state: MatchState): Wall {
  return {
    x: state.world.evac.centre.x - 1,
    y: state.world.evac.centre.y - 1,
    w: 3,
    h: 3,
  };
}

function sameRect(a: Wall, b: Wall): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function rectFromBounds(x1: number, y1: number, x2: number, y2: number): Wall | null {
  if (x2 < x1 || y2 < y1) return null;
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

export type ParsedPositionId =
  | { kind: "single"; tile: Tile; rect: Wall }
  | { kind: "rect"; rect: Wall };

export function parsePositionId(
  targetId: string,
  prefix: "Cover" | "Wall" | "Evac",
): ParsedPositionId | null {
  const single = new RegExp(`^${prefix}_(-?\\d+)_(-?\\d+)$`).exec(targetId);
  if (single) {
    const tile = { x: Number(single[1]), y: Number(single[2]) };
    return { kind: "single", tile, rect: { ...tile, w: 1, h: 1 } };
  }

  const rect = new RegExp(
    `^${prefix}_(-?\\d+)_(-?\\d+)_to_(-?\\d+)_(-?\\d+)$`,
  ).exec(targetId);
  if (!rect) return null;
  const parsed = rectFromBounds(
    Number(rect[1]),
    Number(rect[2]),
    Number(rect[3]),
    Number(rect[4]),
  );
  if (!parsed) return null;
  if (parsed.w === 1 && parsed.h === 1) {
    return {
      kind: "single",
      tile: { x: parsed.x, y: parsed.y },
      rect: parsed,
    };
  }
  return { kind: "rect", rect: parsed };
}

export function visibleTargetIds(
  state: MatchState,
  observerId: string,
): Set<string> {
  const ids = new Set<string>();
  const { visible } = computeVisibleEntities(state, observerId);

  for (const entity of visible) {
    switch (entity.kind) {
      case "character": {
        const character = state.characters.find(
          (c) => c.characterId === entity.characterId,
        );
        ids.add(entity.characterId);
        if (character) ids.add(character.displayName);
        break;
      }
      case "crate":
        ids.add(entity.objectId);
        break;
      case "airdrop":
        ids.add(entity.objectId);
        break;
      case "corpse": {
        ids.add(entity.objectId);
        ids.add(`Corpse_${entity.objectId}`);
        const character = state.characters.find(
          (c) => c.characterId === entity.objectId,
        );
        if (character) {
          ids.add(character.displayName);
          ids.add(`Corpse_${character.displayName}`);
        }
        break;
      }
      case "cover_rect":
        ids.add(formatRectId("Cover", entity.rect));
        break;
      case "wall_rect":
        ids.add(formatRectId("Wall", entity.rect));
        break;
      case "evac_rect":
        ids.add(formatRectId("Evac", entity.rect));
        break;
    }
  }

  return ids;
}

function hasLineOfSightVisibleTarget(
  state: MatchState,
  observerId: string,
  targetId: string,
): boolean {
  return visibleTargetIds(state, observerId).has(targetId);
}

export function resolveTypedEntity(
  state: MatchState,
  observerId: string,
  targetId: string,
  options?: ResolveTypedEntityOptions,
): ResolvedEntity | null {
  if (targetId.startsWith("Corpse_")) {
    if (!hasLineOfSightVisibleTarget(state, observerId, targetId)) return null;
    const characterId = normaliseCorpseTargetId(targetId, state.characters);
    const corpse = characterId
      ? state.world.corpses.find((c) => c.characterId === characterId)
      : state.world.corpses.find((c) => targetId === `Corpse_${c.characterId}`);
    if (!corpse) return null;
    return {
      kind: "corpse",
      tile: copyTile(corpse.pos),
      stopAtRange: stopAtRangeFor("corpse", { state, targetId, options }),
    };
  }

  if (isCrateId(targetId)) {
    if (!hasLineOfSightVisibleTarget(state, observerId, targetId)) return null;
    const crate = findNavigableCrateById(state.world, targetId, state.turn);
    if (!crate) return null;
    return {
      kind: "crate",
      tile: copyTile(crate.pos),
      stopAtRange: stopAtRangeFor("crate", { state, targetId, options }),
      engineRef: { crateId: crate.id },
    };
  }

  if (targetId.startsWith("Cover_")) {
    const parsed = parsePositionId(targetId, "Cover");
    if (!parsed) return null;
    const rect = state.world.coverClusters.find((candidate) =>
      sameRect(candidate, parsed.rect),
    );
    if (!rect) return null;
    if (!hasLineOfSightVisibleTarget(state, observerId, formatRectId("Cover", rect))) {
      return null;
    }
    return {
      kind: "cover",
      tile: nearestTileOfRect(observerPos(state, observerId), rect),
      stopAtRange: stopAtRangeFor("cover", { state, targetId, options }),
      rect,
    };
  }

  if (targetId.startsWith("Wall_")) {
    const parsed = parsePositionId(targetId, "Wall");
    if (!parsed) return null;
    const rect = state.world.walls.find((candidate) =>
      sameRect(candidate, parsed.rect),
    );
    if (!rect) return null;
    if (!hasLineOfSightVisibleTarget(state, observerId, formatRectId("Wall", rect))) {
      return null;
    }
    return {
      kind: "wall",
      tile: nearestTileOfRect(observerPos(state, observerId), rect),
      stopAtRange: stopAtRangeFor("wall", { state, targetId, options }),
      rect,
    };
  }

  if (targetId.startsWith("Evac_")) {
    const parsed = parsePositionId(targetId, "Evac");
    if (!parsed) return null;
    const rect = evacRect(state);
    if (!sameRect(rect, parsed.rect)) return null;
    if (!hasLineOfSightVisibleTarget(state, observerId, formatRectId("Evac", rect))) {
      return null;
    }
    return {
      kind: "evac",
      tile: nearestTileOfRect(observerPos(state, observerId), rect),
      stopAtRange: stopAtRangeFor("evac", { state, targetId, options }),
      rect,
    };
  }

  const characterId = normaliseCharacterTargetId(targetId, state.characters);
  const character = characterId
    ? state.characters.find((c) => c.characterId === characterId)
    : undefined;
  if (character?.alive && hasLineOfSightVisibleTarget(state, observerId, targetId)) {
    return {
      kind: "character",
      tile: copyTile(character.pos),
      stopAtRange: stopAtRangeFor("character", { state, targetId, options }),
      engineRef: { characterId: character.characterId },
    };
  }

  if (!hasLineOfSightVisibleTarget(state, observerId, targetId)) return null;
  const corpse =
    (characterId
      ? state.world.corpses.find((c) => c.characterId === characterId)
      : undefined) ??
    state.world.corpses.find((c) => c.characterId === targetId);
  if (corpse) {
    return {
      kind: "corpse",
      tile: copyTile(corpse.pos),
      stopAtRange: stopAtRangeFor("corpse", { state, targetId, options }),
      engineRef: { characterId: corpse.characterId },
    };
  }

  return null;
}
