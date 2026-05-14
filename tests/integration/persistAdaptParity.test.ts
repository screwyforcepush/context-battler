// WP-F.1 — persistence-adapter parity test (load-bearing for closing-10).
//
// Spec sections:
//   - Phase 6 trace contract (overwatch movement trigger + counter action)
//   - architecture-decisions.md §9 (wall-blocked move emission —
//     engine emits `blockedBy: "wall"` on move trace entries)
//
// Why this file exists:
//   The schema validators in `convex/schema.ts` (and the mirror in
//   `convex/_internal_runMatch.ts`) accept `moves[].blockedBy`,
//   `actions[].triggeredByMovement` as an optional field, and accept
//   `kind:"counter"` action entries. The engine `convex/engine/resolution.ts` and
//   `convex/engine/movement.ts` emit them. Before WP-F.1, the
//   `adaptResolutionForSchema` mapper in `convex/runMatch.ts` silently
//   stripped optional trace fields at the persistence boundary. This test pins
//   the parity invariant: every
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
import { convexToJson, jsonToConvex, type Value } from "convex/values";

import {
  adaptPriorTurnRowForBuilder,
  adaptResolutionForSchema,
} from "../../convex/runMatch.js";
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

describe("WP-F.1 — adaptResolutionForSchema preserves Phase 6 trace fields", () => {
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

  it("propagates moves[].slide through schema and prior-turn builder adapters", () => {
    const slide = {
      wallRectId: "Wall_6_4",
      axis: "E" as const,
      intent: "toward Duelist",
    };
    const trace = makeTrace({
      moves: [
        {
          characterId: "char_slider",
          from: { x: 5, y: 5 },
          to: { x: 6, y: 5 },
          slide,
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.moves).toHaveLength(1);
    expect(adapted.moves[0]!.slide).toEqual(slide);

    const prev = adaptPriorTurnRowForBuilder({
      resolution: {
        consumed: [],
        speech: [],
        moves: adapted.moves,
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        {
          characterId: "char_slider",
          decision: {
            position: { kind: "move", direction: { kind: "NE" }, dist: 1 },
          },
        },
      ],
    });

    expect(prev?.resolution.moves).toHaveLength(1);
    expect(prev?.resolution.moves[0]?.slide).toEqual(slide);
  });

  it("propagates moves[].bodyCollision through schema and prior-turn builder adapters", () => {
    const characterCollision = {
      kind: "character" as const,
      defenderId: "char_defender",
    };
    const wallCollision = {
      kind: "wall" as const,
      wallRectId: "Wall_8_5",
    };
    const trace = makeTrace({
      moves: [
        {
          characterId: "char_charger",
          from: { x: 4, y: 5 },
          to: { x: 4, y: 5 },
          bodyCollision: characterCollision,
        },
        {
          characterId: "char_wall_bumper",
          from: { x: 5, y: 5 },
          to: { x: 7, y: 5 },
          bodyCollision: wallCollision,
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.moves).toHaveLength(2);
    expect(adapted.moves[0]!.bodyCollision).toEqual(characterCollision);
    expect(adapted.moves[1]!.bodyCollision).toEqual(wallCollision);

    const prev = adaptPriorTurnRowForBuilder({
      resolution: {
        consumed: [],
        speech: [],
        moves: adapted.moves,
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        {
          characterId: "char_charger",
          decision: {
            position: { kind: "move", direction: { kind: "E" }, dist: 1 },
          },
        },
        {
          characterId: "char_wall_bumper",
          decision: {
            position: { kind: "move", direction: { kind: "E" }, dist: 5 },
          },
        },
      ],
    });

    const prevMoves = prev?.resolution.moves as
      | Array<{ bodyCollision?: typeof characterCollision | typeof wallCollision }>
      | undefined;
    expect(prevMoves?.[0]?.bodyCollision).toEqual(characterCollision);
    expect(prevMoves?.[1]?.bodyCollision).toEqual(wallCollision);
  });

  it("propagates actions[].triggeredByMovement=true on movement-triggered overwatch", () => {
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_overwatcher",
          kind: "overwatch",
          target: "Duelist",
          result: "dmg 12",
          triggeredByMovement: true,
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    const entry = adapted.actions[0]!;
    expect(entry.kind).toBe("overwatch");
    expect(entry.target).toBe("Duelist");
    expect(entry.result).toBe("dmg 12");
    expect(entry.triggeredByMovement).toBe(true);
  });

  it("keeps triggeredByMovement absent on non-trigger overwatch rows", () => {
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_overwatcher",
          kind: "overwatch",
          target: "Camper",
          result: "dmg 8",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    const entry = adapted.actions[0]!;
    expect(entry.kind).toBe("overwatch");
    expect("triggeredByMovement" in entry).toBe(false);
  });

  it("propagates counter action entries unchanged", () => {
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_counter",
          kind: "counter",
          target: "Vulture",
          result: "dmg 7",
          weapon: "sword",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    const entry = adapted.actions[0]!;
    expect(entry.kind).toBe("counter");
    expect(entry.target).toBe("Vulture");
    expect(entry.result).toBe("dmg 7");
    expect(entry.weapon).toBe("sword");
  });

  it("leaves non-overwatch action entries unchanged (no movement-trigger field)", () => {
    // Stationary attack — phase-1 legacy shape: kind, target, result only.
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
    expect("triggeredByMovement" in entry).toBe(false);
  });

  it("WP-A — propagates actions[].weapon when present", () => {
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_attacker",
          kind: "attack",
          target: "char_defender",
          result: "dmg 20",
          weapon: "axe",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    expect(adapted.actions[0]!.weapon).toBe("axe");
  });

  it("WP-A1 — propagates actions[].lootedItem when present", () => {
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_looter",
          kind: "loot",
          target: "Chest_4_5",
          result: "opened",
          lootedItem: "speed",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    expect(adapted.actions[0]!.lootedItem).toBe("speed");
  });

  it("WP-A1 — keeps actions[].lootedItem absent when omitted", () => {
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_looter",
          kind: "loot",
          target: "Chest_4_5",
          result: "empty",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    expect("lootedItem" in adapted.actions[0]!).toBe(false);
  });

  it("WP-A — keeps actions[].weapon absent when the engine omitted it", () => {
    const trace = makeTrace({
      actions: [
        {
          characterId: "char_attacker",
          kind: "attack",
          target: "char_defender",
          result: "dmg 5",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    expect(adapted.actions).toHaveLength(1);
    expect("weapon" in adapted.actions[0]!).toBe(false);
  });

  it("preserves blockedBy + triggeredByMovement + counter together in a mixed trace", () => {
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
          triggeredByMovement: true,
        },
        {
          characterId: "char_c",
          kind: "counter",
          target: "char_d",
          result: "dmg 7",
        },
      ],
    });

    const adapted = adaptResolutionForSchema(trace);

    // moves: wall-blocked entry intact.
    expect(adapted.moves).toHaveLength(1);
    expect(adapted.moves[0]!.blockedBy).toBe("wall");

    // actions: movement-triggered overwatch + counter entries both intact.
    expect(adapted.actions).toHaveLength(2);
    const overwatch = adapted.actions.find((a) => a.kind === "overwatch");
    const counter = adapted.actions.find((a) => a.kind === "counter");
    expect(overwatch).toBeDefined();
    expect(counter).toBeDefined();
    expect(overwatch!.triggeredByMovement).toBe(true);
    expect(counter!.result).toBe("dmg 7");
    expect("triggeredByMovement" in counter!).toBe(false);
  });
});

// ─── agentRecord.input optional field parity ───────────────────────────────

describe("WP-A — agentRecord.input composedUserMessage optional serialization", () => {
  function baseAgentInput() {
    return {
      systemPromptHash: "sys-hash",
      systemPromptText: "system",
      personaPromptHash: "persona-hash",
      personaPromptText: "persona",
      visibleStateDigest: "You: at (1,1)",
      scratchpadBefore: "remember this",
    };
  }

  function roundTrip(value: Record<string, Value>): Record<string, Value> {
    const roundTripped = jsonToConvex(convexToJson(value));
    if (
      typeof roundTripped !== "object" ||
      roundTripped === null ||
      Array.isArray(roundTripped)
    ) {
      throw new Error("expected object round-trip");
    }
    return roundTripped as Record<string, Value>;
  }

  it("round-trips agent input with composedUserMessage present", () => {
    const input = {
      ...baseAgentInput(),
      composedUserMessage: "persona\n\n## previous turn\nYou: no-op",
    };

    expect(roundTrip(input)).toEqual(input);
  });

  it("round-trips agent input with composedUserMessage absent", () => {
    const input = baseAgentInput();
    const roundTripped = roundTrip(input);

    expect(roundTripped).toEqual(input);
    expect("composedUserMessage" in roundTripped).toBe(false);
  });
});
