// WP3 — pure-function unit tests for loot table resolution.
//
// Tests are written FIRST per AOP. They exercise:
//   9. Every chest's resolved contents references a valid v0 item name.
//  10. `rollLoot` is deterministic given a seeded rng.
//  11. Every entry in `LOOT_TABLES` is a valid `ItemRef` over the locked
//      v0 names from `types.ts` (no invented items).

import { describe, expect, it } from "vitest";
import { LOOT_TABLES, rollLoot, makeRng } from "../../convex/engine/loot.js";
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

describe("WP3 — loot table integrity", () => {
  it("Test 11: every LOOT_TABLES entry is a valid ItemRef over locked v0 names", () => {
    const tableNames = Object.keys(LOOT_TABLES);
    expect(tableNames.length).toBeGreaterThan(0);
    for (const tableName of tableNames) {
      const entries = LOOT_TABLES[tableName];
      expect(entries, `loot table "${tableName}" missing`).toBeDefined();
      const arr = entries as ItemRef[];
      expect(arr.length, `loot table "${tableName}" empty`).toBeGreaterThan(0);
      for (const entry of arr) {
        expect(
          isValidItemRef(entry),
          `loot table "${tableName}" has invalid entry ${JSON.stringify(entry)}`,
        ).toBe(true);
      }
    }
  });
});

describe("WP3 — rollLoot determinism", () => {
  it("Test 10: rollLoot('starter', rngFromSeed('x')) is deterministic across calls", () => {
    const a = rollLoot("starter", makeRng("x"));
    const b = rollLoot("starter", makeRng("x"));
    expect(a).toEqual(b);
  });

  it("rollLoot returns a valid ItemRef for every named table", () => {
    for (const tableName of Object.keys(LOOT_TABLES)) {
      const ref = rollLoot(tableName, makeRng("seed-" + tableName));
      expect(isValidItemRef(ref)).toBe(true);
    }
  });
});

describe("WP3 — chest contents after expandMap reference valid v0 names", () => {
  it("Test 9: every chest in the expanded WorldState has contents referencing a locked v0 item name", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    expect(world.chests.length).toBeGreaterThan(0);
    for (const chest of world.chests) {
      expect(
        chest.contents,
        `chest ${chest.id} has null contents (chests resolve at match start)`,
      ).not.toBeNull();
      const ref = chest.contents as ItemRef;
      expect(
        isValidItemRef(ref),
        `chest ${chest.id} resolved to invalid item ${JSON.stringify(ref)}`,
      ).toBe(true);
    }
  });
});
