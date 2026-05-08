// Phase 03 / WP-D.1 — Raw-pane composition helpers for ExpandModal.
//
// Pure-function module. The ExpandModal collapsed from a 5-tab UI to a
// 3-section vertical raw-dump pane (Phase-3 ADR §1 / WP-D.1):
//
//   1. Full LLM input — system role + user role concatenation.
//   2. Reasoning text — `agentRecord.llm.reasoning ?? "(no reasoning captured)"`.
//   3. Tool call JSON — pretty-printed `agentRecord.decision`.
//
// The helpers live here (not inline in ExpandModal) so they can be unit
// tested without bringing React/RTL/jsdom into the vitest environment.
// The component is then a thin renderer that wires these strings into
// three `<pre>` blocks + copy buttons.
//
// Schema reference: `agentRecord.llm.reasoning: v.union(v.string(), v.null())`
// per phase-3 ADR §2 (required-nullable). The phase-3 schema does NOT
// carry a `decision.rationale` field — Branch A was confirmed by the
// WP-A.1 probe (Azure exposes reasoning text directly), so the fallback
// chain is just `llm.reasoning ?? "(no reasoning captured)"`. No
// `decision.rationale` reference appears in this module by design.

import type { AgentRecord } from "./decisionEnglish";

// ─────────────────────────────────────────────────────────────────────────────
// composeFullLlmInput — concatenate system role + user role.
//
// The user role is reconstructed from `agentRecord.input` fields using the
// canonical wrapper that `convex/llm/inputBuilder.ts` produces at request
// time. Headers (`## Persona / ## Scratchpad / ## Visible state`) match the
// ones that go into the actual Azure `messages[].role: "user"` content.
// ─────────────────────────────────────────────────────────────────────────────

export function composeFullLlmInput(agentRecord: AgentRecord): string {
  const system = agentRecord.input.systemPromptText;
  const userRole = [
    "## Persona",
    agentRecord.input.personaPromptText,
    "",
    "## Scratchpad",
    agentRecord.input.scratchpadBefore,
    "",
    "## Visible state",
    agentRecord.input.visibleStateDigest,
  ].join("\n");

  return `--- system role ---\n${system}\n\n--- user role ---\n${userRole}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// composeReasoningText — `agentRecord.llm.reasoning ?? fallback`.
//
// Empty string is treated as "not captured" for UI clarity. An empty
// <pre> block looks like a render bug and erodes the explainability vibe;
// surfacing the fallback string is honest about Branch A's probabilistic
// nature (some responses include reasoning items, others don't).
// ─────────────────────────────────────────────────────────────────────────────

export const NO_REASONING_FALLBACK = "(no reasoning captured)";

export function composeReasoningText(agentRecord: AgentRecord): string {
  const r = agentRecord.llm.reasoning;
  if (r === null || r === "") return NO_REASONING_FALLBACK;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// composeDecisionJson — pretty-printed `agentRecord.decision`.
//
// Stable JSON.stringify with 2-space indentation. The decision payload is
// small (≤ 1 KB) and the modal opens infrequently, so memoisation isn't
// load-bearing — let the React caller `useMemo` if it cares.
// ─────────────────────────────────────────────────────────────────────────────

export function composeDecisionJson(agentRecord: AgentRecord): string {
  return JSON.stringify(agentRecord.decision, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// hasReasoningIndicator — feed-row indicator predicate.
//
// TurnFeed lights up a small "🧠" indicator when reasoning content exists.
// Empty strings count as "no content" — same rationale as
// composeReasoningText above (avoid an empty bauble-on-the-row that
// signals nothing).
// ─────────────────────────────────────────────────────────────────────────────

export function hasReasoningIndicator(agentRecord: AgentRecord): boolean {
  const r = agentRecord.llm.reasoning;
  return r !== null && r !== "";
}
