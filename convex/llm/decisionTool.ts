import { z } from "zod";
import {
  SAFE_DEFAULT_DECISION,
  type ParsedDecision,
  type UseVariant,
} from "../engine/types.js";

export { SAFE_DEFAULT_DECISION };
export type { UseVariant };

type JsonSchema = Record<string, unknown>;

export type DecisionToolDefinition = {
  readonly type: "function";
  readonly name: "decide_turn";
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly [
      "use",
      "position",
      "action",
      "say",
      "scratchpad",
    ];
    readonly properties: {
      readonly use: JsonSchema;
      readonly position: JsonSchema;
      readonly action: JsonSchema;
      readonly say: JsonSchema;
      readonly scratchpad: JsonSchema;
    };
  };
};

const TOOL_DESCRIPTION =
  "Choose position commitment, action, memory update, and whether or not to use your consumable.";

const USE_WITH_CONSUMABLE: JsonSchema = {
  type: ["string", "null"],
  enum: ["consumable", null],
  description: "Use your equipped consumable slot, or null to use nothing.",
};

const USE_NULL_ONLY: JsonSchema = {
  type: ["null"],
  enum: [null],
  description: "No consumable is currently equipped, so nothing can be used.",
};

const POSITION_SCHEMA: JsonSchema = {
  description:
    "Choose exactly one position commitment: hold a stance, or move in a target-relative or compass direction by up to dist range.",
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["overwatch", "counter"],
          description:
            "No movement. 'overwatch' attacks anyone that moves into range, and 'counter' is defensive retaliation stance.",
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "direction", "dist"],
      properties: {
        kind: {
          type: "string",
          enum: ["move"],
          description: "Move by up to dist tiles in the chosen direction.",
        },
        direction: {
          description:
            "Direction of movement. Target-relative directions require targetId; compass directions do not.",
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "targetId"],
              properties: {
                kind: {
                  type: "string",
                  enum: ["toward", "away"],
                  description: "Move toward or away from a visible entity.",
                },
                targetId: {
                  type: "string",
                  description: "Visible entity id. Copy verbatim from Visible.",
                },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind"],
              properties: {
                kind: {
                  type: "string",
                  enum: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
                  description: "Compass bearing to move.",
                },
              },
            },
          ],
        },
        dist: {
          type: "integer",
          description: "Maximum attempted movement distance in tiles.",
        },
      },
    },
  ],
};

const ACTION_SCHEMA: JsonSchema = {
  description:
    "Choose exactly one immediate action. Action is either no-payload or target-based.",
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["none"],
          description: "Take no immediate action.",
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "targetId"],
      properties: {
        kind: {
          type: "string",
          enum: ["attack", "loot"],
          description:
            "Attack a visible living character or loot a visible crate/corpse. Pair with a target-relative move toward the same target to close range.",
        },
        targetId: {
          type: "string",
          description: "Visible target id. Copy verbatim from Visible.",
        },
      },
    },
  ],
};

export function buildDecisionTool(args: {
  useVariant: UseVariant;
}): DecisionToolDefinition {
  return {
    type: "function",
    name: "decide_turn",
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["use", "position", "action", "say", "scratchpad"],
      properties: {
        use:
          args.useVariant === "null_only"
            ? USE_NULL_ONLY
            : USE_WITH_CONSUMABLE,
        position: POSITION_SCHEMA,
        action: ACTION_SCHEMA,
        say: {
          type: ["string", "null"],
          description:
            "Speech broadcast to every agent within hearing range this turn. Reveals you if hidden in cover. Use for lies, threats, truces, baiting. Use null to stay silent.",
        },
        scratchpad: {
          type: ["string", "null"],
          description:
            "Private memory carried to future turns. Use for long term planning, trauma, critical observations. Use null to keep prior scratchpad unchanged.",
        },
      },
    },
  };
}

export const decisionTool = buildDecisionTool({
  useVariant: "consumable_or_null",
});

const CompassDirectionSchema = z.union([
  z.literal("N"),
  z.literal("NE"),
  z.literal("E"),
  z.literal("SE"),
  z.literal("S"),
  z.literal("SW"),
  z.literal("W"),
  z.literal("NW"),
]);

const DirectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("toward"),
      targetId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("away"),
      targetId: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("N") }).strict(),
  z.object({ kind: z.literal("NE") }).strict(),
  z.object({ kind: z.literal("E") }).strict(),
  z.object({ kind: z.literal("SE") }).strict(),
  z.object({ kind: z.literal("S") }).strict(),
  z.object({ kind: z.literal("SW") }).strict(),
  z.object({ kind: z.literal("W") }).strict(),
  z.object({ kind: z.literal("NW") }).strict(),
]);

void CompassDirectionSchema;

const PositionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("overwatch") }).strict(),
  z.object({ kind: z.literal("counter") }).strict(),
  z
    .object({
      kind: z.literal("move"),
      direction: DirectionSchema,
      dist: z.number().int(),
    })
    .strict(),
]);

const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("attack"),
      targetId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("loot"),
      targetId: z.string(),
    })
    .strict(),
]);

function decisionSchemaFor(useVariant: UseVariant) {
  const useSchema =
    useVariant === "null_only"
      ? z.null()
      : z.union([z.literal("consumable"), z.null()]);
  return z
    .object({
      use: useSchema,
      position: PositionSchema,
      action: ActionSchema,
      say: z.string().nullable(),
      scratchpad: z.string().nullable(),
    })
    .strict();
}

type _ZodInferredDecision = z.infer<
  ReturnType<typeof decisionSchemaFor>
>;
const _typeEqAtoB: ParsedDecision = {} as _ZodInferredDecision;
const _typeEqBtoA: _ZodInferredDecision = {} as ParsedDecision;
void _typeEqAtoB;
void _typeEqBtoA;

export type ParseDecisionResult =
  | { ok: true; decision: ParsedDecision }
  | {
      ok: false;
      error: "json_parse" | "schema_validation";
      details: string;
    };

export function parseDecision(
  rawArgs: string,
  args: { useVariant?: UseVariant } = {},
): ParseDecisionResult {
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

  const schema = decisionSchemaFor(args.useVariant ?? "consumable_or_null");
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: "schema_validation",
      details: result.error.message,
    };
  }
  const decision: ParsedDecision = result.data;
  return { ok: true, decision };
}
