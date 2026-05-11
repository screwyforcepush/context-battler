// Phase 04 / WP-B — Raw-pane composition helpers for ExpandModal.
//
// Pure-function module. The ExpandModal collapsed from a 5-tab UI to a
// 3-section vertical raw-dump pane (Phase-3 ADR §1 / WP-D.1):
//
//   1. Full LLM input — system role + user role + live tool schema.
//   2. Reasoning text — `agentRecord.llm.reasoning ?? "(no reasoning captured)"`.
//   3. Tool call — rawArguments vs decision matched/diverged diagnostic.
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
// WP-B diagnostic contract: Full LLM Input must show the live tool schema.
// eslint-disable-next-line no-restricted-imports
import { decisionTool } from "../../../../convex/llm/decisionTool";

type AgentInputWithComposed = AgentRecord["input"] & {
  composedUserMessage?: string;
};

type JsonObject = { [key: string]: JsonValue };
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

type RawArgumentsVsDecision = {
  matched: boolean;
  rendered: string;
};

type UsageBar = {
  rendered: string;
  truncated: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// composeFullLlmInput — concatenate request input sections.
//
// Phase-4 traces carry `input.composedUserMessage`, the exact user-role text
// sent to Azure. Phase-3 traces do not, so the replay falls back to the legacy
// client-side wrapper around persona + scratchpad + visible digest.
// ─────────────────────────────────────────────────────────────────────────────

export function composeFullLlmInput(agentRecord: AgentRecord): string {
  const system = agentRecord.input.systemPromptText;
  const userRole = composeUserRole(agentRecord);
  const toolSchema = composeToolSchemaSection();

  return [
    `--- system role ---\n${system}`,
    `--- user role ---\n${userRole}`,
    `--- tool schema ---\n${toolSchema}`,
  ].join("\n\n");
}

function composeUserRole(agentRecord: AgentRecord): string {
  const input = agentRecord.input as AgentInputWithComposed;
  if (input.composedUserMessage) return input.composedUserMessage;

  return [
    "## Persona",
    agentRecord.input.personaPromptText,
    "",
    "## Scratchpad",
    agentRecord.input.scratchpadBefore,
    "",
    "## Visible state",
    agentRecord.input.visibleStateDigest,
  ].join("\n");
}

export function composeToolSchemaSection(): string {
  return JSON.stringify(decisionTool, null, 2);
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
// composeRawArgumentsVsDecision — canonical rawArguments/decision diagnostic.
//
// Equality is JSON.parse(rawArguments) compared with agentRecord.decision after
// recursively sorting object keys. rawArguments is preserved verbatim in the
// diverged pane so invalid JSON remains visible to the user.
// ─────────────────────────────────────────────────────────────────────────────

export function composeRawArgumentsVsDecision(
  agentRecord: AgentRecord,
): RawArgumentsVsDecision {
  const rawArguments = agentRecord.llm.rawArguments;
  const decisionJson = composeDecisionJson(agentRecord);

  if (rawArguments === null) {
    return {
      matched: false,
      rendered: [
        "⚠ diverged",
        "(no rawArguments - wrapper-level failure)",
        `failureReason: ${agentRecord.llm.failureReason ?? "(not set)"}`,
        "",
        "--- decision ---",
        decisionJson,
      ].join("\n"),
    };
  }

  const parsed = parseRawArguments(rawArguments);
  const matched =
    parsed.ok &&
    canonicalStringify(parsed.value) === canonicalStringify(agentRecord.decision);

  if (matched) {
    return {
      matched: true,
      rendered: ["✓ matched", decisionJson].join("\n"),
    };
  }

  return {
    matched: false,
    rendered: [
      "⚠ diverged",
      ...(parsed.ok ? [] : [`rawArguments parse error: ${parsed.error}`]),
      "",
      "--- rawArguments ---",
      rawArguments,
      "",
      "--- decision ---",
      decisionJson,
    ].join("\n"),
  };
}

function parseRawArguments(
  rawArguments: string,
): { ok: true; value: JsonValue } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(rawArguments) as JsonValue };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown JSON parse error",
    };
  }
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const canonicalItem = canonicalise(item);
      return canonicalItem === undefined ? null : canonicalItem;
    });
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: JsonObject = {};
    for (const key of Object.keys(obj).sort()) {
      const canonicalValue = canonicalise(obj[key]);
      if (canonicalValue !== undefined) out[key] = canonicalValue;
    }
    return out;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// composeUsageBar — compact output/max display + truncation flag.
// ─────────────────────────────────────────────────────────────────────────────

export function composeUsageBar(
  agentRecord: AgentRecord,
  maxOutputTokens: number,
): UsageBar {
  const outputTokens = readOutputTokens(agentRecord.llm.usage);
  const renderedOutput =
    outputTokens === null ? "\u2014" : String(outputTokens);
  const renderedMax = String(maxOutputTokens);
  return {
    rendered: `[${renderedOutput} / ${renderedMax}] tokens`,
    truncated:
      outputTokens !== null && outputTokens >= 0.95 * maxOutputTokens,
  };
}

function readOutputTokens(usage: AgentRecord["llm"]["usage"]): number | null {
  if (usage === null || usage === undefined || typeof usage !== "object") {
    return null;
  }
  const raw = (usage as { output_tokens?: unknown }).output_tokens;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
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
