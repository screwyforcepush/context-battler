// AUTO-GENERATED FROM maps/reference.json.
// To regenerate: run `npx tsx scripts/regenerate-data.ts` (or rerun this WP's regen step).
// DO NOT EDIT BY HAND — edit the source files, then regenerate.
//
// Convex bundles only the `convex/` directory; the canonical descriptor at
// `maps/reference.json` is NOT shipped to the deployment. We embed the
// already-stripped (no `_comment`) descriptor here so `loadReferenceMap()`
// (convex/engine/map.ts) can return it without fs access. Tests in
// `tests/engine/map.test.ts` consume the loader; the canonical .json file
// remains the authoring surface.
//
// Boundary (ADR §1): pure-function module; no Convex imports.

import type { MapDescriptor } from "../engine/types.js";

export const REFERENCE_MAP_DESCRIPTOR: MapDescriptor = {
  size: { w: 100, h: 100 },
  walls: [
    { x: 18, y: 18, w: 6, h: 1 },
    { x: 24, y: 18, w: 1, h: 6 },
    { x: 76, y: 18, w: 6, h: 1 },
    { x: 75, y: 18, w: 1, h: 6 },
    { x: 18, y: 76, w: 6, h: 1 },
    { x: 24, y: 76, w: 1, h: 5 },
    { x: 76, y: 76, w: 6, h: 1 },
    { x: 75, y: 76, w: 1, h: 5 },
    { x: 35, y: 30, w: 5, h: 1 },
    { x: 60, y: 30, w: 5, h: 1 },
    { x: 35, y: 70, w: 5, h: 1 },
    { x: 60, y: 70, w: 5, h: 1 },
    { x: 30, y: 35, w: 1, h: 5 },
    { x: 30, y: 60, w: 1, h: 5 },
    { x: 69, y: 35, w: 1, h: 5 },
    { x: 69, y: 60, w: 1, h: 5 },
    { x: 44, y: 40, w: 4, h: 1 },
    { x: 52, y: 40, w: 4, h: 1 },
    { x: 44, y: 56, w: 4, h: 1 },
    { x: 52, y: 56, w: 4, h: 1 },
    { x: 40, y: 44, w: 1, h: 4 },
    { x: 56, y: 44, w: 1, h: 4 },
    { x: 40, y: 52, w: 1, h: 4 },
    { x: 56, y: 52, w: 1, h: 4 },
    { x: 12, y: 48, w: 4, h: 1 },
    { x: 84, y: 48, w: 4, h: 1 },
    { x: 48, y: 12, w: 1, h: 4 },
    { x: 48, y: 84, w: 1, h: 4 },
  ],
  coverClusters: [
    { x: 42, y: 42, w: 2, h: 2 },
    { x: 53, y: 42, w: 2, h: 2 },
    { x: 42, y: 53, w: 2, h: 2 },
    { x: 53, y: 53, w: 2, h: 2 },
    { x: 22, y: 46, w: 3, h: 3 },
    { x: 73, y: 46, w: 3, h: 3 },
    { x: 46, y: 22, w: 3, h: 3 },
    { x: 46, y: 73, w: 3, h: 3 },
    { x: 32, y: 32, w: 2, h: 2 },
    { x: 65, y: 65, w: 2, h: 2 },
  ],
  chests: [
    { x: 14, y: 14, lootTable: "starter" },
    { x: 85, y: 14, lootTable: "starter" },
    { x: 14, y: 85, lootTable: "starter" },
    { x: 85, y: 85, lootTable: "starter" },
    { x: 33, y: 33, lootTable: "weapons-light" },
    { x: 66, y: 33, lootTable: "weapons-light" },
    { x: 33, y: 66, lootTable: "weapons-heavy" },
    { x: 66, y: 66, lootTable: "weapons-heavy" },
    { x: 50, y: 25, lootTable: "consumables" },
  ],
  spawns: [
    { x: 10, y: 10 },
    { x: 50, y: 5 },
    { x: 89, y: 10 },
    { x: 94, y: 50 },
    { x: 89, y: 89 },
    { x: 50, y: 94 },
    { x: 10, y: 89 },
    { x: 5, y: 50 },
  ],
  evac: { x: 48, y: 48 },
};
