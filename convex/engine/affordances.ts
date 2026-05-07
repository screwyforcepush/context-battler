// WP5 — local affordances (concept-spec §22).
// WP10.5 — schema-aligned vocabulary (gate-1 review issue: model parroted
// English vocab; 84.5% safe-default fall-back). Strings now mirror the
// `decide_turn` tool's discriminated-union literals so the model copies a
// valid schema literal verbatim. See `convex/llm/decisionTool.ts` for the
// authoritative literal set.
//
// Pure-function module per ADR §1; no Convex imports.
//
// Affordances are short, deduped strings the WP8 digest builder embeds in
// the per-turn LLM input. They reduce model burden by surfacing the
// *currently meaningful* options ("attack: P3 (in range)") rather than
// dumping the global action menu. The list is naturally bounded by what
// the engine sees as visible / in-range; no explicit cap is applied here.
//
// Movement affordances (mirror `move.kind` literals):
//   - "toward_entity: <id>" for each visible enemy
//   - "away_from_entity: <id>" for each visible enemy
//   - "toward_object: <chestId>" for visible chests
//   - "toward_object: <corpseId>" for visible corpses (corpse object id is
//     the dead character's id; e.g. "Player_5")
//   - "relative: dx,dy" for visible cover tiles, capped sensibly (cover has
//     no dedicated schema literal — `relative` is the closest arm)
//   - "toward_evac" only when evac is revealed
//   - "relative: dx,dy" always (the freeform movement option, with empty
//     deltas placeholder so the model picks values)
//
// Action affordances (mirror `action.kind` literals; overwatch is a
// `primary` commitment, not an action.kind, but it stays the bare token
// because the model selects it via `primary: "overwatch"`):
//   - "attack: <id> (in range)" — only when visible AND Chebyshev
//     ≤ weapon range
//   - "interact: <chestId>" — only when chest visible AND in interact range 2
//   - "loot: <corpseId>" — only when corpse visible AND in interact range 2
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

  // Movement — visible enemies (schema-aligned: `toward_entity` /
  // `away_from_entity` literals from `decide_turn`).
  for (const id of visibleCharIds) {
    movement.push(`toward_entity: ${id}`);
    movement.push(`away_from_entity: ${id}`);
  }

  // Movement — visible chests (schema-aligned: `toward_object` literal).
  // WP10.5 Pass B.1: exclude *opened* chests. Phase A finding — 62.2% of
  // safe-default fallbacks were validator-rejections caused by personas
  // hammering `move:toward_object/action:interact` against already-opened
  // chests. The action arm at line ~145 already filters opened chests; this
  // mirrors that filter on the movement arm so the model never receives a
  // "walk toward this consumed chest" affordance. Per concept-spec §13
  // chests are one-shot. The chest still appears in the visible-state digest
  // (with an `[opened]` marker — see `inputBuilder.ts`) so last-known-position
  // memory is preserved.
  for (const chest of visibleChests) {
    const fresh = state.world.chests.find((c) => c.id === chest.id);
    if (fresh && fresh.opened) continue;
    movement.push(`toward_object: ${chest.id}`);
  }

  // Movement — visible corpses (movement-target uses the corpse object id;
  // distinct from the `loot: <corpseId>` action affordance below).
  for (const corpse of visibleCorpses) {
    movement.push(`toward_object: ${corpse.id}`);
  }

  // Movement — visible cover tiles, capped at COVER_AFFORDANCE_CAP closest
  // to the actor. Cover has no dedicated schema arm; render as a concrete
  // `relative: dx,dy` (the closest arm — `move.kind === "relative"` with
  // explicit dx/dy offsets from the actor).
  const closeCovers = visibleCoverTiles
    .map((t) => ({ t, d: chebyshev(actor.pos, t) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, COVER_AFFORDANCE_CAP);
  for (const { t } of closeCovers) {
    const dx = t.x - actor.pos.x;
    const dy = t.y - actor.pos.y;
    movement.push(`relative: ${dx},${dy}`);
  }

  // Movement — evac when revealed (schema-aligned: `toward_evac` literal).
  if (state.world.evac.revealedAtTurn !== null) {
    movement.push("toward_evac");
  }

  // Movement — freeform relative tile is always offered (schema-aligned:
  // `relative` literal; dx,dy are placeholders the model picks).
  movement.push("relative: dx,dy");

  // Actions — attack-in-range (schema-aligned: `attack` literal).
  const attackRange = weaponRange(actor);
  for (const id of visibleCharIds) {
    const target = state.characters.find((c) => c.characterId === id);
    if (!target) continue;
    if (chebyshev(actor.pos, target.pos) <= attackRange) {
      actions.push(`attack: ${id} (in range)`);
    }
  }

  // Actions — interact with chest in range (schema-aligned: `interact`
  // literal; only suggest unopened chests).
  for (const chest of visibleChests) {
    if (chebyshev(actor.pos, chest.pos) <= INTERACT_RANGE) {
      const fresh = state.world.chests.find((c) => c.id === chest.id);
      if (fresh && !fresh.opened) {
        actions.push(`interact: ${chest.id}`);
      }
    }
  }

  // Actions — loot corpse in range (schema-aligned: `loot` literal).
  for (const corpse of visibleCorpses) {
    if (chebyshev(actor.pos, corpse.pos) <= INTERACT_RANGE) {
      actions.push(`loot: ${corpse.id}`);
    }
  }

  // Actions — overwatch always when alive (concept-spec §11). Overwatch is
  // a `primary` commitment, not an `action.kind` literal, so the affordance
  // string stays the bare `overwatch` token.
  actions.push("overwatch");

  return { movement, actions };
}

function weaponRange(actor: CharacterState): number {
  const w = actor.equipped.weapon;
  if (!w || w.category !== "weapon") return DEFAULT_ATTACK_RANGE;
  const tier = WEAPONS[w.name as WeaponName];
  return tier?.range ?? DEFAULT_ATTACK_RANGE;
}
