// WP7 — Combat math (pure functions; no Convex imports).
//
// Spec sections:
//   - concept-spec.md §12 (deterministic damage; minimum floor 5; simultaneous)
//   - concept-spec.md §14 (weapon stat tiers; v0 range 2 across all weapons)
//   - architecture-decisions.md §6 (locked WEAPONS / ARMOUR / MIN_DAMAGE_FLOOR)
//
// Damage formula (§12):
//   `max(MIN_DAMAGE_FLOOR, round(base_dps * (1 - reductionPct)))`
//
// `base_dps` = weapon.dps number; unarmed base = MIN_DAMAGE_FLOOR (5).
// `reductionPct` = armour.reductionPct in [0, 0.40]; no armour = 0.
// Armour is percentage-based (never flat subtraction), capped strictly
// below 1.0 so no agent is ever invincible. Integer damage via Math.round,
// then clamped to MIN_DAMAGE_FLOOR.
//
// Unarmed default (§12 silence): the spec doesn't explicitly state unarmed
// damage. Engine choice: unarmed base damage = MIN_DAMAGE_FLOOR (5). This
// makes the floor binding for unarmed and keeps the math legible: a fistfight
// always deals exactly the minimum even against any armour.
//
// Simultaneous resolution (§12): the resolver collects damage events in
// phase 5 with a snapshot of HPs, then applies them in a single batch at
// end-of-phase. `applyDamage` here is the per-event applier — it does NOT
// itself enforce simultaneity; the resolver's collect-then-apply pattern
// does. This module just makes the math pure and unit-testable.

import {
  ARMOUR,
  MIN_DAMAGE_FLOOR,
  WEAPONS,
  type ArmourName,
  type ItemRef,
  type MatchState,
  type WeaponName,
} from "./types.js";

/** Default weapon range for v0 — every weapon is range 2 per §14, and
 *  unarmed inherits this default (no melee penalty in v0). */
const DEFAULT_RANGE = 2;

/** Unarmed base damage. Engine choice: equals MIN_DAMAGE_FLOOR so the
 *  floor binds against any armour. Documented in module head-note. */
const UNARMED_BASE_DAMAGE = MIN_DAMAGE_FLOOR;

/**
 * Pure damage formula per concept-spec §12.
 *
 *   damage = max(MIN_DAMAGE_FLOOR, round(base_dps * (1 - reductionPct)))
 *
 * - Missing weapon → unarmed base damage (= MIN_DAMAGE_FLOOR by engine choice).
 * - Missing armour → reductionPct = 0.
 * - Non-weapon ItemRef in the weapon slot → treated as unarmed (defensive;
 *   should never happen with a well-typed `equipped.weapon` slot).
 * - Non-armour ItemRef in the armour slot → treated as 0% reduction.
 * - Armour reductionPct is strictly < 1.0 by table contract, so no agent
 *   is ever invincible; floor ensures minimum > 0 always.
 */
export function damageFor(
  weapon: ItemRef | undefined,
  armour: ItemRef | undefined,
): number {
  const base =
    weapon && weapon.category === "weapon"
      ? WEAPONS[weapon.name as WeaponName]?.dps ?? UNARMED_BASE_DAMAGE
      : UNARMED_BASE_DAMAGE;
  const reductionPct =
    armour && armour.category === "armour"
      ? ARMOUR[armour.name as ArmourName]?.reductionPct ?? 0
      : 0;
  const gross = Math.round(base * (1 - reductionPct));
  return gross > MIN_DAMAGE_FLOOR ? gross : MIN_DAMAGE_FLOOR;
}

/**
 * Weapon range for the given equipped weapon. v0 returns 2 for every
 * weapon in the locked stat table; unarmed defaults to 2 (no melee
 * penalty in v0). Per concept-spec §14.
 */
export function weaponRange(weapon: ItemRef | undefined): number {
  if (!weapon || weapon.category !== "weapon") return DEFAULT_RANGE;
  return WEAPONS[weapon.name as WeaponName]?.range ?? DEFAULT_RANGE;
}

/**
 * Trace-safe weapon name captured at strike time. Returns undefined for
 * unarmed/corrupt slots so optional persistence fields stay absent.
 */
export function weaponNameForTrace(
  weapon: ItemRef | undefined,
): string | undefined {
  if (!weapon || weapon.category !== "weapon") return undefined;
  return weapon.name;
}

/**
 * Pure HP-reduction. Returns a NEW `MatchState` with the named defender's
 * HP reduced by `dmg`. The defender's `alive` flag is NOT flipped here —
 * death detection is the resolver's phase-6 responsibility (HP ≤ 0 at
 * end of phase 5 → flip alive=false). This separation keeps simultaneity
 * intact: an attacker that itself dies this phase can still land its
 * attack, because deaths happen AFTER damage application.
 *
 * If `defenderId` is not in `state.characters`, returns the input state
 * unchanged (defensive no-op; caller error).
 *
 * `attackerId` is accepted only for symmetry / future logging; it is
 * not used in the v0 damage formula.
 */
export function applyDamage(
  state: MatchState,
  _attackerId: string,
  defenderId: string,
  dmg: number,
): MatchState {
  const idx = state.characters.findIndex((c) => c.characterId === defenderId);
  if (idx < 0) return state;
  const next = state.characters.slice();
  const defender = next[idx]!;
  next[idx] = { ...defender, hp: defender.hp - dmg };
  return { ...state, characters: next };
}
