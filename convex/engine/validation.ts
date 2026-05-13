import { chebyshev } from "./distance.js";
import { computeVisibleEntities } from "./vision.js";
import {
  normaliseCharacterTargetId,
  normaliseCorpseTargetId,
  resolveTypedEntity,
} from "../llm/idNormalisation.js";
import {
  SAFE_DEFAULT_DECISION,
  WEAPONS,
  type CharacterState,
  type MatchState,
  type ParsedDecision,
  type WeaponName,
} from "./types.js";

const DEFAULT_ATTACK_RANGE = 2;
const INTERACT_RANGE = 2;

export type ValidatorFieldErrors = Partial<
  Record<"use" | "position" | "action" | "say" | "scratchpad", string>
>;

export type ValidationResult = {
  decision: ParsedDecision;
  fieldErrors: ValidatorFieldErrors;
};

function canMovementChangeActionRange(position: ParsedDecision["position"]): boolean {
  return position.kind === "move" && position.dist > 0;
}

function findCorpseByTargetId(
  targetId: string,
  state: MatchState,
): { characterId: string; pos: { x: number; y: number } } | undefined {
  if (targetId.startsWith("Corpse_")) {
    const corpseCharId = normaliseCorpseTargetId(targetId, state.characters);
    return (
      (corpseCharId
        ? state.world.corpses.find((c) => c.characterId === corpseCharId)
        : undefined) ??
      state.world.corpses.find((c) => targetId === `Corpse_${c.characterId}`)
    );
  }

  const characterId = normaliseCharacterTargetId(targetId, state.characters);
  return (
    (characterId
      ? state.world.corpses.find((c) => c.characterId === characterId)
      : undefined) ?? state.world.corpses.find((c) => c.characterId === targetId)
  );
}

export function validateDecision(
  state: MatchState,
  characterId: string,
  decision: ParsedDecision,
): ValidationResult {
  const actor = state.characters.find((c) => c.characterId === characterId);
  const next: ParsedDecision = {
    use: decision.use,
    position: decision.position,
    action: decision.action,
    say: decision.say,
    scratchpad: decision.scratchpad,
  };
  const fieldErrors: ValidatorFieldErrors = {};

  if (!actor) {
    return {
      decision: SAFE_DEFAULT_DECISION,
      fieldErrors: {
        use: `actor '${characterId}' not found in state.characters`,
        position: `actor '${characterId}' not found in state.characters`,
        action: `actor '${characterId}' not found in state.characters`,
        say: `actor '${characterId}' not found in state.characters`,
        scratchpad: `actor '${characterId}' not found in state.characters`,
      },
    };
  }
  if (!actor.alive) {
    return {
      decision: SAFE_DEFAULT_DECISION,
      fieldErrors: {
        use: `actor '${characterId}' is not alive`,
        position: `actor '${characterId}' is not alive`,
        action: `actor '${characterId}' is not alive`,
        say: `actor '${characterId}' is not alive`,
        scratchpad: `actor '${characterId}' is not alive`,
      },
    };
  }

  const { visible } = computeVisibleEntities(state, characterId);
  const visibleCharacterIds = new Set<string>();
  for (const v of visible) {
    if (v.kind === "character") visibleCharacterIds.add(v.characterId);
  }

  if (decision.use === "consumable") {
    const consumable = actor.equipped.consumable;
    if (!consumable || consumable.category !== "consumable") {
      fieldErrors.use = "use='consumable' but actor has no consumable equipped";
      next.use = null;
    }
  }

  if (decision.position.kind === "move") {
    if (!Number.isInteger(decision.position.dist) || decision.position.dist < 0) {
      fieldErrors.position = `position.dist must be a non-negative integer; got ${JSON.stringify(decision.position.dist)}`;
      next.position = SAFE_DEFAULT_DECISION.position;
    } else {
      const direction = decision.position.direction;
      if (
        (direction.kind === "toward" || direction.kind === "away") &&
        resolveTypedEntity(state, characterId, direction.targetId) === null
      ) {
        fieldErrors.position = `position.direction target '${direction.targetId}' is not visible to actor`;
        next.position = SAFE_DEFAULT_DECISION.position;
      }
    }
  }

  switch (decision.action.kind) {
    case "attack": {
      const rawTargetId = decision.action.targetId;
      const targetId = normaliseCharacterTargetId(rawTargetId, state.characters);
      const target = targetId
        ? state.characters.find((c) => c.characterId === targetId)
        : undefined;
      if (!target || !target.alive) {
        fieldErrors.action = `attack target '${rawTargetId}' is not a living character`;
        next.action = { kind: "none" };
        break;
      }
      if (!visibleCharacterIds.has(target.characterId)) {
        fieldErrors.action = `attack target '${rawTargetId}' is not visible to actor`;
        next.action = { kind: "none" };
        break;
      }
      if (!canMovementChangeActionRange(next.position)) {
        const range = weaponRange(actor);
        if (chebyshev(actor.pos, target.pos) > range) {
          fieldErrors.action = `attack target '${rawTargetId}' is beyond weapon range ${range}`;
          next.action = { kind: "none" };
        }
      }
      break;
    }
    case "loot": {
      const rawTargetId = decision.action.targetId;
      const entity = resolveTypedEntity(state, characterId, rawTargetId);
      if (!entity || (entity.kind !== "chest" && entity.kind !== "corpse")) {
        fieldErrors.action = `loot target '${rawTargetId}' is not a visible chest or corpse`;
        next.action = { kind: "none" };
        break;
      }

      if (entity.kind === "chest") {
        const chest = state.world.chests.find((c) => c.id === rawTargetId);
        if (!chest) {
          fieldErrors.action = `loot target '${rawTargetId}' is not a known chest`;
          next.action = { kind: "none" };
          break;
        }
        if (
          !canMovementChangeActionRange(next.position) &&
          chebyshev(actor.pos, chest.pos) > INTERACT_RANGE
        ) {
          fieldErrors.action = `loot target '${rawTargetId}' is beyond interact range ${INTERACT_RANGE}`;
          next.action = { kind: "none" };
        }
        break;
      }

      const corpse = findCorpseByTargetId(rawTargetId, state);
      if (!corpse) {
        fieldErrors.action = `loot target '${rawTargetId}' is not a known corpse`;
        next.action = { kind: "none" };
        break;
      }
      if (
        !canMovementChangeActionRange(next.position) &&
        chebyshev(actor.pos, corpse.pos) > INTERACT_RANGE
      ) {
        fieldErrors.action = `loot target '${rawTargetId}' is beyond loot range ${INTERACT_RANGE}`;
        next.action = { kind: "none" };
      }
      break;
    }
    case "none":
      break;
  }

  return { decision: next, fieldErrors };
}

function weaponRange(actor: CharacterState): number {
  const w = actor.equipped.weapon;
  if (!w || w.category !== "weapon") return DEFAULT_ATTACK_RANGE;
  const tier = WEAPONS[w.name as WeaponName];
  return tier?.range ?? DEFAULT_ATTACK_RANGE;
}
