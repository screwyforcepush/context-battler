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
    reasoning: string | null;
  }> = {},
): AgentRecord {
  return {
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
    decision: {
      consume: "none",
      primary: "stationary_action",
      move: { kind: "none" },
      action: { kind: "none" },
      say: null,
      overwatch_stance: null,
      scratchpad_update: null,
    },
    scratchpadAfter: "after",
    llm: {
      responseId: null,
      callId: null,
      rawArguments: null,
      usage: null,
      latencyMs: 0,
      httpStatus: null,
      fellBackToSafeDefault: false,
      reasoning: overrides.reasoning ?? null,
    },
  };
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
