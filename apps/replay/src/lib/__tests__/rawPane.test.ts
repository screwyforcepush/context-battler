// Phase 03 / WP-D.1 — Vitest tests for `rawPane.ts`.
//
// The ExpandModal collapses from a 5-tab UI to a 3-section vertical raw-dump
// pane (LLM input / reasoning / tool call JSON). The composition logic is
// pure and lives in `rawPane.ts` so it can be tested without bringing
// React/RTL/jsdom into the test environment (the project's vitest is
// node-env and the replay sub-package has no testing-library deps).

import { describe, expect, it } from "vitest";
import {
  composeFullLlmInput,
  composeReasoningText,
  composeDecisionJson,
  composeRawArgumentsVsDecision,
  composeUsageBar,
} from "../rawPane";
import type { AgentRecord } from "../decisionEnglish";

// ───────────────────────────────────────────────────────────────────────────
// Fixture
// ───────────────────────────────────────────────────────────────────────────

function makeAgentRecord(
  overrides: Partial<{
    systemPromptText: string;
    personaPromptText: string;
    scratchpadBefore: string;
    visibleStateDigest: string;
    composedUserMessage: string;
    reasoning: string | null;
    rawArguments: string | null;
    failureReason: AgentRecord["llm"]["failureReason"];
    validatorReason: string;
    usage: AgentRecord["llm"]["usage"];
    decision: AgentRecord["decision"];
  }> = {},
): AgentRecord {
  const decision = overrides.decision ?? {
    consume: "none",
    primary: "stationary_action",
    move: { kind: "none" },
    action: { kind: "none" },
    say: null,
    overwatch_stance: null,
    scratchpad_update: null,
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
      ...(overrides.validatorReason
        ? { validatorReason: overrides.validatorReason }
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

// ───────────────────────────────────────────────────────────────────────────
// composeFullLlmInput — concatenates system role + user role with the
// canonical wrapper headers.
// ───────────────────────────────────────────────────────────────────────────

describe("composeFullLlmInput", () => {
  it("includes the system role marker followed by systemPromptText", () => {
    const ar = makeAgentRecord({ systemPromptText: "SYS_BODY" });
    const out = composeFullLlmInput(ar);
    expect(out).toContain("--- system role ---");
    expect(out).toContain("SYS_BODY");
    // System role must precede user role.
    expect(out.indexOf("--- system role ---")).toBeLessThan(
      out.indexOf("--- user role ---"),
    );
  });

  it("includes the user role marker with Persona / Scratchpad / Visible state headers", () => {
    const ar = makeAgentRecord({
      personaPromptText: "PERSONA_BODY",
      scratchpadBefore: "SCRATCH_BODY",
      visibleStateDigest: "DIGEST_BODY",
    });
    const out = composeFullLlmInput(ar);
    expect(out).toContain("--- user role ---");
    expect(out).toContain("## Persona");
    expect(out).toContain("PERSONA_BODY");
    expect(out).toContain("## Scratchpad");
    expect(out).toContain("SCRATCH_BODY");
    expect(out).toContain("## Visible state");
    expect(out).toContain("DIGEST_BODY");
  });

  it("orders headers as Persona → Scratchpad → Visible state", () => {
    const ar = makeAgentRecord();
    const out = composeFullLlmInput(ar);
    const personaIdx = out.indexOf("## Persona");
    const scratchIdx = out.indexOf("## Scratchpad");
    const digestIdx = out.indexOf("## Visible state");
    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(scratchIdx).toBeGreaterThan(personaIdx);
    expect(digestIdx).toBeGreaterThan(scratchIdx);
  });

  it("includes the live tool schema as a third request-input section", () => {
    const ar = makeAgentRecord();
    const out = composeFullLlmInput(ar);
    expect(out).toContain("--- tool schema ---");
    expect(out.indexOf("--- tool schema ---")).toBeGreaterThan(
      out.indexOf("--- user role ---"),
    );
    expect(out).toContain('"name": "decide_turn"');
    expect(out).toContain('"move"');
    expect(out).toContain('"action"');
  });

  it("does not include reasoning text in the request-input pane", () => {
    const ar = makeAgentRecord({ reasoning: "PRIVATE_REASONING_TRACE" });
    expect(composeFullLlmInput(ar)).not.toContain("PRIVATE_REASONING_TRACE");
  });

  it("renders phase-4 composedUserMessage verbatim when present", () => {
    const composed =
      "Persona as sent\n\n## previous turn\nYou: no-op\n\n# Current Game State\nVisible: []";
    const ar = makeAgentRecord({
      composedUserMessage: composed,
      personaPromptText: "LEGACY_PERSONA",
      scratchpadBefore: "LEGACY_SCRATCH",
      visibleStateDigest: "LEGACY_DIGEST",
    });
    const out = composeFullLlmInput(ar);
    const userMarker = "--- user role ---\n";
    const toolMarker = "\n\n--- tool schema ---";
    const userRole = out.slice(
      out.indexOf(userMarker) + userMarker.length,
      out.indexOf(toolMarker),
    );
    expect(userRole).toBe(composed);
    expect(userRole).not.toContain("## Persona");
    expect(userRole).not.toContain("LEGACY_PERSONA");
  });

  it("falls back to phase-3 legacy user-role composition when composedUserMessage is absent", () => {
    const ar = makeAgentRecord({
      personaPromptText: "PERSONA_BODY",
      scratchpadBefore: "SCRATCH_BODY",
      visibleStateDigest: "DIGEST_BODY",
    });
    const out = composeFullLlmInput(ar);
    expect(out).toContain("## Persona\nPERSONA_BODY");
    expect(out).toContain("## Scratchpad\nSCRATCH_BODY");
    expect(out).toContain("## Visible state\nDIGEST_BODY");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// composeReasoningText — fallback chain
// ───────────────────────────────────────────────────────────────────────────

describe("composeReasoningText", () => {
  it("returns agentRecord.llm.reasoning when present", () => {
    const ar = makeAgentRecord({ reasoning: "REASONING_BODY" });
    expect(composeReasoningText(ar)).toBe("REASONING_BODY");
  });

  it('returns "(no reasoning captured)" fallback when reasoning is null', () => {
    const ar = makeAgentRecord({ reasoning: null });
    expect(composeReasoningText(ar)).toBe("(no reasoning captured)");
  });

  it('returns "(no reasoning captured)" when reasoning is empty string', () => {
    // Treat empty string as "not captured" for UI clarity (per the
    // explainability vibe — an empty <pre> looks like a bug).
    const ar = makeAgentRecord({ reasoning: "" });
    expect(composeReasoningText(ar)).toBe("(no reasoning captured)");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// composeDecisionJson — pretty-printed tool call JSON
// ───────────────────────────────────────────────────────────────────────────

describe("composeDecisionJson", () => {
  it("returns the decision serialised as 2-space indented JSON", () => {
    const ar = makeAgentRecord();
    const json = composeDecisionJson(ar);
    // 2-space indented JSON: object opens with `{\n  `.
    expect(json.startsWith("{\n  ")).toBe(true);
    // Round-trip parse — must be valid JSON.
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["consume"]).toBe("none");
    expect(parsed["primary"]).toBe("stationary_action");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// composeRawArgumentsVsDecision — canonical rawArguments/decision comparison
// ───────────────────────────────────────────────────────────────────────────

describe("composeRawArgumentsVsDecision", () => {
  it("returns matched=true when rawArguments equals decision modulo whitespace and key order", () => {
    const decision: AgentRecord["decision"] = {
      consume: "none",
      primary: "move",
      move: { dy: -2, kind: "relative", dx: 1 },
      action: { kind: "none" },
      say: null,
      overwatch_stance: null,
      scratchpad_update: "hold north",
    };
    const rawArguments = JSON.stringify({
      scratchpad_update: "hold north",
      overwatch_stance: null,
      say: null,
      action: { kind: "none" },
      move: { dx: 1, kind: "relative", dy: -2 },
      primary: "move",
      consume: "none",
    });
    const out = composeRawArgumentsVsDecision(
      makeAgentRecord({ decision, rawArguments }),
    );
    expect(out.matched).toBe(true);
    expect(out.rendered).toContain("matched");
    expect(out.rendered).toContain('"primary": "move"');
    expect(out.rendered).not.toContain("--- rawArguments ---");
  });

  it("returns matched=false with both panes when rawArguments diverges from decision", () => {
    const out = composeRawArgumentsVsDecision(
      makeAgentRecord({
        rawArguments: JSON.stringify({
          consume: "none",
          primary: "move",
          move: { kind: "relative", dx: 8, dy: 0 },
          action: { kind: "attack", targetCharacterId: "Player_7" },
          say: null,
          overwatch_stance: null,
          scratchpad_update: null,
        }),
      }),
    );
    expect(out.matched).toBe(false);
    expect(out.rendered).toContain("diverged");
    expect(out.rendered).toContain("--- rawArguments ---");
    expect(out.rendered).toContain("--- decision ---");
    expect(out.rendered).toContain('"targetCharacterId":"Player_7"');
    expect(out.rendered).toContain('"primary": "stationary_action"');
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

// ───────────────────────────────────────────────────────────────────────────
// composeUsageBar — compact output/max display + truncation flag
// ───────────────────────────────────────────────────────────────────────────

describe("composeUsageBar", () => {
  it("renders output_tokens over max and does not truncate below 95%", () => {
    const out = composeUsageBar(
      makeAgentRecord({
        usage: { output_tokens: 900 },
      }),
      1200,
    );
    expect(out.rendered).toBe("[900 / 1200] tokens");
    expect(out.truncated).toBe(false);
  });

  it("marks truncated when output_tokens is at least 95% of max", () => {
    const out = composeUsageBar(
      makeAgentRecord({
        usage: { output_tokens: 1140 },
      }),
      1200,
    );
    expect(out.rendered).toBe("[1140 / 1200] tokens");
    expect(out.truncated).toBe(true);
  });

  it("renders a missing-output placeholder when usage is absent", () => {
    const out = composeUsageBar(makeAgentRecord({ usage: null }), 1200);
    expect(out.rendered).toBe("[— / 1200] tokens");
    expect(out.truncated).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// hasReasoningIndicator — TurnFeed feed-row helper
// ───────────────────────────────────────────────────────────────────────────

describe("hasReasoningIndicator", () => {
  it("returns true when reasoning is non-null and non-empty", async () => {
    const { hasReasoningIndicator } = await import("../rawPane");
    const ar = makeAgentRecord({ reasoning: "thinking..." });
    expect(hasReasoningIndicator(ar)).toBe(true);
  });

  it("returns false when reasoning is null", async () => {
    const { hasReasoningIndicator } = await import("../rawPane");
    const ar = makeAgentRecord({ reasoning: null });
    expect(hasReasoningIndicator(ar)).toBe(false);
  });

  it("returns false when reasoning is empty string", async () => {
    const { hasReasoningIndicator } = await import("../rawPane");
    const ar = makeAgentRecord({ reasoning: "" });
    expect(hasReasoningIndicator(ar)).toBe(false);
  });
});
