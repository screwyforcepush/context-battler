// WP3 — loot tables + deterministic roll function.
//
// Pure-function module per ADR §1; no Convex imports. Every entry in
// `LOOT_TABLES` is a valid `ItemRef` over the locked v0 names from
// `types.ts` (no invented items — names are constrained by `WeaponName`,
// `ArmourName`, `ConsumableName`).
//
// Determinism contract: `rollLoot(table, rng)` consumes exactly one
// `rng()` value per call, so callers can seed a PRNG once per chest and
// reproduce contents across `expandMap` calls (same `rngSeed` + same
// `chestId` → same item).
//
// PRNG choice (mulberry32 via xmur3 string-hash seed) is documented in
// `convex/engine/map.ts` and re-exported here as `makeRng` for callers
// (loot.test.ts uses it directly to verify determinism).

import type {
  ItemRef,
  WeaponName,
  ArmourName,
  ConsumableName,
} from "./types.js";

// ─── Loot tables (locked v0 items only) ──────────────────────────────────────

const w = (name: WeaponName): ItemRef => ({ category: "weapon", name });
const a = (name: ArmourName): ItemRef => ({ category: "armour", name });
const c = (name: ConsumableName): ItemRef => ({ category: "consumable", name });

/**
 * Named loot tables referenced by `chest.lootTable` in the map descriptor
 * (`maps/reference.json`). The expander draws one item from the named
 * table per chest, deterministically per `rngSeed + chestId`.
 *
 * Table semantics:
 *  - `starter`        — a thin spread across all categories (early-game
 *                       chests near spawns).
 *  - `weapons-light`  — lower-tier weapons + cloth/leather armour.
 *  - `weapons-heavy`  — top-tier weapons + chain/plate armour.
 *  - `consumables`    — heal + speed only (rare central chest).
 *  - `armour-cache`   — armour-only (mid-tier mix).
 *  - `mixed`          — broad spread across all categories.
 *
 * WP15 may rebalance probabilities by repeating entries (e.g. listing
 * `sword` twice biases the table toward `sword`). All names below are
 * the locked v0 vocabulary from `types.ts`; do NOT add new names here.
 */
export const LOOT_TABLES: Record<string, ItemRef[]> = {
  starter: [
    w("rusty_blade"),
    w("sword"),
    a("cloth"),
    a("leather"),
    c("heal"),
  ],
  "weapons-light": [w("rusty_blade"), w("sword"), a("cloth"), a("leather")],
  "weapons-heavy": [w("axe"), w("greatsword"), a("chain"), a("plate")],
  consumables: [c("heal"), c("speed")],
  "armour-cache": [a("leather"), a("chain"), a("plate")],
  mixed: [
    w("sword"),
    w("axe"),
    a("leather"),
    a("chain"),
    c("heal"),
    c("speed"),
  ],
};

// ─── Deterministic PRNG (mulberry32 + xmur3 string-hash seed) ────────────────
//
// Why mulberry32?
//   - 32-bit state, fast, well-distributed for game-grade non-crypto needs.
//   - Pure function over its `state` closure; no external entropy.
//   - Public-domain reference implementation; straightforward to audit.
//
// Why xmur3 for seed mixing?
//   - Converts arbitrary string seeds (`rngSeed + chestId`) into a 32-bit
//     integer with good avalanche behaviour, so neighbouring seeds
//     (`"seed1"` vs `"seed2"`) produce decorrelated rng streams.
//
// Both algorithms are widely cited (e.g., bryc/code on GitHub) and are
// the canonical "JavaScript seedable PRNG" pair. We commit to them
// here so any later WP that needs a deterministic RNG (e.g., WP15 map
// tuning experiments) shares the same source of randomness.

/** xmur3 — 32-bit string hash; returns a 0-arg generator that yields the
 *  next 32-bit hash word. We use the first word as the mulberry32 seed. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 — 32-bit state PRNG; returns a 0-arg generator yielding
 *  uniform floats in [0, 1). Seeded by a 32-bit integer. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a deterministic rng from a string seed. Same seed → same stream
 * of floats. Used by WP3's `expandMap` (per chest, seeded by
 * `rngSeed + chestId`) and by WP3's `assignPersonasToSpawns`.
 */
export function makeRng(seed: string): () => number {
  const hash = xmur3(seed);
  return mulberry32(hash());
}

// ─── rollLoot ────────────────────────────────────────────────────────────────

/**
 * Pick one item uniformly at random from the named loot table using `rng`.
 * Throws if the table name is unknown (caller bug — map descriptor
 * references a table that wasn't defined here).
 *
 * Determinism: consumes exactly one `rng()` value per call, so callers
 * can chain rolls deterministically by reusing the same `rng` closure.
 */
export function rollLoot(table: string, rng: () => number): ItemRef {
  const entries = LOOT_TABLES[table];
  if (!entries || entries.length === 0) {
    throw new Error(`unknown or empty loot table: "${table}"`);
  }
  const idx = Math.floor(rng() * entries.length);
  // Clamp to the last index in the (extremely rare) edge case where rng()
  // returns exactly 1.0 and Math.floor produces entries.length.
  const safeIdx = idx >= entries.length ? entries.length - 1 : idx;
  return entries[safeIdx] as ItemRef;
}
