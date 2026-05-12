import { describe, expect, it } from "vitest";
import {
  LEGACY_COMPOSED_USER_MESSAGE_UNAVAILABLE,
  TOOL_SCHEMA_UNAVAILABLE,
  composeDecisionJson,
  composeFullLlmInput,
  composeRawArgumentsVsDecision,
  composeReasoningText,
  composeToolSchemaSection,
  composeUsage,
  composeUsageBar,
  composeValidatorFieldErrors,
  hasReasoningIndicator,
  hasValidatorFieldErrors,
  summariseValidatorFieldErrors,
} from "../rawPane";
import type { AgentRecord } from "../decisionEnglish";

function makeAgentRecord(
  overrides: Partial<{
    systemPromptText: string;
    personaPromptText: string;
    scratchpadBefore: string;
    visibleStateDigest: string;
    composedUserMessage: string;
    useVariant: AgentRecord["input"]["useVariant"];
    reasoning: string | null;
    rawArguments: string | null;
    failureReason: AgentRecord["llm"]["failureReason"];
    validatorFieldErrors: AgentRecord["llm"]["validatorFieldErrors"];
    usage: AgentRecord["llm"]["usage"];
    decision: AgentRecord["decision"];
  }> = {},
): AgentRecord {
  const decision = overrides.decision ?? {
    use: null,
    position: { kind: "move", direction: { kind: "N" }, dist: 0 },
    action: { kind: "none" },
    say: null,
    scratchpad: null,
  };

  const record = {
    characterId: "c1" as unknown as AgentRecord["characterId"],
    personaId: "rat",
    input: {
      systemPromptHash: "sh",
      systemPromptText: overrides.systemPromptText ?? "SYSTEM TEXT",
      personaPromptHash: "ph",
      personaPromptText: overrides.personaPromptText ?? "PERSONA TEXT",
      visibleStateDigest: overrides.visibleStateDigest ?? "DIGEST TEXT",
      scratchpadBefore: overrides.scratchpadBefore ?? "SCRATCH TEXT",
      ...(overrides.useVariant !== undefined
        ? { useVariant: overrides.useVariant }
        : { useVariant: "null_only" as const }),
    },
    decision,
    scratchpadAfter: "after",
    llm: {
      responseId: null,
      callId: null,
      rawArguments:
        overrides.rawArguments === undefined ? null : overrides.rawArguments,
      usage: overrides.usage ?? null,
      latencyMs: 0,
      httpStatus: null,
      fellBackToSafeDefault: false,
      ...(overrides.failureReason
        ? { failureReason: overrides.failureReason }
        : {}),
      ...(overrides.validatorFieldErrors
        ? { validatorFieldErrors: overrides.validatorFieldErrors }
        : {}),
      reasoning: overrides.reasoning ?? null,
    },
  } as AgentRecord;

  if (overrides.composedUserMessage !== undefined) {
    (
      record.input as AgentRecord["input"] & {
        composedUserMessage?: string;
      }
    ).composedUserMessage = overrides.composedUserMessage;
  }

  return record;
}

describe("composeFullLlmInput", () => {
  it("includes system, user, and per-turn tool schema sections", () => {
    const ar = makeAgentRecord({
      systemPromptText: "SYS_BODY",
      personaPromptText: "PERSONA_BODY",
      scratchpadBefore: "SCRATCH_BODY",
      visibleStateDigest: "DIGEST_BODY",
      composedUserMessage:
        "# Rat\n\n## Status\nSTATUS_BODY\n\n# Current Game State\nDIGEST_BODY",
      useVariant: "null_only",
    });
    const out = composeFullLlmInput(ar);

    expect(out).toContain("--- system role ---\nSYS_BODY");
    expect(out).toContain(
      "--- user role ---\n# Rat\n\n## Status\nSTATUS_BODY\n\n# Current Game State\nDIGEST_BODY",
    );
    expect(out).toContain("--- tool schema ---");
    expect(out).toContain('"name": "decide_turn"');
    expect(out).toContain('"use"');
    expect(out).toContain('"position"');
    expect(out).toContain('"action"');
    expect(out).toContain('"scratchpad"');
  });

  it("renders composedUserMessage verbatim when present", () => {
    const composed = "# Current Game State\nVisible: []";
    const ar = makeAgentRecord({
      composedUserMessage: composed,
      personaPromptText: "IGNORED",
    });
    const out = composeFullLlmInput(ar);
    const userMarker = "--- user role ---\n";
    const toolMarker = "\n\n--- tool schema ---";
    const userRole = out.slice(
      out.indexOf(userMarker) + userMarker.length,
      out.indexOf(toolMarker),
    );

    expect(userRole).toBe(composed);
    expect(userRole).not.toContain("IGNORED");
  });

  it("substitutes the persisted system prompt template for display only", () => {
    const out = composeFullLlmInput(
      makeAgentRecord({
        systemPromptText: "You are <Player Name>, extraction-arena agent.",
        composedUserMessage: "# Camper\n\n## Status\nready",
      }),
    );

    expect(out).toContain(
      "--- system role ---\nYou are Camper, extraction-arena agent.",
    );
  });

  it("does not build the phase-3 Persona/Scratchpad/Visible fallback", () => {
    const out = composeFullLlmInput(
      makeAgentRecord({
        personaPromptText: "PERSONA_BODY",
        scratchpadBefore: "SCRATCH_BODY",
        visibleStateDigest: "DIGEST_BODY",
      }),
    );
    const userMarker = "--- user role ---\n";
    const toolMarker = "\n\n--- tool schema ---";
    const userRole = out.slice(
      out.indexOf(userMarker) + userMarker.length,
      out.indexOf(toolMarker),
    );

    expect(userRole).toBe(LEGACY_COMPOSED_USER_MESSAGE_UNAVAILABLE);
    expect(userRole).not.toContain("## Persona");
    expect(userRole).not.toContain("## Scratchpad");
    expect(userRole).not.toContain("## Visible state");
    expect(userRole).not.toContain("PERSONA_BODY");
    expect(userRole).not.toContain("SCRATCH_BODY");
    expect(userRole).not.toContain("DIGEST_BODY");
  });
});

describe("composeToolSchemaSection", () => {
  it("renders the null-only use variant from the agent input", () => {
    const schema = JSON.parse(
      composeToolSchemaSection(makeAgentRecord({ useVariant: "null_only" })),
    ) as {
      parameters: { properties: { use: { type: string[]; enum: unknown[] } } };
    };

    expect(schema.parameters.properties.use.type).toEqual(["null"]);
    expect(schema.parameters.properties.use.enum).toEqual([null]);
  });

  it("renders the consumable-or-null use variant from the agent input", () => {
    const schema = JSON.parse(
      composeToolSchemaSection(
        makeAgentRecord({ useVariant: "consumable_or_null" }),
      ),
    ) as {
      parameters: { properties: { use: { type: string[]; enum: unknown[] } } };
    };

    expect(schema.parameters.properties.use.type).toEqual(["string", "null"]);
    expect(schema.parameters.properties.use.enum).toEqual(["consumable", null]);
  });

  it("makes missing useVariant explicit instead of showing a guessed schema", () => {
    const ar = makeAgentRecord({ useVariant: undefined });
    delete (ar.input as { useVariant?: unknown }).useVariant;

    expect(composeToolSchemaSection(ar)).toBe(TOOL_SCHEMA_UNAVAILABLE);
  });
});

describe("composeReasoningText", () => {
  it("returns captured reasoning when present", () => {
    expect(
      composeReasoningText(makeAgentRecord({ reasoning: "REASONING_BODY" })),
    ).toBe("REASONING_BODY");
  });

  it("falls back when reasoning is null or empty", () => {
    expect(composeReasoningText(makeAgentRecord({ reasoning: null }))).toBe(
      "(no reasoning captured)",
    );
    expect(composeReasoningText(makeAgentRecord({ reasoning: "" }))).toBe(
      "(no reasoning captured)",
    );
  });
});

describe("composeDecisionJson and rawArguments comparison", () => {
  it("pretty-prints the Phase 6 decision", () => {
    const json = composeDecisionJson(makeAgentRecord());
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(json.startsWith("{\n  ")).toBe(true);
    expect(parsed["use"]).toBe(null);
    expect(parsed["position"]).toEqual({
      kind: "move",
      direction: { kind: "N" },
      dist: 0,
    });
  });

  it("marks rawArguments matched after canonical key sorting", () => {
    const decision: AgentRecord["decision"] = {
      use: "consumable",
      position: {
        kind: "move",
        direction: { kind: "toward", targetId: "Chest_012" },
        dist: 8,
      },
      action: { kind: "loot", targetId: "Chest_012" },
      say: null,
      scratchpad: "Loot the chest.",
    };
    const rawArguments = JSON.stringify({
      scratchpad: "Loot the chest.",
      say: null,
      action: { targetId: "Chest_012", kind: "loot" },
      position: {
        dist: 8,
        direction: { targetId: "Chest_012", kind: "toward" },
        kind: "move",
      },
      use: "consumable",
    });

    const out = composeRawArgumentsVsDecision(
      makeAgentRecord({ decision, rawArguments }),
    );

    expect(out.matched).toBe(true);
    expect(out.rendered).toContain("rawArguments vs decision: matched");
    expect(out.rendered).not.toContain("--- rawArguments ---");
  });

  it("marks rawArguments diverged and shows both panes", () => {
    const out = composeRawArgumentsVsDecision(
      makeAgentRecord({
        rawArguments: JSON.stringify({
          use: null,
          position: {
            kind: "move",
            direction: { kind: "away", targetId: "Duelist" },
            dist: 4,
          },
          action: { kind: "attack", targetId: "Duelist" },
          say: null,
          scratchpad: null,
        }),
      }),
    );

    expect(out.matched).toBe(false);
    expect(out.rendered).toContain("rawArguments vs decision: diverged");
    expect(out.rendered).toContain("--- rawArguments ---");
    expect(out.rendered).toContain("--- decision ---");
    expect(out.rendered).toContain('"targetId":"Duelist"');
  });

  it("renders wrapper-level failure when rawArguments is null", () => {
    const out = composeRawArgumentsVsDecision(
      makeAgentRecord({
        rawArguments: null,
        failureReason: "no_function_call",
      }),
    );

    expect(out.matched).toBe(false);
    expect(out.rendered).toContain("(no rawArguments - wrapper-level failure)");
    expect(out.rendered).toContain("failureReason: no_function_call");
  });
});

describe("validator field errors", () => {
  it("renders field-scoped validation errors in decision field order", () => {
    const ar = makeAgentRecord({
      validatorFieldErrors: {
        action: "attack target is not visible",
        use: "no consumable equipped",
      },
    });

    expect(hasValidatorFieldErrors(ar)).toBe(true);
    expect(composeValidatorFieldErrors(ar)).toBe(
      [
        "use: no consumable equipped",
        "action: attack target is not visible",
      ].join("\n"),
    );
    expect(summariseValidatorFieldErrors(ar)).toBe(
      "use: no consumable equipped | action: attack target is not visible",
    );
  });

  it("returns clear empty-state diagnostics when no field errors exist", () => {
    const ar = makeAgentRecord();

    expect(hasValidatorFieldErrors(ar)).toBe(false);
    expect(composeValidatorFieldErrors(ar)).toBe(
      "(no validator field errors)",
    );
    expect(summariseValidatorFieldErrors(ar)).toBe(null);
  });
});

describe("usage diagnostics", () => {
  it("renders output_tokens over max and keeps truncation below 95%", () => {
    const out = composeUsageBar(
      makeAgentRecord({ usage: { output_tokens: 900 } }),
      1200,
    );

    expect(out.rendered).toBe("[900 / 1200] tokens");
    expect(out.truncated).toBe(false);
  });

  it("marks truncation at 95% of max output tokens", () => {
    const out = composeUsageBar(
      makeAgentRecord({ usage: { output_tokens: 1140 } }),
      1200,
    );

    expect(out.rendered).toBe("[1140 / 1200] tokens");
    expect(out.truncated).toBe(true);
  });

  it("pretty-prints raw usage and falls back when absent", () => {
    const rendered = composeUsage(
      makeAgentRecord({
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
        },
      }),
    );

    expect(JSON.parse(rendered)).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    });
    expect(composeUsage(makeAgentRecord({ usage: null }))).toBe(
      "(no usage captured)",
    );
  });
});

describe("hasReasoningIndicator", () => {
  it("tracks non-empty reasoning only", () => {
    expect(hasReasoningIndicator(makeAgentRecord({ reasoning: "thinking" }))).toBe(
      true,
    );
    expect(hasReasoningIndicator(makeAgentRecord({ reasoning: null }))).toBe(
      false,
    );
    expect(hasReasoningIndicator(makeAgentRecord({ reasoning: "" }))).toBe(false);
  });
});
