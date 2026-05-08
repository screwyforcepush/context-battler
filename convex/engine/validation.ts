// WP5 — decision validation.
//
// Pure-function module per ADR §1; no Convex imports. Concept-spec §2A.3
// locks the engine-as-referee invariant: "the engine never trusts the LLM
// to abide by movement range, attack range, vision, simultaneity, or any
// other rule." This module is the engine's last gate before the resolver
// (WP7) consumes a decision: invalid decisions are replaced with the
// safe default.
//
// Note: decisions are *shape-validated* upstream by Zod (WP6). This
// module assumes the discriminator + required-field machinery is sound,
// and validates the *semantic* claims:
//   - Targets resolve to known entities.
//   - Targets are alive / unopened / visible.
//   - Evac is revealed when toward_evac is chosen.
//   - The actor has the consumable they want to consume.
//   - Numeric bounds (e.g. relative dx/dy ∈ [-12, 12]).
//
// Action-target *range* checks (attack / interact / loot) are skipped
// when the actor is moving (`decision.move.kind !== "none"`). Per
// concept-spec.md §9 line 447 ("Move up to 8, then optionally take one
// normal action if valid") the action range is evaluated against the
// POST-move position. The resolver is the final gate
// (resolution.ts:386–495 records `result:"out_of_range"` and no-ops
// cleanly when the post-move position is still out of range), so
// gating against the pre-move position here would reject the canonical
// move-into-range-then-act pattern. Engine-as-referee invariant
// (concept-spec §2A.3): the resolver is authoritative on positional
// outcomes; validation guards only what is known *before* the
// resolver runs.
//
// Each validation failure returns a short, human-readable `reason` plus
// SAFE_DEFAULT_DECISION. The reason feeds into the trace so reviewing
// agents can see why a decision was rejected.

import { chebyshev } from "./distance.js";
import { computeVisibleEntities } from "./vision.js";
import {
  normaliseCharacterTargetId,
  normaliseCorpseTargetId,
} from "../llm/idNormalisation.js";
import {
  SAFE_DEFAULT_DECISION,
  WEAPONS,
  type CharacterState,
  type MatchState,
  type ParsedDecision,
  type WeaponName,
} from "./types.js";

/** Default attack range when the actor has no weapon equipped. v0 is
 *  range 2 across all weapons (concept-spec §14), so "no weapon" still
 *  uses range 2 for fist/improvised attacks. WP7 may revisit. */
const DEFAULT_ATTACK_RANGE = 2;

/**
 * Normalise a chest typed-id back to its internal id form.
 *
 * The digest renders chests as `Chest_005` (typed-id convention per ADR §6
 * + concept-spec §22) but the stored chest id is `chest_005` (lowercase
 * per ADR §1 namespace dispatch). The model is instructed to "copy id
 * verbatim" and concept-spec §22 demonstrates the lowercase target form,
 * but in practice the model often copies the rendered `Chest_NNN` shape.
 *
 * This helper makes the namespace dispatch case-insensitive on the
 * `chest_` prefix (and only that prefix — `Player_` corpse ids stay
 * case-sensitive because they round-trip through `displayName` which is
 * always `Player_N` with a capital P). Lowercasing the prefix before
 * lookup means both `Chest_005` and `chest_005` resolve to the same
 * stored chest without scattering case-insensitive checks across the
 * codebase.
 *
 * Returns the input unchanged when the prefix doesn't match either case
 * (the caller's existing namespace branches handle the rejection path).
 */
function normaliseChestTargetId(targetId: string): string {
  if (targetId.startsWith("Chest_")) {
    return "chest_" + targetId.slice("Chest_".length);
  }
  return targetId;
}

/** Interact + loot range — concept-spec §13 + §6 ("Interaction range: 2 tiles"). */
const INTERACT_RANGE = 2;

/** Relative-move bound — locked by ADR §4 / concept-spec §10. The schema
 *  enforces ±12 (movement 8 default + speed-consumable cap of 12). */
const MAX_RELATIVE_DELTA = 12;

export type ValidationResult =
  | { ok: true; decision: ParsedDecision }
  | { ok: false; reason: string; safeDefault: ParsedDecision };

/**
 * Validate `decision` against `state` for the named actor. Returns either
 * `{ ok: true }` (caller forwards the decision unchanged) or
 * `{ ok: false, reason, safeDefault }` (caller substitutes the safe
 * default and persists the reason in the trace).
 *
 * The function is pure: same input → same output, no side effects.
 */
export function validateDecision(
  state: MatchState,
  characterId: string,
  decision: ParsedDecision,
): ValidationResult {
  const actor = state.characters.find((c) => c.characterId === characterId);
  if (!actor) {
    return invalid(`actor '${characterId}' not found in state.characters`);
  }
  if (!actor.alive) {
    return invalid(`actor '${characterId}' is not alive`);
  }

  // Phase-3 ADR §3 — stance/primary consistency check.
  // overwatch_stance must be non-null iff primary === "overwatch", and
  // the schema's Zod refinement already enforces this upstream. The
  // engine validator is defence-in-depth (concept-spec §2A.3 — engine
  // never trusts the wrapper on a structural claim).
  if (decision.primary === "overwatch") {
    if (
      decision.overwatch_stance !== "offensive" &&
      decision.overwatch_stance !== "defensive"
    ) {
      return invalid(
        `primary='overwatch' requires overwatch_stance ∈ {"offensive","defensive"}; got ${JSON.stringify(decision.overwatch_stance)}`,
      );
    }
  } else {
    if (decision.overwatch_stance !== null) {
      return invalid(
        `primary='${decision.primary}' requires overwatch_stance=null; got ${JSON.stringify(decision.overwatch_stance)}`,
      );
    }
  }

  // Compute visible entities once — used by both move-target and action
  // validation. (Pure: same observer state → same visible list.)
  const { visible } = computeVisibleEntities(state, characterId);
  const visibleCharacterIds = new Set<string>();
  for (const v of visible) {
    if (v.kind === "character") visibleCharacterIds.add(v.characterId);
  }

  // ── consume ──────────────────────────────────────────────────────────
  if (decision.consume === "heal" || decision.consume === "speed") {
    const consumable = actor.equipped.consumable;
    if (!consumable || consumable.category !== "consumable") {
      return invalid(
        `consume='${decision.consume}' but actor has no consumable equipped`,
      );
    }
    if (consumable.name !== decision.consume) {
      return invalid(
        `consume='${decision.consume}' but actor has consumable '${consumable.name}' equipped`,
      );
    }
  }

  // ── move ─────────────────────────────────────────────────────────────
  switch (decision.move.kind) {
    case "relative": {
      const { dx, dy } = decision.move;
      if (
        !Number.isInteger(dx) ||
        !Number.isInteger(dy) ||
        Math.abs(dx) > MAX_RELATIVE_DELTA ||
        Math.abs(dy) > MAX_RELATIVE_DELTA
      ) {
        return invalid(
          `move.kind='relative' has out-of-range delta (${dx},${dy}); bound is ±${MAX_RELATIVE_DELTA}`,
        );
      }
      break;
    }
    case "toward_entity":
    case "away_from_entity": {
      const rawTargetId = decision.move.targetCharacterId;
      if (!rawTargetId) {
        return invalid(
          `move.kind === '${decision.move.kind}' missing targetCharacterId`,
        );
      }
      // Phase-3 WP-F.2 — bridge the LLM-contract id space (typed
      // displayName, e.g. `Player_3`) to the engine `characterId`
      // space. See `convex/llm/idNormalisation.ts` for the rationale.
      const targetId = normaliseCharacterTargetId(
        rawTargetId,
        state.characters,
      );
      if (!targetId) {
        return invalid(
          `move target '${rawTargetId}' is not a living character`,
        );
      }
      const target = state.characters.find((c) => c.characterId === targetId);
      if (!target || !target.alive) {
        return invalid(
          `move target '${rawTargetId}' is not a living character`,
        );
      }
      if (!visibleCharacterIds.has(targetId)) {
        return invalid(
          `move target '${rawTargetId}' is not visible to actor`,
        );
      }
      break;
    }
    case "toward_object": {
      const rawTargetId = decision.move.targetObjectId;
      if (!rawTargetId) {
        return invalid(`move.kind='toward_object' missing targetObjectId`);
      }
      // Phase-3 WP-G.1 — accept the digest's `Corpse_<displayName>` typed-id
      // form (rendered by `convex/llm/inputBuilder.ts:516`). Resolve to the
      // engine `characterId` so `state.world.corpses.find(c =>
      // c.characterId === resolved)` matches in production where
      // `corpse.characterId` is the Convex `_id`. PM-lock D38: validator-
      // boundary normalisation only; digest rendering stays as-is.
      if (rawTargetId.startsWith("Corpse_")) {
        const corpseCharId = normaliseCorpseTargetId(
          rawTargetId,
          state.characters,
        );
        const corpse = corpseCharId
          ? state.world.corpses.find((c) => c.characterId === corpseCharId)
          : state.world.corpses.find((c) =>
              // Test-fixture path: corpse.characterId may itself be the
              // typed Player_N literal — match against `Corpse_<corpse.characterId>`.
              rawTargetId === `Corpse_${c.characterId}`,
            );
        if (!corpse) {
          return invalid(
            `move.kind='toward_object' targetObjectId='${rawTargetId}' is not a known chest or corpse`,
          );
        }
        break;
      }
      // Phase-3 fix — accept both `Chest_NNN` (rendered typed-id) and
      // `chest_NNN` (internal id). See `normaliseChestTargetId` rationale.
      const targetId = normaliseChestTargetId(rawTargetId);
      const isChest = state.world.chests.some((c) => c.id === targetId);
      const isCorpse = state.world.corpses.some(
        (c) => c.characterId === targetId,
      );
      if (!isChest && !isCorpse) {
        return invalid(
          `move.kind='toward_object' targetObjectId='${rawTargetId}' is not a known chest or corpse`,
        );
      }
      break;
    }
    case "toward_evac": {
      if (state.world.evac.revealedAtTurn === null) {
        return invalid(
          `move.kind='toward_evac' but evac is not yet revealed (revealedAtTurn=null)`,
        );
      }
      break;
    }
    case "none":
      break;
    default: {
      // Exhaustiveness: should be unreachable when ParsedDecision is well-typed.
      const _exhaustive: never = decision.move;
      void _exhaustive;
      return invalid(`move.kind is unrecognised`);
    }
  }

  // ── action ───────────────────────────────────────────────────────────
  switch (decision.action.kind) {
    case "attack": {
      const rawTargetId = decision.action.targetCharacterId;
      if (!rawTargetId) {
        return invalid(`action.kind='attack' missing targetCharacterId`);
      }
      // Phase-3 WP-F.2 — bridge the LLM-contract id space (typed
      // displayName, e.g. `Player_3`) to the engine `characterId`
      // space. See `convex/llm/idNormalisation.ts` for the rationale.
      const targetId = normaliseCharacterTargetId(
        rawTargetId,
        state.characters,
      );
      if (!targetId) {
        return invalid(`attack target '${rawTargetId}' is not a living character`);
      }
      const target = state.characters.find((c) => c.characterId === targetId);
      if (!target || !target.alive) {
        return invalid(`attack target '${rawTargetId}' is not a living character`);
      }
      if (!visibleCharacterIds.has(targetId)) {
        return invalid(`attack target '${rawTargetId}' is not visible to actor`);
      }
      // Range check skipped when actor is moving — resolver gates against
      // post-move position (concept-spec §9 line 447). See header note.
      if (decision.move.kind === "none") {
        const range = weaponRange(actor);
        if (chebyshev(actor.pos, target.pos) > range) {
          return invalid(
            `attack target '${rawTargetId}' is beyond weapon range ${range}`,
          );
        }
      }
      break;
    }
    case "loot": {
      // Phase-3 ADR §1 — unified loot validator with id-namespace
      // dispatch. Valid namespaces: `chest_*` (chest path), `Player_*`
      // (corpse path via displayName lookup). Anything else → reject.
      const rawTargetId = decision.action.targetId;
      if (!rawTargetId) {
        return invalid(`action.kind='loot' missing targetId`);
      }
      // Phase-3 WP-G.1 — accept the digest's `Corpse_<displayName>` typed-id
      // form (rendered by `convex/llm/inputBuilder.ts:516`). Resolve to the
      // engine `characterId` so `state.world.corpses.find(c =>
      // c.characterId === resolved)` matches in production where
      // `corpse.characterId` is the Convex `_id`. PM-lock D38: validator-
      // boundary normalisation only; digest rendering stays as-is, and the
      // decision.action.targetId is preserved verbatim so the resolver's
      // trace emits what the agent literally wrote (mirrors WP-F.2's
      // `traceTarget` convention at resolution.ts:454).
      if (rawTargetId.startsWith("Corpse_")) {
        const corpseCharId = normaliseCorpseTargetId(
          rawTargetId,
          state.characters,
        );
        let corpse = corpseCharId
          ? state.world.corpses.find((c) => c.characterId === corpseCharId)
          : undefined;
        if (!corpse) {
          // Test-fixture path: `corpse.characterId` is itself the typed
          // `Player_N` literal — match against `Corpse_<corpse.characterId>`.
          corpse = state.world.corpses.find(
            (c) => rawTargetId === `Corpse_${c.characterId}`,
          );
        }
        if (!corpse) {
          return invalid(
            `loot target '${rawTargetId}' is not a known corpse`,
          );
        }
        if (decision.move.kind === "none") {
          if (chebyshev(actor.pos, corpse.pos) > INTERACT_RANGE) {
            return invalid(
              `loot target '${rawTargetId}' is beyond loot range ${INTERACT_RANGE}`,
            );
          }
        }
        break;
      }
      // Phase-3 fix — accept both `Chest_NNN` (rendered typed-id) and
      // `chest_NNN` (internal id). Player_* corpse ids stay
      // case-sensitive (they round-trip through displayName which is
      // always `Player_N` with capital P).
      const targetId = normaliseChestTargetId(rawTargetId);
      if (targetId.startsWith("chest_")) {
        const chest = state.world.chests.find((c) => c.id === targetId);
        if (!chest) {
          return invalid(`loot target '${rawTargetId}' is not a known chest`);
        }
        if (chest.opened) {
          return invalid(`loot target '${rawTargetId}' is already opened`);
        }
        if (decision.move.kind === "none") {
          if (chebyshev(actor.pos, chest.pos) > INTERACT_RANGE) {
            return invalid(
              `loot target '${rawTargetId}' is beyond interact range ${INTERACT_RANGE}`,
            );
          }
        }
        break;
      }

      if (targetId.startsWith("Player_")) {
        // Player_* dispatch: resolve via direct match first (test
        // fixtures), then via displayName lookup → characterId →
        // corpse (production: corpse.characterId is a Convex Id).
        let corpse = state.world.corpses.find(
          (c) => c.characterId === targetId,
        );
        if (!corpse) {
          const ch = state.characters.find(
            (c) => c.displayName === targetId,
          );
          if (ch) {
            corpse = state.world.corpses.find(
              (c) => c.characterId === ch.characterId,
            );
          }
        }
        if (!corpse) {
          return invalid(`loot target '${targetId}' is not a known corpse`);
        }
        if (decision.move.kind === "none") {
          if (chebyshev(actor.pos, corpse.pos) > INTERACT_RANGE) {
            return invalid(
              `loot target '${targetId}' is beyond loot range ${INTERACT_RANGE}`,
            );
          }
        }
        break;
      }

      // Bogus namespace — neither chest_ nor Player_ prefix.
      return invalid(
        `loot target '${targetId}' has invalid namespace prefix; expected chest_* or Player_*`,
      );
    }
    case "none":
      break;
    default: {
      const _exhaustive: never = decision.action;
      void _exhaustive;
      return invalid(`action.kind is unrecognised`);
    }
  }

  return { ok: true, decision };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function invalid(reason: string): ValidationResult {
  return { ok: false, reason, safeDefault: SAFE_DEFAULT_DECISION };
}

function weaponRange(actor: CharacterState): number {
  const w = actor.equipped.weapon;
  if (!w || w.category !== "weapon") return DEFAULT_ATTACK_RANGE;
  const tier = WEAPONS[w.name as WeaponName];
  return tier?.range ?? DEFAULT_ATTACK_RANGE;
}
