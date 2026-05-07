// WP5 — pure-function unit tests for Chebyshev distance.
//
// Tests are written FIRST per AOP. Each test name references the spec
// section it covers, per the WP5 brief.
//
// Spec: concept-spec.md §4 — Chebyshev (king-move) distance.
//   "If a target is 7 east and 3 north, its distance is 7."
//   Applies to movement, vision, attack range, interact range,
//   turns-to-evac estimate.

import { describe, expect, it } from "vitest";
import { chebyshev } from "../../convex/engine/distance.js";

describe("WP5 — distance (concept-spec §4 Chebyshev)", () => {
  it("§4 — same tile distance is 0", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(chebyshev({ x: 17, y: 42 }, { x: 17, y: 42 })).toBe(0);
  });

  it("§4 — diagonal distance is the larger axis (3 east, 7 north → 7)", () => {
    // Spec example: "If a target is 7 east and 3 north, its distance is 7."
    // (Coordinate convention: y grows southward per types.ts comment, so
    //  "7 north" is dy = -7 in this engine — magnitude is the same.)
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: -7 })).toBe(7);
    expect(chebyshev({ x: 10, y: 10 }, { x: 13, y: 3 })).toBe(7);
  });

  it("§4 — pure horizontal/vertical distance is just the axis delta", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(5);
    expect(chebyshev({ x: 0, y: 0 }, { x: 0, y: 8 })).toBe(8);
    expect(chebyshev({ x: 4, y: 9 }, { x: 4, y: 2 })).toBe(7);
    expect(chebyshev({ x: 4, y: 9 }, { x: 11, y: 9 })).toBe(7);
  });

  it("§4 — negative deltas (king-move symmetry)", () => {
    // Symmetric: chebyshev(a, b) === chebyshev(b, a) for any a, b.
    const a = { x: 5, y: 5 };
    const b = { x: 1, y: 9 };
    expect(chebyshev(a, b)).toBe(4);
    expect(chebyshev(b, a)).toBe(4);
    // Single-axis negative delta.
    expect(chebyshev({ x: 5, y: 5 }, { x: 5, y: 0 })).toBe(5);
    expect(chebyshev({ x: 5, y: 5 }, { x: 0, y: 5 })).toBe(5);
    // Both axes negative.
    expect(chebyshev({ x: 10, y: 10 }, { x: 7, y: 6 })).toBe(4);
  });
});
