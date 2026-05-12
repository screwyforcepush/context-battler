import type { MatchState, Tile } from "../engine/types.js";
import { computeVisibleEntities } from "../engine/vision.js";

// Phase-3 WP-F.2 — character target id normalisation at the validator
// boundary.
//
// Per North Star §1 (locked design decision #1) and the system prompt
// (`convex/llm/systemPrompt.ts:64-71`), the agent acts on `Visible.id` —
// typed display ids of the form `Player_N`. The validator + resolver,
// however, historically compared a decision target against
// `CharacterState.characterId`, which in production is a Convex opaque
// `_id` value (`convex/runMatch.ts:200` binds `characterId = c._id`).
// That mismatch rejected every Player_N attack / move-toward target out
// of the gate as "not a living character", driving the closing-10
// `fellBackToSafeDefault` rate well past the ≤10% threshold.
//
// This helper bridges the two id spaces at the validator boundary: a
// single normalisation point, then engine-id flows through. Mirrors the
// pattern of `normaliseChestTargetId` in `convex/engine/movement.ts` —
// returns the engine-side identifier (or null when the input does not
// resolve), so callers replace their direct `c.characterId === targetId`
// comparisons with "normalise → look up → compare".
//
// Strategy:
//   1. If `targetId` exactly matches a character's engine `characterId`,
//      return it unchanged (test-fixture path; production agents act on
//      the displayName so they do not hit this branch).
//   2. Otherwise, if `targetId` matches a character's `displayName`
//      (e.g. "Player_3"), return that character's engine `characterId`.
//   3. Otherwise return null. The caller treats null as "target not a
//      known character" and emits the existing failure / no_target
//      reason — closing-10 reports key off those reason strings, so
//      preserving the wording matters.

/**
 * Normalise a character target id emitted by the LLM into its engine
 * `characterId`. Returns null when the id does not match any character
 * in `characters` (live-or-dead — liveness is the caller's check).
 *
 * The check matches `characterId` first to keep test fixtures working
 * (test characters are typically created with `characterId === "A"` etc.
 * rather than a real Convex Id), then falls back to `displayName` so
 * production Player_N literals from the LLM resolve to the engine id.
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
// Reviewer-B completion-review-2 HIGH-1: the digest renders corpse bullets
// as `Corpse_<displayName>` (e.g. `Corpse_Player_5`) per
// `convex/llm/inputBuilder.ts:516`, and the system prompt instructs
// "loot <Visible.id> — copy id verbatim". But the validator + engine
// resolvers historically only accepted `chest_*` and `Player_*` namespaces,
// rejecting every `Corpse_Player_*` corpse-loot/move-toward as "invalid
// namespace prefix". 0% corpse-loot in the closing-10 run was rejection-
// at-validator (substrate-bug), not propensity (combat-tuning).
//
// PM-lock D38: fix at the validator/engine boundary by extending
// normalisation. Do NOT change the digest rendering — North Star §1 cites
// `Corpse_Player_N` literally, and the system prompt's `loot <Visible.id>`
// instruction makes the typed-id form the contract the engine must honor.
//
// Strategy mirrors `normaliseCharacterTargetId`:
//   1. Strip the `Corpse_` prefix to get the inner display id (e.g.
//      `Player_5`).
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
 * Normalise a `Corpse_<displayName>` typed-id (digest rendering, e.g.
 * `Corpse_Player_5`) into the engine `characterId` of the corpse owner.
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
        if (character) ids.add(character.displayName);
        break;
      }
      case "chest":
        for (const id of chestTargetIds(entity.objectId)) ids.add(id);
        break;
      case "corpse": {
        const character = state.characters.find(
          (c) => c.characterId === entity.objectId,
        );
        if (character) ids.add(`Corpse_${character.displayName}`);
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
  if (!visibleTargetIds(state, observerId).has(targetId)) return null;

  if (targetId === "Evac") {
    return {
      kind: "evac",
      tile: copyTile(state.world.evac.centre),
      stopAtRange: 0,
    };
  }

  if (targetId.startsWith("Corpse_")) {
    const characterId = normaliseCorpseTargetId(targetId, state.characters);
    const corpse = characterId
      ? state.world.corpses.find((c) => c.characterId === characterId)
      : undefined;
    if (!corpse) return null;
    return {
      kind: "corpse",
      tile: copyTile(corpse.pos),
      stopAtRange: 2,
    };
  }

  if (targetId.startsWith("Chest_") || targetId.startsWith("chest_")) {
    const chest = findChestByTargetId(state, targetId);
    if (!chest) return null;
    return {
      kind: "chest",
      tile: copyTile(chest.pos),
      stopAtRange: 2,
      engineRef: { chestId: chest.id },
    };
  }

  if (targetId.startsWith("Player_")) {
    const characterId = normaliseCharacterTargetId(
      targetId,
      state.characters,
    );
    const character = characterId
      ? state.characters.find((c) => c.characterId === characterId)
      : undefined;
    if (!character) return null;
    return {
      kind: "character",
      tile: copyTile(character.pos),
      stopAtRange: 2,
      engineRef: { characterId: character.characterId },
    };
  }

  if (targetId.startsWith("Cover_")) {
    const tile = parsePositionId(targetId, "Cover");
    if (!tile) return null;
    return { kind: "cover", tile, stopAtRange: 0 };
  }

  if (targetId.startsWith("Wall_")) {
    const tile = parsePositionId(targetId, "Wall");
    if (!tile) return null;
    return { kind: "wall", tile, stopAtRange: 1 };
  }

  return null;
}
