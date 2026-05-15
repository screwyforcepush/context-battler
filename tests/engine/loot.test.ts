// WP3/WP-B — pure-function unit tests for deterministic item plumbing.
//
// Tests are written FIRST per AOP. They exercise:
//   9. Every crate's hand-authored contents references a valid catalog item.
//  10. `makeRng` remains deterministic for spawn assignment.

import { describe, expect, it } from "vitest";
import { makeRng } from "../../convex/engine/loot.js";
import { expandMap, loadReferenceMap } from "../../convex/engine/map.js";
import {
  WEAPONS,
  ARMOUR,
  CONSUMABLES,
  type ItemRef,
  type WeaponName,
  type ArmourName,
  type ConsumableName,
} from "../../convex/engine/types.js";

const VALID_WEAPONS = new Set<string>(Object.keys(WEAPONS));
const VALID_ARMOUR = new Set<string>(Object.keys(ARMOUR));
const VALID_CONSUMABLES = new Set<string>(Object.keys(CONSUMABLES));

function isValidItemRef(ref: ItemRef): boolean {
  switch (ref.category) {
    case "weapon":
      return VALID_WEAPONS.has(ref.name as WeaponName);
    case "armour":
      return VALID_ARMOUR.has(ref.name as ArmourName);
    case "consumable":
      return VALID_CONSUMABLES.has(ref.name as ConsumableName);
    default:
      return false;
  }
}

describe("WP3 — makeRng determinism", () => {
  it("Test 10: makeRng('x') produces the same stream across calls", () => {
    const a = makeRng("x");
    const b = makeRng("x");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("different seeds produce different streams for spawn assignment", () => {
    const a = makeRng("seed1");
    const b = makeRng("seed2");
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });
});

describe("WP-B — crate contents after expandMap reference valid catalog names", () => {
  it("Test 9: every crate in the expanded WorldState has hand-authored valid contents", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    expect(world.crates.length).toBeGreaterThan(0);
    for (const crate of world.crates) {
      expect(
        crate.contents,
        `crate ${crate.id} has null contents (crates resolve at match start)`,
      ).not.toBeNull();
      const ref = crate.contents as ItemRef;
      expect(
        isValidItemRef(ref),
        `crate ${crate.id} resolved to invalid item ${JSON.stringify(ref)}`,
      ).toBe(true);
    }
  });
});
