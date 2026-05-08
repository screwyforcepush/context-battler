// WP-F.1 — persistence-adapter parity test (load-bearing for closing-10).
//
// Spec sections:
//   - architecture-decisions.md §3 (overwatch stance — engine emits
//     `fromOverwatch` + `stance` on action trace entries)
//   - architecture-decisions.md §9 (wall-blocked move emission —
//     engine emits `blockedBy: "wall"` on move trace entries)
//
// Why this file exists:
//   The schema validators in `convex/schema.ts` (and the mirror in
//   `convex/_internal_runMatch.ts`) accept `moves[].blockedBy`,
//   `actions[].fromOverwatch`, and `actions[].stance` as optional
//   fields. The engine `convex/engine/resolution.ts` and
//   `convex/engine/movement.ts` emit them. Before WP-F.1, the
//   `adaptResolutionForSchema` mapper in `convex/runMatch.ts` silently
//   stripped all three at the persistence boundary — turning closing-10
//   metrics `defensiveCounterFires`, `offensiveOverwatchFires`, and
//   `persistedBlockedMoves` into structural zeros regardless of actual
//   engine behaviour. This test pins the parity invariant: every
//   engine-emitted optional trace field MUST round-trip through the
//   adapter unchanged.
//
// Test posture (TDD):
//   Failing-first invariant — without the WP-F.1 mapper extension, the
//   `expect(...).toBe(...)` assertions on the optional fields
//   evaluate against `undefined` and the test goes RED. With the
//   conditional-spread propagation in place, every assertion is GREEN.
//   Verified manually by reverting the mapper to the WP-E pre-fix shape
//   and re-running the suite.

import { describe, expect, it } from "vitest";

import { adaptResolutionForSchema } from "../../convex/runMatch.js";
import type { ResolutionTrace } from "../../convex/engine/resolution.js";

// ─── Fixture helpers ───────────────────────────────────────────────────

/** Build a minimal `ResolutionTrace` with just the fields we want to
 *  assert on. Other arrays are empty so the adapter has nothing else
 *  to do. */
function makeTrace(overrides: Partial<ResolutionTrace> = {}): ResolutionTrace {
  return {
    consumed: [],
    speech: [],
    moves: [],
    actions: [],
    deaths: [],
    visibilityUpdates: [],
    ...overrides,
  };
}

// ─── adaptResolutionForSchema parity ───────────────────────────────────

describe("WP-F.1 — adaptResolutionForSchema preserves optional trace fields", () => {
  it("propagates moves[].blockedBy='wall' through to the schema-shape output", () => {
    const trace = makeTrace({
      moves: [
        // Wall-blocked move attempt: engine emits {from === to, blockedBy:"wall"}
        // per movement.ts:449-455.
        {
          characterId: "char_blocked",
          from: { x: 5, y: 5 },
          to: { x: 5, y: 5 },
          blockedBy: "wall",
        },
        // Successful move: no blockedBy field at all (schema validator is
        // `v.optional(v.literal("wall"))`; conditional spread MUST keep
        // this field absent on the output).
        {
          characterId: "char_moved",
          from: { x: 1, y: 1 },
          to: { x: 2, y: 1 },
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.moves).toHaveLength(2);
    expect(adapted.moves[0]!.blockedBy).toBe("wall");
    expect(adapted.moves[0]!.characterId).toBe("char_blocked");
    expect(adapted.moves[0]!.from).toEqual({ x: 5, y: 5 });
    expect(adapted.moves[0]!.to).toEqual({ x: 5, y: 5 });
    // Successful move: blockedBy MUST be absent (not undefined-as-value).
    // Convex `v.optional(...)` accepts absent OR present, never `undefined`.
    expect("blockedBy" in adapted.moves[1]!).toBe(false);
  });

  it("propagates actions[].fromOverwatch=true + stance='defensive' (counter-fire entry)", () => {
    // Defensive counter-fire: engine emits
    //   { kind:"overwatch", fromOverwatch:true, stance:"defensive" }
    // per resolution.ts:712-721.
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_overwatcher",
          kind: "overwatch",
          target: "char_attacker",
          result: "dmg 12",
          fromOverwatch: true,
          stance: "defensive",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    const entry = adapted.actions[0]!;
    expect(entry.kind).toBe("overwatch");
    expect(entry.target).toBe("char_attacker");
    expect(entry.result).toBe("dmg 12");
    expect(entry.fromOverwatch).toBe(true);
    expect(entry.stance).toBe("defensive");
  });

  it("propagates actions[].stance='offensive' (offensive overwatch fire entry)", () => {
    // Offensive overwatch fire: engine emits
    //   { kind:"overwatch", stance:"offensive" }
    // (fromOverwatch omitted by the engine; downstream consumers treat
    // absence as false). See resolution.ts:402-408.
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_overwatcher",
          kind: "overwatch",
          target: "char_target",
          result: "dmg 8",
          stance: "offensive",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    const entry = adapted.actions[0]!;
    expect(entry.stance).toBe("offensive");
    // The engine doesn't set fromOverwatch on offensive entries — the
    // adapter MUST keep it absent (conditional spread), not coerce to
    // undefined.
    expect("fromOverwatch" in entry).toBe(false);
  });

  it("leaves non-overwatch action entries unchanged (no stance/fromOverwatch fields)", () => {
    // Stationary attack — phase-1 legacy shape: kind, target, result only.
    // Both stance and fromOverwatch MUST be absent on the output.
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_attacker",
          kind: "attack",
          target: "char_defender",
          result: "dmg 10",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    const entry = adapted.actions[0]!;
    expect("stance" in entry).toBe(false);
    expect("fromOverwatch" in entry).toBe(false);
  });

  it("preserves blockedBy + fromOverwatch + stance together in a mixed trace (closing-10 metric coverage)", () => {
    // The combined invariant guards the closing-10 metrics
    //   - persistedBlockedMoves    (reads moves[].blockedBy === "wall")
    //   - defensiveCounterFires    (reads actions[].fromOverwatch + stance==="defensive")
    //   - offensiveOverwatchFires  (reads actions[].stance==="offensive")
    // all live on the SAME persisted turn row.
    const trace = makeTrace({
      moves: [
        {
          characterId: "char_blocked",
          from: { x: 0, y: 0 },
          to: { x: 0, y: 0 },
          blockedBy: "wall",
        },
      ],
      actions: [
        {
          characterId: "char_a",
          kind: "overwatch",
          target: "char_b",
          result: "dmg 5",
          stance: "offensive",
        },
        {
          characterId: "char_c",
          kind: "overwatch",
          target: "char_d",
          result: "dmg 7",
          fromOverwatch: true,
          stance: "defensive",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    // moves: wall-blocked entry intact.
    expect(adapted.moves).toHaveLength(1);
    expect(adapted.moves[0]!.blockedBy).toBe("wall");

    // actions: offensive + defensive overwatch entries both intact.
    expect(adapted.actions).toHaveLength(2);
    const offensive = adapted.actions.find((a) => a.stance === "offensive");
    const defensive = adapted.actions.find((a) => a.stance === "defensive");
    expect(offensive).toBeDefined();
    expect(defensive).toBeDefined();
    expect(defensive!.fromOverwatch).toBe(true);
    // Offensive does NOT carry fromOverwatch (engine emit-shape) — the
    // adapter MUST NOT introduce it.
    expect("fromOverwatch" in offensive!).toBe(false);
  });
});
