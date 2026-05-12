// Phase-3 WP-A.5 — schema-equivalence tests for the rebuilt decision tool.
//
// Tests are written FIRST per AOP. The point of this file is to lock the
// JSON Schema (sent to Azure) and the Zod schema (used to gate ingest)
// to the same shape.  Drift between the two would mean Azure could emit
// shapes the wrapper rejects (or vice-versa) — every literal/field below
// is a contract.
//
// Spec — phase-5 WP-A / ADR §1 move-arm consolidation:
//   - `type: "function"`, `name: "decide_turn"`, `parameters` is a single
//     object schema with `additionalProperties: false`.
//   - Required keys: ["consume","primary","move","action","say",
//     "overwatch_stance","scratchpad_update"] — all 7 declared properties
//     are required (WP-G.2 / D39 PM-lock). Zod parser is `.strict()` so the
//     JSON Schema MUST require everything Zod requires; otherwise Azure
//     legally omits a nullable field, Zod rejects, and we safe-default.
//     Reviewer-B's audit of completion-review-2 traces saw 207/234 schema
//     failures missing `say` for exactly this reason.
//   - `move` is a 4-arm `oneOf` discriminated by `kind`:
//        toward | away | relative | none. `toward` and `away` accept a
//        targetId string for any visible entity id; per-entity stopAtRange
//        is engine-side data, not a schema discriminator.
//   - `action` is a **3-arm** `oneOf` discriminated by `kind` (was 4-arm):
//        attack | loot | none.  `interact` arm is REMOVED; chest opens
//        flow through the `loot` arm with a `chest_*`-prefixed targetId.
//   - `loot.targetId: string` (was `loot.targetCorpseId`) — accepts BOTH
//        chest ids (`chest_NNN`) and corpse ids (e.g. `Player_3`).
//   - `say` and `scratchpad_update` remain nullable strings with
//     maxLength 280 / 500.
//   - `overwatch_priority` is REMOVED from the schema.
//   - `overwatch_stance: "offensive" | "defensive" | null` is NEW.  Required
//     when `primary === "overwatch"`, must be null otherwise; the Zod
//     refinement enforces stance/primary consistency.
//   - Branch A: NO `rationale` field (probe outcome — Azure exposes
//     reasoning text directly; see de-risking.md D-P3-1).
//
// `parseDecision(rawArgs)` MUST round-trip a valid `ParsedDecision`, MUST
// reject extra unknown properties, and MUST reject malformed discriminator
// arms or stance/primary mismatches. Tests are the contract.

import { describe, expect, it } from "vitest";
import {
  decisionTool,
  parseDecision,
  SAFE_DEFAULT_DECISION,
} from "../../convex/llm/decisionTool.js";
import type { ParsedDecision } from "../../convex/engine/types.js";

// Sample valid decision used across round-trip tests. Exercises the
// `relative` move arm + `attack` action arm; primary="move" so
// overwatch_stance is null.
const SAMPLE_VALID_DECISION: ParsedDecision = {
  consume: "heal",
  primary: "move",
  move: { kind: "relative", dx: 3, dy: -2 },
  action: { kind: "attack", targetCharacterId: "char_42" },
  say: "Onward.",
  overwatch_stance: null,
  scratchpad_update: "Heal then close on Player_3.",
};

function descriptionOf(value: unknown): string {
  const description = (value as { description?: unknown }).description;
  expect(typeof description).toBe("string");
  expect(description).not.toBe("");
  return description as string;
}

describe("phase-3 decisionTool — JSON Schema shape", () => {
  it("declares type=function and name=decide_turn", () => {
    expect(decisionTool.type).toBe("function");
    expect(decisionTool.name).toBe("decide_turn");
    expect(typeof decisionTool.description).toBe("string");
    expect(decisionTool.description.length).toBeGreaterThan(0);
  });

  it("required keys are exactly the 7 locked fields (WP-G.2 / D39 PM-lock)", () => {
    const params = decisionTool.parameters;
    expect(params.type).toBe("object");
    expect(params.additionalProperties).toBe(false);
    // WP-G.2 / D39: JSON Schema required[] must mirror Zod `.strict()` shape
    // exactly. All 7 declared properties are required — `say`,
    // `overwatch_stance`, `scratchpad_update` are nullable but NOT optional.
    // Without this, Azure legally omits them per the JSON Schema, Zod
    // (.strict() at decisionTool.ts:351,361) rejects, and we safe-default.
    expect([...params.required].sort()).toEqual(
      [
        "action",
        "consume",
        "move",
        "overwatch_stance",
        "primary",
        "say",
        "scratchpad_update",
      ],
    );
  });

  it("declared properties — overwatch_priority is GONE; overwatch_stance is NEW", () => {
    const props = decisionTool.parameters.properties;
    expect(Object.keys(props).sort()).toEqual([
      "action",
      "consume",
      "move",
      "overwatch_stance",
      "primary",
      "say",
      "scratchpad_update",
    ]);
    // Negative assertion — explicit guard against accidental re-introduction.
    expect((props as Record<string, unknown>).overwatch_priority).toBeUndefined();
    // Negative assertion — Branch A: no rationale field.
    expect((props as Record<string, unknown>).rationale).toBeUndefined();
  });

  it("additionalProperties: false on every move arm (4-arm union)", () => {
    const moveArms = decisionTool.parameters.properties.move.oneOf;
    expect(moveArms).toHaveLength(4);
    for (const arm of moveArms) {
      expect(arm.type).toBe("object");
      expect(arm.additionalProperties).toBe(false);
    }
    const kinds = moveArms.map((a) => a.properties.kind.const);
    expect([...kinds].sort()).toEqual(["away", "none", "relative", "toward"]);
    expect(kinds).not.toEqual(
      expect.arrayContaining([
        "toward_entity",
        "away_from_entity",
        "toward_object",
        "toward_evac",
      ]),
    );
  });

  it("toward and away move arms require targetId strings", () => {
    const moveArms = decisionTool.parameters.properties.move.oneOf;
    for (const kind of ["toward", "away"] as const) {
      const arm = moveArms.find((a) => a.properties.kind.const === kind);
      expect(arm).toBeDefined();
      expect([...arm!.required].sort()).toEqual(["kind", "targetId"]);
      const props = arm!.properties as unknown as {
        targetId?: { type: string };
        targetCharacterId?: { type: string };
        targetObjectId?: { type: string };
      };
      expect(props.targetId).toEqual({ type: "string" });
      expect(props.targetCharacterId).toBeUndefined();
      expect(props.targetObjectId).toBeUndefined();
    }
  });

  it("action is a 3-arm union — interact arm is REMOVED", () => {
    const actionArms = decisionTool.parameters.properties.action.oneOf;
    expect(actionArms).toHaveLength(3);
    for (const arm of actionArms) {
      expect(arm.type).toBe("object");
      expect(arm.additionalProperties).toBe(false);
    }
    const kinds = actionArms.map((a) => a.properties.kind.const);
    expect([...kinds].sort()).toEqual(["attack", "loot", "none"]);
    // Negative assertion — guard the deleted literal.
    expect(kinds).not.toContain("interact");
  });

  it("loot arm uses targetId (was targetCorpseId)", () => {
    const actionArms = decisionTool.parameters.properties.action.oneOf;
    const loot = actionArms.find(
      (a) => a.properties.kind.const === "loot",
    );
    expect(loot).toBeDefined();
    const props = loot!.properties as unknown as {
      kind: { const: string };
      targetId?: { type: string };
      targetCorpseId?: { type: string };
    };
    expect(props.targetId).toBeDefined();
    expect(props.targetId!.type).toBe("string");
    // Negative assertion — old field name MUST be gone.
    expect(props.targetCorpseId).toBeUndefined();
    // Required list must mention targetId, not targetCorpseId.
    expect([...loot!.required].sort()).toEqual(["kind", "targetId"]);
  });

  it("relative move arm bounds dx/dy to integers in [-12, 12]", () => {
    const moveArms = decisionTool.parameters.properties.move.oneOf;
    const relative = moveArms[0];
    expect(relative).toBeDefined();
    expect(relative!.properties.kind.const).toBe("relative");
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

  it("nullable string fields enforce maxLength caps (280/500)", () => {
    const props = decisionTool.parameters.properties;
    expect(props.say.maxLength).toBe(280);
    expect(props.scratchpad_update.maxLength).toBe(500);
    expect(props.say.type).toEqual(["string", "null"]);
    expect(props.scratchpad_update.type).toEqual(["string", "null"]);
  });

  it("overwatch_stance is a 3-value enum-with-null (offensive/defensive/null)", () => {
    const props = decisionTool.parameters.properties;
    const stance = props.overwatch_stance;
    expect(stance).toBeDefined();
    // The locked shape: `{ enum: ["offensive", "defensive", null] }`.
    // Strings + null in the same enum is the JSON Schema idiom for
    // "tri-state nullable enum" (mirrors `say`'s tri-state-but-without-cap).
    const stanceShape = stance as unknown as {
      enum: ReadonlyArray<string | null>;
    };
    expect([...stanceShape.enum].sort((a, b) =>
      String(a).localeCompare(String(b)),
    )).toEqual(["defensive", "offensive", null].sort((a, b) =>
      String(a).localeCompare(String(b)),
    ));
  });
});

describe("WP-C decisionTool — description fields carry action grammar", () => {
  it("decide_turn description carries the overwatch dual contract", () => {
    const description = decisionTool.description;
    expect(description).toContain("primary");
    expect(description).toContain("overwatch");
    expect(description).toContain("overwatch_stance");
    expect(description).toContain("required when primary='overwatch'");
    expect(description).toContain("null otherwise");
  });

  it("move description lists the 4-arm contract, stopAtRange table, and movement range", () => {
    const description = descriptionOf(
      decisionTool.parameters.properties.move,
    );
    expect(description).toContain("any visible entity id");
    expect(description).toContain("toward {targetId}");
    expect(description).toContain("away {targetId}");
    expect(description).toContain("relative dx,dy");
    expect(description).toContain("integers in [-12,12]");
    expect(description).toContain("none");
    expect(description).toContain("Character 2");
    expect(description).toContain("Chest 2");
    expect(description).toContain("Corpse 2");
    expect(description).toContain("Cover 0");
    expect(description).toContain("Wall 1");
    expect(description).toContain("Evac 0");
    expect(description).toContain("Movement range max 8 (12 w/ speed)");
    expect(description).not.toMatch(
      /toward_entity|away_from_entity|toward_object|toward_evac/,
    );
    expect(description).not.toMatch(/fallback|safe default|invalid choices/i);
  });

  it("action description lists attack, loot, none, verbatim ids, and range", () => {
    const description = descriptionOf(
      decisionTool.parameters.properties.action,
    );
    expect(description).toContain("attack Player_N");
    expect(description).toContain("loot <Chest_NNN|Corpse_Player_N>");
    expect(description).toContain("copy id verbatim");
    expect(description).toContain("none");
    expect(description).toContain("Attack/loot range 2 (Chebyshev)");
  });

  it("primary description defines the three values and overwatch pairing", () => {
    const description = descriptionOf(
      decisionTool.parameters.properties.primary,
    );
    expect(description).toContain("move");
    expect(description).toContain("stationary_action");
    expect(description).toContain("overwatch");
    expect(description).toContain("overwatch_stance");
    expect(description).toContain("offensive");
    expect(description).toContain("defensive");
    expect(description).toContain("action");
    expect(description).toContain("none");
  });

  it("overwatch_stance description defines stance semantics and null iff not overwatch", () => {
    const description = descriptionOf(
      decisionTool.parameters.properties.overwatch_stance,
    );
    expect(description).toContain("offensive");
    expect(description).toContain("first valid in-range enemy");
    expect(description).toContain("defensive");
    expect(description).toContain("counter-fire each attacker");
    expect(description).toContain("null iff primary is not overwatch");
  });

  it("scratchpad_update description carries usage, cap, and previous-turn carry-forward", () => {
    const description = descriptionOf(
      decisionTool.parameters.properties.scratchpad_update,
    );
    expect(description).toContain("core memories");
    expect(description).toContain("multi-turn objectives");
    expect(description).toContain("≤ 500 chars");
    expect(description).toContain("Scratchpad:");
    expect(description).toContain("## previous turn");
  });

  it("omits vision range from tool-schema descriptions", () => {
    const descriptions = [
      decisionTool.description,
      ...Object.values(decisionTool.parameters.properties).map((property) =>
        (property as { description?: string }).description ?? "",
      ),
    ].join("\n");

    expect(descriptions).not.toMatch(/\bvision\b/i);
    expect(descriptions).not.toContain("Vision 20");
  });
});

describe("phase-3 decisionTool — Zod parseDecision()", () => {
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
    }
  });

  it("rejects move.kind=toward without targetId", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      move: { kind: "toward" },
    });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("schema_validation");
    }
  });

  it("rejects consume = wrong_value", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      consume: "wrong_value",
    });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects move.relative with dx out of [-12, 12]", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      move: { kind: "relative", dx: 99, dy: 0 },
    });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
  });

  it("returns json_parse error on malformed JSON", () => {
    const result = parseDecision("not valid json {{{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("json_parse");
    }
  });

  it("accepts every valid move arm in turn", () => {
    const arms: ParsedDecision["move"][] = [
      { kind: "toward", targetId: "Player_3" },
      { kind: "away", targetId: "Player_3" },
      { kind: "relative", dx: 3, dy: -2 },
      { kind: "none" },
    ];
    for (const arm of arms) {
      const r = parseDecision(
        JSON.stringify({ ...SAMPLE_VALID_DECISION, move: arm }),
      );
      expect(r.ok, `move arm ${arm.kind} must validate`).toBe(true);
    }
  });

  it("accepts toward targetId strings from every visible entity namespace verbatim", () => {
    const targetIds = [
      "Player_4",
      "Chest_006",
      "chest_006",
      "Corpse_Player_5",
      "Cover_54_42",
      "Wall_64_30",
      "Evac",
    ];
    for (const targetId of targetIds) {
      const r = parseDecision(
        JSON.stringify({
          ...SAMPLE_VALID_DECISION,
          move: { kind: "toward", targetId },
        }),
      );
      expect(r.ok, `targetId ${targetId} must pass schema`).toBe(true);
    }
  });

  it("rejects all four removed legacy move arms as schema_validation", () => {
    const legacyArms = [
      { kind: "toward_entity", targetCharacterId: "Player_3" },
      { kind: "away_from_entity", targetCharacterId: "Player_3" },
      { kind: "toward_object", targetObjectId: "Chest_006" },
      { kind: "toward_evac" },
    ];
    for (const move of legacyArms) {
      const result = parseDecision(
        JSON.stringify({ ...SAMPLE_VALID_DECISION, move }),
      );
      expect(result.ok, `legacy arm ${move.kind} must reject`).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("schema_validation");
      }
    }
  });

  it("accepts every valid action arm in turn (3-arm: attack/loot/none)", () => {
    const arms: ParsedDecision["action"][] = [
      { kind: "attack", targetCharacterId: "c1" },
      { kind: "loot", targetId: "chest_005" },
      { kind: "loot", targetId: "Player_5" },
      { kind: "none" },
    ];
    for (const arm of arms) {
      const r = parseDecision(
        JSON.stringify({ ...SAMPLE_VALID_DECISION, action: arm }),
      );
      expect(r.ok, `action arm ${arm.kind} must validate`).toBe(true);
    }
  });

  it("rejects action.kind='interact' (deleted arm)", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      action: { kind: "interact", targetObjectId: "chest_005" },
    });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects loot with old targetCorpseId field name", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      action: { kind: "loot", targetCorpseId: "Player_5" },
    });
    const result = parseDecision(raw);
    expect(result.ok).toBe(false);
  });

  it("enforces max-length on say (280)", () => {
    const tooLong = "x".repeat(281);
    const r = parseDecision(
      JSON.stringify({ ...SAMPLE_VALID_DECISION, say: tooLong }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("phase-3 decisionTool — overwatch_stance refinement", () => {
  it("primary=overwatch with stance=offensive validates", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: "offensive",
    });
    const r = parseDecision(raw);
    expect(r.ok).toBe(true);
  });

  it("primary=overwatch with stance=defensive validates", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: "defensive",
    });
    const r = parseDecision(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects primary=overwatch with stance=null", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: null,
    });
    const r = parseDecision(raw);
    expect(r.ok).toBe(false);
  });

  it("rejects primary=move with stance=offensive (must be null off-overwatch)", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      primary: "move",
      overwatch_stance: "offensive",
    });
    const r = parseDecision(raw);
    expect(r.ok).toBe(false);
  });

  it("rejects primary=stationary_action with stance=defensive", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      primary: "stationary_action",
      action: { kind: "none" },
      overwatch_stance: "defensive",
    });
    const r = parseDecision(raw);
    expect(r.ok).toBe(false);
  });

  it("rejects overwatch_stance with unknown literal", () => {
    const raw = JSON.stringify({
      ...SAMPLE_VALID_DECISION,
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: "ambush",
    });
    const r = parseDecision(raw);
    expect(r.ok).toBe(false);
  });
});

describe("phase-3 decisionTool — re-export of SAFE_DEFAULT_DECISION", () => {
  it("re-exports SAFE_DEFAULT_DECISION matching engine/types.ts shape", () => {
    expect(SAFE_DEFAULT_DECISION).toEqual({
      consume: "none",
      primary: "stationary_action",
      move: { kind: "none" },
      action: { kind: "none" },
      say: null,
      overwatch_stance: null,
      scratchpad_update: null,
    });
  });
});
