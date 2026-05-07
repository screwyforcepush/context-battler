// WP5 — local affordances (concept-spec §22).
//
// Pure-function module per ADR §1; no Convex imports.
//
// Affordances are short, deduped strings the WP8 digest builder embeds in
// the per-turn LLM input. They reduce model burden by surfacing the
// *currently meaningful* options ("attack Player_3, in range") rather than
// dumping the global action menu. The list is naturally bounded by what
// the engine sees as visible / in-range; no explicit cap is applied here.
//
// Movement affordances:
//   - "toward Player_X" for each visible enemy
//   - "away from Player_X" for each visible enemy
//   - "toward chest_NNN" for visible chests
//   - "toward Player_X" / "loot corpse" — corpse-targeted movement uses
//     the corpse object id (the dead character's id; e.g. "Player_5")
//   - "toward cover at (x,y)" for visible cover tiles, capped sensibly
//   - "toward evac" only when evac is revealed
//   - "to relative tile" always (the freeform movement option)
//
// Action affordances:
//   - "attack Player_X (in range)" — only when visible AND Chebyshev
//     ≤ weapon range
//   - "open chest_NNN" — only when chest visible AND in interact range 2
//   - "loot corpse_X" — only when corpse visible AND in interact range 2
//   - "overwatch" — always when alive (per concept-spec §11 — overwatch
//     is the camp stance and is always available)

import { chebyshev } from "./distance.js";
import { computeVisibleEntities } from "./vision.js";
import {
  WEAPONS,
  type CharacterState,
  type MatchState,
  type WeaponName,
} from "./types.js";

const INTERACT_RANGE = 2;
const DEFAULT_ATTACK_RANGE = 2;

/** Cap on cover-tile movement affordances to keep the digest small. WP8
 *  applies a global cap too — this is a pre-cap so the affordance list
 *  doesn't dominate. */
const COVER_AFFORDANCE_CAP = 4;

export type Affordances = { movement: string[]; actions: string[] };

/**
 * Compute local affordances for `characterId` per concept-spec §22.
 *
 * Returns plain string lists for the WP8 digest builder. Callers
 * (currently only WP8) MUST NOT depend on stable ordering beyond the
 * documented order: enemy-targeted entries grouped by id, then chests,
 * then cover, then evac, then "to relative tile" always last.
 */
export function localAffordances(
  state: MatchState,
  characterId: string,
): Affordances {
  const actor = state.characters.find((c) => c.characterId === characterId);
  if (!actor || !actor.alive) {
    return { movement: [], actions: [] };
  }

  const { visible } = computeVisibleEntities(state, characterId);
  const visibleCharIds: string[] = [];
  const visibleChests: { id: string; pos: { x: number; y: number } }[] = [];
  const visibleCorpses: { id: string; pos: { x: number; y: number } }[] = [];
  const visibleCoverTiles: { x: number; y: number }[] = [];
  for (const v of visible) {
    if (v.kind === "character") visibleCharIds.push(v.characterId);
    else if (v.kind === "chest") visibleChests.push({ id: v.objectId, pos: v.pos });
    else if (v.kind === "corpse")
      visibleCorpses.push({ id: v.objectId, pos: v.pos });
    else if (v.kind === "cover") visibleCoverTiles.push(v.pos);
  }

  const movement: string[] = [];
  const actions: string[] = [];

  // Movement — visible enemies.
  for (const id of visibleCharIds) {
    movement.push(`toward ${id}`);
    movement.push(`away from ${id}`);
  }

  // Movement — visible chests.
  for (const chest of visibleChests) {
    movement.push(`toward ${chest.id}`);
  }

  // Movement — visible corpses (movement-target uses the corpse object id;
  // distinct from the "loot corpse_X" action affordance below).
  for (const corpse of visibleCorpses) {
    movement.push(`toward ${corpse.id}`);
  }

  // Movement — visible cover tiles, capped at COVER_AFFORDANCE_CAP closest
  // to the actor.
  const closeCovers = visibleCoverTiles
    .map((t) => ({ t, d: chebyshev(actor.pos, t) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, COVER_AFFORDANCE_CAP);
  for (const { t } of closeCovers) {
    movement.push(`toward cover at (${t.x},${t.y})`);
  }

  // Movement — evac when revealed.
  if (state.world.evac.revealedAtTurn !== null) {
    movement.push("toward evac");
  }

  // Movement — relative tile is always offered.
  movement.push("to relative tile");

  // Actions — attack-in-range.
  const attackRange = weaponRange(actor);
  for (const id of visibleCharIds) {
    const target = state.characters.find((c) => c.characterId === id);
    if (!target) continue;
    if (chebyshev(actor.pos, target.pos) <= attackRange) {
      actions.push(`attack ${id} (in range)`);
    }
  }

  // Actions — open chest in range.
  for (const chest of visibleChests) {
    if (chebyshev(actor.pos, chest.pos) <= INTERACT_RANGE) {
      // Only suggest opening unopened chests — opened chests are no-op.
      const fresh = state.world.chests.find((c) => c.id === chest.id);
      if (fresh && !fresh.opened) {
        actions.push(`open ${chest.id}`);
      }
    }
  }

  // Actions — loot corpse in range.
  for (const corpse of visibleCorpses) {
    if (chebyshev(actor.pos, corpse.pos) <= INTERACT_RANGE) {
      actions.push(`loot ${corpse.id}`);
    }
  }

  // Actions — overwatch always when alive (concept-spec §11).
  actions.push("overwatch");

  return { movement, actions };
}

function weaponRange(actor: CharacterState): number {
  const w = actor.equipped.weapon;
  if (!w || w.category !== "weapon") return DEFAULT_ATTACK_RANGE;
  const tier = WEAPONS[w.name as WeaponName];
  return tier?.range ?? DEFAULT_ATTACK_RANGE;
}
