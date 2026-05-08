// Phase-3 WP-A.2 — the per-turn decision tool definition + Zod parser.
//
// Two artefacts ship from this module and they MUST stay in lockstep:
//
//   1. `decisionTool` — a single-tool JSON Schema, sent verbatim in every
//      request body to Azure. Mirrors phase-3 ADR §1 exactly:
//        - type: "function", name: "decide_turn"
//        - parameters: object schema with `additionalProperties: false`
//        - move: 6-arm `oneOf` discriminated by `kind` (unchanged)
//        - action: 3-arm `oneOf` discriminated by `kind` (was 4-arm —
//          `interact` arm is REMOVED; chest opens flow through the
//          `loot` arm with a `chest_*`-prefixed targetId)
//        - say / scratchpad_update: nullable strings with maxLength
//          280 / 500
//        - overwatch_stance: "offensive" | "defensive" | null
//          (replaces overwatch_priority; tri-state nullable enum)
//        - Branch A: NO `rationale` field (per de-risking.md D-P3-1
//          probe outcome — Azure exposes reasoning text directly)
//   2. `parseDecision(raw)` — JSON.parse + Zod validation against a
//      schema whose inferred type is **structurally equivalent** to
//      `ParsedDecision` from `convex/engine/types.ts`. The compile-time
//      assertions at the bottom of this file lock the equivalence —
//      drift becomes a TS error, not a runtime surprise.
//
//      Additionally, a Zod `.refine()` enforces the stance/primary
//      consistency rule (ADR §1):
//        - primary === "overwatch"  ⇒ overwatch_stance ∈ {"offensive",
//          "defensive"}
//        - primary !== "overwatch"  ⇒ overwatch_stance === null
//
// Cross-references:
//   - phase-3 ADR §1 — the canonical contract. Don't change here without
//     changing the schema validators in `convex/schema.ts`
//     (decisionValidator), the mirror in
//     `convex/_internal_runMatch.ts`, AND the type aliases in
//     `convex/engine/types.ts`.
//   - `azure-llm.md` §7 — `arguments` is a JSON-encoded string, so
//     `parseDecision` runs `JSON.parse` first.
//   - `convex/engine/validation.ts` — runs AFTER us. We gate shape +
//     stance/primary; the engine validator gates semantic claims (target
//     alive, in range, evac revealed, loot.targetId namespace validity).
//
// Boundary: this module does NOT call `fetch` or import Convex APIs. It
// is pure shape + parser logic. `convex/llm/azure.ts` consumes us.

import { z } from "zod";
import {
  SAFE_DEFAULT_DECISION,
  type ParsedDecision,
} from "../engine/types.js";

// Re-export for caller convenience (one place to import the safe
// default from). Keeps the wrapper module hermetic.
export { SAFE_DEFAULT_DECISION };

// ─── JSON Schema ToolDefinition (phase-3 ADR §1) ─────────────────────────────

// Strongly-typed shape of the decision tool. We could relax to a generic
// `Record<string, unknown>` and the request body would still serialise the
// same way, but a typed const lets `decisionTool.test.ts` assert structural
// invariants statically (e.g. `decisionTool.parameters.required`).

type EnumProp<T extends string> = { readonly enum: readonly T[] };
type IntegerBounded = {
  readonly type: "integer";
  readonly minimum: number;
  readonly maximum: number;
};
type StringProp = { readonly type: "string" };
type NullableStringWithMax = {
  readonly type: readonly ["string", "null"];
  readonly maxLength: number;
};
// Phase-3: tri-state nullable enum for overwatch_stance.
// JSON Schema idiom: `{ enum: ["offensive", "defensive", null] }`.
type StanceProp = {
  readonly enum: readonly ["offensive", "defensive", null];
};
type ObjectArm<
  Required extends readonly string[],
  Properties extends Record<string, unknown>,
> = {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: Required;
  readonly properties: Properties;
};

type MoveRelativeArm = ObjectArm<
  readonly ["kind", "dx", "dy"],
  {
    readonly kind: { readonly const: "relative" };
    readonly dx: IntegerBounded;
    readonly dy: IntegerBounded;
  }
>;
type MoveTowardEntityArm = ObjectArm<
  readonly ["kind", "targetCharacterId"],
  {
    readonly kind: { readonly const: "toward_entity" };
    readonly targetCharacterId: StringProp;
  }
>;
type MoveAwayFromEntityArm = ObjectArm<
  readonly ["kind", "targetCharacterId"],
  {
    readonly kind: { readonly const: "away_from_entity" };
    readonly targetCharacterId: StringProp;
  }
>;
type MoveTowardObjectArm = ObjectArm<
  readonly ["kind", "targetObjectId"],
  {
    readonly kind: { readonly const: "toward_object" };
    readonly targetObjectId: StringProp;
  }
>;
type MoveTowardEvacArm = ObjectArm<
  readonly ["kind"],
  { readonly kind: { readonly const: "toward_evac" } }
>;
type MoveNoneArm = ObjectArm<
  readonly ["kind"],
  { readonly kind: { readonly const: "none" } }
>;

type MoveArm =
  | MoveRelativeArm
  | MoveTowardEntityArm
  | MoveAwayFromEntityArm
  | MoveTowardObjectArm
  | MoveTowardEvacArm
  | MoveNoneArm;

type ActionAttackArm = ObjectArm<
  readonly ["kind", "targetCharacterId"],
  {
    readonly kind: { readonly const: "attack" };
    readonly targetCharacterId: StringProp;
  }
>;
// Phase-3 ADR §1 — the unified loot arm. `targetId` accepts both chest
// ids (`chest_NNN`) and corpse ids (`Player_N`); engine dispatches by
// id namespace.
type ActionLootArm = ObjectArm<
  readonly ["kind", "targetId"],
  {
    readonly kind: { readonly const: "loot" };
    readonly targetId: StringProp;
  }
>;
type ActionNoneArm = ObjectArm<
  readonly ["kind"],
  { readonly kind: { readonly const: "none" } }
>;

type ActionArm = ActionAttackArm | ActionLootArm | ActionNoneArm;

export type DecisionToolDefinition = {
  readonly type: "function";
  readonly name: "decide_turn";
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["consume", "primary", "move", "action"];
    readonly properties: {
      readonly consume: EnumProp<"none" | "heal" | "speed">;
      readonly primary: EnumProp<"move" | "stationary_action" | "overwatch">;
      readonly move: { readonly oneOf: readonly MoveArm[] };
      readonly action: { readonly oneOf: readonly ActionArm[] };
      readonly say: NullableStringWithMax;
      readonly overwatch_stance: StanceProp;
      readonly scratchpad_update: NullableStringWithMax;
    };
  };
};

/**
 * The single tool definition sent to Azure on every per-turn call.
 *
 * Sent verbatim in `tools[]` of the request body; the model is forced to
 * call it via `tool_choice: "required"` and `parallel_tool_calls: false`
 * (set by `convex/llm/azure.ts`). Free-form refusals are disallowed by
 * the contract.
 */
export const decisionTool: DecisionToolDefinition = {
  type: "function",
  name: "decide_turn",
  description:
    "Emit the agent's full per-turn decision: optional consumable, primary commitment (move/stationary_action/overwatch), a move sub-decision, an action sub-decision (attack/loot/none — chests AND corpses go through loot.targetId), optional say, overwatch_stance ('offensive' | 'defensive' | null — required when primary='overwatch', null otherwise), optional scratchpad update.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["consume", "primary", "move", "action"],
    properties: {
      consume: { enum: ["none", "heal", "speed"] },
      primary: { enum: ["move", "stationary_action", "overwatch"] },
      move: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "dx", "dy"],
            properties: {
              kind: { const: "relative" },
              dx: { type: "integer", minimum: -12, maximum: 12 },
              dy: { type: "integer", minimum: -12, maximum: 12 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "targetCharacterId"],
            properties: {
              kind: { const: "toward_entity" },
              targetCharacterId: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "targetCharacterId"],
            properties: {
              kind: { const: "away_from_entity" },
              targetCharacterId: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "targetObjectId"],
            properties: {
              kind: { const: "toward_object" },
              targetObjectId: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: { kind: { const: "toward_evac" } },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: { kind: { const: "none" } },
          },
        ],
      },
      action: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "targetCharacterId"],
            properties: {
              kind: { const: "attack" },
              targetCharacterId: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "targetId"],
            properties: {
              kind: { const: "loot" },
              targetId: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: { kind: { const: "none" } },
          },
        ],
      },
      say: { type: ["string", "null"], maxLength: 280 },
      overwatch_stance: { enum: ["offensive", "defensive", null] },
      scratchpad_update: { type: ["string", "null"], maxLength: 500 },
    },
  },
};

// ─── Zod schema (mirror of the JSON Schema above) ────────────────────────────

// `.strict()` on every object mirrors `additionalProperties: false`.
// `discriminatedUnion("kind", [...])` mirrors `oneOf` with a `kind` literal
// discriminator and gives Zod O(1) arm-selection (not full oneOf walk).

const MoveSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("relative"),
      dx: z.number().int().min(-12).max(12),
      dy: z.number().int().min(-12).max(12),
    })
    .strict(),
  z
    .object({
      kind: z.literal("toward_entity"),
      targetCharacterId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("away_from_entity"),
      targetCharacterId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("toward_object"),
      targetObjectId: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("toward_evac") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);

const ActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attack"),
      targetCharacterId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("loot"),
      targetId: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);

const StanceSchema = z.union([
  z.literal("offensive"),
  z.literal("defensive"),
  z.null(),
]);

// Phase-3 — stance/primary consistency refinement (ADR §1).
//   - primary === "overwatch"  ⇒ stance ∈ {"offensive", "defensive"}
//   - primary !== "overwatch"  ⇒ stance === null
// The refinement runs after structural Zod validation; failures emit a
// schema_validation error (not a separate code), so the wrapper's
// `failureReason` mapping stays simple.
const DecisionSchema = z
  .object({
    consume: z.enum(["none", "heal", "speed"]),
    primary: z.enum(["move", "stationary_action", "overwatch"]),
    move: MoveSchema,
    action: ActionSchema,
    say: z.string().max(280).nullable(),
    overwatch_stance: StanceSchema,
    scratchpad_update: z.string().max(500).nullable(),
  })
  .strict()
  .refine(
    (d) => {
      if (d.primary === "overwatch") return d.overwatch_stance !== null;
      return d.overwatch_stance === null;
    },
    {
      message:
        "overwatch_stance must be set ('offensive' | 'defensive') iff primary === 'overwatch'; null otherwise",
      path: ["overwatch_stance"],
    },
  );

// ─── Compile-time structural-equivalence assertions ──────────────────────────
//
// If anyone changes the Zod schema in a way that drifts from
// `ParsedDecision` in `convex/engine/types.ts`, these assignments stop
// typechecking. The equivalence runs in BOTH directions so a missing
// field on either side surfaces as a TS error — not a silent runtime
// mismatch.

type _ZodInferredDecision = z.infer<typeof DecisionSchema>;
// `_typeEqAtoB` and `_typeEqBtoA` deliberately exist for their type-side
// effect only. The leading underscore opts-in to the eslint
// `varsIgnorePattern: "^_"` rule (eslint.config.mjs).
const _typeEqAtoB: ParsedDecision = {} as _ZodInferredDecision;
const _typeEqBtoA: _ZodInferredDecision = {} as ParsedDecision;
// Keep references in sight so unused-import linting doesn't trip on the
// `_typeEq*` constants; the assignments above are the actual contract.
void _typeEqAtoB;
void _typeEqBtoA;

// ─── parseDecision ──────────────────────────────────────────────────────────

export type ParseDecisionResult =
  | { ok: true; decision: ParsedDecision }
  | {
      ok: false;
      error: "json_parse" | "schema_validation";
      details: string;
    };

/**
 * Parse the raw `arguments` string from a tool call into a
 * `ParsedDecision`.
 *
 * Two-stage gate per phase-3 ADR §1:
 *   1. JSON.parse — `arguments` is a JSON-encoded string per
 *      `azure-llm.md` §7. Failure → `{ ok: false, error: "json_parse" }`.
 *   2. Zod schema validation (incl. stance/primary refinement) —
 *      failure → `{ ok: false, error: "schema_validation" }`.
 *
 * Never throws. The wrapper (`callDecisionTool`) maps the errors to
 * `FailureReason` ("json_parse_failed" / "schema_validation_failed") and
 * preserves `rawArguments` on the trace so reviewers can see what the
 * model tried to emit.
 */
export function parseDecision(rawArgs: string): ParseDecisionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch (e) {
    return {
      ok: false,
      error: "json_parse",
      details: e instanceof Error ? e.message : String(e),
    };
  }
  const result = DecisionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: "schema_validation",
      details: result.error.message,
    };
  }
  // The double assignment proves to the compiler that DecisionSchema's
  // inferred type is assignable to `ParsedDecision`; in lockstep with
  // the structural-equivalence asserts above, this is a single source of
  // truth.
  const decision: ParsedDecision = result.data;
  return { ok: true, decision };
}
