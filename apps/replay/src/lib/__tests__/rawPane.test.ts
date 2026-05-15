import { beforeEach, describe, expect, it, vi } from "vitest";

const recomposeUserMessageMock = vi.hoisted(() =>
  vi.fn((args: {
    input: {
      personaPromptHash: string;
      scratchpadBefore: string;
      visibleStateDigest: string;
    };
    turn: number;
    displayName: string;
    prompts: {
      personaText(hash: string): string;
      systemText(hash: string): string;
    };
  }) =>
    [
      `# ${args.displayName}`,
      `turn=${args.turn}`,
      `persona=${args.prompts.personaText(args.input.personaPromptHash)}`,
      `scratchpad=${args.input.scratchpadBefore}`,
      args.input.visibleStateDigest,
    ].join("\n"),
  ),
);

vi.mock("../../../../../convex/llm/inputBuilder", () => ({
  recomposeUserMessage: recomposeUserMessageMock,
}));

import {
  PROMPT_LOOKUP_FATAL_PREFIX,
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
import type { FullLlmInputContext } from "../rawPane";

beforeEach(() => {
  recomposeUserMessageMock.mockClear();
});

function makeAgentRecord(
  overrides: Partial<{
    systemPromptHash: string;
    personaPromptHash: string;
    scratchpadBefore: string;
    visibleStateDigest: string;
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
      systemPromptHash: overrides.systemPromptHash ?? "sh",
      personaPromptHash: overrides.personaPromptHash ?? "ph",
      visibleStateDigest: overrides.visibleStateDigest ?? "DIGEST TEXT",
      scratchpadBefore: overrides.scratchpadBefore ?? "SCRATCH TEXT",
      status: {
        hp: 50,
        pos: { x: 45, y: 47 },
        equipped: {},
        insideEvac: false,
      },
      narrativeLines: [],
      aliveCount: 8,
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

  return record;
}

function makeContext(
  overrides: Partial<FullLlmInputContext> = {},
): FullLlmInputContext {
  return {
    turn: overrides.turn ?? 7,
    displayName: overrides.displayName ?? "Rat",
    promptsLookup: overrides.promptsLookup ?? {
      system: { sh: "SYSTEM TEXT for <Player Name>" },
      persona: { ph: "PERSONA TEXT" },
    },
  };
}

function extractUserRole(fullInput: string): string {
  const userMarker = "--- user role ---\n";
  const toolMarker = "\n\n--- tool schema ---";
  return fullInput.slice(
    fullInput.indexOf(userMarker) + userMarker.length,
    fullInput.indexOf(toolMarker),
  );
}

describe("composeFullLlmInput", () => {
  it("includes system, user, and per-turn tool schema sections", () => {
    const ar = makeAgentRecord({
      scratchpadBefore: "SCRATCH_BODY",
      visibleStateDigest: "DIGEST_BODY",
      useVariant: "null_only",
    });
    const out = composeFullLlmInput(
      ar,
      makeContext({
        promptsLookup: {
          system: { sh: "SYS_BODY" },
          persona: { ph: "PERSONA_BODY" },
        },
      }),
    );

    expect(out).toContain("--- system role ---\nSYS_BODY");
    expect(out).toContain(
      "--- user role ---\n# Rat\nturn=7\npersona=PERSONA_BODY\nscratchpad=SCRATCH_BODY\nDIGEST_BODY",
    );
    expect(out).toContain("--- tool schema ---");
    expect(out).toContain('"name": "decide_turn"');
    expect(out).toContain('"use"');
    expect(out).toContain('"position"');
    expect(out).toContain('"action"');
    expect(out).toContain('"scratchpad"');
  });

  it("recomposes the user role from slim input, turn, display name, and prompt lookup", () => {
    const ar = makeAgentRecord({
      personaPromptHash: "persona-hash",
      scratchpadBefore: "memory",
      visibleStateDigest: "Vision:\n{}",
    });
    const out = composeFullLlmInput(
      ar,
      makeContext({
        turn: 11,
        displayName: "Camper",
        promptsLookup: {
          system: { sh: "System" },
          persona: { "persona-hash": "Camper body" },
        },
      }),
    );
    const userRole = extractUserRole(out);

    expect(userRole).toBe(
      "# Camper\nturn=11\npersona=Camper body\nscratchpad=memory\nVision:\n{}",
    );
    expect(recomposeUserMessageMock).toHaveBeenCalledWith({
      input: ar.input,
      turn: 11,
      displayName: "Camper",
      prompts: expect.objectContaining({
        systemText: expect.any(Function),
        personaText: expect.any(Function),
      }),
    });
  });

  it("substitutes the joined system prompt template for display only", () => {
    const out = composeFullLlmInput(
      makeAgentRecord(),
      makeContext({
        displayName: "Camper",
        promptsLookup: {
          system: { sh: "You are <Player Name>, extraction-arena agent." },
          persona: { ph: "persona" },
        },
      }),
    );

    expect(out).toContain(
      "--- system role ---\nYou are Camper, extraction-arena agent.",
    );
  });

  it("renders a visible fatal prompt error instead of silently replacing missing hashes", () => {
    const out = composeFullLlmInput(
      makeAgentRecord({
        systemPromptHash: "missing-system",
      }),
      makeContext(),
    );
    const userRole = extractUserRole(out);

    expect(out).toContain(PROMPT_LOOKUP_FATAL_PREFIX);
    expect(userRole).toContain("missing system prompt hash \"missing-system\"");
    expect(userRole).not.toContain("SCRATCH TEXT");
    expect(recomposeUserMessageMock).not.toHaveBeenCalled();
  });

  it("renders a visible fatal prompt error when the persona hash is missing during recomposition", () => {
    const out = composeFullLlmInput(
      makeAgentRecord({ personaPromptHash: "missing-persona" }),
      makeContext(),
    );

    expect(extractUserRole(out)).toContain(
      "missing persona prompt hash \"missing-persona\"",
    );
    expect(out).toContain(PROMPT_LOOKUP_FATAL_PREFIX);
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
        direction: { kind: "toward", targetId: "Crate_53_54" },
        dist: 8,
      },
      action: { kind: "loot", targetId: "Crate_53_54" },
      say: null,
      scratchpad: "Loot the crate.",
    };
    const rawArguments = JSON.stringify({
      scratchpad: "Loot the crate.",
      say: null,
      action: { targetId: "Crate_53_54", kind: "loot" },
      position: {
        dist: 8,
        direction: { targetId: "Crate_53_54", kind: "toward" },
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
