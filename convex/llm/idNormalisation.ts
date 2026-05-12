import type { MatchState, Tile } from "../engine/types.js";
import { computeVisibleEntities } from "../engine/vision.js";

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
  kind: "character" | "chest" | "corpse" | "cover" | "wall" | "evac";
  tile: Tile;
  stopAtRange: number;
  engineRef?: { characterId?: string; chestId?: string };
};

function copyTile(tile: Tile): Tile {
  return { x: tile.x, y: tile.y };
}

function chestTargetIds(chestId: string): string[] {
  const ids = new Set<string>([chestId]);
  const lower = /^chest_(\d+)$/.exec(chestId);
  if (lower) ids.add(`Chest_${lower[1]}`);
  const upper = /^Chest_(\d+)$/.exec(chestId);
  if (upper) ids.add(`chest_${upper[1]}`);
  return [...ids];
}

function findChestByTargetId(state: MatchState, targetId: string) {
  return state.world.chests.find((chest) =>
    chestTargetIds(chest.id).includes(targetId),
  );
}

function visibleTargetIds(state: MatchState, observerId: string): Set<string> {
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
      case "chest":
        for (const id of chestTargetIds(entity.objectId)) ids.add(id);
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
      case "cover":
        ids.add(`Cover_${entity.pos.x}_${entity.pos.y}`);
        break;
      case "wall":
        ids.add(`Wall_${entity.pos.x}_${entity.pos.y}`);
        break;
    }
  }

  if (state.world.evac.revealedAtTurn !== null) ids.add("Evac");
  return ids;
}

function hasLineOfSightVisibleTarget(
  state: MatchState,
  observerId: string,
  targetId: string,
): boolean {
  return visibleTargetIds(state, observerId).has(targetId);
}

function parsePositionId(
  targetId: string,
  prefix: "Cover" | "Wall",
): Tile | null {
  const match = new RegExp(`^${prefix}_(-?\\d+)_(-?\\d+)$`).exec(targetId);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

export function resolveTypedEntity(
  state: MatchState,
  observerId: string,
  targetId: string,
): ResolvedEntity | null {
  if (targetId === "Evac") {
    if (!hasLineOfSightVisibleTarget(state, observerId, targetId)) return null;
    return {
      kind: "evac",
      tile: copyTile(state.world.evac.centre),
      stopAtRange: 0,
    };
  }

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
      stopAtRange: 2,
    };
  }

  if (targetId.startsWith("Chest_") || targetId.startsWith("chest_")) {
    if (!hasLineOfSightVisibleTarget(state, observerId, targetId)) return null;
    const chest = findChestByTargetId(state, targetId);
    if (!chest) return null;
    return {
      kind: "chest",
      tile: copyTile(chest.pos),
      stopAtRange: 2,
      engineRef: { chestId: chest.id },
    };
  }

  if (targetId.startsWith("Cover_")) {
    if (!hasLineOfSightVisibleTarget(state, observerId, targetId)) return null;
    const tile = parsePositionId(targetId, "Cover");
    if (!tile) return null;
    return { kind: "cover", tile, stopAtRange: 0 };
  }

  if (targetId.startsWith("Wall_")) {
    if (!hasLineOfSightVisibleTarget(state, observerId, targetId)) return null;
    const tile = parsePositionId(targetId, "Wall");
    if (!tile) return null;
    return { kind: "wall", tile, stopAtRange: 1 };
  }

  const characterId = normaliseCharacterTargetId(targetId, state.characters);
  const character = characterId
    ? state.characters.find((c) => c.characterId === characterId)
    : undefined;
  if (character?.alive && hasLineOfSightVisibleTarget(state, observerId, targetId)) {
    return {
      kind: "character",
      tile: copyTile(character.pos),
      stopAtRange: 2,
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
      stopAtRange: 2,
      engineRef: { characterId: corpse.characterId },
    };
  }

  return null;
}
