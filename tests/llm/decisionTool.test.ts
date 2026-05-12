import { describe, expect, it } from "vitest";
import type { ParsedDecision, UseVariant } from "../../convex/engine/types.js";
import {
  buildDecisionTool,
  decisionTool,
  parseDecision,
  SAFE_DEFAULT_DECISION,
} from "../../convex/llm/decisionTool.js";

type SchemaObject = Record<string, unknown>;

const VALID_DECISION: ParsedDecision = {
  use: "consumable",
  position: {
    kind: "move",
    direction: { kind: "SW" },
    dist: 5,
  },
  action: { kind: "none" },
  say: "Keep distance.",
  scratchpad: "Speed used to reposition.",
};

function props(tool = decisionTool): SchemaObject {
  return tool.parameters.properties as SchemaObject;
}

function record(value: unknown): SchemaObject {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  return value as SchemaObject;
}

function array(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function at<T>(values: T[], index: number): T {
  const value = values[index];
  expect(value).toBeDefined();
  return value as T;
}

function parse(
  decision: unknown,
  useVariant: UseVariant = "consumable_or_null",
) {
  return parseDecision(JSON.stringify(decision), { useVariant });
}

describe("phase-6 decision tool schema", () => {
  it("uses the Azure Responses flat function-tool shape", () => {
    const tool = buildDecisionTool({ useVariant: "consumable_or_null" });

    expect(tool.type).toBe("function");
    expect(tool.name).toBe("decide_turn");
    expect(tool.description).toBe(
      "Choose position commitment, action, memory update, and whether or not to use your consumable.",
    );
    const toolRecord = tool as unknown as SchemaObject;
    expect(toolRecord.function).toBeUndefined();
    expect(toolRecord.strict).toBeUndefined();
  });

  it("declares exactly the five phase-6 fields", () => {
    const params = decisionTool.parameters as SchemaObject;

    expect(params.type).toBe("object");
    expect(params.additionalProperties).toBe(false);
    expect([...(params.required as string[])].sort()).toEqual([
      "action",
      "position",
      "say",
      "scratchpad",
      "use",
    ]);
    expect(Object.keys(record(params.properties)).sort()).toEqual([
      "action",
      "position",
      "say",
      "scratchpad",
      "use",
    ]);
  });

  it("builds both use variants", () => {
    expect(
      props(buildDecisionTool({ useVariant: "consumable_or_null" })).use,
    ).toEqual({
      type: ["string", "null"],
      enum: ["consumable", null],
      description: "Use your equipped consumable slot, or null to use nothing.",
    });

    expect(props(buildDecisionTool({ useVariant: "null_only" })).use).toEqual({
      type: ["null"],
      enum: [null],
      description:
        "No consumable is currently equipped, so nothing can be used.",
    });
  });

  it("describes position as stance-or-move anyOf", () => {
    const position = record(props().position);
    const positionArms = array(position.anyOf).map(record);
    expect(positionArms).toHaveLength(2);

    const stance = at(positionArms, 0);
    expect(stance.type).toBe("object");
    expect(stance.additionalProperties).toBe(false);
    expect(stance.required).toEqual(["kind"]);
    const stanceKind = record(record(stance.properties).kind);
    expect(stanceKind.enum).toEqual(["overwatch", "counter"]);

    const move = at(positionArms, 1);
    expect(move.type).toBe("object");
    expect(move.additionalProperties).toBe(false);
    expect(move.required).toEqual(["kind", "direction", "dist"]);
    const moveProperties = record(move.properties);
    expect(record(moveProperties.kind).enum).toEqual(["move"]);
    expect(record(moveProperties.dist).type).toBe("integer");
  });

  it("describes target-relative and compass direction anyOf arms", () => {
    const position = record(props().position);
    const move = record(at(array(position.anyOf), 1));
    const direction = record(record(move.properties).direction);
    const directionArms = array(direction.anyOf).map(record);
    expect(directionArms).toHaveLength(2);

    const targetRelative = at(directionArms, 0);
    expect(targetRelative.additionalProperties).toBe(false);
    expect(targetRelative.required).toEqual(["kind", "targetId"]);
    const targetRelativeProperties = record(targetRelative.properties);
    expect(record(targetRelativeProperties.kind).enum).toEqual([
      "toward",
      "away",
    ]);
    expect(record(targetRelativeProperties.targetId).type).toBe("string");

    const compass = at(directionArms, 1);
    expect(compass.additionalProperties).toBe(false);
    expect(compass.required).toEqual(["kind"]);
    expect(record(record(compass.properties).kind).enum).toEqual([
      "N",
      "NE",
      "E",
      "SE",
      "S",
      "SW",
      "W",
      "NW",
    ]);
  });

  it("describes action as none-or-target anyOf", () => {
    const action = record(props().action);
    const actionArms = array(action.anyOf).map(record);
    expect(actionArms).toHaveLength(2);

    const none = at(actionArms, 0);
    expect(none.additionalProperties).toBe(false);
    expect(none.required).toEqual(["kind"]);
    expect(record(record(none.properties).kind).enum).toEqual(["none"]);

    const target = at(actionArms, 1);
    expect(target.additionalProperties).toBe(false);
    expect(target.required).toEqual(["kind", "targetId"]);
    const targetProperties = record(target.properties);
    expect(record(targetProperties.kind).enum).toEqual(["attack", "loot"]);
    expect(record(targetProperties.targetId).type).toBe("string");
  });
});

describe("phase-6 parseDecision", () => {
  it("round-trips a compass move", () => {
    const result = parse(VALID_DECISION);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision).toEqual(VALID_DECISION);
  });

  it("round-trips SAFE_DEFAULT_DECISION including dist zero", () => {
    const result = parse(SAFE_DEFAULT_DECISION, "null_only");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
  });

  it("accepts every compass bearing", () => {
    const bearings = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
    for (const bearing of bearings) {
      const result = parse({
        ...VALID_DECISION,
        use: null,
        position: {
          kind: "move",
          direction: { kind: bearing },
          dist: 8,
        },
      });
      expect(result.ok, `${bearing} should parse`).toBe(true);
    }
  });

  it("accepts toward and away target-relative moves", () => {
    const moves: ParsedDecision["position"][] = [
      {
        kind: "move",
        direction: { kind: "toward", targetId: "Duelist" },
        dist: 8,
      },
      {
        kind: "move",
        direction: { kind: "away", targetId: "Camper" },
        dist: 3,
      },
    ];

    for (const position of moves) {
      const result = parse({ ...VALID_DECISION, use: null, position });
      expect(result.ok, JSON.stringify(position)).toBe(true);
    }
  });

  it("accepts overwatch plus attack", () => {
    const decision: ParsedDecision = {
      use: null,
      position: { kind: "overwatch" },
      action: { kind: "attack", targetId: "Vulture" },
      say: null,
      scratchpad: "Hold angle and shoot Vulture.",
    };

    const result = parse(decision);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision).toEqual(decision);
  });

  it("accepts counter plus loot", () => {
    const decision: ParsedDecision = {
      use: null,
      position: { kind: "counter" },
      action: { kind: "loot", targetId: "Corpse_Camper" },
      say: "Truce at evac.",
      scratchpad: null,
    };

    const result = parse(decision);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision).toEqual(decision);
  });

  it("enforces the null-only use variant", () => {
    const rejected = parse(VALID_DECISION, "null_only");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toBe("schema_validation");

    const accepted = parse({ ...VALID_DECISION, use: null }, "null_only");
    expect(accepted.ok).toBe(true);
  });

  it("accepts scratchpad null as carry-forward", () => {
    const result = parse({ ...VALID_DECISION, use: null, scratchpad: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.scratchpad).toBeNull();
  });

  it("rejects unknown top-level fields", () => {
    const result = parse({ ...VALID_DECISION, unexpected: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("schema_validation");
  });

  it("rejects malformed nested arms", () => {
    const missingDirection = parse({
      ...VALID_DECISION,
      position: { kind: "move", dist: 4 },
    });
    expect(missingDirection.ok).toBe(false);

    const missingTarget = parse({
      ...VALID_DECISION,
      action: { kind: "attack" },
    });
    expect(missingTarget.ok).toBe(false);
  });

  it("returns json_parse for malformed raw arguments", () => {
    const result = parseDecision("not json", {
      useVariant: "consumable_or_null",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("json_parse");
  });
});
