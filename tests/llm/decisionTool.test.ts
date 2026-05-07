// WP6 — schema-equivalence tests for the decision tool.
//
// Tests are written FIRST per AOP. The point of this file is to lock the
// JSON Schema (sent to Azure) and the Zod schema (used to gate ingest)
// to the same shape. If they drift, downstream consumers (WP10 trace
// persistence, the resolver in WP7) get a `decision` shape they can't trust.
//
// Spec: ADR §4 — locks the per-turn tool definition.
//   - `type: "function"`, `name: "decide_turn"`, `parameters` is a single
//     object schema with `additionalProperties: false`.
//   - Required keys: ["consume","primary","move","action"].
//   - `move` is a 6-arm `oneOf` discriminated by `kind`; `action` is 4-arm.
//   - `say`, `overwatch_priority`, `scratchpad_update` are nullable strings
//     with maxLength 280 / 80 / 500 respectively.
//
// `parseDecision(rawArgs)` MUST round-trip a valid `ParsedDecision`, MUST
// reject extra unknown properties, and MUST reject malformed discriminator
// arms. The tests are the contract.

import { describe, expect, it } from "vitest";
import {
  decisionTool,
  parseDecision,
  SAFE_DEFAULT_DECISION,
} from "../../convex/llm/decisionTool.js";
import type { ParsedDecision } from "../../convex/engine/types.js";

// Sample valid decision used across round-trip tests. Exercises the
// `relative` move arm + `attack` action arm, since those are the two
// arms with extra fields beyond `kind`.
const SAMPLE_VALID_DECISION: ParsedDecision = {
  consume: "heal",
  primary: "move",
  move: { kind: "relative", dx: 3, dy: -2 },
  action: { kind: "attack", targetCharacterId: "char_42" },
  say: "Onward.",
  overwatch_priority: null,
  scratchpad_update: "Heal then close on Player_3.",
};

describe("WP6 decisionTool — JSON Schema shape", () => {
  it("declares type=function and name=decide_turn", () => {
    expect(decisionTool.type).toBe("function");
    expect(decisionTool.name).toBe("decide_turn");
    expect(typeof decisionTool.description).toBe("string");
    expect(decisionTool.description.length).toBeGreaterThan(0);
  });

  it("required keys are exactly the 4 locked fields", () => {
    const params = decisionTool.parameters;
    expect(params.type).toBe("object");
    expect(params.additionalProperties).toBe(false);
    // ADR §4: required = ["consume","primary","move","action"].
    expect([...params.required].sort()).toEqual(
      ["action", "consume", "move", "primary"],
    );
  });

  it("all 7 properties are declared on the parameters object", () => {
    const props = decisionTool.parameters.properties;
    expect(Object.keys(props).sort()).toEqual([
      "action",
      "consume",
      "move",
      "overwatch_priority",
      "primary",
      "say",
      "scratchpad_update",
    ]);
  });

  it("additionalProperties: false on every move arm", () => {
    const moveArms = decisionTool.parameters.properties.move.oneOf;
    expect(moveArms).toHaveLength(6);
    for (const arm of moveArms) {
      expect(arm.type).toBe("object");
      expect(arm.additionalProperties).toBe(false);
    }
    // Verify the 6 expected `kind` literals are all present.
    const kinds = moveArms.map((a) => a.properties.kind.const);
    expect([...kinds].sort()).toEqual([
      "away_from_entity",
      "none",
      "relative",
      "toward_entity",
      "toward_evac",
      "toward_object",
    ]);
  });

  it("additionalProperties: false on every action arm", () => {
    const actionArms = decisionTool.parameters.properties.action.oneOf;
    expect(actionArms).toHaveLength(4);
    for (const arm of actionArms) {
      expect(arm.type).toBe("object");
      expect(arm.additionalProperties).toBe(false);
    }
    const kinds = actionArms.map((a) => a.properties.kind.const);
    expect([...kinds].sort()).toEqual(["attack", "interact", "loot", "none"]);
  });

  it("relative move arm bounds dx/dy to integers in [-12, 12]", () => {
    const moveArms = decisionTool.parameters.properties.move.oneOf;
    // First arm of `move.oneOf` is locked to be `relative` per ADR §4.
    const relative = moveArms[0];
    expect(relative).toBeDefined();
    expect(relative!.properties.kind.const).toBe("relative");
    // Cast to a structural type that captures only the fields we test —
    // bypasses discriminated-union narrowing while still typechecking.
    const props = relative!.properties as unknown as {
      kind: { const: string };
      dx: { type: string; minimum: number; maximum: number };
      dy: { type: string; minimum: number; maximum: number };
    };
    expect(props.dx.type).toBe("integer");
    expect(props.dx.minimum).toBe(-12);
    expect(props.dx.maximum).toBe(12);
    expect(props.dy.type).toBe("integer");
    expect(props.dy.minimum).toBe(-12);
    expect(props.dy.maximum).toBe(12);
  });

  it("nullable string fields enforce maxLength caps (280/80/500)", () => {
    const props = decisionTool.parameters.properties;
    expect(props.say.maxLength).toBe(280);
    expect(props.overwatch_priority.maxLength).toBe(80);
    expect(props.scratchpad_update.maxLength).toBe(500);
    // ADR §4: type is the JSON Schema two-element array ["string", "null"].
    expect(props.say.type).toEqual(["string", "null"]);
    expect(props.overwatch_priority.type).toEqual(["string", "null"]);
    expect(props.scratchpad_update.type).toEqual(["string", "null"]);
  });
});

describe("WP6 decisionTool — Zod parseDecision()", () => {
  it("round-trips a sample valid ParsedDecision exactly", () => {
    const raw = JSON.stringify(SAMPLE_VALID_DECISION);
    const result = parseDecision(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision).toEqual(SAMPLE_VALID_DECISION);
    }
  });

  it("round-trips SAFE_DEFAULT_DECISION", () => {
    const result = parseDecision(JSON.stringify(SAFE_DEFAULT_DECISION));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
    }
  });

  it("rejects an extra unknown top-level property", () => {
    const raw = JSON.stringify({ ...SAMPLE_VALID_DECISION, junk: 1 });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("schema_validation");
      expect(result.details).toBeTruthy();
    }
  });

  it("rejects move.kind=toward_entity without targetCharacterId", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      move: { kind: "toward_entity" }, // missing targetCharacterId
    });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("schema_validation");
    }
  });

  it("rejects consume = wrong_value", () => {
    const raw = JSON.stringify({ ...SAMPLE_VALID_DECISION, consume: "wrong_value" });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("schema_validation");
    }
  });

  it("rejects move.relative with dx out of [-12, 12]", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      move: { kind: "relative", dx: 99, dy: 0 },
    });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("schema_validation");
    }
  });

  it("returns json_parse error on malformed JSON", () => {
    const result = parseDecision("not valid json {{{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("json_parse");
      expect(result.details).toBeTruthy();
    }
  });

  it("accepts every valid move arm in turn", () => {
    const arms: ParsedDecision["move"][] = [
      { kind: "relative", dx: 0, dy: 0 },
      { kind: "toward_entity", targetCharacterId: "c1" },
      { kind: "away_from_entity", targetCharacterId: "c2" },
      { kind: "toward_object", targetObjectId: "chest_1" },
      { kind: "toward_evac" },
      { kind: "none" },
    ];
    for (const arm of arms) {
      const r = parseDecision(
        JSON.stringify({ ...SAMPLE_VALID_DECISION, move: arm }),
      );
      expect(r.ok, `move arm ${arm.kind} must validate`).toBe(true);
    }
  });

  it("accepts every valid action arm in turn", () => {
    const arms: ParsedDecision["action"][] = [
      { kind: "attack", targetCharacterId: "c1" },
      { kind: "interact", targetObjectId: "chest_1" },
      { kind: "loot", targetCorpseId: "corpse_1" },
      { kind: "none" },
    ];
    for (const arm of arms) {
      const r = parseDecision(
        JSON.stringify({ ...SAMPLE_VALID_DECISION, action: arm }),
      );
      expect(r.ok, `action arm ${arm.kind} must validate`).toBe(true);
    }
  });

  it("enforces max-length on say (280)", () => {
    const tooLong = "x".repeat(281);
    const r = parseDecision(
      JSON.stringify({ ...SAMPLE_VALID_DECISION, say: tooLong }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("WP6 decisionTool — re-export of SAFE_DEFAULT_DECISION", () => {
  it("re-exports SAFE_DEFAULT_DECISION matching engine/types.ts shape", () => {
    expect(SAFE_DEFAULT_DECISION).toEqual({
      consume: "none",
      primary: "stationary_action",
      move: { kind: "none" },
      action: { kind: "none" },
      say: null,
      overwatch_priority: null,
      scratchpad_update: null,
    });
  });
});
