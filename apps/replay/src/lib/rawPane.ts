// Phase 6 — Raw-pane composition helpers for replay diagnostics.
//
// Pure-function module. ExpandModal and TurnFeed use these helpers to render:
//
//   1. Full LLM input — system role + user role + per-turn tool schema.
//   2. Reasoning text — captured reasoning or a clear fallback.
//   3. Usage — raw usage plus output/max token diagnostics in the feed.
//   4. Tool call — rawArguments vs parsed decision matched/diverged.
//   5. Field-scoped validator errors.

import type { UseVariant } from "../../../../convex/llm/decisionTool";
// Replay must show the schema variant actually shipped for this turn.
// eslint-disable-next-line no-restricted-imports
import { buildDecisionTool } from "../../../../convex/llm/decisionTool";
import type { AgentRecord } from "./decisionEnglish";

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

const VALIDATOR_FIELDS = [
  "use",
  "position",
  "action",
  "say",
  "scratchpad",
] as const;

type ValidatorField = (typeof VALIDATOR_FIELDS)[number];
type ValidatorFieldErrors = Partial<Record<ValidatorField, string>>;

export const LEGACY_COMPOSED_USER_MESSAGE_UNAVAILABLE =
  "(legacy phase-3 record — composedUserMessage unavailable)";

// ─────────────────────────────────────────────────────────────────────────────
// Full LLM input
// ─────────────────────────────────────────────────────────────────────────────

export function composeFullLlmInput(agentRecord: AgentRecord): string {
  const system = composeSystemRole(agentRecord);
  const userRole = composeUserRole(agentRecord);
  const toolSchema = composeToolSchemaSection(agentRecord);

  return [
    `--- system role ---\n${system}`,
    `--- user role ---\n${userRole}`,
    `--- tool schema ---\n${toolSchema}`,
  ].join("\n\n");
}

function composeSystemRole(agentRecord: AgentRecord): string {
  const system = agentRecord.input.systemPromptText;
  const playerName = readPlayerName(agentRecord);
  return system.replace("<Player Name>", playerName);
}

function readPlayerName(agentRecord: AgentRecord): string {
  const input = agentRecord.input as AgentInputWithComposed;
  const match = /^#\s+(.+)$/m.exec(input.composedUserMessage ?? "");
  if (match && match[1]?.trim()) return match[1].trim();
  return titleCase(agentRecord.personaId);
}

function titleCase(value: string): string {
  return value.length === 0
    ? value
    : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function composeUserRole(agentRecord: AgentRecord): string {
  const input = agentRecord.input as AgentInputWithComposed;
  if (typeof input.composedUserMessage === "string") {
    return input.composedUserMessage;
  }

  return LEGACY_COMPOSED_USER_MESSAGE_UNAVAILABLE;
}

export const TOOL_SCHEMA_UNAVAILABLE =
  "(tool schema unavailable: agentRecord.input.useVariant missing)";

export function composeToolSchemaSection(agentRecord: AgentRecord): string {
  const useVariant = readUseVariant(agentRecord.input);
  if (useVariant === null) return TOOL_SCHEMA_UNAVAILABLE;
  return JSON.stringify(buildDecisionTool({ useVariant }), null, 2);
}

function readUseVariant(input: AgentRecord["input"]): UseVariant | null {
  const raw = (input as { useVariant?: unknown }).useVariant;
  if (raw === "consumable_or_null" || raw === "null_only") return raw;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning
// ─────────────────────────────────────────────────────────────────────────────

export const NO_REASONING_FALLBACK = "(no reasoning captured)";

export function composeReasoningText(agentRecord: AgentRecord): string {
  const r = agentRecord.llm.reasoning;
  if (r === null || r === "") return NO_REASONING_FALLBACK;
  return r;
}

export function hasReasoningIndicator(agentRecord: AgentRecord): boolean {
  const r = agentRecord.llm.reasoning;
  return r !== null && r !== "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision JSON / rawArguments diagnostic
// ─────────────────────────────────────────────────────────────────────────────

export function composeDecisionJson(agentRecord: AgentRecord): string {
  return JSON.stringify(agentRecord.decision, null, 2);
}

export function composeRawArgumentsVsDecision(
  agentRecord: AgentRecord,
): RawArgumentsVsDecision {
  const rawArguments = agentRecord.llm.rawArguments;
  const decisionJson = composeDecisionJson(agentRecord);

  if (rawArguments === null) {
    return {
      matched: false,
      rendered: [
        "rawArguments vs decision: diverged",
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
      rendered: ["rawArguments vs decision: matched", decisionJson].join("\n"),
    };
  }

  return {
    matched: false,
    rendered: [
      "rawArguments vs decision: diverged",
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
// Field-scoped validator diagnostics
// ─────────────────────────────────────────────────────────────────────────────

export const NO_VALIDATOR_FIELD_ERRORS =
  "(no validator field errors)";

export function hasValidatorFieldErrors(agentRecord: AgentRecord): boolean {
  return validatorFieldErrorLines(agentRecord).length > 0;
}

export function composeValidatorFieldErrors(agentRecord: AgentRecord): string {
  const lines = validatorFieldErrorLines(agentRecord);
  return lines.length > 0 ? lines.join("\n") : NO_VALIDATOR_FIELD_ERRORS;
}

export function summariseValidatorFieldErrors(
  agentRecord: AgentRecord,
): string | null {
  const lines = validatorFieldErrorLines(agentRecord);
  return lines.length > 0 ? lines.join(" | ") : null;
}

function validatorFieldErrorLines(agentRecord: AgentRecord): string[] {
  const errors = readValidatorFieldErrors(agentRecord.llm.validatorFieldErrors);
  const lines: string[] = [];
  for (const field of VALIDATOR_FIELDS) {
    const reason = errors[field];
    if (typeof reason === "string" && reason.length > 0) {
      lines.push(`${field}: ${reason}`);
    }
  }
  return lines;
}

function readValidatorFieldErrors(raw: unknown): ValidatorFieldErrors {
  if (raw === null || raw === undefined || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: ValidatorFieldErrors = {};
  for (const field of VALIDATOR_FIELDS) {
    const value = obj[field];
    if (typeof value === "string") out[field] = value;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage
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

export const NO_USAGE_FALLBACK = "(no usage captured)";

export function composeUsage(agentRecord: AgentRecord): string {
  const usage = agentRecord.llm.usage;
  if (usage === null || usage === undefined) return NO_USAGE_FALLBACK;
  return JSON.stringify(usage, null, 2);
}
