// WP6 — `callDecisionTool`: the only function in the codebase that talks
// to Azure for a per-turn decision. Wrapper contract is locked in ADR §4:
//
//   - NEVER throws. Every failure path resolves to `SAFE_DEFAULT_DECISION`
//     with a populated `failureReason` (one of the 9 in `FailureReason`).
//     The exception: `multiple_function_calls` keeps the FIRST decision
//     (it's still usable) but populates `failureReason` for telemetry so
//     WP12 stats can surface the rate.
//   - 60 s `AbortController` lives INSIDE the wrapper (configurable via
//     `abortTimeoutMs`). No caller forgets the timeout.
//   - Sends `tool_choice: "required"`, `parallel_tool_calls: false`,
//     `reasoning.effort` per arg, `store: false`.
//   - Surfaces `latencyMs`, `usage`, `responseId`, `httpStatus` on the
//     trace fields so WP10 can persist them per-row (ADR §6/§7).
//
// Cross-references:
//   - `azure-llm.md` §1 (credentials), §5 (response shape), §7 (tool-use
//     end-to-end). The `arguments` field is a JSON-encoded STRING per §7.
//   - WP10 (`runMatch.advanceTurn`) calls this once per agent per turn via
//     Promise.all; per-agent fallbacks are visible via `failureReason`.

import {
  decisionTool,
  parseDecision,
  SAFE_DEFAULT_DECISION,
} from "./decisionTool.js";
import type {
  FailureReason,
  ParsedDecision,
} from "../engine/types.js";

// ─── Public types (locked per ADR §4) ────────────────────────────────────────

/**
 * Azure usage bag — best-effort shape per `azure-llm.md` §5. Stored
 * verbatim in the trace; downstream consumers (WP12 cost reports) read it
 * out as needed.
 */
export type AzureUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
};

/** Wrapper result — every failure mode resolves to this same shape. */
export type CallResult = {
  decision: ParsedDecision;
  callId: string | null;
  rawArguments: string | null;
  fellBackToSafeDefault: boolean;
  failureReason?: FailureReason;
  raw: {
    responseId: string | null;
    usage: AzureUsage | null;
    latencyMs: number;
    httpStatus: number | null;
  };
};

/** Input to `callDecisionTool`. The four `azure*` fields default to env. */
export type CallDecisionToolInput = {
  systemPrompt: string;
  personaPrompt: string;
  scratchpad: string;
  visibleStateDigest: string;
  reasoningEffort: "low" | "medium" | "high";
  maxOutputTokens: number;
  abortTimeoutMs?: number;
  // Test injection points — production callers should leave these unset.
  fetchImpl?: typeof fetch;
  azureUri?: string;
  azureApiKey?: string;
  azureModel?: string;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Compose the user message body. The system prompt is sent verbatim as
 * the system role; persona + scratchpad + visible state digest are joined
 * with section labels into the user role. We use clear, terse labels so
 * the model can parse the structure even at `reasoning.effort: "low"`.
 *
 * Section labels are stable — WP8 builds the digest body separately and
 * we DO NOT reformat it here (the digest is plain text per ADR §7).
 */
function buildUserMessage(
  personaPrompt: string,
  scratchpad: string,
  visibleStateDigest: string,
): string {
  return [
    "## Persona",
    personaPrompt,
    "",
    "## Scratchpad",
    scratchpad,
    "",
    "## Visible state",
    visibleStateDigest,
  ].join("\n");
}

/** Find every function_call item in a response output array. */
type FunctionCallItem = {
  type: "function_call";
  name?: string;
  call_id?: string;
  arguments?: string;
};

function isFunctionCall(item: unknown): item is FunctionCallItem {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "function_call"
  );
}

/** Detect a content-filter block in the response body.
 *
 * Azure surfaces this in two shapes per `azure-llm.md` §2.6:
 *   - `content_filters: [{ blocked: true, ... }, ...]`
 *   - `status === "content_filter"` (less common but possible)
 *
 * We treat either as a block and return true.
 */
function isContentFilterBlocked(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { status?: unknown; content_filters?: unknown };
  if (b.status === "content_filter") return true;
  if (Array.isArray(b.content_filters)) {
    for (const cf of b.content_filters) {
      if (
        typeof cf === "object" &&
        cf !== null &&
        (cf as { blocked?: unknown }).blocked === true
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Build the safe-default `CallResult` from a partial — saves boilerplate. */
function safeDefaultResult(args: {
  failureReason: FailureReason;
  callId?: string | null;
  rawArguments?: string | null;
  responseId?: string | null;
  usage?: AzureUsage | null;
  latencyMs: number;
  httpStatus: number | null;
}): CallResult {
  return {
    decision: SAFE_DEFAULT_DECISION,
    callId: args.callId ?? null,
    rawArguments: args.rawArguments ?? null,
    fellBackToSafeDefault: true,
    failureReason: args.failureReason,
    raw: {
      responseId: args.responseId ?? null,
      usage: args.usage ?? null,
      latencyMs: args.latencyMs,
      httpStatus: args.httpStatus,
    },
  };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Call the per-turn decision tool against Azure's Responses API.
 *
 * Never throws. Returns a `CallResult` with `fellBackToSafeDefault` and
 * a populated `failureReason` on every failure mode (except
 * `multiple_function_calls`, which keeps the first call's parsed decision
 * and surfaces the failure for telemetry).
 */
export async function callDecisionTool(
  input: CallDecisionToolInput,
): Promise<CallResult> {
  const start = Date.now();
  const fetchImpl: typeof fetch = input.fetchImpl ?? globalThis.fetch;
  const azureUri = input.azureUri ?? process.env.AZURE_URI;
  const azureApiKey = input.azureApiKey ?? process.env.AZURE_API_KEY;
  const azureModel = input.azureModel ?? process.env.AZURE_MODEL;
  const abortTimeoutMs = input.abortTimeoutMs ?? 60_000;

  // Defensive: missing env or fetch implementation is surfaced as
  // http_non_200 (no HTTP call happened, but the caller's "request did not
  // succeed" expectation is the same). We never throw out of this function.
  if (!azureUri || !azureApiKey || !azureModel) {
    return safeDefaultResult({
      failureReason: "http_non_200",
      latencyMs: Date.now() - start,
      httpStatus: null,
    });
  }
  if (typeof fetchImpl !== "function") {
    return safeDefaultResult({
      failureReason: "http_non_200",
      latencyMs: Date.now() - start,
      httpStatus: null,
    });
  }

  // 60s AbortController per ADR §4. Cleared on completion via finally.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortTimeoutMs);

  const requestBody = {
    model: azureModel,
    input: [
      { role: "system", content: input.systemPrompt },
      {
        role: "user",
        content: buildUserMessage(
          input.personaPrompt,
          input.scratchpad,
          input.visibleStateDigest,
        ),
      },
    ],
    tools: [decisionTool],
    tool_choice: "required",
    parallel_tool_calls: false,
    reasoning: { effort: input.reasoningEffort },
    store: false,
    max_output_tokens: input.maxOutputTokens,
  };

  let httpStatus: number | null = null;
  try {
    let response: Response;
    try {
      response = await fetchImpl(azureUri, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": azureApiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (e) {
      // Distinguish abort from network/sync-throw. Abort wins because the
      // wrapper-internal timeout is the dominant failure shape under load.
      if (
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError")
      ) {
        return safeDefaultResult({
          failureReason: "abort_timeout",
          latencyMs: Date.now() - start,
          httpStatus: null,
        });
      }
      // Generic network error — treat as http_non_200 with null status.
      return safeDefaultResult({
        failureReason: "http_non_200",
        latencyMs: Date.now() - start,
        httpStatus: null,
      });
    }

    httpStatus = response.status;

    if (!response.ok) {
      // Drain body for trace excerpt; we don't currently surface the body
      // text on `CallResult` (`raw` only carries httpStatus), but we read
      // it to release the connection cleanly.
      try {
        await response.text();
      } catch {
        // ignore
      }
      return safeDefaultResult({
        failureReason: "http_non_200",
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      // 200 OK but body wasn't JSON — treat as http_non_200 (the response
      // contract is broken). This keeps the FailureReason set tight.
      void e;
      return safeDefaultResult({
        failureReason: "http_non_200",
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    // Pull common metadata for trace fields.
    const b = body as {
      id?: unknown;
      status?: unknown;
      incomplete_details?: unknown;
      output?: unknown;
      usage?: unknown;
    };
    const responseId = typeof b.id === "string" ? b.id : null;
    const usage =
      typeof b.usage === "object" && b.usage !== null
        ? (b.usage as AzureUsage)
        : null;

    // Failure-mode dispatch — order matters per ADR §4.
    if (isContentFilterBlocked(body)) {
      return safeDefaultResult({
        failureReason: "content_filter_blocked",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    if (b.status !== "completed") {
      return safeDefaultResult({
        failureReason: "status_not_completed",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    if (b.incomplete_details) {
      return safeDefaultResult({
        failureReason: "incomplete_details",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    const output = Array.isArray(b.output) ? b.output : [];
    const functionCalls = output.filter(isFunctionCall);

    if (functionCalls.length === 0) {
      return safeDefaultResult({
        failureReason: "no_function_call",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    // Even on `multiple_function_calls`, ADR §4 keeps the FIRST call's
    // parsed decision (still usable). Telemetry-only: failureReason is
    // populated, but `fellBackToSafeDefault` is FALSE.
    const isMultiple = functionCalls.length > 1;
    const first = functionCalls[0]!;
    const rawArguments = typeof first.arguments === "string" ? first.arguments : null;
    const callId = typeof first.call_id === "string" ? first.call_id : null;

    if (rawArguments === null) {
      // Defensive: function_call without an arguments string is a parser
      // failure even though `arguments` is technically a string per spec.
      return safeDefaultResult({
        failureReason: "json_parse_failed",
        callId,
        rawArguments: null,
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    const parsed = parseDecision(rawArguments);
    if (!parsed.ok) {
      const failureReason: FailureReason =
        parsed.error === "json_parse"
          ? "json_parse_failed"
          : "schema_validation_failed";
      return safeDefaultResult({
        failureReason,
        callId,
        rawArguments,
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }

    // Happy path (or multiple_function_calls — same return shape but
    // failureReason is set for telemetry).
    return {
      decision: parsed.decision,
      callId,
      rawArguments,
      fellBackToSafeDefault: false,
      ...(isMultiple ? { failureReason: "multiple_function_calls" as const } : {}),
      raw: {
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
      },
    };
  } catch (e) {
    // Catch-all for anything we missed. Distinguish abort one more time
    // in case AbortController fired during a code path above without
    // surfacing its own AbortError.
    if (
      controller.signal.aborted ||
      (e instanceof Error && e.name === "AbortError")
    ) {
      return safeDefaultResult({
        failureReason: "abort_timeout",
        latencyMs: Date.now() - start,
        httpStatus,
      });
    }
    return safeDefaultResult({
      failureReason: "http_non_200",
      latencyMs: Date.now() - start,
      httpStatus,
    });
  } finally {
    clearTimeout(timer);
  }
}
