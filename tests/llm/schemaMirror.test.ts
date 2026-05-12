import { describe, expect, it } from "vitest";
import type { ParsedDecision, UseVariant } from "../../convex/engine/types.js";
import {
  buildDecisionTool,
  parseDecision,
} from "../../convex/llm/decisionTool.js";

import schema from "../../convex/schema.js";
import * as runMatchInternals from "../../convex/_internal_runMatch.js";

type ValidatorJson = unknown;

const USE_VARIANTS = [
  "consumable_or_null",
  "null_only",
] as const satisfies readonly UseVariant[];

interface ValidatorWithJson {
  json: ValidatorJson;
  fields?: Record<string, ValidatorWithJson>;
  element?: ValidatorWithJson;
}

interface ConvexFunction {
  exportArgs: () => string;
}

interface ConvexFieldJson {
  fieldType: ValidatorJson;
  optional: boolean;
}

interface ConvexArgsJson {
  type: "object";
  value: Record<string, ConvexFieldJson>;
}

interface ConvexArrayJson {
  type: "array";
  value: ValidatorJson;
}

interface ConvexObjectJson {
  type: "object";
  value: Record<string, ConvexFieldJson>;
}

interface ConvexUnionJson {
  type: "union";
  value: ValidatorJson[];
}

interface ConvexLiteralJson {
  type: "literal";
  value: string;
}

function isArrayJson(j: ValidatorJson): j is ConvexArrayJson {
  return (
    typeof j === "object" &&
    j !== null &&
    (j as { type?: string }).type === "array"
  );
}

function isObjectJson(j: ValidatorJson): j is ConvexObjectJson {
  return (
    typeof j === "object" &&
    j !== null &&
    (j as { type?: string }).type === "object"
  );
}

function isUnionJson(j: ValidatorJson): j is ConvexUnionJson {
  return (
    typeof j === "object" &&
    j !== null &&
    (j as { type?: string }).type === "union"
  );
}

function isLiteralJson(j: ValidatorJson): j is ConvexLiteralJson {
  return (
    typeof j === "object" &&
    j !== null &&
    (j as { type?: string }).type === "literal" &&
    typeof (j as { value?: unknown }).value === "string"
  );
}

function objectField(
  j: ValidatorJson,
  fieldName: string,
  ownerPath: string,
): ConvexFieldJson {
  if (!isObjectJson(j)) {
    throw new Error(`${ownerPath} is not an object validator`);
  }
  const field = j.value[fieldName];
  if (!field) {
    throw new Error(`${ownerPath}.${fieldName} field missing`);
  }
  return field;
}

function arrayElement(j: ValidatorJson, ownerPath: string): ValidatorJson {
  if (!isArrayJson(j)) {
    throw new Error(`${ownerPath} is not an array validator`);
  }
  return j.value;
}

function toolRecord(value: unknown, ownerPath: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${ownerPath} is not an object`);
  }
  return value as Record<string, unknown>;
}

function toolArray(value: unknown, ownerPath: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${ownerPath} is not an array`);
  }
  return value;
}

function toolStringLiterals(value: unknown, ownerPath: string): string[] {
  const literals = toolArray(value, ownerPath);
  for (const literal of literals) {
    if (typeof literal !== "string") {
      throw new Error(`${ownerPath} contains a non-string literal`);
    }
  }
  return literals as string[];
}

function canonicaliseJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicaliseJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicaliseJson(entry)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicaliseJson(value));
}

function enumProperty(value: unknown, ownerPath: string) {
  const record = toolRecord(value, ownerPath);
  return {
    type: record.type,
    enum: toolArray(record.enum, `${ownerPath}.enum`),
  };
}

function scalarProperty(value: unknown, ownerPath: string) {
  const record = toolRecord(value, ownerPath);
  if (record.type === undefined) {
    throw new Error(`${ownerPath}.type missing`);
  }
  return { type: record.type };
}

function objectArm(value: unknown, ownerPath: string) {
  const record = toolRecord(value, ownerPath);
  return {
    type: record.type,
    additionalProperties: record.additionalProperties,
    required: toolArray(record.required, `${ownerPath}.required`),
    properties: toolRecord(record.properties, `${ownerPath}.properties`),
  };
}

function normalisedToolContract(useVariant: UseVariant) {
  const tool = buildDecisionTool({ useVariant });
  const params = tool.parameters;
  const properties = params.properties;
  const position = toolRecord(properties.position, "tool.position");
  const positionArms = toolArray(position.anyOf, "tool.position.anyOf");
  const stanceArm = objectArm(positionArms[0], "tool.position.anyOf[0]");
  const moveArm = objectArm(positionArms[1], "tool.position.anyOf[1]");
  const direction = toolRecord(
    moveArm.properties.direction,
    "tool.position.move.direction",
  );
  const directionArms = toolArray(
    direction.anyOf,
    "tool.position.move.direction.anyOf",
  );
  const targetRelativeArm = objectArm(
    directionArms[0],
    "tool.position.move.direction.anyOf[0]",
  );
  const compassArm = objectArm(
    directionArms[1],
    "tool.position.move.direction.anyOf[1]",
  );

  const action = toolRecord(properties.action, "tool.action");
  const actionArms = toolArray(action.anyOf, "tool.action.anyOf");
  const noneArm = objectArm(actionArms[0], "tool.action.anyOf[0]");
  const targetArm = objectArm(actionArms[1], "tool.action.anyOf[1]");

  return {
    type: params.type,
    additionalProperties: params.additionalProperties,
    required: [...params.required],
    properties: {
      use: enumProperty(properties.use, "tool.use"),
      position: {
        anyOf: [
          {
            type: stanceArm.type,
            additionalProperties: stanceArm.additionalProperties,
            required: stanceArm.required,
            properties: {
              kind: enumProperty(
                stanceArm.properties.kind,
                "tool.position.stance.kind",
              ),
            },
          },
          {
            type: moveArm.type,
            additionalProperties: moveArm.additionalProperties,
            required: moveArm.required,
            properties: {
              kind: enumProperty(
                moveArm.properties.kind,
                "tool.position.move.kind",
              ),
              direction: {
                anyOf: [
                  {
                    type: targetRelativeArm.type,
                    additionalProperties:
                      targetRelativeArm.additionalProperties,
                    required: targetRelativeArm.required,
                    properties: {
                      kind: enumProperty(
                        targetRelativeArm.properties.kind,
                        "tool.position.direction.relative.kind",
                      ),
                      targetId: scalarProperty(
                        targetRelativeArm.properties.targetId,
                        "tool.position.direction.relative.targetId",
                      ),
                    },
                  },
                  {
                    type: compassArm.type,
                    additionalProperties: compassArm.additionalProperties,
                    required: compassArm.required,
                    properties: {
                      kind: enumProperty(
                        compassArm.properties.kind,
                        "tool.position.direction.compass.kind",
                      ),
                    },
                  },
                ],
              },
              dist: scalarProperty(
                moveArm.properties.dist,
                "tool.position.move.dist",
              ),
            },
          },
        ],
      },
      action: {
        anyOf: [
          {
            type: noneArm.type,
            additionalProperties: noneArm.additionalProperties,
            required: noneArm.required,
            properties: {
              kind: enumProperty(noneArm.properties.kind, "tool.action.none.kind"),
            },
          },
          {
            type: targetArm.type,
            additionalProperties: targetArm.additionalProperties,
            required: targetArm.required,
            properties: {
              kind: enumProperty(
                targetArm.properties.kind,
                "tool.action.target.kind",
              ),
              targetId: scalarProperty(
                targetArm.properties.targetId,
                "tool.action.target.targetId",
              ),
            },
          },
        ],
      },
      say: scalarProperty(properties.say, "tool.say"),
      scratchpad: scalarProperty(properties.scratchpad, "tool.scratchpad"),
    },
  };
}

function parserContract(useVariant: UseVariant) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["use", "position", "action", "say", "scratchpad"],
    properties: {
      use:
        useVariant === "null_only"
          ? { type: ["null"], enum: [null] }
          : { type: ["string", "null"], enum: ["consumable", null] },
      position: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["overwatch", "counter"] },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "direction", "dist"],
            properties: {
              kind: { type: "string", enum: ["move"] },
              direction: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind", "targetId"],
                    properties: {
                      kind: { type: "string", enum: ["toward", "away"] },
                      targetId: { type: "string" },
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
                      },
                    },
                  },
                ],
              },
              dist: { type: "integer" },
            },
          },
        ],
      },
      action: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["none"] },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "targetId"],
            properties: {
              kind: { type: "string", enum: ["attack", "loot"] },
              targetId: { type: "string" },
            },
          },
        ],
      },
      say: { type: ["string", "null"] },
      scratchpad: { type: ["string", "null"] },
    },
  };
}

function parseRawDecision(decision: unknown, useVariant: UseVariant) {
  return parseDecision(JSON.stringify(decision), { useVariant });
}

function literalStrings(j: ValidatorJson, ownerPath: string): string[] {
  if (isLiteralJson(j)) return [j.value];
  if (isUnionJson(j)) {
    return j.value.flatMap((arm, index) =>
      literalStrings(arm, `${ownerPath}[${index}]`),
    );
  }
  throw new Error(`${ownerPath} has no literal string values`);
}

function schemaValidators(): {
  agentRecord: ValidatorJson;
  resolution: ValidatorJson;
} {
  const turnsRow = schema.tables.turns.validator as unknown as ValidatorWithJson;
  const fields = turnsRow.fields;
  if (!fields) throw new Error("turns validator fields missing");

  const agentRecordsArr = fields.agentRecords;
  const resolution = fields.resolution;
  if (!agentRecordsArr?.element || !resolution) {
    throw new Error("turns validator agentRecords/resolution missing");
  }

  return {
    agentRecord: agentRecordsArr.element.json,
    resolution: resolution.json,
  };
}

function mirrorValidators(): {
  agentRecord: ValidatorJson;
  resolution: ValidatorJson;
} {
  const persistTurn = runMatchInternals.persistTurn as unknown as ConvexFunction;
  const argsJson = JSON.parse(persistTurn.exportArgs()) as ConvexArgsJson;
  const agentRecordsField = argsJson.value.agentRecords;
  const resolutionField = argsJson.value.resolution;
  if (!agentRecordsField || !resolutionField) {
    throw new Error("persistTurn args missing agentRecords/resolution");
  }

  const agentRecordsArr = agentRecordsField.fieldType;
  if (!isArrayJson(agentRecordsArr)) {
    throw new Error("persistTurn agentRecords arg is not an array");
  }

  return {
    agentRecord: agentRecordsArr.value,
    resolution: resolutionField.fieldType,
  };
}

function decisionField(agentRecord: ValidatorJson, ownerPath: string) {
  return objectField(agentRecord, "decision", ownerPath).fieldType;
}

function inputField(agentRecord: ValidatorJson, ownerPath: string) {
  return objectField(agentRecord, "input", ownerPath).fieldType;
}

function llmField(agentRecord: ValidatorJson, ownerPath: string) {
  return objectField(agentRecord, "llm", ownerPath).fieldType;
}

function fieldNames(j: ValidatorJson, ownerPath: string): string[] {
  if (!isObjectJson(j)) throw new Error(`${ownerPath} is not an object`);
  return Object.keys(j.value).sort();
}

function kindLiteralsFromUnion(j: ValidatorJson, ownerPath: string): string[] {
  if (!isUnionJson(j)) throw new Error(`${ownerPath} is not a union`);
  return j.value
    .flatMap((arm, index) => {
      const kind = objectField(arm, "kind", `${ownerPath}[${index}]`);
      return literalStrings(kind.fieldType, `${ownerPath}[${index}].kind`);
    })
    .sort();
}

function positionKindsFromTool(): string[] {
  const position = buildDecisionTool({
    useVariant: "consumable_or_null",
  }).parameters.properties.position;
  const positionArms = toolArray(position.anyOf, "tool.position.anyOf");
  const stance = toolRecord(positionArms[0], "tool.position[0]");
  const move = toolRecord(positionArms[1], "tool.position[1]");
  return [
    ...toolStringLiterals(
      toolRecord(toolRecord(stance.properties, "tool.position[0].properties").kind, "tool.position[0].kind").enum,
      "tool.position[0].kind.enum",
    ),
    ...toolStringLiterals(
      toolRecord(toolRecord(move.properties, "tool.position[1].properties").kind, "tool.position[1].kind").enum,
      "tool.position[1].kind.enum",
    ),
  ].sort();
}

function directionKindsFromTool(): string[] {
  const position = buildDecisionTool({
    useVariant: "consumable_or_null",
  }).parameters.properties.position;
  const positionArms = toolArray(position.anyOf, "tool.position.anyOf");
  const move = toolRecord(positionArms[1], "tool.position[1]");
  const moveProperties = toolRecord(
    move.properties,
    "tool.position[1].properties",
  );
  const direction = toolRecord(
    moveProperties.direction,
    "tool.position[1].direction",
  );
  const directionArms = toolArray(
    direction.anyOf,
    "tool.position[1].direction.anyOf",
  );
  const relative = toolRecord(directionArms[0], "tool.direction[0]");
  const compass = toolRecord(directionArms[1], "tool.direction[1]");
  return [
    ...toolStringLiterals(
      toolRecord(toolRecord(relative.properties, "tool.direction[0].properties").kind, "tool.direction[0].kind").enum,
      "tool.direction[0].kind.enum",
    ),
    ...toolStringLiterals(
      toolRecord(toolRecord(compass.properties, "tool.direction[1].properties").kind, "tool.direction[1].kind").enum,
      "tool.direction[1].kind.enum",
    ),
  ].sort();
}

function actionKindsFromTool(): string[] {
  const action = buildDecisionTool({
    useVariant: "consumable_or_null",
  }).parameters.properties.action;
  const actionArms = toolArray(action.anyOf, "tool.action.anyOf");
  const none = toolRecord(actionArms[0], "tool.action[0]");
  const target = toolRecord(actionArms[1], "tool.action[1]");
  return [
    ...toolStringLiterals(
      toolRecord(toolRecord(none.properties, "tool.action[0].properties").kind, "tool.action[0].kind").enum,
      "tool.action[0].kind.enum",
    ),
    ...toolStringLiterals(
      toolRecord(toolRecord(target.properties, "tool.action[1].properties").kind, "tool.action[1].kind").enum,
      "tool.action[1].kind.enum",
    ),
  ].sort();
}

describe("phase-6 schema mirror", () => {
  it("agentRecord validator JSON is identical between schema and mirror", () => {
    expect(JSON.stringify(mirrorValidators().agentRecord)).toBe(
      JSON.stringify(schemaValidators().agentRecord),
    );
  });

  it("resolution validator JSON is identical between schema and mirror", () => {
    expect(JSON.stringify(mirrorValidators().resolution)).toBe(
      JSON.stringify(schemaValidators().resolution),
    );
  });

  it("decision top-level fields match both tool variants", () => {
    const fromSchema = fieldNames(
      decisionField(schemaValidators().agentRecord, "schema.agentRecord"),
      "schema.agentRecord.decision",
    );

    for (const useVariant of ["consumable_or_null", "null_only"] as const) {
      const tool = buildDecisionTool({ useVariant });
      expect(Object.keys(tool.parameters.properties).sort()).toEqual(fromSchema);
      expect([...tool.parameters.required].sort()).toEqual(fromSchema);
    }
  });

  it("tool use field is variant-specific", () => {
    const withConsumable = buildDecisionTool({
      useVariant: "consumable_or_null",
    }).parameters.properties.use;
    const nullOnly = buildDecisionTool({
      useVariant: "null_only",
    }).parameters.properties.use;

    expect(withConsumable).toEqual({
      type: ["string", "null"],
      enum: ["consumable", null],
      description: "Use your equipped consumable slot, or null to use nothing.",
    });
    expect(nullOnly).toEqual({
      type: ["null"],
      enum: [null],
      description:
        "No consumable is currently equipped, so nothing can be used.",
    });
  });

  it.each(USE_VARIANTS)(
    "JSON Schema contract is byte-equal to parser expectations for %s",
    (useVariant) => {
      expect(canonicalJson(normalisedToolContract(useVariant))).toBe(
        canonicalJson(parserContract(useVariant)),
      );
    },
  );

  it.each(USE_VARIANTS)(
    "parser accepts every JSON Schema arm and rejects legacy fields for %s",
    (useVariant) => {
      const validUse = useVariant === "null_only" ? null : "consumable";
      const validDecisions: ParsedDecision[] = [
        {
          use: validUse,
          position: { kind: "overwatch" },
          action: { kind: "attack", targetId: "Vulture" },
          say: null,
          scratchpad: "Hold overwatch and shoot Vulture.",
        },
        {
          use: null,
          position: { kind: "counter" },
          action: { kind: "loot", targetId: "Corpse_Camper" },
          say: "Truce at evac.",
          scratchpad: null,
        },
        {
          use: null,
          position: {
            kind: "move",
            direction: { kind: "toward", targetId: "Chest_003" },
            dist: 8,
          },
          action: { kind: "loot", targetId: "Chest_003" },
          say: null,
          scratchpad: "Move toward the chest and loot if in range.",
        },
        {
          use: null,
          position: {
            kind: "move",
            direction: { kind: "away", targetId: "Duelist" },
            dist: 3,
          },
          action: { kind: "none" },
          say: "Back off.",
          scratchpad: null,
        },
        ...(["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const).map(
          (bearing): ParsedDecision => ({
            use: null,
            position: {
              kind: "move",
              direction: { kind: bearing },
              dist: bearing === "N" ? 0 : 5,
            },
            action: { kind: "none" },
            say: null,
            scratchpad: null,
          }),
        ),
      ];

      for (const decision of validDecisions) {
        const result = parseRawDecision(decision, useVariant);
        expect(result.ok, JSON.stringify(decision)).toBe(true);
      }

      const legacyPhase3Decision = {
        use: null,
        primary: "move",
        move: { kind: "toward_entity", targetId: "Duelist" },
        action: { kind: "none" },
        consume: null,
        overwatch_stance: null,
        say: null,
        scratchpad_update: null,
      };
      const legacyResult = parseRawDecision(legacyPhase3Decision, useVariant);
      expect(legacyResult.ok).toBe(false);

      if (useVariant === "null_only") {
        const firstDecision = validDecisions[0];
        if (!firstDecision) throw new Error("valid decision fixture missing");
        const wrongUse = parseRawDecision(
          { ...firstDecision, use: "consumable" },
          useVariant,
        );
        expect(wrongUse.ok).toBe(false);
      }
    },
  );

  it("position, direction, and action kind sets match the JSON Schema", () => {
    const decision = decisionField(
      schemaValidators().agentRecord,
      "schema.agentRecord",
    );
    const position = objectField(
      decision,
      "position",
      "schema.agentRecord.decision",
    ).fieldType;
    const action = objectField(
      decision,
      "action",
      "schema.agentRecord.decision",
    ).fieldType;

    expect(kindLiteralsFromUnion(position, "decision.position")).toEqual(
      positionKindsFromTool(),
    );
    expect(kindLiteralsFromUnion(action, "decision.action")).toEqual(
      actionKindsFromTool(),
    );

    if (!isUnionJson(position)) {
      throw new Error("decision.position is not a union");
    }
    const moveArm = position.value.find((arm) =>
      kindLiteralsFromUnion(vUnionFromSingleArm(arm), "position.arm").includes(
        "move",
      ),
    );
    if (!moveArm) throw new Error("move position arm missing");
    const direction = objectField(
      moveArm,
      "direction",
      "decision.position.move",
    ).fieldType;
    expect(kindLiteralsFromUnion(direction, "decision.position.direction")).toEqual(
      directionKindsFromTool(),
    );
  });

  it("input and validator diagnostics carry the phase-6 slots", () => {
    const agentRecord = schemaValidators().agentRecord;
    const input = inputField(agentRecord, "schema.agentRecord");
    const llm = llmField(agentRecord, "schema.agentRecord");

    const useVariant = objectField(input, "useVariant", "agentRecord.input");
    expect(useVariant.optional).toBe(true);
    expect(literalStrings(useVariant.fieldType, "input.useVariant").sort()).toEqual([
      "consumable_or_null",
      "null_only",
    ]);

    const fieldErrors = objectField(
      llm,
      "validatorFieldErrors",
      "agentRecord.llm",
    );
    expect(fieldErrors.optional).toBe(true);
    expect(fieldNames(fieldErrors.fieldType, "llm.validatorFieldErrors")).toEqual(
      ["action", "position", "say", "scratchpad", "use"],
    );
  });

  it("resolution action traces include counter and movement-trigger marker", () => {
    const resolution = schemaValidators().resolution;
    const actions = objectField(resolution, "actions", "resolution").fieldType;
    const actionEntry = arrayElement(actions, "resolution.actions");
    const kind = objectField(actionEntry, "kind", "resolution.actions[]");
    expect(literalStrings(kind.fieldType, "resolution.actions[].kind").sort()).toEqual([
      "attack",
      "counter",
      "loot",
      "overwatch",
    ]);

    const triggered = objectField(
      actionEntry,
      "triggeredByMovement",
      "resolution.actions[]",
    );
    expect(triggered.optional).toBe(true);
    expect(triggered.fieldType).toEqual({ type: "boolean" });
  });
});

function vUnionFromSingleArm(arm: ValidatorJson): ConvexUnionJson {
  return { type: "union", value: [arm] };
}

describe("phase-6 ParsedDecision compile guard", () => {
  it("a sample decision typechecks against the substrate contract", () => {
    const sample: ParsedDecision = {
      use: null,
      position: { kind: "counter" },
      action: { kind: "loot", targetId: "Corpse_Camper" },
      say: null,
      scratchpad: null,
    };

    expect(sample.position.kind).toBe("counter");
    expect(sample.action.kind).toBe("loot");
  });
});
