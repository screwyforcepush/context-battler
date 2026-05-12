// WP5 — pure-function unit tests for last-known position tracking.
//
// Tests are written FIRST per AOP. Spec sections: concept-spec.md §7
// ("Last-known and heard states") and ADR §6 (cap-3 oldest-first eviction).
//
//   "Duelist was last seen entering cover 2 turns ago."
//   "This creates paranoia without giving omniscience."
//
// ADR §6 locks the cap: 3 most-recent entries per observer.

import { describe, expect, it } from "vitest";
import { updateLastKnown } from "../../convex/engine/lastKnown.js";
import type {
  LastKnownEntry,
  VisibleEntity,
} from "../../convex/engine/types.js";

function visibleChar(
  characterId: string,
  pos: { x: number; y: number },
): VisibleEntity {
  return {
    kind: "character",
    characterId,
    pos,
    hpBucket: "high",
  };
}

describe("WP5 — updateLastKnown (concept-spec §7 + ADR §6 cap-3)", () => {
  it("§7 — observer sees target turn 5; out of LOS turn 6 → lastKnown holds {pos: turn-5-pos, atTurn: 5}", () => {
    let prev: LastKnownEntry[] = [];
    // Turn 5: target visible at (10, 10).
    prev = updateLastKnown(prev, [visibleChar("B", { x: 10, y: 10 })], 5);
    expect(prev).toEqual([
      { characterId: "B", pos: { x: 10, y: 10 }, atTurn: 5 },
    ]);
    // Turn 6: target out of LOS → no visible entity for B → lastKnown
    // remains the turn-5 snapshot.
    prev = updateLastKnown(prev, [], 6);
    expect(prev).toEqual([
      { characterId: "B", pos: { x: 10, y: 10 }, atTurn: 5 },
    ]);
  });

  it("ADR §6 — cap-3: observe 4 distinct targets → final lastKnown has 3 entries (oldest evicted)", () => {
    let prev: LastKnownEntry[] = [];
    prev = updateLastKnown(prev, [visibleChar("B", { x: 1, y: 1 })], 1);
    prev = updateLastKnown(prev, [visibleChar("C", { x: 2, y: 2 })], 2);
    prev = updateLastKnown(prev, [visibleChar("D", { x: 3, y: 3 })], 3);
    prev = updateLastKnown(prev, [visibleChar("E", { x: 4, y: 4 })], 4);
    expect(prev.length).toBe(3);
    const ids = prev.map((e) => e.characterId);
    // Oldest (B at turn 1) must be evicted.
    expect(ids).not.toContain("B");
    expect(ids).toContain("C");
    expect(ids).toContain("D");
    expect(ids).toContain("E");
  });

  it("§7 — re-observation updates atTurn on existing entry (no duplicate)", () => {
    let prev: LastKnownEntry[] = [];
    prev = updateLastKnown(prev, [visibleChar("B", { x: 10, y: 10 })], 5);
    // Turn 7: B visible again at a new position.
    prev = updateLastKnown(prev, [visibleChar("B", { x: 12, y: 14 })], 7);
    expect(prev.length).toBe(1);
    expect(prev[0]).toEqual({
      characterId: "B",
      pos: { x: 12, y: 14 },
      atTurn: 7,
    });
  });

  it("§7 — empty visible does not modify prev (idempotent on no observation)", () => {
    const seed: LastKnownEntry[] = [
      { characterId: "B", pos: { x: 5, y: 5 }, atTurn: 3 },
      { characterId: "C", pos: { x: 6, y: 6 }, atTurn: 4 },
    ];
    const next = updateLastKnown(seed, [], 10);
    expect(next).toEqual(seed);
    // Pure function — same input twice produces same output.
    const next2 = updateLastKnown(seed, [], 10);
    expect(next2).toEqual(seed);
  });

  it("ADR §6 — cap-3 with a re-observation: existing entry refreshes, oldest of remaining evicts", () => {
    let prev: LastKnownEntry[] = [];
    prev = updateLastKnown(prev, [visibleChar("B", { x: 1, y: 1 })], 1);
    prev = updateLastKnown(prev, [visibleChar("C", { x: 2, y: 2 })], 2);
    prev = updateLastKnown(prev, [visibleChar("D", { x: 3, y: 3 })], 3);
    // Re-observe B at turn 4 — B becomes the newest, list still ≤ 3.
    prev = updateLastKnown(prev, [visibleChar("B", { x: 9, y: 9 })], 4);
    expect(prev.length).toBe(3);
    const bEntry = prev.find((e) => e.characterId === "B");
    expect(bEntry).toEqual({
      characterId: "B",
      pos: { x: 9, y: 9 },
      atTurn: 4,
    });
    // Now add a 4th (E at turn 5) — oldest of remaining (C@2) evicts.
    prev = updateLastKnown(prev, [visibleChar("E", { x: 5, y: 5 })], 5);
    expect(prev.length).toBe(3);
    const ids = prev.map((e) => e.characterId);
    expect(ids).not.toContain("C");
    expect(ids).toContain("B");
    expect(ids).toContain("D");
    expect(ids).toContain("E");
  });

  it("§7 — non-character visible entities do not affect lastKnown", () => {
    const seed: LastKnownEntry[] = [];
    const visible: VisibleEntity[] = [
      { kind: "chest", objectId: "chest_001", pos: { x: 1, y: 1 }, opened: false },
      { kind: "cover", pos: { x: 2, y: 2 } },
      { kind: "wall", pos: { x: 3, y: 3 } },
    ];
    const next = updateLastKnown(seed, visible, 10);
    expect(next).toEqual([]);
  });
});
