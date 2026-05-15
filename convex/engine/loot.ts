// WP3 — deterministic PRNG helper.
//
// Pure-function module per ADR §1; no Convex imports. Static crate contents
// are now hand-authored in `maps/reference.json`; this module remains as the
// shared seedable RNG for spawn assignment and future deterministic slices.

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
 * Build a deterministic rng from a string seed. Same seed → same stream of
 * floats. Used by WP3's `assignPersonasToSpawns`.
 */
export function makeRng(seed: string): () => number {
  const hash = xmur3(seed);
  return mulberry32(hash());
}
